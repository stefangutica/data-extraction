import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ScrapedResultsAnalysisService } from './scraped-results-analysis.service';

@ApiTags('analysis')
@Controller('analysis')
export class ScrapedResultsAnalysisController {
  constructor(private readonly analysisService: ScrapedResultsAnalysisService) {}

  @Get('scraped-results')
  @ApiOperation({ summary: 'Analyze scraped-results.json coverage and fill rates' })
  @ApiResponse({ status: 200, description: 'Returns coverage and fill-rate metrics' })
  analyzeScrapedResults() {
    return this.analysisService.analyzeFile();
  }
}