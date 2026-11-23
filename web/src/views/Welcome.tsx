import type { DbInfo } from '@shared/types';
import { useTables } from '../api/hooks';
import { formatNumber } from '../lib/format';
import { sqlHref } from '../lib/router';

export function Welcome({ info }: { info?: DbInfo }) {
  const tables = useTables();
  const list = tables.data ?? [];
  const schemas = new Set(list.map((t) => t.schema)).size;

  return (
    <div className="welcome">
      <h2>{info?.database ?? '…'}</h2>
      <p className="hint">{info?.version}</p>
      <div className="stat-row">
        <div className="stat">
          <b>{formatNumber(list.length)}</b>tables &amp; views
        </div>
        <div className="stat">
          <b>{formatNumber(schemas)}</b>schemas
        </div>
        <div className="stat">
          <b>{info?.size ?? '–'}</b>on disk
        </div>
      </div>
      <p>
        Pick a table on the left, or open the <a href={sqlHref}>SQL editor</a>.
      </p>
    </div>
  );
}
