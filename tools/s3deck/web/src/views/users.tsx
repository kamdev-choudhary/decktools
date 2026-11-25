import { zodResolver } from '@hookform/resolvers/zod';
import { createUserSchema, passwordSchema, roleSchema } from '@shared/schemas';
import type { Role, UserInfo } from '@shared/types';
import { CircleAlert, Ellipsis, KeyRound, Plus, ShieldCheck, Trash2, UserRound, UserX } from 'lucide-react';
import { useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
import { errorText } from '@/api/client';
import { useMe, useUserMutations, useUsers } from '@/api/hooks';
import { ErrorAlert } from '@/components/app/bucket-dialogs';
import { EmptyState } from '@/components/app/empty-state';
import { FormField } from '@/components/app/form-field';
import { PageHeader } from '@/components/app/page-header';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { FieldGroup } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatDate } from '@/lib/format';

const ROLES: { value: Role; label: string; hint: string }[] = [
  { value: 'viewer', label: 'Viewer', hint: 'Browse, preview, download and share links' },
  { value: 'editor', label: 'Editor', hint: 'Also upload, edit, move and delete objects' },
  { value: 'admin', label: 'Admin', hint: 'Also buckets, bucket settings, users and the activity log' },
];

const formSchema = createUserSchema
  .extend({
    sso: z.boolean(),
    password: z.string(),
  })
  .superRefine((v, ctx) => {
    if (v.sso) {
      if (!v.username.includes('@'))
        ctx.addIssue({ code: 'custom', path: ['username'], message: 'Use the email address people sign in with' });
    } else {
      const r = passwordSchema.safeParse(v.password);
      if (!r.success)
        ctx.addIssue({ code: 'custom', path: ['password'], message: r.error.issues[0]?.message ?? 'Invalid password' });
    }
  });
type FormValues = z.infer<typeof formSchema>;

function AddUserDialog({
  open,
  onOpenChange,
  ssoEnabled,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  ssoEnabled: boolean;
}) {
  const { create } = useUserMutations();
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { username: '', password: '', role: 'viewer', sso: false },
  });
  const { errors } = form.formState;
  const sso = useWatch({ control: form.control, name: 'sso' });
  const role = useWatch({ control: form.control, name: 'role' });

  const submit = form.handleSubmit((v) =>
    create.mutate(
      { username: v.username, role: v.role, password: v.sso ? undefined : v.password },
      {
        onSuccess: (u) => {
          toast.success(`Added ${u.username}`);
          form.reset();
          onOpenChange(false);
        },
      },
    ),
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={submit} noValidate className="grid gap-6">
          <DialogHeader>
            <DialogTitle>Add user</DialogTitle>
            <DialogDescription>Choose what they can do. You can change it at any time.</DialogDescription>
          </DialogHeader>
          <FieldGroup className="gap-4">
            {ssoEnabled && (
              <FormField label="Signs in with" htmlFor="sso">
                <Controller
                  control={form.control}
                  name="sso"
                  render={({ field }) => (
                    <Select value={field.value ? 'sso' : 'password'} onValueChange={(v) => field.onChange(v === 'sso')}>
                      <SelectTrigger id="sso" className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="password">Username and password</SelectItem>
                        <SelectItem value="sso">Single sign-on (email)</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                />
              </FormField>
            )}
            <FormField label={sso ? 'Email' : 'Username'} htmlFor="new-username" error={errors.username?.message}>
              <Input
                id="new-username"
                autoComplete="off"
                autoFocus
                aria-invalid={!!errors.username}
                {...form.register('username')}
              />
            </FormField>
            {!sso && (
              <FormField
                label="Password"
                htmlFor="new-password"
                description="At least 10 characters"
                error={errors.password?.message}
              >
                <Input
                  id="new-password"
                  type="password"
                  autoComplete="new-password"
                  aria-invalid={!!errors.password}
                  {...form.register('password')}
                />
              </FormField>
            )}
            <FormField label="Role" htmlFor="new-role" description={ROLES.find((r) => r.value === role)?.hint}>
              <Controller
                control={form.control}
                name="role"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={(v) => field.onChange(roleSchema.parse(v))}>
                    <SelectTrigger id="new-role" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ROLES.map((r) => (
                        <SelectItem key={r.value} value={r.value}>
                          {r.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </FormField>
            {create.isError && <ErrorAlert error={create.error} />}
          </FieldGroup>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending && <Spinner />}
              Add user
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ResetPasswordDialog({ user, onClose }: { user: UserInfo; onClose: () => void }) {
  const { update } = useUserMutations();
  const [password, setPassword] = useState('');
  const check = passwordSchema.safeParse(password);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Set password for {user.username}</DialogTitle>
          <DialogDescription>
            They’ll use it the next time they sign in. Existing sessions stay signed in.
          </DialogDescription>
        </DialogHeader>
        <FieldGroup className="gap-4">
          <FormField
            label="New password"
            htmlFor="reset-pw"
            error={password && !check.success ? check.error.issues[0]?.message : undefined}
          >
            <Input
              id="reset-pw"
              type="password"
              autoComplete="new-password"
              autoFocus
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </FormField>
          {update.isError && <ErrorAlert error={update.error} />}
        </FieldGroup>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!check.success || update.isPending}
            onClick={() =>
              update.mutate(
                { username: user.username, patch: { password } },
                { onSuccess: () => (toast.success('Password updated'), onClose()) },
              )
            }
          >
            {update.isPending && <Spinner />}
            Save password
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function UsersView() {
  const me = useMe();
  const users = useUsers();
  const { update, remove } = useUserMutations();
  const [adding, setAdding] = useState(false);
  const [resetFor, setResetFor] = useState<UserInfo | null>(null);
  const [deleting, setDeleting] = useState<UserInfo | null>(null);
  const persistence = !!me.data?.persistence;

  const patch = (u: UserInfo, p: Parameters<typeof update.mutate>[0]['patch'], message: string) =>
    update.mutate(
      { username: u.username, patch: p },
      { onSuccess: () => toast.success(message), onError: (e) => toast.error(errorText(e)) },
    );

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <PageHeader
        icon={<UserRound />}
        title="Users"
        description="Who can sign in, and what they can do."
        action={
          persistence && (
            <Button size="sm" onClick={() => setAdding(true)}>
              <Plus /> Add user
            </Button>
          )
        }
      />
      <div className="space-y-4 p-6">
        {!persistence && (
          <Alert>
            <CircleAlert />
            <AlertDescription>
              s3deck is running without a data directory (--no-persist), so extra users can’t be stored.
            </AlertDescription>
          </Alert>
        )}
        <div className="overflow-hidden rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="pl-4">User</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Sign-in</TableHead>
                <TableHead>Added</TableHead>
                <TableHead className="w-12 pr-4" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.data && (
                <TableRow className="hover:bg-transparent">
                  <TableCell className="pl-4 font-medium">{users.data.startupAdmin}</TableCell>
                  <TableCell>
                    <Badge variant="secondary">
                      <ShieldCheck /> Admin
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">Startup login (printed in the terminal)</TableCell>
                  <TableCell className="text-muted-foreground">—</TableCell>
                  <TableCell />
                </TableRow>
              )}
              {users.isPending &&
                Array.from({ length: 3 }, (_, i) => (
                  <TableRow key={i}>
                    <TableCell colSpan={5} className="pl-4">
                      <Skeleton className="h-5 w-full" />
                    </TableCell>
                  </TableRow>
                ))}
              {users.data?.users.map((u) => {
                const self = u.username.toLowerCase() === me.data?.user?.toLowerCase();
                return (
                  <TableRow key={u.username} className={u.disabled ? 'text-muted-foreground' : undefined}>
                    <TableCell className="pl-4 font-medium">
                      {u.username}
                      {self && <span className="ml-2 text-xs font-normal text-muted-foreground">(you)</span>}
                      {u.disabled && (
                        <Badge variant="outline" className="ml-2">
                          disabled
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant={u.role === 'admin' ? 'secondary' : 'outline'} className="capitalize">
                        {u.role}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {u.hasPassword ? 'Password' : 'Single sign-on'}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{formatDate(u.createdAt)}</TableCell>
                    <TableCell className="pr-4 text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${u.username}`}>
                            <Ellipsis />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-52">
                          <DropdownMenuLabel>Role</DropdownMenuLabel>
                          <DropdownMenuRadioGroup
                            value={u.role}
                            onValueChange={(v) => patch(u, { role: roleSchema.parse(v) }, `${u.username} is now ${v}`)}
                          >
                            {ROLES.map((r) => (
                              <DropdownMenuRadioItem
                                key={r.value}
                                value={r.value}
                                disabled={self && r.value !== 'admin'}
                              >
                                {r.label}
                              </DropdownMenuRadioItem>
                            ))}
                          </DropdownMenuRadioGroup>
                          <DropdownMenuSeparator />
                          {u.hasPassword && (
                            <DropdownMenuItem onSelect={() => setResetFor(u)}>
                              <KeyRound /> Set password…
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem
                            disabled={self}
                            onSelect={() =>
                              patch(
                                u,
                                { disabled: !u.disabled },
                                u.disabled ? `${u.username} enabled` : `${u.username} disabled`,
                              )
                            }
                          >
                            <UserX /> {u.disabled ? 'Enable' : 'Disable'}
                          </DropdownMenuItem>
                          <DropdownMenuItem variant="destructive" disabled={self} onSelect={() => setDeleting(u)}>
                            <Trash2 /> Delete…
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          {users.data && users.data.users.length === 0 && persistence && (
            <EmptyState icon={<UserRound />} title="Only the startup admin so far">
              Add people so they get their own login and role.
            </EmptyState>
          )}
          {users.isError && (
            <div className="p-4">
              <ErrorAlert error={users.error} />
            </div>
          )}
        </div>
      </div>

      <AddUserDialog open={adding} onOpenChange={setAdding} ssoEnabled={!!me.data?.sso.enabled} />
      {resetFor && <ResetPasswordDialog user={resetFor} onClose={() => setResetFor(null)} />}
      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleting?.username}?</AlertDialogTitle>
            <AlertDialogDescription>
              They’re signed out right away and can’t sign in again. Their remembered connections are kept on disk.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() =>
                deleting &&
                remove.mutate(deleting.username, {
                  onSuccess: () => toast.success(`Deleted ${deleting.username}`),
                  onError: (e) => toast.error(errorText(e)),
                })
              }
            >
              Delete user
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
