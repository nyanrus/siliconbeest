import { Hono } from 'hono';

import type { Federation } from '@fedify/fedify';
import type { SendEmailMessage } from './types/queue';
import type { FedifyContextData } from './federation/fedify';
import type { BaseEnv } from '../../../packages/shared/types/env';

/**
 * Cloudflare Workers environment bindings.
 * Must match the bindings declared in wrangler.jsonc.
 */
export interface Env extends BaseEnv {
  // KV Namespaces (worker-only)
  SESSIONS: KVNamespace;

  // Queues (worker-only)
  QUEUE_EMAIL: Queue<SendEmailMessage>;

  // Durable Objects (worker-only)
  STREAMING_DO: DurableObjectNamespace;

  // Environment variables (wrangler.jsonc vars)
  INSTANCE_TITLE: string;
  REGISTRATION_MODE: string;

  // Secrets (worker-only)
  OTP_ENCRYPTION_KEY: string;
}

/**
 * Hono context variables set by middleware.
 */
export interface AppVariables {
  currentUser: {
    id: string;
    account_id: string;
    email: string;
    role: string;
  } | null;
  currentAccount: {
    id: string;
    username: string;
    domain: string | null;
  } | null;
  /** OAuth token scopes (space-separated), e.g. "read write follow push". */
  tokenScopes: string | null;
  /** The oauth_access_tokens row ID for the current bearer token. */
  tokenId: string | null;
  requestId: string;
  /** True when the client accepts ActivityPub content types. */
  isActivityPub: boolean;
  /** Fedify Federation instance (created per-request in middleware). */
  federation: Federation<FedifyContextData>;
}

/**
 * Fully-typed Hono app used across the project.
 */
export type AppType = Hono<{ Bindings: Env; Variables: AppVariables }>;
