import { cn } from '@/lib/utils';

/** pgdeck mark: three stacked slabs, a "deck" of tables. */
export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn('size-6', className)} aria-label="pgdeck" role="img">
      <rect width="32" height="32" rx="8" className="fill-foreground" />
      <g className="fill-background">
        <rect x="8" y="8.5" width="16" height="3.5" rx="1.75" />
        <rect x="8" y="14.25" width="16" height="3.5" rx="1.75" opacity="0.7" />
        <rect x="8" y="20" width="10" height="3.5" rx="1.75" opacity="0.45" />
      </g>
    </svg>
  );
}
