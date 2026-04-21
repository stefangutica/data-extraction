import { Injectable } from '@nestjs/common';
import { CompanyResolutionService } from './services/company-resolution.service';
import { MatchCompanyPayload, SyncSummary } from './entities/company.types';

@Injectable()
export class ElasticsearchService {
	constructor(private readonly companyResolutionService: CompanyResolutionService) {}

	mergeAndIndexCompanies(): Promise<SyncSummary> {
		return this.companyResolutionService.mergeAndIndexCompanies();
	}

	findBestCompanyMatch(payload: MatchCompanyPayload): Promise<Record<string, any> | null> {
		return this.companyResolutionService.findBestCompanyMatch(payload);
	}
}
