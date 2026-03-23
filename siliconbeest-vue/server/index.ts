// SPA server handler
// Static assets and SPA fallback are handled by Cloudflare Workers Assets
// (configured via "not_found_handling": "single-page-application" in wrangler.jsonc)
// This handler only runs for requests that don't match a static asset.
// We return nothing (pass-through) so the assets handler can serve index.html.

export default {
	async fetch(request, env, ctx) {
		// Let Cloudflare Workers Assets handle everything.
		// The "not_found_handling: single-page-application" setting
		// will serve index.html for any path that doesn't match a static file.
		return new Response(null, { status: 404 });
	},
} satisfies ExportedHandler<Env>;
