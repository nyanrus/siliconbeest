/**
 * Inbox Processor: EmojiReact
 *
 * Handles incoming EmojiReact activities and Like activities with
 * _misskey_reaction field. Inserts an emoji_reactions record and
 * creates a notification for the status author.
 */

import type { Env } from '../../env';
import type { APActivity } from '../../types/activitypub';
import { generateUlid } from '../../utils/ulid';

/**
 * Resolve or upsert a remote account by actor URI.
 */
async function resolveRemoteAccount(
	actorUri: string,
	env: Env,
): Promise<string | null> {
	const existing = await env.DB.prepare(
		`SELECT id FROM accounts WHERE uri = ?1 LIMIT 1`,
	)
		.bind(actorUri)
		.first<{ id: string }>();

	if (existing) return existing.id;

	const now = new Date().toISOString();
	const id = generateUlid();
	let username = 'unknown';
	let domain = 'unknown';

	try {
		const url = new URL(actorUri);
		domain = url.host;
		const segments = url.pathname.split('/').filter(Boolean);
		username = segments[segments.length - 1] ?? 'unknown';
	} catch {
		// leave defaults
	}

	try {
		await env.DB.prepare(
			`INSERT INTO accounts (id, username, domain, uri, created_at, updated_at)
			 VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
		)
			.bind(id, username, domain, actorUri, now, now)
			.run();
	} catch {
		const retry = await env.DB.prepare(
			`SELECT id FROM accounts WHERE uri = ?1 LIMIT 1`,
		)
			.bind(actorUri)
			.first<{ id: string }>();
		return retry?.id ?? null;
	}

	await env.QUEUE_FEDERATION.send({
		type: 'fetch_remote_account',
		actorUri,
	});

	return id;
}

/**
 * Extract emoji from an activity.
 * Checks _misskey_reaction first, then content field, then tag field.
 */
function extractEmoji(activity: APActivity & Record<string, unknown>): string | null {
	// Misskey-style _misskey_reaction field
	if (typeof activity._misskey_reaction === 'string' && activity._misskey_reaction) {
		return activity._misskey_reaction;
	}

	// Content field (used by some implementations)
	if (typeof activity.content === 'string' && activity.content) {
		return activity.content;
	}

	return null;
}

export async function processEmojiReact(
	activity: APActivity & Record<string, unknown>,
	_localAccountId: string,
	env: Env,
): Promise<void> {
	const emoji = extractEmoji(activity);
	if (!emoji) {
		console.warn('[emojiReact] No emoji found in activity');
		return;
	}

	const statusUri =
		typeof activity.object === 'string' ? activity.object : undefined;

	if (!statusUri) {
		console.warn('[emojiReact] activity.object is not a string URI');
		return;
	}

	// Find the target status
	const status = await env.DB.prepare(
		`SELECT id, account_id FROM statuses WHERE uri = ?1 LIMIT 1`,
	)
		.bind(statusUri)
		.first<{ id: string; account_id: string }>();

	if (!status) {
		console.log(`[emojiReact] Status not found: ${statusUri}`);
		return;
	}

	// Resolve the remote actor
	const actorAccountId = await resolveRemoteAccount(activity.actor, env);
	if (!actorAccountId) {
		console.error('[emojiReact] Could not resolve remote actor');
		return;
	}

	// Insert emoji reaction (ignore duplicate via UNIQUE constraint)
	const reactionId = generateUlid();
	const now = new Date().toISOString();

	try {
		await env.DB.prepare(
			`INSERT INTO emoji_reactions (id, account_id, status_id, emoji, created_at)
			 VALUES (?1, ?2, ?3, ?4, ?5)`,
		)
			.bind(reactionId, actorAccountId, status.id, emoji, now)
			.run();
	} catch {
		// Duplicate reaction, ignore
		return;
	}

	// Create notification for the status author (only if local)
	const isLocalAuthor = await env.DB.prepare(
		`SELECT id FROM accounts WHERE id = ?1 AND domain IS NULL LIMIT 1`,
	)
		.bind(status.account_id)
		.first();

	if (isLocalAuthor) {
		await env.QUEUE_INTERNAL.send({
			type: 'create_notification',
			recipientAccountId: status.account_id,
			senderAccountId: actorAccountId,
			notificationType: 'favourite',
			statusId: status.id,
		});
	}
}
