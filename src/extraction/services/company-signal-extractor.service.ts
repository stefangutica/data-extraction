import { Injectable } from '@nestjs/common';
import * as cheerio from 'cheerio';
import { findPhoneNumbersInText, isValidPhoneNumber } from 'libphonenumber-js';
import { SocialLinks } from '../entities/extraction.types';

@Injectable()
export class CompanySignalExtractorService {
  extractCompanySignals(html: string): {
    phoneNumbers: string[];
    socialLinks: SocialLinks;
    addresses: string[];
  } {
    const jsonLdPhones = this.extractPhonesFromJsonLd(html);
    const jsonLdAddresses = this.extractAddressesFromJsonLd(html);
    const telLinkPhones = this.extractPhonesFromTelLinks(html);

    const { text, links } = this.scanHtmlSinglePass(html);
    const textPhones =
      jsonLdPhones.length === 0 && telLinkPhones.length === 0
        ? this.extractPhonesFromTextWithLibphone(text)
        : [];
    const textAddresses = jsonLdAddresses.length === 0 ? this.extractAddressesFromText(text) : [];

    const allPhones = new Set<string>([...jsonLdPhones, ...telLinkPhones, ...textPhones]);
    const allAddresses = new Set<string>([...jsonLdAddresses, ...textAddresses]);

    return {
      phoneNumbers: Array.from(allPhones).slice(0, 10),
      socialLinks: this.extractSocialLinksFromLinks(links),
      addresses: Array.from(allAddresses).slice(0, 5),
    };
  }

  normalizeWebsite(website: string): string {
    return website
      .toLowerCase()
      .replace(/^https?:\/\//, '')
      .replace(/^www\./, '')
      .replace(/\/$/, '');
  }

  emptySocialLinks(): SocialLinks {
    return {
      facebook: [],
      instagram: [],
      linkedin: [],
      twitter: [],
      youtube: [],
      tiktok: [],
      other: [],
    };
  }

  private extractPhonesFromJsonLd(html: string): string[] {
    const phones: string[] = [];
    const $ = cheerio.load(html);

    $('script[type="application/ld+json"]').each((_i, elem) => {
      try {
        const text = $(elem).text();
        const jsonLd = JSON.parse(text);
        this.traverseJsonLdForPhones(jsonLd, phones);
      } catch {
        return;
      }
    });

    return Array.from(new Set(phones)).slice(0, 10);
  }

  private traverseJsonLdForPhones(obj: any, phones: string[]): void {
    if (!obj || typeof obj !== 'object') {
      return;
    }

    if (Array.isArray(obj)) {
      obj.forEach((item) => this.traverseJsonLdForPhones(item, phones));
      return;
    }

    if (obj.telephone) {
      const tel = Array.isArray(obj.telephone) ? obj.telephone : [obj.telephone];
      tel.forEach((t: string) => {
        if (typeof t === 'string' && t.trim() && this.isValidPhone(t.trim())) {
          phones.push(t.trim());
        }
      });
    }

    for (const key in obj) {
      if (key !== 'telephone' && typeof obj[key] === 'object') {
        this.traverseJsonLdForPhones(obj[key], phones);
      }
    }
  }

  private extractPhonesFromTelLinks(html: string): string[] {
    const phones: string[] = [];
    const $ = cheerio.load(html);

    $('a[href^="tel:"]').each((_i, elem) => {
      const href = $(elem).attr('href');
      if (href) {
        const phone = href.replace(/^tel:/, '').trim();
        if (phone && this.isValidPhone(phone)) {
          phones.push(phone);
        }
      }
    });

    return Array.from(new Set(phones)).slice(0, 10);
  }

  private extractPhonesFromTextWithLibphone(text: string): string[] {
    const phones: string[] = [];

    try {
      const results = findPhoneNumbersInText(text, 'US');
      for (const result of results) {
        const phoneNumber = result.number;
        if (phoneNumber && phoneNumber.isValid()) {
          phones.push(phoneNumber.number);
        }
      }
    } catch {
      return [];
    }

    return Array.from(new Set(phones)).slice(0, 10);
  }

  private isValidPhone(phone: string): boolean {
    try {
      return isValidPhoneNumber(phone, 'US');
    } catch {
      return false;
    }
  }

  private extractAddressesFromJsonLd(html: string): string[] {
    const addresses: string[] = [];
    const $ = cheerio.load(html);

    $('script[type="application/ld+json"]').each((_i, elem) => {
      try {
        const text = $(elem).text();
        const jsonLd = JSON.parse(text);
        this.traverseJsonLdForAddresses(jsonLd, addresses);
      } catch {
        return;
      }
    });

    return Array.from(new Set(addresses))
      .filter((a) => a.length > 10)
      .slice(0, 5);
  }

  private traverseJsonLdForAddresses(obj: any, addresses: string[]): void {
    if (!obj || typeof obj !== 'object') {
      return;
    }

    if (Array.isArray(obj)) {
      obj.forEach((item) => this.traverseJsonLdForAddresses(item, addresses));
      return;
    }

    if (obj['@type'] === 'PostalAddress' || obj.address) {
      const addr = obj.address;
      if (typeof addr === 'object' && addr.streetAddress && addr.addressLocality) {
        const fullAddr = [
          addr.streetAddress,
          addr.addressLocality,
          addr.addressRegion,
          addr.postalCode,
        ]
          .filter((a) => a && typeof a === 'string')
          .join(', ')
          .trim();

        if (fullAddr) {
          addresses.push(fullAddr);
        }
      } else if (typeof addr === 'string' && addr.length > 10) {
        addresses.push(addr);
      }
    }

    for (const key in obj) {
      if (key !== 'address' && key !== 'telephone' && typeof obj[key] === 'object') {
        this.traverseJsonLdForAddresses(obj[key], addresses);
      }
    }
  }

  private scanHtmlSinglePass(html: string): { text: string; links: string[] } {
    const $ = cheerio.load(html);
    const links: string[] = [];

    $('a[href]').each((_i, elem) => {
      const href = $(elem).attr('href');
      if (href && (href.startsWith('http://') || href.startsWith('https://'))) {
        links.push(href);
      }
    });

    $('script, style').remove();
    const text = $('body').text() || $.text();
    const cleanText = text
      .replace(/&nbsp;/g, ' ')
      .replace(/[\r\n\t]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    return {
      text: cleanText,
      links: [...new Set(links)],
    };
  }

  private extractAddressesFromText(text: string): string[] {
    const matches =
      text.match(
        /\d{1,6}\s+[A-Za-z0-9.'\-\s]+\s(?:Street|St|Avenue|Ave|Boulevard|Blvd|Road|Rd|Lane|Ln|Drive|Dr|Way|Court|Ct|Circle|Cir|Plaza|Pl|Park|Parkway|Pkwy)\b[^\n,]{0,80}/gi,
      ) ?? [];

    return Array.from(
      new Set(
        matches
          .map((value) => value.replace(/\s+/g, ' ').trim())
          .filter((value) => value.length > 10),
      ),
    ).slice(0, 5);
  }

  private extractSocialLinksFromLinks(links: string[]): SocialLinks {
    const byPattern = (pattern: RegExp) => [...new Set(links.filter((link) => pattern.test(link)))].slice(0, 5);

    const facebook = byPattern(/facebook\.com/i);
    const instagram = byPattern(/instagram\.com/i);
    const linkedin = byPattern(/linkedin\.com/i);
    const twitter = byPattern(/twitter\.com|x\.com/i);
    const youtube = byPattern(/youtube\.com|youtu\.be/i);
    const tiktok = byPattern(/tiktok\.com/i);

    const known = new Set<string>([
      ...facebook,
      ...instagram,
      ...linkedin,
      ...twitter,
      ...youtube,
      ...tiktok,
    ]);

    return {
      facebook,
      instagram,
      linkedin,
      twitter,
      youtube,
      tiktok,
      other: links.filter((link) => !known.has(link)).slice(0, 10),
    };
  }
}