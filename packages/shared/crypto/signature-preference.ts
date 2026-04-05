/**
 * Signature Preference Cache
 *
 * Remembers which HTTP signature method each remote domain prefers,
 * used by the "double-knock" delivery strategy. Cached in KV for 7 days.
 */

export type SignaturePreference = 'rfc9421' | 'cavage';

const SIG_PREF_TTL = 7 * 24 * 60 * 60; // 7 days in seconds
const SIG_PREF_PREFIX = 'sig-pref:';

export async function getSignaturePreference(
	domain: string,
	cache: KVNamespace,
): Promise<SignaturePreference | null> {
	const value = await cache.get(`${SIG_PREF_PREFIX}${domain}`);
	if (value === 'rfc9421' || value === 'cavage') return value;
	return null;
}

export async function setSignaturePreference(
	domain: string,
	pref: SignaturePreference,
	cache: KVNamespace,
): Promise<void> {
	try {
		await cache.put(`${SIG_PREF_PREFIX}${domain}`, pref, { expirationTtl: SIG_PREF_TTL });
	} catch {
		/* KV rate limit */
	}
}
