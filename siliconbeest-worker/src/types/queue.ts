/**
 * Queue Message Types
 *
 * Discriminated union of all messages that flow through the
 * QUEUE_FEDERATION and QUEUE_INTERNAL queues.
 */

import type { APActivity } from './activitypub';

// ============================================================
// INDIVIDUAL MESSAGE TYPES
// ============================================================

export interface DeliverActivityMessage {
  type: 'deliver_activity';
  /** The serialised ActivityPub activity JSON */
  activity: APActivity;
  /** Inbox URL of the target actor */
  inboxUrl: string;
  /** Account ID of the sending actor (for HTTP signature) */
  actorAccountId: string;
}

export interface DeliverActivityFanoutMessage {
  type: 'deliver_activity_fanout';
  /** The serialised ActivityPub activity JSON */
  activity: APActivity;
  /** Account ID of the sending actor */
  actorAccountId: string;
  /** Status ID for follower resolution (optional) */
  statusId?: string;
}

export interface FetchRemoteAccountMessage {
  type: 'fetch_remote_account';
  /** AP actor URI to fetch */
  actorUri: string;
  /** Force refresh even if recently fetched */
  forceRefresh?: boolean;
}

export interface FetchRemoteStatusMessage {
  type: 'fetch_remote_status';
  /** AP object URI of the status to fetch */
  statusUri: string;
}

export interface UpdateInstanceInfoMessage {
  type: 'update_instance_info';
  /** Domain of the instance to update */
  domain: string;
}

export interface DeliverReportMessage {
  type: 'deliver_report';
  /** Local report ID */
  reportId: string;
  /** Target instance domain to forward the report to */
  targetDomain: string;
}

export interface TimelineFanoutMessage {
  type: 'timeline_fanout';
  /** Status ID to fan out */
  statusId: string;
  /** Account ID of the status author */
  accountId: string;
}

export interface CreateNotificationMessage {
  type: 'create_notification';
  /** Account ID of the recipient */
  recipientAccountId: string;
  /** Account ID that triggered the notification */
  senderAccountId: string;
  /** Notification type */
  notificationType: string;
  /** Related status ID (optional) */
  statusId?: string;
  /** Emoji for emoji_reaction notifications */
  emoji?: string;
}

export interface ProcessMediaMessage {
  type: 'process_media';
  /** Media attachment ID to process */
  mediaAttachmentId: string;
  /** Account ID that owns the media */
  accountId: string;
}

export interface SendWebPushMessage {
  type: 'send_web_push';
  /** Notification ID to push */
  notificationId: string;
  /** User ID of the recipient */
  userId: string;
}

export interface CleanupExpiredTokensMessage {
  type: 'cleanup_expired_tokens';
}

export interface UpdateTrendsMessage {
  type: 'update_trends';
}

export interface FetchPreviewCardMessage {
  type: 'fetch_preview_card';
  /** Status ID that contains the URL */
  statusId: string;
  /** URL to fetch OpenGraph metadata from */
  url: string;
}

export interface ForwardActivityMessage {
  type: 'forward_activity';
  /** The raw JSON body of the original activity (preserving original bytes for signature) */
  rawBody: string;
  /** Original HTTP headers needed to preserve the signature */
  originalHeaders: Record<string, string>;
  /** Inbox URL of the local follower to forward to */
  targetInboxUrl: string;
}

export interface ImportItemMessage {
  type: 'import_item';
  /** Account address to import (e.g. "user@example.com") */
  acct: string;
  /** The action to perform */
  action: 'following' | 'blocks' | 'mutes';
  /** Account ID of the user performing the import */
  accountId: string;
}

export interface SendEmailMessage {
  type: 'send_email';
  /** Recipient email address */
  to: string;
  /** Email subject line */
  subject: string;
  /** HTML body content */
  html: string;
  /** Plain-text body content (optional) */
  text?: string;
}

// ============================================================
// STAGED INBOX PROCESSING — Actor model pipeline messages
// Each stage is independently retried by the queue supervisor.
// ============================================================

export interface IndexMentionsMessage {
  type: 'index_mentions';
  /** Status that contains the mentions */
  statusId: string;
  /** Account ID of the author (for notification sender) */
  authorAccountId: string;
  /** AP actor URIs of all mentioned actors */
  mentionHrefs: string[];
}

export interface IndexHashtagsMessage {
  type: 'index_hashtags';
  /** Status that contains the hashtags */
  statusId: string;
  /** Lowercase tag names without leading # */
  tagNames: string[];
}

export interface IndexEmojisMessage {
  type: 'index_emojis';
  /** Status that contains the emojis */
  statusId: string;
  /** Domain of the actor who sent the emojis (not the CDN domain) */
  actorDomain: string;
  /** Emojis to upsert */
  emojis: Array<{ shortcode: string; url: string }>;
}

// ============================================================
// DISCRIMINATED UNION
// ============================================================

export type QueueMessage =
  | DeliverActivityMessage
  | DeliverActivityFanoutMessage
  | FetchRemoteAccountMessage
  | FetchRemoteStatusMessage
  | UpdateInstanceInfoMessage
  | DeliverReportMessage
  | TimelineFanoutMessage
  | CreateNotificationMessage
  | ProcessMediaMessage
  | SendWebPushMessage
  | CleanupExpiredTokensMessage
  | UpdateTrendsMessage
  | FetchPreviewCardMessage
  | ForwardActivityMessage
  | ImportItemMessage
  | SendEmailMessage
  | IndexMentionsMessage
  | IndexHashtagsMessage
  | IndexEmojisMessage;

// ============================================================
// EXHAUSTIVE DISPATCH GUARD
//
// Use this in queue consumer switch statements.  TypeScript will
// produce a compile error if any QueueMessage variant is missing
// a case, mirroring Elixir's FunctionClauseError at compile time.
//
// Usage:
//   default: assertExhaustive(message);
// ============================================================

export function assertExhaustive(x: never): never {
  throw new Error(`Unhandled queue message type: ${(x as { type: string }).type}`);
}
