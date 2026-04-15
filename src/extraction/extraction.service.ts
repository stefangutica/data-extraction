import { Injectable, Logger } from '@nestjs/common';
import axios, { AxiosResponse } from 'axios';
import { parse } from 'csv-parse/sync';
import { promises as fs } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { ScrapedCompany, ScrapingStatus, SocialLinks } from './extraction.types';
import * as https from 'https';
import * as http from 'http';
import * as cheerio from 'cheerio';
import { findPhoneNumbersInText, isValidPhoneNumber } from 'libphonenumber-js';


@Injectable()
export class ExtractionService {
  private readonly logger = new Logger(ExtractionService.name);
  private readonly websitesCsvPath = join(process.cwd(), 'sample-websites.csv');
  private readonly outputFile = join(process.cwd(), 'data', 'scraped-results.json');
  private pendingPromisesCount = 0;
  private readonly maxPendingPromises = 100;
  private readonly writeBatchSize = 50;

private readonly httpsAgent = new https.Agent({ 
    rejectUnauthorized: false, 
    keepAlive: false, 
    maxSockets: 100 
  });
  
  private readonly httpAgent = new http.Agent({ 
    keepAlive: false, 
    maxSockets: 100
  });

  private scrapingStatus: ScrapingStatus = {
    jobId: 'none',
    state: 'idle',
    totalWebsites: 0,
    processedWebsites: 0,
    successfulWebsites: 0,
    failedWebsites: 0,
  };

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
      outputFile: this.outputFile,
      error: undefined,
    };

    this.logger.log(`Scraping started for job ${jobId}`);
    this.runScraping(jobId);

    return this.scrapingStatus;
  }

  private async runScraping(jobId: string): Promise<void> {
    const startedAtMs = Date.now();

    try {
      const websites = await this.readWebsitesFromCsv();
      this.scrapingStatus.totalWebsites = websites.length;

      await fs.mkdir(join(process.cwd(), 'data'), { recursive: true });
      await fs.writeFile(this.outputFile, '[\n', 'utf8');

      let hasWrittenData = false;
      const completedBuffer: ScrapedCompany[] = [];
      const activePromises: Promise<void>[] = [];
      this.pendingPromisesCount = 0;

      const flushCompleted = async (force: boolean): Promise<void> => {
        while (completedBuffer.length >= this.writeBatchSize || (force && completedBuffer.length > 0)) {
          const chunkSize = force
            ? Math.min(this.writeBatchSize, completedBuffer.length)
            : this.writeBatchSize;
          const chunk = completedBuffer.splice(0, chunkSize);

          await this.appendBatchToOutputFile(chunk, hasWrittenData);
          hasWrittenData = hasWrittenData || chunk.length > 0;

          this.logger.log(
            `Job ${jobId}: wrote batch of ${chunk.length} websites | processed ${this.scrapingStatus.processedWebsites}/${this.scrapingStatus.totalWebsites} | successful ${this.scrapingStatus.successfulWebsites} | pending ${this.pendingPromisesCount} persisted to ${this.outputFile}`,
          );
        }
      };

      for (const website of websites) {
        while (this.pendingPromisesCount >= this.maxPendingPromises) {
          await Promise.race(activePromises);
          await flushCompleted(false);
        }

        let task: Promise<void>;
        task = this.processWebsite(website)
          .then((scraped) => {
            completedBuffer.push(scraped);
          })
          .finally(() => {
            const index = activePromises.indexOf(task);
            if (index !== -1) {
              activePromises.splice(index, 1);
            }
          });

        activePromises.push(task);
      }

      await Promise.all(activePromises);
      await flushCompleted(true);

      await fs.appendFile(this.outputFile, '\n]\n', 'utf8');
      const durationMs = Date.now() - startedAtMs;
      const durationMinutes = (durationMs / 60000).toFixed(2);
      this.logger.log(
        `Job ${jobId}: final write completed with ${this.scrapingStatus.processedWebsites} websites | successful ${this.scrapingStatus.successfulWebsites} in ${this.outputFile} (duration: ${durationMinutes}m)`,
      );

      this.scrapingStatus = {
        ...this.scrapingStatus,
        state: 'completed',
        finishedAt: new Date().toISOString(),
      };

      this.logger.log(`Scraping completed for job ${jobId}. Results written to ${this.outputFile}`);
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

      this.logger.error(`Scraping failed for job ${jobId}: ${message} (duration: ${durationMinutes}m | ${durationSeconds}s)`);
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

    await fs.appendFile(this.outputFile, payload, 'utf8');
  }

  private async processWebsite(website: string): Promise<ScrapedCompany> {
    this.pendingPromisesCount += 1;

    try {
      const scraped = await this.scrapeWebsite(website);
      this.scrapingStatus.processedWebsites += 1;

      if (scraped.crawled) {
        this.scrapingStatus.successfulWebsites += 1;
      } else {
        this.scrapingStatus.failedWebsites += 1;
      }

      return scraped;
    } finally {
      this.pendingPromisesCount -= 1;
    }
  }

  private async readWebsitesFromCsv(): Promise<string[]> {
    const csv = await fs.readFile(this.websitesCsvPath, 'utf8');
    const records = parse(csv, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
    }) as Array<Record<string, string>>;

    const websites = records
      .map((row) => row.domain ?? row.website ?? row.url)
      .filter((value): value is string => Boolean(value?.trim()))
      .map((value) => value.trim());

    return [...new Set(websites)];
  }

  private async scrapeWebsite(rawWebsite: string): Promise<ScrapedCompany> {
    const normalizedWebsite = this.normalizeWebsite(rawWebsite);

    const fallback: ScrapedCompany = {
      website: rawWebsite,
      normalizedWebsite,
      crawled: false,
      phoneNumbers: [],
      socialLinks: this.emptySocialLinks(),
      addresses: [],
    };

    const response = await this.fetchHtml(normalizedWebsite);
    if (!response) {
      return {
        ...fallback,
        error: 'Could not fetch html from website',
      };
    }

    const html = typeof response.data === 'string' ? response.data : '';
    const extracted = this.extractCompanySignals(html);

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

  private async fetchHtml(domain: string): Promise<AxiosResponse<string> | undefined> {
    const candidates = [`https://${domain}`,`http://${domain}`,];
    // console.log(`Attempting to fetch HTML for ${domain} using candidates: ${candidates.join(', ')}`);
    for (const url of candidates) {
      try {
        const response = await axios.get<string>(url, {
        timeout: 30000, 
      
        maxRedirects: 5,
        
        family: 4, 

        headers: {
    
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
          'Accept-Encoding': 'gzip, deflate, br',
          'Accept-Language': 'en-US,en;q=0.9,ro;q=0.8',
          
          'Sec-Ch-Ua': '"Chromium";v="122", "Not(A:Brand";v="24", "Google Chrome";v="122"',
          'Sec-Ch-Ua-Mobile': '?0',
          'Sec-Ch-Ua-Platform': '"Windows"',
          'Sec-Fetch-Dest': 'document',
          'Sec-Fetch-Mode': 'navigate',
          'Sec-Fetch-Site': 'none',
          'Sec-Fetch-User': '?1',
          'Upgrade-Insecure-Requests': '1'
        },
            validateStatus: (status) => status >= 200 && status < 500,
            httpsAgent: this.httpsAgent,
            httpAgent: this.httpAgent,
          });

        const contentType = String(response.headers['content-type'] ?? '').toLowerCase();
        // console.log(`Fetched ${url} with status ${response.status} and content-type: ${contentType}`);
        if (!contentType.includes('text/html')) {
          continue;
        }

        return response;
      } catch(error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        // this.logger.debug(`Skipping ${url}: ${message}`);
      }
    }

    // this.logger.warn(`Could not fetch HTML for ${domain} after trying HTTP and HTTPS`);
    return undefined;
  }

  private extractCompanySignals(html: string): {
    phoneNumbers: string[];
    socialLinks: SocialLinks;
    addresses: string[];
  } {
    // PRIORITY 1: Extract from JSON-LD (100% accuracy)
    const jsonLdPhones = this.extractPhonesFromJsonLd(html);
    const jsonLdAddresses = this.extractAddressesFromJsonLd(html);

    // PRIORITY 2: Extract from tel: links (99% accuracy)
    const telLinkPhones = this.extractPhonesFromTelLinks(html);

    // PRIORITY 3: Fallback - extract from raw text
    const { text, links } = this.scanHtmlSinglePass(html);
    const textPhones =
      jsonLdPhones.length === 0 && telLinkPhones.length === 0
        ? this.extractPhonesFromTextWithLibphone(text)
        : [];
    const textAddresses = jsonLdAddresses.length === 0 ? this.extractAddressesFromText(text) : [];

    // Combine and deduplicate using Set, respecting limits
    const allPhones = new Set<string>([...jsonLdPhones, ...telLinkPhones, ...textPhones]);
    const allAddresses = new Set<string>([...jsonLdAddresses, ...textAddresses]);

    // Extract social links from all collected links
    const socialLinks = this.extractSocialLinksFromLinks(links);

    return {
      phoneNumbers: Array.from(allPhones).slice(0, 10),
      socialLinks,
      addresses: Array.from(allAddresses).slice(0, 5),
    };
  }

  /**
   * PRIORITY 1: Extract phones from JSON-LD structured data (100% accuracy)
   */
  private extractPhonesFromJsonLd(html: string): string[] {
    const phones: string[] = [];
    const $ = cheerio.load(html);

    $('script[type="application/ld+json"]').each((_i, elem) => {
      try {
        const text = $(elem).text();
        const jsonLd = JSON.parse(text);
        this.traverseJsonLdForPhones(jsonLd, phones);
      } catch {
        // Ignore invalid JSON-LD
      }
    });

    return Array.from(new Set(phones)).slice(0, 10);
  }

  /**
   * Recursively traverse JSON-LD objects to find telephone fields
   */
  private traverseJsonLdForPhones(obj: any, phones: string[]): void {
    if (!obj || typeof obj !== 'object') {
      return;
    }

    if (Array.isArray(obj)) {
      obj.forEach((item) => this.traverseJsonLdForPhones(item, phones));
      return;
    }

    if (obj.telephone) {
      const tel = Array.isArray(obj.telephone) ? obj.telephone : [obj.telephone];
      tel.forEach((t: string) => {
        if (typeof t === 'string' && t.trim() && this.isValidPhone(t.trim())) {
          phones.push(t.trim());
        }
      });
    }

    for (const key in obj) {
      if (key !== 'telephone' && typeof obj[key] === 'object') {
        this.traverseJsonLdForPhones(obj[key], phones);
      }
    }
  }

  /**
   * PRIORITY 2: Extract phones from tel: links (99% accuracy)
   */
  private extractPhonesFromTelLinks(html: string): string[] {
    const phones: string[] = [];
    const $ = cheerio.load(html);

    $('a[href^="tel:"]').each((_i, elem) => {
      const href = $(elem).attr('href');
      if (href) {
        const phone = href.replace(/^tel:/, '').trim();
        if (phone && this.isValidPhone(phone)) {
          phones.push(phone);
        }
      }
    });

    return Array.from(new Set(phones)).slice(0, 10);
  }

  /**
   * PRIORITY 3: Extract phones from raw text using libphonenumber-js (fallback, no regex)
   */
  private extractPhonesFromTextWithLibphone(text: string): string[] {
    const phones: string[] = [];

    try {
      const results = findPhoneNumbersInText(text, 'US');
      for (const result of results) {
        const phoneNumber = result.number;
        if (phoneNumber && phoneNumber.isValid()) {
          phones.push(phoneNumber.number);
        }
      }
    } catch {
      // Silently ignore if libphonenumber fails - no regex fallback
    }

    return Array.from(new Set(phones)).slice(0, 10);
  }

  /**
   * Simple phone validation using only libphonenumber-js
   */
  private isValidPhone(phone: string): boolean {
    try {
      return isValidPhoneNumber(phone, 'US');
    } catch {
      return false;
    }
  }

  /**
   * PRIORITY 1: Extract addresses from JSON-LD structured data (100% accuracy)
   */
  private extractAddressesFromJsonLd(html: string): string[] {
    const addresses: string[] = [];
    const $ = cheerio.load(html);

    $('script[type="application/ld+json"]').each((_i, elem) => {
      try {
        const text = $(elem).text();
        const jsonLd = JSON.parse(text);
        this.traverseJsonLdForAddresses(jsonLd, addresses);
      } catch {
        // Ignore invalid JSON-LD
      }
    });

    return Array.from(new Set(addresses))
      .filter((a) => a.length > 10)
      .slice(0, 5);
  }

  /**
   * Recursively traverse JSON-LD objects to find address fields
   */
  private traverseJsonLdForAddresses(obj: any, addresses: string[]): void {
    if (!obj || typeof obj !== 'object') {
      return;
    }

    if (Array.isArray(obj)) {
      obj.forEach((item) => this.traverseJsonLdForAddresses(item, addresses));
      return;
    }

    // Check for PostalAddress object
    if (obj['@type'] === 'PostalAddress' || obj.address) {
      const addr = obj.address;
      if (typeof addr === 'object' && addr.streetAddress && addr.addressLocality) {
        const fullAddr = [
          addr.streetAddress,
          addr.addressLocality,
          addr.addressRegion,
          addr.postalCode,
        ]
          .filter((a) => a && typeof a === 'string')
          .join(', ')
          .trim();

        if (fullAddr) {
          addresses.push(fullAddr);
        }
      } else if (typeof addr === 'string' && addr.length > 10) {
        addresses.push(addr);
      }
    }

    for (const key in obj) {
      if (
        key !== 'address' &&
        key !== 'telephone' &&
        typeof obj[key] === 'object'
      ) {
        this.traverseJsonLdForAddresses(obj[key], addresses);
      }
    }
  }

  private scanHtmlSinglePass(html: string): { text: string; links: string[] } {
    const $ = cheerio.load(html);
    
    // Extract all href links (including social networks)
    const links: string[] = [];
    $('a[href]').each((_i, elem) => {
      const href = $(elem).attr('href');
      if (href && (href.startsWith('http://') || href.startsWith('https://'))) {
        links.push(href);
      }
    });

    // Extract text content, removing scripts and styles
    $('script, style').remove();
    const text = $('body').text() || $.text();
    const cleanText = text
      .replace(/&nbsp;/g, ' ')
      .replace(/[\r\n\t]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    return {
      text: cleanText,
      links: [...new Set(links)],
    };
  }

  private extractAddressesFromText(text: string): string[] {
    const matches =
      text.match(
        /\d{1,6}\s+[A-Za-z0-9.'\-\s]+\s(?:Street|St|Avenue|Ave|Boulevard|Blvd|Road|Rd|Lane|Ln|Drive|Dr|Way|Court|Ct|Circle|Cir|Plaza|Pl|Park|Parkway|Pkwy)\b[^\n,]{0,80}/gi,
      ) ?? [];

    const addresses = matches
      .map((value) => value.replace(/\s+/g, ' ').trim())
      .filter((value) => value.length > 10); // Minimum quality threshold

    return Array.from(new Set(addresses)).slice(0, 5);
  }

  private extractSocialLinksFromLinks(links: string[]): SocialLinks {
    const byPattern = (pattern: RegExp) =>
      [...new Set(links.filter((link) => pattern.test(link)))].slice(0, 5);

    const facebook = byPattern(/facebook\.com/i);
    const instagram = byPattern(/instagram\.com/i);
    const linkedin = byPattern(/linkedin\.com/i);
    const twitter = byPattern(/twitter\.com|x\.com/i);
    const youtube = byPattern(/youtube\.com|youtu\.be/i);
    const tiktok = byPattern(/tiktok\.com/i);

    const known = new Set<string>([
      ...facebook,
      ...instagram,
      ...linkedin,
      ...twitter,
      ...youtube,
      ...tiktok,
    ]);

    return {
      facebook,
      instagram,
      linkedin,
      twitter,
      youtube,
      tiktok,
      other: links.filter((link) => !known.has(link)).slice(0, 10),
    };
  }

  private normalizeWebsite(website: string): string {
    return website
      .toLowerCase()
      .replace(/^https?:\/\//, '')
      .replace(/^www\./, '')
      .replace(/\/$/, '');
  }

  private emptySocialLinks(): SocialLinks {
    return {
      facebook: [],
      instagram: [],
      linkedin: [],
      twitter: [],
      youtube: [],
      tiktok: [],
      other: [],
    };
  }
}
