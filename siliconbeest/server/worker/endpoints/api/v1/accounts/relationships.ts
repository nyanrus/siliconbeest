import { Hono } from 'hono';
import type { Env, AppVariables } from '../../../../env';
import { authRequired } from '../../../../middleware/auth';

type HonoEnv = { Bindings: Env; Variables: AppVariables };

const app = new Hono<HonoEnv>();

app.get('/relationships', authRequired, async (c) => {
  const currentAccountId = c.get('currentUser')!.account_id;

  // Mastodon sends id[]=... or id=...
  const url = new URL(c.req.url);
  const ids = url.searchParams.getAll('id[]');
  if (ids.length === 0) {
    const singleId = url.searchParams.get('id');
    if (singleId) ids.push(singleId);
  }

  if (ids.length === 0) {
    return c.json([]);
  }

  const relationships = await Promise.all(
    ids.map(async (targetId) => {
      const [following, followedBy, blocking, blockedBy, muting, requested, requestedBy, targetAccount] = await Promise.all([
        c.env.DB.prepare('SELECT id, show_reblogs, notify FROM follows WHERE account_id = ?1 AND target_account_id = ?2')
          .bind(currentAccountId, targetId).first(),
        c.env.DB.prepare('SELECT id FROM follows WHERE account_id = ?1 AND target_account_id = ?2')
          .bind(targetId, currentAccountId).first(),
        c.env.DB.prepare('SELECT id FROM blocks WHERE account_id = ?1 AND target_account_id = ?2')
          .bind(currentAccountId, targetId).first(),
        c.env.DB.prepare('SELECT id FROM blocks WHERE account_id = ?1 AND target_account_id = ?2')
          .bind(targetId, currentAccountId).first(),
        c.env.DB.prepare('SELECT id, hide_notifications FROM mutes WHERE account_id = ?1 AND target_account_id = ?2')
          .bind(currentAccountId, targetId).first(),
        c.env.DB.prepare('SELECT id FROM follow_requests WHERE account_id = ?1 AND target_account_id = ?2')
          .bind(currentAccountId, targetId).first(),
        c.env.DB.prepare('SELECT id FROM follow_requests WHERE account_id = ?1 AND target_account_id = ?2')
          .bind(targetId, currentAccountId).first(),
        c.env.DB.prepare('SELECT domain FROM accounts WHERE id = ?1')
          .bind(targetId).first<{ domain: string | null }>(),
      ]);

      // Queries for tables added in migration 0023 (graceful fallback)
      let endorsed = false;
      let noteComment = '';
      let domainBlocking = false;
      try {
        const [endorsedRow, accountNote] = await Promise.all([
          c.env.DB.prepare('SELECT id FROM account_pins WHERE account_id = ?1 AND target_account_id = ?2')
            .bind(currentAccountId, targetId).first(),
          c.env.DB.prepare('SELECT comment FROM account_notes WHERE account_id = ?1 AND target_account_id = ?2')
            .bind(currentAccountId, targetId).first<{ comment: string }>(),
        ]);
        endorsed = !!endorsedRow;
        noteComment = accountNote?.comment ?? '';

        if (targetAccount?.domain) {
          const dbRow = await c.env.DB.prepare(
            'SELECT id FROM user_domain_blocks WHERE account_id = ?1 AND domain = ?2',
          ).bind(currentAccountId, targetAccount.domain).first();
          domainBlocking = !!dbRow;
        }
      } catch {
        // Tables may not exist yet (pre-migration 0023)
      }

      return {
        id: targetId,
        following: !!following,
        showing_reblogs: following ? !!(following.show_reblogs) : true,
        notifying: following ? !!(following.notify) : false,
        languages: null,
        followed_by: !!followedBy,
        blocking: !!blocking,
        blocked_by: !!blockedBy,
        muting: !!muting,
        muting_notifications: muting ? !!(muting.hide_notifications) : false,
        requested: !!requested,
        requested_by: !!requestedBy,
        domain_blocking: domainBlocking,
        endorsed,
        note: noteComment,
      };
    }),
  );

  return c.json(relationships);
});

export default app;
