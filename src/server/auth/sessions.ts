import crypto from 'node:crypto';

const IDLE_TIMEOUT_MS = 12 * 60 * 60 * 1000; // 12h without activity
const ABSOLUTE_TIMEOUT_MS = 7 * 24 * 60 * 60 * 1000; // 7 days max

interface Session {
  username: string;
  createdAt: number;
  lastSeen: number;
}

/**
 * In-memory login sessions. pgdeck is a single process started on demand, so
 * restarting it logging everyone out is the desired behaviour.
 */
export class SessionStore {
  private readonly sessions = new Map<string, Session>();

  create(username: string): string {
    this.sweep();
    const token = crypto.randomBytes(32).toString('base64url');
    const now = Date.now();
    this.sessions.set(token, { username, createdAt: now, lastSeen: now });
    return token;
  }

  /** Returns the username for a valid token and extends its idle window. */
  touch(token: string | undefined): string | null {
    if (!token) return null;
    const s = this.sessions.get(token);
    if (!s) return null;
    const now = Date.now();
    if (now - s.lastSeen > IDLE_TIMEOUT_MS || now - s.createdAt > ABSOLUTE_TIMEOUT_MS) {
      this.sessions.delete(token);
      return null;
    }
    s.lastSeen = now;
    return s.username;
  }

  revoke(token: string | undefined): void {
    if (token) this.sessions.delete(token);
  }

  private sweep(): void {
    const now = Date.now();
    for (const [token, s] of this.sessions) {
      if (now - s.lastSeen > IDLE_TIMEOUT_MS || now - s.createdAt > ABSOLUTE_TIMEOUT_MS) this.sessions.delete(token);
    }
  }
}

/** Fixed-window limiter for failed logins, keyed by client address. */
export class LoginLimiter {
  private readonly failures = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly maxFailures = 10,
    private readonly windowMs = 10 * 60 * 1000,
  ) {}

  /** Seconds until the client may try again, or 0 if allowed. */
  retryAfter(key: string): number {
    const f = this.failures.get(key);
    if (!f || Date.now() > f.resetAt) return 0;
    return f.count >= this.maxFailures ? Math.ceil((f.resetAt - Date.now()) / 1000) : 0;
  }

  fail(key: string): void {
    const now = Date.now();
    const f = this.failures.get(key);
    if (!f || now > f.resetAt) this.failures.set(key, { count: 1, resetAt: now + this.windowMs });
    else f.count++;
  }

  succeed(key: string): void {
    this.failures.delete(key);
  }
}

const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest();

/** Constant-time string comparison (hashing first equalizes lengths). */
export const safeEqual = (a: string, b: string): boolean => crypto.timingSafeEqual(sha256(a), sha256(b));
