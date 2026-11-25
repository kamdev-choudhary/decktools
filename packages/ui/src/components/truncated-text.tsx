import { useRef, useState, type ReactNode } from 'react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

interface TruncatedTextProps {
  text: string;
  /** Tooltip body; defaults to the full text. */
  tooltip?: ReactNode;
  side?: 'top' | 'right' | 'bottom' | 'left';
  className?: string;
}

/** Single-line text with an ellipsis; shows the full text on hover only when it's actually cut off. */
export function TruncatedText({ text, tooltip, side = 'top', className }: TruncatedTextProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);

  return (
    <Tooltip
      open={open}
      onOpenChange={(next) => {
        const el = ref.current;
        setOpen(next && !!el && el.scrollWidth > el.clientWidth);
      }}
    >
      <TooltipTrigger asChild>
        <span ref={ref} className={cn('block min-w-0 truncate', className)}>
          {text}
        </span>
      </TooltipTrigger>
      <TooltipContent side={side} className="max-w-sm break-all">
        {tooltip ?? text}
      </TooltipContent>
    </Tooltip>
  );
}
