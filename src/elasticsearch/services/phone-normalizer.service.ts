import { Injectable } from '@nestjs/common';
import { parsePhoneNumberFromString } from 'libphonenumber-js';

@Injectable()
export class PhoneNormalizerService {
	normalizeToE164(value?: unknown): string | undefined {
		if (value === null || value === undefined) {
			return undefined;
		}

		const trimmed = String(value).trim();
		if (!trimmed) {
			return undefined;
		}

		const digitsOnly = trimmed.replace(/\D/g, '');
		const candidates = [trimmed];
		if (digitsOnly) {
			candidates.push(`+${digitsOnly}`);
		}

		for (const candidate of [...new Set(candidates)]) {
			const parsed = parsePhoneNumberFromString(candidate);
			if (parsed?.isValid()) {
				return parsed.format('E.164');
			}
		}

		return undefined;
	}

	normalizeMany(values: unknown[] = []): string[] {
		const normalized = values
			.map((value) => this.normalizeToE164(value))
			.filter((value): value is string => Boolean(value));

		return [...new Set(normalized)];
	}
}