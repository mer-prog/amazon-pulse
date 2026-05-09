/**
 * Classic token-bucket rate limiter.
 *
 * Bucket starts full (`burst` tokens) and refills at `rate` tokens per second
 * up to `burst`. `waitForToken()` consumes one token, blocking when none are
 * available. `drain(durationMs)` empties the bucket and suppresses refill for
 * the given duration — used as a back-off when SP-API returns HTTP 429 so the
 * coexisting axios-retry layer doesn't immediately re-fire requests that the
 * bucket would otherwise admit.
 *
 * Waiters are released in FIFO order. The implementation uses a single
 * `setTimeout` at any moment, scheduled for the next instant a waiter can
 * proceed; new arrivals piggy-back on the existing timer when possible.
 *
 * Hand-rolled rather than pulled from `p-queue` so we keep dependency
 * footprint small and have first-class control over the drain semantics.
 */

export interface TokenBucketOptions {
  /** Steady-state refill rate, in tokens per second. Must be > 0. */
  readonly rate: number;
  /** Maximum bucket capacity (and initial fill). Must be >= 1. */
  readonly burst: number;
  /** Injectable clock for tests. Defaults to `Date.now`. */
  readonly now?: () => number;
  /**
   * Injectable timer for tests. Defaults to globalThis.setTimeout. Returns an
   * opaque handle that is passed back to `clearTimer`.
   */
  readonly setTimer?: (fn: () => void, ms: number) => unknown;
  readonly clearTimer?: (handle: unknown) => void;
}

const defaultSetTimer = (fn: () => void, ms: number): unknown => setTimeout(fn, ms);
const defaultClearTimer = (h: unknown): void => clearTimeout(h as ReturnType<typeof setTimeout>);

export class TokenBucket {
  private tokens: number;
  private lastRefill: number;
  /** Refill is suppressed (and tokens stay at 0) until this wall-clock time. */
  private drainUntil = 0;
  private readonly waiters: Array<() => void> = [];
  private scheduledHandle: unknown = null;

  private readonly now: () => number;
  private readonly setTimer: (fn: () => void, ms: number) => unknown;
  private readonly clearTimer: (handle: unknown) => void;

  constructor(private readonly opts: TokenBucketOptions) {
    if (!(opts.rate > 0)) throw new Error('TokenBucket: rate must be > 0');
    if (!(opts.burst >= 1)) throw new Error('TokenBucket: burst must be >= 1');
    this.now = opts.now ?? Date.now;
    this.setTimer = opts.setTimer ?? defaultSetTimer;
    this.clearTimer = opts.clearTimer ?? defaultClearTimer;
    this.tokens = opts.burst;
    this.lastRefill = this.now();
  }

  /**
   * Block until a token is available, then consume one. Resolves immediately
   * when a token can be taken without waiting.
   */
  waitForToken(): Promise<void> {
    if (this.waiters.length === 0) {
      this.refill();
      if (this.tokens >= 1) {
        this.tokens -= 1;
        return Promise.resolve();
      }
    }
    return new Promise<void>((resolve) => {
      this.waiters.push(resolve);
      this.scheduleNextWake();
    });
  }

  /**
   * Empty the bucket and suppress refill for `durationMs`. Used as the 429
   * back-off hook so axios-retry's exponential-delay budget is the only
   * source of delay during a throttled burst (the bucket isn't independently
   * admitting requests in the meantime).
   *
   * Successive calls take the larger of (existing drainUntil, now+durationMs)
   * so overlapping back-offs don't shorten an in-flight one.
   */
  drain(durationMs: number): void {
    if (durationMs < 0) throw new Error('TokenBucket: drain durationMs must be >= 0');
    const target = this.now() + durationMs;
    if (target > this.drainUntil) this.drainUntil = target;
    this.tokens = 0;
    // Reschedule any pending waiter wake-up against the new drainUntil.
    if (this.waiters.length > 0) this.scheduleNextWake(true);
  }

  /** Test helper: current token count after a virtual refill. */
  snapshot(): { tokens: number; drainUntil: number; waiters: number } {
    this.refill();
    return { tokens: this.tokens, drainUntil: this.drainUntil, waiters: this.waiters.length };
  }

  // ── internals ────────────────────────────────────────────────────────────

  private refill(): void {
    const now = this.now();
    if (now < this.drainUntil) {
      this.tokens = 0;
      this.lastRefill = now;
      return;
    }
    // Don't credit refill that would have happened during the drain window.
    const start = Math.max(this.lastRefill, this.drainUntil);
    if (now <= start) {
      this.lastRefill = now;
      return;
    }
    const elapsedSec = (now - start) / 1000;
    this.tokens = Math.min(this.opts.burst, this.tokens + elapsedSec * this.opts.rate);
    this.lastRefill = now;
  }

  private timeUntilNextToken(): number {
    const now = this.now();
    const drainBlockMs = Math.max(0, this.drainUntil - now);
    const tokensNeeded = Math.max(0, 1 - this.tokens);
    const refillMs = tokensNeeded > 0 ? (tokensNeeded / this.opts.rate) * 1000 : 0;
    return Math.max(drainBlockMs, refillMs);
  }

  private scheduleNextWake(force = false): void {
    if (this.scheduledHandle !== null) {
      if (!force) return;
      this.clearTimer(this.scheduledHandle);
      this.scheduledHandle = null;
    }
    if (this.waiters.length === 0) return;
    const waitMs = this.timeUntilNextToken();
    this.scheduledHandle = this.setTimer(() => this.onWake(), Math.max(0, Math.ceil(waitMs)));
  }

  private onWake(): void {
    this.scheduledHandle = null;
    this.refill();
    while (this.waiters.length > 0 && this.tokens >= 1) {
      this.tokens -= 1;
      const next = this.waiters.shift();
      if (next) next();
    }
    if (this.waiters.length > 0) this.scheduleNextWake();
  }
}
