import { useEffect, useRef, useState } from 'react';
import { cn } from '../lib/utils';

export interface Series {
  name: string;
  /** CSS colour, e.g. var(--chart-data). Validated pairs live in styles.css. */
  color: string;
  values: number[];
}

interface LiveChartProps {
  title: string;
  series: Series[];
  /** Sample timestamps (ms), aligned with each series' values. */
  times: number[];
  /** Fixed number of slots on the x axis, so the line grows in from the right. */
  slots: number;
  format: (v: number) => string;
  height?: number;
  className?: string;
}

const PAD = { top: 8, right: 8, bottom: 4, left: 40 };

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const mag = 10 ** Math.floor(Math.log10(v));
  const n = v / mag;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * mag;
}

const timeFmt = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });

/**
 * Small live line chart. One y axis, 2px lines, recessive grid, and a
 * crosshair + tooltip on hover. With 2+ series a legend is shown.
 */
export function LiveChart({ title, series, times, slots, format, height = 140, className }: LiveChartProps) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(entry!.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const n = times.length;
  const max = niceMax(Math.max(0, ...series.flatMap((s) => s.values)));
  const innerW = Math.max(width - PAD.left - PAD.right, 1);
  const innerH = height - PAD.top - PAD.bottom;
  const offset = slots - n; // empty slots on the left
  const x = (i: number) => PAD.left + ((i + offset) / Math.max(slots - 1, 1)) * innerW;
  const y = (v: number) => PAD.top + innerH - (v / max) * innerH;

  const path = (values: number[]) =>
    values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
  const area = (values: number[]) =>
    values.length ? `${path(values)}L${x(values.length - 1).toFixed(1)},${y(0)}L${x(0).toFixed(1)},${y(0)}Z` : '';

  const current = series.map((s) => s.values.at(-1) ?? 0);

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!n) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const i = Math.round(((px - PAD.left) / innerW) * (slots - 1)) - offset;
    setHover(Math.min(Math.max(i, 0), n - 1));
  };

  const hi = hover !== null && hover < n ? hover : null;

  return (
    <div className={cn('rounded-lg border bg-card p-4', className)}>
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <div className="text-xs text-muted-foreground">{title}</div>
          <div className="mt-1 text-xl font-semibold tracking-tight tabular-nums">{n ? format(current[0]!) : '—'}</div>
        </div>
        {series.length > 1 && (
          <div className="flex flex-wrap justify-end gap-x-3 gap-y-1 text-xs text-muted-foreground">
            {series.map((s, i) => (
              <span key={s.name} className="flex items-center gap-1.5">
                <span className="size-2.5 rounded-[3px]" style={{ background: s.color }} />
                {s.name}
                <span className="text-foreground tabular-nums">{n ? format(current[i]!) : '—'}</span>
              </span>
            ))}
          </div>
        )}
      </div>

      <div ref={boxRef} className="relative">
        {width > 0 && (
          <svg
            width={width}
            height={height}
            className="block touch-none overflow-visible"
            onPointerMove={onMove}
            onPointerLeave={() => setHover(null)}
            role="img"
            aria-label={`${title}: ${series.map((s, i) => `${s.name} ${format(current[i]!)}`).join(', ')}`}
          >
            {[0, 0.5, 1].map((f) => (
              <g key={f}>
                <line
                  x1={PAD.left}
                  x2={width - PAD.right}
                  y1={y(max * f)}
                  y2={y(max * f)}
                  stroke="var(--border)"
                  strokeWidth={1}
                />
                <text
                  x={PAD.left - 8}
                  y={y(max * f)}
                  dy="0.32em"
                  textAnchor="end"
                  className="fill-muted-foreground text-[10px] tabular-nums"
                >
                  {format(max * f)}
                </text>
              </g>
            ))}

            {series.length === 1 && n > 1 && (
              <path d={area(series[0]!.values)} fill={series[0]!.color} opacity={0.08} />
            )}
            {series.map((s) => (
              <path
                key={s.name}
                d={path(s.values)}
                fill="none"
                stroke={s.color}
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            ))}

            {hi !== null && (
              <g>
                <line
                  x1={x(hi)}
                  x2={x(hi)}
                  y1={PAD.top}
                  y2={PAD.top + innerH}
                  stroke="var(--muted-foreground)"
                  strokeWidth={1}
                  strokeDasharray="3 3"
                />
                {series.map((s) => (
                  <circle
                    key={s.name}
                    cx={x(hi)}
                    cy={y(s.values[hi] ?? 0)}
                    r={4}
                    fill={s.color}
                    stroke="var(--card)"
                    strokeWidth={2}
                  />
                ))}
              </g>
            )}
          </svg>
        )}

        {hi !== null && (
          <div
            className="pointer-events-none absolute top-0 z-10 min-w-36 rounded-md border bg-popover px-2.5 py-2 text-xs"
            style={{
              left: Math.min(Math.max(x(hi) + 12, 0), Math.max(width - 160, 0)),
            }}
          >
            <div className="mb-1 text-muted-foreground tabular-nums">{timeFmt.format(times[hi])}</div>
            {series.map((s) => (
              <div key={s.name} className="flex items-center gap-2">
                <span className="size-2 rounded-[2px]" style={{ background: s.color }} />
                {s.name}
                <span className="ml-auto pl-3 font-medium tabular-nums">{format(s.values[hi] ?? 0)}</span>
              </div>
            ))}
          </div>
        )}
        {!n && (
          <div className="absolute inset-0 flex items-center justify-center text-xs text-muted-foreground">
            Waiting for data…
          </div>
        )}
      </div>
    </div>
  );
}
