/**
 * Fedify Federation Instance Factory
 *
 * Creates a Fedify Federation instance configured for Cloudflare Workers.
 * The instance must be created INSIDE fetch()/queue() handlers, not globally,
 * because Cloudflare Workers bindings (KV, Queues) are only available as
 * method arguments.
 *
 * @see https://fedify.dev/
 * @see https://github.com/fedify-dev/fedify
 */

import { createFederation, type Federation, type MessageQueue } from '@fedify/fedify';
import { WorkersKvStore, WorkersMessageQueue } from '@fedify/cfworkers';
import type { Env } from '../env';

/**
 * Context data passed to all Fedify dispatchers and listeners.
 * Provides access to Cloudflare Workers environment bindings.
 */
export interface FedifyContextData {
  /** Cloudflare Workers environment bindings (D1, R2, KV, Queues, etc.) */
  env: Env;
}

/**
 * Wrapper around WorkersMessageQueue for Cloudflare Workers compatibility.
 *
 * Two critical fixes:
 *
 * 1. listen() is a no-op — WorkersMessageQueue.listen() throws by design
 *    because Cloudflare Workers use processQueuedTask() in the queue consumer.
 *    Fedify's sendActivity() calls listen() internally as a side-effect.
 *
 * 2. enqueue() uses ctx.waitUntil() — Fedify's sendActivity() calls
 *    fanoutQueue.enqueue() WITHOUT await (fire-and-forget). In Cloudflare
 *    Workers, un-awaited Promises are killed when the response is sent.
 *    We register each enqueue Promise with waitUntil() so the Worker
 *    keeps running until the queue.send() actually completes.
 */
class CloudflareMessageQueue implements MessageQueue {
  private inner: WorkersMessageQueue;
  private waitUntilFn: ((promise: Promise<unknown>) => void) | null;

  constructor(queue: Queue, waitUntilFn?: (promise: Promise<unknown>) => void) {
    this.inner = new WorkersMessageQueue(queue);
    this.waitUntilFn = waitUntilFn ?? null;
  }

  enqueue(
    message: any,
    options?: any,
  ): Promise<void> {
    const promise = this.inner.enqueue(message, options);
    // Register with waitUntil so Cloudflare doesn't kill the Worker
    // before the queue.send() completes (Fedify doesn't await fanout enqueue)
    if (this.waitUntilFn) {
      this.waitUntilFn(promise);
    }
    return promise;
  }

  async listen(
    _handler: (message: any) => Promise<void> | void,
    _options?: any,
  ): Promise<void> {
    // No-op: Cloudflare Workers use processQueuedTask() in the queue consumer.
    // WorkersMessageQueue.listen() throws TypeError by design.
  }
}

/**
 * Create a Fedify Federation instance for this request.
 *
 * @param env Cloudflare Workers Env bindings
 * @param waitUntilFn Optional ctx.waitUntil() function from the Hono context
 *                     to keep the Worker alive for fire-and-forget enqueues
 * @returns Configured Federation instance
 */
export function createFed(
  env: Env,
  waitUntilFn?: (promise: Promise<unknown>) => void,
): Federation<FedifyContextData> {
  return createFederation<FedifyContextData>({
    kv: new WorkersKvStore(env.FEDIFY_KV as unknown as import('@cloudflare/workers-types/experimental').KVNamespace),
    queue: new CloudflareMessageQueue(env.QUEUE_FEDERATION, waitUntilFn),
    userAgent: {
      software: 'SiliconBeest/1.0',
      url: new URL(`https://${env.INSTANCE_DOMAIN}/`),
    },
  });
}
