import { describe, it, expect, beforeAll } from 'vitest';
import { signLDSignature, verifyLDSignature } from '../src/federation/ldSignatures';
import type { APActivity } from '../src/types/activitypub';

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
	const lines: string[] = [];
	for (let i = 0; i < base64.length; i += 64) {
		lines.push(base64.slice(i, i + 64));
	}
	return lines.join('\n');
}

describe('Linked Data Signatures (RsaSignature2017)', () => {
	let publicKeyPem: string;
	let privateKeyPem: string;
	const keyId = 'https://example.com/users/alice#main-key';

	beforeAll(async () => {
		const keys = await generateRSAKeyPair();
		publicKeyPem = keys.publicKeyPem;
		privateKeyPem = keys.privateKeyPem;
	});

	// ---------------------------------------------------------------
	// Signing
	// ---------------------------------------------------------------
	describe('signLDSignature()', () => {
		it('returns activity with signature field', async () => {
			const activity: APActivity = {
				'@context': 'https://www.w3.org/ns/activitystreams',
				type: 'Create',
				actor: 'https://example.com/users/alice',
				object: 'https://example.com/users/alice/statuses/1',
			};

			const signed = await signLDSignature(activity, privateKeyPem, keyId);

			expect(signed.signature).toBeDefined();
			expect(signed.signature.type).toBe('RsaSignature2017');
			expect(signed.signature.creator).toBe(keyId);
			expect(signed.signature.created).toBeDefined();
			expect(signed.signature.signatureValue).toBeDefined();
			expect(typeof signed.signature.signatureValue).toBe('string');
			expect(signed.signature.signatureValue.length).toBeGreaterThan(0);
		});

		it('has correct signature field structure', async () => {
			const activity: APActivity = {
				type: 'Follow',
				actor: 'https://example.com/users/alice',
				object: 'https://remote.example.com/users/bob',
			};

			const signed = await signLDSignature(activity, privateKeyPem, keyId);

			// All required fields
			expect(signed.signature).toHaveProperty('type');
			expect(signed.signature).toHaveProperty('creator');
			expect(signed.signature).toHaveProperty('created');
			expect(signed.signature).toHaveProperty('signatureValue');
		});

		it('preserves original activity properties', async () => {
			const activity: APActivity = {
				'@context': 'https://www.w3.org/ns/activitystreams',
				id: 'https://example.com/activities/123',
				type: 'Create',
				actor: 'https://example.com/users/alice',
				object: 'https://example.com/notes/1',
				to: ['https://www.w3.org/ns/activitystreams#Public'],
			};

			const signed = await signLDSignature(activity, privateKeyPem, keyId);

			expect(signed.type).toBe('Create');
			expect(signed.actor).toBe('https://example.com/users/alice');
			expect(signed.id).toBe('https://example.com/activities/123');
			expect(signed.object).toBe('https://example.com/notes/1');
		});
	});

	// ---------------------------------------------------------------
	// Verification
	// ---------------------------------------------------------------
	describe('verifyLDSignature()', () => {
		it('verifies a self-signed activity', async () => {
			const activity: APActivity = {
				'@context': 'https://www.w3.org/ns/activitystreams',
				type: 'Create',
				actor: 'https://example.com/users/alice',
				object: 'https://example.com/notes/1',
			};

			const signed = await signLDSignature(activity, privateKeyPem, keyId);
			const valid = await verifyLDSignature(signed, publicKeyPem);
			expect(valid).toBe(true);
		});

		it('returns false when signature is missing', async () => {
			const activity: APActivity = {
				type: 'Create',
				actor: 'https://example.com/users/alice',
			};

			const valid = await verifyLDSignature(activity, publicKeyPem);
			expect(valid).toBe(false);
		});

		it('returns false for wrong signature type', async () => {
			const activity: APActivity = {
				type: 'Create',
				actor: 'https://example.com/users/alice',
				signature: {
					type: 'UnknownSignature',
					creator: keyId,
					created: new Date().toISOString(),
					signatureValue: 'fake',
				},
			};

			const valid = await verifyLDSignature(activity, publicKeyPem);
			expect(valid).toBe(false);
		});
	});

	// ---------------------------------------------------------------
	// Round-trip: sign -> verify
	// ---------------------------------------------------------------
	describe('round-trip sign -> verify', () => {
		it('succeeds for a Create activity', async () => {
			const activity: APActivity = {
				'@context': 'https://www.w3.org/ns/activitystreams',
				id: 'https://example.com/activities/456',
				type: 'Create',
				actor: 'https://example.com/users/alice',
				object: {
					type: 'Note',
					content: '<p>Hello from a signed activity!</p>',
				},
				to: ['https://www.w3.org/ns/activitystreams#Public'],
				cc: ['https://example.com/users/alice/followers'],
			};

			const signed = await signLDSignature(activity, privateKeyPem, keyId);
			const valid = await verifyLDSignature(signed, publicKeyPem);
			expect(valid).toBe(true);
		});

		it('succeeds for a Follow activity', async () => {
			const activity: APActivity = {
				'@context': 'https://www.w3.org/ns/activitystreams',
				type: 'Follow',
				actor: 'https://example.com/users/alice',
				object: 'https://remote.example.com/users/bob',
			};

			const signed = await signLDSignature(activity, privateKeyPem, keyId);
			const valid = await verifyLDSignature(signed, publicKeyPem);
			expect(valid).toBe(true);
		});

		it('fails when activity is modified after signing', async () => {
			const activity: APActivity = {
				'@context': 'https://www.w3.org/ns/activitystreams',
				type: 'Create',
				actor: 'https://example.com/users/alice',
				object: {
					type: 'Note',
					content: '<p>Original</p>',
				},
			};

			const signed = await signLDSignature(activity, privateKeyPem, keyId);

			// Tamper with the activity
			(signed as any).actor = 'https://evil.example.com/users/attacker';

			const valid = await verifyLDSignature(signed, publicKeyPem);
			expect(valid).toBe(false);
		});

		it('fails with wrong public key', async () => {
			const otherKeys = await generateRSAKeyPair();

			const activity: APActivity = {
				'@context': 'https://www.w3.org/ns/activitystreams',
				type: 'Create',
				actor: 'https://example.com/users/alice',
			};

			const signed = await signLDSignature(activity, privateKeyPem, keyId);
			const valid = await verifyLDSignature(signed, otherKeys.publicKeyPem);
			expect(valid).toBe(false);
		});
	});
});
