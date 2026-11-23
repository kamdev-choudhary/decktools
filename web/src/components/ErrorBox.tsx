import { ApiError } from '../api/client';

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    return [error.message, error.detail && `Detail: ${error.detail}`, error.hint && `Hint: ${error.hint}`]
      .filter(Boolean)
      .join('\n');
  }
  return error instanceof Error ? error.message : String(error);
}

export function ErrorBox({ error, children }: { error: unknown; children?: React.ReactNode }) {
  return (
    <div className="error-box" role="alert">
      {errorMessage(error)}
      {children}
    </div>
  );
}

export const Spinner = () => <span className="spinner" aria-label="Loading" />;
