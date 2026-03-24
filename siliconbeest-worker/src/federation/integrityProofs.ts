/**
 * Object Integrity Proofs (FEP-8b32)
 *
 * Implements the eddsa-jcs-2022 cryptosuite for creating and verifying
 * Data Integrity Proofs on ActivityPub activities using Ed25519 keys.
 *
 * References:
 * - FEP-8b32: https://codeberg.org/fediverse/fep/src/branch/main/fep/8b32/fep-8b32.md
 * - Data Integrity: https://www.w3.org/TR/vc-data-integrity/
 * - JCS (RFC 8785): JSON Canonicalization Scheme
 */

import {
	importEd25519PrivateKey,
	importEd25519PublicKey,
	ed25519Sign,
	ed25519Verify,
	sha256Bytes,
	base58btcEncode,
	base58btcDecode,
	decodeEd25519PublicKeyMultibase,
	base64UrlToBytes,
} from '../utils/crypto';

// ============================================================
// JCS (JSON Canonicalization Scheme - RFC 8785)
// ============================================================

/**
 * Canonicalize a JSON value according to RFC 8785 (JCS).
 *
 * Rules:
 * - Object keys are sorted lexicographically by Unicode code points
 * - Numbers use ES6 serialization (no trailing zeros, etc.)
 * - Strings use minimal escaping (only required characters)
 * - No whitespace between tokens
 * - null, true, false are literals
 */
export function jcsCanonicalize(value: unknown): string {
	if (value === null || value === undefined) {
		return 'null';
	}

	if (typeof value === 'boolean') {
		return value ? 'true' : 'false';
	}

	if (typeof value === 'number') {
		if (!isFinite(value)) {
			throw new Error('JCS does not support Infinity or NaN');
		}
		// ES6 number serialization (JSON.stringify handles this correctly)
		return JSON.stringify(value);
	}

	if (typeof value === 'string') {
		return jcsSerializeString(value);
	}

	if (Array.isArray(value)) {
		const elements = value.map((item) => jcsCanonicalize(item));
		return `[${elements.join(',')}]`;
	}

	if (typeof value === 'object') {
		const obj = value as Record<string, unknown>;
		const keys = Object.keys(obj).sort();
		const members: string[] = [];
		for (const key of keys) {
			if (obj[key] === undefined) continue;
			members.push(`${jcsSerializeString(key)}:${jcsCanonicalize(obj[key])}`);
		}
		return `{${members.join(',')}}`;
	}

	throw new Error(`JCS: unsupported type ${typeof value}`);
}

/**
 * Serialize a string value per JCS / RFC 8785 requirements.
 * Only the required characters are escaped: ", \, and control characters (U+0000..U+001F).
 */
function jcsSerializeString(str: string): string {
	let result = '"';
	for (let i = 0; i < str.length; i++) {
		const code = str.charCodeAt(i);
		if (code === 0x08) {
			result += '\\b';
		} else if (code === 0x09) {
			result += '\\t';
		} else if (code === 0x0a) {
			result += '\\n';
		} else if (code === 0x0c) {
			result += '\\f';
		} else if (code === 0x0d) {
			result += '\\r';
		} else if (code === 0x22) {
			result += '\\"';
		} else if (code === 0x5c) {
			result += '\\\\';
		} else if (code < 0x20) {
			result += `\\u${code.toString(16).padStart(4, '0')}`;
		} else {
			result += str[i];
		}
	}
	result += '"';
	return result;
}

// ============================================================
// PROOF CREATION
// ============================================================

export interface DataIntegrityProof {
	type: 'DataIntegrityProof';
	cryptosuite: 'eddsa-jcs-2022';
	verificationMethod: string;
	proofPurpose: 'assertionMethod';
	proofValue: string;
	created: string;
}

/**
 * Create a Data Integrity Proof for an ActivityPub activity.
 *
 * Process (eddsa-jcs-2022):
 * 1. JCS canonicalize the proof options (without proofValue)
 * 2. SHA-256 hash the canonicalized proof options
 * 3. JCS canonicalize the activity document (without proof)
 * 4. SHA-256 hash the canonicalized document
 * 5. Concatenate the two hashes (proof hash + document hash)
 * 6. Sign with Ed25519 private key
 * 7. Base58btc encode the signature with 'z' prefix
 *
 * @param activity - The activity object (proof field will be removed before signing)
 * @param ed25519PrivateKeyBase64url - The Ed25519 private key in base64url format
 * @param keyId - The verification method ID (e.g. "https://domain/users/username#ed25519-key")
 * @returns The activity object with `proof` attached
 */
export async function createProof(
	activity: Record<string, unknown>,
	ed25519PrivateKeyBase64url: string,
	keyId: string,
): Promise<Record<string, unknown>> {
	const now = new Date().toISOString();

	// Build proof options (without proofValue)
	const proofOptions = {
		type: 'DataIntegrityProof',
		cryptosuite: 'eddsa-jcs-2022',
		verificationMethod: keyId,
		proofPurpose: 'assertionMethod',
		created: now,
	};

	// 1. JCS canonicalize proof options
	const canonicalProofOptions = jcsCanonicalize(proofOptions);

	// 2. SHA-256 hash the proof options
	const encoder = new TextEncoder();
	const proofOptionsHash = await sha256Bytes(encoder.encode(canonicalProofOptions));

	// 3. JCS canonicalize the document (without proof field)
	const documentWithoutProof = { ...activity };
	delete documentWithoutProof.proof;
	const canonicalDocument = jcsCanonicalize(documentWithoutProof);

	// 4. SHA-256 hash the document
	const documentHash = await sha256Bytes(encoder.encode(canonicalDocument));

	// 5. Concatenate hashes (proof options hash + document hash)
	const combined = new Uint8Array(proofOptionsHash.length + documentHash.length);
	combined.set(proofOptionsHash, 0);
	combined.set(documentHash, proofOptionsHash.length);

	// 6. Sign with Ed25519
	const privateKey = await importEd25519PrivateKey(ed25519PrivateKeyBase64url);
	const signature = await ed25519Sign(privateKey, combined);

	// 7. Base58btc encode with 'z' prefix
	const proofValue = 'z' + base58btcEncode(signature);

	// Attach proof to activity
	const result: Record<string, unknown> = {
		...activity,
		proof: {
			...proofOptions,
			proofValue,
		} as DataIntegrityProof,
	};

	// Ensure @context includes Data Integrity context
	const diContext = 'https://w3id.org/security/data-integrity/v1';
	const ctx = result['@context'];
	if (Array.isArray(ctx)) {
		if (!ctx.includes(diContext)) {
			result['@context'] = [...ctx, diContext];
		}
	} else if (typeof ctx === 'string') {
		result['@context'] = [ctx, diContext];
	} else {
		result['@context'] = [diContext];
	}

	return result;
}

// ============================================================
// PROOF VERIFICATION
// ============================================================

/**
 * Verify a Data Integrity Proof on an incoming ActivityPub activity.
 *
 * @param activity - The activity object with `proof` attached
 * @param publicKeyMultibase - The multibase-encoded Ed25519 public key (e.g. "z6Mk...")
 * @returns true if the proof is valid, false otherwise
 */
export async function verifyProof(
	activity: Record<string, unknown>,
	publicKeyMultibase: string,
): Promise<boolean> {
	const proof = activity.proof as DataIntegrityProof | undefined;
	if (!proof) {
		return false;
	}

	if (proof.type !== 'DataIntegrityProof' || proof.cryptosuite !== 'eddsa-jcs-2022') {
		return false;
	}

	if (!proof.proofValue || !proof.proofValue.startsWith('z')) {
		return false;
	}

	try {
		// Reconstruct proof options (without proofValue)
		const proofOptions: Record<string, unknown> = {
			type: proof.type,
			cryptosuite: proof.cryptosuite,
			verificationMethod: proof.verificationMethod,
			proofPurpose: proof.proofPurpose,
			created: proof.created,
		};

		// 1-2. Hash proof options
		const canonicalProofOptions = jcsCanonicalize(proofOptions);
		const encoder = new TextEncoder();
		const proofOptionsHash = await sha256Bytes(encoder.encode(canonicalProofOptions));

		// 3-4. Hash document without proof
		const documentWithoutProof = { ...activity };
		delete documentWithoutProof.proof;
		const canonicalDocument = jcsCanonicalize(documentWithoutProof);
		const documentHash = await sha256Bytes(encoder.encode(canonicalDocument));

		// 5. Concatenate hashes
		const combined = new Uint8Array(proofOptionsHash.length + documentHash.length);
		combined.set(proofOptionsHash, 0);
		combined.set(documentHash, proofOptionsHash.length);

		// 6. Decode signature
		const signatureBytes = base58btcDecode(proof.proofValue.slice(1));

		// 7. Import public key and verify
		const rawPublicKey = decodeEd25519PublicKeyMultibase(publicKeyMultibase);
		const publicKey = await crypto.subtle.importKey(
			'raw',
			rawPublicKey,
			'Ed25519',
			false,
			['verify'],
		);

		return await ed25519Verify(publicKey, signatureBytes, combined);
	} catch (e) {
		console.error('Proof verification failed:', e);
		return false;
	}
}
