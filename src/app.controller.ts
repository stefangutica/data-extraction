import { Controller, Get, Post } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AppService } from './app.service';
import { ExtractionService } from './extraction/extraction.service';

@ApiTags('core')
@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly extractionService: ExtractionService,
  ) {}

  @Post('scraping/start')
  @ApiOperation({ summary: 'Start scraping job' })
  @ApiResponse({ status: 201, description: 'Scraping job status returned' })
  startScraping() {
    return this.extractionService.startScraping();
  }

  @Get('scraping/status')
  @ApiOperation({ summary: 'Get scraping job status' })
  @ApiResponse({ status: 200, description: 'Current scraping job status' })
  getScrapingStatus() {
    return this.extractionService.getStatus();
  }
}
