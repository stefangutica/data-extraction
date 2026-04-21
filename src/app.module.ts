import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ScrapedResultsAnalysisController } from './analysis/scraped-results-analysis.controller';
import { ScrapedResultsAnalysisService } from './analysis/scraped-results-analysis.service';
import { ExtractionModule } from './extraction/extraction.module';
import { ElasticsearchModule } from './elasticsearch/elasticsearch.module';

@Module({
  imports: [ElasticsearchModule, ExtractionModule],
  controllers: [AppController, ScrapedResultsAnalysisController],
  providers: [AppService, ScrapedResultsAnalysisService],
})
export class AppModule {}
