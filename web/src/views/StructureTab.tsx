import type { TableMeta } from '@shared/types';
import { ArrowRight, Link2 } from 'lucide-react';
import { DataGrid } from '@/components/app/DataGrid';
import { tableHref } from '@/lib/router';

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

function Section({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-medium">
        {title} <span className="text-muted-foreground tabular-nums">{count}</span>
      </h2>
      <div className="flex overflow-hidden rounded-lg border">{children}</div>
    </section>
  );
}

export function StructureTab({ db, meta }: { db: string; meta: TableMeta }) {
  const pk = new Set(meta.primaryKey);

  const columnRows = meta.columns.map((c) => [
    c.name,
    c.type,
    c.nullable ? 'yes' : 'no',
    c.default,
    [pk.has(c.name) && 'primary key', c.identity && 'identity', c.generated && 'generated'].filter(Boolean).join(', ') || null,
    c.comment,
  ]);

  return (
    <div className="mx-auto max-w-6xl space-y-8 px-4 py-6 md:px-6">
      <Section title="Columns" count={meta.columns.length}>
        <DataGrid fields={['name', 'type', 'nullable', 'default', 'flags', 'comment']} rows={columnRows} wrap />
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
      <Section title="Indexes" count={meta.indexes.length}>
        <DataGrid fields={['name', 'definition']} rows={meta.indexes.map((i) => [i.name, i.definition])} emptyText="No indexes" wrap />
      </Section>
      <Section title="Constraints" count={meta.constraints.length}>
        <DataGrid
          fields={['name', 'type', 'definition']}
          rows={meta.constraints.map((c) => [c.name, CONSTRAINT_TYPE[c.type] ?? c.type, c.definition])}
          emptyText="No constraints"
          wrap
        />
      </Section>
    </div>
  );
}
