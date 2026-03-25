/**
 * Media Proxy Endpoint
 *
 * Caches remote Fediverse media in R2 and serves it through our domain.
 * Flow: check D1 cache → HIT: serve from R2 → MISS: fetch origin, stream to client,
 * and asynchronously save to R2 + D1 via waitUntil().
 */

import { Hono } from 'hono';
import type { Env, AppVariables } from '../env';

const app = new Hono<{ Bindings: Env; Variables: AppVariables }>();

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_CACHE_SIZE = 50 * 1024 * 1024; // 50 MB
const FETCH_TIMEOUT_MS = 10_000;
const ALLOWED_CONTENT_TYPE_PREFIXES = ['image/', 'video/', 'audio/', 'application/octet-stream'];
const CACHE_CONTROL = 'public, max-age=86400, immutable';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** SHA-256 hex digest of a string. */
async function sha256(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Extract a file extension from a URL path or Content-Type. */
function guessExtension(url: string, contentType: string | null): string {
  // Try from URL path first
  try {
    const pathname = new URL(url).pathname;
    const lastSegment = pathname.split('/').pop() || '';
    const dotIdx = lastSegment.lastIndexOf('.');
    if (dotIdx > 0) {
      const ext = lastSegment.slice(dotIdx + 1).toLowerCase();
      if (ext.length >= 1 && ext.length <= 10 && /^[a-z0-9]+$/.test(ext)) {
        return ext;
      }
    }
  } catch { /* ignore */ }

  // Fallback: derive from content-type
  if (contentType) {
    const ct = contentType.split(';')[0].trim().toLowerCase();
    const map: Record<string, string> = {
      'image/jpeg': 'jpg',
      'image/png': 'png',
      'image/gif': 'gif',
      'image/webp': 'webp',
      'image/svg+xml': 'svg',
      'image/avif': 'avif',
      'video/mp4': 'mp4',
      'video/webm': 'webm',
      'audio/mpeg': 'mp3',
      'audio/ogg': 'ogg',
      'audio/wav': 'wav',
    };
    if (map[ct]) return map[ct];
  }

  return 'bin';
}

/** Check if a content type is allowed for proxying. */
function isAllowedContentType(ct: string | null): boolean {
  if (!ct) return false;
  const lower = ct.split(';')[0].trim().toLowerCase();
  return ALLOWED_CONTENT_TYPE_PREFIXES.some((prefix) => lower.startsWith(prefix));
}

/** Validate that a URL is safe to fetch (http/https only, no private IPs). */
function isValidProxyUrl(urlStr: string): boolean {
  let url: URL;
  try {
    url = new URL(urlStr);
  } catch {
    return false;
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return false;
  }

  const hostname = url.hostname.toLowerCase();

  // Block private/internal IPs and hostnames
  if (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '::1' ||
    hostname === '0.0.0.0' ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal') ||
    hostname.endsWith('.localhost')
  ) {
    return false;
  }

  // Block private IP ranges
  const parts = hostname.split('.');
  if (parts.length === 4 && parts.every((p) => /^\d+$/.test(p))) {
    const [a, b] = parts.map(Number);
    if (
      a === 10 ||
      a === 127 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a === 0
    ) {
      return false;
    }
  }

  return true;
}

// ---------------------------------------------------------------------------
// GET /proxy?url=...
// ---------------------------------------------------------------------------

app.get('/', async (c) => {
  const remoteUrl = c.req.query('url');

  // 1. Validate URL param
  if (!remoteUrl) {
    return c.json({ error: 'Missing url parameter' }, 400);
  }

  if (!isValidProxyUrl(remoteUrl)) {
    return c.json({ error: 'Invalid or disallowed URL' }, 400);
  }

  // 2. Check D1 cache
  const cached = await c.env.DB.prepare(
    'SELECT r2_key, content_type FROM media_proxy_cache WHERE remote_url = ?',
  )
    .bind(remoteUrl)
    .first<{ r2_key: string; content_type: string }>();

  if (cached) {
    // Cache HIT — serve from R2
    const obj = await c.env.MEDIA_BUCKET.get(cached.r2_key);
    if (obj) {
      const headers = new Headers();
      headers.set('Content-Type', cached.content_type);
      headers.set('Cache-Control', CACHE_CONTROL);
      headers.set('X-Cache', 'HIT');
      if (obj.httpEtag) headers.set('ETag', obj.httpEtag);

      // Conditional request support
      const ifNoneMatch = c.req.header('If-None-Match');
      if (ifNoneMatch && obj.httpEtag && ifNoneMatch === obj.httpEtag) {
        return new Response(null, { status: 304, headers });
      }

      return new Response(obj.body, { status: 200, headers });
    }
    // R2 object missing — fall through to re-fetch
  }

  // 3. Cache MISS — fetch from origin
  let originResponse: Response;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    originResponse = await fetch(remoteUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'SiliconBeest/1.0 (+https://' + c.env.INSTANCE_DOMAIN + '/)',
        Accept: 'image/*,video/*,audio/*,*/*',
      },
      redirect: 'follow',
    });
    clearTimeout(timeout);
  } catch (err) {
    return c.json({ error: 'Failed to fetch remote media' }, 502);
  }

  if (!originResponse.ok) {
    return c.json({ error: `Remote server returned ${originResponse.status}` }, 502);
  }

  const contentType = originResponse.headers.get('Content-Type');

  // Validate content type
  if (!isAllowedContentType(contentType)) {
    return c.json({ error: 'Content type not allowed for proxying' }, 403);
  }

  // Check size from Content-Length header (if available)
  const contentLength = originResponse.headers.get('Content-Length');
  if (contentLength && parseInt(contentLength, 10) > MAX_CACHE_SIZE) {
    // Too large to cache — just proxy through
    const headers = new Headers();
    headers.set('Content-Type', contentType || 'application/octet-stream');
    headers.set('Cache-Control', 'public, max-age=3600');
    headers.set('X-Cache', 'SKIP');
    return new Response(originResponse.body, { status: 200, headers });
  }

  // Read the full body so we can both return it and cache it
  const bodyBuffer = await originResponse.arrayBuffer();

  // Check actual size
  if (bodyBuffer.byteLength > MAX_CACHE_SIZE) {
    const headers = new Headers();
    headers.set('Content-Type', contentType || 'application/octet-stream');
    headers.set('Cache-Control', 'public, max-age=3600');
    headers.set('X-Cache', 'SKIP');
    return new Response(bodyBuffer, { status: 200, headers });
  }

  const resolvedContentType = contentType || 'application/octet-stream';
  const ext = guessExtension(remoteUrl, resolvedContentType);

  // Return response immediately
  const responseHeaders = new Headers();
  responseHeaders.set('Content-Type', resolvedContentType);
  responseHeaders.set('Cache-Control', CACHE_CONTROL);
  responseHeaders.set('X-Cache', 'MISS');

  // 4. Asynchronously save to R2 + D1
  c.executionCtx.waitUntil(
    (async () => {
      try {
        const hash = await sha256(remoteUrl);
        const r2Key = `proxy/${hash}.${ext}`;
        const id = crypto.randomUUID();

        // Save to R2
        await c.env.MEDIA_BUCKET.put(r2Key, bodyBuffer, {
          httpMetadata: { contentType: resolvedContentType },
        });

        // Save to D1
        await c.env.DB.prepare(
          `INSERT OR IGNORE INTO media_proxy_cache (id, remote_url, r2_key, content_type, size, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
          .bind(id, remoteUrl, r2Key, resolvedContentType, bodyBuffer.byteLength, new Date().toISOString())
          .run();
      } catch (err) {
        console.error('Failed to cache proxied media:', err);
      }
    })(),
  );

  return new Response(bodyBuffer, { status: 200, headers: responseHeaders });
});

export default app;
