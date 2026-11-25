import { useQuery } from '@tanstack/react-query';
import { Plus, Search, UsersRound } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { RoleSummary } from '@shared/roles';
import { api } from '@/api/client';
import { CenteredSpinner, ErrorAlert } from '@/components/app/feedback';
import { CreateRoleDialog, rolesKey } from '@/components/app/roles/RoleDialogs';
import { Badge } from '@deck/ui/components/badge';
import { Button } from '@deck/ui/components/button';
import { Checkbox } from '@deck/ui/components/checkbox';
import { Input } from '@deck/ui/components/input';
import { Tooltip, TooltipContent, TooltipTrigger } from '@deck/ui/components/tooltip';
import { navigate, roleHref } from '@/lib/router';

/** Short labels for the attributes worth calling out in the list. */
export function roleBadges(r: RoleSummary): { label: string; tone?: 'warning' }[] {
  const out: { label: string; tone?: 'warning' }[] = [];
  if (r.superuser) out.push({ label: 'superuser', tone: 'warning' });
  if (r.createrole) out.push({ label: 'create roles' });
  if (r.createdb) out.push({ label: 'create databases' });
  if (r.replication) out.push({ label: 'replication' });
  if (r.bypassrls) out.push({ label: 'bypass RLS', tone: 'warning' });
  if (!r.inherit) out.push({ label: 'no inherit' });
  return out;
}

export function expiry(validUntil: string | null): { text: string; expired: boolean } | null {
  if (!validUntil) return null;
  const d = new Date(validUntil.replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) return { text: validUntil, expired: false };
  return {
    text: d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }),
    expired: d.getTime() < Date.now(),
  };
}

export function RolesView({ db, readonly }: { db: string; readonly: boolean }) {
  const q = useQuery({ queryKey: rolesKey(db), queryFn: () => api.roles(db) });
  const [filter, setFilter] = useState('');
  const [showSystem, setShowSystem] = useState(false);
  const [creating, setCreating] = useState(false);

  const roles = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    return (q.data?.roles ?? []).filter(
      (r) =>
        (showSystem || !r.system) &&
        (!needle || r.name.toLowerCase().includes(needle) || r.comment?.toLowerCase().includes(needle)),
    );
  }, [q.data, filter, showSystem]);

  if (q.isPending) return <CenteredSpinner />;
  if (q.isError) return <ErrorAlert error={q.error} className="m-6 w-auto" />;
  const { me } = q.data;
  const canCreate = !readonly && (me.superuser || me.createrole);
  const users = q.data.roles.filter((r) => !r.system && r.login).length;
  const groups = q.data.roles.filter((r) => !r.system && !r.login).length;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="mx-auto w-full max-w-6xl space-y-5 px-4 py-6 md:px-6">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div className="space-y-1">
            <h1 className="text-xl font-semibold tracking-tight">Roles</h1>
            <p className="text-sm text-muted-foreground">
              {users} user{users === 1 ? '' : 's'} and {groups} group{groups === 1 ? '' : 's'} on this server. Roles are
              shared by every database; privileges are set per database.
            </p>
          </div>
          {!readonly && (
            <Tooltip>
              <TooltipTrigger asChild>
                <span>
                  <Button size="sm" disabled={!canCreate} onClick={() => setCreating(true)}>
                    <Plus /> New role
                  </Button>
                </span>
              </TooltipTrigger>
              {!canCreate && (
                <TooltipContent>{me.name} needs the CREATEROLE attribute or superuser to create roles.</TooltipContent>
              )}
            </Tooltip>
          )}
        </header>

        <div className="flex flex-wrap items-center gap-3">
          <div className="relative w-full max-w-xs">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Search roles…"
              className="h-8 pl-8 text-[13px]"
              spellCheck={false}
            />
          </div>
          <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
            <Checkbox checked={showSystem} onCheckedChange={(v) => setShowSystem(v === true)} />
            Show built-in roles (pg_*)
          </label>
        </div>

        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full min-w-[46rem] text-sm">
            <thead className="border-b bg-grid-header text-xs text-muted-foreground">
              <tr className="text-left">
                <th className="px-4 py-2 font-medium">Role</th>
                <th className="px-3 py-2 font-medium">Type</th>
                <th className="px-3 py-2 font-medium">Attributes</th>
                <th className="px-3 py-2 font-medium">Member of</th>
                <th className="px-3 py-2 text-right font-medium">Connections</th>
                <th className="px-4 py-2 text-right font-medium">Password expires</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {roles.map((r) => {
                const exp = expiry(r.validUntil);
                return (
                  <tr
                    key={r.oid}
                    className="cursor-pointer hover:bg-muted/40"
                    onClick={(e) => {
                      if (!(e.target as HTMLElement).closest('a')) navigate(roleHref(db, r.name));
                    }}
                  >
                    <td className="max-w-64 px-4 py-2.5">
                      <a href={roleHref(db, r.name)} className="font-mono font-medium break-all hover:underline">
                        {r.name}
                      </a>
                      {r.current && (
                        <Badge variant="outline" className="ml-2 align-middle">
                          you
                        </Badge>
                      )}
                      {r.comment && <p className="truncate text-xs text-muted-foreground">{r.comment}</p>}
                    </td>
                    <td className="px-3 py-2.5 text-xs text-muted-foreground">
                      {r.system ? 'built-in' : r.login ? 'user' : 'group'}
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex flex-wrap gap-1">
                        {roleBadges(r).map((b) => (
                          <Badge
                            key={b.label}
                            variant="outline"
                            className={
                              b.tone === 'warning' ? 'border-warning/40 text-warning' : 'text-muted-foreground'
                            }
                          >
                            {b.label}
                          </Badge>
                        ))}
                      </div>
                    </td>
                    <td className="max-w-56 px-3 py-2.5 font-mono text-xs text-muted-foreground">
                      <span className="line-clamp-2 break-all">{r.memberOf.map((m) => m.role).join(', ') || '—'}</span>
                    </td>
                    <td className="px-3 py-2.5 text-right text-xs text-muted-foreground tabular-nums">
                      {r.login ? (r.connLimit === -1 ? 'unlimited' : r.connLimit) : '—'}
                    </td>
                    <td
                      className={`px-4 py-2.5 text-right text-xs tabular-nums ${exp?.expired ? 'text-destructive' : 'text-muted-foreground'}`}
                    >
                      {exp ? `${exp.expired ? 'expired ' : ''}${exp.text}` : r.login ? 'never' : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!roles.length && (
            <div className="flex flex-col items-center gap-2 p-10 text-center text-sm text-muted-foreground">
              <UsersRound className="size-5" />
              {filter ? 'No roles match your search.' : 'No roles yet.'}
            </div>
          )}
        </div>
      </div>

      {creating && (
        <CreateRoleDialog
          db={db}
          data={q.data}
          onClose={() => setCreating(false)}
          onCreated={(name) => navigate(roleHref(db, name))}
        />
      )}
    </div>
  );
}
