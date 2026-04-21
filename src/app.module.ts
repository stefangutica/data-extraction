import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ScrapedResultsAnalysisController } from './analysis/scraped-results-analysis.controller';
import { ScrapedResultsAnalysisService } from './analysis/scraped-results-analysis.service';
import { ExtractionService } from './extraction/extraction.service';
import { ElasticsearchModule } from './elasticsearch/elasticsearch.module';

@Module({
  imports: [ElasticsearchModule],
  controllers: [AppController, ScrapedResultsAnalysisController],
  providers: [AppService, ExtractionService, ScrapedResultsAnalysisService],
})
export class AppModule {}
