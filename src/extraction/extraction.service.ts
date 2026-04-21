import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import { join } from 'path';
import { ScrapedCompany, ScrapingStatus } from './entities/extraction.types';
import { WebsitesSourceService } from './services/websites-source.service';
import { HtmlFetcherService } from './services/html-fetcher.service';
import { CompanySignalExtractorService } from './services/company-signal-extractor.service';

@Injectable()
export class ExtractionService {
  private readonly logger = new Logger(ExtractionService.name);
  private readonly websitesCsvPath = join(process.cwd(), 'sample-websites.csv');
  private readonly outputFilePath = join(process.cwd(), 'data', 'scraped-results.json');
  private readonly maxConcurrentScrapes = 100;
  private readonly writeBatchSize = 50;

  private scrapingStatus: ScrapingStatus = {
    jobId: 'none',
    state: 'idle',
    totalWebsites: 0,
    processedWebsites: 0,
    successfulWebsites: 0,
    failedWebsites: 0,
  };

  constructor(
    private readonly websitesSourceService: WebsitesSourceService,
    private readonly htmlFetcherService: HtmlFetcherService,
    private readonly companySignalExtractorService: CompanySignalExtractorService,
  ) {}

  getStatus(): ScrapingStatus {
    return this.scrapingStatus;
  }

  async startScraping(): Promise<ScrapingStatus> {
    if (this.scrapingStatus.state === 'running') {
      return this.scrapingStatus;
    }

    const jobId = randomUUID();
    this.scrapingStatus = {
      jobId,
      state: 'running',
      startedAt: new Date().toISOString(),
      finishedAt: undefined,
      totalWebsites: 0,
      processedWebsites: 0,
      successfulWebsites: 0,
      failedWebsites: 0,
      error: undefined,
    };

    this.logger.log(`Scraping started for job ${jobId}`);
    void this.runScraping(jobId);

    return this.scrapingStatus;
  }

  private async runScraping(jobId: string): Promise<void> {
    const startedAtMs = Date.now();

    try {
      const websites = await this.websitesSourceService.loadWebsitesFromCsv(this.websitesCsvPath);
      this.scrapingStatus.totalWebsites = websites.length;

      await fs.mkdir(join(process.cwd(), 'data'), { recursive: true });
      await fs.writeFile(this.outputFilePath, '[\n', 'utf8');

      await this.runScrapePool(websites);

      await fs.appendFile(this.outputFilePath, '\n]\n', 'utf8');
      const durationMs = Date.now() - startedAtMs;
      const durationMinutes = (durationMs / 60000).toFixed(2);
      this.logger.log(
        `Job ${jobId}: final write completed with ${this.scrapingStatus.processedWebsites} websites | successful ${this.scrapingStatus.successfulWebsites} in ${this.outputFilePath} (duration: ${durationMinutes}m)`,
      );

      this.scrapingStatus = {
        ...this.scrapingStatus,
        state: 'completed',
        finishedAt: new Date().toISOString(),
      };

      this.logger.log(`Scraping completed for job ${jobId}. Results written to ${this.outputFilePath}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown scraping error';
      const durationMs = Date.now() - startedAtMs;
      const durationMinutes = (durationMs / 60000).toFixed(2);
      const durationSeconds = (durationMs / 1000).toFixed(2);
      this.scrapingStatus = {
        ...this.scrapingStatus,
        state: 'failed',
        finishedAt: new Date().toISOString(),
        error: message,
      };

      this.logger.error(
        `Scraping failed for job ${jobId}: ${message} (duration: ${durationMinutes}m | ${durationSeconds}s)`,
      );
    }
  }

  private async appendBatchToOutputFile(
    batchResults: ScrapedCompany[],
    hasWrittenData: boolean,
  ): Promise<void> {
    if (!batchResults.length) {
      return;
    }

    const serializedBatch = batchResults
      .map((item) => JSON.stringify(item, null, 2))
      .join(',\n');
    const payload = hasWrittenData ? `,\n${serializedBatch}` : serializedBatch;

    await fs.appendFile(this.outputFilePath, payload, 'utf8');
  }

  private async processWebsite(website: string): Promise<ScrapedCompany> {
    try {
      const scraped = await this.scrapeWebsite(website);
      this.scrapingStatus.processedWebsites += 1;

      if (scraped.crawled) {
        this.scrapingStatus.successfulWebsites += 1;
      } else {
        this.scrapingStatus.failedWebsites += 1;
      }
      return scraped;
    } catch (error) {
      this.scrapingStatus.processedWebsites += 1;
      this.scrapingStatus.failedWebsites += 1;
   

      const normalizedWebsite = this.companySignalExtractorService.normalizeWebsite(website);
      return {
        ...this.createFallbackScrapedCompany(website, normalizedWebsite),
        error: error instanceof Error ? error.message : 'Unknown scraping error',
      };
    }
  }

  private async runScrapePool(websites: string[]): Promise<void> {
    if (websites.length === 0) {
      return;
    }

    const completedBuffer: ScrapedCompany[] = [];
    const activePromises = new Set<Promise<void>>();
    let hasWrittenData = false;

    for (const website of websites) {
      let task: Promise<void>;
      task = this.processWebsite(website)
        .then((scrapedCompany) => {
          completedBuffer.push(scrapedCompany);
        })
        .finally(() => {
          activePromises.delete(task);
        });

      activePromises.add(task);

      if (activePromises.size >= this.maxConcurrentScrapes) {
        await Promise.race(activePromises);
        hasWrittenData = await this.flushCompletedBuffer(completedBuffer, hasWrittenData, false);
      }
    }

    while (activePromises.size > 0) {
      await Promise.race(activePromises);
      hasWrittenData = await this.flushCompletedBuffer(completedBuffer, hasWrittenData, false);
    }

    await this.flushCompletedBuffer(completedBuffer, hasWrittenData, true);
  }

  private async flushCompletedBuffer(
    completedBuffer: ScrapedCompany[],
    hasWrittenData: boolean,
    force: boolean,
  ): Promise<boolean> {
    let nextHasWrittenData = hasWrittenData;

    while (completedBuffer.length >= this.writeBatchSize || (force && completedBuffer.length > 0)) {
      const chunkSize = force
        ? Math.min(this.writeBatchSize, completedBuffer.length)
        : completedBuffer.length;
      const chunk = completedBuffer.splice(0, chunkSize);

      await this.appendBatchToOutputFile(chunk, nextHasWrittenData);
      nextHasWrittenData = nextHasWrittenData || chunk.length > 0;

      this.logger.log(
        `Wrote batch ${chunk.length} | processed ${this.scrapingStatus.processedWebsites}/${this.scrapingStatus.totalWebsites} | success ${this.scrapingStatus.successfulWebsites} | failed ${this.scrapingStatus.failedWebsites} to ${this.outputFilePath}`,
      );
    }

    return nextHasWrittenData;
  }


  private async scrapeWebsite(rawWebsite: string): Promise<ScrapedCompany> {
    const normalizedWebsite = this.companySignalExtractorService.normalizeWebsite(rawWebsite);
    const fallback = this.createFallbackScrapedCompany(rawWebsite, normalizedWebsite);

    const response = await this.htmlFetcherService.fetch(normalizedWebsite);
    if (!response) {
      return {
        ...fallback,
        error: 'Could not fetch html from website',
      };
    }

    const html = typeof response.data === 'string' ? response.data : '';
    const extracted = this.companySignalExtractorService.extractCompanySignals(html);

    return {
      ...fallback,
      crawled: true,
      sourceUrl: response.config.url,
      statusCode: response.status,
      phoneNumbers: extracted.phoneNumbers,
      socialLinks: extracted.socialLinks,
      addresses: extracted.addresses,
    };
  }

  private createFallbackScrapedCompany(website: string, normalizedWebsite: string): ScrapedCompany {
    return {
      website,
      normalizedWebsite,
      crawled: false,
      phoneNumbers: [],
      socialLinks: this.companySignalExtractorService.emptySocialLinks(),
      addresses: [],
    };
  }
}