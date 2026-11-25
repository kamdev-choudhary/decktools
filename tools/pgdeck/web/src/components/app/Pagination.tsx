import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';
import { Button } from '@deck/ui/components/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@deck/ui/components/select';
import { formatNumber } from '@/lib/format';
import { Spinner } from './feedback';

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
    <div className="flex shrink-0 flex-wrap items-center gap-3 border-t bg-background px-3 py-1.5 text-xs md:px-4 text-muted-foreground">
      <span className="tabular-nums">
        <span className="text-foreground">
          {formatNumber(from)}–{formatNumber(to)}
        </span>{' '}
        of {exact ? '' : '~'}
        {formatNumber(total)} rows
      </span>
      {loading && <Spinner className="size-3.5" />}
      <div className="flex-1" />
      <div className="flex items-center gap-2">
        Rows per page
        <Select value={String(pageSize)} onValueChange={(v) => onPageSize(Number(v))}>
          <SelectTrigger size="sm" className="h-7 w-20 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PAGE_SIZES.map((n) => (
              <SelectItem key={n} value={String(n)} className="text-xs">
                {n}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex items-center gap-1">
        <Button variant="outline" size="icon-xs" className="size-7" onClick={() => onPage(0)} disabled={page === 0} aria-label="First page">
          <ChevronsLeft />
        </Button>
        <Button variant="outline" size="icon-xs" className="size-7" onClick={() => onPage(page - 1)} disabled={page === 0} aria-label="Previous page">
          <ChevronLeft />
        </Button>
        <span className="min-w-16 text-center tabular-nums">
          Page {formatNumber(page + 1)}
          {lastPage !== null && ` of ${formatNumber(lastPage + 1)}`}
        </span>
        <Button variant="outline" size="icon-xs" className="size-7" onClick={() => onPage(page + 1)} disabled={!hasNext} aria-label="Next page">
          <ChevronRight />
        </Button>
        {lastPage !== null && (
          <Button
            variant="outline"
            size="icon-xs"
            className="size-7"
            onClick={() => onPage(lastPage)}
            disabled={page >= lastPage}
            aria-label="Last page"
          >
            <ChevronsRight />
          </Button>
        )}
      </div>
    </div>
  );
}
