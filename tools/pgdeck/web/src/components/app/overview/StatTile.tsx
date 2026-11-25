import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

interface StatTileProps {
  label: string;
  icon: LucideIcon;
  value?: ReactNode;
  /** Secondary line under the value. */
  detail?: ReactNode;
  /** 0..1 fill for an optional meter under the value. */
  meter?: number;
  meterTone?: 'neutral' | 'good' | 'warning';
}

export function StatTile({ label, icon: Icon, value, detail, meter, meterTone = 'neutral' }: StatTileProps) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border bg-card p-4">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        {label}
        <Icon className="size-3.5" />
      </div>
      {value === undefined ? (
        <Skeleton className="h-8 w-24" />
      ) : (
        <div className="text-2xl leading-none font-semibold tracking-tight tabular-nums">{value}</div>
      )}
      {meter !== undefined && (
        <div className="h-1.5 overflow-hidden rounded-full bg-muted" role="meter" aria-valuenow={Math.round(meter * 100)} aria-valuemin={0} aria-valuemax={100}>
          <div
            className={cn(
              'h-full rounded-full transition-[width]',
              meterTone === 'good' ? 'bg-success' : meterTone === 'warning' ? 'bg-warning' : 'bg-foreground/70',
            )}
            style={{ width: `${Math.min(Math.max(meter, 0), 1) * 100}%` }}
          />
        </div>
      )}
      {detail !== undefined && <div className="text-xs text-muted-foreground">{detail}</div>}
    </div>
  );
}
