import { ok, err, type Result } from 'neverthrow';
import { generateUlid } from '../utils/ulid';
import type { NotificationRow } from '../types/db';
import { UnprocessableEntityError, type AppError } from '../middleware/errorHandler';

/**
 * Notification service: listing, creating, dismissing, and
 * clearing notifications with cursor-based pagination.
 */

// ----------------------------------------------------------------
// List notifications
// ----------------------------------------------------------------
export const list = async (
	db: D1Database,
	accountId: string,
	opts: {
		limit?: number;
		maxId?: string;
		sinceId?: string;
		minId?: string;
		types?: string[];
		excludeTypes?: string[];
	},
): Promise<NotificationRow[]> => {
	const limit = Math.min(opts.limit || 15, 30);

	type ConditionEntry = { clause: string; values: (string | number)[] };

	const baseCondition: ConditionEntry = { clause: 'n.account_id = ?', values: [accountId] };

	const optionalConditions: ConditionEntry[] = [
		...(opts.maxId ? [{ clause: 'n.id < ?', values: [opts.maxId] }] : []),
		...(opts.sinceId ? [{ clause: 'n.id > ?', values: [opts.sinceId] }] : []),
		...(opts.minId ? [{ clause: 'n.id > ?', values: [opts.minId] }] : []),
		...(opts.types && opts.types.length > 0
			? [{ clause: `n.type IN (${opts.types.map(() => '?').join(', ')})`, values: opts.types }]
			: []),
		...(opts.excludeTypes && opts.excludeTypes.length > 0
			? [{ clause: `n.type NOT IN (${opts.excludeTypes.map(() => '?').join(', ')})`, values: opts.excludeTypes }]
			: []),
	];

	const allConditions = [baseCondition, ...optionalConditions];
	const whereClause = allConditions.map((c) => c.clause).join(' AND ');
	const params = [...allConditions.flatMap((c) => c.values), limit];

	const orderDirection = opts.minId ? 'ASC' : 'DESC';

	const query = `
		SELECT n.* FROM notifications n
		WHERE ${whereClause}
		ORDER BY n.id ${orderDirection}
		LIMIT ?
	`;

	const result = await db
		.prepare(query)
		.bind(...params)
		.all();

	const rows = (result.results || []) as unknown as NotificationRow[];
	if (opts.minId) {
		rows.reverse();
	}

	return rows;
};

// ----------------------------------------------------------------
// Get by ID
// ----------------------------------------------------------------
export const getById = async (
	db: D1Database,
	id: string,
	accountId: string,
): Promise<NotificationRow | null> =>
	(await db
		.prepare('SELECT * FROM notifications WHERE id = ? AND account_id = ? LIMIT 1')
		.bind(id, accountId)
		.first());

// ----------------------------------------------------------------
// Dismiss a single notification
// ----------------------------------------------------------------
export const dismiss = async (
	db: D1Database,
	id: string,
	accountId: string,
): Promise<void> => {
	await db
		.prepare('DELETE FROM notifications WHERE id = ? AND account_id = ?')
		.bind(id, accountId)
		.run();
};

// ----------------------------------------------------------------
// Clear all notifications for an account
// ----------------------------------------------------------------
export const clearAll = async (db: D1Database, accountId: string): Promise<void> => {
	await db
		.prepare('DELETE FROM notifications WHERE account_id = ?')
		.bind(accountId)
		.run();
};

// ----------------------------------------------------------------
// Get unread count
// ----------------------------------------------------------------
export const getUnreadCount = async (db: D1Database, accountId: string): Promise<number> => {
	const result = await db
		.prepare('SELECT COUNT(*) AS count FROM notifications WHERE account_id = ? AND read = 0')
		.bind(accountId)
		.first();

	return (result?.count as number) || 0;
};

// ----------------------------------------------------------------
// Create a notification
// ----------------------------------------------------------------
export const create = async (
	db: D1Database,
	accountId: string,
	fromAccountId: string,
	type: string,
	statusId?: string,
): Promise<Result<NotificationRow, AppError>> => {
	// Don't notify yourself
	if (accountId === fromAccountId) {
		return err(UnprocessableEntityError('Cannot create notification for yourself'));
	}

	// Check for duplicate: same type, from same account, for same status
	const existing = await db
		.prepare(
			`SELECT id FROM notifications
			WHERE account_id = ? AND from_account_id = ? AND type = ?
			AND (status_id = ? OR (status_id IS NULL AND ? IS NULL))
			LIMIT 1`,
		)
		.bind(accountId, fromAccountId, type, statusId || null, statusId || null)
		.first();

	if (existing) {
		const found = await getById(db, existing.id as string, accountId);
		if (found) return ok(found);
	}

	// Check if target has muted the source
	const muted = await db
		.prepare(
			'SELECT hide_notifications FROM mutes WHERE account_id = ? AND target_account_id = ? LIMIT 1',
		)
		.bind(accountId, fromAccountId)
		.first();

	if (muted && muted.hide_notifications) {
		return err(UnprocessableEntityError('Notifications muted'));
	}

	// Check if target has blocked the source
	const blocked = await db
		.prepare(
			'SELECT id FROM blocks WHERE account_id = ? AND target_account_id = ? LIMIT 1',
		)
		.bind(accountId, fromAccountId)
		.first();

	if (blocked) {
		return err(UnprocessableEntityError('Account blocked'));
	}

	const id = generateUlid();
	const now = new Date().toISOString();

	await db
		.prepare(
			`INSERT INTO notifications (id, account_id, from_account_id, type, status_id, read, created_at)
			VALUES (?, ?, ?, ?, ?, 0, ?)`,
		)
		.bind(id, accountId, fromAccountId, type, statusId || null, now)
		.run();

	const created = await getById(db, id, accountId);
	// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
	return ok(created!);
};
