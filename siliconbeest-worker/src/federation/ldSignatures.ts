import { signJsonLd, verifyJsonLd } from '@fedify/fedify';
/**
 * Linked Data Signatures for ActivityPub
 *
 * Implements RsaSignature2017 for signing and verifying ActivityPub
 * activities. This is the older standard still used by many Mastodon
 * and compatible implementations for relay and forwarding scenarios.
 *
 * The signature is embedded in the activity as a `signature` field:
 * {
 *   "signature": {
 *     "type": "RsaSignature2017",
 *     "creator": "https://domain/users/username#main-key",
 *     "created": "2024-01-01T00:00:00Z",
 *     "signatureValue": "BASE64..."
 *   }
 * }
 *
 * Process:
 * 1. Create signature options object with context, creator, created, type
 * 2. Hash the options (without type, id, signatureValue) with SHA-256
 * 3. Hash the activity document (without signature field) with SHA-256
 * 4. Concatenate the two hashes
 * 5. Sign with RSA private key (RSASSA-PKCS1-v1_5 SHA-256)
 * 6. Base64-encode the result
 *
 * Uses Web Crypto API only (no node:crypto).
 */

import { importPrivateKey, importPublicKey } from './httpSignatures';
import type { APActivity, APSignature } from '../types/activitypub';

// ============================================================
// HELPERS
// ============================================================

/**
 * Compute the SHA-256 hash of a string, returning raw bytes.
 */
async function sha256(data: string): Promise<ArrayBuffer> {
	const encoder = new TextEncoder();
	return crypto.subtle.digest('SHA-256', encoder.encode(data));
}

/**
 * Convert an ArrayBuffer to a hex string.
 */
function bufferToHex(buffer: ArrayBuffer): string {
	const bytes = new Uint8Array(buffer);
	let hex = '';
	for (const b of bytes) {
		hex += b.toString(16).padStart(2, '0');
	}
	return hex;
}

/**
 * Base64 encode an ArrayBuffer.
 */
function bufferToBase64(buffer: ArrayBuffer): string {
	const bytes = new Uint8Array(buffer);
	let binary = '';
	for (const byte of bytes) {
		binary += String.fromCharCode(byte);
	}
	return btoa(binary);
}

/**
 * Base64 decode a string to an ArrayBuffer.
 */
function base64ToBuffer(b64: string): ArrayBuffer {
	const binary = atob(b64);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) {
		bytes[i] = binary.charCodeAt(i);
	}
	return bytes.buffer;
}

/**
 * Normalize an object for hashing by producing a canonical JSON string.
 * This is a simplified canonicalization — for full JSON-LD canonicalization
 * you would need a complete JSON-LD processor. This follows the approach
 * used by Mastodon and most ActivityPub implementations.
 */
function canonicalJson(obj: Record<string, unknown>): string {
	// Sort keys and produce stable JSON
	const sortedKeys = Object.keys(obj).sort();
	const sorted: Record<string, unknown> = {};
	for (const key of sortedKeys) {
		sorted[key] = obj[key];
	}
	return JSON.stringify(sorted);
}

// ============================================================
// SIGNING
// ============================================================

/**
 * Create a Linked Data Signature for an ActivityPub activity.
 *
 * @param activity - The activity to sign (will not be mutated)
 * @param privateKeyPem - PKCS8 PEM-encoded RSA private key
 * @param keyId - The key ID URI (e.g. https://domain/users/alice#main-key)
 * @returns The activity with the signature field added
 */
export async function signLDSignature(
	activity: APActivity,
	privateKeyPem: string,
	keyId: string,
): Promise<APActivity & { signature: APSignature }> {
	const created = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

	// Step 1: Create the signature options object
	const signatureOptions = {
		'@context': 'https://w3id.org/identity/v1',
		creator: keyId,
		created,
		type: 'RsaSignature2017',
	};

	// Step 2: Hash the options (without type, id, signatureValue)
	const optionsForHash: Record<string, unknown> = {
		'@context': signatureOptions['@context'],
		creator: signatureOptions.creator,
		created: signatureOptions.created,
	};
	const optionsHash = await sha256(canonicalJson(optionsForHash));

	// Step 3: Hash the activity document (without signature field)
	const activityCopy: Record<string, unknown> = { ...activity };
	delete activityCopy.signature;
	const documentHash = await sha256(canonicalJson(activityCopy));

	// Step 4: Concatenate the two hashes
	const optionsHex = bufferToHex(optionsHash);
	const documentHex = bufferToHex(documentHash);
	const combined = optionsHex + documentHex;

	// Step 5: Sign with RSA private key
	const privateKey = await importPrivateKey(privateKeyPem);
	const encoder = new TextEncoder();
	const signatureBuffer = await crypto.subtle.sign(
		'RSASSA-PKCS1-v1_5',
		privateKey,
		encoder.encode(combined),
	);

	// Step 6: Base64-encode
	const signatureValue = bufferToBase64(signatureBuffer);

	return {
		...activity,
		signature: {
			type: 'RsaSignature2017',
			creator: keyId,
			created,
			signatureValue,
		},
	};
}

export async function verifyLDSignature(
	activity: APActivity,
	publicKeyPem: string,
): Promise<boolean> {
	const sig = activity.signature;
	if (!sig || sig.type !== 'RsaSignature2017') {
		return false;
	}

	try {
		// Step 2: Hash the options (without type, id, signatureValue)
		const optionsForHash: Record<string, unknown> = {
			'@context': 'https://w3id.org/identity/v1',
			creator: sig.creator,
			created: sig.created,
		};
		const optionsHash = await sha256(canonicalJson(optionsForHash));

		// Step 3: Hash the activity document (without signature field)
		const activityCopy: Record<string, unknown> = { ...activity };
		delete activityCopy.signature;
		const documentHash = await sha256(canonicalJson(activityCopy));

		// Step 4: Concatenate
		const optionsHex = bufferToHex(optionsHash);
		const documentHex = bufferToHex(documentHash);
		const combined = optionsHex + documentHex;

		// Step 5: Verify with RSA public key
		const publicKey = await importPublicKey(publicKeyPem);
		const encoder = new TextEncoder();
		const signatureBytes = base64ToBuffer(sig.signatureValue);

		return crypto.subtle.verify(
			'RSASSA-PKCS1-v1_5',
			publicKey,
			signatureBytes,
			encoder.encode(combined),
		);
	} catch (err) {
		console.error('[ld-signature] Verification error:', err);
		return false;
	}
}
