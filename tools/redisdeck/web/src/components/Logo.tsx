import { cn } from '@deck/ui/lib/utils';

/** redisdeck mark: a stack of layers, a "deck" of keys. Same family as the pgdeck mark. */
export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn('size-6', className)} aria-label="redisdeck" role="img">
      <rect width="32" height="32" rx="8" className="fill-foreground" />
      <g className="stroke-background" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" fill="none">
        <path d="M8.5 12 16 8.75 23.5 12 16 15.25Z" className="fill-background" />
        <path d="M8.5 16.25 16 19.5l7.5-3.25" opacity="0.7" />
        <path d="M8.5 20.5 16 23.75l7.5-3.25" opacity="0.45" />
      </g>
    </svg>
  );
}
