import { ok, err, type Result } from 'neverthrow';
import type { StatusRow } from '../types/db';
import { type AppError, NotFoundError } from '../middleware/errorHandler';

/**
 * Timeline service: home, public, tag, and list timelines
 * with cursor-based pagination (max_id / since_id / min_id).
 */

type PaginationOpts = {
	limit?: number;
	maxId?: string;
	sinceId?: string;
	minId?: string;
};

type PublicTimelineOpts = PaginationOpts & {
	local?: boolean;
	onlyMedia?: boolean;
};

type TagTimelineOpts = PaginationOpts & {
	local?: boolean;
};

// ----------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------

const applyCursorConditions = (
	opts: PaginationOpts,
	columnPrefix: string,
): { fragments: string[]; params: (string | number)[] } => {
	const fragments: string[] = [];
	const params: (string | number)[] = [];

	if (opts.maxId) {
		fragments.push(`${columnPrefix} < ?`);
		params.push(opts.maxId);
	}
	if (opts.sinceId) {
		fragments.push(`${columnPrefix} > ?`);
		params.push(opts.sinceId);
	}
	if (opts.minId) {
		fragments.push(`${columnPrefix} > ?`);
		params.push(opts.minId);
	}

	return { fragments, params };
};

const executeTimelineQuery = async (
	db: D1Database,
	query: string,
	params: (string | number)[],
	useMinIdOrder: boolean,
): Promise<StatusRow[]> => {
	const result = await db
		.prepare(query)
		.bind(...params)
		.all();

	const rows = (result.results || []) as unknown as StatusRow[];

	if (useMinIdOrder) {
		rows.reverse();
	}

	return rows;
};

// ----------------------------------------------------------------
// Home timeline (from home_timeline_entries)
// ----------------------------------------------------------------
export const getHome = async (
	db: D1Database,
	accountId: string,
	opts: PaginationOpts,
): Promise<StatusRow[]> => {
	const limit = Math.min(opts.limit || 20, 40);
	const cursor = applyCursorConditions(opts, 'hte.status_id');

	const baseConditions = ['hte.account_id = ?', 's.deleted_at IS NULL'];
	const baseParams: (string | number)[] = [accountId];

	const allConditions = [...baseConditions, ...cursor.fragments];
	const allParams = [...baseParams, ...cursor.params, limit];

	const orderDirection = opts.minId ? 'ASC' : 'DESC';

	const query = `
		SELECT s.* FROM statuses s
		INNER JOIN home_timeline_entries hte ON hte.status_id = s.id
		WHERE ${allConditions.join(' AND ')}
		ORDER BY hte.status_id ${orderDirection}
		LIMIT ?
	`;

	return executeTimelineQuery(db, query, allParams, !!opts.minId);
};

// ----------------------------------------------------------------
// Public timeline
// ----------------------------------------------------------------
export const getPublic = async (
	db: D1Database,
	opts: PublicTimelineOpts,
): Promise<StatusRow[]> => {
	const limit = Math.min(opts.limit || 20, 40);
	const cursor = applyCursorConditions(opts, 's.id');

	const baseConditions = [
		's.deleted_at IS NULL',
		's.visibility = ?',
		's.reblog_of_id IS NULL',
		...(opts.local ? ['s.local = 1'] : []),
		...(opts.onlyMedia ? ['EXISTS (SELECT 1 FROM media_attachments ma WHERE ma.status_id = s.id)'] : []),
	];
	const baseParams: (string | number)[] = ['public'];

	const allConditions = [...baseConditions, ...cursor.fragments];
	const allParams = [...baseParams, ...cursor.params, limit];

	const orderDirection = opts.minId ? 'ASC' : 'DESC';

	const query = `
		SELECT s.* FROM statuses s
		WHERE ${allConditions.join(' AND ')}
		ORDER BY s.id ${orderDirection}
		LIMIT ?
	`;

	return executeTimelineQuery(db, query, allParams, !!opts.minId);
};

// ----------------------------------------------------------------
// Tag timeline
// ----------------------------------------------------------------
export const getTag = async (
	db: D1Database,
	tag: string,
	opts: TagTimelineOpts,
): Promise<StatusRow[]> => {
	const limit = Math.min(opts.limit || 20, 40);
	const normalizedTag = tag.toLowerCase();
	const cursor = applyCursorConditions(opts, 's.id');

	const baseConditions = [
		's.deleted_at IS NULL',
		"s.visibility IN ('public', 'unlisted')",
		's.reblog_of_id IS NULL',
		't.name = ?',
		...(opts.local ? ['s.local = 1'] : []),
	];
	const baseParams: (string | number)[] = [normalizedTag];

	const allConditions = [...baseConditions, ...cursor.fragments];
	const allParams = [...baseParams, ...cursor.params, limit];

	const orderDirection = opts.minId ? 'ASC' : 'DESC';

	const query = `
		SELECT s.* FROM statuses s
		INNER JOIN status_tags st ON st.status_id = s.id
		INNER JOIN tags t ON t.id = st.tag_id
		WHERE ${allConditions.join(' AND ')}
		ORDER BY s.id ${orderDirection}
		LIMIT ?
	`;

	return executeTimelineQuery(db, query, allParams, !!opts.minId);
};

// ----------------------------------------------------------------
// List timeline
// ----------------------------------------------------------------
export const getList = async (
	db: D1Database,
	listId: string,
	accountId: string,
	opts: PaginationOpts,
): Promise<Result<StatusRow[], AppError>> => {
	// Verify list ownership
	const list = await db
		.prepare('SELECT id FROM lists WHERE id = ? AND account_id = ? LIMIT 1')
		.bind(listId, accountId)
		.first();

	if (!list) {
		return err(NotFoundError('List not found'));
	}

	const limit = Math.min(opts.limit || 20, 40);
	const cursor = applyCursorConditions(opts, 's.id');

	const baseConditions = ['s.deleted_at IS NULL', 'la.list_id = ?'];
	const baseParams: (string | number)[] = [listId];

	const allConditions = [...baseConditions, ...cursor.fragments];
	const allParams = [...baseParams, ...cursor.params, limit];

	const orderDirection = opts.minId ? 'ASC' : 'DESC';

	const query = `
		SELECT s.* FROM statuses s
		INNER JOIN list_accounts la ON la.account_id = s.account_id
		WHERE ${allConditions.join(' AND ')}
		ORDER BY s.id ${orderDirection}
		LIMIT ?
	`;

	const rows = await executeTimelineQuery(db, query, allParams, !!opts.minId);
	return ok(rows);
};
