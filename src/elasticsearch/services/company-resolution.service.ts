import { Injectable } from '@nestjs/common';
import { CompanyMergeService } from './company-merge.service';
import { CompanySourceLoaderService } from './company-source-loader.service';
import { ElasticsearchIndexService } from './elasticsearch-index.service';
import { MatchCompanyPayload, SyncSummary } from '../entities/company.types';

@Injectable()
export class CompanyResolutionService {
	private readonly csvInputRelativePath = 'sample-websites-company-names.csv';
	private readonly jsonInputRelativePath = 'data/scraped-results.json';
	private readonly mergedOutputRelativePath = 'data/merged-profiles.json';

	constructor(
		private readonly companySourceLoaderService: CompanySourceLoaderService,
		private readonly companyMergeService: CompanyMergeService,
		private readonly elasticsearchIndexService: ElasticsearchIndexService,
	) {}

	async mergeAndIndexCompanies(): Promise<SyncSummary> {
		const startedAt = Date.now();
		const csvPath = this.csvInputRelativePath;
		const jsonPath = this.jsonInputRelativePath;
		const mergedOutputPath = this.mergedOutputRelativePath;

		await Promise.all([
			this.companySourceLoaderService.assertFileExistsAndNotEmpty(csvPath, 'CSV'),
			this.companySourceLoaderService.assertFileExistsAndNotEmpty(jsonPath, 'JSON'),
		]);

		const [csvRows, jsonRows] = await Promise.all([
			this.companySourceLoaderService.readCsvRows(csvPath),
			this.companySourceLoaderService.readJsonRows(jsonPath),
		]);

		const mergedResult = this.companyMergeService.mergeSources(csvRows, jsonRows);

		await this.elasticsearchIndexService.resetIndex();
		await this.companySourceLoaderService.writeJson(mergedOutputPath, mergedResult.documents);
		const indexedSuccessfully = await this.elasticsearchIndexService.bulkIndexDocuments(mergedResult.documents);

		return {
			csvRowsRead: csvRows.length,
			jsonRowsRead: jsonRows.length,
			duplicatesResolved: mergedResult.duplicatesResolved,
			indexedSuccessfully,
			filteredOut: mergedResult.filteredOut,
			processingTimeMs: Date.now() - startedAt,
		};
	}

	async findBestCompanyMatch(payload: MatchCompanyPayload) {
		return this.elasticsearchIndexService.findBestCompanyMatch(payload);
	}
}