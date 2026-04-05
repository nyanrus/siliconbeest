import { ok, err, type Result } from 'neverthrow';
import { generateUlid } from '../utils/ulid';
import { parseContent } from '../utils/contentParser';
import type { StatusRow } from '../types/db';
import type { QueueMessage, TimelineFanoutMessage, DeliverActivityFanoutMessage } from '../types/queue';
import type { APActivity } from '../types/activitypub';
import { type AppError, NotFoundError, ForbiddenError, UnprocessableEntityError } from '../middleware/errorHandler';

/**
 * Status service: CRUD for statuses, favourites, reblogs, bookmarks,
 * and thread context retrieval.
 */

type CreateStatusData = {
	text: string;
	visibility?: string;
	sensitive?: boolean;
	spoilerText?: string;
	inReplyToId?: string;
	mediaIds?: string[];
	language?: string;
	pollOptions?: string[];
	pollExpiresIn?: number;
	pollMultiple?: boolean;
};

// ----------------------------------------------------------------
// Create status
// ----------------------------------------------------------------
export const create = async (
	db: D1Database,
	domain: string,
	federationQueue: Queue<QueueMessage>,
	internalQueue: Queue<QueueMessage>,
	accountId: string,
	data: CreateStatusData,
): Promise<Result<StatusRow, AppError>> => {
	const id = generateUlid();
	const now = new Date().toISOString();
	const visibility = data.visibility || 'public';
	const language = data.language || 'en';
	const sensitive = data.sensitive ? 1 : 0;
	const spoilerText = data.spoilerText || '';

	// Look up account for URI construction
	const account = await db.prepare('SELECT username FROM accounts WHERE id = ?').bind(accountId).first();
	if (!account) {
		return err(NotFoundError('Account not found'));
	}
	const username = account.username as string;

	const uri = `https://${domain}/users/${username}/statuses/${id}`;
	const url = `https://${domain}/@${username}/${id}`;

	// Parse content into HTML with mentions, hashtags, URLs
	const parsed = parseContent(data.text, domain);

	// Resolve reply
	const replyInfo = await (async () => {
		if (!data.inReplyToId) return { inReplyToId: null, inReplyToAccountId: null, conversationId: null, isReply: 0 };
		const parent = (await db
			.prepare('SELECT id, account_id, conversation_id FROM statuses WHERE id = ? AND deleted_at IS NULL LIMIT 1')
			.bind(data.inReplyToId)
			.first());
		if (parent) {
			return { inReplyToId: parent.id, inReplyToAccountId: parent.account_id, conversationId: parent.conversation_id, isReply: 1 };
		}
		return { inReplyToId: null, inReplyToAccountId: null, conversationId: null, isReply: 0 };
	})();
	const { inReplyToId, inReplyToAccountId, isReply } = replyInfo;

	// Create conversation if needed
	const conversationId = replyInfo.conversationId ?? generateUlid();
	if (!replyInfo.conversationId) {
		await db
			.prepare('INSERT INTO conversations (id, created_at, updated_at) VALUES (?, ?, ?)')
			.bind(conversationId, now, now)
			.run();
	}

	// Insert status
	await db
		.prepare(
			`INSERT INTO statuses
			(id, uri, url, account_id, in_reply_to_id, in_reply_to_account_id,
			 reblog_of_id, text, content, content_warning, visibility, sensitive,
			 language, conversation_id, reply, replies_count, reblogs_count,
			 favourites_count, local, federated_at, edited_at, deleted_at,
			 poll_id, created_at, updated_at)
			VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 1, NULL, NULL, NULL, NULL, ?, ?)`,
		)
		.bind(
			id,
			uri,
			url,
			accountId,
			inReplyToId,
			inReplyToAccountId,
			data.text,
			parsed.html,
			spoilerText,
			visibility,
			sensitive,
			language,
			conversationId,
			isReply,
			now,
			now,
		)
		.run();

	// Update reply count on parent
	if (inReplyToId) {
		await db
			.prepare('UPDATE statuses SET replies_count = replies_count + 1, updated_at = ? WHERE id = ?')
			.bind(now, inReplyToId)
			.run();
	}

	// Attach media
	if (data.mediaIds && data.mediaIds.length > 0) {
		const mediaStmts = data.mediaIds.map((mediaId) =>
			db.prepare('UPDATE media_attachments SET status_id = ? WHERE id = ? AND account_id = ?').bind(id, mediaId, accountId),
		);
		await db.batch(mediaStmts);
	}

	// Create mention rows
	if (parsed.mentions.length > 0) {
		const mentionStmts: D1PreparedStatement[] = [];
		// oxlint-disable-next-line fp/no-loop-statements
		for (const mention of parsed.mentions) {
			// Look up mentioned account
			const mentionedAccount = mention.domain
				? await db
						.prepare('SELECT id FROM accounts WHERE username = ? AND domain = ? LIMIT 1')
						.bind(mention.username.toLowerCase(), mention.domain.toLowerCase())
						.first()
				: await db
						.prepare('SELECT id FROM accounts WHERE username = ? AND domain IS NULL LIMIT 1')
						.bind(mention.username.toLowerCase())
						.first();

			if (mentionedAccount) {
				const mentionId = generateUlid();
				mentionStmts.push(
					db
						.prepare('INSERT INTO mentions (id, status_id, account_id, silent, created_at) VALUES (?, ?, ?, 0, ?)')
						.bind(mentionId, id, mentionedAccount.id as string, now),
				);
			}
		}
		if (mentionStmts.length > 0) {
			await db.batch(mentionStmts);
		}
	}

	// Create/find tags and link to status
	if (parsed.tags.length > 0) {
		// oxlint-disable-next-line fp/no-loop-statements
		for (const tagName of parsed.tags) {
			// oxlint-disable-next-line fp/no-let
			let tag = await db.prepare('SELECT id FROM tags WHERE name = ? LIMIT 1').bind(tagName).first();
			if (!tag) {
				const tagId = generateUlid();
				await db
					.prepare(
						`INSERT INTO tags (id, name, display_name, usable, trendable, listable, last_status_at, created_at, updated_at)
						VALUES (?, ?, NULL, 1, 1, 1, ?, ?, ?)`,
					)
					.bind(tagId, tagName, now, now, now)
					.run();
				tag = { id: tagId };
			} else {
				await db.prepare('UPDATE tags SET last_status_at = ?, updated_at = ? WHERE id = ?').bind(now, now, tag.id as string).run();
			}

			await db.prepare('INSERT INTO status_tags (status_id, tag_id) VALUES (?, ?)').bind(id, tag.id as string).run();
		}
	}

	// Create poll if options provided
	if (data.pollOptions && data.pollOptions.length > 0) {
		const pollId = generateUlid();
		const expiresAt = data.pollExpiresIn ? new Date(Date.now() + data.pollExpiresIn * 1000).toISOString() : null;
		const multiple = data.pollMultiple ? 1 : 0;

		await db
			.prepare(
				`INSERT INTO polls (id, status_id, expires_at, multiple, votes_count, voters_count, options, created_at)
				VALUES (?, ?, ?, ?, 0, 0, ?, ?)`,
			)
			.bind(pollId, id, expiresAt, multiple, JSON.stringify(data.pollOptions), now)
			.run();

		await db.prepare('UPDATE statuses SET poll_id = ? WHERE id = ?').bind(pollId, id).run();
	}

	// Update account status count
	await db
		.prepare('UPDATE accounts SET statuses_count = statuses_count + 1, last_status_at = ?, updated_at = ? WHERE id = ?')
		.bind(now, now, accountId)
		.run();

	// Enqueue timeline fanout
	await internalQueue.send({
		type: 'timeline_fanout',
		statusId: id,
		accountId,
	} satisfies TimelineFanoutMessage);

	// Enqueue federation delivery
	if (visibility !== 'direct') {
		const createActivity: APActivity = {
			type: 'Create',
			actor: `https://${domain}/users/${username}`,
			object: uri,
		};
		await federationQueue.send({
			type: 'deliver_activity_fanout',
			activity: createActivity,
			actorAccountId: accountId,
			statusId: id,
		} satisfies DeliverActivityFanoutMessage);
	}

	const created = await getById(db, id);
	if (!created) {
		return err(NotFoundError('Status not found after creation'));
	}
	return ok(created);
};

// ----------------------------------------------------------------
// Get by ID
// ----------------------------------------------------------------
export const getById = async (db: D1Database, id: string): Promise<StatusRow | null> =>
	(await db
		.prepare('SELECT * FROM statuses WHERE id = ? AND deleted_at IS NULL LIMIT 1')
		.bind(id)
		.first());

// ----------------------------------------------------------------
// Delete (soft delete)
// ----------------------------------------------------------------
export const deleteStatus = async (
	db: D1Database,
	domain: string,
	federationQueue: Queue<QueueMessage>,
	statusId: string,
	accountId: string,
): Promise<Result<void, AppError>> => {
	const status = await getById(db, statusId);
	if (!status) {
		return err(NotFoundError('Status not found'));
	}
	if (status.account_id !== accountId) {
		return err(ForbiddenError('Not authorized to delete this status'));
	}

	const now = new Date().toISOString();
	await db.prepare('UPDATE statuses SET deleted_at = ?, updated_at = ? WHERE id = ?').bind(now, now, statusId).run();

	// Decrement counts
	await db
		.prepare('UPDATE accounts SET statuses_count = MAX(statuses_count - 1, 0), updated_at = ? WHERE id = ?')
		.bind(now, accountId)
		.run();

	// Decrement reply count on parent
	if (status.in_reply_to_id) {
		await db
			.prepare('UPDATE statuses SET replies_count = MAX(replies_count - 1, 0), updated_at = ? WHERE id = ?')
			.bind(now, status.in_reply_to_id)
			.run();
	}

	// Enqueue Delete activity for federation
	const account = await db.prepare('SELECT username FROM accounts WHERE id = ?').bind(accountId).first();
	const deleteActivity: APActivity = {
		type: 'Delete',
		actor: `https://${domain}/users/${(account?.username as string) ?? ''}`,
		object: status.uri,
	};
	await federationQueue.send({
		type: 'deliver_activity_fanout',
		activity: deleteActivity,
		actorAccountId: accountId,
		statusId,
	} satisfies DeliverActivityFanoutMessage);

	return ok(undefined);
};

// ----------------------------------------------------------------
// Get thread context (ancestors + descendants)
// ----------------------------------------------------------------
export const getContext = async (
	db: D1Database,
	statusId: string,
): Promise<{ ancestors: StatusRow[]; descendants: StatusRow[] }> => {
	// Ancestors: walk up the reply chain
	const ancestors: StatusRow[] = [];
	// oxlint-disable-next-line fp/no-let
	let currentId: string | null = statusId;

	// oxlint-disable-next-line fp/no-loop-statements
	while (currentId) {
		const status: StatusRow | null = await db
			.prepare('SELECT * FROM statuses WHERE id = ? AND deleted_at IS NULL LIMIT 1')
			.bind(currentId)
			.first<StatusRow>();

		if (!status || !status.in_reply_to_id) {
			break;
		}

		const parent: StatusRow | null = await db
			.prepare('SELECT * FROM statuses WHERE id = ? AND deleted_at IS NULL LIMIT 1')
			.bind(status.in_reply_to_id)
			.first<StatusRow>();

		if (parent) {
			ancestors.unshift(parent);
			currentId = parent.in_reply_to_id;
		} else {
			break;
		}
	}

	// Descendants: BFS through replies
	const descendants: StatusRow[] = [];
	const queue: string[] = [statusId];

	// oxlint-disable-next-line fp/no-loop-statements
	while (queue.length > 0) {
		const parentId = queue.shift();
		if (!parentId) break;
		const replies = await db
			.prepare('SELECT * FROM statuses WHERE in_reply_to_id = ? AND deleted_at IS NULL ORDER BY created_at ASC')
			.bind(parentId)
			.all();

		((replies.results || []) as unknown as StatusRow[]).forEach((reply) => {
			descendants.push(reply);
			queue.push(reply.id);
		});
	}

	return { ancestors, descendants };
};

// ----------------------------------------------------------------
// Favourite
// ----------------------------------------------------------------
export const favourite = async (
	db: D1Database,
	accountId: string,
	statusId: string,
): Promise<Result<StatusRow, AppError>> => {
	const status = await getById(db, statusId);
	if (!status) {
		return err(NotFoundError('Status not found'));
	}

	const existing = await db
		.prepare('SELECT id FROM favourites WHERE account_id = ? AND status_id = ? LIMIT 1')
		.bind(accountId, statusId)
		.first();

	if (!existing) {
		const id = generateUlid();
		const now = new Date().toISOString();
		await db
			.prepare('INSERT INTO favourites (id, account_id, status_id, uri, created_at) VALUES (?, ?, ?, NULL, ?)')
			.bind(id, accountId, statusId, now)
			.run();

		await db
			.prepare('UPDATE statuses SET favourites_count = favourites_count + 1, updated_at = ? WHERE id = ?')
			.bind(now, statusId)
			.run();
	}

	const updated = await getById(db, statusId);
	// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
	return ok(updated!);
};

// ----------------------------------------------------------------
// Unfavourite
// ----------------------------------------------------------------
export const unfavourite = async (
	db: D1Database,
	accountId: string,
	statusId: string,
): Promise<Result<StatusRow, AppError>> => {
	const status = await getById(db, statusId);
	if (!status) {
		return err(NotFoundError('Status not found'));
	}

	const existing = await db
		.prepare('SELECT id FROM favourites WHERE account_id = ? AND status_id = ? LIMIT 1')
		.bind(accountId, statusId)
		.first();

	if (existing) {
		const now = new Date().toISOString();
		await db
			.prepare('DELETE FROM favourites WHERE account_id = ? AND status_id = ?')
			.bind(accountId, statusId)
			.run();

		await db
			.prepare('UPDATE statuses SET favourites_count = MAX(favourites_count - 1, 0), updated_at = ? WHERE id = ?')
			.bind(now, statusId)
			.run();
	}

	const updated = await getById(db, statusId);
	// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
	return ok(updated!);
};

// ----------------------------------------------------------------
// Reblog
// ----------------------------------------------------------------
export const reblog = async (
	db: D1Database,
	domain: string,
	federationQueue: Queue<QueueMessage>,
	accountId: string,
	statusId: string,
): Promise<Result<StatusRow, AppError>> => {
	const status = await getById(db, statusId);
	if (!status) {
		return err(NotFoundError('Status not found'));
	}

	if (status.visibility === 'direct' || status.visibility === 'private') {
		return err(UnprocessableEntityError('Cannot reblog a private or direct status'));
	}

	// Check if already reblogged
	const existing = await db
		.prepare('SELECT id FROM statuses WHERE account_id = ? AND reblog_of_id = ? AND deleted_at IS NULL LIMIT 1')
		.bind(accountId, statusId)
		.first();

	if (existing) {
		const existingStatus = await getById(db, existing.id as string);
		// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
		return ok(existingStatus!);
	}

	const id = generateUlid();
	const now = new Date().toISOString();

	const account = await db.prepare('SELECT username FROM accounts WHERE id = ?').bind(accountId).first();
	const username = (account?.username as string) ?? '';
	const uri = `https://${domain}/users/${username}/statuses/${id}/activity`;

	await db
		.prepare(
			`INSERT INTO statuses
			(id, uri, url, account_id, in_reply_to_id, in_reply_to_account_id,
			 reblog_of_id, text, content, content_warning, visibility, sensitive,
			 language, conversation_id, reply, replies_count, reblogs_count,
			 favourites_count, local, federated_at, edited_at, deleted_at,
			 poll_id, created_at, updated_at)
			VALUES (?, ?, NULL, ?, NULL, NULL, ?, '', '', '', ?, 0, ?, NULL, 0, 0, 0, 0, 1, NULL, NULL, NULL, NULL, ?, ?)`,
		)
		.bind(id, uri, accountId, statusId, status.visibility, status.language, now, now)
		.run();

	await db
		.prepare('UPDATE statuses SET reblogs_count = reblogs_count + 1, updated_at = ? WHERE id = ?')
		.bind(now, statusId)
		.run();

	// Enqueue federation
	const announceActivity: APActivity = {
		type: 'Announce',
		actor: `https://${domain}/users/${username}`,
		object: status.uri,
	};
	await federationQueue.send({
		type: 'deliver_activity_fanout',
		activity: announceActivity,
		actorAccountId: accountId,
		statusId: id,
	} satisfies DeliverActivityFanoutMessage);

	const created = await getById(db, id);
	// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
	return ok(created!);
};

// ----------------------------------------------------------------
// Unreblog
// ----------------------------------------------------------------
export const unreblog = async (
	db: D1Database,
	domain: string,
	federationQueue: Queue<QueueMessage>,
	accountId: string,
	statusId: string,
): Promise<Result<StatusRow, AppError>> => {
	const status = await getById(db, statusId);
	if (!status) {
		return err(NotFoundError('Status not found'));
	}

	const reblogRow = await db
		.prepare('SELECT id FROM statuses WHERE account_id = ? AND reblog_of_id = ? AND deleted_at IS NULL LIMIT 1')
		.bind(accountId, statusId)
		.first<{ id: string }>();

	if (reblogRow) {
		const now = new Date().toISOString();
		await db.prepare('UPDATE statuses SET deleted_at = ?, updated_at = ? WHERE id = ?').bind(now, now, reblogRow.id).run();

		await db
			.prepare('UPDATE statuses SET reblogs_count = MAX(reblogs_count - 1, 0), updated_at = ? WHERE id = ?')
			.bind(now, statusId)
			.run();

		// Enqueue Undo Announce
		const undoAccount = await db.prepare('SELECT username FROM accounts WHERE id = ?').bind(accountId).first();
		const undoActivity: APActivity = {
			type: 'Undo',
			actor: `https://${domain}/users/${(undoAccount?.username as string) ?? ''}`,
			object: status.uri,
		};
		await federationQueue.send({
			type: 'deliver_activity_fanout',
			activity: undoActivity,
			actorAccountId: accountId,
			statusId: reblogRow.id,
		} satisfies DeliverActivityFanoutMessage);
	}

	const updated = await getById(db, statusId);
	// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
	return ok(updated!);
};

// ----------------------------------------------------------------
// Bookmark
// ----------------------------------------------------------------
export const bookmark = async (
	db: D1Database,
	accountId: string,
	statusId: string,
): Promise<Result<void, AppError>> => {
	const status = await getById(db, statusId);
	if (!status) {
		return err(NotFoundError('Status not found'));
	}

	const existing = await db
		.prepare('SELECT id FROM bookmarks WHERE account_id = ? AND status_id = ? LIMIT 1')
		.bind(accountId, statusId)
		.first();

	if (!existing) {
		const id = generateUlid();
		const now = new Date().toISOString();
		await db
			.prepare('INSERT INTO bookmarks (id, account_id, status_id, created_at) VALUES (?, ?, ?, ?)')
			.bind(id, accountId, statusId, now)
			.run();
	}

	return ok(undefined);
};

// ----------------------------------------------------------------
// Unbookmark
// ----------------------------------------------------------------
export const unbookmark = async (
	db: D1Database,
	accountId: string,
	statusId: string,
): Promise<void> => {
	await db
		.prepare('DELETE FROM bookmarks WHERE account_id = ? AND status_id = ?')
		.bind(accountId, statusId)
		.run();
};
