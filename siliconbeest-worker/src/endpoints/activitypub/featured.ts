/**
 * ActivityPub Featured Collection (Pinned Posts)
 *
 * Returns an OrderedCollection of pinned statuses for a given actor.
 * GET /users/:username/collections/featured
 */

import { Hono } from 'hono';
import type { Env, AppVariables } from '../../env';
import { serializeNote } from '../../federation/noteSerializer';
import type { AccountRow, StatusRow } from '../../types/db';

const app = new Hono<{ Bindings: Env; Variables: AppVariables }>();

app.get('/:username/collections/featured', async (c) => {
	const username = c.req.param('username');
	const domain = c.env.INSTANCE_DOMAIN;

	const account = await c.env.DB.prepare(
		`SELECT * FROM accounts WHERE username = ?1 AND domain IS NULL LIMIT 1`,
	)
		.bind(username)
		.first<AccountRow>();

	if (!account) {
		return c.json({ error: 'Record not found' }, 404);
	}

	const actorUri = `https://${domain}/users/${username}`;
	const collectionUri = `${actorUri}/collections/featured`;

	// Fetch pinned statuses
	const { results } = await c.env.DB.prepare(
		`SELECT * FROM statuses
		 WHERE account_id = ?1 AND pinned = 1
		   AND deleted_at IS NULL AND reblog_of_id IS NULL
		 ORDER BY created_at DESC`,
	)
		.bind(account.id)
		.all();

	const rows = (results ?? []) as unknown as StatusRow[];

	// Batch-fetch conversation AP URIs for pinned statuses
	const convIds = [...new Set(rows.map((r) => r.conversation_id).filter(Boolean))] as string[];
	const convMap = new Map<string, string | null>();
	for (const cid of convIds) {
		const row = await c.env.DB.prepare(
			'SELECT ap_uri FROM conversations WHERE id = ?1',
		)
			.bind(cid)
			.first<{ ap_uri: string | null }>();
		convMap.set(cid, row?.ap_uri ?? null);
	}

	// Batch fetch media
	const sIds = rows.map((s) => s.id);
	const featMediaMap = new Map<string, any[]>();
	if (sIds.length > 0) {
		const ph = sIds.map(() => '?').join(',');
		const { results: fm } = await c.env.DB.prepare(
			`SELECT * FROM media_attachments WHERE status_id IN (${ph})`,
		).bind(...sIds).all();
		for (const m of (fm ?? []) as Record<string, unknown>[]) {
			const sid = m.status_id as string;
			if (!featMediaMap.has(sid)) featMediaMap.set(sid, []);
			featMediaMap.get(sid)!.push({
				url: `https://${domain}/media/${m.file_key}`,
				mediaType: (m.file_content_type as string) || 'image/jpeg',
				description: (m.description as string) || '',
				width: m.width as number | null, height: m.height as number | null,
				blurhash: m.blurhash as string | null, type: (m.type as string) || 'image',
			});
		}
	}

	const orderedItems = rows.map((status) => {
		const conversationApUri = status.conversation_id
			? convMap.get(status.conversation_id) ?? null
			: null;
		const attachments = featMediaMap.get(status.id) ?? [];
		return serializeNote(status, account, domain, { conversationApUri, attachments });
	});

	return c.json(
		{
			'@context': ['https://www.w3.org/ns/activitystreams'],
			id: collectionUri,
			type: 'OrderedCollection',
			totalItems: orderedItems.length,
			orderedItems,
		},
		200,
		{ 'Content-Type': 'application/activity+json; charset=utf-8', 'Vary': 'Accept' },
	);
});

export default app;
