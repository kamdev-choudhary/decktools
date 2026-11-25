import { useState, type ReactNode } from 'react';
import { Button } from '@deck/ui/components/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@deck/ui/components/dialog';
import { Input } from '@deck/ui/components/input';
import { Label } from '@deck/ui/components/label';
import { Textarea } from '@deck/ui/components/textarea';
import { ErrorAlert, Spinner } from './feedback';

export interface Field {
  name: string;
  label: string;
  initial?: string;
  /** Multi-line monospace input (values) instead of a single line. */
  multiline?: boolean;
  type?: 'text' | 'number';
  placeholder?: string;
  hint?: ReactNode;
  required?: boolean;
}

interface FormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  fields: Field[];
  submitLabel: string;
  pending: boolean;
  error: unknown;
  onSubmit: (values: Record<string, string>) => void;
  /** Extra content above the fields, e.g. a type picker. */
  children?: ReactNode;
}

/** A small dialog with labelled inputs; keeps its values while open. */
export function FormDialog(props: FormDialogProps) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        {/* Remount the form per opening so fields start from their initial values. */}
        {props.open && <FormBody {...props} />}
      </DialogContent>
    </Dialog>
  );
}

function FormBody({ title, description, fields, submitLabel, pending, error, onSubmit, children }: FormDialogProps) {
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(fields.map((f) => [f.name, f.initial ?? ''])));
  const missing = fields.some((f) => f.required && !(values[f.name] ?? '').length);

  return (
    <form
      className="contents"
      onSubmit={(e) => {
        e.preventDefault();
        if (!missing) onSubmit(values);
      }}
    >
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        {description && <DialogDescription>{description}</DialogDescription>}
      </DialogHeader>
      {children}
      <div className="space-y-4">
        {fields.map((f, i) => (
          <div key={f.name} className="space-y-1.5">
            <Label htmlFor={`f-${f.name}`}>{f.label}</Label>
            {f.multiline ? (
              <Textarea
                id={`f-${f.name}`}
                autoFocus={i === 0}
                value={values[f.name] ?? ''}
                placeholder={f.placeholder}
                onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) e.currentTarget.form?.requestSubmit();
                }}
                spellCheck={false}
                className="max-h-[50vh] min-h-24 font-mono text-[12.5px]"
              />
            ) : (
              <Input
                id={`f-${f.name}`}
                autoFocus={i === 0}
                type={f.type ?? 'text'}
                step={f.type === 'number' ? 'any' : undefined}
                value={values[f.name] ?? ''}
                placeholder={f.placeholder}
                onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}
                spellCheck={false}
                className="font-mono text-[13px]"
              />
            )}
            {f.hint && <p className="text-xs text-muted-foreground">{f.hint}</p>}
          </div>
        ))}
      </div>
      {!!error && <ErrorAlert error={error} />}
      <DialogFooter>
        <Button type="submit" disabled={pending || missing}>
          {pending && <Spinner className="text-current" />}
          {submitLabel}
        </Button>
      </DialogFooter>
    </form>
  );
}
