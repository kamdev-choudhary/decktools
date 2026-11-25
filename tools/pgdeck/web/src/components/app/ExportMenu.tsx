import { ChevronDown, Download } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { EXPORT_FORMATS, EXPORT_META, serializeAll, type ExportColumn, type ExportFormat } from '@shared/export';
import type { Cell } from '@shared/types';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { downloadText, formatNumber } from '@/lib/format';

/** A set of rows the user can export: either in memory, or streamed by the server. */
export interface ExportScope {
  id: string;
  label: string;
  count?: number;
  /** Prefix the count with "~" (planner estimate). */
  approximate?: boolean;
  disabled?: boolean;
  rows?: Cell[][];
  /** Server download URL for a format (used instead of `rows`). */
  url?: (format: ExportFormat) => string;
}

interface ExportMenuProps {
  /** File name without extension. */
  baseName: string;
  columns: ExportColumn[];
  /** For SQL INSERT output. */
  target?: { schema: string; table: string };
  scopes: ExportScope[];
  formats?: readonly ExportFormat[];
  disabled?: boolean;
  size?: 'sm' | 'xs';
}

export function ExportMenu({ baseName, columns, target, scopes, formats = EXPORT_FORMATS, disabled, size = 'sm' }: ExportMenuProps) {
  const enabled = scopes.filter((s) => !s.disabled);
  const [scopeId, setScopeId] = useState(enabled[0]?.id ?? '');
  // Fall back if the chosen scope became unavailable (e.g. selection cleared).
  const scope = enabled.find((s) => s.id === scopeId) ?? enabled[0];

  const run = (format: ExportFormat) => {
    if (!scope) return;
    const meta = EXPORT_META[format];
    const filename = `${baseName}.${meta.ext}`;
    if (scope.url) {
      // Streamed by the server straight to disk: works for any table size.
      const a = Object.assign(document.createElement('a'), { href: scope.url(format), download: filename });
      document.body.append(a);
      a.click();
      a.remove();
      toast.info(`Exporting ${filename}`, { description: 'Your browser will show the download progress.' });
    } else {
      downloadText(filename, serializeAll(format, columns, scope.rows ?? [], target), meta.mime);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size={size} className="shrink-0" disabled={disabled || !enabled.length}>
          <Download /> Export <ChevronDown className="opacity-50" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        {scopes.length > 1 && (
          <>
            <DropdownMenuLabel className="text-xs text-muted-foreground">Rows</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={scope?.id} onValueChange={setScopeId}>
              {scopes.map((s) => (
                <DropdownMenuRadioItem
                  key={s.id}
                  value={s.id}
                  disabled={s.disabled}
                  // Keep the menu open while choosing the scope.
                  onSelect={(e) => e.preventDefault()}
                  className="text-[13px]"
                >
                  <span className="flex-1">{s.label}</span>
                  {s.count !== undefined && (
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {s.approximate ? '~' : ''}
                      {formatNumber(s.count)}
                    </span>
                  )}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuLabel className="text-xs text-muted-foreground">Format</DropdownMenuLabel>
        {formats.map((f) => (
          <DropdownMenuItem key={f} onSelect={() => run(f)} className="items-start gap-3">
            <div className="min-w-0 flex-1">
              <div className="text-[13px]">{EXPORT_META[f].label}</div>
              <div className="truncate text-[11px] text-muted-foreground">{EXPORT_META[f].hint}</div>
            </div>
            <span className="pt-0.5 font-mono text-[11px] text-muted-foreground">.{EXPORT_META[f].ext}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
