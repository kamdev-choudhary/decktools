import { useState } from 'react';
import { storage } from './storage';

/**
 * Interface and code fonts, chosen in the account menu. Only the selected
 * families are downloaded: @font-face files load when text first uses them.
 */
export const SANS_FONTS = [
  { id: 'inter', label: 'Inter', stack: "'Inter Variable', ui-sans-serif, system-ui, sans-serif" },
  { id: 'geist', label: 'Geist', stack: "'Geist Variable', ui-sans-serif, system-ui, sans-serif" },
  { id: 'plex', label: 'IBM Plex Sans', stack: "'IBM Plex Sans Variable', ui-sans-serif, system-ui, sans-serif" },
  { id: 'system', label: 'System', stack: "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif" },
] as const;

export const MONO_FONTS = [
  { id: 'jetbrains', label: 'JetBrains Mono', stack: "'JetBrains Mono Variable', ui-monospace, 'SF Mono', Menlo, monospace" },
  { id: 'geist', label: 'Geist Mono', stack: "'Geist Mono Variable', ui-monospace, 'SF Mono', Menlo, monospace" },
  { id: 'plex', label: 'IBM Plex Mono', stack: "'IBM Plex Mono', ui-monospace, 'SF Mono', Menlo, monospace" },
  { id: 'system', label: 'System', stack: "ui-monospace, 'SF Mono', Menlo, Consolas, monospace" },
] as const;

export type SansFont = (typeof SANS_FONTS)[number]['id'];
export type MonoFont = (typeof MONO_FONTS)[number]['id'];

const pick = <T extends { id: string }>(list: readonly T[], v: string | null, fallback: T['id']): T['id'] =>
  list.some((f) => f.id === v) ? (v as T['id']) : fallback;

/** Point the --app-sans / --app-mono variables at the chosen families. */
export function applyFonts({ sans, mono }: { sans: SansFont; mono: MonoFont }): void {
  const root = document.documentElement;
  root.style.setProperty('--app-sans', SANS_FONTS.find((f) => f.id === sans)!.stack);
  root.style.setProperty('--app-mono', MONO_FONTS.find((f) => f.id === mono)!.stack);
  root.dataset.fontSans = sans;
}

/**
 * Font preferences stored under `<namespace>.font.sans` / `.font.mono`.
 * Call once per app, e.g. `export const fonts = createFonts('pgdeck')`.
 */
export function createFonts(namespace: string) {
  const SANS_KEY = `${namespace}.font.sans`;
  const MONO_KEY = `${namespace}.font.mono`;

  const readFonts = (): { sans: SansFont; mono: MonoFont } => ({
    sans: pick(SANS_FONTS, storage.get(SANS_KEY), 'inter'),
    mono: pick(MONO_FONTS, storage.get(MONO_KEY), 'jetbrains'),
  });

  function useFonts() {
    const [fonts, setFonts] = useState(readFonts);
    const update = (next: Partial<{ sans: SansFont; mono: MonoFont }>) => {
      const merged = { ...fonts, ...next };
      storage.set(SANS_KEY, merged.sans);
      storage.set(MONO_KEY, merged.mono);
      applyFonts(merged);
      setFonts(merged);
    };
    return { ...fonts, setSans: (sans: SansFont) => update({ sans }), setMono: (mono: MonoFont) => update({ mono }) };
  }

  return { readFonts, applyFonts, useFonts };
}
