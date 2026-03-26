/**
 * Environment bindings for the queue consumer worker.
 *
 * Matches the bindings declared in wrangler.jsonc.
 */
export interface Env {
  DB: D1Database;
  MEDIA_BUCKET: R2Bucket;
  CACHE: KVNamespace;
  FEDIFY_KV: KVNamespace;
  QUEUE_FEDERATION: Queue;
  QUEUE_INTERNAL: Queue;
  WORKER: Fetcher; // service binding to main worker
  VAPID_PUBLIC_KEY: string;
  VAPID_PRIVATE_KEY: string;
  INSTANCE_DOMAIN: string;

  // Fields required by worker's inbox listeners/dispatchers when imported
  // cross-package. These are not actual bindings in the consumer's wrangler.jsonc
  // but are needed for TypeScript compatibility.
  SESSIONS?: KVNamespace;
  QUEUE_EMAIL?: Queue;
  STREAMING_DO?: DurableObjectNamespace;
  INSTANCE_TITLE?: string;
  REGISTRATION_MODE?: string;
  OTP_ENCRYPTION_KEY?: string;
}
