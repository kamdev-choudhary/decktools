import { Check, ChevronsUpDown, Database, Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useDatabases, useInfo } from '@/api/hooks';
import { CreateDatabaseDialog } from './DatabaseActions';
import { Badge } from '@deck/ui/components/badge';
import { Button } from '@deck/ui/components/button';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@deck/ui/components/command';
import { Popover, PopoverContent, PopoverTrigger } from '@deck/ui/components/popover';
import { dbHref, navigate } from '@/lib/router';
import { cn } from '@deck/ui/lib/utils';
import { Kbd, Spinner } from './feedback';

/** Searchable database picker. ⌘K / Ctrl+K opens it from anywhere. */
export function DatabaseSwitcher({ current }: { current: string }) {
  const [open, setOpen] = useState(false);
  const databases = useDatabases();
  const readonly = useInfo(current).data?.readonly ?? true;
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const list = databases.data?.databases ?? [];

  return (
    <>
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" role="combobox" aria-expanded={open} className="gap-2 px-2 font-medium">
          <Database className="text-muted-foreground" />
          <span className="max-w-[16ch] truncate sm:max-w-[28ch]">{current}</span>
          <ChevronsUpDown className="size-3.5 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="start">
        <Command>
          <CommandInput placeholder="Find a database…" />
          <CommandList className="max-h-80">
            {databases.isPending ? (
              <div className="flex justify-center p-6">
                <Spinner />
              </div>
            ) : (
              <CommandEmpty>No database found.</CommandEmpty>
            )}
            <CommandGroup heading={`Databases · ${list.length}`}>
              {list.map((d) => (
                <CommandItem
                  key={d.name}
                  value={d.name}
                  onSelect={() => {
                    setOpen(false);
                    if (d.name !== current) navigate(dbHref(d.name));
                  }}
                >
                  <Check className={cn('size-4', d.name === current ? 'opacity-100' : 'opacity-0')} />
                  <span className="flex-1 truncate">{d.name}</span>
                  {d.name === databases.data?.default && (
                    <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
                      default
                    </Badge>
                  )}
                  <span className="text-xs text-muted-foreground tabular-nums">{d.size}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
          <div className="flex items-center gap-1 border-t px-2 py-1.5 text-xs text-muted-foreground">
            {!readonly && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={() => {
                  setOpen(false);
                  setCreating(true);
                }}
              >
                <Plus /> New database
              </Button>
            )}
            <span className="ml-auto flex items-center gap-1">
              <Kbd>⌘</Kbd>
              <Kbd>K</Kbd>
            </span>
          </div>
        </Command>
      </PopoverContent>
    </Popover>
    {creating && <CreateDatabaseDialog onClose={() => setCreating(false)} />}
    </>
  );
}
