/**
 * Linked Data Signatures (queue consumer copy)
 *
 * Implements RsaSignature2017 signing for outgoing ActivityPub activities.
 * Uses Web Crypto API only.
 */

// ============================================================
// PEM HELPERS
// ============================================================

function parsePemKey(pem: string): ArrayBuffer {
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

async function importPrivateKey(pem: string): Promise<CryptoKey> {
	const keyData = parsePemKey(pem);
	return crypto.subtle.importKey(
		'pkcs8',
		keyData,
		{ name: 'RSASSA-PKCS1-v1_5', hash: { name: 'SHA-256' } },
		false,
		['sign'],
	);
}

// ============================================================
// HELPERS
// ============================================================

async function sha256(data: string): Promise<ArrayBuffer> {
	const encoder = new TextEncoder();
	return crypto.subtle.digest('SHA-256', encoder.encode(data));
}

function bufferToHex(buffer: ArrayBuffer): string {
	const bytes = new Uint8Array(buffer);
	let hex = '';
	for (const b of bytes) {
		hex += b.toString(16).padStart(2, '0');
	}
	return hex;
}

function bufferToBase64(buffer: ArrayBuffer): string {
	const bytes = new Uint8Array(buffer);
	let binary = '';
	for (const byte of bytes) {
		binary += String.fromCharCode(byte);
	}
	return btoa(binary);
}

function canonicalJson(obj: Record<string, unknown>): string {
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

export interface LDSignature {
	type: string;
	creator: string;
	created: string;
	signatureValue: string;
}

/**
 * Create a Linked Data Signature for an activity.
 * Returns a new activity object with the signature field added.
 */
export async function addLDSignature(
	activity: Record<string, unknown>,
	privateKeyPem: string,
	keyId: string,
): Promise<Record<string, unknown>> {
	const created = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

	// Hash options (without type, id, signatureValue)
	const optionsForHash: Record<string, unknown> = {
		'@context': 'https://w3id.org/identity/v1',
		creator: keyId,
		created,
	};
	const optionsHash = await sha256(canonicalJson(optionsForHash));

	// Hash document (without signature)
	const activityCopy: Record<string, unknown> = { ...activity };
	delete activityCopy.signature;
	const documentHash = await sha256(canonicalJson(activityCopy));

	// Concatenate hashes
	const combined = bufferToHex(optionsHash) + bufferToHex(documentHash);

	// Sign
	const privateKey = await importPrivateKey(privateKeyPem);
	const encoder = new TextEncoder();
	const signatureBuffer = await crypto.subtle.sign(
		'RSASSA-PKCS1-v1_5',
		privateKey,
		encoder.encode(combined),
	);

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
