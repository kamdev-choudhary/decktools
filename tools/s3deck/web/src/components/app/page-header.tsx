import type * as React from 'react';

/** Fixed top bar for app-wide pages (Sync, Activity, Users). */
export function PageHeader({
  icon,
  title,
  description,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <header className="sticky top-0 z-10 flex min-h-14 items-center gap-3 border-b bg-background px-6 py-2">
      <span className="text-primary [&_svg]:size-4">{icon}</span>
      <div className="min-w-0 flex-1">
        <h1 className="truncate font-semibold leading-tight">{title}</h1>
        <p className="truncate text-xs text-muted-foreground">{description}</p>
      </div>
      {action}
    </header>
  );
}
