/**
 * Fedify Federation Instance Factory (Queue Consumer)
 *
 * Creates a Fedify Federation instance configured for Cloudflare Workers.
 * The instance must be created INSIDE queue() handlers, not globally,
 * because Cloudflare Workers bindings (KV, Queues) are only available as
 * method arguments.
 *
 * @see https://fedify.dev/
 * @see https://github.com/fedify-dev/fedify
 */

import { createFederation, type Federation, type MessageQueue } from '@fedify/fedify';
import { WorkersKvStore, WorkersMessageQueue } from '@fedify/cfworkers';
import type { Env } from './env';

/**
 * Context data passed to all Fedify dispatchers and listeners.
 * Provides access to Cloudflare Workers environment bindings.
 */
export interface FedifyContextData {
  /** Cloudflare Workers environment bindings (D1, R2, KV, Queues, etc.) */
  env: Env;
}

/**
 * Wrapper around WorkersMessageQueue that makes listen() a no-op.
 *
 * WorkersMessageQueue.listen() throws by design because Cloudflare Workers
 * don't support background listeners — the queue consumer uses
 * federation.processQueuedTask() instead. However, Fedify internally
 * calls queue.listen() during processQueuedTask(). This wrapper prevents
 * that TypeError from crashing the consumer.
 *
 * enqueue() works normally — messages are re-enqueued for retries.
 */
class CloudflareMessageQueue implements MessageQueue {
  private inner: WorkersMessageQueue;

  constructor(queue: Queue) {
    this.inner = new WorkersMessageQueue(queue);
  }

  enqueue(
    message: unknown,
    options?: Parameters<WorkersMessageQueue['enqueue']>[1],
  ): Promise<void> {
    return this.inner.enqueue(message, options);
  }

  async listen(
    _handler: (message: unknown) => Promise<void> | void,
    _options?: Record<string, unknown>,
  ): Promise<void> {
    // No-op: Cloudflare Workers use processQueuedTask() in the queue consumer.
    // WorkersMessageQueue.listen() throws TypeError by design.
  }
}

/**
 * Create a Fedify Federation instance for queue processing.
 *
 * The queue binding is required so that `processQueuedTask()` can
 * re-enqueue retries through the same WorkersMessageQueue that the
 * main worker uses for `sendActivity()`.
 *
 * @param env Cloudflare Workers Env bindings
 * @returns Configured Federation instance
 */
export function createFed(env: Env): Federation<FedifyContextData> {
  return createFederation<FedifyContextData>({
    kv: new WorkersKvStore(env.FEDIFY_KV as unknown as import('@cloudflare/workers-types/experimental').KVNamespace),
    queue: new CloudflareMessageQueue(env.QUEUE_FEDERATION),
    userAgent: {
      software: 'SiliconBeest/1.0',
      url: new URL(`https://${env.INSTANCE_DOMAIN}/`),
    },
  });
}
