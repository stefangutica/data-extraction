import { Injectable } from '@nestjs/common';
import { promises as fs } from 'fs';
import { join } from 'path';
import { ScrapedCompany, SocialLinks } from '../extraction/entities/extraction.types';

export interface FieldFillRate {
  websitesWithData: number;
  websitesWithDataRate: number;
  totalValues: number;
}

export interface ScrapedResultsAnalysis {
  totalWebsites: number;
  crawledWebsites: number;
  coverageRate: number;
  statusCodeCounts: Record<string, number>;
  datapoints: {
    phoneNumbers: FieldFillRate;
    socialLinks: FieldFillRate;
    addresses: FieldFillRate;
    anyDatapoint: FieldFillRate;
  };
}

@Injectable()
export class ScrapedResultsAnalysisService {
  private readonly outputFile = join(process.cwd(), 'data', 'scraped-results.json');

  async analyzeFile(filePath: string = this.outputFile): Promise<ScrapedResultsAnalysis> {
    const raw = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw) as ScrapedCompany[];

    const totalWebsites = parsed.length;
    const crawledRows = parsed.filter((row) => row.crawled);
    const crawledWebsites = crawledRows.length;

    const statusCodeCounts = parsed.reduce<Record<string, number>>((counts, row) => {
      const statusCodeKey = row.statusCode ? String(row.statusCode) : 'unknown';
      counts[statusCodeKey] = (counts[statusCodeKey] ?? 0) + 1;
      return counts;
    }, {});

    const phoneNumbers = this.computeFieldFillRate(
      crawledRows,
      (row) => row.phoneNumbers ?? [],
    );
    const socialLinks = this.computeFieldFillRate(
      crawledRows,
      (row) => this.flattenSocialLinks(row.socialLinks),
    );
    const addresses = this.computeFieldFillRate(crawledRows, (row) => row.addresses ?? []);
    const anyDatapoint = this.computeFieldFillRate(crawledRows, (row) => [
      ...(row.phoneNumbers ?? []),
      ...this.flattenSocialLinks(row.socialLinks),
      ...(row.addresses ?? []),
    ]);

    return {
      totalWebsites,
      crawledWebsites,
      coverageRate: this.toPercentage(crawledWebsites, totalWebsites),
      statusCodeCounts,
      datapoints: {
        phoneNumbers,
        socialLinks,
        addresses,
        anyDatapoint,
      },
    };
  }

  private computeFieldFillRate(
    rows: ScrapedCompany[],
    selector: (row: ScrapedCompany) => string[],
  ): FieldFillRate {
    let websitesWithData = 0;
    let totalValues = 0;

    for (const row of rows) {
      const values = selector(row).filter((value) => Boolean(value && value.trim()));
      if (values.length > 0) {
        websitesWithData += 1;
      }
      totalValues += values.length;
    }

    return {
      websitesWithData,
      websitesWithDataRate: this.toPercentage(websitesWithData, rows.length),
      totalValues,
    };
  }

  private flattenSocialLinks(socialLinks: SocialLinks | undefined): string[] {
    if (!socialLinks) {
      return [];
    }

    return [
      ...socialLinks.facebook,
      ...socialLinks.instagram,
      ...socialLinks.linkedin,
      ...socialLinks.twitter,
      ...socialLinks.youtube,
      ...socialLinks.tiktok,
    ];
  }

  private toPercentage(part: number, total: number): number {
    if (total === 0) {
      return 0;
    }

    return Number(((part / total) * 100).toFixed(2));
  }
}