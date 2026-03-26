import { nodeInfoToJson } from '@fedify/fedify';
import { Hono } from 'hono';
import type { Env, AppVariables } from '../../env';

const app = new Hono<{ Bindings: Env; Variables: AppVariables }>();

const STATS_CACHE_KEY = 'nodeinfo:stats:2.1';
const STATS_CACHE_TTL = 3600; // 1 hour

interface NodeInfoStats {
	userCount: number;
	statusCount: number;
	domainCount: number;
	localComments: number;
}

async function getStats(db: D1Database, cache: KVNamespace): Promise<NodeInfoStats> {
	// Try cache first
	const cached = await cache.get(STATS_CACHE_KEY, 'json');
	if (cached) return cached as NodeInfoStats;

	// Query stats from D1
	const [usersResult, statusesResult, domainsResult, commentsResult] = await Promise.all([
		db.prepare(`SELECT COUNT(*) AS cnt FROM accounts WHERE domain IS NULL`).first(),
		db.prepare(`SELECT COUNT(*) AS cnt FROM statuses WHERE deleted_at IS NULL`).first(),
		db.prepare(`SELECT COUNT(DISTINCT domain) AS cnt FROM accounts WHERE domain IS NOT NULL`).first(),
		db.prepare(`SELECT COUNT(*) AS cnt FROM statuses WHERE deleted_at IS NULL AND local = 1 AND reply = 1`).first(),
	]);

	const stats: NodeInfoStats = {
		userCount: (usersResult?.cnt as number) ?? 0,
		statusCount: (statusesResult?.cnt as number) ?? 0,
		domainCount: (domainsResult?.cnt as number) ?? 0,
		localComments: (commentsResult?.cnt as number) ?? 0,
	};

	// Cache in KV
	await cache.put(STATS_CACHE_KEY, JSON.stringify(stats), {
		expirationTtl: STATS_CACHE_TTL,
	});

	return stats;
}

// GET /.well-known/nodeinfo
app.get('/', async (c) => {
	const domain = c.env.INSTANCE_DOMAIN;

	return c.json(
		{
			links: [
				{
					rel: 'http://nodeinfo.diaspora.software/ns/schema/2.1',
					href: `https://${domain}/nodeinfo/2.1`,
				},
				{
					rel: 'http://nodeinfo.diaspora.software/ns/schema/2.0',
					href: `https://${domain}/nodeinfo/2.0`,
				},
			],
		},
		200,
		{
			'Cache-Control': 'max-age=259200, public',
		},
	);
});

// GET /nodeinfo/2.1
app.get('/2.1', async (c) => {
	const stats = await getStats(c.env.DB, c.env.CACHE);
	const registrationOpen = c.env.REGISTRATION_MODE === 'open';

	const nodeInfo = {
		software: {
			name: 'siliconbeest',
			version: '0.1.0',
			repository: new URL('https://github.com/nicepkg/siliconbeest'),
			homepage: new URL(`https://${c.env.INSTANCE_DOMAIN}`),
		},
		protocols: ['activitypub'] as const,
		usage: {
			users: {
				total: stats.userCount,
				activeMonth: stats.userCount,
				activeHalfyear: stats.userCount,
			},
			localPosts: stats.statusCount,
			localComments: stats.localComments,
		},
		openRegistrations: registrationOpen,
		services: {
			inbound: [],
			outbound: [],
		},
		metadata: {
			nodeName: c.env.INSTANCE_TITLE || 'SiliconBeest',
			nodeDescription: `A SiliconBeest instance at ${c.env.INSTANCE_DOMAIN}`,
		},
	};

	return c.json(
		{ version: '2.1', ...(nodeInfoToJson(nodeInfo) as object) },
		200,
		{
			'Content-Type': 'application/json; profile="http://nodeinfo.diaspora.software/ns/schema/2.1#"',
			'Cache-Control': 'max-age=1800, public',
		},
	);
});

// GET /nodeinfo/2.0 — kept as alias for backward compatibility
app.get('/2.0', async (c) => {
	const stats = await getStats(c.env.DB, c.env.CACHE);
	const registrationOpen = c.env.REGISTRATION_MODE === 'open';

	const nodeInfo = {
		software: {
			name: 'siliconbeest',
			version: '0.1.0',
		},
		protocols: ['activitypub'] as const,
		usage: {
			users: {
				total: stats.userCount,
				activeMonth: stats.userCount,
				activeHalfyear: stats.userCount,
			},
			localPosts: stats.statusCount,
			localComments: 0,
		},
		openRegistrations: registrationOpen,
		services: {
			outbound: [],
			inbound: [],
		},
		metadata: {},
	};

	return c.json(
		{ ...(nodeInfoToJson(nodeInfo) as object), version: '2.0' },
		200,
		{
			'Content-Type': 'application/json; profile="http://nodeinfo.diaspora.software/ns/schema/2.0#"',
			'Cache-Control': 'max-age=1800, public',
		},
	);
});

export default app;
