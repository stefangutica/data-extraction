import { Injectable } from '@nestjs/common';
import { PhoneNormalizerService } from './phone-normalizer.service';

@Injectable()
export class CompanyNormalizerService {
	constructor(private readonly phoneNormalizerService: PhoneNormalizerService) {}

	normalizeName(value?: unknown): string | undefined {
		if (value === null || value === undefined) {
			return undefined;
		}

		const normalized = String(value).trim().replace(/\s+/g, ' ').toLowerCase();
		return normalized || undefined;
	}

	normalizeWebsite(value?: unknown): string | undefined {
		if (value === null || value === undefined) {
			return undefined;
		}

		const raw = String(value).trim().toLowerCase();
		if (!raw) {
			return undefined;
		}

		try {
			const prefixed = /^https?:\/\//.test(raw) ? raw : `https://${raw}`;
			const url = new URL(prefixed);
			return this.cleanDomain(url.hostname);
		} catch {
			const withoutProtocol = raw.replace(/^https?:\/\//, '');
			const domainCandidate = withoutProtocol.split('/')[0] || '';
			const cleaned = this.cleanDomain(domainCandidate);
			return cleaned || undefined;
		}
	}

	normalizeFacebookProfile(value?: unknown): string | undefined {
		if (value === null || value === undefined) {
			return undefined;
		}

		const raw = String(value).trim().toLowerCase();
		if (!raw) {
			return undefined;
		}

		const directHandle = raw.replace(/^@+/, '').trim();
		if (directHandle && !directHandle.includes('/') && !directHandle.includes('facebook.com')) {
			return directHandle;
		}

		try {
			const prefixed = /^https?:\/\//.test(raw) ? raw : `https://${raw}`;
			const url = new URL(prefixed);
			const host = url.hostname.replace(/^www\./, '');

			if (!/(^|\.)facebook\.com$/.test(host)) {
				return undefined;
			}

			const pathSegment = url.pathname
				.replace(/^\/+/, '')
				.split('/')[0]
				?.replace(/^@+/, '')
				?.trim();

			if (!pathSegment || pathSegment === 'profile.php') {
				return undefined;
			}

			return pathSegment;
		} catch {
			const matched = raw.match(
				/(?:https?:\/\/)?(?:m\.)?(?:www\.)?facebook\.com\/(?:#!\/)?@?([^/?#]+)/,
			);
			return matched?.[1]?.trim() || undefined;
		}
	}

	normalizeNames(values: unknown[]): string[] {
		const normalized = values
			.map((value) => this.normalizeName(value))
			.filter((value): value is string => Boolean(value));

		return [...new Set(normalized)];
	}

	normalizePhoneNumbers(values: unknown[]): string[] {
		return this.phoneNormalizerService.normalizeMany(values);
	}

	private cleanDomain(hostname: string): string {
		return hostname
			.trim()
			.replace(/^www\d*\./, '')
			.replace(/\.+$/, '');
	}
}