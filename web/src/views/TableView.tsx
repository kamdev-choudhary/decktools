import { REL_KIND_LABEL } from '@shared/types';
import { useMeta } from '@/api/hooks';
import { CenteredSpinner, ErrorAlert } from '@/components/app/feedback';
import { Badge } from '@/components/ui/badge';
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

export function TableView({ db, schema, table, readonly }: TableViewProps) {
  const meta = useMeta(db, schema, table);

  if (meta.isPending) return <CenteredSpinner label={`Loading ${schema}.${table}…`} />;
  if (meta.isError) return <ErrorAlert error={meta.error} className="m-6 w-auto" />;

  const m = meta.data;
  return (
    <Tabs defaultValue="data" className="flex min-h-0 flex-1 flex-col gap-0">
      <div className="border-b px-4 pt-5 md:px-6">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <h1 className="font-mono text-xl font-semibold tracking-tight">
            <span className="text-muted-foreground">{schema}.</span>
            {table}
          </h1>
          <Badge variant="secondary">{REL_KIND_LABEL[m.kind]}</Badge>
          {!readonly && !m.editable && (
            <Badge variant="outline" title="Rows can be edited only in tables with a primary key, or plain tables (via ctid)">
              Not editable
            </Badge>
          )}
          <span className="text-sm text-muted-foreground">
            {m.size}
            {m.estimate >= 0 && ` · ~${formatNumber(m.estimate)} rows`}
          </span>
        </div>
        {m.comment && <p className="mt-1 text-sm text-muted-foreground">{m.comment}</p>}
        <TabsList variant="line" className="mt-3 h-10 p-0">
          <TabsTrigger value="data" className="px-3">
            Data
          </TabsTrigger>
          <TabsTrigger value="structure" className="px-3">
            Structure
          </TabsTrigger>
        </TabsList>
      </div>
      <TabsContent value="data" className="flex min-h-0 flex-col data-[state=inactive]:hidden">
        <DataTab db={db} meta={m} />
      </TabsContent>
      <TabsContent value="structure" className="min-h-0 overflow-y-auto data-[state=inactive]:hidden">
        <StructureTab meta={m} />
      </TabsContent>
    </Tabs>
  );
}
