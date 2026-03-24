/**
 * Activity Forwarding with Signature Preservation
 *
 * When our server receives an activity addressed to a followers collection
 * belonging to a remote actor, we forward it to other servers that host
 * followers of that actor, preserving the original HTTP signature.
 *
 * Per the ActivityPub spec (Section 7.1.2), servers SHOULD forward
 * incoming activities to the members of collections addressed in to/cc
 * when the server can verify the activity's authenticity.
 *
 * The primary use case: if Alice@remote.example sends a Create activity
 * addressed to her followers collection, and Bob@other.example follows
 * Alice, our server (which received the activity) should forward it
 * to Bob's server with the original signature so that server can
 * verify the activity came from Alice.
 */

import type { Env } from '../env';
import type { APActivity } from '../types/activitypub';
import type { ForwardActivityMessage } from '../types/queue';

/**
 * Headers relevant for HTTP signature preservation when forwarding.
 */
const FORWARDING_HEADERS = [
	'signature',
	'digest',
	'date',
	'host',
	'content-type',
] as const;

/**
 * Extract relevant headers from a Request for signature preservation.
 */
function extractSignatureHeaders(request: Request): Record<string, string> {
	const headers: Record<string, string> = {};
	for (const name of FORWARDING_HEADERS) {
		const value = request.headers.get(name);
		if (value) {
			headers[name] = value;
		}
	}
	return headers;
}

/**
 * Check if an activity should be forwarded and enqueue forwarding messages.
 *
 * An activity should be forwarded when:
 * 1. It is addressed (to/cc) to a followers collection URI of a known remote user
 * 2. The activity has already been signature-verified (caller responsibility)
 *
 * We forward to the unique set of remote inboxes (shared or individual)
 * for followers of the remote actor that are hosted on OTHER servers
 * (not on our instance, and not on the originating server).
 */
export async function maybeForwardActivity(
	activity: APActivity,
	rawBody: string,
	request: Request,
	env: Env,
): Promise<void> {
	const instanceDomain = env.INSTANCE_DOMAIN;
	const actorDomain = activity.actor
		? new URL(activity.actor).hostname
		: null;

	// Collect all followers collection URIs from to/cc that are remote
	const remoteFollowerCollections = new Set<string>();

	const checkField = (field: string | string[] | undefined) => {
		if (!field) return;
		const arr = Array.isArray(field) ? field : [field];
		for (const uri of arr) {
			if (
				uri.endsWith('/followers') &&
				!uri.startsWith(`https://${instanceDomain}/`)
			) {
				remoteFollowerCollections.add(uri);
			}
		}
	};

	checkField(activity.to as string | string[] | undefined);
	checkField(activity.cc as string | string[] | undefined);

	if (remoteFollowerCollections.size === 0) {
		return;
	}

	const originalHeaders = extractSignatureHeaders(request);

	for (const collectionUri of remoteFollowerCollections) {
		// Derive actor URI from collection: strip /followers suffix
		const actorUri = collectionUri.replace(/\/followers$/, '');

		// Find the remote account in our DB
		const remoteAccount = await env.DB.prepare(
			`SELECT id FROM accounts WHERE uri = ?1 AND domain IS NOT NULL LIMIT 1`,
		)
			.bind(actorUri)
			.first<{ id: string }>();

		if (!remoteAccount) {
			continue;
		}

		// Find followers of this remote actor that are on OTHER remote servers
		// (not our instance, not the originating actor's server)
		const { results } = await env.DB.prepare(
			`SELECT DISTINCT COALESCE(a.shared_inbox_url, a.inbox_url) AS target_inbox
			 FROM follows f
			 JOIN accounts a ON a.id = f.account_id
			 WHERE f.target_account_id = ?1
			   AND a.domain IS NOT NULL
			   AND a.inbox_url IS NOT NULL`,
		)
			.bind(remoteAccount.id)
			.all<{ target_inbox: string | null }>();

		if (!results || results.length === 0) {
			continue;
		}

		// Filter out the originating server and deduplicate
		const seenInboxes = new Set<string>();

		for (const row of results) {
			if (!row.target_inbox) continue;

			const targetDomain = new URL(row.target_inbox).hostname;

			// Don't forward back to the originating server
			if (actorDomain && targetDomain === actorDomain) continue;
			// Don't forward to ourselves
			if (targetDomain === instanceDomain) continue;

			if (seenInboxes.has(row.target_inbox)) continue;
			seenInboxes.add(row.target_inbox);

			const msg: ForwardActivityMessage = {
				type: 'forward_activity',
				rawBody,
				originalHeaders,
				targetInboxUrl: row.target_inbox,
			};

			await env.QUEUE_FEDERATION.send(msg);
		}
	}
}
