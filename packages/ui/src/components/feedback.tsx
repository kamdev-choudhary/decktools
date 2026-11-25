import { Loader2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '../lib/utils';

export const Spinner = ({ className }: { className?: string }) => (
  <Loader2 className={cn('size-4 animate-spin text-muted-foreground', className)} aria-label="Loading" />
);

export function CenteredSpinner({ label }: { label?: string }) {
  return (
    <div className="flex flex-1 items-center justify-center gap-2 p-10 text-sm text-muted-foreground">
      <Spinner /> {label}
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="pointer-events-none inline-flex h-5 items-center rounded border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground select-none">
      {children}
    </kbd>
  );
}

/** Vercel-style diagonal slash between breadcrumb segments. */
export const Slash = () => (
  <svg viewBox="0 0 24 24" className="size-5 shrink-0 text-border" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
    <path d="M16.88 3.549L7.12 20.451" />
  </svg>
);
