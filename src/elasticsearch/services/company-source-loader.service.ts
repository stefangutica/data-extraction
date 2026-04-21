import {
	BadRequestException,
	Injectable,
	InternalServerErrorException,
	Logger,
} from '@nestjs/common';
import { promises as fs } from 'fs';
import * as path from 'path';
import { parse } from 'csv-parse/sync';
import { CompanyIndexDocument } from '../entities/company.types';
import { CsvCompanyRow, ScrapedCompanyRow } from '../entities/company.types';

@Injectable()
export class CompanySourceLoaderService {
	private readonly logger = new Logger(CompanySourceLoaderService.name);

	async assertFileExistsAndNotEmpty(filePath: string, fileType: 'CSV' | 'JSON'): Promise<void> {
		try {
			const stats = await fs.stat(filePath);
			if (!stats.isFile()) {
				throw new BadRequestException(`Invalid path for ${fileType}: ${filePath}`);
			}

			if (stats.size === 0) {
				throw new BadRequestException(`${fileType} file is empty: ${filePath}`);
			}
		} catch (error) {
			if (error instanceof BadRequestException) {
				throw error;
			}

			if ((error as any)?.code === 'ENOENT') {
				throw new BadRequestException(`${fileType} file does not exist: ${filePath}`);
			}

			throw new InternalServerErrorException(
				`Could not validate ${fileType} file: ${path.basename(filePath)}`,
			);
		}
	}

	async readCsvRows(filePath: string): Promise<CsvCompanyRow[]> {
		try {
			const content = await fs.readFile(filePath, 'utf-8');
			const rows = parse(content, {
				columns: true,
				skip_empty_lines: true,
				trim: true,
			});

			if (!Array.isArray(rows) || rows.length === 0) {
				throw new BadRequestException(
					`CSV file ${path.basename(filePath)} is empty or has no valid rows`,
				);
			}

			return rows as CsvCompanyRow[];
		} catch (error) {
			if (error instanceof BadRequestException) {
				throw error;
			}

			this.logger.error(`CSV read failed: ${filePath} - ${error?.message || 'Unknown error'}`);
			throw new InternalServerErrorException(
				`Could not read CSV file: ${path.basename(filePath)}`,
			);
		}
	}

	async readJsonRows(filePath: string): Promise<ScrapedCompanyRow[]> {
		try {
			const content = await fs.readFile(filePath, 'utf-8');
			const rows = JSON.parse(content);
			if (!Array.isArray(rows)) {
				throw new Error('JSON root is not an array');
			}

			if (rows.length === 0) {
				throw new BadRequestException(
					`JSON file ${path.basename(filePath)} is empty`,
				);
			}

			return rows as ScrapedCompanyRow[];
		} catch (error) {
			if (error instanceof BadRequestException) {
				throw error;
			}

			this.logger.error(`JSON read failed: ${filePath} - ${error?.message || 'Unknown error'}`);
			throw new InternalServerErrorException(
				`Could not read JSON file: ${path.basename(filePath)}`,
			);
		}
	}

	async writeJson(filePath: string, documents: CompanyIndexDocument[]): Promise<void> {
		await fs.writeFile(filePath, JSON.stringify(documents, null, 2), 'utf-8');
		this.logger.log(`Merged data written locally to ${filePath} (${documents.length} records)`);
	}
}