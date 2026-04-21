import { Injectable } from '@nestjs/common';
import { CompanyIndexDocument, CsvCompanyRow, ScrapedCompanyRow } from '../entities/company.types';
import { CompanyNormalizerService } from './company-normalizer.service';

export interface MergedCompanyResult {
	documents: CompanyIndexDocument[];
	duplicatesResolved: number;
	filteredOut: number;
}

@Injectable()
export class CompanyMergeService {
	constructor(private readonly companyNormalizerService: CompanyNormalizerService) {}

	mergeSources(csvRows: CsvCompanyRow[], jsonRows: ScrapedCompanyRow[]): MergedCompanyResult {
		const mergedMap = new Map<string, CompanyIndexDocument>();
		let duplicatesResolved = 0;
		let filteredOut = 0;

		for (const row of csvRows) {
			const candidate = this.csvRowToDocument(row);
			if (candidate) {
				const result = this.pushCandidate(mergedMap, candidate);
				duplicatesResolved += result.duplicatesResolved;
				filteredOut += result.filteredOut;
			}
			else {
				filteredOut += 1;
			}
		}

		for (const row of jsonRows) {
			const candidate = this.scrapedRowToDocument(row);
			if (candidate) {
				const result = this.pushCandidate(mergedMap, candidate);
				duplicatesResolved += result.duplicatesResolved;
				filteredOut += result.filteredOut;
			}
			else {
				filteredOut += 1;
			}
		}

		return {
			documents: [...mergedMap.values()],
			duplicatesResolved,
			filteredOut,
		};
	}

	countSourceRows(csvRows: CsvCompanyRow[], jsonRows: ScrapedCompanyRow[]) {
		return {
			csvRowsRead: csvRows.length,
			jsonRowsRead: jsonRows.length,
		};
	}

	private pushCandidate(
		map: Map<string, CompanyIndexDocument>,
		doc: CompanyIndexDocument,
	): { duplicatesResolved: number; filteredOut: number } {
		const normalized = this.normalizeCompanyDocument(doc);
		if (normalized.names.length === 0 && !normalized.website) {
			return { duplicatesResolved: 0, filteredOut: 1 };
		}

		const dedupeKey = normalized.website || `name:${normalized.names[0]}`;
		if (!dedupeKey) {
			return { duplicatesResolved: 0, filteredOut: 1 };
		}

		const existing = map.get(dedupeKey);
		if (!existing) {
			map.set(dedupeKey, normalized);
			return { duplicatesResolved: 0, filteredOut: 0 };
		}

		map.set(dedupeKey, this.mergeDocuments(existing, normalized));
		return { duplicatesResolved: 1, filteredOut: 0 };
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
		return {
			names: this.companyNormalizerService.normalizeNames(doc.names),
			website: this.companyNormalizerService.normalizeWebsite(doc.website) || null,
			phone_numbers: this.companyNormalizerService.normalizePhoneNumbers(doc.phone_numbers),
			facebook_profile: this.companyNormalizerService.normalizeFacebookProfile(doc.facebook_profile) || null,
		};
	}

	private mergeDocuments(a: CompanyIndexDocument, b: CompanyIndexDocument): CompanyIndexDocument {
		return {
			names: this.companyNormalizerService.normalizeNames([...a.names, ...b.names]),
			website: this.pickBestScalar(a.website, b.website),
			phone_numbers: this.companyNormalizerService.normalizePhoneNumbers([
				...a.phone_numbers,
				...b.phone_numbers,
			]),
			facebook_profile: this.pickBestScalar(a.facebook_profile, b.facebook_profile),
		};
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

	private extractNamesFromCsvRow(row: CsvCompanyRow): string[] {
		const splitAllNames = (row.company_all_available_names || '')
			.split(/\s*\|\s*/)
			.map((value) => value.trim())
			.filter(Boolean);

		return this.companyNormalizerService.normalizeNames([
			row.company_commercial_name || '',
			row.company_legal_name || '',
			...splitAllNames,
		]);
	}
}