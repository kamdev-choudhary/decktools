import { zodResolver } from '@hookform/resolvers/zod';
import { createBucketSchema, type CreateBucketInput } from '@shared/schemas';
import { CircleAlert } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { errorText } from '@/api/client';
import { useCreateBucket, useDeleteBucket } from '@/api/hooks';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, FieldContent, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { navigate } from '@/lib/router';
import { useApp } from './app-context';
import { FormField } from './form-field';

export function ErrorAlert({ error }: { error: unknown }) {
  return (
    <Alert variant="destructive">
      <CircleAlert />
      <AlertDescription>{errorText(error)}</AlertDescription>
    </Alert>
  );
}

export function CreateBucketDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { connection } = useApp();
  const create = useCreateBucket();
  const form = useForm<CreateBucketInput>({
    resolver: zodResolver(createBucketSchema),
    defaultValues: { name: '', region: connection.region },
  });
  const { errors } = form.formState;

  // Start fresh each time the dialog closes. form and create.reset are stable.
  const resetMutation = create.reset;
  useEffect(() => {
    if (!open) {
      form.reset({ name: '', region: connection.region });
      resetMutation();
    }
  }, [open, form, connection.region, resetMutation]);

  const submit = form.handleSubmit((v) =>
    create.mutate(v, {
      onSuccess: () => {
        toast.success(`Created bucket ${v.name}`);
        onOpenChange(false);
        navigate({ bucket: v.name });
      },
    }),
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={submit} noValidate className="grid gap-6">
          <DialogHeader>
            <DialogTitle>New bucket</DialogTitle>
            <DialogDescription>Bucket names are global on most providers and can’t be changed later.</DialogDescription>
          </DialogHeader>
          <FieldGroup className="gap-4">
            <FormField
              label="Name"
              htmlFor="bucket-name"
              error={errors.name?.message}
              description="3–63 characters: lowercase letters, digits, dots and hyphens"
            >
              <Input
                id="bucket-name"
                autoFocus
                spellCheck={false}
                aria-invalid={!!errors.name}
                {...form.register('name')}
              />
            </FormField>
            <FormField label="Region" htmlFor="bucket-region" error={errors.region?.message}>
              <Input id="bucket-region" aria-invalid={!!errors.region} {...form.register('region')} />
            </FormField>
            {create.isError && <ErrorAlert error={create.error} />}
          </FieldGroup>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending && <Spinner />}
              Create bucket
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function DeleteBucketDialog({
  bucket,
  open,
  onOpenChange,
}: {
  bucket: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const del = useDeleteBucket();
  const [force, setForce] = useState(false);
  const [confirm, setConfirm] = useState('');

  return (
    <Dialog open={open} onOpenChange={(o) => !del.isPending && onOpenChange(o)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete bucket “{bucket}”?</DialogTitle>
          <DialogDescription>A bucket must be empty to be deleted. This can’t be undone.</DialogDescription>
        </DialogHeader>
        <FieldGroup className="gap-4">
          <Field orientation="horizontal">
            <Checkbox id="force-delete" checked={force} onCheckedChange={(v) => setForce(v === true)} />
            <FieldContent>
              <FieldLabel htmlFor="force-delete">Empty it first</FieldLabel>
              <FieldDescription>
                Permanently delete every object (and every version, on versioned buckets).
              </FieldDescription>
            </FieldContent>
          </Field>
          <FormField label={`Type “${bucket}” to confirm`} htmlFor="confirm-bucket">
            <Input
              id="confirm-bucket"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
          </FormField>
          {del.isError && <ErrorAlert error={del.error} />}
        </FieldGroup>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={del.isPending}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={confirm !== bucket || del.isPending}
            onClick={() =>
              del.mutate(
                { bucket, force },
                {
                  onSuccess: () => {
                    toast.success(`Deleted bucket ${bucket}`);
                    onOpenChange(false);
                    navigate({});
                  },
                },
              )
            }
          >
            {del.isPending && <Spinner />}
            Delete bucket
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
