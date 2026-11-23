import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { storage } from './storage';

export type Theme = 'light' | 'dark';

const KEY = 'pgdeck.theme';
const query = () => window.matchMedia('(prefers-color-scheme: dark)');

const ThemeContext = createContext<{ theme: Theme; toggle: () => void }>({ theme: 'light', toggle: () => {} });

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [chosen, setChosen] = useState<Theme | null>(() => {
    const v = storage.get(KEY);
    return v === 'light' || v === 'dark' ? v : null;
  });
  const [systemDark, setSystemDark] = useState(() => query().matches);

  useEffect(() => {
    const mq = query();
    const onChange = () => setSystemDark(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    if (chosen) root.dataset.theme = chosen;
    else delete root.dataset.theme;
  }, [chosen]);

  const theme: Theme = chosen ?? (systemDark ? 'dark' : 'light');
  const toggle = useCallback(() => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    storage.set(KEY, next);
    setChosen(next);
  }, [theme]);

  return <ThemeContext.Provider value={{ theme, toggle }}>{children}</ThemeContext.Provider>;
}

export const useTheme = () => useContext(ThemeContext);
