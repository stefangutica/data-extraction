import {
	BadRequestException,
	Injectable,
	InternalServerErrorException,
	Logger,
} from '@nestjs/common';
import { Client } from '@elastic/elasticsearch';
import { CompanyIndexDocument, MatchCompanyPayload, NormalizedMatchPayload } from '../entities/company.types';
import { CompanyNormalizerService } from './company-normalizer.service';

@Injectable()
export class ElasticsearchIndexService {
	private readonly logger = new Logger(ElasticsearchIndexService.name);
	private readonly indexName = 'companies';
	private readonly client: Client;

	constructor(private readonly companyNormalizerService: CompanyNormalizerService) {
		this.client = new Client({
			node: process.env.ELASTICSEARCH_NODE || 'http://localhost:9200',
			maxRetries: 3,
			requestTimeout: 15000,
		});
	}

	normalizePayload(payload: MatchCompanyPayload): NormalizedMatchPayload {
		return {
			name: this.companyNormalizerService.normalizeName(payload.name),
			website: this.companyNormalizerService.normalizeWebsite(payload.website),
			phone_number: this.companyNormalizerService.normalizePhoneNumbers([payload.phone_number]).at(0),
			facebook_profile: this.companyNormalizerService.normalizeFacebookProfile(payload.facebook_profile),
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
			this.logger.error(`Elasticsearch query failed: ${error?.message || 'Unknown error'}`);
			throw new InternalServerErrorException('Elasticsearch connection error');
		}
	}

	async resetIndex(): Promise<void> {
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

	async bulkIndexDocuments(documents: CompanyIndexDocument[], batchSize = 1000): Promise<number> {
		let totalSuccess = 0;

		for (let i = 0; i < documents.length; i += batchSize) {
			const batch = documents.slice(i, i + batchSize);
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

				for (const item of response?.items || []) {
					const status = item?.index?.status;
					if (status >= 200 && status < 300) {
						totalSuccess += 1;
					}
				}

				if (response?.errors) {
					this.logger.warn(`Bulk batch ${Math.floor(i / batchSize) + 1} completed with partial errors`);
				}
			} catch (error) {
				this.logger.error(`Bulk indexing failed: ${error?.message || 'Unknown error'}`);
				throw new InternalServerErrorException('Bulk indexing error in Elasticsearch');
			}
		}

		return totalSuccess;
	}
}