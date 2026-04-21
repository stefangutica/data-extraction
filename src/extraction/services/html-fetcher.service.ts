import { Injectable } from '@nestjs/common';
import axios, { AxiosResponse } from 'axios';
import * as http from 'http';
import * as https from 'https';

@Injectable()
export class HtmlFetcherService {
  private readonly httpsAgent = new https.Agent({
    rejectUnauthorized: false,
    keepAlive: false,
    maxSockets: 100,
  });

  private readonly httpAgent = new http.Agent({
    keepAlive: false,
    maxSockets: 100,
  });

  async fetch(domain: string): Promise<AxiosResponse<string> | undefined> {
    const candidates = [`https://${domain}`, `http://${domain}`];

    for (const url of candidates) {
      try {
        const response = await axios.get<string>(url, {
          timeout: 30000,
          maxRedirects: 5,
          family: 4,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
            Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
            'Accept-Encoding': 'gzip, deflate, br',
            'Accept-Language': 'en-US,en;q=0.9,ro;q=0.8',
            'Sec-Ch-Ua': '"Chromium";v="122", "Not(A:Brand";v="24", "Google Chrome";v="122"',
            'Sec-Ch-Ua-Mobile': '?0',
            'Sec-Ch-Ua-Platform': '"Windows"',
            'Sec-Fetch-Dest': 'document',
            'Sec-Fetch-Mode': 'navigate',
            'Sec-Fetch-Site': 'none',
            'Sec-Fetch-User': '?1',
            'Upgrade-Insecure-Requests': '1',
          },
          validateStatus: (status) => status >= 200 && status < 500,
          httpsAgent: this.httpsAgent,
          httpAgent: this.httpAgent,
        });

        const contentType = String(response.headers['content-type'] ?? '').toLowerCase();
        if (!contentType.includes('text/html')) {
          continue;
        }

        return response;
      } catch {
        continue;
      }
    }

    return undefined;
  }
}