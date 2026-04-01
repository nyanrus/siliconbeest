import { Hono } from 'hono';
import type { Env, AppVariables } from '../../../env';
import { authRequired } from '../../../middleware/auth';
import { serializeAccount } from '../../../utils/mastodonSerializer';
import type { AccountRow } from '../../../types/db';

type HonoEnv = { Bindings: Env; Variables: AppVariables };

const app = new Hono<HonoEnv>();

// GET /api/v1/endorsements — list endorsed/featured accounts
app.get('/', authRequired, async (c) => {
  const currentAccount = c.get('currentAccount')!;
  const limit = Math.min(parseInt(c.req.query('limit') || '40', 10) || 40, 80);

  const { results } = await c.env.DB.prepare(
    `SELECT a.* FROM account_pins ap
     JOIN accounts a ON a.id = ap.target_account_id
     WHERE ap.account_id = ?1
     ORDER BY ap.created_at DESC
     LIMIT ?2`,
  )
    .bind(currentAccount.id, limit)
    .all();

  const accounts = (results ?? []).map((row: any) =>
    serializeAccount(row as AccountRow, { instanceDomain: c.env.INSTANCE_DOMAIN }),
  );

  return c.json(accounts);
});

export default app;
