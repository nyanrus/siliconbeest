import { signRequest as fedifySignRequest, verifyRequest as fedifyVerifyRequest } from '@fedify/fedify';
/**
 * HTTP Signatures for ActivityPub Federation
 *
 * Implements both draft-cavage-http-signatures and RFC 9421 HTTP Message
 * Signatures for signing and verifying ActivityPub requests.
 * Uses Web Crypto API only (no node:crypto).
 *
 * See:
 *   - https://docs.joinmastodon.org/spec/security/
 *   - https://www.rfc-editor.org/rfc/rfc9421
 *   - https://www.rfc-editor.org/rfc/rfc9530
 */

// ============================================================
// PEM HELPERS
// ============================================================

/**
 * Strip PEM headers/footers and base64-decode the key material.
 */
export function parsePemKey(pem: string): ArrayBuffer {
	const lines = pem
		.replace(/-----BEGIN [A-Z ]+-----/, '')
		.replace(/-----END [A-Z ]+-----/, '')
		.replace(/\r?\n/g, '')
		.trim();
	const binaryString = atob(lines);
	const bytes = new Uint8Array(binaryString.length);
	for (let i = 0; i < binaryString.length; i++) {
		bytes[i] = binaryString.charCodeAt(i);
	}
	return bytes.buffer;
}

/**
 * Import a PKCS8-encoded PEM private key for RSASSA-PKCS1-v1_5 SHA-256 signing.
 */
export async function importPrivateKey(pem: string): Promise<CryptoKey> {
	const keyData = parsePemKey(pem);
	return crypto.subtle.importKey(
		'pkcs8',
		keyData,
		{
			name: 'RSASSA-PKCS1-v1_5',
			hash: { name: 'SHA-256' },
		},
		true,
		['sign'],
	);
}

/**
 * Import a SPKI-encoded PEM public key for RSASSA-PKCS1-v1_5 SHA-256 verification.
 */
export async function importPublicKey(pem: string): Promise<CryptoKey> {
	const keyData = parsePemKey(pem);
	return crypto.subtle.importKey(
		'spki',
		keyData,
		{
			name: 'RSASSA-PKCS1-v1_5',
			hash: { name: 'SHA-256' },
		},
		true,
		['verify'],
	);
}

// ============================================================
// SIGNING
// ============================================================

/**
 * Compute the SHA-256 digest of a body and return it in the
 * `SHA-256=base64(...)` format used by the Digest header.
 */
async function computeDigest(body: string): Promise<string> {
	const encoder = new TextEncoder();
	const data = encoder.encode(body);
	const hashBuffer = await crypto.subtle.digest('SHA-256', data);
	const hashBytes = new Uint8Array(hashBuffer);
	let binary = '';
	for (const byte of hashBytes) {
		binary += String.fromCharCode(byte);
	}
	return `SHA-256=${btoa(binary)}`;
}

/**
 * Sign an outgoing HTTP request for ActivityPub delivery.
 *
 * Builds a signing string from (request-target), host, date, digest
 * (when a body is present), and content-type. Signs with RSASSA-PKCS1-v1_5
 * SHA-256 and returns headers that should be merged into the fetch request.
 *
 * @param privateKeyPem - PKCS8 PEM-encoded RSA private key
 * @param keyId - The full key ID URI (e.g. https://domain/users/alice#main-key)
 * @param url - The target URL being requested
 * @param method - HTTP method (POST, GET, etc.)
 * @param body - Optional request body (typically JSON)
 * @param additionalHeaders - Extra headers to include in the signing string
 * @returns A record of headers to attach to the request
 */
export async function signRequest(
	privateKeyPem: string,
	keyId: string,
	url: string,
	method: string,
	body?: string,
	additionalHeaders?: Record<string, string>,
): Promise<Record<string, string>> {
	const privateKeyObj = await importPrivateKey(privateKeyPem);
	const request = new Request(url, {
		method,
		headers: { ...additionalHeaders, 'Date': new Date().toUTCString(), 'Host': new URL(url).host },
		body,
	});
	const signed = await fedifySignRequest(request, privateKeyObj, new URL(keyId), { spec: 'draft-cavage-http-signatures-12' });
	return Object.fromEntries(signed.headers.entries());
}

export async function verifySignature(
	request: Request,
	publicKeyPem: string,
	rawBody?: string,
): Promise<boolean> {
	try {
		const publicKeyObj = await importPublicKey(publicKeyPem);

		const clonedReq = new Request(request.url, {
			method: request.method,
			headers: request.headers,
			body: rawBody ?? await request.clone().text(),
		});

		const result = await fedifyVerifyRequest(clonedReq, {
			async documentLoader(url) {
				return { document: { id: url, type: 'Key', publicKeyPem }, documentUrl: url, contextUrl: null };
			}
		});

		return result !== null;
	} catch (err) {
		return false;
	}
}

export async function signRequestRFC9421(
	privateKeyPem: string,
	keyId: string,
	url: string,
	method: string,
	body?: string,
): Promise<Record<string, string>> {
	const privateKeyObj = await importPrivateKey(privateKeyPem);
	const request = new Request(url, {
		method,
		headers: { 'Date': new Date().toUTCString(), 'Host': new URL(url).host },
		body,
	});
	const signed = await fedifySignRequest(request, privateKeyObj, new URL(keyId), { spec: 'rfc9421' });
	return Object.fromEntries(signed.headers.entries());
}

export async function verifySignatureRFC9421(
	request: Request,
	publicKeyPem: string,
	rawBody?: string,
): Promise<boolean> {
	try {
		const publicKeyObj = await importPublicKey(publicKeyPem);

		const clonedReq = new Request(request.url, {
			method: request.method,
			headers: request.headers,
			body: rawBody ?? await request.clone().text(),
		});

		const result = await fedifyVerifyRequest(clonedReq, {
			async documentLoader(url) {
				return { document: { id: url, type: 'Key', publicKeyPem }, documentUrl: url, contextUrl: null };
			}
		});

		return result !== null;
	} catch (err) {
		return false;
	}
}



export function extractKeyIdFromSignatureInput(signatureInputHeader: string): string | null {
	const keyIdMatch = signatureInputHeader.match(/keyid="([^"]*)"/);
	return keyIdMatch?.[1] ?? null;
}
