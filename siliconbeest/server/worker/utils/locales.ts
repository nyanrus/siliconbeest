/**
 * Server-side locale validation utility.
 *
 * Mirrors the frontend SUPPORTED_LOCALES list to ensure consistency
 * across registration, settings updates, and email delivery.
 */

export const SUPPORTED_LOCALE_CODES: readonly string[] = [
	'en',
	'ko',
	'ja',
	'zh-CN',
	'zh-TW',
	'es',
	'fr',
	'de',
	'pt-BR',
	'ru',
	'ar',
	'id',
] as const;

const localeSet = new Set<string>(SUPPORTED_LOCALE_CODES);

/**
 * Check whether a locale code is in the supported whitelist.
 */
export function isValidLocale(code: string): boolean {
	return localeSet.has(code);
}

/**
 * Sanitise and validate a locale value. Returns the locale if valid,
 * otherwise returns the fallback (default `'en'`).
 */
export function sanitizeLocale(code: string | undefined | null, fallback = 'en'): string {
	if (!code || typeof code !== 'string') return fallback;
	const trimmed = code.trim();
	return isValidLocale(trimmed) ? trimmed : fallback;
}
