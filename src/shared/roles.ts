/** Roles, memberships and privileges: types and SQL builders shared by the server and the UI. */

const quoteIdent = (name: string): string => `"${name.replace(/"/g, '""')}"`;
const quoteLiteral = (s: string): string => `'${s.replace(/'/g, "''")}'`;

export type RoleFlag = 'login' | 'superuser' | 'createdb' | 'createrole' | 'replication' | 'bypassrls' | 'inherit';

export interface RoleAttributes {
  login: boolean;
  superuser: boolean;
  createdb: boolean;
  createrole: boolean;
  replication: boolean;
  bypassrls: boolean;
  inherit: boolean;
  /** -1 means unlimited. */
  connLimit: number;
  /** When the password stops working, as a timestamp Postgres understands; null = never. */
  validUntil: string | null;
}

export const ROLE_FLAGS: { key: RoleFlag; on: string; off: string; label: string; hint: string; superuserOnly?: boolean }[] = [
  { key: 'login', on: 'LOGIN', off: 'NOLOGIN', label: 'Can log in', hint: 'Without this, the role is a group: others get its privileges by being members.' },
  { key: 'inherit', on: 'INHERIT', off: 'NOINHERIT', label: 'Inherits privileges', hint: 'Automatically uses the privileges of the roles it is a member of.' },
  { key: 'createdb', on: 'CREATEDB', off: 'NOCREATEDB', label: 'Create databases', hint: 'Can create new databases.' },
  { key: 'createrole', on: 'CREATEROLE', off: 'NOCREATEROLE', label: 'Create roles', hint: 'Can create, change and drop other (non-superuser) roles.' },
  { key: 'superuser', on: 'SUPERUSER', off: 'NOSUPERUSER', label: 'Superuser', hint: 'Bypasses every permission check. Give it to as few roles as possible.', superuserOnly: true },
  { key: 'replication', on: 'REPLICATION', off: 'NOREPLICATION', label: 'Replication', hint: 'Can start streaming replication and take base backups.', superuserOnly: true },
  { key: 'bypassrls', on: 'BYPASSRLS', off: 'NOBYPASSRLS', label: 'Bypass row-level security', hint: 'Ignores row-level security policies.', superuserOnly: true },
];

export const DEFAULT_ATTRIBUTES: RoleAttributes = {
  login: true,
  superuser: false,
  createdb: false,
  createrole: false,
  replication: false,
  bypassrls: false,
  inherit: true,
  connLimit: -1,
  validUntil: null,
};

export const isSystemRole = (name: string) => name.startsWith('pg_');

export function validateRoleName(name: string): string | null {
  if (!name.trim()) return 'Enter a name.';
  if (name !== name.trim()) return 'Remove the spaces at the start or end.';
  if (new TextEncoder().encode(name).length > 63) return 'Names can be at most 63 bytes.';
  if (isSystemRole(name)) return 'Names starting with pg_ are reserved.';
  if (['public', 'none', 'current_user', 'session_user', 'current_role'].includes(name.toLowerCase())) return `"${name}" is reserved.`;
  return null;
}

/** VALID UNTIL accepts what Postgres can parse; we only rule out obvious junk early. */
export const validUntilValid = (v: string | null) => v === null || /^[\d\-:+ .TZtz]+$/.test(v.trim());

function optionList(a: Partial<RoleAttributes>): string[] {
  const out: string[] = [];
  for (const f of ROLE_FLAGS) if (a[f.key] !== undefined) out.push(a[f.key] ? f.on : f.off);
  if (a.connLimit !== undefined) out.push(`CONNECTION LIMIT ${Math.trunc(a.connLimit)}`);
  if (a.validUntil !== undefined) out.push(`VALID UNTIL ${quoteLiteral(a.validUntil?.trim() || 'infinity')}`);
  return out;
}

/** Only what changed: setting SUPERUSER, REPLICATION or BYPASSRLS at all needs superuser, even to the same value. */
export function changedAttributes(before: RoleAttributes, after: RoleAttributes): Partial<RoleAttributes> {
  const out: Partial<RoleAttributes> = {};
  for (const f of ROLE_FLAGS) if (before[f.key] !== after[f.key]) out[f.key] = after[f.key];
  if (before.connLimit !== after.connLimit) out.connLimit = after.connLimit;
  if ((before.validUntil ?? null) !== (after.validUntil?.trim() || null)) out.validUntil = after.validUntil?.trim() || null;
  return out;
}

export interface NewRole extends RoleAttributes {
  name: string;
  password: string;
  memberOf: string[];
  comment: string;
}

/**
 * Statements to create a role. `passwordSql` is the literal to send (a SCRAM
 * verifier on the server, a mask in the preview), or null for no password.
 */
export function createRoleSql(r: NewRole, passwordSql: string | null): string[] {
  const role = quoteIdent(r.name);
  const opts = optionList({ ...r, validUntil: r.validUntil?.trim() || undefined, connLimit: r.connLimit === -1 ? undefined : r.connLimit });
  // Defaults that don't need saying.
  const implicit = new Set(['NOSUPERUSER', 'NOCREATEDB', 'NOCREATEROLE', 'NOREPLICATION', 'NOBYPASSRLS', 'INHERIT', 'NOLOGIN']);
  const shown = opts.filter((o) => !implicit.has(o));
  if (passwordSql) shown.push(`PASSWORD ${passwordSql}`);
  const out = [`CREATE ROLE ${role}${shown.length ? ` WITH ${shown.join(' ')}` : ''};`];
  for (const g of r.memberOf) out.push(`GRANT ${quoteIdent(g)} TO ${role};`);
  if (r.comment.trim()) out.push(`COMMENT ON ROLE ${role} IS ${quoteLiteral(r.comment.trim())};`);
  return out;
}

export interface RoleUpdate {
  name: string;
  newName?: string;
  attributes?: Partial<RoleAttributes>;
  /** undefined keeps the password, null removes it. */
  password?: string | null;
  comment?: string;
}

export function alterRoleSql(u: RoleUpdate, passwordSql: string | null | undefined): string[] {
  const role = quoteIdent(u.name);
  const out: string[] = [];
  const opts = optionList(u.attributes ?? {});
  if (passwordSql !== undefined) opts.push(passwordSql === null ? 'PASSWORD NULL' : `PASSWORD ${passwordSql}`);
  if (opts.length) out.push(`ALTER ROLE ${role} WITH ${opts.join(' ')};`);
  if (u.comment !== undefined) out.push(`COMMENT ON ROLE ${role} IS ${u.comment.trim() ? quoteLiteral(u.comment.trim()) : 'NULL'};`);
  // Rename last, so the statements above can use the old name.
  if (u.newName && u.newName !== u.name) out.push(`ALTER ROLE ${role} RENAME TO ${quoteIdent(u.newName)};`);
  return out;
}

/* Privileges */

export type GrantKind = 'database' | 'schema' | 'table' | 'sequence' | 'function';

export const GRANT_KIND_LABEL: Record<GrantKind, string> = {
  database: 'Database',
  schema: 'Schema',
  table: 'Table',
  sequence: 'Sequence',
  function: 'Function',
};

/** Privileges each kind of object accepts. MAINTAIN (tables) only exists on PostgreSQL 17+. */
export function privilegesFor(kind: GrantKind, serverVersion: number): string[] {
  switch (kind) {
    case 'database':
      return ['CONNECT', 'CREATE', 'TEMPORARY'];
    case 'schema':
      return ['USAGE', 'CREATE'];
    case 'table':
      return ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', ...(serverVersion >= 170000 ? ['MAINTAIN'] : [])];
    case 'sequence':
      return ['USAGE', 'SELECT', 'UPDATE'];
    case 'function':
      return ['EXECUTE'];
  }
}

export const PRIVILEGE_HINT: Record<string, string> = {
  CONNECT: 'Connect to this database',
  CREATE: 'Create schemas (database) or objects (schema)',
  TEMPORARY: 'Create temporary tables',
  USAGE: 'Look up objects in the schema / use the sequence',
  SELECT: 'Read rows',
  INSERT: 'Add rows',
  UPDATE: 'Change rows',
  DELETE: 'Delete rows',
  TRUNCATE: 'Empty the table',
  REFERENCES: 'Create foreign keys pointing at it',
  TRIGGER: 'Create triggers on it',
  MAINTAIN: 'VACUUM, ANALYZE, REINDEX, REFRESH and lock it',
  EXECUTE: 'Call the function',
};

export interface GrantChange {
  kind: GrantKind;
  oid: number;
  privilege: string;
  grant: boolean;
}

export type SchemaPreset = 'read' | 'write' | 'none';

export const SCHEMA_PRESETS: { value: SchemaPreset; label: string; hint: string }[] = [
  { value: 'read', label: 'Read only', hint: 'Use the schema and SELECT from every table, view and sequence.' },
  { value: 'write', label: 'Read and write', hint: 'Also INSERT, UPDATE and DELETE rows, and advance sequences.' },
  { value: 'none', label: 'No access', hint: 'Revoke every privilege on the schema and everything in it.' },
];

/** Statements applying a preset to a whole schema; `future` also sets default privileges for objects created later. */
export function schemaPresetSql(role: string, schema: string, preset: SchemaPreset, future: boolean): string[] {
  const r = quoteIdent(role);
  const s = quoteIdent(schema);
  const out: string[] = [];
  if (preset === 'none') {
    out.push(`REVOKE ALL ON ALL TABLES IN SCHEMA ${s} FROM ${r};`, `REVOKE ALL ON ALL SEQUENCES IN SCHEMA ${s} FROM ${r};`, `REVOKE ALL ON SCHEMA ${s} FROM ${r};`);
    if (future) {
      out.push(`ALTER DEFAULT PRIVILEGES IN SCHEMA ${s} REVOKE ALL ON TABLES FROM ${r};`, `ALTER DEFAULT PRIVILEGES IN SCHEMA ${s} REVOKE ALL ON SEQUENCES FROM ${r};`);
    }
    return out;
  }
  const tables = preset === 'read' ? 'SELECT' : 'SELECT, INSERT, UPDATE, DELETE';
  const sequences = preset === 'read' ? 'SELECT' : 'USAGE, SELECT, UPDATE';
  out.push(`GRANT USAGE ON SCHEMA ${s} TO ${r};`, `GRANT ${tables} ON ALL TABLES IN SCHEMA ${s} TO ${r};`, `GRANT ${sequences} ON ALL SEQUENCES IN SCHEMA ${s} TO ${r};`);
  if (future) {
    out.push(
      `ALTER DEFAULT PRIVILEGES IN SCHEMA ${s} GRANT ${tables} ON TABLES TO ${r};`,
      `ALTER DEFAULT PRIVILEGES IN SCHEMA ${s} GRANT ${sequences} ON SEQUENCES TO ${r};`,
    );
  }
  return out;
}

/* API shapes */

export interface RoleMembership {
  role: string;
  /** May grant this membership to others. */
  admin: boolean;
}

export interface RoleSummary extends RoleAttributes {
  oid: number;
  name: string;
  memberOf: RoleMembership[];
  comment: string | null;
  system: boolean;
  /** The role pgdeck is connected as. */
  current: boolean;
}

export interface RolesResponse {
  roles: RoleSummary[];
  me: { name: string; superuser: boolean; createrole: boolean };
  serverVersion: number;
}

export interface GrantObject {
  kind: GrantKind;
  oid: number;
  schema: string | null;
  name: string;
  /** For tables: r, p, v, m, f. For functions: f, p, w. */
  sub: string | null;
  owner: string;
  /** Privileges granted directly to this role. */
  privileges: string[];
  /** Privileges everyone has through PUBLIC. */
  public: string[];
}

export interface DefaultPrivilege {
  /** Objects created by this role get the privileges… */
  forRole: string;
  /** …in this schema, or every schema when null. */
  schema: string | null;
  /** r tables, S sequences, f functions, T types, n schemas */
  type: string;
  privileges: string[];
}

export interface RoleDetail {
  role: RoleSummary;
  members: RoleMembership[];
  database: string;
  objects: GrantObject[];
  defaults: DefaultPrivilege[];
  /** Objects it owns or has privileges on, per database (for dropping). */
  dependencies: { database: string; owned: number; privileges: number }[];
  ownedDatabases: string[];
  serverVersion: number;
}

export type RoleAction =
  | ({ action: 'create' } & NewRole)
  | ({ action: 'update' } & RoleUpdate)
  | { action: 'membership'; role: string; group: string; grant: boolean; admin?: boolean }
  | { action: 'drop'; name: string; reassignTo?: string; dropOwned: boolean }
  | { action: 'revokeDefault'; role: string; forRole: string; schema: string | null; type: string };

export const DEFAULT_ACL_OBJECTS: Record<string, string> = { r: 'TABLES', S: 'SEQUENCES', f: 'FUNCTIONS', T: 'TYPES', n: 'SCHEMAS' };
export const DEFAULT_ACL_LABEL: Record<string, string> = { r: 'tables', S: 'sequences', f: 'functions', T: 'types', n: 'schemas' };
