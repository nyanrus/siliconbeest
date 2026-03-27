// SiliconBeest — Unified Entry Point
//
// Routes requests between the Hono worker app (API, federation, media)
// and the SPA assets handler. Crawler requests on SPA paths get
// OG meta tags for link previews.

import app from './worker/index';
import { isCrawler, handleOgRequest } from './og-handler';
import type { Env } from './worker/env';

// Extend Env with ASSETS binding
interface UnifiedEnv extends Env {
  ASSETS: Fetcher;
}

// Re-export Durable Object class so the runtime can find it
export { StreamingDO } from './worker/durableObjects/streaming';

// Prefixes / paths handled by the Hono worker app
const WORKER_PREFIXES = [
  '/api/',
  '/oauth/',
  '/.well-known/',
  '/nodeinfo',
  '/users/',
  '/actor',
  '/inbox',
  '/media/',
  '/proxy',
  '/authorize_interaction',
  '/auth/',
  '/healthz',
  '/thumbnail.png',
  '/favicon.ico',
  '/default-avatar.svg',
  '/default-header.svg',
  '/internal/',
];

function isWorkerPath(pathname: string): boolean {
  for (const prefix of WORKER_PREFIXES) {
    if (pathname === prefix || pathname.startsWith(prefix)) {
      return true;
    }
  }
  return false;
}

export default {
  async fetch(request: Request, env: UnifiedEnv, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const pathname = url.pathname;

    // 1. Worker paths → Hono app (API, federation, media, etc.)
    if (isWorkerPath(pathname)) {
      return app.fetch(request, env, ctx);
    }

    // 2. Crawler on SPA paths → OG handler
    const ua = request.headers.get('User-Agent');
    if (isCrawler(ua)) {
      if (!pathname.match(/\.(js|css|png|jpg|jpeg|gif|svg|ico|woff2?|ttf|eot|webp|avif|map|json)$/)) {
        const ogResponse = await handleOgRequest(url, env);
        if (ogResponse) return ogResponse;
      }
    }

    // 3. Try serving static assets
    const assetResponse = await env.ASSETS.fetch(request);
    if (assetResponse.status !== 404) return assetResponse;

    // 4. SPA fallback — serve index.html for client-side routing
    return env.ASSETS.fetch(new Request(new URL('/', request.url), request));
  },
} satisfies ExportedHandler<UnifiedEnv>;
