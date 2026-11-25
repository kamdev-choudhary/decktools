import { useSyncExternalStore } from 'react';

export type ThemePref = 'light' | 'dark' | 'system';
const KEY = 's3deck-theme';
const listeners = new Set<() => void>();
const media = matchMedia('(prefers-color-scheme: dark)');

function read(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

let current: ThemePref = read();

function apply() {
  const dark = current === 'dark' || (current === 'system' && media.matches);
  document.documentElement.classList.toggle('dark', dark);
}

media.addEventListener('change', () => {
  apply();
  for (const fn of listeners) fn();
});
apply();

export function setTheme(t: ThemePref) {
  current = t;
  try {
    localStorage.setItem(KEY, t);
  } catch {
    // storage unavailable; still applies for this page view
  }
  apply();
  for (const fn of listeners) fn();
}

/** Theme preference shared by every component (and the toaster). */
export function useTheme() {
  const theme = useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => void listeners.delete(fn);
    },
    () => current,
  );
  return { theme, setTheme };
}
