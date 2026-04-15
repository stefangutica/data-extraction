export interface SocialLinks {
  facebook: string[];
  instagram: string[];
  linkedin: string[];
  twitter: string[];
  youtube: string[];
  tiktok: string[];
  other: string[];
}

export interface ScrapedCompany {
  website: string;
  normalizedWebsite: string;
  crawled: boolean;
  sourceUrl?: string;
  statusCode?: number;
  phoneNumbers: string[];
  socialLinks: SocialLinks;
  addresses: string[];
  error?: string;
}

export interface ScrapingStatus {
  jobId: string;
  state: 'idle' | 'running' | 'completed' | 'failed';
  startedAt?: string;
  finishedAt?: string;
  totalWebsites: number;
  processedWebsites: number;
  successfulWebsites: number;
  failedWebsites: number;
  outputFile?: string;
  error?: string;
}
