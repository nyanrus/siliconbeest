/**
 * Shared CloudflareMessageQueue
 *
 * A structural wrapper that makes an inner queue's listen() a no-op and
 * optionally registers enqueue() Promises with ctx.waitUntil() so that
 * fire-and-forget calls (Fedify's fanout enqueue) survive until completion
 * in Cloudflare Workers.
 *
 * This file must NOT import from @fedify/fedify or @fedify/cfworkers.
 * Callers construct their own WorkersMessageQueue and pass it as innerQueue.
 */

/**
 * Structural interface matching the subset of MessageQueue used here.
 * Avoids importing from @fedify/fedify.
 */
export interface MessageQueueLike {
  enqueue(message: unknown, options?: Record<string, unknown>): Promise<void>;
  listen(
    handler: (message: unknown) => Promise<void> | void,
    options?: Record<string, unknown>,
  ): Promise<void>;
}

/**
 * Structural interface for the inner queue accepted by CloudflareMessageQueue.
 * Callers pass `new WorkersMessageQueue(env.QUEUE_FEDERATION)` which satisfies this.
 */
export interface InnerQueue {
  enqueue(message: unknown, options?: unknown): Promise<void>;
}

export interface CloudflareMessageQueueOptions {
  /**
   * Optional — provide to register enqueue Promises with ctx.waitUntil().
   * Required in the Worker context where Fedify calls enqueue() fire-and-forget.
   * Can be updated per-request via setWaitUntilFn().
   */
  waitUntilFn?: ((promise: Promise<unknown>) => void) | null;
}

/**
 * Wrapper around an inner queue (WorkersMessageQueue) for Cloudflare Workers
 * compatibility.
 *
 * Two critical behaviors:
 *
 * 1. listen() is a no-op — WorkersMessageQueue.listen() throws by design
 *    because Cloudflare Workers use processQueuedTask() in the queue consumer.
 *    Fedify's sendActivity() calls listen() internally as a side-effect.
 *
 * 2. enqueue() uses ctx.waitUntil() when waitUntilFn is set — Fedify's
 *    sendActivity() calls fanoutQueue.enqueue() WITHOUT await (fire-and-forget).
 *    In Cloudflare Workers, un-awaited Promises are killed when the response is
 *    sent. Registering each enqueue Promise with waitUntil() keeps the Worker
 *    alive until queue.send() actually completes.
 */
export class CloudflareMessageQueue implements MessageQueueLike {
  private inner: InnerQueue;
  /** Mutable — updated per-request via setWaitUntilFn() in the Worker. */
  waitUntilFn: ((promise: Promise<unknown>) => void) | null;

  constructor(innerQueue: InnerQueue, options?: CloudflareMessageQueueOptions) {
    this.inner = innerQueue;
    this.waitUntilFn = options?.waitUntilFn ?? null;
  }

  /** Update the per-request waitUntil function (call at request start in Worker). */
  setWaitUntilFn(fn: (promise: Promise<unknown>) => void): void {
    this.waitUntilFn = fn;
  }

  enqueue(message: unknown, options?: Record<string, unknown>): Promise<void> {
    const promise = this.inner.enqueue(message, options).catch((err: unknown) => {
      console.error(
        `[queue-wrapper] enqueue FAILED, type=${(message as Record<string, unknown>)?.type}:`,
        err,
      );
      throw err;
    });
    // Register with waitUntil so Cloudflare doesn't kill the Worker
    // before the queue.send() completes (Fedify doesn't await fanout enqueue).
    if (this.waitUntilFn) {
      this.waitUntilFn(promise);
    }
    return promise;
  }

  async listen(
    _handler: (message: unknown) => Promise<void> | void,
    _options?: Record<string, unknown>,
  ): Promise<void> {
    // No-op: Cloudflare Workers use processQueuedTask() in the queue consumer.
    // WorkersMessageQueue.listen() throws TypeError by design.
  }
}
