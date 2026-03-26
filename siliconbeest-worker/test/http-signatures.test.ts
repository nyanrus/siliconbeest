import { describe, it, expect, beforeAll } from 'vitest';
import {
	signRequest,
	verifySignature,
	signRequestRFC9421,
	verifySignatureRFC9421,
	computeContentDigest,
} from '../src/federation/httpSignatures';

/**
 * Generate an RSA keypair for testing and export as PEM strings.
 */
async function generateRSAKeyPair(): Promise<{ publicKeyPem: string; privateKeyPem: string }> {
	const keyPair = await crypto.subtle.generateKey(
		{
			name: 'RSASSA-PKCS1-v1_5',
			modulusLength: 2048,
			publicExponent: new Uint8Array([1, 0, 1]),
			hash: { name: 'SHA-256' },
		},
		true,
		['sign', 'verify'],
	);

	const publicKeyBuffer = await crypto.subtle.exportKey('spki', keyPair.publicKey);
	const privateKeyBuffer = await crypto.subtle.exportKey('pkcs8', keyPair.privateKey);

	const publicKeyPem = `-----BEGIN PUBLIC KEY-----\n${arrayBufferToBase64Lines(publicKeyBuffer)}\n-----END PUBLIC KEY-----`;
	const privateKeyPem = `-----BEGIN PRIVATE KEY-----\n${arrayBufferToBase64Lines(privateKeyBuffer)}\n-----END PRIVATE KEY-----`;

	return { publicKeyPem, privateKeyPem };
}

function arrayBufferToBase64Lines(buffer: ArrayBuffer): string {
	const bytes = new Uint8Array(buffer);
	let binary = '';
	for (const byte of bytes) {
		binary += String.fromCharCode(byte);
	}
	const base64 = btoa(binary);
	// Split into 64-char lines
	const lines: string[] = [];
	for (let i = 0; i < base64.length; i += 64) {
		lines.push(base64.slice(i, i + 64));
	}
	return lines.join('\n');
}

describe('HTTP Signatures', () => {
	let publicKeyPem: string;
	let privateKeyPem: string;
	const keyId = 'https://example.com/users/alice#main-key';
	const targetUrl = 'https://remote.example.com/users/bob/inbox';

	beforeAll(async () => {
		const keys = await generateRSAKeyPair();
		publicKeyPem = keys.publicKeyPem;
		privateKeyPem = keys.privateKeyPem;
	});

	// ---------------------------------------------------------------
	// draft-cavage signing
	// ---------------------------------------------------------------
	describe('signRequest() (draft-cavage)', () => {
		it('produces Signature, Date, and Host headers for GET request', async () => {
			const headers = await signRequest(
				privateKeyPem,
				keyId,
				targetUrl,
				'GET',
			);

			expect(headers).toHaveProperty('Signature');
			expect(headers).toHaveProperty('Date');
			expect(headers).toHaveProperty('Host');
			expect(headers.Host).toBe('remote.example.com');
			expect(headers.Signature).toContain('keyId="');
			expect(headers.Signature).toContain('algorithm="rsa-sha256"');
			expect(headers.Signature).toContain('headers="');
			expect(headers.Signature).toContain('signature="');
		});

		it('produces Digest and Content-Type headers when body is present', async () => {
			const body = JSON.stringify({ type: 'Follow', actor: 'https://example.com/users/alice' });
			const headers = await signRequest(
				privateKeyPem,
				keyId,
				targetUrl,
				'POST',
				body,
			);

			expect(headers).toHaveProperty('Digest');
			expect(headers.Digest).toMatch(/^SHA-256=.+$/);
			expect(headers['Content-Type']).toBe('application/activity+json');
			expect(headers.Signature).toContain('digest');
			expect(headers.Signature).toContain('content-type');
		});

		it('includes (request-target), host, and date in signed headers', async () => {
			const headers = await signRequest(
				privateKeyPem,
				keyId,
				targetUrl,
				'POST',
				'{"test":true}',
			);

			expect(headers.Signature).toContain('headers="(request-target) host date');
		});
	});

	// ---------------------------------------------------------------
	// draft-cavage verification
	// ---------------------------------------------------------------
	describe('verifySignature() (draft-cavage)', () => {
		it('verifies a self-signed GET request', async () => {
			const headers = await signRequest(
				privateKeyPem,
				keyId,
				targetUrl,
				'GET',
			);

			const request = new Request(targetUrl, {
				method: 'GET',
				headers,
			});

			const valid = await verifySignature(request, publicKeyPem);
			expect(valid).toBe(true);
		});

		it('verifies a self-signed POST request with body', async () => {
			const body = JSON.stringify({ type: 'Create', actor: 'https://example.com/users/alice' });
			const headers = await signRequest(
				privateKeyPem,
				keyId,
				targetUrl,
				'POST',
				body,
			);

			const request = new Request(targetUrl, {
				method: 'POST',
				headers,
				body,
			});

			const valid = await verifySignature(request, publicKeyPem, body);
			expect(valid).toBe(true);
		});

		it('returns false when no Signature header is present', async () => {
			const request = new Request(targetUrl, { method: 'GET' });
			const valid = await verifySignature(request, publicKeyPem);
			expect(valid).toBe(false);
		});
	});

	// ---------------------------------------------------------------
	// Round-trip: sign with cavage -> verify with cavage
	// ---------------------------------------------------------------
	describe('draft-cavage round-trip', () => {
		it('sign -> verify succeeds for POST with body', async () => {
			const body = JSON.stringify({
				'@context': 'https://www.w3.org/ns/activitystreams',
				type: 'Follow',
				actor: 'https://example.com/users/alice',
				object: 'https://remote.example.com/users/bob',
			});

			const headers = await signRequest(
				privateKeyPem,
				keyId,
				targetUrl,
				'POST',
				body,
			);

			const request = new Request(targetUrl, {
				method: 'POST',
				headers,
				body,
			});

			const valid = await verifySignature(request, publicKeyPem, body);
			expect(valid).toBe(true);
		});

		it('fails verification with wrong public key', async () => {
			const otherKeys = await generateRSAKeyPair();
			const body = '{"type":"Follow"}';

			const headers = await signRequest(
				privateKeyPem,
				keyId,
				targetUrl,
				'POST',
				body,
			);

			const request = new Request(targetUrl, {
				method: 'POST',
				headers,
				body,
			});

			const valid = await verifySignature(request, otherKeys.publicKeyPem, body);
			expect(valid).toBe(false);
		});
	});

	// ---------------------------------------------------------------
	// computeContentDigest (RFC 9530)
	// ---------------------------------------------------------------
	describe('computeContentDigest()', () => {
		it('returns sha-256=:BASE64: format', async () => {
			const digest = await computeContentDigest('hello world');
			expect(digest).toMatch(/^sha-256=:.+:$/);
		});

		it('produces consistent digests for the same input', async () => {
			const d1 = await computeContentDigest('test body');
			const d2 = await computeContentDigest('test body');
			expect(d1).toBe(d2);
		});

		it('produces different digests for different inputs', async () => {
			const d1 = await computeContentDigest('body1');
			const d2 = await computeContentDigest('body2');
			expect(d1).not.toBe(d2);
		});
	});

	// ---------------------------------------------------------------
	// RFC 9421 signing
	// ---------------------------------------------------------------
	describe('signRequestRFC9421()', () => {
		it('produces Signature-Input and Signature headers', async () => {
			const headers = await signRequestRFC9421(
				privateKeyPem,
				keyId,
				targetUrl,
				'POST',
				'{"test":true}',
			);

			expect(headers).toHaveProperty('Signature-Input');
			expect(headers).toHaveProperty('Signature');
			expect(headers['Signature-Input']).toContain('sig1=');
			expect(headers['Signature-Input']).toContain(`keyid="${keyId}"`);
			expect(headers['Signature-Input']).toContain('alg="rsa-v1_5-sha256"');
			expect(headers.Signature).toMatch(/^sig1=:.+:$/);
		});

		it('includes Content-Digest when body is provided', async () => {
			const headers = await signRequestRFC9421(
				privateKeyPem,
				keyId,
				targetUrl,
				'POST',
				'{"test":true}',
			);

			expect(headers).toHaveProperty('Content-Digest');
			expect(headers['Content-Digest']).toMatch(/^sha-256=:.+:$/);
			expect(headers['Signature-Input']).toContain('"content-digest"');
			expect(headers['Signature-Input']).toContain('"content-type"');
		});

		it('includes @method, @target-uri, and @authority components', async () => {
			const headers = await signRequestRFC9421(
				privateKeyPem,
				keyId,
				targetUrl,
				'GET',
			);

			expect(headers['Signature-Input']).toContain('"@method"');
			expect(headers['Signature-Input']).toContain('"@target-uri"');
			expect(headers['Signature-Input']).toContain('"@authority"');
		});
	});

	// ---------------------------------------------------------------
	// RFC 9421 verification
	// ---------------------------------------------------------------
	describe('verifySignatureRFC9421()', () => {
		it('verifies a self-signed RFC 9421 GET request', async () => {
			const headers = await signRequestRFC9421(
				privateKeyPem,
				keyId,
				targetUrl,
				'GET',
			);

			const request = new Request(targetUrl, {
				method: 'GET',
				headers,
			});

			const valid = await verifySignatureRFC9421(request, publicKeyPem);
			expect(valid).toBe(true);
		});

		it('verifies a self-signed RFC 9421 POST request with body', async () => {
			const body = JSON.stringify({ type: 'Create', actor: 'https://example.com/users/alice' });
			const headers = await signRequestRFC9421(
				privateKeyPem,
				keyId,
				targetUrl,
				'POST',
				body,
			);

			const request = new Request(targetUrl, {
				method: 'POST',
				headers,
				body,
			});

			const valid = await verifySignatureRFC9421(request, publicKeyPem, body);
			expect(valid).toBe(true);
		});

		it('returns false when no Signature-Input header is present', async () => {
			const request = new Request(targetUrl, { method: 'GET' });
			const valid = await verifySignatureRFC9421(request, publicKeyPem);
			expect(valid).toBe(false);
		});
	});

	// ---------------------------------------------------------------
	// Round-trip: sign with RFC 9421 -> verify with RFC 9421
	// ---------------------------------------------------------------
	describe('RFC 9421 round-trip', () => {
		it('sign -> verify succeeds for POST with body', async () => {
			const body = JSON.stringify({
				'@context': 'https://www.w3.org/ns/activitystreams',
				type: 'Follow',
				actor: 'https://example.com/users/alice',
				object: 'https://remote.example.com/users/bob',
			});

			const headers = await signRequestRFC9421(
				privateKeyPem,
				keyId,
				targetUrl,
				'POST',
				body,
			);

			const request = new Request(targetUrl, {
				method: 'POST',
				headers,
				body,
			});

			const valid = await verifySignatureRFC9421(request, publicKeyPem, body);
			expect(valid).toBe(true);
		});

		it('fails verification with wrong public key', async () => {
			const otherKeys = await generateRSAKeyPair();
			const body = '{"type":"Follow"}';

			const headers = await signRequestRFC9421(
				privateKeyPem,
				keyId,
				targetUrl,
				'POST',
				body,
			);

			const request = new Request(targetUrl, {
				method: 'POST',
				headers,
				body,
			});

			const valid = await verifySignatureRFC9421(request, otherKeys.publicKeyPem, body);
			expect(valid).toBe(false);
		});
	});
});
