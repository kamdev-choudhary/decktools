import { Braces, Clock, Shuffle } from 'lucide-react';
import type { Column } from '@shared/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

export type FieldKind = 'boolean' | 'enum' | 'date' | 'datetime' | 'time' | 'uuid' | 'number' | 'json' | 'line' | 'text';

const NUMERIC_TEXT = /^(int2|int4|int8|float4|float8|numeric|money|oid)$/;

/** Decide which editor a column gets, from its Postgres type. */
export function fieldKind(col: Column): FieldKind {
  const t = col.typeName;
  if (col.category === 'E' && col.enumValues?.length) return 'enum';
  if (col.category === 'A') return 'text'; // arrays: literal like {a,b}
  if (t === 'bool') return 'boolean';
  if (t === 'date') return 'date';
  if (t === 'timestamp' || t === 'timestamptz') return 'datetime';
  if (t === 'time' || t === 'timetz') return 'time';
  if (t === 'uuid') return 'uuid';
  if (t === 'json' || t === 'jsonb') return 'json';
  if (col.category === 'N' || NUMERIC_TEXT.test(t)) return 'number';
  if (t === 'varchar' || t === 'bpchar' || t === 'name' || t === 'citext' || t === 'inet' || t === 'cidr' || t === 'macaddr') return 'line';
  return 'text';
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

/** "Now" in the literal format Postgres prints for the column's type. */
function nowLiteral(col: Column): string {
  const d = new Date();
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const time = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
  const offMin = -d.getTimezoneOffset();
  const tz = `${offMin >= 0 ? '+' : '-'}${pad(Math.floor(Math.abs(offMin) / 60))}:${pad(Math.abs(offMin) % 60)}`;
  switch (col.typeName) {
    case 'timestamptz':
      return `${date} ${time}${tz}`;
    case 'timestamp':
      return `${date} ${time}`;
    case 'timetz':
      return `${time}${tz}`;
    case 'time':
      return time;
    default:
      return date;
  }
}

function jsonError(text: string): string | null {
  if (!text.trim()) return null;
  try {
    JSON.parse(text);
    return null;
  } catch (e) {
    return (e as Error).message;
  }
}

interface FieldInputProps {
  id: string;
  column: Column;
  value: string;
  disabled: boolean;
  placeholder: string;
  changed: boolean;
  onChange: (text: string) => void;
}

/** A type-appropriate editor for one column value. Values stay Postgres text literals. */
export function FieldInput({ id, column, value, disabled, placeholder, changed, onChange }: FieldInputProps) {
  // Single-line fields fall back to a textarea for unusually long or multi-line values.
  const baseKind = fieldKind(column);
  const kind: FieldKind = baseKind === 'line' && (value.length > 120 || value.includes('\n')) ? 'text' : baseKind;
  const ring = changed && 'border-warning/60 focus-visible:border-warning';
  const common = { id, 'data-field': column.name, disabled, spellCheck: false } as const;

  switch (kind) {
    case 'boolean': {
      // Postgres prints t/f; it accepts both forms back.
      const current = value === 't' || value === 'true' ? 't' : value === 'f' || value === 'false' ? 'f' : null;
      return (
        <div
          role="radiogroup"
          aria-labelledby={`${id}-label`}
          className={cn('inline-flex rounded-md border p-0.5', disabled && 'pointer-events-none opacity-50', ring)}
        >
          {(['t', 'f'] as const).map((v) => (
            <button
              key={v}
              type="button"
              role="radio"
              aria-checked={current === v}
              data-field={v === 't' ? column.name : undefined}
              id={v === 't' ? id : undefined}
              disabled={disabled}
              onClick={() => onChange(v)}
              className={cn(
                'h-7 rounded-[5px] px-4 font-mono text-xs text-muted-foreground transition-colors hover:text-foreground',
                current === v && 'bg-primary text-primary-foreground hover:text-primary-foreground',
              )}
            >
              {v === 't' ? 'true' : 'false'}
            </button>
          ))}
          {current === null && placeholder && <span className="self-center px-3 text-xs text-muted-foreground">{placeholder}</span>}
        </div>
      );
    }

    case 'enum':
      return (
        <Select value={value || undefined} onValueChange={onChange} disabled={disabled}>
          <SelectTrigger {...common} className={cn('w-full font-mono text-[13px]', ring)}>
            <SelectValue placeholder={placeholder || 'Choose a value'} />
          </SelectTrigger>
          <SelectContent>
            {column.enumValues!.map((v) => (
              <SelectItem key={v} value={v} className="font-mono text-[13px]">
                {v}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );

    case 'date':
      return (
        <Input
          {...common}
          type="date"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={cn('w-48 font-mono text-[13px]', ring)}
        />
      );

    case 'datetime':
    case 'time':
      return (
        <div className="flex gap-2">
          <Input
            {...common}
            value={value}
            placeholder={placeholder || (kind === 'time' ? 'HH:MM:SS' : 'YYYY-MM-DD HH:MM:SS')}
            onChange={(e) => onChange(e.target.value)}
            className={cn('font-mono text-[13px]', ring)}
          />
          <Button type="button" variant="outline" size="sm" className="h-9" disabled={disabled} onClick={() => onChange(nowLiteral(column))}>
            <Clock /> Now
          </Button>
        </div>
      );

    case 'uuid':
      return (
        <div className="flex gap-2">
          <Input
            {...common}
            value={value}
            placeholder={placeholder || '00000000-0000-0000-0000-000000000000'}
            onChange={(e) => onChange(e.target.value)}
            className={cn('font-mono text-[13px]', ring)}
          />
          <Button type="button" variant="outline" size="sm" className="h-9" disabled={disabled} onClick={() => onChange(crypto.randomUUID())}>
            <Shuffle /> Generate
          </Button>
        </div>
      );

    case 'number':
      return (
        <Input
          {...common}
          inputMode="decimal"
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={value !== '' && !/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$|^[-+]?(Infinity|NaN)$/.test(value.trim())}
          className={cn('w-full max-w-64 text-right font-mono text-[13px] tabular-nums', ring)}
        />
      );

    case 'json': {
      const err = jsonError(value);
      return (
        <div className="space-y-1.5">
          <Textarea
            {...common}
            value={value}
            placeholder={placeholder || '{}'}
            onChange={(e) => onChange(e.target.value)}
            aria-invalid={!!err}
            className={cn('max-h-80 min-h-24 font-mono text-[12.5px]', ring)}
          />
          <div className="flex items-center justify-between gap-2 text-xs">
            <span className={err ? 'text-destructive' : 'text-muted-foreground'}>{err ? `Invalid JSON: ${err}` : value.trim() ? 'Valid JSON' : ''}</span>
            <Button
              type="button"
              variant="ghost"
              size="xs"
              disabled={disabled || !!err || !value.trim()}
              onClick={() => onChange(JSON.stringify(JSON.parse(value), null, 2))}
            >
              <Braces /> Format
            </Button>
          </div>
        </div>
      );
    }

    case 'line':
      return (
        <Input
          {...common}
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          className={cn('font-mono text-[13px]', ring)}
        />
      );

    default:
      return (
        <Textarea
          {...common}
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          className={cn('max-h-60 min-h-9 font-mono text-[13px]', ring)}
        />
      );
  }
}
