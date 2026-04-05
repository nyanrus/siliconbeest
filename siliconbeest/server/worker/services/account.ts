import { ok, err, type Result } from 'neverthrow';
import { generateUlid } from '../utils/ulid';
import type { AccountRow, FollowRow, FollowRequestRow, BlockRow, MuteRow } from '../types/db';
import type { Relationship } from '../types/mastodon';
import { UnprocessableEntityError, NotFoundError, type AppError } from '../middleware/errorHandler';

/**
 * Account service: profile management, relationships (follow/block/mute),
 * and account search.
 */

// ----------------------------------------------------------------
// Get account by ID
// ----------------------------------------------------------------
export const getById = async (db: D1Database, id: string): Promise<AccountRow | null> =>
	(await db.prepare('SELECT * FROM accounts WHERE id = ?').bind(id).first());

// ----------------------------------------------------------------
// Get account by username and domain
// ----------------------------------------------------------------
export const getByUsername = async (
	db: D1Database,
	username: string,
	domain?: string | null,
): Promise<AccountRow | null> => {
	if (domain) {
		return (await db
			.prepare('SELECT * FROM accounts WHERE username = ? AND domain = ? LIMIT 1')
			.bind(username.toLowerCase(), domain.toLowerCase())
			.first());
	}
	return (await db
		.prepare('SELECT * FROM accounts WHERE username = ? AND domain IS NULL LIMIT 1')
		.bind(username.toLowerCase())
		.first());
};

// ----------------------------------------------------------------
// Update profile
// ----------------------------------------------------------------
export const updateProfile = async (
	db: D1Database,
	accountId: string,
	data: {
		displayName?: string;
		note?: string;
		locked?: boolean;
		bot?: boolean;
		discoverable?: boolean;
	},
): Promise<AccountRow> => {
	type SetEntry = { clause: string; value: string | number };

	const entries: SetEntry[] = [
		...(data.displayName !== undefined ? [{ clause: 'display_name = ?', value: data.displayName }] : []),
		...(data.note !== undefined ? [{ clause: 'note = ?', value: data.note }] : []),
		...(data.locked !== undefined
			? [
					{ clause: 'locked = ?', value: data.locked ? 1 : 0 },
					{ clause: 'manually_approves_followers = ?', value: data.locked ? 1 : 0 },
				]
			: []),
		...(data.bot !== undefined ? [{ clause: 'bot = ?', value: data.bot ? 1 : 0 }] : []),
		...(data.discoverable !== undefined ? [{ clause: 'discoverable = ?', value: data.discoverable ? 1 : 0 }] : []),
	];

	if (entries.length === 0) {
		// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
		return (await getById(db, accountId))!;
	}

	const now = new Date().toISOString();
	const allEntries = [...entries, { clause: 'updated_at = ?', value: now }];
	const sets = allEntries.map((e) => e.clause).join(', ');
	const values = [...allEntries.map((e) => e.value), accountId];

	await db
		.prepare(`UPDATE accounts SET ${sets} WHERE id = ?`)
		.bind(...values)
		.run();

	// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
	return (await getById(db, accountId))!;
};

// ----------------------------------------------------------------
// Get relationship between two accounts
// ----------------------------------------------------------------
export const getRelationship = async (
	db: D1Database,
	accountId: string,
	targetId: string,
): Promise<Relationship> => {
	const [follow, followedBy, followReq, followReqBy, block, blockedBy, mute] = await Promise.all([
		db
			.prepare('SELECT * FROM follows WHERE account_id = ? AND target_account_id = ? LIMIT 1')
			.bind(accountId, targetId)
			.first<FollowRow>(),
		db
			.prepare('SELECT * FROM follows WHERE account_id = ? AND target_account_id = ? LIMIT 1')
			.bind(targetId, accountId)
			.first<FollowRow>(),
		db
			.prepare('SELECT * FROM follow_requests WHERE account_id = ? AND target_account_id = ? LIMIT 1')
			.bind(accountId, targetId)
			.first<FollowRequestRow>(),
		db
			.prepare('SELECT * FROM follow_requests WHERE account_id = ? AND target_account_id = ? LIMIT 1')
			.bind(targetId, accountId)
			.first<FollowRequestRow>(),
		db
			.prepare('SELECT * FROM blocks WHERE account_id = ? AND target_account_id = ? LIMIT 1')
			.bind(accountId, targetId)
			.first<BlockRow>(),
		db
			.prepare('SELECT * FROM blocks WHERE account_id = ? AND target_account_id = ? LIMIT 1')
			.bind(targetId, accountId)
			.first<BlockRow>(),
		db
			.prepare('SELECT * FROM mutes WHERE account_id = ? AND target_account_id = ? LIMIT 1')
			.bind(accountId, targetId)
			.first<MuteRow>(),
	]);

	return {
		id: targetId,
		following: !!follow,
		showing_reblogs: follow ? !!follow.show_reblogs : false,
		notifying: follow ? !!follow.notify : false,
		followed_by: !!followedBy,
		blocking: !!block,
		blocked_by: !!blockedBy,
		muting: !!mute,
		muting_notifications: mute ? !!mute.hide_notifications : false,
		requested: !!followReq,
		requested_by: !!followReqBy,
		domain_blocking: false, // TODO: implement domain blocking check
		endorsed: false,
		note: '',
		// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
		languages: follow?.languages ? JSON.parse(follow.languages) : null,
	};
};

// ----------------------------------------------------------------
// Get batch relationships
// ----------------------------------------------------------------
export const getRelationships = async (
	db: D1Database,
	accountId: string,
	targetIds: string[],
): Promise<Relationship[]> =>
	Promise.all(targetIds.map((targetId) => getRelationship(db, accountId, targetId)));

// ----------------------------------------------------------------
// Search accounts
// ----------------------------------------------------------------
export const search = async (
	db: D1Database,
	query: string,
	limit: number = 40,
	offset: number = 0,
	_resolve: boolean = false,
): Promise<AccountRow[]> => {
	const searchTerm = `%${query}%`;
	const results = await db
		.prepare(
			`SELECT * FROM accounts
			WHERE (username LIKE ? OR display_name LIKE ?)
			AND suspended_at IS NULL
			ORDER BY
				CASE WHEN domain IS NULL THEN 0 ELSE 1 END,
				followers_count DESC
			LIMIT ? OFFSET ?`,
		)
		.bind(searchTerm, searchTerm, limit, offset)
		.all();

	return (results.results || []) as unknown as AccountRow[];
};

// ----------------------------------------------------------------
// Follow
// ----------------------------------------------------------------
export const follow = async (
	db: D1Database,
	domain: string,
	accountId: string,
	targetId: string,
): Promise<Result<Relationship, AppError>> => {
	if (accountId === targetId) {
		return err(UnprocessableEntityError('Cannot follow yourself'));
	}

	const target = await getById(db, targetId);
	if (!target) {
		return err(NotFoundError('Account not found'));
	}

	// Check if already following
	const existingFollow = await db
		.prepare('SELECT id FROM follows WHERE account_id = ? AND target_account_id = ? LIMIT 1')
		.bind(accountId, targetId)
		.first();
	if (existingFollow) {
		return ok(await getRelationship(db, accountId, targetId));
	}

	// Check if already requested
	const existingRequest = await db
		.prepare('SELECT id FROM follow_requests WHERE account_id = ? AND target_account_id = ? LIMIT 1')
		.bind(accountId, targetId)
		.first();
	if (existingRequest) {
		return ok(await getRelationship(db, accountId, targetId));
	}

	const now = new Date().toISOString();
	const id = generateUlid();

	if (target.locked) {
		// Create follow request
		await db
			.prepare(
				`INSERT INTO follow_requests (id, account_id, target_account_id, uri, created_at, updated_at)
				VALUES (?, ?, ?, NULL, ?, ?)`,
			)
			.bind(id, accountId, targetId, now, now)
			.run();
	} else {
		// Create follow directly
		const uri = target.domain ? null : `https://${domain}/users/${accountId}/follows/${id}`;
		await db
			.prepare(
				`INSERT INTO follows (id, account_id, target_account_id, uri, show_reblogs, notify, languages, created_at, updated_at)
				VALUES (?, ?, ?, ?, 1, 0, NULL, ?, ?)`,
			)
			.bind(id, accountId, targetId, uri, now, now)
			.run();

		// Update counts
		await db.batch([
			db.prepare('UPDATE accounts SET following_count = following_count + 1, updated_at = ? WHERE id = ?').bind(now, accountId),
			db.prepare('UPDATE accounts SET followers_count = followers_count + 1, updated_at = ? WHERE id = ?').bind(now, targetId),
		]);
	}

	return ok(await getRelationship(db, accountId, targetId));
};

// ----------------------------------------------------------------
// Unfollow
// ----------------------------------------------------------------
export const unfollow = async (
	db: D1Database,
	accountId: string,
	targetId: string,
): Promise<Relationship> => {
	const now = new Date().toISOString();

	// Remove follow
	const existingFollow = await db
		.prepare('SELECT id FROM follows WHERE account_id = ? AND target_account_id = ? LIMIT 1')
		.bind(accountId, targetId)
		.first();

	if (existingFollow) {
		await db
			.prepare('DELETE FROM follows WHERE account_id = ? AND target_account_id = ?')
			.bind(accountId, targetId)
			.run();

		await db.batch([
			db
				.prepare('UPDATE accounts SET following_count = MAX(following_count - 1, 0), updated_at = ? WHERE id = ?')
				.bind(now, accountId),
			db
				.prepare('UPDATE accounts SET followers_count = MAX(followers_count - 1, 0), updated_at = ? WHERE id = ?')
				.bind(now, targetId),
		]);
	}

	// Also remove any pending follow request
	await db
		.prepare('DELETE FROM follow_requests WHERE account_id = ? AND target_account_id = ?')
		.bind(accountId, targetId)
		.run();

	return getRelationship(db, accountId, targetId);
};

// ----------------------------------------------------------------
// Block
// ----------------------------------------------------------------
export const block = async (
	db: D1Database,
	accountId: string,
	targetId: string,
): Promise<Result<Relationship, AppError>> => {
	if (accountId === targetId) {
		return err(UnprocessableEntityError('Cannot block yourself'));
	}

	// Remove any existing follow in both directions
	await unfollow(db, accountId, targetId);

	// Remove reverse follow if exists
	const reverseFollow = await db
		.prepare('SELECT id FROM follows WHERE account_id = ? AND target_account_id = ? LIMIT 1')
		.bind(targetId, accountId)
		.first();
	if (reverseFollow) {
		const now = new Date().toISOString();
		await db
			.prepare('DELETE FROM follows WHERE account_id = ? AND target_account_id = ?')
			.bind(targetId, accountId)
			.run();
		await db.batch([
			db
				.prepare('UPDATE accounts SET following_count = MAX(following_count - 1, 0), updated_at = ? WHERE id = ?')
				.bind(now, targetId),
			db
				.prepare('UPDATE accounts SET followers_count = MAX(followers_count - 1, 0), updated_at = ? WHERE id = ?')
				.bind(now, accountId),
		]);
	}

	// Check if already blocked
	const existingBlock = await db
		.prepare('SELECT id FROM blocks WHERE account_id = ? AND target_account_id = ? LIMIT 1')
		.bind(accountId, targetId)
		.first();

	if (!existingBlock) {
		const id = generateUlid();
		const now = new Date().toISOString();
		await db
			.prepare('INSERT INTO blocks (id, account_id, target_account_id, uri, created_at) VALUES (?, ?, ?, NULL, ?)')
			.bind(id, accountId, targetId, now)
			.run();
	}

	return ok(await getRelationship(db, accountId, targetId));
};

// ----------------------------------------------------------------
// Unblock
// ----------------------------------------------------------------
export const unblock = async (
	db: D1Database,
	accountId: string,
	targetId: string,
): Promise<Relationship> => {
	await db
		.prepare('DELETE FROM blocks WHERE account_id = ? AND target_account_id = ?')
		.bind(accountId, targetId)
		.run();

	return getRelationship(db, accountId, targetId);
};

// ----------------------------------------------------------------
// Mute
// ----------------------------------------------------------------
export const mute = async (
	db: D1Database,
	accountId: string,
	targetId: string,
	notifications: boolean = true,
): Promise<Result<Relationship, AppError>> => {
	if (accountId === targetId) {
		return err(UnprocessableEntityError('Cannot mute yourself'));
	}

	// Check if already muted
	const existingMute = await db
		.prepare('SELECT id FROM mutes WHERE account_id = ? AND target_account_id = ? LIMIT 1')
		.bind(accountId, targetId)
		.first();

	const now = new Date().toISOString();

	if (existingMute) {
		// Update notification setting
		await db
			.prepare('UPDATE mutes SET hide_notifications = ?, updated_at = ? WHERE account_id = ? AND target_account_id = ?')
			.bind(notifications ? 1 : 0, now, accountId, targetId)
			.run();
	} else {
		const id = generateUlid();
		await db
			.prepare(
				`INSERT INTO mutes (id, account_id, target_account_id, hide_notifications, expires_at, created_at, updated_at)
				VALUES (?, ?, ?, ?, NULL, ?, ?)`,
			)
			.bind(id, accountId, targetId, notifications ? 1 : 0, now, now)
			.run();
	}

	return ok(await getRelationship(db, accountId, targetId));
};

// ----------------------------------------------------------------
// Unmute
// ----------------------------------------------------------------
export const unmute = async (
	db: D1Database,
	accountId: string,
	targetId: string,
): Promise<Relationship> => {
	await db
		.prepare('DELETE FROM mutes WHERE account_id = ? AND target_account_id = ?')
		.bind(accountId, targetId)
		.run();

	return getRelationship(db, accountId, targetId);
};
