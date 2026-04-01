import { Hono } from 'hono';
import type { Env, AppVariables } from '../../../../env';
import { authOptional } from '../../../../middleware/auth';
import { AppError } from '../../../../middleware/errorHandler';

type HonoEnv = { Bindings: Env; Variables: AppVariables };

const app = new Hono<HonoEnv>();

// GET /api/v1/statuses/:id/history — get edit history
app.get('/:id/history', authOptional, async (c) => {
  const statusId = c.req.param('id');
  const domain = c.env.INSTANCE_DOMAIN;

  const status = await c.env.DB.prepare(
    `SELECT s.*, a.username, a.domain AS account_domain, a.display_name, a.note AS account_note,
       a.uri AS account_uri, a.url AS account_url,
       a.avatar_url, a.avatar_static_url, a.header_url, a.header_static_url,
       a.locked, a.bot, a.discoverable,
       a.followers_count, a.following_count, a.statuses_count,
       a.created_at AS account_created_at
     FROM statuses s JOIN accounts a ON a.id = s.account_id
     WHERE s.id = ?1 AND s.deleted_at IS NULL`,
  )
    .bind(statusId)
    .first();

  if (!status) throw new AppError(404, 'Record not found');

  const acct = (status as any).account_domain
    ? `${(status as any).username}@${(status as any).account_domain}`
    : (status as any).username;

  const account = {
    id: (status as any).account_id,
    username: (status as any).username,
    acct,
    display_name: (status as any).display_name || '',
    url: (status as any).account_url || `https://${domain}/@${(status as any).username}`,
    uri: (status as any).account_uri,
    avatar: (status as any).avatar_url || '',
    avatar_static: (status as any).avatar_static_url || (status as any).avatar_url || '',
    header: (status as any).header_url || '',
    header_static: (status as any).header_static_url || (status as any).header_url || '',
  };

  // Fetch edit history from status_edits table
  const { results: edits } = await c.env.DB.prepare(
    `SELECT * FROM status_edits WHERE status_id = ?1 ORDER BY created_at ASC`,
  )
    .bind(statusId)
    .all();

  // Fetch media attachments for this status
  const { results: media } = await c.env.DB.prepare(
    `SELECT * FROM media_attachments WHERE status_id = ?1`,
  )
    .bind(statusId)
    .all();

  const mediaAttachments = (media ?? []).map((m: any) => ({
    id: m.id,
    type: m.type || 'image',
    url: `https://${domain}/media/${m.file_key}`,
    preview_url: m.thumbnail_key ? `https://${domain}/media/${m.thumbnail_key}` : `https://${domain}/media/${m.file_key}`,
    description: m.description || null,
    blurhash: m.blurhash || null,
  }));

  const history: any[] = [];

  // Add edit snapshots
  for (const edit of edits ?? []) {
    const e = edit as any;
    let editMedia = mediaAttachments;
    if (e.media_attachments_json) {
      try {
        editMedia = JSON.parse(e.media_attachments_json);
      } catch { /* use current media */ }
    }
    history.push({
      content: e.content,
      spoiler_text: e.spoiler_text || '',
      sensitive: !!e.sensitive,
      created_at: e.created_at,
      account,
      media_attachments: editMedia,
      emojis: [],
    });
  }

  // Always add the current version as the last entry
  history.push({
    content: (status as any).content || '',
    spoiler_text: (status as any).content_warning || '',
    sensitive: !!(status as any).sensitive,
    created_at: (status as any).edited_at || (status as any).created_at,
    account,
    media_attachments: mediaAttachments,
    emojis: [],
  });

  return c.json(history);
});

export default app;
