import {
	BadRequestException,
	Injectable,
	InternalServerErrorException,
	Logger,
} from '@nestjs/common';
import { Client } from '@elastic/elasticsearch';
import { promises as fs } from 'fs';
import * as path from 'path';
import { parse } from 'csv-parse/sync';
import { parsePhoneNumberFromString } from 'libphonenumber-js';

export interface MatchCompanyPayload {
	name?: string | null;
	website?: string | null;
	phone_number?: string | null;
	facebook_profile?: string | null;
}

interface NormalizedMatchPayload {
	name?: string;
	website?: string;
	phone_number?: string;
	facebook_profile?: string;
}

interface CsvCompanyRow {
	domain?: string;
	company_commercial_name?: string;
	company_legal_name?: string;
	company_all_available_names?: string;
}

interface ScrapedCompanyRow {
	website?: string;
	normalizedWebsite?: string;
	phoneNumbers?: string[];
	socialLinks?: {
		facebook?: string[];
	};
	statusCode?: number;
	crawled?: boolean;
}

interface CompanyIndexDocument {
	names: string[];
	website: string | null;
	phone_numbers: string[];
	facebook_profile: string | null;
}

export interface SyncSummary {
	csvRowsRead: number;
	jsonRowsRead: number;
	duplicatesResolved: number;
	indexedSuccessfully: number;
	filteredOut: number;
	processingTimeMs: number;
}

@Injectable()
export class ElasticsearchService {
	private readonly logger = new Logger(ElasticsearchService.name);
	private readonly indexName = 'companies';
	private readonly bulkBatchSize = 1000;
	private readonly csvInputRelativePath = 'sample-websites-company-names.csv';
	private readonly jsonInputRelativePath = 'data/scraped-results.json';
	private readonly mergedOutputRelativePath = 'data/merged-profiles.json';
	private readonly client: Client;

	constructor() {
		this.client = new Client({
			node: process.env.ELASTICSEARCH_NODE || 'http://localhost:9200',
			maxRetries: 3,
			requestTimeout: 15000,
		});
	}

	async mergeAndIndexCompanies(): Promise<SyncSummary> {
		const startedAt = Date.now();
		const csvPath = path.resolve(process.cwd(), this.csvInputRelativePath);
		const jsonPath = path.resolve(process.cwd(), this.jsonInputRelativePath);
		const mergedOutputPath = path.resolve(process.cwd(), this.mergedOutputRelativePath);

		this.logger.log(`Sync started with CSV: ${csvPath}`);
		this.logger.log(`Sync started with JSON: ${jsonPath}`);

		await Promise.all([
			this.assertFileExistsAndNotEmpty(csvPath, 'CSV'),
			this.assertFileExistsAndNotEmpty(jsonPath, 'JSON'),
		]);

		const [csvRows, jsonRows] = await Promise.all([
			this.readCsvRows(csvPath),
			this.readJsonRows(jsonPath),
		]);

		const mergedMap = new Map<string, CompanyIndexDocument>();
		let duplicatesResolved = 0;
		let filteredOut = 0;

		const pushCandidate = (doc: CompanyIndexDocument) => {
			const normalized = this.normalizeCompanyDocument(doc);
			if (normalized.names.length === 0 && !normalized.website) {
				filteredOut += 1;
				return;
			}

			const dedupeKey = normalized.website || `name:${normalized.names[0]}`;
			if (!dedupeKey) {
				filteredOut += 1;
				return;
			}

			const existing = mergedMap.get(dedupeKey);
			if (!existing) {
				mergedMap.set(dedupeKey, normalized);
				return;
			}

			duplicatesResolved += 1;
			mergedMap.set(dedupeKey, this.mergeDocuments(existing, normalized));
		};

		for (const row of csvRows) {
			const candidate = this.csvRowToDocument(row);
			if (candidate) {
				pushCandidate(candidate);
			}
		}

		for (const row of jsonRows) {
			const candidate = this.scrapedRowToDocument(row);
			if (candidate) {
				pushCandidate(candidate);
			}
		}

		await this.resetIndexForSync();

		const mergedDocuments = [...mergedMap.values()];
		await fs.writeFile(mergedOutputPath, JSON.stringify(mergedDocuments, null, 2), 'utf-8');
		this.logger.log(
			`Merged data written locally to ${mergedOutputPath} (${mergedDocuments.length} records)`,
		);

		const indexedSuccessfully = await this.bulkIndexDocuments(mergedDocuments);
		this.logger.log(
			`Bulk indexing completed in Elasticsearch index "${this.indexName}": ${indexedSuccessfully} documents indexed`,
		);

		return {
			csvRowsRead: csvRows.length,
			jsonRowsRead: jsonRows.length,
			duplicatesResolved,
			indexedSuccessfully,
			filteredOut,
			processingTimeMs: Date.now() - startedAt,
		};
	}

	normalizePayload(payload: MatchCompanyPayload): NormalizedMatchPayload {
		return {
			name: this.normalizeName(payload.name),
			website: this.normalizeWebsite(payload.website),
			phone_number: this.normalizePhoneToE164(payload.phone_number),
			facebook_profile: this.normalizeFacebookProfile(payload.facebook_profile),
		};
	}

	async findBestCompanyMatch(payload: MatchCompanyPayload): Promise<Record<string, any> | null> {
		const normalized = this.normalizePayload(payload);
		const shouldClauses: any[] = [];

		if (normalized.website) {
			shouldClauses.push({
				term: {
					website: {
						value: normalized.website,
						boost: 10,
					},
				},
			});
		}

		if (normalized.phone_number) {
			shouldClauses.push({
				term: {
					phone_numbers: {
						value: normalized.phone_number,
						boost: 8,
					},
				},
			});
		}

		if (normalized.facebook_profile) {
			shouldClauses.push({
				term: {
					facebook_profile: {
						value: normalized.facebook_profile,
						boost: 7,
					},
				},
			});
		}

		if (normalized.name) {
			shouldClauses.push({
				match: {
					names: {
						query: normalized.name,
						fuzziness: 'AUTO',
						boost: 3,
					},
				},
			});
		}

		if (shouldClauses.length === 0) {
			throw new BadRequestException(
				'At least one of these fields must be provided: name, website, phone_number, facebook_profile',
			);
		}

		try {
			const response = await (this.client.search as any)({
				index: this.indexName,
				size: 1,
				query: {
					bool: {
						should: shouldClauses,
						minimum_should_match: 1,
					},
				},
			});

			const topHit = response?.hits?.hits?.[0];
			return topHit?._source || null;
		} catch (error) {
			this.logger.error(
				`Elasticsearch query failed: ${error?.message || 'Unknown error'}`,
			);
			throw new InternalServerErrorException(
				'Elasticsearch connection error',
			);
		}
	}

	private async readCsvRows(filePath: string): Promise<CsvCompanyRow[]> {
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

	private async readJsonRows(filePath: string): Promise<ScrapedCompanyRow[]> {
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

	private csvRowToDocument(row: CsvCompanyRow): CompanyIndexDocument | null {
		const names = this.extractNamesFromCsvRow(row);
		const website = row.domain || null;

		if (names.length === 0 && !website) {
			return null;
		}

		return {
			names,
			website,
			phone_numbers: [],
			facebook_profile: null,
		};
	}

	private scrapedRowToDocument(row: ScrapedCompanyRow): CompanyIndexDocument | null {
		const website = row.normalizedWebsite || row.website || null;
		const phoneCandidates = row.phoneNumbers || [];
		const facebookCandidate = row.socialLinks?.facebook?.find((value) => Boolean(value?.trim())) || null;

		if (!website) {
			return null;
		}

		return {
			names: [],
			website,
			phone_numbers: phoneCandidates,
			facebook_profile: facebookCandidate,
		};
	}

	private normalizeCompanyDocument(doc: CompanyIndexDocument): CompanyIndexDocument {
		const normalizedNames = this.normalizeNames(doc.names);
		const normalizedWebsite = this.normalizeWebsite(doc.website);
		const normalizedPhones = this.normalizePhoneNumbers(doc.phone_numbers);
		const normalizedFacebook = this.normalizeFacebookProfile(doc.facebook_profile);

		return {
			names: normalizedNames,
			website: normalizedWebsite || null,
			phone_numbers: normalizedPhones,
			facebook_profile: normalizedFacebook || null,
		};
	}

	private mergeDocuments(a: CompanyIndexDocument, b: CompanyIndexDocument): CompanyIndexDocument {
		const merged: CompanyIndexDocument = {
			names: this.mergeNames(a.names, b.names),
			website: this.pickBestScalar(a.website, b.website),
			phone_numbers: this.normalizePhoneNumbers([
				...a.phone_numbers,
				...b.phone_numbers,
			]),
			facebook_profile: this.pickBestScalar(a.facebook_profile, b.facebook_profile),
		};
		return merged;
	}

	private pickBestScalar(a?: string | null, b?: string | null): string | null {
		const aa = a?.trim() || '';
		const bb = b?.trim() || '';
		if (!aa && !bb) {
			return null;
		}
		if (!aa) {
			return bb;
		}
		if (!bb) {
			return aa;
		}

		return bb.length > aa.length ? bb : aa;
	}

	private async resetIndexForSync(): Promise<void> {
		try {
			const exists = await this.client.indices.exists({ index: this.indexName });
			if (exists) {
				await this.client.indices.delete({ index: this.indexName });
				this.logger.log(`Existing index "${this.indexName}" deleted before sync`);
			}

			await (this.client.indices.create as any)({
				index: this.indexName,
				mappings: {
					properties: {
						names: { type: 'text' },
						website: { type: 'keyword' },
						phone_numbers: { type: 'keyword' },
						facebook_profile: { type: 'keyword' },
					},
				},
			});

			this.logger.log(`Index "${this.indexName}" recreated for sync`);
		} catch (error) {
			this.logger.error(`Failed to reset index: ${error?.message || 'Unknown error'}`);
			throw new InternalServerErrorException('Could not initialize Elasticsearch index');
		}
	}

	private async assertFileExistsAndNotEmpty(filePath: string, fileType: 'CSV' | 'JSON'): Promise<void> {
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

	private async bulkIndexDocuments(documents: CompanyIndexDocument[]): Promise<number> {
		let totalSuccess = 0;

		for (let i = 0; i < documents.length; i += this.bulkBatchSize) {
			const batch = documents.slice(i, i + this.bulkBatchSize);
			const operations = batch.flatMap((doc) => [
				{ index: { _index: this.indexName } },
				doc,
			]);

			try {
				const response = await (this.client.bulk as any)({
					refresh: false,
					operations,
					timeout: '90s',
				});

				const items = response?.items || [];
				for (const item of items) {
					const status = item?.index?.status;
					if (status >= 200 && status < 300) {
						totalSuccess += 1;
					}
				}

				if (response?.errors) {
					this.logger.warn(
						`Bulk batch ${Math.floor(i / this.bulkBatchSize) + 1} completed with partial errors`,
					);
				}
			} catch (error) {
				this.logger.error(`Bulk indexing failed: ${error?.message || 'Unknown error'}`);
				if (error?.meta?.body?.error?.type === 'timeout_exception') {
						throw new InternalServerErrorException('Bulk API timeout in Elasticsearch');
				}
					throw new InternalServerErrorException('Bulk indexing error in Elasticsearch');
			}
		}

		return totalSuccess;
	}

	private normalizeName(value?: string | null): string | undefined {
		if (!value || !value.trim()) {
			return undefined;
		}

		return value.trim().replace(/\s+/g, ' ').toLowerCase();
	}

	private normalizeNames(values: string[]): string[] {
		const normalized = values
			.map((value) => this.normalizeName(value))
			.filter((value): value is string => Boolean(value));

		return [...new Set(normalized)];
	}

	private mergeNames(a: string[], b: string[]): string[] {
		const merged = [...a, ...b].filter((value) => Boolean(value?.trim()));
		return this.normalizeNames(merged);
	}

	private extractNamesFromCsvRow(row: CsvCompanyRow): string[] {
		const splitAllNames = (row.company_all_available_names || '')
			.split(/\s*\|\s*/)
			.map((value) => value.trim())
			.filter(Boolean);

		return this.normalizeNames([
			row.company_commercial_name || '',
			row.company_legal_name || '',
			...splitAllNames,
		]);
	}

	private normalizeWebsite(value?: string | null): string | undefined {
		if (!value || !value.trim()) {
			return undefined;
		}

		const raw = value.trim().toLowerCase();

		try {
			const prefixed = /^https?:\/\//.test(raw) ? raw : `https://${raw}`;
			const url = new URL(prefixed);
			return this.cleanDomain(url.hostname);
		} catch {
			const withoutProtocol = raw.replace(/^https?:\/\//, '');
			const domainCandidate = withoutProtocol.split('/')[0] || '';
			const cleaned = this.cleanDomain(domainCandidate);
			return cleaned || undefined;
		}
	}

	private cleanDomain(hostname: string): string {
		return hostname
			.trim()
			.replace(/^www\d*\./, '')
			.replace(/\.+$/, '');
	}

	private normalizePhoneToE164(value?: string | null): string | undefined {
		if (value === null || value === undefined) {
			return undefined;
		}

		const trimmed = String(value).trim();
		if (!trimmed) {
			return undefined;
		}

		const digitsOnly = trimmed.replace(/\D/g, '');
		const candidates = [trimmed];
		if (digitsOnly) {
			candidates.push(`+${digitsOnly}`);
		}

		for (const candidate of [...new Set(candidates)]) {
			const parsedInternational = parsePhoneNumberFromString(candidate);
			if (parsedInternational?.isValid()) {
				return parsedInternational.format('E.164');
			}
		}

		return undefined;
	}

	private normalizePhoneNumbers(values: string[]): string[] {
		const normalized = values
			.map((value) => this.normalizePhoneToE164(value))
			.filter((value): value is string => Boolean(value));

		return [...new Set(normalized)];
	}

	private normalizeFacebookProfile(value?: string | null): string | undefined {
		if (!value || !value.trim()) {
			return undefined;
		}

		const raw = value.trim().toLowerCase();

		const directHandle = raw.replace(/^@+/, '').trim();
		if (directHandle && !directHandle.includes('/') && !directHandle.includes('facebook.com')) {
			return directHandle;
		}

		try {
			const prefixed = /^https?:\/\//.test(raw) ? raw : `https://${raw}`;
			const url = new URL(prefixed);
			const host = url.hostname.replace(/^www\./, '');

			if (!/(^|\.)facebook\.com$/.test(host)) {
				return undefined;
			}

			const pathSegment = url.pathname
				.replace(/^\/+/, '')
				.split('/')[0]
				?.replace(/^@+/, '')
				?.trim();

			if (!pathSegment || pathSegment === 'profile.php') {
				return undefined;
			}

			return pathSegment;
		} catch {
			const matched = raw.match(
				/(?:https?:\/\/)?(?:m\.)?(?:www\.)?facebook\.com\/(?:#!\/)?@?([^/?#]+)/,
			);
			return matched?.[1]?.trim() || undefined;
		}
	}
}
