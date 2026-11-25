import type * as React from 'react';
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field';
import { cn } from '@/lib/utils';

/** shadcn Field + label + description/error, the way every form in s3deck lays them out. */
export function FormField({
  label,
  htmlFor,
  description,
  error,
  children,
  className,
}: {
  label: React.ReactNode;
  htmlFor?: string;
  description?: React.ReactNode;
  error?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Field data-invalid={!!error || undefined} className={cn('gap-1.5', className)}>
      <FieldLabel htmlFor={htmlFor}>{label}</FieldLabel>
      {children}
      {error ? <FieldError>{error}</FieldError> : description ? <FieldDescription>{description}</FieldDescription> : null}
    </Field>
  );
}
