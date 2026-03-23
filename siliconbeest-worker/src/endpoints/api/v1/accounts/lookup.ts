import { Hono } from 'hono';
import type { Env, AppVariables } from '../../../../env';
import { AppError } from '../../../../middleware/errorHandler';

type HonoEnv = { Bindings: Env; Variables: AppVariables };

const app = new Hono<HonoEnv>();

app.get('/lookup', async (c) => {
  const acct = c.req.query('acct');
  const domain = c.env.INSTANCE_DOMAIN;

  if (!acct) {
    throw new AppError(400, 'Validation failed', 'acct is required');
  }

  const row = await c.env.DB.prepare(
    'SELECT * FROM accounts WHERE username = ?1 AND domain IS NULL',
  ).bind(acct).first();

  if (!row) throw new AppError(404, 'Record not found');

  return c.json({
    id: row.id as string,
    username: row.username as string,
    acct: row.username as string,
    display_name: (row.display_name as string) || '',
    locked: !!(row.locked),
    bot: !!(row.bot),
    discoverable: !!(row.discoverable),
    group: false,
    created_at: row.created_at as string,
    note: (row.note as string) || '',
    url: (row.url as string) || `https://${domain}/@${row.username}`,
    uri: row.uri as string,
    avatar: (row.avatar_url as string) || '',
    avatar_static: (row.avatar_static_url as string) || '',
    header: (row.header_url as string) || '',
    header_static: (row.header_static_url as string) || '',
    followers_count: (row.followers_count as number) || 0,
    following_count: (row.following_count as number) || 0,
    statuses_count: (row.statuses_count as number) || 0,
    last_status_at: (row.last_status_at as string) || null,
    emojis: [],
    fields: [],
  });
});

export default app;
