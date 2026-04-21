import { Injectable } from '@nestjs/common';
import { parse } from 'csv-parse/sync';
import { promises as fs } from 'fs';

@Injectable()
export class WebsitesSourceService {
  async loadWebsitesFromCsv(filePath: string): Promise<string[]> {
    const csv = await fs.readFile(filePath, 'utf8');
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
}