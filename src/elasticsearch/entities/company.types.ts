export interface MatchCompanyPayload {
	name?: unknown;
	website?: unknown;
	phone_number?: unknown;
	facebook_profile?: unknown;
}

export interface NormalizedMatchPayload {
	name?: string;
	website?: string;
	phone_number?: string;
	facebook_profile?: string;
}

export interface CsvCompanyRow {
	domain?: string;
	company_commercial_name?: string;
	company_legal_name?: string;
	company_all_available_names?: string;
}

export interface ScrapedCompanyRow {
	website?: string;
	normalizedWebsite?: string;
	phoneNumbers?: string[];
	socialLinks?: {
		facebook?: string[];
	};
	statusCode?: number;
	crawled?: boolean;
}

export interface CompanyIndexDocument {
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