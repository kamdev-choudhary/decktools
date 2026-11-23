import { useState } from 'react';
import { REL_KIND_LABEL } from '@shared/types';
import { useMeta } from '../api/hooks';
import { ErrorBox, Spinner } from '../components/ErrorBox';
import { formatNumber } from '../lib/format';
import { DataTab } from './DataTab';
import { StructureTab } from './StructureTab';

type Tab = 'data' | 'structure';

export function TableView({ schema, table, readonly }: { schema: string; table: string; readonly: boolean }) {
  const meta = useMeta(schema, table);
  const [tab, setTab] = useState<Tab>('data');

  if (meta.isPending) {
    return (
      <div className="welcome">
        <Spinner /> Loading {schema}.{table}…
      </div>
    );
  }
  if (meta.isError) return <ErrorBox error={meta.error} />;

  const m = meta.data;
  return (
    <>
      <div className="view-head">
        <h1>
          <span className="schema-name">{schema}.</span>
          {table}
        </h1>
        <span className="badge accent">{REL_KIND_LABEL[m.kind]}</span>
        <span className="meta-chip">
          {m.size}
          {m.estimate >= 0 && ` · ~${formatNumber(m.estimate)} rows`}
        </span>
        {!readonly && !m.editable && (
          <span className="badge" title="Rows can only be edited in tables that have a primary key (or plain tables via ctid)">
            not editable
          </span>
        )}
        {m.comment && <span className="meta-chip">{m.comment}</span>}
      </div>
      <div className="tabs" role="tablist">
        {(['data', 'structure'] as const).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} className={`tab ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>
            {t === 'data' ? 'Data' : 'Structure'}
          </button>
        ))}
      </div>
      <div className="pane">{tab === 'data' ? <DataTab meta={m} /> : <StructureTab meta={m} />}</div>
    </>
  );
}
