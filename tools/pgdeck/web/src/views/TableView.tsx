import { HardDrive, ListTree, Lock, Rows3, Sheet, Table2 } from 'lucide-react';
import { useState } from 'react';
import { Badge } from '@deck/ui/components/badge';
import { REL_KIND_LABEL } from '@shared/types';
import { useMeta } from '@/api/hooks';
import { CenteredSpinner, ErrorAlert } from '@/components/app/feedback';
import { Tooltip, TooltipContent, TooltipTrigger } from '@deck/ui/components/tooltip';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@deck/ui/components/tabs';
import { formatNumber } from '@/lib/format';
import { TableActionsMenu } from '@/components/app/TableActionsMenu';
import { DataTab } from './DataTab';
import { StructureTab } from './StructureTab';

interface TableViewProps {
  db: string;
  schema: string;
  table: string;
  /** Initial equality filters from the URL (FK navigation). */
  eq: Record<string, string>;
  readonly: boolean;
}

/**
 * One slim toolbar row (tabs · table facts · tab actions) so the grid gets
 * nearly all of the vertical space. The table name itself is in the header
 * breadcrumb, so it isn't repeated here.
 */
const TAB =
  'h-full flex-none gap-1.5 rounded-md px-2.5 text-[13px] text-muted-foreground data-[state=active]:border-border data-[state=active]:bg-background data-[state=active]:text-foreground [&_svg:not([class*=size-])]:size-3.5';

export function TableView({ db, schema, table, eq, readonly }: TableViewProps) {
  const meta = useMeta(db, schema, table);
  const [tab, setTab] = useState('data');
  // The Data tab renders its filter chips and actions into this slot.
  const [actionsSlot, setActionsSlot] = useState<HTMLDivElement | null>(null);

  if (meta.isPending) return <CenteredSpinner label={`Loading ${schema}.${table}…`} />;
  if (meta.isError) return <ErrorAlert error={meta.error} className="m-6 w-auto" />;

  const m = meta.data;
  return (
    <Tabs value={tab} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col gap-0">
      <div className="flex h-12 shrink-0 items-center gap-3 border-b px-3 md:px-4">
        {/* Segmented control, styled like the rest of the app: bordered, no shadow. */}
        <TabsList className="h-8 shrink-0 gap-0.5 rounded-lg border bg-muted/60 p-0.5">
          <TabsTrigger value="data" className={TAB}>
            <Sheet /> Data
          </TabsTrigger>
          <TabsTrigger value="structure" className={TAB}>
            <ListTree /> Structure
          </TabsTrigger>
        </TabsList>
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="hidden shrink-0 cursor-default items-center gap-1.5 lg:flex">
              <Badge variant="secondary" className="capitalize">
                <Table2 /> {REL_KIND_LABEL[m.kind]}
              </Badge>
              <Badge variant="outline" className="text-muted-foreground tabular-nums">
                <HardDrive /> {m.size}
              </Badge>
              {m.estimate >= 0 && (
                <Badge variant="outline" className="text-muted-foreground tabular-nums">
                  <Rows3 /> ~{formatNumber(m.estimate)} rows
                </Badge>
              )}
              {!readonly && !m.editable && (
                <Badge variant="outline" className="border-warning/40 text-warning">
                  <Lock /> Read-only
                </Badge>
              )}
            </div>
          </TooltipTrigger>
          <TooltipContent className="max-w-xs">
            <div className="font-mono">
              {schema}.{table}
            </div>
            {m.comment && <div className="mt-1 opacity-80">{m.comment}</div>}
            {!readonly && !m.editable && (
              <div className="mt-1 opacity-80">No primary key, so rows can't be edited here.</div>
            )}
          </TooltipContent>
        </Tooltip>
        <div ref={setActionsSlot} className="flex min-w-0 flex-1 items-center justify-end gap-2" />
        <TableActionsMenu db={db} schema={schema} table={table} kind={m.kind} variant="toolbar" className="shrink-0" />
      </div>

      <TabsContent value="data" className="flex min-h-0 flex-col data-[state=inactive]:hidden">
        <DataTab
          db={db}
          meta={m}
          initialEq={eq}
          readonly={readonly}
          actionsSlot={tab === 'data' ? actionsSlot : null}
        />
      </TabsContent>
      <TabsContent value="structure" className="min-h-0 overflow-y-auto data-[state=inactive]:hidden">
        <StructureTab db={db} meta={m} />
      </TabsContent>
    </Tabs>
  );
}
