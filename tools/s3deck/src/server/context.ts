import type { ActivityLog } from './store/activity';
import type { SavedConnectionStore } from './store/saved-connections';
import type { UserStore } from './store/users';
import type { ConnectionRegistry, Connection } from './connections';
import type { JobRegistry } from './jobs';
import type { RateLimiter } from './middleware/rate-limit';
import type { Session, SessionStore } from './sessions';
import type { SsoService } from './sso';
import type { ZipTokens } from './zip-tokens';

export interface ServerConfig {
  host: string;
  port: number;
  /** "" or a prefix like "/s3" (no trailing slash). */
  basePath: string;
  /** The startup ("bootstrap") admin login. */
  auth: { enabled: boolean; user: string; password: string };
  readonly: boolean;
  version: string;
  /** Directory of the built web UI, or null in dev (Vite serves it). */
  webRoot: string | null;
  /** Lets users add their own credentials from the browser. */
  allowBrowserConnections: boolean;
  /** Where users, remembered connections and the activity log live; null when unavailable. */
  dataDir: string | null;
  /** Public URL of this s3deck, used for single sign-on redirects. Derived from the request if unset. */
  publicUrl: string | null;
  dev: boolean;
}

export interface ServerContext {
  config: ServerConfig;
  sessions: SessionStore;
  connections: ConnectionRegistry;
  zipTokens: ZipTokens;
  loginLimiter: RateLimiter;
  users: UserStore | null;
  saved: SavedConnectionStore | null;
  activity: ActivityLog;
  jobs: JobRegistry;
  sso: SsoService | null;
}

export type AppEnv = {
  Variables: {
    session: Session | null;
    conn: Connection;
  };
};

export type AuthedEnv = {
  Variables: {
    session: Session;
    conn: Connection;
  };
};
