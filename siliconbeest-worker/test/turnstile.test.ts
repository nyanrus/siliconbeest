import { env, SELF } from 'cloudflare:test';
import { describe, it, expect, beforeEach } from 'vitest';
import { applyMigration, createTestUser, authHeaders } from './helpers';

/**
 * Turnstile CAPTCHA verification tests.
 *
 * Uses Cloudflare's official test keys:
 *   - Always-pass secret:  1x0000000000000000000000000000000AA
 *   - Always-fail secret:  2x0000000000000000000000000000000AA
 *   - Dummy client token:  1x00000000000000000000AA
 */

async function resetDB() {
	const tables = await env.DB.prepare(
		"SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'",
	).all<{ name: string }>();
	if (tables.results && tables.results.length > 0) {
		const sql = 'PRAGMA foreign_keys = OFF;\n'
			+ tables.results.map((r) => `DROP TABLE IF EXISTS "${r.name}";`).join('\n')
			+ '\nPRAGMA foreign_keys = ON;';
		await env.DB.exec(sql);
	}
}

const PASS_SECRET = '1x0000000000000000000000000000000AA';
const FAIL_SECRET = '2x0000000000000000000000000000000AA';
const SITE_KEY = '1x00000000000000000000AA';
const DUMMY_TOKEN = '1x00000000000000000000AA';

async function enableTurnstile(secretKey: string = PASS_SECRET) {
	await env.DB.batch([
		env.DB.prepare(
			"INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('turnstile_enabled', '1', datetime('now'))",
		),
		env.DB.prepare(
			"INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('turnstile_site_key', ?1, datetime('now'))",
		).bind(SITE_KEY),
		env.DB.prepare(
			"INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('turnstile_secret_key', ?1, datetime('now'))",
		).bind(secretKey),
	]);
	// Clear KV cache so the new settings are picked up
	await env.CACHE.delete('settings:turnstile');
}

async function disableTurnstile() {
	await env.DB.batch([
		env.DB.prepare(
			"INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('turnstile_enabled', '0', datetime('now'))",
		),
		env.DB.prepare("DELETE FROM settings WHERE key = 'turnstile_site_key'"),
		env.DB.prepare("DELETE FROM settings WHERE key = 'turnstile_secret_key'"),
	]);
	await env.CACHE.delete('settings:turnstile');
}

async function registerRequest(body: Record<string, unknown>) {
	return SELF.fetch('https://test.siliconbeest.local/api/v1/accounts', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			username: 'turnstile_user_' + Math.random().toString(36).slice(2, 8),
			email: `turnstile_${Math.random().toString(36).slice(2, 8)}@test.local`,
			password: 'securepassword123',
			agreement: true,
			...body,
		}),
	});
}

async function loginRequest(body: Record<string, unknown>) {
	return SELF.fetch('https://test.siliconbeest.local/api/v1/auth/login', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body),
	});
}

describe('Turnstile CAPTCHA verification', () => {
	beforeEach(async () => {
		await resetDB();
		await applyMigration();
	});

	// =========================================================================
	// Turnstile ENABLED
	// =========================================================================

	describe('Turnstile enabled', () => {
		it('1. Registration without turnstile_token returns 422', async () => {
			await enableTurnstile();
			const res = await registerRequest({});
			expect(res.status).toBe(422);
			const json = (await res.json()) as { error: string };
			expect(json.error).toContain('CAPTCHA');
		});

		it('2. Registration with empty turnstile_token returns 422', async () => {
			await enableTurnstile();
			const res = await registerRequest({ turnstile_token: '' });
			expect(res.status).toBe(422);
			const json = (await res.json()) as { error: string };
			expect(json.error).toContain('CAPTCHA');
		});

		it('3. Registration with invalid turnstile_token (failing secret) returns 422', async () => {
			await enableTurnstile(FAIL_SECRET);
			const res = await registerRequest({ turnstile_token: DUMMY_TOKEN });
			expect(res.status).toBe(422);
			const json = (await res.json()) as { error: string };
			expect(json.error).toContain('CAPTCHA');
		});

		it('4. Registration with valid turnstile_token (passing secret) succeeds', async () => {
			await enableTurnstile(PASS_SECRET);
			const res = await registerRequest({ turnstile_token: DUMMY_TOKEN });
			// Should either be 200 with confirmation_required or another success
			expect(res.status).toBe(200);
			const json = (await res.json()) as { confirmation_required?: boolean };
			expect(json.confirmation_required).toBe(true);
		});

		it('5. Login without turnstile_token returns 422', async () => {
			await enableTurnstile();
			const res = await loginRequest({ email: 'test@test.local', password: 'pass' });
			expect(res.status).toBe(422);
			const json = (await res.json()) as { error: string };
			expect(json.error).toContain('CAPTCHA');
		});

		it('6. Login with empty turnstile_token returns 422', async () => {
			await enableTurnstile();
			const res = await loginRequest({
				email: 'test@test.local',
				password: 'pass',
				turnstile_token: '',
			});
			expect(res.status).toBe(422);
			const json = (await res.json()) as { error: string };
			expect(json.error).toContain('CAPTCHA');
		});

		it('7. Login with invalid turnstile_token (failing secret) returns 422', async () => {
			await enableTurnstile(FAIL_SECRET);
			const res = await loginRequest({
				email: 'test@test.local',
				password: 'pass',
				turnstile_token: DUMMY_TOKEN,
			});
			expect(res.status).toBe(422);
			const json = (await res.json()) as { error: string };
			expect(json.error).toContain('CAPTCHA');
		});

		it('8. Login with valid turnstile_token returns 200 with access_token', async () => {
			await enableTurnstile(PASS_SECRET);

			// Create a confirmed user with a known password hash
			const { userId } = await createTestUser('turnstile_login');
			// Set a real pbkdf2 password (we need the login endpoint to verify it)
			// Instead, set a plain password the login endpoint treats as a match via dummy_hash fallback
			// The login endpoint does: hash === password for non-standard hashes
			await env.DB.prepare('UPDATE users SET encrypted_password = ?1 WHERE id = ?2').bind(
				'testpassword123',
				userId,
			).run();

			const res = await loginRequest({
				email: 'turnstile_login@test.local',
				password: 'testpassword123',
				turnstile_token: DUMMY_TOKEN,
			});
			expect(res.status).toBe(200);
			const json = (await res.json()) as { access_token: string };
			expect(json.access_token).toBeTruthy();
		});
	});

	// =========================================================================
	// Turnstile DISABLED
	// =========================================================================

	describe('Turnstile disabled', () => {
		it('9. Registration without turnstile_token succeeds when disabled', async () => {
			await disableTurnstile();
			const res = await registerRequest({});
			expect(res.status).toBe(200);
			const json = (await res.json()) as { confirmation_required?: boolean };
			expect(json.confirmation_required).toBe(true);
		});

		it('10. Login without turnstile_token succeeds when disabled', async () => {
			await disableTurnstile();
			const { userId } = await createTestUser('no_turnstile_login');
			await env.DB.prepare('UPDATE users SET encrypted_password = ?1 WHERE id = ?2').bind(
				'testpassword123',
				userId,
			).run();

			const res = await loginRequest({
				email: 'no_turnstile_login@test.local',
				password: 'testpassword123',
			});
			expect(res.status).toBe(200);
			const json = (await res.json()) as { access_token: string };
			expect(json.access_token).toBeTruthy();
		});
	});

	// =========================================================================
	// Edge cases
	// =========================================================================

	describe('Edge cases', () => {
		it('11. turnstile_enabled=1 but no secret_key skips verification', async () => {
			// Enable turnstile but without secret key
			await env.DB.prepare(
				"INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('turnstile_enabled', '1', datetime('now'))",
			).run();
			await env.DB.prepare("DELETE FROM settings WHERE key = 'turnstile_secret_key'").run();
			await env.DB.prepare("DELETE FROM settings WHERE key = 'turnstile_site_key'").run();
			await env.CACHE.delete('settings:turnstile');

			// Registration should succeed without token since secretKey is empty
			const res = await registerRequest({});
			expect(res.status).toBe(200);
		});

		it('12. turnstile_enabled=0 with valid keys skips verification', async () => {
			await env.DB.batch([
				env.DB.prepare(
					"INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('turnstile_enabled', '0', datetime('now'))",
				),
				env.DB.prepare(
					"INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('turnstile_site_key', ?1, datetime('now'))",
				).bind(SITE_KEY),
				env.DB.prepare(
					"INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('turnstile_secret_key', ?1, datetime('now'))",
				).bind(PASS_SECRET),
			]);
			await env.CACHE.delete('settings:turnstile');

			// Registration should succeed without token since turnstile is disabled
			const res = await registerRequest({});
			expect(res.status).toBe(200);
		});

		it('13. Instance API /api/v2/instance includes turnstile config when enabled', async () => {
			await enableTurnstile();
			const res = await SELF.fetch('https://test.siliconbeest.local/api/v2/instance');
			expect(res.status).toBe(200);
			const json = (await res.json()) as {
				configuration: {
					turnstile: { enabled: boolean; site_key: string };
				};
			};
			expect(json.configuration.turnstile.enabled).toBe(true);
			expect(json.configuration.turnstile.site_key).toBe(SITE_KEY);
		});

		it('14. Instance API shows turnstile disabled when not configured', async () => {
			await disableTurnstile();
			const res = await SELF.fetch('https://test.siliconbeest.local/api/v2/instance');
			expect(res.status).toBe(200);
			const json = (await res.json()) as {
				configuration: {
					turnstile: { enabled: boolean; site_key: string };
				};
			};
			expect(json.configuration.turnstile.enabled).toBe(false);
		});
	});
});
