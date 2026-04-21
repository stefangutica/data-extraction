import {
	Body,
	Controller,
	HttpCode,
	HttpStatus,
	NotFoundException,
	Post,
} from '@nestjs/common';
import { ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ElasticsearchService, MatchCompanyPayload } from './elasticsearch.service';

@ApiTags('entity-resolution')
@Controller()
export class ElasticsearchController {
	constructor(private readonly elasticsearchService: ElasticsearchService) {}

	@Post('api/match-company')
	@HttpCode(HttpStatus.OK)
	@ApiOperation({
		summary: 'Return top Elasticsearch entity resolution match from index companies',
	})
	@ApiBody({
		schema: {
			type: 'object',
			properties: {
				name: { type: 'string', nullable: true, example: 'Acme SRL' },
				website: {
					type: 'string',
					nullable: true,
					example: 'https://www.acme.ro/contact',
				},
				phone_number: { type: 'string', nullable: true, example: '+40 721 234 567' },
				facebook_profile: {
					type: 'string',
					nullable: true,
					example: 'https://facebook.com/acme.ro',
				},
			},
		},
	})
	@ApiResponse({ status: 200, description: 'Best matching company document (_source)' })
	@ApiResponse({ status: 404, description: 'Company was not found' })
	@ApiResponse({ status: 500, description: 'Elasticsearch connection error' })
	async matchCompany(@Body() payload: MatchCompanyPayload) {
		const company = await this.elasticsearchService.findBestCompanyMatch(payload);

		if (!company) {
			throw new NotFoundException('Company was not found');
		}

		return company;
	}

	@Post('sync')
	@HttpCode(HttpStatus.OK)
	@ApiOperation({
		summary:
			'Read hardcoded local CSV+JSON files, merge, normalize and bulk index companies into Elasticsearch',
	})
	@ApiResponse({ status: 200, description: 'Sync summary returned' })
	@ApiResponse({ status: 500, description: 'File read / Elasticsearch indexing error' })
	async sync() {
		return this.elasticsearchService.syncFromLocalFiles();
	}
}
