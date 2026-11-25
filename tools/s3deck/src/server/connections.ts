import { randomUUID } from 'node:crypto';
import { ListBucketsCommand } from '@aws-sdk/client-s3';
import { createS3Client, type ClientConfig, type S3Handle } from '../s3/client';
import { isAccessDenied } from '../s3/errors';
import { headBucket } from '../s3/buckets';
import { refineProvider, type ProviderInfo } from '../s3/provider';
import type { ConnectionInfo } from '../shared/types';
import { HttpError } from './errors';
import type { Session } from './sessions';
import type { SavedConnection } from './store/saved-connections';

export interface ConnectionSpec extends ClientConfig {
  label?: string;
  source: 'cli' | 'browser' | 'saved';
  ownerSessionId?: string;
  ownerUser?: string;
  id?: string;
  accessKeyId?: string;
  pinnedBuckets: string[];
  publicUrlBase?: string | null;
}

export interface Connection {
  id: string;
  label: string;
  source: 'cli' | 'browser' | 'saved';
  /** Browser connections belong to the session that added them… */
  ownerSessionId?: string;
  /** …remembered ones to the user. */
  ownerUser?: string;
  handle: S3Handle;
  provider: ProviderInfo;
  endpoint: string | null;
  region: string;
  accessKeyHint: string | null;
  pinnedBuckets: string[];
  publicUrlBase: string | null;
}

export function maskKey(id: string | undefined): string | null {
  if (!id) return null;
  if (id.length <= 8) return '••••';
  return `${id.slice(0, 4)}…${id.slice(-4)}`;
}

export function connectionInfo(c: Connection): ConnectionInfo {
  return {
    id: c.id,
    label: c.label,
    provider: c.provider.id,
    providerName: c.provider.name,
    endpoint: c.endpoint,
    region: c.region,
    pathStyle: c.handle.forcePathStyle,
    source: c.source,
    accessKeyHint: c.accessKeyHint,
    pinnedBuckets: c.pinnedBuckets,
    publicUrlBase: c.publicUrlBase,
    capabilities: c.provider.capabilities,
  };
}

export interface ProbeResult {
  connection: Connection;
  /** Number of buckets visible, or null when the key can't list buckets. */
  bucketCount: number | null;
}

/**
 * Builds a client and checks the credentials work: ListBuckets, or HeadBucket on the
 * pinned buckets when the key isn't allowed to list.
 */
export async function openConnection(spec: ConnectionSpec): Promise<ProbeResult> {
  const handle = createS3Client(spec);
  let bucketCount: number | null = null;
  try {
    const out = await handle.client.send(new ListBucketsCommand({}));
    bucketCount = out.Buckets?.length ?? 0;
  } catch (err) {
    if (!isAccessDenied(err) || spec.pinnedBuckets.length === 0) {
      handle.client.destroy();
      throw err;
    }
    try {
      await headBucket(handle.client, spec.pinnedBuckets[0] as string);
    } catch (headErr) {
      handle.client.destroy();
      throw headErr;
    }
  }

  const provider = refineProvider(handle.provider, handle.serverHeader());
  handle.provider = provider;
  return { bucketCount, connection: buildConnection(spec, handle) };
}

function defaultLabel(spec: ConnectionSpec, providerName: string) {
  return spec.label?.trim() || (spec.endpoint ? `${providerName} · ${new URL(spec.endpoint).host}` : `${providerName} · ${spec.region}`);
}

function buildConnection(spec: ConnectionSpec, handle: S3Handle): Connection {
  const provider = handle.provider;
  return {
    id: spec.id ?? (spec.source === 'cli' ? 'default' : randomUUID()),
    label: defaultLabel(spec, provider.name),
    source: spec.source,
    ownerSessionId: spec.ownerSessionId,
    ownerUser: spec.ownerUser,
    handle,
    provider,
    endpoint: spec.endpoint || null,
    region: spec.region,
    accessKeyHint: maskKey(spec.accessKeyId),
    pinnedBuckets: spec.pinnedBuckets,
    publicUrlBase: spec.publicUrlBase || null,
  };
}

/** Rebuilds a remembered connection without probing it (that happens on first use). */
export function connectionFromSaved(item: SavedConnection): Connection {
  const spec: ConnectionSpec = {
    id: item.id,
    source: 'saved',
    ownerUser: item.owner,
    label: item.label,
    endpoint: item.endpoint,
    region: item.region,
    pathStyle: item.pathStyle,
    accessKeyId: item.accessKeyId,
    credentials: { accessKeyId: item.accessKeyId, secretAccessKey: item.secretAccessKey, sessionToken: item.sessionToken },
    pinnedBuckets: item.buckets,
    publicUrlBase: item.publicUrlBase,
  };
  return buildConnection(spec, createS3Client(spec));
}

const MAX_BROWSER_CONNECTIONS_PER_SESSION = 10;

/**
 * All live connections. The startup ("cli") connection is shared by every session;
 * connections added from the browser belong to the session that added them.
 */
export class ConnectionRegistry {
  private connections = new Map<string, Connection>();
  defaultId: string | null = null;

  setDefault(c: Connection) {
    this.connections.set(c.id, c);
    this.defaultId = c.id;
  }

  /** Adds a connection owned by a session or user. */
  add(c: Connection) {
    this.connections.set(c.id, c);
  }

  addForSession(c: Connection) {
    const owned = [...this.connections.values()].filter(
      (x) => (c.ownerSessionId && x.ownerSessionId === c.ownerSessionId) || (c.ownerUser && x.ownerUser === c.ownerUser),
    );
    if (owned.length >= MAX_BROWSER_CONNECTIONS_PER_SESSION) {
      c.handle.client.destroy();
      throw new HttpError(400, 'TOO_MANY_CONNECTIONS', `At most ${MAX_BROWSER_CONNECTIONS_PER_SESSION} connections per session`);
    }
    this.connections.set(c.id, c);
  }

  private visible(c: Connection, session: Pick<Session, 'id' | 'user'>): boolean {
    if (c.source === 'cli') return true;
    if (c.source === 'browser') return c.ownerSessionId === session.id;
    return c.ownerUser === session.user;
  }

  /** Returns the connection if this session may use it. */
  getForSession(id: string | null | undefined, session: Pick<Session, 'id' | 'user'>): Connection | null {
    if (!id) return null;
    const c = this.connections.get(id);
    return c && this.visible(c, session) ? c : null;
  }

  listForSession(session: Pick<Session, 'id' | 'user'>): Connection[] {
    const order = { cli: 0, saved: 1, browser: 2 };
    return [...this.connections.values()].filter((c) => this.visible(c, session)).sort((a, b) => order[a.source] - order[b.source]);
  }

  remove(id: string) {
    const c = this.connections.get(id);
    if (!c) return;
    this.connections.delete(id);
    c.handle.client.destroy();
  }

  removeOwnedBy(sessionId: string) {
    // Copy first: remove() deletes from the map being walked.
    // oxlint-disable-next-line unicorn/no-useless-spread
    for (const c of [...this.connections.values()]) if (c.ownerSessionId === sessionId) this.remove(c.id);
  }
}
