import { describe, it, expect, beforeAll } from 'vitest';
import { jcsCanonicalize, createProof, verifyProof } from '../src/federation/integrityProofs';
import {
	generateEd25519KeyPair,
	encodeEd25519PublicKeyMultibase,
} from '../src/utils/crypto';

describe('Object Integrity Proofs (FEP-8b32)', () => {
	let ed25519PublicKey: string; // base64url
	let ed25519PrivateKey: string; // base64url
	let publicKeyMultibase: string; // z6Mk...
	const keyId = 'https://example.com/users/alice#ed25519-key';

	beforeAll(async () => {
		const keys = await generateEd25519KeyPair();
		ed25519PublicKey = keys.publicKey;
		ed25519PrivateKey = keys.privateKey;
		publicKeyMultibase = encodeEd25519PublicKeyMultibase(ed25519PublicKey);
	});

	// ---------------------------------------------------------------
	// JCS Canonicalization
	// ---------------------------------------------------------------
	describe('jcsCanonicalize()', () => {
		it('sorts object keys lexicographically', () => {
			const result = jcsCanonicalize({ z: 1, a: 2, m: 3 });
			expect(result).toBe('{"a":2,"m":3,"z":1}');
		});

		it('handles nested objects with sorted keys', () => {
			const result = jcsCanonicalize({ b: { z: 1, a: 2 }, a: 'hello' });
			expect(result).toBe('{"a":"hello","b":{"a":2,"z":1}}');
		});

		it('handles arrays without reordering', () => {
			const result = jcsCanonicalize([3, 1, 2]);
			expect(result).toBe('[3,1,2]');
		});

		it('serializes null as "null"', () => {
			expect(jcsCanonicalize(null)).toBe('null');
		});

		it('serializes booleans', () => {
			expect(jcsCanonicalize(true)).toBe('true');
			expect(jcsCanonicalize(false)).toBe('false');
		});

		it('escapes special characters in strings', () => {
			const result = jcsCanonicalize('hello\nworld');
			expect(result).toBe('"hello\\nworld"');
		});

		it('escapes backslash and quote', () => {
			const result = jcsCanonicalize('a"b\\c');
			expect(result).toBe('"a\\"b\\\\c"');
		});

		it('escapes control characters', () => {
			const result = jcsCanonicalize('\t\r\n');
			expect(result).toBe('"\\t\\r\\n"');
		});

		it('omits undefined values in objects', () => {
			const result = jcsCanonicalize({ a: 1, b: undefined, c: 3 });
			expect(result).toBe('{"a":1,"c":3}');
		});

		it('produces no whitespace', () => {
			const result = jcsCanonicalize({ key: [1, 2, { nested: true }] });
			expect(result).not.toContain(' ');
		});
	});

	// ---------------------------------------------------------------
	// Proof creation
	// ---------------------------------------------------------------
	describe('createProof()', () => {
		it('returns activity with valid proof object', async () => {
			const activity = {
				'@context': 'https://www.w3.org/ns/activitystreams',
				type: 'Create',
				actor: 'https://example.com/users/alice',
				object: {
					type: 'Note',
					content: 'Hello world',
				},
			};

			const result = await createProof(activity, ed25519PrivateKey, keyId);

			expect(result.proof).toBeDefined();
			const proof = result.proof as Record<string, unknown>;
			expect(proof.type).toBe('DataIntegrityProof');
			expect(proof.cryptosuite).toBe('eddsa-jcs-2022');
			expect(proof.verificationMethod).toBe(keyId);
			expect(proof.proofPurpose).toBe('assertionMethod');
			expect(proof.proofValue).toBeDefined();
			expect(typeof proof.proofValue).toBe('string');
			expect((proof.proofValue as string).startsWith('z')).toBe(true);
			expect(proof.created).toBeDefined();
		});

		it('has all required proof fields', async () => {
			const activity = {
				'@context': 'https://www.w3.org/ns/activitystreams',
				type: 'Follow',
				actor: 'https://example.com/users/alice',
				object: 'https://remote.example.com/users/bob',
			};

			const result = await createProof(activity, ed25519PrivateKey, keyId);
			const proof = result.proof as Record<string, unknown>;

			// All 6 required fields
			expect(proof).toHaveProperty('type');
			expect(proof).toHaveProperty('cryptosuite');
			expect(proof).toHaveProperty('verificationMethod');
			expect(proof).toHaveProperty('proofPurpose');
			expect(proof).toHaveProperty('proofValue');
			expect(proof).toHaveProperty('created');
		});

		it('adds Data Integrity context to @context array', async () => {
			const activity = {
				'@context': 'https://www.w3.org/ns/activitystreams',
				type: 'Create',
				actor: 'https://example.com/users/alice',
			};

			const result = await createProof(activity, ed25519PrivateKey, keyId);
			const ctx = result['@context'];
			expect(Array.isArray(ctx)).toBe(true);
			expect(ctx).toContain('https://w3id.org/security/data-integrity/v1');
		});

		it('preserves existing @context entries', async () => {
			const activity = {
				'@context': [
					'https://www.w3.org/ns/activitystreams',
					'https://w3id.org/security/v1',
				],
				type: 'Create',
				actor: 'https://example.com/users/alice',
			};

			const result = await createProof(activity, ed25519PrivateKey, keyId);
			const ctx = result['@context'] as string[];
			expect(ctx).toContain('https://www.w3.org/ns/activitystreams');
			expect(ctx).toContain('https://w3id.org/security/v1');
			expect(ctx).toContain('https://w3id.org/security/data-integrity/v1');
		});
	});

	// ---------------------------------------------------------------
	// Proof verification
	// ---------------------------------------------------------------
	describe('verifyProof()', () => {
		it('verifies a proof created by createProof', async () => {
			// Include the DI context upfront so createProof doesn't modify @context after signing
			const activity = {
				'@context': [
					'https://www.w3.org/ns/activitystreams',
					'https://w3id.org/security/data-integrity/v1',
				],
				type: 'Create',
				actor: 'https://example.com/users/alice',
				object: {
					type: 'Note',
					content: 'Test note',
				},
			};

			const signed = await createProof(activity, ed25519PrivateKey, keyId);
			const valid = await verifyProof(signed, publicKeyMultibase);
			expect(valid).toBe(true);
		});

		it('returns false when proof is missing', async () => {
			const activity = {
				type: 'Create',
				actor: 'https://example.com/users/alice',
			};

			const valid = await verifyProof(activity, publicKeyMultibase);
			expect(valid).toBe(false);
		});

		it('returns false for wrong cryptosuite', async () => {
			const activity = {
				type: 'Create',
				actor: 'https://example.com/users/alice',
				proof: {
					type: 'DataIntegrityProof',
					cryptosuite: 'unknown-suite',
					verificationMethod: keyId,
					proofPurpose: 'assertionMethod',
					proofValue: 'zFakeValue',
					created: new Date().toISOString(),
				},
			};

			const valid = await verifyProof(activity, publicKeyMultibase);
			expect(valid).toBe(false);
		});
	});

	// ---------------------------------------------------------------
	// Round-trip: create -> verify
	// ---------------------------------------------------------------
	describe('round-trip create -> verify', () => {
		it('succeeds with matching keys', async () => {
			// Include the DI context upfront so createProof doesn't modify @context after signing
			const activity = {
				'@context': [
					'https://www.w3.org/ns/activitystreams',
					'https://w3id.org/security/data-integrity/v1',
				],
				id: 'https://example.com/activities/123',
				type: 'Create',
				actor: 'https://example.com/users/alice',
				object: {
					type: 'Note',
					content: 'This is a test of Data Integrity Proofs',
					to: ['https://www.w3.org/ns/activitystreams#Public'],
				},
			};

			const signed = await createProof(activity, ed25519PrivateKey, keyId);
			const valid = await verifyProof(signed, publicKeyMultibase);
			expect(valid).toBe(true);
		});

		it('fails when activity is modified after proof', async () => {
			const activity = {
				'@context': [
					'https://www.w3.org/ns/activitystreams',
					'https://w3id.org/security/data-integrity/v1',
				],
				type: 'Create',
				actor: 'https://example.com/users/alice',
				object: {
					type: 'Note',
					content: 'Original content',
				},
			};

			const signed = await createProof(activity, ed25519PrivateKey, keyId);

			// Tamper with the activity after signing
			(signed.object as Record<string, unknown>).content = 'Tampered content';

			const valid = await verifyProof(signed, publicKeyMultibase);
			expect(valid).toBe(false);
		});

		it('fails with wrong public key', async () => {
			const otherKeys = await generateEd25519KeyPair();
			const otherMultibase = encodeEd25519PublicKeyMultibase(otherKeys.publicKey);

			const activity = {
				'@context': [
					'https://www.w3.org/ns/activitystreams',
					'https://w3id.org/security/data-integrity/v1',
				],
				type: 'Create',
				actor: 'https://example.com/users/alice',
			};

			const signed = await createProof(activity, ed25519PrivateKey, keyId);
			const valid = await verifyProof(signed, otherMultibase);
			expect(valid).toBe(false);
		});
	});
});
