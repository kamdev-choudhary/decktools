import { useState } from 'react';
import { REL_KIND_LABEL } from '@shared/types';
import { useMeta } from '@/api/hooks';
import { CenteredSpinner, ErrorAlert } from '@/components/app/feedback';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { formatNumber } from '@/lib/format';
import { DataTab } from './DataTab';
import { StructureTab } from './StructureTab';

interface TableViewProps {
  db: string;
  schema: string;
  table: string;
  readonly: boolean;
}

/**
 * One slim toolbar row (tabs · table facts · tab actions) so the grid gets
 * nearly all of the vertical space. The table name itself is in the header
 * breadcrumb, so it isn't repeated here.
 */
export function TableView({ db, schema, table, readonly }: TableViewProps) {
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
        <TabsList variant="line" className="h-full shrink-0 p-0">
          <TabsTrigger value="data" className="px-2.5">
            Data
          </TabsTrigger>
          <TabsTrigger value="structure" className="px-2.5">
            Structure
          </TabsTrigger>
        </TabsList>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="hidden shrink-0 cursor-default text-xs text-muted-foreground lg:inline">
              {REL_KIND_LABEL[m.kind]} · {m.size}
              {m.estimate >= 0 && ` · ~${formatNumber(m.estimate)} rows`}
              {!readonly && !m.editable && ' · read-only'}
            </span>
          </TooltipTrigger>
          <TooltipContent className="max-w-xs">
            <div className="font-mono">
              {schema}.{table}
            </div>
            {m.comment && <div className="mt-1 opacity-80">{m.comment}</div>}
            {!readonly && !m.editable && <div className="mt-1 opacity-80">No primary key, so rows can't be edited here.</div>}
          </TooltipContent>
        </Tooltip>
        <div ref={setActionsSlot} className="flex min-w-0 flex-1 items-center justify-end gap-2" />
      </div>

      <TabsContent value="data" className="flex min-h-0 flex-col data-[state=inactive]:hidden">
        <DataTab db={db} meta={m} actionsSlot={tab === 'data' ? actionsSlot : null} />
      </TabsContent>
      <TabsContent value="structure" className="min-h-0 overflow-y-auto data-[state=inactive]:hidden">
        <StructureTab meta={m} />
      </TabsContent>
    </Tabs>
  );
}
