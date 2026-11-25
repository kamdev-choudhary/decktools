import { AlertCircle } from 'lucide-react';
import type { ReactNode } from 'react';
import { ApiError } from '@/api/client';
import { Alert, AlertDescription, AlertTitle } from '@deck/ui/components/alert';

export { CenteredSpinner, Kbd, Slash, Spinner } from '@deck/ui/components/feedback';

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    return [error.message, error.detail && `Detail: ${error.detail}`, error.hint && `Hint: ${error.hint}`]
      .filter(Boolean)
      .join('\n');
  }
  return error instanceof Error ? error.message : String(error);
}

export function ErrorAlert({ error, title, className, children }: { error: unknown; title?: string; className?: string; children?: ReactNode }) {
  return (
    <Alert variant="destructive" className={className}>
      <AlertCircle />
      {title && <AlertTitle>{title}</AlertTitle>}
      <AlertDescription className="font-mono text-xs whitespace-pre-wrap">
        {errorMessage(error)}
        {children}
      </AlertDescription>
    </Alert>
  );
}
