import { Check, ChevronsUpDown } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Button } from './button';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from './command';
import { Popover, PopoverContent, PopoverTrigger } from './popover';
import { cn } from '../lib/utils';

export interface ComboOption {
  value: string;
  /** Display text; defaults to value. */
  label?: string;
  /** Secondary text on the right, e.g. a column's type. Also searchable. */
  hint?: string;
}

interface ComboboxProps {
  value: string | undefined;
  onChange: (value: string) => void;
  options: ComboOption[];
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  /** Render values in the monospace font (column names, identifiers). */
  mono?: boolean;
  disabled?: boolean;
  className?: string;
  'aria-label'?: string;
  /** Extra content after the list, e.g. a "skip" choice. */
  footer?: ReactNode;
  /** Allow values that aren't in the list: the typed text can be picked as-is. */
  creatable?: boolean;
}

/** A select you can type into: Popover + Command, filtering by value, label and hint. */
export function Combobox({
  value,
  onChange,
  options,
  placeholder = 'Select…',
  searchPlaceholder = 'Search…',
  emptyText = 'No matches.',
  mono = false,
  disabled,
  className,
  footer,
  creatable = false,
  ...aria
}: ComboboxProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const current = options.find((o) => o.value === value) ?? (creatable && value ? { value } : undefined);
  const typed = search.trim();
  const showCreate = creatable && typed !== '' && !options.some((o) => o.value === typed);

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setSearch('');
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-label={aria['aria-label']}
          disabled={disabled}
          className={cn('h-8 min-w-0 justify-between gap-2 px-2.5 text-xs font-normal', className)}
        >
          <span className={cn('min-w-0 truncate', mono && 'font-mono')}>
            {current ? (current.label ?? current.value) : <span className="text-muted-foreground">{placeholder}</span>}
          </span>
          <ChevronsUpDown className="size-3.5 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-(--radix-popover-trigger-width) min-w-60 p-0">
        <Command>
          <CommandInput
            placeholder={searchPlaceholder}
            className="h-9 text-xs"
            value={search}
            onValueChange={setSearch}
          />
          <CommandList className="max-h-64">
            {!showCreate && (
              <CommandEmpty className="py-4 text-center text-xs text-muted-foreground">{emptyText}</CommandEmpty>
            )}
            {showCreate && (
              <CommandGroup forceMount>
                <CommandItem
                  forceMount
                  value={`__create__${typed}`}
                  onSelect={() => {
                    onChange(typed);
                    setOpen(false);
                    setSearch('');
                  }}
                  className="gap-2 text-xs"
                >
                  <span className="text-muted-foreground">Use</span>
                  <span className={cn('min-w-0 truncate', mono && 'font-mono')}>{typed}</span>
                </CommandItem>
              </CommandGroup>
            )}
            <CommandGroup>
              {options.map((o) => (
                <CommandItem
                  key={o.value}
                  value={o.value}
                  keywords={[o.label ?? '', o.hint ?? '']}
                  onSelect={() => {
                    onChange(o.value);
                    setOpen(false);
                    setSearch('');
                  }}
                  className="gap-2 text-xs"
                >
                  <Check className={cn('size-3.5 shrink-0', o.value === value ? 'opacity-100' : 'opacity-0')} />
                  <span className={cn('min-w-0 truncate', mono && 'font-mono')}>{o.label ?? o.value}</span>
                  {o.hint && (
                    <span className="ml-auto shrink-0 pl-2 font-mono text-[11px] text-muted-foreground">{o.hint}</span>
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
          {footer}
        </Command>
      </PopoverContent>
    </Popover>
  );
}
