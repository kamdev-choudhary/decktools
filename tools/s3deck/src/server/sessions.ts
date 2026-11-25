import { randomBytes } from 'node:crypto';
import type { Role } from '../shared/types';

/** How the user signed in. The role is re-checked on every request for "local" and "sso" users. */
export type AuthSource = 'bootstrap' | 'local' | 'sso' | 'anonymous';

export interface Session {
  id: string;
  user: string;
  source: AuthSource;
  role: Role;
  createdAt: number;
  lastSeen: number;
  activeConnectionId: string | null;
}

const IDLE_TIMEOUT_MS = 12 * 60 * 60 * 1000; // 12 hours
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/** In-memory sessions. Restarting s3deck logs everyone out. */
export class SessionStore {
  private sessions = new Map<string, Session>();
  private listeners: ((s: Session) => void)[] = [];
  private timer: NodeJS.Timeout;

  constructor() {
    this.timer = setInterval(() => this.sweep(), 10 * 60 * 1000);
    this.timer.unref();
  }

  /** Called whenever a session ends (logout or expiry). */
  onDestroy(fn: (s: Session) => void) {
    this.listeners.push(fn);
  }

  create(user: string, source: AuthSource, role: Role, activeConnectionId: string | null): Session {
    const now = Date.now();
    const session: Session = {
      id: randomBytes(32).toString('base64url'),
      user,
      source,
      role,
      createdAt: now,
      lastSeen: now,
      activeConnectionId,
    };
    this.sessions.set(session.id, session);
    return session;
  }

  get(id: string | undefined): Session | null {
    if (!id) return null;
    const s = this.sessions.get(id);
    if (!s) return null;
    const now = Date.now();
    if (now - s.lastSeen > IDLE_TIMEOUT_MS || now - s.createdAt > MAX_AGE_MS) {
      this.destroy(id);
      return null;
    }
    s.lastSeen = now;
    return s;
  }

  destroy(id: string) {
    const s = this.sessions.get(id);
    if (!s) return;
    this.sessions.delete(id);
    for (const fn of this.listeners) fn(s);
  }

  /** Points every session at `to` when connection `from` goes away. */
  reassign(from: string, to: string | null) {
    for (const s of this.sessions.values()) if (s.activeConnectionId === from) s.activeConnectionId = to;
  }

  private sweep() {
    // Copy first: get() deletes expired sessions from the map being walked.
    // oxlint-disable-next-line unicorn/no-useless-spread
    for (const id of [...this.sessions.keys()]) this.get(id);
  }

  close() {
    clearInterval(this.timer);
  }
}
