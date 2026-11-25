// Wire types shared with the browser. Dependency-free so UIs can import
// them via "@deck/server/types" without pulling in Hono.

/** GET /api/auth/session, and the response of login/logout. */
export interface SessionInfo {
  /** False when the deck runs with --no-auth. */
  authRequired: boolean;
  authenticated: boolean;
  username: string | null;
}
