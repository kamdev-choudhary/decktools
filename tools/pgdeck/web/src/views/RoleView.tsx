import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  KeyRound,
  LayoutList,
  Pencil,
  Search,
  ShieldCheck,
  Trash2,
  User,
  UsersRound,
  X,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  DEFAULT_ACL_LABEL,
  GRANT_KIND_LABEL,
  PRIVILEGE_HINT,
  privilegesFor,
  type GrantChange,
  type GrantKind,
  type GrantObject,
  type RoleDetail,
  type RolesResponse,
} from '@shared/roles';
import { api } from '@/api/client';
import { keys } from '@/api/hooks';
import { Combobox } from '@deck/ui/components/combobox';
import { CenteredSpinner, ErrorAlert, errorMessage, Spinner } from '@/components/app/feedback';
import {
  DropRoleDialog,
  EditRoleDialog,
  PasswordDialog,
  rolesKey,
  SchemaPresetDialog,
  useRoleAction,
} from '@/components/app/roles/RoleDialogs';
import { SqlPreview } from '@/components/app/structure/StructureDialogs';
import { Badge } from '@deck/ui/components/badge';
import { Button } from '@deck/ui/components/button';
import { Checkbox } from '@deck/ui/components/checkbox';
import { Input } from '@deck/ui/components/input';
import { Tabs, TabsList, TabsTrigger } from '@deck/ui/components/tabs';
import { Tooltip, TooltipContent, TooltipTrigger } from '@deck/ui/components/tooltip';
import { navigate, roleHref, rolesHref } from '@/lib/router';
import { cn } from '@deck/ui/lib/utils';
import { expiry, roleBadges } from './RolesView';

type Tab = 'database' | 'table' | 'sequence' | 'function';
const TABS: { value: Tab; label: string; kinds: GrantKind[] }[] = [
  { value: 'database', label: 'Database & schemas', kinds: ['database', 'schema'] },
  { value: 'table', label: 'Tables & views', kinds: ['table'] },
  { value: 'sequence', label: 'Sequences', kinds: ['sequence'] },
  { value: 'function', label: 'Functions', kinds: ['function'] },
];
const ROW_CAP = 300;
const REL_KIND: Record<string, string> = { v: 'view', m: 'materialized view', f: 'foreign table', p: 'partitioned' };

const cellKey = (o: GrantObject, p: string) => `${o.kind}:${o.oid}:${p}`;
const q = (s: string) => (/^[a-z_][a-z0-9_$]*$/.test(s) ? s : `"${s.replace(/"/g, '""')}"`);

export function RoleView({ db, name, readonly }: { db: string; name: string; readonly: boolean }) {
  const qc = useQueryClient();
  const detail = useQuery({
    queryKey: [...keys.db(db), 'role', name],
    queryFn: () => api.role(db, name),
    retry: false,
  });
  const roles = useQuery({ queryKey: rolesKey(db), queryFn: () => api.roles(db) });
  const [dialog, setDialog] = useState<'edit' | 'password' | 'drop' | 'preset' | null>(null);
  const [presetSchema, setPresetSchema] = useState<string | undefined>();
  const [pending, setPending] = useState<Map<string, boolean>>(new Map());
  const membership = useRoleAction(db);

  const save = useMutation({
    mutationFn: (changes: GrantChange[]) => api.grants(db, name, changes),
    onSuccess: (r) => {
      toast.success(r.message);
      setPending(new Map());
      void qc.invalidateQueries({ queryKey: [...keys.db(db), 'role'] });
    },
    onError: (e) => toast.error('Couldn’t save the privileges', { description: errorMessage(e) }),
  });

  if (detail.isPending || roles.isPending) return <CenteredSpinner />;
  if (detail.isError) return <ErrorAlert error={detail.error} className="m-6 w-auto" />;
  if (roles.isError) return <ErrorAlert error={roles.error} className="m-6 w-auto" />;

  const d = detail.data;
  const r = d.role;
  const me = roles.data.me;
  const editable = !readonly && !r.system;
  const exp = expiry(r.validUntil);
  const otherRoles = roles.data.roles.map((x) => x.name).filter((x) => x !== r.name);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="mx-auto w-full max-w-6xl space-y-6 px-4 py-6 md:px-6">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 space-y-1.5">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <a href={rolesHref(db)} className="hover:text-foreground hover:underline">
                Roles
              </a>
              <span>/</span>
              {r.login ? <User className="size-3.5" /> : <UsersRound className="size-3.5" />}
              {r.system ? 'Built-in role' : r.login ? 'User (can log in)' : 'Group (can’t log in)'}
            </div>
            <h1 className="flex flex-wrap items-center gap-2 font-mono text-xl font-semibold break-all">
              {r.name}
              {r.current && <Badge variant="outline">you</Badge>}
              {roleBadges(r).map((b) => (
                <Badge
                  key={b.label}
                  variant="outline"
                  className={cn(
                    'font-sans',
                    b.tone === 'warning' ? 'border-warning/40 text-warning' : 'text-muted-foreground',
                  )}
                >
                  {b.label}
                </Badge>
              ))}
            </h1>
            {r.comment && <p className="text-sm text-muted-foreground">{r.comment}</p>}
          </div>
          {editable && (
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => setDialog('edit')}>
                <Pencil /> Edit
              </Button>
              {r.login && (
                <Button variant="outline" size="sm" onClick={() => setDialog('password')}>
                  <KeyRound /> Change password
                </Button>
              )}
              <Button variant="outline" size="sm" onClick={() => (setPresetSchema(undefined), setDialog('preset'))}>
                <LayoutList /> Set schema access…
              </Button>
              {!r.current && (
                <Button
                  variant="outline"
                  size="sm"
                  className="text-destructive hover:text-destructive"
                  onClick={() => setDialog('drop')}
                >
                  <Trash2 /> Drop
                </Button>
              )}
            </div>
          )}
        </header>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_17rem]">
          <div className="min-w-0 space-y-6">
            {r.superuser && (
              <p className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/5 px-4 py-3 text-sm">
                <ShieldCheck className="mt-0.5 size-4 shrink-0 text-warning" />
                <span>
                  Superusers skip every permission check, so the privileges below don’t limit what {r.name} can do.
                </span>
              </p>
            )}
            <PrivilegeGrid
              detail={d}
              pending={pending}
              setPending={setPending}
              editable={editable}
              onPreset={(schema) => (setPresetSchema(schema), setDialog('preset'))}
            />
            {pending.size > 0 && (
              <div className="sticky bottom-4 z-10 space-y-3 rounded-lg border bg-background p-3">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="text-sm">
                    <b className="tabular-nums">{pending.size}</b> unsaved change{pending.size === 1 ? '' : 's'}
                  </span>
                  <div className="flex-1" />
                  <Button variant="ghost" size="sm" disabled={save.isPending} onClick={() => setPending(new Map())}>
                    Discard
                  </Button>
                  <Button size="sm" disabled={save.isPending} onClick={() => save.mutate(changesOf(pending))}>
                    {save.isPending && <Spinner className="text-current" />}
                    Save changes
                  </Button>
                </div>
                <SqlPreview statements={previewSql(d, pending)} />
              </div>
            )}
            <DefaultPrivileges db={db} detail={d} editable={editable} />
          </div>

          <aside className="h-fit space-y-4">
            <dl className="divide-y overflow-hidden rounded-lg border text-sm">
              <Prop label="Can log in">{r.login ? 'yes' : 'no'}</Prop>
              <Prop label="Uses privileges of its groups">
                {r.inherit ? 'yes, automatically' : 'only after SET ROLE'}
              </Prop>
              {r.login && <Prop label="Connection limit">{r.connLimit === -1 ? 'unlimited' : r.connLimit}</Prop>}
              {r.login && (
                <Prop label="Password expires">
                  {exp ? (
                    <span
                      className={cn(exp.expired && 'text-destructive')}
                    >{`${exp.expired ? 'expired ' : ''}${exp.text}`}</span>
                  ) : (
                    'never'
                  )}
                </Prop>
              )}
              {d.ownedDatabases.length > 0 && <Prop label="Owns databases">{d.ownedDatabases.join(', ')}</Prop>}
            </dl>

            <MembershipList
              title="Member of"
              hint={`${r.name} gets the privileges of these roles.`}
              items={r.memberOf}
              options={otherRoles.filter((x) => !r.memberOf.some((m) => m.role === x))}
              editable={editable}
              busy={membership.isPending}
              onAdd={(g) => membership.mutate({ action: 'membership', role: r.name, group: g, grant: true })}
              onRemove={(g) => membership.mutate({ action: 'membership', role: r.name, group: g, grant: false })}
              db={db}
            />
            <MembershipList
              title="Members"
              hint={`These roles get the privileges of ${r.name}.`}
              items={d.members}
              options={otherRoles.filter((x) => !d.members.some((m) => m.role === x))}
              editable={editable}
              busy={membership.isPending}
              onAdd={(m) => membership.mutate({ action: 'membership', role: m, group: r.name, grant: true })}
              onRemove={(m) => membership.mutate({ action: 'membership', role: m, group: r.name, grant: false })}
              db={db}
            />
            {membership.error && (
              <p className="font-mono text-xs whitespace-pre-wrap text-destructive">{errorMessage(membership.error)}</p>
            )}
          </aside>
        </div>
      </div>

      {dialog === 'edit' && (
        <EditRoleDialog
          db={db}
          role={r}
          me={me}
          onClose={() => setDialog(null)}
          onRenamed={(n) => navigate(roleHref(db, n), true)}
        />
      )}
      {dialog === 'password' && <PasswordDialog db={db} role={r} onClose={() => setDialog(null)} />}
      {dialog === 'drop' && (
        <DropRoleDialog
          db={db}
          detail={d}
          roles={otherRoles}
          onClose={() => setDialog(null)}
          onDropped={() => navigate(rolesHref(db), true)}
        />
      )}
      {dialog === 'preset' && (
        <SchemaPresetDialog
          db={db}
          role={r.name}
          schemas={d.objects.filter((o) => o.kind === 'schema').map((o) => o.name)}
          initialSchema={presetSchema}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  );
}

function Prop({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="px-4 py-2.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-[13px] break-words">{children}</dd>
    </div>
  );
}

function MembershipList({
  title,
  hint,
  items,
  options,
  editable,
  busy,
  onAdd,
  onRemove,
  db,
}: {
  title: string;
  hint: string;
  items: RolesResponse['roles'][number]['memberOf'];
  options: string[];
  editable: boolean;
  busy: boolean;
  onAdd: (name: string) => void;
  onRemove: (name: string) => void;
  db: string;
}) {
  return (
    <section className="space-y-2 rounded-lg border p-4">
      <div>
        <h2 className="text-sm font-medium">{title}</h2>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
      {items.length === 0 && <p className="text-xs text-muted-foreground">None.</p>}
      <div className="flex flex-wrap gap-1.5">
        {items.map((m) => (
          <span
            key={m.role}
            className="inline-flex h-7 max-w-full items-center gap-1 rounded-md border pr-1 pl-2 font-mono text-xs"
          >
            <a href={roleHref(db, m.role)} className="truncate hover:underline">
              {m.role}
            </a>
            {m.admin && (
              <span className="font-sans text-[10px] text-muted-foreground" title="Can add or remove members">
                admin
              </span>
            )}
            {editable && (
              <button
                type="button"
                disabled={busy}
                className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
                aria-label={`Remove ${m.role}`}
                onClick={() => onRemove(m.role)}
              >
                <X className="size-3" />
              </button>
            )}
          </span>
        ))}
      </div>
      {editable && (
        <Combobox
          value={undefined}
          onChange={onAdd}
          options={options.map((o) => ({ value: o }))}
          placeholder="Add a role…"
          searchPlaceholder="Search roles…"
          mono
          disabled={busy}
          className="h-8 w-full text-xs"
        />
      )}
    </section>
  );
}

/* Privileges */

function changesOf(pending: Map<string, boolean>): GrantChange[] {
  return [...pending].map(([k, grant]) => {
    const [kind, oid, privilege] = k.split(':') as [GrantKind, string, string];
    return { kind, oid: Number(oid), privilege, grant };
  });
}

function targetName(o: GrantObject): string {
  if (o.kind === 'database') return `DATABASE ${q(o.name)}`;
  if (o.kind === 'schema') return `SCHEMA ${q(o.name)}`;
  if (o.kind === 'function') {
    const i = o.name.indexOf('(');
    return `${o.sub === 'p' ? 'PROCEDURE' : 'FUNCTION'} ${q(o.schema!)}.${q(o.name.slice(0, i))}${o.name.slice(i)}`;
  }
  return `${o.kind === 'sequence' ? 'SEQUENCE' : 'TABLE'} ${q(o.schema!)}.${q(o.name)}`;
}

function previewSql(d: RoleDetail, pending: Map<string, boolean>): string[] {
  const byKey = new Map(d.objects.map((o) => [`${o.kind}:${o.oid}`, o]));
  const groups = new Map<string, { o: GrantObject; grant: boolean; privs: string[] }>();
  for (const c of changesOf(pending)) {
    const o = byKey.get(`${c.kind}:${c.oid}`);
    if (!o) continue;
    const k = `${c.kind}:${c.oid}:${c.grant}`;
    (groups.get(k) ?? groups.set(k, { o, grant: c.grant, privs: [] }).get(k)!).privs.push(c.privilege);
  }
  return [...groups.values()]
    .sort((a, b) => Number(a.grant) - Number(b.grant))
    .map((g) =>
      g.grant
        ? `GRANT ${g.privs.join(', ')} ON ${targetName(g.o)} TO ${q(d.role.name)};`
        : `REVOKE ${g.privs.join(', ')} ON ${targetName(g.o)} FROM ${q(d.role.name)};`,
    );
}

function PrivilegeGrid({
  detail,
  pending,
  setPending,
  editable,
  onPreset,
}: {
  detail: RoleDetail;
  pending: Map<string, boolean>;
  setPending: (m: Map<string, boolean>) => void;
  editable: boolean;
  onPreset: (schema: string) => void;
}) {
  const [tab, setTab] = useState<Tab>('table');
  const [filter, setFilter] = useState('');
  const [onlyGranted, setOnlyGranted] = useState(false);
  const role = detail.role.name;

  const has = (o: GrantObject, p: string) => pending.get(cellKey(o, p)) ?? o.privileges.includes(p);
  const set = (next: Map<string, boolean>, o: GrantObject, p: string, value: boolean) => {
    if (o.privileges.includes(p) === value) next.delete(cellKey(o, p));
    else next.set(cellKey(o, p), value);
  };
  const toggle = (o: GrantObject, p: string) => {
    const next = new Map(pending);
    set(next, o, p, !has(o, p));
    setPending(next);
  };
  const setMany = (rows: GrantObject[], p: string, value: boolean) => {
    const next = new Map(pending);
    for (const o of rows) set(next, o, p, value);
    setPending(next);
  };

  const counts = useMemo(() => {
    const c: Record<Tab, number> = { database: 0, table: 0, sequence: 0, function: 0 };
    for (const o of detail.objects) {
      const t = TABS.find((x) => x.kinds.includes(o.kind))!.value;
      if (o.privileges.length) c[t]++;
    }
    return c;
  }, [detail.objects]);

  // Grants on tables do nothing without USAGE on their schema.
  const missingUsage = useMemo(() => {
    if (tab !== 'table' && tab !== 'sequence' && tab !== 'function') return [];
    const schemas = new Map(detail.objects.filter((o) => o.kind === 'schema').map((o) => [o.name, o]));
    const granted = (o: GrantObject, p: string) => pending.get(cellKey(o, p)) ?? o.privileges.includes(p);
    const out = new Set<string>();
    for (const o of detail.objects) {
      if (o.kind !== tab || !o.schema || o.owner === role) continue;
      const anyGrant = privilegesFor(o.kind, detail.serverVersion).some((p) => granted(o, p));
      const s = schemas.get(o.schema);
      if (anyGrant && s && s.owner !== role && !granted(s, 'USAGE') && !s.public.includes('USAGE')) out.add(o.schema);
    }
    return [...out].map((n) => schemas.get(n)!);
  }, [tab, detail.objects, detail.serverVersion, pending, role]);

  const kinds = TABS.find((t) => t.value === tab)!.kinds;
  const needle = filter.trim().toLowerCase();

  return (
    <section className="overflow-hidden rounded-lg border">
      <div className="space-y-3 border-b px-4 pt-3 pb-3">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 className="text-sm font-medium">Privileges in {detail.database}</h2>
          <p className="text-xs text-muted-foreground">
            Granted directly to {role}. It also has whatever its groups and PUBLIC have.
          </p>
        </div>
        <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
          <TabsList variant="line" className="h-8 p-0">
            {TABS.map((t) => (
              <TabsTrigger key={t.value} value={t.value} className="px-2.5 text-xs">
                {t.label}
                {counts[t.value] > 0 && (
                  <span className="ml-1 rounded bg-muted px-1 text-[10px] tabular-nums">{counts[t.value]}</span>
                )}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative w-full max-w-64">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter by name or schema…"
              className="h-8 pl-8 text-[13px]"
              spellCheck={false}
            />
          </div>
          <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
            <Checkbox checked={onlyGranted} onCheckedChange={(v) => setOnlyGranted(v === true)} />
            Only show granted
          </label>
        </div>
      </div>

      {missingUsage.map((s) => (
        <div key={s.oid} className="flex flex-wrap items-center gap-2 border-b bg-warning/5 px-4 py-2 text-xs">
          <AlertTriangle className="size-3.5 shrink-0 text-warning" />
          <span className="min-w-0 flex-1">
            {role} has no <span className="font-mono">USAGE</span> on schema <span className="font-mono">{s.name}</span>
            , so it can’t reach anything inside it.
          </span>
          {editable && (
            <Button variant="outline" size="xs" onClick={() => toggle(s, 'USAGE')}>
              Grant USAGE on {s.name}
            </Button>
          )}
        </div>
      ))}

      {kinds.map((kind) => {
        const all = detail.objects.filter((o) => o.kind === kind);
        const rows = all.filter(
          (o) =>
            (!needle || `${o.schema ?? ''}.${o.name}`.toLowerCase().includes(needle)) &&
            (!onlyGranted ||
              o.privileges.length > 0 ||
              [...pending.keys()].some((k) => k.startsWith(`${o.kind}:${o.oid}:`))),
        );
        return (
          <GrantTable
            key={kind}
            kind={kind}
            privileges={privilegesFor(kind, detail.serverVersion)}
            rows={rows}
            total={all.length}
            role={role}
            editable={editable}
            has={has}
            changed={(o, p) => pending.has(cellKey(o, p))}
            onToggle={toggle}
            onSetMany={setMany}
            onPreset={kind === 'schema' ? onPreset : undefined}
            showHeading={kinds.length > 1}
          />
        );
      })}
    </section>
  );
}

function GrantTable({
  kind,
  privileges,
  rows,
  total,
  role,
  editable,
  has,
  changed,
  onToggle,
  onSetMany,
  onPreset,
  showHeading,
}: {
  kind: GrantKind;
  privileges: string[];
  rows: GrantObject[];
  total: number;
  role: string;
  editable: boolean;
  has: (o: GrantObject, p: string) => boolean;
  changed: (o: GrantObject, p: string) => boolean;
  onToggle: (o: GrantObject, p: string) => void;
  onSetMany: (rows: GrantObject[], p: string, value: boolean) => void;
  onPreset?: (schema: string) => void;
  showHeading: boolean;
}) {
  const shown = rows.slice(0, ROW_CAP);
  const editableRows = shown.filter((o) => o.owner !== role);
  return (
    <div>
      {showHeading && (
        <h3 className="border-b bg-muted/30 px-4 py-1.5 text-xs font-medium text-muted-foreground">
          {kind === 'database' ? 'This database' : 'Schemas'}
        </h3>
      )}
      <div className="max-h-[32rem] overflow-auto">
        <table className="w-full text-[13px]">
          <thead className="sticky top-0 z-[1] border-b bg-grid-header text-[11px] text-muted-foreground">
            <tr>
              <th className="px-4 py-2 text-left font-medium">{GRANT_KIND_LABEL[kind]}</th>
              {privileges.map((p) => {
                const all = editableRows.length > 0 && editableRows.every((o) => has(o, p));
                return (
                  <th key={p} className="w-20 px-1 py-1.5 text-center font-medium">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          disabled={!editable || !editableRows.length}
                          onClick={() => onSetMany(editableRows, p, !all)}
                          className="rounded px-1.5 py-0.5 font-mono tracking-tight enabled:hover:bg-accent enabled:hover:text-foreground"
                        >
                          {p === 'TEMPORARY' ? 'TEMP' : p === 'REFERENCES' ? 'REFS' : p}
                        </button>
                      </TooltipTrigger>
                      <TooltipContent>
                        {PRIVILEGE_HINT[p]}
                        {editable && editableRows.length > 0 && (
                          <span className="block opacity-70">
                            Click to {all ? 'revoke from' : 'grant on'} every row shown
                          </span>
                        )}
                      </TooltipContent>
                    </Tooltip>
                  </th>
                );
              })}
              {onPreset && editable && <th className="w-10" />}
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {shown.map((o) => {
              const owner = o.owner === role;
              return (
                <tr key={o.oid} className="hover:bg-muted/30">
                  <td className="max-w-0 px-4 py-1.5">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="truncate font-mono" title={o.schema ? `${o.schema}.${o.name}` : o.name}>
                        {o.schema && <span className="text-muted-foreground">{o.schema}.</span>}
                        {o.name}
                      </span>
                      {o.sub && REL_KIND[o.sub] && kind === 'table' && (
                        <span className="shrink-0 text-[11px] text-muted-foreground">{REL_KIND[o.sub]}</span>
                      )}
                      {owner && (
                        <Badge
                          variant="outline"
                          className="shrink-0 text-[10px]"
                          title="Owners always have every privilege"
                        >
                          owner
                        </Badge>
                      )}
                    </div>
                  </td>
                  {privileges.map((p) => {
                    const on = owner || has(o, p);
                    const viaPublic = !on && o.public.includes(p);
                    return (
                      <td key={p} className={cn('px-1 py-1.5 text-center', changed(o, p) && 'bg-warning/10')}>
                        <span className="relative inline-flex">
                          <Checkbox
                            checked={on}
                            disabled={!editable || owner}
                            onCheckedChange={() => onToggle(o, p)}
                            aria-label={`${p} on ${o.name}`}
                            title={viaPublic ? 'Not granted directly, but everyone has it through PUBLIC' : undefined}
                            className={cn(viaPublic && 'border-dashed border-muted-foreground')}
                          />
                        </span>
                      </td>
                    );
                  })}
                  {onPreset && editable && (
                    <td className="px-2 py-1 text-right">
                      <Button
                        variant="ghost"
                        size="xs"
                        className="text-muted-foreground"
                        onClick={() => onPreset(o.name)}
                        title="Grant access to everything in this schema"
                      >
                        All…
                      </Button>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
        {!rows.length && (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">
            {total ? 'Nothing matches.' : `No ${GRANT_KIND_LABEL[kind].toLowerCase()}s in this database.`}
          </p>
        )}
        {rows.length > ROW_CAP && (
          <p className="border-t px-4 py-2 text-xs text-muted-foreground">
            Showing {ROW_CAP} of {rows.length}. Filter to narrow the list, or use “Set schema access” for a whole
            schema.
          </p>
        )}
      </div>
      {rows.some((o) => !o.privileges.length && o.public.length) && (
        <p className="flex items-center gap-2 border-t px-4 py-1.5 text-[11px] text-muted-foreground">
          <span className="inline-block size-3 rounded-[3px] border border-dashed border-muted-foreground" /> granted to
          everyone through PUBLIC
        </p>
      )}
    </div>
  );
}

function DefaultPrivileges({ db, detail, editable }: { db: string; detail: RoleDetail; editable: boolean }) {
  const action = useRoleAction(db);
  if (!detail.defaults.length) return null;
  return (
    <section className="overflow-hidden rounded-lg border">
      <div className="border-b px-4 py-3">
        <h2 className="text-sm font-medium">Granted automatically on new objects</h2>
        <p className="text-xs text-muted-foreground">
          Default privileges: when these roles create objects, {detail.role.name} gets these privileges on them.
        </p>
      </div>
      <ul className="divide-y text-[13px]">
        {detail.defaults.map((p) => (
          <li
            key={`${p.forRole}:${p.schema}:${p.type}`}
            className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2"
          >
            <span className="min-w-0 flex-1">
              New {DEFAULT_ACL_LABEL[p.type] ?? p.type} created by <span className="font-mono">{p.forRole}</span>
              {p.schema ? (
                <>
                  {' '}
                  in <span className="font-mono">{p.schema}</span>
                </>
              ) : (
                ' in any schema'
              )}
            </span>
            <span className="font-mono text-xs text-muted-foreground">{p.privileges.join(', ')}</span>
            {editable && (
              <Button
                variant="ghost"
                size="xs"
                className="text-muted-foreground"
                disabled={action.isPending}
                onClick={() =>
                  action.mutate({
                    action: 'revokeDefault',
                    role: detail.role.name,
                    forRole: p.forRole,
                    schema: p.schema,
                    type: p.type,
                  })
                }
              >
                Remove
              </Button>
            )}
          </li>
        ))}
      </ul>
      {action.error && (
        <p className="border-t px-4 py-2 font-mono text-xs whitespace-pre-wrap text-destructive">
          {errorMessage(action.error)}
        </p>
      )}
    </section>
  );
}
