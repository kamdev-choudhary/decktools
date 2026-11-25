import { randomBytes } from 'node:crypto';

export interface ZipRequest {
  sessionId: string;
  connectionId: string;
  bucket: string;
  base: string;
  keys: string[];
  prefixes: string[];
  name: string;
  expiresAt: number;
}

const TTL_MS = 5 * 60 * 1000;

/**
 * ZIP downloads are started with a POST (so the selection can be large and the request
 * carries the CSRF header), which returns a one-time token the browser then GETs.
 */
export class ZipTokens {
  private tokens = new Map<string, ZipRequest>();

  create(req: Omit<ZipRequest, 'expiresAt'>): string {
    this.sweep();
    const token = randomBytes(24).toString('base64url');
    this.tokens.set(token, { ...req, expiresAt: Date.now() + TTL_MS });
    return token;
  }

  /** Returns and removes the request, if it exists, hasn't expired and belongs to the session. */
  take(token: string, sessionId: string): ZipRequest | null {
    const req = this.tokens.get(token);
    if (!req) return null;
    this.tokens.delete(token);
    if (req.expiresAt < Date.now() || req.sessionId !== sessionId) return null;
    return req;
  }

  private sweep() {
    const now = Date.now();
    for (const [t, r] of this.tokens) if (r.expiresAt < now) this.tokens.delete(t);
  }
}
