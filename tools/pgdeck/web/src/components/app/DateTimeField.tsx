import { CalendarDays, Clock } from 'lucide-react';
import { useState } from 'react';
import type { Column } from '@shared/types';
import { Button } from '@deck/ui/components/button';
import { Calendar } from '@deck/ui/components/calendar';
import { Input } from '@deck/ui/components/input';
import { Popover, PopoverContent, PopoverTrigger } from '@deck/ui/components/popover';
import { cn } from '@deck/ui/lib/utils';

export type DateTimeMode = 'date' | 'datetime' | 'time';

/**
 * A Postgres date/time literal split into wall-clock parts. We never convert
 * through a JS Date, so the value's own timezone offset and precision survive
 * untouched: picking a day only replaces the date part, and so on.
 */
interface Parts {
  date: string | null; // YYYY-MM-DD
  time: string | null; // HH:MM:SS
  frac: string; // ".123" or ""
  tz: string; // "+05:30", "Z" or ""
}

const LITERAL = /^(\d{4}-\d{2}-\d{2})?(?:[ T]?(\d{2}:\d{2}(?::\d{2})?)(\.\d+)?)?\s*([+-]\d{2}(?::?\d{2})?|Z)?$/;

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

function localOffset(): string {
  const m = -new Date().getTimezoneOffset();
  return `${m >= 0 ? '+' : '-'}${pad(Math.floor(Math.abs(m) / 60))}:${pad(Math.abs(m) % 60)}`;
}

function parse(value: string): Parts | null {
  const m = LITERAL.exec(value.trim());
  if (!m || (!m[1] && !m[2])) return null;
  const time = m[2] ? (m[2].length === 5 ? `${m[2]}:00` : m[2]) : null;
  return { date: m[1] ?? null, time, frac: m[3] ?? '', tz: m[4] ?? '' };
}

const hasTz = (col: Column) => col.typeName === 'timestamptz' || col.typeName === 'timetz';

function format(mode: DateTimeMode, col: Column, p: Parts): string {
  const tz = hasTz(col) ? p.tz || localOffset() : '';
  const time = p.time ?? '00:00:00';
  if (mode === 'date') return p.date ?? '';
  if (mode === 'time') return `${time}${p.frac}${tz}`;
  return `${p.date ?? todayString()} ${time}${p.frac}${tz}`;
}

function todayString(d = new Date()): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function nowParts(): Parts {
  const d = new Date();
  return {
    date: todayString(d),
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`,
    frac: `.${pad(d.getMilliseconds(), 3)}`,
    tz: localOffset(),
  };
}

/** "YYYY-MM-DD" → a local Date at midnight (for the calendar), without timezone shifts. */
function toCalendarDate(date: string | null): Date | undefined {
  if (!date) return undefined;
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y!, m! - 1, d!);
}

interface DateTimeFieldProps {
  id: string;
  column: Column;
  mode: DateTimeMode;
  value: string;
  disabled: boolean;
  placeholder: string;
  className?: string;
  onChange: (text: string) => void;
}

/** Free-text date/time input with a calendar + time picker beside it. */
export function DateTimeField({
  id,
  column,
  mode,
  value,
  disabled,
  placeholder,
  className,
  onChange,
}: DateTimeFieldProps) {
  const [open, setOpen] = useState(false);
  const parts = parse(value);
  const invalid = value.trim() !== '' && !parts;
  const base: Parts = parts ?? { date: null, time: null, frac: '', tz: '' };
  const selected = toCalendarDate(base.date);
  const tzShown = hasTz(column) ? base.tz || localOffset() : null;

  const set = (patch: Partial<Parts>) => onChange(format(mode, column, { ...base, ...patch }));

  const hint = mode === 'date' ? 'YYYY-MM-DD' : mode === 'time' ? 'HH:MM:SS' : 'YYYY-MM-DD HH:MM:SS';

  return (
    <div className="flex gap-2">
      <Input
        id={id}
        data-field={column.name}
        value={value}
        disabled={disabled}
        spellCheck={false}
        placeholder={placeholder || hint}
        aria-invalid={invalid}
        onChange={(e) => onChange(e.target.value)}
        className={cn('font-mono text-[13px]', className)}
      />
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="size-9 shrink-0"
            disabled={disabled}
            aria-label={mode === 'time' ? 'Pick a time' : 'Pick a date'}
          >
            {mode === 'time' ? <Clock /> : <CalendarDays />}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-auto p-0">
          {invalid && (
            <p className="border-b px-3 py-2 text-xs text-destructive">
              Couldn't read the current value; picking will replace it.
            </p>
          )}
          {mode !== 'time' && (
            <Calendar
              mode="single"
              selected={selected}
              defaultMonth={selected}
              captionLayout="dropdown"
              startMonth={new Date(1900, 0)}
              endMonth={new Date(2100, 11)}
              onSelect={(d) => d && set({ date: todayString(d) })}
            />
          )}
          {mode !== 'date' && (
            <div className="flex items-center gap-2 border-t p-3">
              <Clock className="size-4 text-muted-foreground" />
              <Input
                type="time"
                step={1}
                aria-label="Time"
                value={base.time ?? ''}
                onChange={(e) => {
                  const t = e.target.value;
                  if (t) set({ time: t.length === 5 ? `${t}:00` : t });
                }}
                className="h-8 flex-1 font-mono text-[13px] [&::-webkit-calendar-picker-indicator]:hidden"
              />
              {tzShown && (
                <span
                  className="rounded border px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground"
                  title="Timezone offset kept from the value"
                >
                  UTC{tzShown === 'Z' ? '' : tzShown}
                </span>
              )}
            </div>
          )}
          <div className="flex items-center justify-between gap-2 border-t p-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => onChange(format(mode, column, nowParts()))}>
              {mode === 'date' ? 'Today' : 'Now'}
            </Button>
            <div className="flex gap-1">
              <Button type="button" variant="ghost" size="sm" onClick={() => onChange('')}>
                Clear
              </Button>
              <Button type="button" size="sm" onClick={() => setOpen(false)}>
                Done
              </Button>
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
