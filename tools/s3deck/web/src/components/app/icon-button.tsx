import type * as React from 'react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

/** Icon-only shadcn Button with a shadcn Tooltip as its accessible label. */
export function IconButton({
  label,
  children,
  size = 'icon-sm',
  variant = 'ghost',
  ...props
}: Omit<React.ComponentProps<typeof Button>, 'aria-label'> & { label: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button size={size} variant={variant} aria-label={label} {...props}>
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
