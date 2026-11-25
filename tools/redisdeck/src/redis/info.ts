import type { DbSummary } from '../shared/types.js';

/** INFO output as { section: { field: value } } (section names lower-cased). */
export type InfoSections = Record<string, Record<string, string>>;

export function parseInfo(raw: string): InfoSections {
  const out: InfoSections = {};
  let section = 'default';
  for (const line of raw.split(/\r?\n/)) {
    if (!line) continue;
    if (line.startsWith('#')) {
      section = line.slice(1).trim().toLowerCase();
      out[section] ??= {};
      continue;
    }
    const i = line.indexOf(':');
    if (i < 0) continue;
    (out[section] ??= {})[line.slice(0, i)] = line.slice(i + 1);
  }
  return out;
}

/** Flatten every section into one map (field names don't collide across sections). */
export function flatInfo(info: InfoSections): Record<string, string> {
  return Object.assign({}, ...Object.values(info));
}

/** "db0:keys=1,expires=0,avg_ttl=0" lines → summaries, sorted by index. */
export function parseKeyspace(section: Record<string, string> | undefined): DbSummary[] {
  return Object.entries(section ?? {})
    .map(([name, v]) => {
      const fields = Object.fromEntries(v.split(',').map((kv) => kv.split('=') as [string, string]));
      return { index: Number(name.replace(/^db/, '')), keys: Number(fields.keys ?? 0), expires: Number(fields.expires ?? 0) };
    })
    .filter((d) => Number.isInteger(d.index))
    .sort((a, b) => a.index - b.index);
}

export const num = (v: string | undefined, fallback = 0): number => {
  const n = Number(v);
  return v === undefined || v === '' || Number.isNaN(n) ? fallback : n;
};
