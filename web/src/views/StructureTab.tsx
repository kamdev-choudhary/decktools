import type { Column, TableMeta } from '@shared/types';
import { ArrowRight, Copy, KeyRound, Link2, MoreHorizontal, PencilLine, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { useInfo } from '@/api/hooks';
import { ColumnDialog, DropStructureDialog, IndexDialog } from '@/components/app/structure/StructureDialogs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { tableHref } from '@/lib/router';
import { cn } from '@/lib/utils';

const CONSTRAINT_TYPE: Record<string, string> = {
  p: 'primary key',
  u: 'unique',
  f: 'foreign key',
  c: 'check',
  x: 'exclusion',
  t: 'trigger',
};

interface RelationItem {
  key: string;
  name: string;
  from: string;
  to: string;
  href: string;
}

/** Bordered list of FK relations; each row links to the other table. */
function RelationList({ items, empty }: { items: RelationItem[]; empty: string }) {
  if (!items.length) return <p className="w-full p-4 text-center text-sm text-muted-foreground">{empty}</p>;
  return (
    <ul className="w-full divide-y">
      {items.map((it) => (
        <li key={it.key}>
          <a href={it.href} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-sm transition-colors hover:bg-muted/40">
            <Link2 className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="font-mono text-[13px]">{it.from}</span>
            <ArrowRight className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="font-mono text-[13px] text-link">{it.to}</span>
            <span className="ml-auto font-mono text-[11px] text-muted-foreground">{it.name}</span>
          </a>
        </li>
      ))}
    </ul>
  );
}

function Section({ title, count, action, children }: { title: string; count: number; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <div className="flex min-h-8 items-center justify-between gap-3">
        <h2 className="text-sm font-medium">
          {title} <span className="text-muted-foreground tabular-nums">{count}</span>
        </h2>
        {action}
      </div>
      <div className="flex overflow-x-auto rounded-lg border">{children}</div>
    </section>
  );
}

const Null = () => <span className="text-muted-foreground/60 italic">—</span>;

function RowMenu({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-xs" aria-label={label} className="text-muted-foreground opacity-60 group-hover/row:opacity-100 data-[state=open]:opacity-100">
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const th = 'h-9 px-3 text-left text-xs font-medium whitespace-nowrap text-muted-foreground';
const td = 'px-3 py-2 align-top';

type Dialog =
  | { kind: 'add-column' }
  | { kind: 'edit-column'; column: Column }
  | { kind: 'add-index' }
  | { kind: 'drop'; target: { kind: 'column' | 'index' | 'constraint'; name: string } }
  | null;

export function StructureTab({ db, meta }: { db: string; meta: TableMeta }) {
  const info = useInfo(db);
  const isTable = meta.kind === 'r' || meta.kind === 'p';
  const canEdit = isTable && !(info.data?.readonly ?? true);
  const [dialog, setDialog] = useState<Dialog>(null);
  const pk = new Set(meta.primaryKey);
  const constraintNames = new Set(meta.constraints.filter((c) => c.type === 'p' || c.type === 'u' || c.type === 'x').map((c) => c.name));
  const copy = (text: string, what: string) => void navigator.clipboard.writeText(text).then(() => toast.success(`Copied ${what}`));

  return (
    <div className="mx-auto max-w-6xl space-y-8 px-4 py-6 md:px-6">
      <Section
        title="Columns"
        count={meta.columns.length}
        action={
          canEdit && (
            <Button variant="outline" size="sm" onClick={() => setDialog({ kind: 'add-column' })}>
              <Plus /> Add column
            </Button>
          )
        }
      >
        <table className="w-full text-[13px]">
          <thead className="border-b bg-muted/40">
            <tr>
              <th className={cn(th, 'w-10 text-right')}>#</th>
              <th className={th}>name</th>
              <th className={th}>type</th>
              <th className={th}>nullable</th>
              <th className={th}>default</th>
              <th className={th}>flags</th>
              <th className={th}>comment</th>
              <th className="w-10" />
            </tr>
          </thead>
          <tbody className="divide-y">
            {meta.columns.map((c, i) => (
              <tr key={c.name} className="group/row hover:bg-muted/30">
                <td className={cn(td, 'text-right font-mono text-xs text-muted-foreground tabular-nums')}>{i + 1}</td>
                <td className={cn(td, 'font-mono')}>
                  <span className="inline-flex items-center gap-1.5">
                    {pk.has(c.name) && <KeyRound className="size-3.5 text-warning" aria-label="Primary key" />}
                    {c.name}
                  </span>
                </td>
                <td className={cn(td, 'font-mono text-muted-foreground')}>{c.type}</td>
                <td className={td}>{c.nullable ? 'yes' : <span className="font-medium">no</span>}</td>
                <td className={cn(td, 'max-w-60 font-mono break-all')}>{c.default ?? <Null />}</td>
                <td className={td}>
                  <div className="flex flex-wrap gap-1">
                    {pk.has(c.name) && <Badge variant="secondary">primary key</Badge>}
                    {c.identity && <Badge variant="secondary">identity</Badge>}
                    {c.generated && <Badge variant="secondary">generated</Badge>}
                    {meta.foreignKeys.some((f) => f.columns.includes(c.name)) && <Badge variant="outline">foreign key</Badge>}
                  </div>
                </td>
                <td className={cn(td, 'max-w-60 text-muted-foreground')}>{c.comment ?? <Null />}</td>
                <td className="px-2 py-1.5 text-right align-top">
                  <RowMenu label={`Actions for column ${c.name}`}>
                    <DropdownMenuItem onSelect={() => copy(c.name, 'column name')}>
                      <Copy /> Copy name
                    </DropdownMenuItem>
                    {canEdit && (
                      <>
                        <DropdownMenuItem onSelect={() => setDialog({ kind: 'edit-column', column: c })}>
                          <PencilLine /> Edit column…
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem variant="destructive" onSelect={() => setDialog({ kind: 'drop', target: { kind: 'column', name: c.name } })}>
                          <Trash2 /> Drop column…
                        </DropdownMenuItem>
                      </>
                    )}
                  </RowMenu>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section
        title="Indexes"
        count={meta.indexes.length}
        action={
          canEdit && (
            <Button variant="outline" size="sm" onClick={() => setDialog({ kind: 'add-index' })}>
              <Plus /> Add index
            </Button>
          )
        }
      >
        {meta.indexes.length ? (
          <table className="w-full text-[13px]">
            <thead className="border-b bg-muted/40">
              <tr>
                <th className={th}>name</th>
                <th className={th}>kind</th>
                <th className={th}>definition</th>
                <th className="w-10" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {meta.indexes.map((ix) => {
                const backsConstraint = constraintNames.has(ix.name);
                return (
                  <tr key={ix.name} className="group/row hover:bg-muted/30">
                    <td className={cn(td, 'font-mono')}>{ix.name}</td>
                    <td className={td}>
                      {ix.primary ? <Badge variant="secondary">primary</Badge> : ix.unique ? <Badge variant="secondary">unique</Badge> : <span className="text-muted-foreground">index</span>}
                    </td>
                    <td className={cn(td, 'font-mono break-all text-muted-foreground')}>{ix.definition}</td>
                    <td className="px-2 py-1.5 text-right align-top">
                      <RowMenu label={`Actions for index ${ix.name}`}>
                        <DropdownMenuItem onSelect={() => copy(`${ix.definition};`, 'index definition')}>
                          <Copy /> Copy definition
                        </DropdownMenuItem>
                        {canEdit && (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              variant="destructive"
                              onSelect={() => setDialog({ kind: 'drop', target: { kind: backsConstraint ? 'constraint' : 'index', name: ix.name } })}
                            >
                              <Trash2 /> {backsConstraint ? 'Drop constraint…' : 'Drop index…'}
                            </DropdownMenuItem>
                          </>
                        )}
                      </RowMenu>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <p className="w-full p-4 text-center text-sm text-muted-foreground">No indexes</p>
        )}
      </Section>

      <Section title="Foreign keys" count={meta.foreignKeys.length}>
        <RelationList
          empty="This table doesn't reference other tables."
          items={meta.foreignKeys.map((fk) => ({
            key: fk.name,
            name: fk.name,
            from: `${meta.table}(${fk.columns.join(', ')})`,
            to: `${fk.refSchema}.${fk.refTable}(${fk.refColumns.join(', ')})`,
            href: tableHref(db, fk.refSchema, fk.refTable),
          }))}
        />
      </Section>
      <Section title="Referenced by" count={meta.referencedBy.length}>
        <RelationList
          empty="No other table references this one."
          items={meta.referencedBy.map((r) => ({
            key: `${r.schema}.${r.table}.${r.name}`,
            name: r.name,
            from: `${r.schema}.${r.table}(${r.columns.join(', ')})`,
            to: `${meta.table}(${r.refColumns.join(', ')})`,
            href: tableHref(db, r.schema, r.table),
          }))}
        />
      </Section>

      <Section title="Constraints" count={meta.constraints.length}>
        {meta.constraints.length ? (
          <table className="w-full text-[13px]">
            <thead className="border-b bg-muted/40">
              <tr>
                <th className={th}>name</th>
                <th className={th}>type</th>
                <th className={th}>definition</th>
                <th className="w-10" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {meta.constraints.map((c) => (
                <tr key={c.name} className="group/row hover:bg-muted/30">
                  <td className={cn(td, 'font-mono')}>{c.name}</td>
                  <td className={cn(td, 'whitespace-nowrap')}>{CONSTRAINT_TYPE[c.type] ?? c.type}</td>
                  <td className={cn(td, 'font-mono break-all text-muted-foreground')}>{c.definition}</td>
                  <td className="px-2 py-1.5 text-right align-top">
                    <RowMenu label={`Actions for constraint ${c.name}`}>
                      <DropdownMenuItem onSelect={() => copy(c.definition, 'constraint definition')}>
                        <Copy /> Copy definition
                      </DropdownMenuItem>
                      {canEdit && (
                        <>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem variant="destructive" onSelect={() => setDialog({ kind: 'drop', target: { kind: 'constraint', name: c.name } })}>
                            <Trash2 /> Drop constraint…
                          </DropdownMenuItem>
                        </>
                      )}
                    </RowMenu>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="w-full p-4 text-center text-sm text-muted-foreground">No constraints</p>
        )}
      </Section>

      {dialog?.kind === 'add-column' && <ColumnDialog db={db} meta={meta} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'edit-column' && <ColumnDialog db={db} meta={meta} column={dialog.column} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'add-index' && <IndexDialog db={db} meta={meta} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'drop' && <DropStructureDialog db={db} meta={meta} target={dialog.target} onClose={() => setDialog(null)} />}
    </div>
  );
}
