import { Check, ChevronsUpDown, Database } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useDatabases } from '@/api/hooks';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { dbHref, navigate } from '@/lib/router';
import { cn } from '@/lib/utils';
import { Kbd, Spinner } from './feedback';

/** Searchable database picker. ⌘K / Ctrl+K opens it from anywhere. */
export function DatabaseSwitcher({ current }: { current: string }) {
  const [open, setOpen] = useState(false);
  const databases = useDatabases();

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
          <div className="flex items-center justify-end gap-1 border-t px-3 py-2 text-xs text-muted-foreground">
            Toggle with <Kbd>⌘</Kbd>
            <Kbd>K</Kbd>
          </div>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
