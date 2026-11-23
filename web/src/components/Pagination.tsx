import { formatNumber } from '../lib/format';
import { Spinner } from './ErrorBox';

const PAGE_SIZES = [50, 100, 250, 500, 1000];

interface PaginationProps {
  page: number;
  pageSize: number;
  shown: number;
  total: number;
  exact: boolean;
  loading: boolean;
  onPage: (page: number) => void;
  onPageSize: (size: number) => void;
}

export function Pagination({ page, pageSize, shown, total, exact, loading, onPage, onPageSize }: PaginationProps) {
  const from = shown ? page * pageSize + 1 : 0;
  const to = page * pageSize + shown;
  // With an estimated total, allow "next" whenever this page came back full.
  const hasNext = exact ? to < total : shown === pageSize;
  const lastPage = exact ? Math.max(Math.ceil(total / pageSize) - 1, 0) : null;

  return (
    <div className="footer">
      <span>
        {formatNumber(from)}–{formatNumber(to)} of {exact ? '' : '~'}
        {formatNumber(total)}
      </span>
      {loading && <Spinner />}
      <div className="spacer" />
      <label>
        Rows{' '}
        <select className="input" value={pageSize} onChange={(e) => onPageSize(Number(e.target.value))}>
          {PAGE_SIZES.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </label>
      <button className="btn" onClick={() => onPage(0)} disabled={page === 0} aria-label="First page">
        «
      </button>
      <button className="btn" onClick={() => onPage(page - 1)} disabled={page === 0}>
        ‹ Prev
      </button>
      <button className="btn" onClick={() => onPage(page + 1)} disabled={!hasNext}>
        Next ›
      </button>
      {lastPage !== null && (
        <button className="btn" onClick={() => onPage(lastPage)} disabled={page >= lastPage} aria-label="Last page">
          »
        </button>
      )}
    </div>
  );
}
