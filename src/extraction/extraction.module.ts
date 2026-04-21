import { Module } from '@nestjs/common';
import { ExtractionService } from './extraction.service';
import { WebsitesSourceService } from './services/websites-source.service';
import { HtmlFetcherService } from './services/html-fetcher.service';
import { CompanySignalExtractorService } from './services/company-signal-extractor.service';

@Module({
  providers: [
    WebsitesSourceService,
    HtmlFetcherService,
    CompanySignalExtractorService,
    ExtractionService,
  ],
  exports: [ExtractionService],
})
export class ExtractionModule {}