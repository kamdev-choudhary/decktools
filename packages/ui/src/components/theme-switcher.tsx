import { Monitor, Moon, Sun } from 'lucide-react';
import { useTheme, type ThemePreference } from './theme-provider';
import { cn } from '../lib/utils';

const OPTIONS: { value: ThemePreference; label: string; Icon: typeof Sun }[] = [
  { value: 'system', label: 'System', Icon: Monitor },
  { value: 'light', label: 'Light', Icon: Sun },
  { value: 'dark', label: 'Dark', Icon: Moon },
];

/** Vercel-style three-way segmented theme control. */
export function ThemeSwitcher({ className }: { className?: string }) {
  const { preference, setPreference } = useTheme();
  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      className={cn('inline-flex items-center rounded-full border p-0.5', className)}
    >
      {OPTIONS.map(({ value, label, Icon }) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={preference === value}
          aria-label={label}
          title={label}
          onClick={() => setPreference(value)}
          className={cn(
            'inline-flex size-6 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground',
            preference === value && 'bg-accent text-foreground',
          )}
        >
          <Icon className="size-3.5" />
        </button>
      ))}
    </div>
  );
}
