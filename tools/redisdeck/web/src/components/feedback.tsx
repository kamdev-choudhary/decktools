import { AlertCircle } from 'lucide-react';
import type { ReactNode } from 'react';
import { Alert, AlertDescription, AlertTitle } from '@deck/ui/components/alert';

export { CenteredSpinner, Kbd, Slash, Spinner } from '@deck/ui/components/feedback';

export const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

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
