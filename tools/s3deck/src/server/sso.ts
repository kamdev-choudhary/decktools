import * as oidc from 'openid-client';
import type { Role } from '../shared/types';

export interface SsoConfig {
  issuer: string;
  clientId: string;
  clientSecret: string | undefined;
  /** Button text, e.g. "Sign in with Google". */
  label: string;
  /** Emails ("ann@example.com") or domains ("@example.com") allowed to sign in. Empty: only users in users.json. */
  allow: string[];
  /** Role for allowed people who aren't in users.json. */
  defaultRole: Role;
}

/** SSO settings from the environment, or null when not configured. */
export function ssoConfigFromEnv(env = process.env): SsoConfig | null {
  const issuer = env.S3DECK_OIDC_ISSUER;
  const clientId = env.S3DECK_OIDC_CLIENT_ID;
  if (!issuer || !clientId) return null;
  const role = env.S3DECK_OIDC_DEFAULT_ROLE;
  return {
    issuer,
    clientId,
    clientSecret: env.S3DECK_OIDC_CLIENT_SECRET || undefined,
    label: env.S3DECK_OIDC_LABEL || 'Sign in with SSO',
    allow: (env.S3DECK_OIDC_ALLOW ?? '')
      .split(/[\s,]+/)
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
    defaultRole: role === 'editor' || role === 'admin' ? role : 'viewer',
  };
}

interface Pending {
  verifier: string;
  nonce: string;
  redirectUri: string;
  createdAt: number;
}

const PENDING_TTL_MS = 10 * 60 * 1000;

/** OpenID Connect sign-in (authorization code flow with PKCE). */
export class SsoService {
  private configuration: Promise<oidc.Configuration> | null = null;
  private pending = new Map<string, Pending>();

  constructor(readonly config: SsoConfig) {}

  private discover(): Promise<oidc.Configuration> {
    this.configuration ??= oidc
      .discovery(new URL(this.config.issuer), this.config.clientId, this.config.clientSecret)
      .catch((err: unknown) => {
        this.configuration = null; // retry discovery next time
        throw err;
      });
    return this.configuration;
  }

  /** Whether someone not in users.json may sign in, and with which role. */
  defaultRoleFor(email: string): Role | null {
    const e = email.toLowerCase();
    const domain = e.slice(e.indexOf('@'));
    return this.config.allow.includes(e) || this.config.allow.includes(domain) ? this.config.defaultRole : null;
  }

  async authorizationUrl(redirectUri: string): Promise<string> {
    const config = await this.discover();
    this.sweep();
    const verifier = oidc.randomPKCECodeVerifier();
    const state = oidc.randomState();
    const nonce = oidc.randomNonce();
    this.pending.set(state, { verifier, nonce, redirectUri, createdAt: Date.now() });
    return oidc
      .buildAuthorizationUrl(config, {
        redirect_uri: redirectUri,
        scope: 'openid email profile',
        code_challenge: await oidc.calculatePKCECodeChallenge(verifier),
        code_challenge_method: 'S256',
        state,
        nonce,
      })
      .toString();
  }

  /** Exchanges the code for tokens and returns the verified email. */
  async finish(callbackUrl: URL): Promise<{ email: string; name: string | null }> {
    const state = callbackUrl.searchParams.get('state') ?? '';
    const pending = this.pending.get(state);
    this.pending.delete(state);
    if (!pending || Date.now() - pending.createdAt > PENDING_TTL_MS)
      throw new Error('Sign-in expired. Please try again.');

    const config = await this.discover();
    const tokens = await oidc.authorizationCodeGrant(config, callbackUrl, {
      pkceCodeVerifier: pending.verifier,
      expectedState: state,
      expectedNonce: pending.nonce,
    });
    const claims = tokens.claims();
    const email = typeof claims?.email === 'string' ? claims.email : null;
    if (!email) throw new Error('The identity provider did not share an email address.');
    if (claims?.email_verified === false)
      throw new Error('Your email address is not verified with the identity provider.');
    return { email, name: typeof claims?.name === 'string' ? claims.name : null };
  }

  private sweep() {
    const now = Date.now();
    for (const [k, v] of this.pending) if (now - v.createdAt > PENDING_TTL_MS) this.pending.delete(k);
  }
}
