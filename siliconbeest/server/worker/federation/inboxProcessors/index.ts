/**
 * Inbox Activity Dispatcher
 *
 * Routes inbound ActivityPub activities to the appropriate processor
 * using a registry pattern instead of a switch statement.
 */

import type { Env } from '../../env';
import type { APActivity } from '../../types/activitypub';

import { processCreate } from './create';
import { processFollow } from './follow';
import { processAccept } from './accept';
import { processReject } from './reject';
import { processLike } from './like';
import { processAnnounce } from './announce';
import { processDelete } from './delete';
import { processUpdate } from './update';
import { processUndo } from './undo';
import { processBlock } from './block';
import { processMove } from './move';
import { processFlag } from './flag';
import { processEmojiReact } from './emojiReact';

type ActivityProcessor = (
	activity: APActivity,
	localAccountId: string,
	env: Env,
) => Promise<void>;

/**
 * Registry of activity type -> processor function.
 * New activity types can be added by simply adding an entry here.
 */
const processorRegistry: Record<string, ActivityProcessor> = {
	Create: processCreate,
	Follow: processFollow,
	Accept: processAccept,
	Reject: processReject,
	Like: (activity, localAccountId, env) => {
		const anyActivity = activity as APActivity & Record<string, unknown>;
		if (anyActivity._misskey_reaction || anyActivity.content) {
			return processEmojiReact(anyActivity, localAccountId, env);
		}
		return processLike(activity, localAccountId, env);
	},
	Announce: processAnnounce,
	Delete: processDelete,
	Update: processUpdate,
	Undo: processUndo,
	Block: processBlock,
	Move: processMove,
	Flag: processFlag,
	EmojiReact: (activity, localAccountId, env) =>
		processEmojiReact(
			activity as APActivity & Record<string, unknown>,
			localAccountId,
			env,
		),
};

/**
 * Process an inbound ActivityPub activity by dispatching to the
 * appropriate handler based on the activity type.
 */
export async function processInboxActivity(
	activity: APActivity,
	localAccountId: string,
	env: Env,
): Promise<void> {
	const processor = processorRegistry[activity.type];
	if (processor) {
		return processor(activity, localAccountId, env);
	}
	console.warn(`[inbox] Unhandled activity type: ${activity.type}`);
}
