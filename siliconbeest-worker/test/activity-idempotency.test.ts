import { SELF, env } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import { applyMigration, createTestUser } from './helpers';

const BASE = 'https://test.siliconbeest.local';
const DOMAIN = 'test.siliconbeest.local';

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

describe('Activity Idempotency', () => {
	let user: { accountId: string; userId: string; token: string };
	let publicKeyPem: string;
	let privateKeyPem: string;

	beforeAll(async () => {
		await applyMigration();
		user = await createTestUser('idempuser');

		// Generate real RSA keys and store for the remote actor
		const keys = await generateRSAKeyPair();
		publicKeyPem = keys.publicKeyPem;
		privateKeyPem = keys.privateKeyPem;

		// Create a remote actor that will send activities
		const now = new Date().toISOString();
		const remoteAccountId = crypto.randomUUID();
		await env.DB.batch([
			env.DB.prepare(
				`INSERT INTO accounts (id, username, domain, display_name, note, uri, url, inbox_url, created_at, updated_at)
				 VALUES (?, ?, ?, ?, '', ?, ?, ?, ?, ?)`,
			).bind(
				remoteAccountId,
				'remoteactor',
				'remote.example.com',
				'Remote Actor',
				'https://remote.example.com/users/remoteactor',
				'https://remote.example.com/@remoteactor',
				'https://remote.example.com/users/remoteactor/inbox',
				now,
				now,
			),
			env.DB.prepare(
				`INSERT INTO actor_keys (id, account_id, public_key, private_key, key_id, created_at)
				 VALUES (?, ?, ?, ?, ?, ?)`,
			).bind(
				crypto.randomUUID(),
				remoteAccountId,
				publicKeyPem,
				'unused',
				'https://remote.example.com/users/remoteactor#main-key',
				now,
			),
		]);
	});

	it('second delivery of same activity ID returns 202 (idempotent)', async () => {
		const activityId = 'https://remote.example.com/activities/test-idemp-1';

		// Pre-seed the CACHE KV with the activity-seen marker
		// (this simulates the first delivery having already been processed)
		await env.CACHE.put(`activity-seen:${activityId}`, '1', { expirationTtl: 86400 });

		const activity = {
			'@context': 'https://www.w3.org/ns/activitystreams',
			id: activityId,
			type: 'Like',
			actor: 'https://remote.example.com/users/remoteactor',
			object: `https://${DOMAIN}/users/idempuser/statuses/1`,
		};

		// Import the signRequest function to create a properly signed request
		const { signRequest } = await import('../src/federation/httpSignatures');
		const body = JSON.stringify(activity);
		const url = `${BASE}/users/idempuser/inbox`;
		const headers = await signRequest(
			privateKeyPem,
			'https://remote.example.com/users/remoteactor#main-key',
			url,
			'POST',
			body,
		);

		// Send the "duplicate" activity
		const res = await SELF.fetch(url, {
			method: 'POST',
			headers: {
				...headers,
			},
			body,
		});

		// Should be accepted but not re-processed
		expect(res.status).toBe(202);
	});

	it('activities without an ID are always processed', async () => {
		// An activity without an ID should always be processed (no idempotency check)
		const activity = {
			'@context': 'https://www.w3.org/ns/activitystreams',
			type: 'Like',
			actor: 'https://remote.example.com/users/remoteactor',
			object: `https://${DOMAIN}/users/idempuser/statuses/1`,
		};

		const { signRequest } = await import('../src/federation/httpSignatures');
		const body = JSON.stringify(activity);
		const url = `${BASE}/users/idempuser/inbox`;
		const headers = await signRequest(
			privateKeyPem,
			'https://remote.example.com/users/remoteactor#main-key',
			url,
			'POST',
			body,
		);

		const res = await SELF.fetch(url, {
			method: 'POST',
			headers,
			body,
		});

		// Should be accepted and processed
		expect(res.status).toBe(202);
	});

	it('different activity IDs are both processed', async () => {
		const { signRequest } = await import('../src/federation/httpSignatures');

		// First activity
		const activity1 = {
			'@context': 'https://www.w3.org/ns/activitystreams',
			id: 'https://remote.example.com/activities/distinct-1',
			type: 'Like',
			actor: 'https://remote.example.com/users/remoteactor',
			object: `https://${DOMAIN}/users/idempuser/statuses/1`,
		};

		const body1 = JSON.stringify(activity1);
		const url = `${BASE}/users/idempuser/inbox`;
		const headers1 = await signRequest(
			privateKeyPem,
			'https://remote.example.com/users/remoteactor#main-key',
			url,
			'POST',
			body1,
		);

		const res1 = await SELF.fetch(url, {
			method: 'POST',
			headers: headers1,
			body: body1,
		});
		expect(res1.status).toBe(202);

		// Second different activity
		const activity2 = {
			'@context': 'https://www.w3.org/ns/activitystreams',
			id: 'https://remote.example.com/activities/distinct-2',
			type: 'Like',
			actor: 'https://remote.example.com/users/remoteactor',
			object: `https://${DOMAIN}/users/idempuser/statuses/2`,
		};

		const body2 = JSON.stringify(activity2);
		const headers2 = await signRequest(
			privateKeyPem,
			'https://remote.example.com/users/remoteactor#main-key',
			url,
			'POST',
			body2,
		);

		const res2 = await SELF.fetch(url, {
			method: 'POST',
			headers: headers2,
			body: body2,
		});
		expect(res2.status).toBe(202);
	});
});
