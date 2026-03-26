/**
 * Fedify Collection Dispatchers (Queue Consumer)
 *
 * Minimal version of the worker's collection dispatchers.
 * Only registers the followers dispatcher, which is needed for
 * fanout resolution during processQueuedTask().
 *
 * This file lives in the consumer's source tree so that any Fedify
 * vocab types used in dispatcher signatures are resolved from the
 * consumer's own node_modules, avoiding the dual-package hazard.
 */

import type { Federation } from '@fedify/fedify';
import type { FedifyContextData } from './fedify';

const FOLLOWERS_PAGE_SIZE = 40;

/**
 * Register collection dispatchers needed by the queue consumer.
 * Currently only the followers dispatcher is required (for fanout).
 */
export function setupCollectionDispatchers(
  federation: Federation<FedifyContextData>,
): void {
  setupFollowersDispatcher(federation);
}

// ============================================================
// FOLLOWERS
// ============================================================

function setupFollowersDispatcher(
  federation: Federation<FedifyContextData>,
): void {
  federation
    .setFollowersDispatcher(
      '/users/{identifier}/followers',
      async (ctx, identifier, cursor) => {
        const db = ctx.data.env.DB;

        const account = await db
          .prepare(
            `SELECT id, followers_count FROM accounts
             WHERE username = ?1 AND domain IS NULL
             LIMIT 1`,
          )
          .bind(identifier)
          .first<{ id: string; followers_count: number }>();

        if (!account) return null;

        const conditions: string[] = ['f.target_account_id = ?1'];
        const binds: (string | number)[] = [account.id];

        if (cursor) {
          conditions.push('f.id < ?2');
          binds.push(cursor);
        }

        const sql = `
          SELECT f.id AS follow_id, a.uri, a.inbox_url, a.shared_inbox_url
          FROM follows f
          JOIN accounts a ON a.id = f.account_id
          WHERE ${conditions.join(' AND ')}
          ORDER BY f.id DESC
          LIMIT ?${binds.length + 1}
        `;
        binds.push(FOLLOWERS_PAGE_SIZE + 1);

        const { results } = await db
          .prepare(sql)
          .bind(...binds)
          .all<{ follow_id: string; uri: string; inbox_url: string; shared_inbox_url: string | null }>();

        const rows = results ?? [];
        const hasNext = rows.length > FOLLOWERS_PAGE_SIZE;
        const items = hasNext ? rows.slice(0, FOLLOWERS_PAGE_SIZE) : rows;

        const nextCursor = hasNext
          ? items[items.length - 1].follow_id
          : null;

        return {
          items: items.map((r) => ({
            id: new URL(r.uri),
            inboxId: r.inbox_url ? new URL(r.inbox_url) : null,
            endpoints: r.shared_inbox_url
              ? { sharedInbox: new URL(r.shared_inbox_url) }
              : null,
          })),
          nextCursor,
        };
      },
    )
    .setCounter(async (ctx, identifier) => {
      const db = ctx.data.env.DB;
      const account = await db
        .prepare(
          `SELECT followers_count FROM accounts
           WHERE username = ?1 AND domain IS NULL LIMIT 1`,
        )
        .bind(identifier)
        .first<{ followers_count: number }>();
      return account?.followers_count ?? 0;
    })
    .setFirstCursor(async (_ctx, _identifier) => {
      return '';
    });
}
