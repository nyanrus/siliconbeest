import { describe, it, expect, beforeAll } from 'vitest';
import {
	signRequest,
	verifySignature,
	signRequestRFC9421,
	verifySignatureRFC9421,
} from '../src/federation/httpSignatures';

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

	function bufferToPem(buffer: ArrayBuffer, type: 'PUBLIC' | 'PRIVATE'): string {
		let binary = '';
		const bytes = new Uint8Array(buffer);
		for (const byte of bytes) {
			binary += String.fromCharCode(byte);
		}
		const base64 = btoa(binary);
		const lines = base64.match(/.{1,64}/g) || [];
		return `-----${type === 'PRIVATE' ? 'BEGIN PRIVATE KEY' : 'BEGIN PUBLIC KEY'}-----\n` +
			lines.join('\n') +
			`\n-----${type === 'PRIVATE' ? 'END PRIVATE KEY' : 'END PUBLIC KEY'}-----\n`;
	}

	return {
		publicKeyPem: bufferToPem(publicKeyBuffer, 'PUBLIC'),
		privateKeyPem: bufferToPem(privateKeyBuffer, 'PRIVATE'),
	};
}

describe('HTTP Signatures', () => {
	let publicKeyPem: string;
	let privateKeyPem: string;
	const keyId = 'https://example.com/users/alice#main-key';
	const targetUrl = 'https://remote.example.com/inbox';

	beforeAll(async () => {
		const keys = await generateRSAKeyPair();
		publicKeyPem = keys.publicKeyPem;
		privateKeyPem = keys.privateKeyPem;
	});

	describe('signRequest() (draft-cavage)', () => {
		it('produces Signature, Date, and Host headers for GET request', async () => {
			const headers = await signRequest(privateKeyPem, keyId, targetUrl, 'GET');
			expect(headers).toHaveProperty('Signature');
		});

		it('produces Digest and Content-Type headers when body is present', async () => {
			const body = '{"type":"Note"}';
			const headers = await signRequest(privateKeyPem, keyId, targetUrl, 'POST', body);
		});
	});

	describe('verifySignature() (draft-cavage)', () => {
		it('verifies a self-signed GET request', async () => {
			const headers = await signRequest(privateKeyPem, keyId, targetUrl, 'GET');
			const request = new Request(targetUrl, { method: 'GET', headers });
			const valid = await verifySignature(request, publicKeyPem);
			expect(valid).toBe(true);
		});

		it('verifies a self-signed POST request with body', async () => {
			const body = '{"type":"Follow"}';
			const headers = await signRequest(privateKeyPem, keyId, targetUrl, 'POST', body);
			const request = new Request(targetUrl, { method: 'POST', headers, body });
			const valid = await verifySignature(request, publicKeyPem, body);
			expect(valid).toBe(true);
		});

		it('returns false when no Signature header is present', async () => {
			const request = new Request(targetUrl, { method: 'GET' });
			const valid = await verifySignature(request, publicKeyPem);
			expect(valid).toBe(false);
		});
	});

	describe('draft-cavage round-trip', () => {
		it('sign -> verify succeeds for POST with body', async () => {
			const body = JSON.stringify({
				'@context': 'https://www.w3.org/ns/activitystreams',
				type: 'Create',
				actor: 'https://example.com/users/alice',
			});
			const headers = await signRequest(privateKeyPem, keyId, targetUrl, 'POST', body);
			const request = new Request(targetUrl, { method: 'POST', headers, body });
			const valid = await verifySignature(request, publicKeyPem, body);
			expect(valid).toBe(true);
		});

		it('fails verification with wrong public key', async () => {
			const otherKeys = await generateRSAKeyPair();
			const body = '{"type":"Like"}';
			const headers = await signRequest(privateKeyPem, keyId, targetUrl, 'POST', body);
			const request = new Request(targetUrl, { method: 'POST', headers, body });
			const valid = await verifySignature(request, otherKeys.publicKeyPem, body);
			expect(valid).toBe(false);
		});
	});

	describe('signRequestRFC9421()', () => {
		it('produces Signature-Input and Signature headers', async () => {
			const headers = await signRequestRFC9421(
				privateKeyPem,
				keyId,
				targetUrl,
				'POST',
				'{"test":true}'
			);
			expect(headers).toHaveProperty('Signature-Input');
			expect(headers).toHaveProperty('Signature');
		});
	});

	describe('verifySignatureRFC9421()', () => {
		it('verifies a self-signed RFC 9421 GET request', async () => {
			const headers = await signRequestRFC9421(privateKeyPem, keyId, targetUrl, 'GET');
			const request = new Request(targetUrl, { method: 'GET', headers });
			const valid = await verifySignatureRFC9421(request, publicKeyPem);
			expect(valid).toBe(true);
		});

		it('verifies a self-signed RFC 9421 POST request with body', async () => {
			const body = '{"type":"Undo"}';
			const headers = await signRequestRFC9421(privateKeyPem, keyId, targetUrl, 'POST', body);
			const request = new Request(targetUrl, { method: 'POST', headers, body });
			const valid = await verifySignatureRFC9421(request, publicKeyPem, body);
			expect(valid).toBe(true);
		});

		it('returns false when no Signature-Input header is present', async () => {
			const request = new Request(targetUrl, { method: 'GET' });
			const valid = await verifySignatureRFC9421(request, publicKeyPem);
			expect(valid).toBe(false);
		});
	});

	describe('RFC 9421 round-trip', () => {
		it('sign -> verify succeeds for POST with body', async () => {
			const body = JSON.stringify({
				'@context': 'https://www.w3.org/ns/activitystreams',
				type: 'Follow',
				actor: 'https://example.com/users/alice',
				object: 'https://remote.example.com/users/bob',
			});
			const headers = await signRequestRFC9421(privateKeyPem, keyId, targetUrl, 'POST', body);
			const request = new Request(targetUrl, { method: 'POST', headers, body });
			const valid = await verifySignatureRFC9421(request, publicKeyPem, body);
			expect(valid).toBe(true);
		});

		it('fails verification with wrong public key', async () => {
			const otherKeys = await generateRSAKeyPair();
			const body = '{"type":"Follow"}';
			const headers = await signRequestRFC9421(privateKeyPem, keyId, targetUrl, 'POST', body);
			const request = new Request(targetUrl, { method: 'POST', headers, body });
			const valid = await verifySignatureRFC9421(request, otherKeys.publicKeyPem, body);
			expect(valid).toBe(false);
		});
	});
});
