/**
 * Batch-fetch media attachments and interaction states for a list of statuses.
 * Used by all timeline endpoints to avoid N+1 queries.
 */

import type { MediaAttachment as MastodonMediaAttachment } from '../types/mastodon';
import { serializeMediaAttachment } from './mastodonSerializer';
import type { MediaAttachmentRow } from '../types/db';

export interface StatusEnrichment {
  mediaAttachments: MastodonMediaAttachment[];
  favourited: boolean | null;
  reblogged: boolean | null;
  bookmarked: boolean | null;
  reactions: { emoji: string; count: number }[];
}

const EMPTY: StatusEnrichment = {
  mediaAttachments: [],
  favourited: null,
  reblogged: null,
  bookmarked: null,
  reactions: [],
};

/**
 * Batch-enrich statuses with media, emoji reactions, and interaction states.
 * Runs up to 5 queries in parallel (1 media + 1 reactions + 3 interactions if authenticated).
 */
export async function enrichStatuses(
  db: D1Database,
  domain: string,
  statusIds: string[],
  currentAccountId?: string | null,
): Promise<Map<string, StatusEnrichment>> {
  if (statusIds.length === 0) return new Map();

  const placeholders = statusIds.map(() => '?').join(',');
  const result = new Map<string, StatusEnrichment>();

  // Initialize all entries
  for (const id of statusIds) {
    result.set(id, { ...EMPTY, mediaAttachments: [], reactions: [] });
  }

  // Build parallel queries
  const queries: Promise<void>[] = [];

  // 1. Media attachments (always)
  queries.push(
    db
      .prepare(
        `SELECT * FROM media_attachments WHERE status_id IN (${placeholders}) ORDER BY created_at ASC`,
      )
      .bind(...statusIds)
      .all()
      .then(({ results }) => {
        for (const row of results ?? []) {
          const entry = result.get(row.status_id as string);
          if (entry) {
            entry.mediaAttachments.push(
              serializeMediaAttachment(row as unknown as MediaAttachmentRow, domain),
            );
          }
        }
      }),
  );

  // 2. Emoji reactions (always)
  queries.push(
    db
      .prepare(
        `SELECT status_id, emoji, COUNT(*) as count FROM emoji_reactions WHERE status_id IN (${placeholders}) GROUP BY status_id, emoji`,
      )
      .bind(...statusIds)
      .all()
      .then(({ results }) => {
        for (const row of results ?? []) {
          const entry = result.get(row.status_id as string);
          if (entry) {
            entry.reactions.push({
              emoji: row.emoji as string,
              count: row.count as number,
            });
          }
        }
      }),
  );

  // 3-5. Interaction states (only when authenticated)
  if (currentAccountId) {
    // Favourited
    queries.push(
      db
        .prepare(
          `SELECT status_id FROM favourites WHERE account_id = ?1 AND status_id IN (${placeholders})`,
        )
        .bind(currentAccountId, ...statusIds)
        .all()
        .then(({ results }) => {
          const favSet = new Set((results ?? []).map((r) => r.status_id as string));
          for (const id of statusIds) {
            const entry = result.get(id);
            if (entry) entry.favourited = favSet.has(id);
          }
        }),
    );

    // Reblogged
    queries.push(
      db
        .prepare(
          `SELECT reblog_of_id FROM statuses WHERE account_id = ?1 AND reblog_of_id IN (${placeholders}) AND deleted_at IS NULL`,
        )
        .bind(currentAccountId, ...statusIds)
        .all()
        .then(({ results }) => {
          const reblogSet = new Set((results ?? []).map((r) => r.reblog_of_id as string));
          for (const id of statusIds) {
            const entry = result.get(id);
            if (entry) entry.reblogged = reblogSet.has(id);
          }
        }),
    );

    // Bookmarked
    queries.push(
      db
        .prepare(
          `SELECT status_id FROM bookmarks WHERE account_id = ?1 AND status_id IN (${placeholders})`,
        )
        .bind(currentAccountId, ...statusIds)
        .all()
        .then(({ results }) => {
          const bmSet = new Set((results ?? []).map((r) => r.status_id as string));
          for (const id of statusIds) {
            const entry = result.get(id);
            if (entry) entry.bookmarked = bmSet.has(id);
          }
        }),
    );
  }

  await Promise.all(queries);
  return result;
}
