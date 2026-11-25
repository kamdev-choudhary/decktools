import type { KeyType } from '@shared/types';
import { cn } from '@deck/ui/lib/utils';
import { typeColor, typeLabel, typeShort } from '@/lib/types';

/** Small coloured type tag. `full` spells the type out ("Sorted set") instead of "ZSET". */
export function TypeBadge({ type, full, className }: { type: KeyType; full?: boolean; className?: string }) {
  const color = typeColor(type);
  return (
    <span
      title={typeLabel(type)}
      className={cn(
        'inline-flex h-5 shrink-0 items-center justify-center rounded border px-1.5 font-mono text-[10px] font-semibold tracking-wide',
        !full && 'w-12',
        className,
      )}
      style={{ color, borderColor: `color-mix(in oklab, ${color} 35%, transparent)`, background: `color-mix(in oklab, ${color} 8%, transparent)` }}
    >
      {full ? typeLabel(type) : typeShort(type)}
    </span>
  );
}
