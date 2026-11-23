import type { TableMeta } from '@shared/types';
import { DataGrid } from '../components/DataGrid';

const CONSTRAINT_TYPE: Record<string, string> = {
  p: 'primary key',
  u: 'unique',
  f: 'foreign key',
  c: 'check',
  x: 'exclusion',
  t: 'trigger',
};

export function StructureTab({ meta }: { meta: TableMeta }) {
  const pk = new Set(meta.primaryKey);

  const columnRows = meta.columns.map((c) => [
    c.name,
    c.type,
    c.nullable ? 'yes' : 'no',
    c.default,
    [pk.has(c.name) && 'PK', c.identity && 'identity', c.generated && 'generated'].filter(Boolean).join(', ') || null,
    c.comment,
  ]);

  return (
    <div className="structure">
      <section>
        <h2>Columns ({meta.columns.length})</h2>
        <DataGrid fields={['name', 'type', 'nullable', 'default', 'flags', 'comment']} rows={columnRows} wrap />
      </section>
      <section>
        <h2>Indexes ({meta.indexes.length})</h2>
        <DataGrid
          fields={['name', 'definition']}
          rows={meta.indexes.map((i) => [i.name, i.definition])}
          emptyText="No indexes"
          wrap
        />
      </section>
      <section>
        <h2>Constraints ({meta.constraints.length})</h2>
        <DataGrid
          fields={['name', 'type', 'definition']}
          rows={meta.constraints.map((c) => [c.name, CONSTRAINT_TYPE[c.type] ?? c.type, c.definition])}
          emptyText="No constraints"
          wrap
        />
      </section>
    </div>
  );
}
