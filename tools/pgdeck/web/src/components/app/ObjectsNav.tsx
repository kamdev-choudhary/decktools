import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useInfo } from '@/api/hooks';
import { Button } from '@deck/ui/components/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@deck/ui/components/command';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@deck/ui/components/dialog';
import { openInSqlEditor } from '@/lib/sql-draft';
import { errorMessage, Spinner } from './feedback';
import { Blocks, ChevronRight, Hash, Plus, SquareFunction, Zap, type LucideIcon } from 'lucide-react';
import { useState } from 'react';
import type { ObjectKind } from '@shared/types';
import { api } from '@/api/client';
import { keys } from '@/api/hooks';
import { navigate, objectHref, type Route } from '@/lib/router';
import { cn } from '@deck/ui/lib/utils';
import { TruncatedText } from '@deck/ui/components/truncated-text';

interface Item {
  oid: number;
  label: string;
  hint: string;
  muted?: boolean;
}

const SECTIONS: { kind: ObjectKind; title: string; icon: LucideIcon }[] = [
  { kind: 'function', title: 'Functions', icon: SquareFunction },
  { kind: 'trigger', title: 'Triggers', icon: Zap },
  { kind: 'sequence', title: 'Sequences', icon: Hash },
  { kind: 'extension', title: 'Extensions', icon: Blocks },
];

/** Functions, triggers, sequences and extensions under the table list. Collapsed until opened or searched. */
export function ObjectsNav({ db, filter, route }: { db: string; filter: string; route: Route }) {
  const objects = useQuery({ queryKey: [...keys.db(db), 'objects'], queryFn: () => api.objects(db) });
  const [open, setOpen] = useState<Set<ObjectKind>>(() =>
    route.view === 'object' ? new Set([route.kind]) : new Set(),
  );
  const [installing, setInstalling] = useState(false);
  const readonly = useInfo(db).data?.readonly ?? true;
  const o = objects.data;
  if (!o) return null;

  const needle = filter.trim().toLowerCase();
  const items: Record<ObjectKind, Item[]> = {
    function: o.functions.map((f) => ({
      oid: f.oid,
      label: f.name,
      hint: `${f.schema}.${f.name}(${f.args})${f.kind === 'p' ? ' · procedure' : f.kind === 'a' ? ' · aggregate' : ''}`,
    })),
    trigger: o.triggers.map((t) => ({
      oid: t.oid,
      label: t.name,
      hint: `on ${t.schema}.${t.table}${t.enabled ? '' : ' · disabled'}`,
      muted: !t.enabled,
    })),
    sequence: o.sequences.map((s) => ({
      oid: s.oid,
      label: s.name,
      hint: s.ownedBy ? `for ${s.ownedBy}` : `${s.schema}.${s.name}`,
    })),
    extension: o.extensions.map((e) => ({ oid: e.oid, label: e.name, hint: `version ${e.version}` })),
  };
  const activeOid = route.view === 'object' ? route.oid : null;

  return (
    <div className="mt-4 border-t pt-3">
      {SECTIONS.map(({ kind, title, icon: Icon }) => {
        const list = needle
          ? items[kind].filter((i) => `${i.label} ${i.hint}`.toLowerCase().includes(needle))
          : items[kind];
        if (needle && !list.length) return null;
        const expanded = !!needle || open.has(kind);
        return (
          <div key={kind} className="group/sec relative mt-1">
            {!readonly && (kind === 'function' || kind === 'extension') && (
              <button
                type="button"
                aria-label={kind === 'function' ? 'New function' : 'Install extension'}
                title={kind === 'function' ? 'New function (opens a template in the SQL editor)' : 'Install extension'}
                onClick={() => (kind === 'function' ? openInSqlEditor(db, FUNCTION_TEMPLATE) : setInstalling(true))}
                className="absolute top-1 right-8 z-10 rounded p-0.5 text-muted-foreground opacity-0 group-hover/sec:opacity-100 hover:bg-sidebar-accent hover:text-foreground focus-visible:opacity-100"
              >
                <Plus className="size-3.5" />
              </button>
            )}
            <button
              type="button"
              aria-expanded={expanded}
              onClick={() =>
                setOpen((p) => {
                  const n = new Set(p);
                  if (n.has(kind)) n.delete(kind);
                  else n.add(kind);
                  return n;
                })
              }
              className="flex h-7 w-full items-center gap-1 rounded-md px-1 text-xs font-medium text-muted-foreground hover:text-foreground"
            >
              <ChevronRight className={cn('size-3.5 transition-transform', expanded && 'rotate-90')} />
              <span className="flex-1 text-left">{title}</span>
              <span className="tabular-nums">{items[kind].length}</span>
            </button>
            {expanded && (
              <div className="mt-0.5 space-y-px">
                {!list.length && <p className="py-1.5 pl-6 text-xs text-muted-foreground">None</p>}
                {list.map((i) => (
                  <a
                    key={i.oid}
                    href={objectHref(db, kind, i.oid)}
                    aria-current={activeOid === i.oid ? 'page' : undefined}
                    className={cn(
                      'flex h-8 min-w-0 items-center gap-2 rounded-md pr-2 pl-6 text-[13px] text-foreground/80 transition-colors hover:bg-sidebar-accent hover:text-foreground',
                      activeOid === i.oid && 'bg-sidebar-accent font-medium text-foreground',
                      i.muted && 'opacity-60',
                    )}
                  >
                    <Icon className="size-4 shrink-0 opacity-70" />
                    <TruncatedText text={i.label} side="right" tooltip={<span className="font-mono">{i.hint}</span>} />
                  </a>
                ))}
              </div>
            )}
          </div>
        );
      })}
      {installing && <InstallExtensionDialog db={db} onClose={() => setInstalling(false)} />}
    </div>
  );
}

const FUNCTION_TEMPLATE = `CREATE OR REPLACE FUNCTION public.my_function(arg integer)
RETURNS integer
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN arg;
END;
$$;
`;

function InstallExtensionDialog({ db, onClose }: { db: string; onClose: () => void }) {
  const qc = useQueryClient();
  const available = useQuery({
    queryKey: [...keys.db(db), 'extensions-available'],
    queryFn: () => api.availableExtensions(db),
  });
  const install = useMutation({
    mutationFn: (name: string) => api.objectAction(db, { kind: 'extension', action: 'create', name }),
    onSuccess: (r) => {
      toast.success(r.message);
      void qc.invalidateQueries({ queryKey: keys.db(db) });
      onClose();
      if (r.oid) navigate(objectHref(db, 'extension', r.oid));
    },
    onError: (e) => toast.error('Could not install the extension', { description: errorMessage(e) }),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && !install.isPending && onClose()}>
      <DialogContent className="flex max-h-[calc(100dvh-4rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-lg">
        <DialogHeader className="border-b px-5 py-4">
          <DialogTitle>Install extension</DialogTitle>
          <DialogDescription>Extensions this server has available but this database doesn't use yet.</DialogDescription>
        </DialogHeader>
        <Command className="min-h-0 flex-1">
          <CommandInput placeholder="Find an extension…" />
          <CommandList className="max-h-[50vh]">
            {available.isPending ? (
              <div className="flex justify-center p-6">
                <Spinner />
              </div>
            ) : (
              <CommandEmpty>No matching extensions.</CommandEmpty>
            )}
            <CommandGroup>
              {(available.data ?? []).map((e) => (
                <CommandItem
                  key={e.name}
                  value={e.name}
                  keywords={[e.comment ?? '']}
                  onSelect={() => !install.isPending && install.mutate(e.name)}
                  className="items-start gap-3 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[13px]">{e.name}</span>
                      <span className="text-[11px] text-muted-foreground">{e.defaultVersion}</span>
                    </div>
                    {e.comment && <p className="mt-0.5 text-xs text-muted-foreground">{e.comment}</p>}
                  </div>
                  {install.isPending && install.variables === e.name ? (
                    <Spinner />
                  ) : (
                    <span className="shrink-0 text-xs text-muted-foreground">Install</span>
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
        <div className="flex justify-end border-t px-5 py-3">
          <Button variant="outline" size="sm" onClick={onClose} disabled={install.isPending}>
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
