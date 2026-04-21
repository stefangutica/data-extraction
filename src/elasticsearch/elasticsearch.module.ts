import { Module } from '@nestjs/common';
import { ElasticsearchController } from './elasticsearch.controller';
import { ElasticsearchService } from './elasticsearch.service';
import { CompanyNormalizerService } from './services/company-normalizer.service';
import { PhoneNormalizerService } from './services/phone-normalizer.service';
import { CompanySourceLoaderService } from './services/company-source-loader.service';
import { CompanyMergeService } from './services/company-merge.service';
import { ElasticsearchIndexService } from './services/elasticsearch-index.service';
import { CompanyResolutionService } from './services/company-resolution.service';

@Module({
	controllers: [ElasticsearchController],
	providers: [
		PhoneNormalizerService,
		CompanyNormalizerService,
		CompanySourceLoaderService,
		CompanyMergeService,
		ElasticsearchIndexService,
		CompanyResolutionService,
		ElasticsearchService,
	],
	exports: [ElasticsearchService, CompanyResolutionService],
})
export class ElasticsearchModule {}
