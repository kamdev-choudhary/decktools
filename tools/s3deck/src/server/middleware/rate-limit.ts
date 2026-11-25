interface Bucket {
  count: number;
  resetAt: number;
}

/** Fixed-window counter per client address (used for failed logins). */
export class RateLimiter {
  private hits = new Map<string, Bucket>();

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
  ) {}

  /** Seconds until the client may try again, or 0 if allowed. */
  retryAfter(key: string): number {
    const b = this.hits.get(key);
    if (!b || b.resetAt <= Date.now()) return 0;
    return b.count >= this.max ? Math.ceil((b.resetAt - Date.now()) / 1000) : 0;
  }

  hit(key: string) {
    const now = Date.now();
    let b = this.hits.get(key);
    if (!b || b.resetAt <= now) {
      b = { count: 0, resetAt: now + this.windowMs };
      this.hits.set(key, b);
    }
    b.count++;
    if (this.hits.size > 10_000) {
      for (const [k, v] of this.hits) if (v.resetAt <= now) this.hits.delete(k);
    }
  }

  reset(key: string) {
    this.hits.delete(key);
  }
}
