import { createHash, createHmac, pbkdf2Sync, randomBytes } from 'node:crypto';
import type pg from 'pg';
import type { DbContext } from './client.js';
import { withTransaction } from './client.js';
import { UserError } from './errors.js';
import { quoteIdent } from './sql.js';
import {
  alterRoleSql,
  createRoleSql,
  DEFAULT_ACL_OBJECTS,
  isSystemRole,
  privilegesFor,
  schemaPresetSql,
  validateRoleName,
  type GrantChange,
  type GrantKind,
  type RoleAction,
  type RoleDetail,
  type RolesResponse,
  type RoleSummary,
  type SchemaPreset,
} from '../shared/roles.js';

const USER_NS = `n.nspname not in ('pg_catalog', 'information_schema', 'pg_toast') and n.nspname not like 'pg\\_temp\\_%' and n.nspname not like 'pg\\_toast\\_temp\\_%'`;
const NOT_FROM_EXT = (cls: string, col: string) =>
  `not exists (select 1 from pg_depend d where d.classid = '${cls}'::regclass and d.objid = ${col} and d.deptype = 'e')`;

const ROLE_COLUMNS = `
  r.oid::int8 as oid, r.rolname as name, r.rolcanlogin as login, r.rolsuper as superuser, r.rolcreatedb as createdb,
  r.rolcreaterole as createrole, r.rolreplication as replication, r.rolbypassrls as bypassrls, r.rolinherit as inherit,
  r.rolconnlimit as "connLimit", r.rolvaliduntil::text as "validUntil", shobj_description(r.oid, 'pg_authid') as comment,
  r.rolname = current_user as current,
  coalesce((select json_agg(json_build_object('role', g.rolname, 'admin', m.admin) order by g.rolname)
            from (select roleid, bool_or(admin_option) as admin from pg_auth_members where member = r.oid group by roleid) m
            join pg_roles g on g.oid = m.roleid), '[]') as "memberOf"`;

type RoleRow = Omit<RoleSummary, 'oid' | 'system' | 'validUntil'> & { oid: string; validUntil: string | null };

const toSummary = (r: RoleRow): RoleSummary => ({
  ...r,
  oid: Number(r.oid),
  system: isSystemRole(r.name),
  // 'infinity' and "no expiry" mean the same thing.
  validUntil: r.validUntil === 'infinity' ? null : r.validUntil,
});

async function serverVersion(ctx: DbContext): Promise<number> {
  const { rows } = await ctx.pool.query<{ v: number }>(`select current_setting('server_version_num')::int as v`);
  return rows[0]!.v;
}

export async function listRoles(ctx: DbContext): Promise<RolesResponse> {
  const [roles, me, version] = await Promise.all([
    ctx.pool.query<RoleRow>(`select ${ROLE_COLUMNS} from pg_roles r order by r.rolname like 'pg\\_%', r.rolname`),
    ctx.pool.query<RolesResponse['me']>(`select rolname as name, rolsuper as superuser, rolcreaterole as createrole from pg_roles where rolname = current_user`),
    serverVersion(ctx),
  ]);
  return { roles: roles.rows.map(toSummary), me: me.rows[0]!, serverVersion: version };
}

/** Every object in this database the role could be granted privileges on, with what it has now. */
const OBJECTS_SQL = `
  with r as (select $1::oid as oid),
  objs as (
    select 'database' as kind, d.oid, null::name as schema, d.datname as name, null as sub, d.datdba as owner, coalesce(d.datacl, acldefault('d', d.datdba)) as acl
      from pg_database d where d.datname = current_database()
    union all
    select 'schema', n.oid, null, n.nspname, null, n.nspowner, coalesce(n.nspacl, acldefault('n', n.nspowner))
      from pg_namespace n where ${USER_NS} and ${NOT_FROM_EXT('pg_namespace', 'n.oid')}
    union all
    select case when c.relkind = 'S' then 'sequence' else 'table' end, c.oid, n.nspname, c.relname, c.relkind::text, c.relowner,
           coalesce(c.relacl, acldefault(case when c.relkind = 'S' then 's' else 'r' end::"char", c.relowner))
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where c.relkind in ('r', 'p', 'v', 'm', 'f', 'S') and not c.relispartition and ${USER_NS} and ${NOT_FROM_EXT('pg_class', 'c.oid')}
    union all
    select 'function', p.oid, n.nspname, format('%s(%s)', p.proname, pg_get_function_identity_arguments(p.oid)), p.prokind::text, p.proowner,
           coalesce(p.proacl, acldefault('f', p.proowner))
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where p.prokind in ('f', 'p', 'w') and ${USER_NS} and ${NOT_FROM_EXT('pg_proc', 'p.oid')}
  )
  select o.kind, o.oid::int8 as oid, o.schema, o.name, o.sub, pg_get_userbyid(o.owner) as owner,
         array(select a.privilege_type from aclexplode(o.acl) a, r where a.grantee = r.oid order by 1)::text[] as privileges,
         array(select a.privilege_type from aclexplode(o.acl) a where a.grantee = 0 order by 1)::text[] as public
  from objs o
  order by array_position(array['database', 'schema', 'table', 'sequence', 'function'], o.kind), o.schema nulls first, o.name`;

export async function getRole(ctx: DbContext, name: string): Promise<RoleDetail> {
  const { rows } = await ctx.pool.query<RoleRow>(`select ${ROLE_COLUMNS} from pg_roles r where r.rolname = $1`, [name]);
  const row = rows[0];
  if (!row) throw new UserError(`Role "${name}" does not exist.`, 404);
  const role = toSummary(row);

  const [members, objects, defaults, deps, owned, db, version] = await Promise.all([
    ctx.pool.query(
      `select m.rolname as role, bool_or(a.admin_option) as admin from pg_auth_members a join pg_roles m on m.oid = a.member
       where a.roleid = $1 group by m.rolname order by m.rolname`,
      [role.oid],
    ),
    ctx.pool.query(OBJECTS_SQL, [role.oid]),
    ctx.pool.query(
      `select pg_get_userbyid(d.defaclrole) as "forRole", n.nspname as schema, d.defaclobjtype::text as type,
              array(select a.privilege_type from aclexplode(d.defaclacl) a where a.grantee = $1 order by 1)::text[] as privileges
       from pg_default_acl d left join pg_namespace n on n.oid = d.defaclnamespace
       where exists (select 1 from aclexplode(d.defaclacl) a where a.grantee = $1)
       order by 1, 2 nulls first, 3`,
      [role.oid],
    ),
    ctx.pool.query(
      `select db.datname as database, count(*) filter (where s.deptype = 'o')::int as owned, count(*) filter (where s.deptype in ('a', 'i'))::int as privileges
       from pg_shdepend s join pg_database db on db.oid = s.dbid
       where s.refclassid = 'pg_authid'::regclass and s.refobjid = $1
       group by db.datname order by db.datname = current_database() desc, db.datname`,
      [role.oid],
    ),
    ctx.pool.query<{ name: string }>(`select datname as name from pg_database where datdba = $1 order by 1`, [role.oid]),
    ctx.pool.query<{ name: string }>(`select current_database() as name`),
    serverVersion(ctx),
  ]);

  return {
    role,
    members: members.rows,
    database: db.rows[0]!.name,
    objects: objects.rows.map((o) => ({ ...o, oid: Number(o.oid) })),
    defaults: defaults.rows,
    dependencies: deps.rows,
    ownedDatabases: owned.rows.map((r) => r.name),
    serverVersion: version,
  };
}

/**
 * A SCRAM-SHA-256 verifier, so the plain password never travels in SQL (where
 * statement logging would record it). Postgres stores verifiers as given.
 * Non-ASCII passwords go through SASLprep in Postgres, which we don't
 * replicate, so those are left for the server to hash.
 */
export function scramVerifier(password: string, iterations = 4096): string {
  const salt = randomBytes(16);
  const salted = pbkdf2Sync(Buffer.from(password, 'utf8'), salt, iterations, 32, 'sha256');
  const clientKey = createHmac('sha256', salted).update('Client Key').digest();
  const storedKey = createHash('sha256').update(clientKey).digest();
  const serverKey = createHmac('sha256', salted).update('Server Key').digest();
  return `SCRAM-SHA-256$${iterations}:${salt.toString('base64')}$${storedKey.toString('base64')}:${serverKey.toString('base64')}`;
}

async function passwordLiteral(client: pg.PoolClient | pg.Pool, password: string): Promise<string> {
  if (!password) throw new UserError('The password is empty. Leave the field out to keep the current one, or choose “Remove password”.');
  const { rows } = await client.query<{ enc: string; iter: string | null }>(
    `select current_setting('password_encryption') as enc, current_setting('scram_iterations', true) as iter`,
  );
  // eslint-disable-next-line no-control-regex
  const ascii = /^[\x00-\x7f]*$/.test(password);
  const value = rows[0]?.enc === 'scram-sha-256' && ascii ? scramVerifier(password, Number(rows[0].iter) || 4096) : password;
  return `'${value.replace(/'/g, "''")}'`;
}

async function runStatements(ctx: DbContext, statements: string[]): Promise<void> {
  await withTransaction(ctx.pool, async (client) => {
    for (const s of statements) await client.query(s);
  });
}

export async function runRoleAction(ctx: DbContext, a: RoleAction): Promise<{ ok: true; message: string; name?: string }> {
  if (ctx.readonly) throw new UserError('pgdeck is running in --readonly mode', 403);

  switch (a.action) {
    case 'create': {
      const problem = validateRoleName(a.name);
      if (problem) throw new UserError(problem);
      await withTransaction(ctx.pool, async (client) => {
        const pw = a.password ? await passwordLiteral(client, a.password) : null;
        for (const s of createRoleSql(a, pw)) await client.query(s);
      });
      return { ok: true, message: `Created role ${a.name}`, name: a.name };
    }
    case 'update': {
      if (isSystemRole(a.name)) throw new UserError('Built-in roles can’t be changed.');
      if (a.newName !== undefined && a.newName !== a.name) {
        const problem = validateRoleName(a.newName);
        if (problem) throw new UserError(problem);
      }
      await withTransaction(ctx.pool, async (client) => {
        const pw = a.password === undefined ? undefined : a.password === null ? null : await passwordLiteral(client, a.password);
        const statements = alterRoleSql(a, pw);
        if (!statements.length) throw new UserError('Nothing to change.');
        for (const s of statements) await client.query(s);
      });
      const name = a.newName || a.name;
      return {
        ok: true,
        message: a.password !== undefined && !a.attributes && !a.newName ? `Changed the password of ${name}` : `Saved ${name}`,
        name,
      };
    }
    case 'membership': {
      if (a.role === a.group) throw new UserError('A role can’t be a member of itself.');
      const sql = a.grant
        ? [`GRANT ${quoteIdent(a.group)} TO ${quoteIdent(a.role)}${a.admin ? ' WITH ADMIN OPTION' : ''}`]
        : await revokeMembershipSql(ctx, a.group, a.role);
      await runStatements(ctx, sql);
      return { ok: true, message: a.grant ? `${a.role} is now a member of ${a.group}` : `${a.role} is no longer a member of ${a.group}` };
    }
    case 'drop': {
      if (isSystemRole(a.name)) throw new UserError('Built-in roles can’t be dropped.');
      const role = quoteIdent(a.name);
      const statements: string[] = [];
      if (a.reassignTo) statements.push(`REASSIGN OWNED BY ${role} TO ${quoteIdent(a.reassignTo)}`);
      if (a.dropOwned) statements.push(`DROP OWNED BY ${role}`);
      statements.push(`DROP ROLE ${role}`);
      await runStatements(ctx, statements);
      return { ok: true, message: `Dropped role ${a.name}` };
    }
    case 'revokeDefault': {
      const what = DEFAULT_ACL_OBJECTS[a.type];
      if (!what) throw new UserError('Unknown object type.');
      await ctx.pool.query(
        `ALTER DEFAULT PRIVILEGES FOR ROLE ${quoteIdent(a.forRole)}${a.schema ? ` IN SCHEMA ${quoteIdent(a.schema)}` : ''} REVOKE ALL ON ${what} FROM ${quoteIdent(a.role)}`,
      );
      return { ok: true, message: `Removed the default privileges on ${what.toLowerCase()} created by ${a.forRole}` };
    }
  }
}

/**
 * Since PostgreSQL 16 a membership can be granted several times by different
 * grantors, and REVOKE only removes the current user's grant unless told
 * otherwise. Revoke each grant by its grantor.
 */
async function revokeMembershipSql(ctx: DbContext, group: string, role: string): Promise<string[]> {
  const base = `REVOKE ${quoteIdent(group)} FROM ${quoteIdent(role)}`;
  if ((await serverVersion(ctx)) < 160000) return [base];
  const { rows } = await ctx.pool.query<{ grantor: string }>(
    `select distinct pg_get_userbyid(a.grantor) as grantor from pg_auth_members a
     where a.roleid = (select oid from pg_roles where rolname = $1) and a.member = (select oid from pg_roles where rolname = $2)`,
    [group, role],
  );
  if (!rows.length) throw new UserError(`${role} is not a member of ${group}.`);
  return rows.map((r) => `${base} GRANTED BY ${quoteIdent(r.grantor)}`);
}

/** Resolve an object to the "ON …" part of GRANT/REVOKE. */
async function grantTarget(client: pg.PoolClient, kind: GrantKind, oid: number): Promise<string> {
  const one = async (sql: string) => {
    const { rows } = await client.query<{ t: string | null }>(sql, [oid]);
    if (!rows[0]?.t) throw new UserError(`That ${kind} no longer exists. Reload the page.`, 404);
    return rows[0].t;
  };
  switch (kind) {
    case 'database':
      return one(`select format('DATABASE %I', datname) as t from pg_database where oid = $1 and datname = current_database()`);
    case 'schema':
      return one(`select format('SCHEMA %I', nspname) as t from pg_namespace where oid = $1`);
    case 'table':
      return one(`select format('TABLE %I.%I', n.nspname, c.relname) as t from pg_class c join pg_namespace n on n.oid = c.relnamespace where c.oid = $1 and c.relkind in ('r', 'p', 'v', 'm', 'f')`);
    case 'sequence':
      return one(`select format('SEQUENCE %I.%I', n.nspname, c.relname) as t from pg_class c join pg_namespace n on n.oid = c.relnamespace where c.oid = $1 and c.relkind = 'S'`);
    case 'function':
      return one(
        `select format('%s %I.%I(%s)', case p.prokind when 'p' then 'PROCEDURE' else 'FUNCTION' end, n.nspname, p.proname, pg_get_function_identity_arguments(p.oid)) as t
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace where p.oid = $1`,
      );
  }
}

/** Apply ticked/unticked privileges in one transaction, one GRANT or REVOKE per object. */
export async function applyGrants(ctx: DbContext, role: string, changes: GrantChange[]): Promise<{ ok: true; message: string; statements: string[] }> {
  if (ctx.readonly) throw new UserError('pgdeck is running in --readonly mode', 403);
  if (!changes.length) throw new UserError('Nothing to change.');
  const version = await serverVersion(ctx);
  const groups = new Map<string, { kind: GrantKind; oid: number; grant: boolean; privileges: Set<string> }>();
  for (const c of changes) {
    if (!privilegesFor(c.kind, version).includes(c.privilege)) throw new UserError(`${c.privilege} can’t be granted on a ${c.kind}.`);
    const key = `${c.kind}:${c.oid}:${c.grant}`;
    const g = groups.get(key) ?? groups.set(key, { kind: c.kind, oid: c.oid, grant: c.grant, privileges: new Set() }).get(key)!;
    g.privileges.add(c.privilege);
  }
  const r = quoteIdent(role);
  const statements: string[] = [];
  await withTransaction(ctx.pool, async (client) => {
    // Revokes first, so a "replace SELECT with INSERT" edit never passes through having both.
    for (const g of [...groups.values()].sort((a, b) => Number(a.grant) - Number(b.grant))) {
      const target = await grantTarget(client, g.kind, g.oid);
      const privs = [...g.privileges].join(', ');
      const sql = g.grant ? `GRANT ${privs} ON ${target} TO ${r}` : `REVOKE ${privs} ON ${target} FROM ${r}`;
      await client.query(sql);
      statements.push(`${sql};`);
    }
  });
  const n = changes.length;
  return { ok: true, message: `Saved ${n} privilege change${n === 1 ? '' : 's'} for ${role}`, statements };
}

export async function applySchemaPreset(
  ctx: DbContext,
  role: string,
  schema: string,
  preset: SchemaPreset,
  future: boolean,
): Promise<{ ok: true; message: string }> {
  if (ctx.readonly) throw new UserError('pgdeck is running in --readonly mode', 403);
  await runStatements(ctx, schemaPresetSql(role, schema, preset, future));
  const what = preset === 'read' ? 'read access' : preset === 'write' ? 'read and write access' : 'no access';
  return { ok: true, message: `${role} now has ${what} to ${schema}` };
}
