import type { DbInfo } from '@shared/types';
import { useTheme } from '../lib/theme';

interface HeaderProps {
  info?: DbInfo;
  onToggleSidebar: () => void;
}

export function Header({ info, onToggleSidebar }: HeaderProps) {
  const { theme, toggle } = useTheme();
  const where = info ? `${info.user}@${info.host ?? 'local'}${info.port ? `:${info.port}` : ''}/${info.database}` : '';

  return (
    <header className="top">
      <button className="icon-btn mobile-only" onClick={onToggleSidebar} aria-label="Toggle sidebar">
        ☰
      </button>
      <a className="brand" href="#/">
        <span className="logo" />
        pgdeck
      </a>
      <div className="dbinfo" title={info?.version}>
        {where}
      </div>
      <div className="spacer" />
      {info?.readonly && <span className="badge warn">read-only</span>}
      <button className="icon-btn" onClick={toggle} title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}>
        {theme === 'dark' ? '☀' : '☾'}
      </button>
    </header>
  );
}
