import type { TableMeta } from '@shared/types';
import { DataGrid } from '@/components/app/DataGrid';

const CONSTRAINT_TYPE: Record<string, string> = {
  p: 'primary key',
  u: 'unique',
  f: 'foreign key',
  c: 'check',
  x: 'exclusion',
  t: 'trigger',
};

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

export function StructureTab({ meta }: { meta: TableMeta }) {
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
