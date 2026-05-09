import { describe, it, expect, beforeEach } from 'vitest';
import { TokenBucket } from '../../src/lib/token-bucket.js';

/**
 * Deterministic virtual scheduler for token-bucket tests. The bucket only
 * touches the outside world via `now()` and `setTimer`/`clearTimer`, so by
 * injecting these we get full control of time without real timers or fake
 * timers from vitest.
 */
class VirtualScheduler {
  private currentTime = 0;
  private nextId = 1;
  private timers: Array<{ id: number; at: number; fn: () => void }> = [];

  now = (): number => this.currentTime;

  setTimer = (fn: () => void, ms: number): number => {
    const id = this.nextId++;
    this.timers.push({ id, at: this.currentTime + Math.max(0, ms), fn });
    this.timers.sort((a, b) => a.at - b.at);
    return id;
  };

  clearTimer = (handle: unknown): void => {
    this.timers = this.timers.filter((t) => t.id !== handle);
  };

  /**
   * Move the clock forward by `ms`, firing all timers due in that window in
   * order. Yields microtasks between firings so awaiting promise chains can
   * settle before the next timer runs.
   */
  async advance(ms: number): Promise<void> {
    const target = this.currentTime + ms;
    // Loop because timers can install new timers whose `at` falls before target.
    while (this.timers.length > 0 && this.timers[0]!.at <= target) {
      const t = this.timers.shift()!;
      this.currentTime = t.at;
      t.fn();
      // Drain microtasks so resolvers in the timer body run before the next.
      await flushMicrotasks();
    }
    this.currentTime = target;
    await flushMicrotasks();
  }
}

async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 4; i++) await Promise.resolve();
}

let scheduler: VirtualScheduler;

beforeEach(() => {
  scheduler = new VirtualScheduler();
});

function makeBucket(rate: number, burst: number): TokenBucket {
  return new TokenBucket({
    rate,
    burst,
    now: scheduler.now,
    setTimer: scheduler.setTimer,
    clearTimer: scheduler.clearTimer,
  });
}

describe('TokenBucket', () => {
  it('starts full at the burst capacity', () => {
    const bucket = makeBucket(1, 5);
    expect(bucket.snapshot().tokens).toBe(5);
  });

  it('admits up to `burst` requests immediately, then blocks', async () => {
    const bucket = makeBucket(1, 3);

    // First three resolve synchronously (no await needed beyond microtask).
    await bucket.waitForToken();
    await bucket.waitForToken();
    await bucket.waitForToken();
    expect(bucket.snapshot().tokens).toBeCloseTo(0, 5);

    let resolved = false;
    const blocked = bucket.waitForToken().then(() => {
      resolved = true;
    });

    // Even after a tiny advance, the next token is 1000ms away (rate=1/s).
    await scheduler.advance(500);
    expect(resolved).toBe(false);

    await scheduler.advance(500);
    await blocked;
    expect(resolved).toBe(true);
  });

  it('refills steadily at the configured rate after the bucket empties', async () => {
    const bucket = makeBucket(2, 2); // 2 tokens/sec, burst 2
    await bucket.waitForToken();
    await bucket.waitForToken();
    expect(bucket.snapshot().tokens).toBeCloseTo(0, 5);

    await scheduler.advance(500);
    // 500ms at 2/sec = 1 token of credit.
    expect(bucket.snapshot().tokens).toBeCloseTo(1, 5);

    await scheduler.advance(2_000);
    // Capped at burst.
    expect(bucket.snapshot().tokens).toBeCloseTo(2, 5);
  });

  it('serialises waiters in FIFO order', async () => {
    const bucket = makeBucket(1, 1);
    await bucket.waitForToken(); // drain initial token

    const order: number[] = [];
    const a = bucket.waitForToken().then(() => order.push(1));
    const b = bucket.waitForToken().then(() => order.push(2));
    const c = bucket.waitForToken().then(() => order.push(3));

    await scheduler.advance(1_000);
    await a;
    expect(order).toEqual([1]);

    await scheduler.advance(1_000);
    await b;
    expect(order).toEqual([1, 2]);

    await scheduler.advance(1_000);
    await c;
    expect(order).toEqual([1, 2, 3]);
  });

  it('drain() empties the bucket and suppresses refill for the given window', async () => {
    const bucket = makeBucket(10, 10);
    expect(bucket.snapshot().tokens).toBe(10);

    bucket.drain(500);
    expect(bucket.snapshot().tokens).toBe(0);

    // Half-way through the drain: still empty (no refill credit).
    await scheduler.advance(250);
    expect(bucket.snapshot().tokens).toBe(0);

    // After drain ends, refill resumes from drain-end, not from drain-start.
    await scheduler.advance(250); // drain just ended
    expect(bucket.snapshot().tokens).toBeCloseTo(0, 5);

    await scheduler.advance(100);
    expect(bucket.snapshot().tokens).toBeCloseTo(1, 5);
  });

  it('waitForToken() during a drain waits for both drain and refill', async () => {
    const bucket = makeBucket(2, 2); // 500ms per token after drain
    await bucket.waitForToken();
    await bucket.waitForToken(); // bucket empty

    bucket.drain(1_000);

    let resolved = false;
    const p = bucket.waitForToken().then(() => {
      resolved = true;
    });

    // During drain: definitely not resolved.
    await scheduler.advance(900);
    expect(resolved).toBe(false);

    // Drain ends at t=1000; need an additional 500ms for one token.
    await scheduler.advance(100); // t = 1000, drain over but tokens still 0
    expect(resolved).toBe(false);

    await scheduler.advance(500); // t = 1500, one token available
    await p;
    expect(resolved).toBe(true);
  });

  it('overlapping drain calls extend (never shorten) the drain window', async () => {
    const bucket = makeBucket(10, 10);
    bucket.drain(1_000); // ends at t=1000

    await scheduler.advance(500); // t=500
    bucket.drain(200); // would end at t=700 — should not shorten the existing 1000

    await scheduler.advance(300); // t=800, original drain still active
    expect(bucket.snapshot().tokens).toBe(0);

    await scheduler.advance(200); // t=1000, drain ends
    await scheduler.advance(100); // t=1100, refill should have produced 1 token
    expect(bucket.snapshot().tokens).toBeCloseTo(1, 5);
  });

  it('rejects misconfigured rate / burst values', () => {
    expect(() => new TokenBucket({ rate: 0, burst: 1 })).toThrow();
    expect(() => new TokenBucket({ rate: -1, burst: 1 })).toThrow();
    expect(() => new TokenBucket({ rate: 1, burst: 0 })).toThrow();
  });

  it('drain() with negative duration throws', () => {
    const bucket = makeBucket(1, 1);
    expect(() => bucket.drain(-1)).toThrow();
  });
});
