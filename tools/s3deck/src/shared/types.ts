/** Types shared by the server and the UI (API responses). */

export type ProviderId = 'aws' | 'r2' | 'minio' | 'b2' | 'spaces' | 'wasabi' | 'gcs' | 'other';

export interface Capabilities {
  versioning: boolean;
  tagging: boolean;
  bucketPolicy: boolean;
  publicAccessBlock: boolean;
  lifecycle: boolean;
  cors: boolean;
  bucketCreate: boolean;
  /** Storage classes objects can be moved between. Empty: not supported. */
  storageClasses: string[];
  /** Restoring archived (Glacier) objects. */
  archiveRestore: boolean;
  objectLock: boolean;
  encryption: boolean;
}

export type Role = 'viewer' | 'editor' | 'admin';

export interface ConnectionInfo {
  id: string;
  label: string;
  provider: ProviderId;
  providerName: string;
  endpoint: string | null;
  region: string;
  pathStyle: boolean;
  /** "cli": configured at startup. "browser": added from the UI for this session. "saved": remembered across restarts. */
  source: 'cli' | 'browser' | 'saved';
  /** Masked access key id, e.g. "AKIA…WXYZ". The secret never leaves the server. */
  accessKeyHint: string | null;
  pinnedBuckets: string[];
  publicUrlBase: string | null;
  capabilities: Capabilities;
}

export interface ConnectionsResponse {
  activeId: string | null;
  connections: ConnectionInfo[];
}

export interface MeResponse {
  authenticated: boolean;
  authRequired: boolean;
  user: string | null;
  readonly: boolean;
  /** Whether users may enter credentials in the browser. */
  browserConnections: boolean;
  version: string;
  role: Role | null;
  /** What this user may do. */
  can: { write: boolean; admin: boolean };
  /** Single sign-on (OpenID Connect), if configured. */
  sso: { enabled: boolean; label: string };
  /** Whether a data directory is available (remembered connections, users, activity log). */
  persistence: boolean;
}

export interface BucketInfo {
  name: string;
  createdAt: string | null;
  region: string | null;
}

export interface BucketsResponse {
  buckets: BucketInfo[];
  /** True when the key can't list buckets and we fell back to configured ones. */
  fallback: boolean;
}

export interface FolderEntry {
  type: 'folder';
  key: string;
  name: string;
}

export interface ObjectEntry {
  type: 'object';
  key: string;
  name: string;
  size: number;
  lastModified: string | null;
  etag: string | null;
  storageClass: string | null;
}

export type Entry = FolderEntry | ObjectEntry;

export interface ListResponse {
  prefix: string;
  folders: FolderEntry[];
  objects: ObjectEntry[];
  nextCursor: string | null;
}

export interface ObjectDetails {
  key: string;
  size: number;
  etag: string | null;
  lastModified: string | null;
  storageClass: string | null;
  versionId: string | null;
  contentType: string | null;
  cacheControl: string | null;
  contentDisposition: string | null;
  contentEncoding: string | null;
  metadata: Record<string, string>;
  headers: Record<string, string>;
  /** Null when the provider has no unsigned URL without a public URL base (e.g. R2). */
  publicUrl: string | null;
  encryption: { algorithm: string; kmsKeyId: string | null; bucketKeyEnabled: boolean } | null;
  lock: { mode: string | null; retainUntil: string | null; legalHold: boolean | null } | null;
  archive: {
    archived: boolean;
    /** "none": not requested; "in-progress": restore running; "restored": temporary copy available. */
    restore: 'none' | 'in-progress' | 'restored';
    restoreExpiry: string | null;
  };
}

export interface VersionEntry {
  versionId: string;
  isLatest: boolean;
  isDeleteMarker: boolean;
  size: number;
  lastModified: string | null;
  etag: string | null;
  storageClass: string | null;
}

export interface Tag {
  Key: string;
  Value: string;
}

export interface Setting<T> {
  supported: boolean;
  value: T;
  error?: string;
}

export interface BucketSettings {
  region: string | null;
  versioning: Setting<'Enabled' | 'Suspended' | 'Off'>;
  cors: Setting<unknown[]>;
  lifecycle: Setting<unknown[]>;
  policy: Setting<unknown | null>;
  publicAccessBlock: Setting<{
    BlockPublicAcls: boolean;
    IgnorePublicAcls: boolean;
    BlockPublicPolicy: boolean;
    RestrictPublicBuckets: boolean;
  } | null>;
  encryption: Setting<{ algorithm: string; kmsKeyId: string | null; bucketKeyEnabled: boolean } | null>;
  objectLock: Setting<{ enabled: boolean; mode: string | null; days: number | null; years: number | null } | null>;
}

export interface SummaryResponse {
  objects: number;
  bytes: number;
}

export interface UsageGroup {
  name: string;
  objects: number;
  bytes: number;
}

export interface UsageResponse extends SummaryResponse {
  prefix: string;
  byFolder: UsageGroup[];
  byStorageClass: UsageGroup[];
  durationMs: number;
}

export interface CopyResponse {
  copied: number;
  deleted: number;
}

export interface DeleteResponse {
  deleted: number;
  errors: { key: string; message: string }[];
}

export interface PresignResponse {
  url: string;
  expiresAt: string;
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
  };
}

/* ------------------------------------------------------------------ */
/* Users, activity, uploads, deleted objects, sync jobs                */
/* ------------------------------------------------------------------ */

export interface UserInfo {
  username: string;
  role: Role;
  disabled: boolean;
  hasPassword: boolean;
  createdAt: string;
}

export interface ActivityEntry {
  id: string;
  at: string;
  user: string;
  ip: string;
  action: string;
  connection: string | null;
  bucket: string | null;
  /** Keys or other short details of what changed. */
  detail: string | null;
}

export interface MultipartUploadInfo {
  key: string;
  uploadId: string;
  initiated: string | null;
  storageClass: string | null;
}

export interface UploadPartInfo {
  partNumber: number;
  etag: string;
  size: number;
}

export interface DeletedEntry {
  key: string;
  name: string;
  deletedAt: string | null;
  /** Version ID of the delete marker; removing it restores the object. */
  markerVersionId: string;
}

export interface DeletedListResponse {
  objects: DeletedEntry[];
  nextCursor: string | null;
}

export interface CompareItem {
  key: string;
  status: 'missing' | 'changed' | 'extra' | 'same';
  sourceSize: number | null;
  targetSize: number | null;
}

export interface CompareResult {
  items: CompareItem[];
  counts: { missing: number; changed: number; extra: number; same: number };
  bytesToCopy: number;
  /** True when one side has more than the comparison limit. */
  truncated: boolean;
}

export interface JobInfo {
  id: string;
  type: 'sync';
  owner: string;
  title: string;
  status: 'running' | 'done' | 'failed' | 'cancelled';
  startedAt: string;
  finishedAt: string | null;
  total: number;
  done: number;
  bytesDone: number;
  bytesTotal: number;
  errors: { key: string; message: string }[];
}
