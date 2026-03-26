/**
 * RemoteServerActorDO — Circuit Breaker for Outbound Federation Delivery
 *
 * One DO instance per remote domain (keyed by hostname).  Acts as a stateful
 * coordinator so the federation worker can avoid hammering servers that are
 * repeatedly failing.
 *
 * Elixir analogy: a GenServer per remote host with a state machine mailbox.
 * The DO's serialised fetch() IS the mailbox — Cloudflare guarantees serial
 * execution, so no concurrent state mutations are possible.
 *
 * Circuit states (mirrors Elixir's :fuse library):
 *   closed    — delivering normally
 *   open      — too many failures, reject immediately
 *   half-open — cooldown elapsed, allow one probe request through
 *
 * The federation worker calls this DO before and after each delivery attempt:
 *   GET  /circuit  → { state, domain }
 *   POST /success  → records a successful delivery, closes circuit if half-open
 *   POST /failure  → records a failure, may open the circuit
 */

import { DurableObject } from 'cloudflare:workers';

type CircuitState = 'closed' | 'open' | 'half-open';

interface CircuitBreakerState {
  state: CircuitState;
  failureCount: number;
  lastFailureAt: number; // epoch ms
}

const FAILURE_THRESHOLD = 5;       // open circuit after this many consecutive failures
const COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes before transitioning open → half-open

export class RemoteServerActorDO extends DurableObject {
  private domain: string = 'unknown';

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // Extract domain from path: /circuit, /success, /failure
    // The DO is keyed by idFromName(domain) so we recover it from storage.
    if (!this.domain || this.domain === 'unknown') {
      this.domain = (await this.ctx.storage.get<string>('domain')) ?? 'unknown';
    }

    if (url.pathname === '/circuit' && request.method === 'GET') {
      const cb = await this.getState();
      const resolved = this.resolveState(cb);
      return Response.json({ state: resolved, domain: this.domain });
    }

    if (url.pathname === '/init' && request.method === 'POST') {
      const { domain } = await request.json<{ domain: string }>();
      this.domain = domain;
      await this.ctx.storage.put('domain', domain);
      return Response.json({ ok: true });
    }

    if (url.pathname === '/success' && request.method === 'POST') {
      await this.recordSuccess();
      return Response.json({ ok: true });
    }

    if (url.pathname === '/failure' && request.method === 'POST') {
      const newState = await this.recordFailure();
      return Response.json({ state: newState });
    }

    return new Response('Not found', { status: 404 });
  }

  // -------------------------------------------------------------------------
  // State machine helpers
  // -------------------------------------------------------------------------

  private async getState(): Promise<CircuitBreakerState> {
    return (await this.ctx.storage.get<CircuitBreakerState>('cb')) ?? {
      state: 'closed',
      failureCount: 0,
      lastFailureAt: 0,
    };
  }

  /** Apply time-based auto-transition from open → half-open. */
  private resolveState(cb: CircuitBreakerState): CircuitState {
    if (cb.state === 'open' && Date.now() - cb.lastFailureAt >= COOLDOWN_MS) {
      return 'half-open';
    }
    return cb.state;
  }

  private async recordSuccess(): Promise<void> {
    const cb = await this.getState();
    await this.ctx.storage.put<CircuitBreakerState>('cb', {
      state: 'closed',
      failureCount: 0,
      lastFailureAt: cb.lastFailureAt,
    });
  }

  private async recordFailure(): Promise<CircuitState> {
    const cb = await this.getState();
    const failureCount = cb.failureCount + 1;
    const nowOpen = failureCount >= FAILURE_THRESHOLD;
    const next: CircuitBreakerState = {
      state: nowOpen ? 'open' : 'closed',
      failureCount,
      lastFailureAt: Date.now(),
    };
    await this.ctx.storage.put<CircuitBreakerState>('cb', next);
    return next.state;
  }
}
