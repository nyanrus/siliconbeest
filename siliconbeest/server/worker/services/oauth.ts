import { ok, err, type Result } from 'neverthrow';
import { generateUlid } from '../utils/ulid';
import { generateToken, sha256 } from '../utils/crypto';
import type { OAuthApplicationRow, OAuthAuthorizationCodeRow } from '../types/db';
import { UnprocessableEntityError, type AppError } from '../middleware/errorHandler';

/**
 * OAuth 2.0 service: application registration, authorization codes,
 * token exchange, revocation, and credential verification.
 */

// ----------------------------------------------------------------
// Register OAuth application
// ----------------------------------------------------------------
export const createApplication = async (
	db: D1Database,
	name: string,
	redirectUri: string,
	scopes: string,
	website?: string,
): Promise<OAuthApplicationRow> => {
	const id = generateUlid();
	const clientId = generateToken(64);
	const clientSecret = generateToken(64);
	const now = new Date().toISOString();

	await db
		.prepare(
			`INSERT INTO oauth_applications (id, name, website, redirect_uri, client_id, client_secret, scopes, created_at, updated_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		)
		.bind(id, name, website || null, redirectUri, clientId, clientSecret, scopes, now, now)
		.run();

	return (await db.prepare('SELECT * FROM oauth_applications WHERE id = ?').bind(id).first()) as OAuthApplicationRow;
};

// ----------------------------------------------------------------
// Create authorization code
// ----------------------------------------------------------------
export const createAuthorizationCode = async (
	db: D1Database,
	appId: string,
	userId: string,
	redirectUri: string,
	scopes: string,
	codeChallenge?: string,
	codeChallengeMethod?: string,
): Promise<string> => {
	const id = generateUlid();
	const code = generateToken(64);
	const now = new Date();
	const expiresAt = new Date(now.getTime() + 10 * 60 * 1000); // 10 minutes

	await db
		.prepare(
			`INSERT INTO oauth_authorization_codes
			(id, code, application_id, user_id, redirect_uri, scopes,
			 code_challenge, code_challenge_method, expires_at, used_at, created_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
		)
		.bind(
			id,
			code,
			appId,
			userId,
			redirectUri,
			scopes,
			codeChallenge || null,
			codeChallengeMethod || null,
			expiresAt.toISOString(),
			now.toISOString(),
		)
		.run();

	return code;
};

// ----------------------------------------------------------------
// Exchange authorization code for access token
// ----------------------------------------------------------------
export const exchangeCode = async (
	db: D1Database,
	code: string,
	clientId: string,
	clientSecret: string,
	redirectUri: string,
	codeVerifier?: string,
): Promise<Result<{ token: string; scope: string; createdAt: number }, AppError>> => {
	// Look up the authorization code
	const authCode = await db
		.prepare('SELECT * FROM oauth_authorization_codes WHERE code = ? LIMIT 1')
		.bind(code)
		.first<OAuthAuthorizationCodeRow>();

	if (!authCode) {
		return err(UnprocessableEntityError('Invalid authorization code'));
	}

	// Check expiry
	if (new Date(authCode.expires_at) < new Date()) {
		return err(UnprocessableEntityError('Authorization code has expired'));
	}

	// Check if already used
	if (authCode.used_at) {
		return err(UnprocessableEntityError('Authorization code has already been used'));
	}

	// Validate application credentials
	const app = (await db
		.prepare('SELECT * FROM oauth_applications WHERE id = ? LIMIT 1')
		.bind(authCode.application_id)
		.first());

	if (!app) {
		return err(UnprocessableEntityError('Invalid application'));
	}

	if (app.client_id !== clientId || app.client_secret !== clientSecret) {
		return err(UnprocessableEntityError('Invalid client credentials'));
	}

	if (authCode.redirect_uri !== redirectUri) {
		return err(UnprocessableEntityError('Redirect URI mismatch'));
	}

	// PKCE verification
	if (authCode.code_challenge) {
		if (!codeVerifier) {
			return err(UnprocessableEntityError('Code verifier is required for PKCE'));
		}

		const computedChallenge = await (async () => {
			if (authCode.code_challenge_method === 'S256') {
				const hash = await sha256(codeVerifier);
				// Convert hex to base64url
				const hexPairs = hash.match(/.{2}/g) ?? [];
				const bytes = new Uint8Array(hexPairs.map((byte) => parseInt(byte, 16)));
				return base64UrlEncode(bytes);
			}
			// plain method
			return codeVerifier;
		})();

		if (computedChallenge !== authCode.code_challenge) {
			return err(UnprocessableEntityError('Invalid code verifier'));
		}
	}

	// Mark code as used
	await db
		.prepare('UPDATE oauth_authorization_codes SET used_at = ? WHERE id = ?')
		.bind(new Date().toISOString(), authCode.id)
		.run();

	// Generate access token -- store SHA-256 hash, not plaintext
	const token = generateToken(64);
	const tokenHash = await sha256(token);
	const tokenId = generateUlid();
	const now = new Date();

	await db
		.prepare(
			`INSERT INTO oauth_access_tokens
			(id, token_hash, refresh_token, application_id, user_id, scopes, expires_at, revoked_at, created_at)
			VALUES (?, ?, NULL, ?, ?, ?, NULL, NULL, ?)`,
		)
		.bind(tokenId, tokenHash, app.id, authCode.user_id, authCode.scopes, now.toISOString())
		.run();

	return ok({
		token,
		scope: authCode.scopes,
		createdAt: Math.floor(now.getTime() / 1000),
	});
};

// ----------------------------------------------------------------
// Revoke token
// ----------------------------------------------------------------
export const revokeToken = async (
	db: D1Database,
	token: string,
	clientId: string,
	clientSecret: string,
): Promise<Result<void, AppError>> => {
	// Validate client credentials
	const app = (await db
		.prepare('SELECT * FROM oauth_applications WHERE client_id = ? AND client_secret = ? LIMIT 1')
		.bind(clientId, clientSecret)
		.first());

	if (!app) {
		return err(UnprocessableEntityError('Invalid client credentials'));
	}

	const now = new Date().toISOString();
	await db
		.prepare('UPDATE oauth_access_tokens SET revoked_at = ? WHERE token = ? AND application_id = ?')
		.bind(now, token, app.id)
		.run();

	return ok(undefined);
};

// ----------------------------------------------------------------
// Verify app credentials (app-level token, no user)
// ----------------------------------------------------------------
export const verifyAppCredentials = async (
	db: D1Database,
	token: string,
): Promise<OAuthApplicationRow | null> => {
	const accessToken = (await db
		.prepare(
			`SELECT * FROM oauth_access_tokens
			WHERE token = ? AND revoked_at IS NULL
			AND (expires_at IS NULL OR expires_at > ?)`,
		)
		.bind(token, new Date().toISOString())
		.first());

	if (!accessToken) {
		return null;
	}

	const app = await db
		.prepare('SELECT * FROM oauth_applications WHERE id = ?')
		.bind(accessToken.application_id)
		.first<OAuthApplicationRow>();

	return app ?? null;
};

// ----------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------

const base64UrlEncode = (bytes: Uint8Array): string => {
	const binary = Array.from(bytes).map((byte) => String.fromCharCode(byte)).join('');
	return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
