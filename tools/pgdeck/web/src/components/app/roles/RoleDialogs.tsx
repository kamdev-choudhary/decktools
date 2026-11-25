import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Dices, Eye, EyeOff, X } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import {
  alterRoleSql,
  changedAttributes,
  createRoleSql,
  DEFAULT_ATTRIBUTES,
  ROLE_FLAGS,
  SCHEMA_PRESETS,
  schemaPresetSql,
  validateRoleName,
  validUntilValid,
  type RoleAction,
  type RoleAttributes,
  type RoleDetail,
  type RolesResponse,
  type RoleSummary,
  type SchemaPreset,
} from '@shared/roles';
import { api } from '@/api/client';
import { keys } from '@/api/hooks';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@deck/ui/components/alert-dialog';
import { Button } from '@deck/ui/components/button';
import { Checkbox } from '@deck/ui/components/checkbox';
import { Input } from '@deck/ui/components/input';
import { cn } from '@deck/ui/lib/utils';
import { Combobox } from '@deck/ui/components/combobox';
import { errorMessage, Spinner } from '../feedback';
import { DialogShell, Field } from '../structure/StructureDialogs';

export const rolesKey = (db: string) => [...keys.db(db), 'roles'] as const;

/** Run a role action and refresh everything role-related. */
export function useRoleAction(db: string, onDone?: (res: { name?: string }, a: RoleAction) => void) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (a: RoleAction) => api.roleAction(db, a),
    onSuccess: (res, a) => {
      toast.success(res.message);
      void qc.invalidateQueries({ queryKey: rolesKey(db) });
      void qc.invalidateQueries({ queryKey: [...keys.db(db), 'role'] });
      onDone?.(res, a);
    },
  });
}

const MASK = "'••••••••'";

export function generatePassword(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}

function PasswordInput({
  id,
  value,
  onChange,
  autoFocus,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  autoFocus?: boolean;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="flex gap-1.5">
      <div className="relative min-w-0 flex-1">
        <Input
          id={id}
          type={show ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete="new-password"
          spellCheck={false}
          autoFocus={autoFocus}
          className="pr-9 font-mono"
        />
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className="absolute top-1/2 right-1.5 -translate-y-1/2 text-muted-foreground"
          aria-label={show ? 'Hide password' : 'Show password'}
          onClick={() => setShow((s) => !s)}
        >
          {show ? <EyeOff /> : <Eye />}
        </Button>
      </div>
      <Button
        type="button"
        variant="outline"
        size="icon"
        aria-label="Generate a password"
        title="Generate a strong password"
        onClick={() => {
          onChange(generatePassword());
          setShow(true);
        }}
      >
        <Dices />
      </Button>
    </div>
  );
}

/** Role flags as a list of checkboxes with explanations. */
function FlagList({
  value,
  onChange,
  me,
}: {
  value: RoleAttributes;
  onChange: (v: RoleAttributes) => void;
  me: RolesResponse['me'];
}) {
  return (
    <div className="divide-y rounded-lg border">
      {ROLE_FLAGS.map((f) => {
        const locked = !!f.superuserOnly && !me.superuser;
        return (
          <label
            key={f.key}
            className={cn(
              'flex cursor-pointer items-start gap-3 px-3 py-2.5',
              locked && 'cursor-not-allowed opacity-50',
            )}
          >
            <Checkbox
              className="mt-0.5"
              checked={value[f.key]}
              disabled={locked}
              onCheckedChange={(v) => onChange({ ...value, [f.key]: v === true })}
            />
            <span className="min-w-0 text-sm">
              {f.label}
              <span className="block text-xs text-muted-foreground">
                {f.hint}
                {locked && ' Only a superuser can change this.'}
              </span>
            </span>
          </label>
        );
      })}
    </div>
  );
}

/** "2030-01-01 00:00:00+05:30" → "2030-01-01" for a date input. */
const dateOnly = (v: string | null) => (v ? v.slice(0, 10) : '');

function LimitsFields({ value, onChange }: { value: RoleAttributes; onChange: (v: RoleAttributes) => void }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Connection limit" htmlFor="role-conn" hint="Empty means unlimited.">
        <Input
          id="role-conn"
          inputMode="numeric"
          placeholder="Unlimited"
          value={value.connLimit === -1 ? '' : String(value.connLimit)}
          onChange={(e) => {
            const v = e.target.value.replace(/\D/g, '');
            onChange({ ...value, connLimit: v === '' ? -1 : Math.min(Number(v), 1_000_000) });
          }}
        />
      </Field>
      <Field
        label="Password expires"
        htmlFor="role-valid"
        hint="After this date the password stops working. Empty means never."
      >
        <div className="flex gap-1.5">
          <Input
            id="role-valid"
            type="date"
            value={dateOnly(value.validUntil)}
            onChange={(e) => onChange({ ...value, validUntil: e.target.value || null })}
          />
          {value.validUntil && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Never expires"
              onClick={() => onChange({ ...value, validUntil: null })}
            >
              <X />
            </Button>
          )}
        </div>
      </Field>
    </div>
  );
}

const attrsOf = (r: RoleSummary): RoleAttributes => ({
  login: r.login,
  superuser: r.superuser,
  createdb: r.createdb,
  createrole: r.createrole,
  replication: r.replication,
  bypassrls: r.bypassrls,
  inherit: r.inherit,
  connLimit: r.connLimit,
  validUntil: r.validUntil,
});

export function CreateRoleDialog({
  db,
  data,
  onClose,
  onCreated,
}: {
  db: string;
  data: RolesResponse;
  onClose: () => void;
  onCreated: (name: string) => void;
}) {
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [attrs, setAttrs] = useState<RoleAttributes>(DEFAULT_ATTRIBUTES);
  const [memberOf, setMemberOf] = useState<string[]>([]);
  const [comment, setComment] = useState('');
  const action = useRoleAction(db, (res) => onCreated(res.name ?? name));

  const groups = data.roles.filter((r) => !memberOf.includes(r.name) && (data.me.superuser || !r.superuser));
  const spec = { name, password, memberOf, comment, ...attrs };
  const errors = [
    validateRoleName(name),
    validUntilValid(attrs.validUntil) ? null : 'Enter a valid expiry date.',
  ].filter((e): e is string => !!e);
  const statements = name.trim() ? createRoleSql(spec, password ? MASK : null) : [];

  return (
    <DialogShell
      title="New role"
      description="A role is a user (when it can log in) or a group whose privileges members share."
      statements={statements}
      errors={errors}
      error={action.error}
      pending={action.isPending}
      confirm="Create role"
      onClose={onClose}
      onSubmit={() => action.mutate({ action: 'create', ...spec })}
    >
      <Field label="Name" htmlFor="role-name">
        <Input
          id="role-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
          spellCheck={false}
          autoComplete="off"
          className="font-mono"
          placeholder="app_user"
        />
      </Field>
      <Field
        label="Password"
        htmlFor="role-pw"
        hint={
          attrs.login
            ? 'Optional. Sent to Postgres already hashed (SCRAM-SHA-256), so it never appears in server logs.'
            : 'Groups usually have no password.'
        }
      >
        <PasswordInput id="role-pw" value={password} onChange={setPassword} />
      </Field>
      <FlagList value={attrs} onChange={setAttrs} me={data.me} />
      <LimitsFields value={attrs} onChange={setAttrs} />
      <Field label="Member of" hint="It gets the privileges of these roles (groups).">
        <div className="flex flex-wrap items-center gap-1.5">
          {memberOf.map((g) => (
            <span key={g} className="inline-flex h-7 items-center gap-1 rounded-md border pr-1 pl-2 font-mono text-xs">
              {g}
              <button
                type="button"
                className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                aria-label={`Remove ${g}`}
                onClick={() => setMemberOf(memberOf.filter((m) => m !== g))}
              >
                <X className="size-3" />
              </button>
            </span>
          ))}
          <Combobox
            value={undefined}
            onChange={(v) => setMemberOf([...memberOf, v])}
            options={groups.map((r) => ({ value: r.name, hint: r.login ? 'user' : 'group' }))}
            placeholder="Add a role…"
            searchPlaceholder="Search roles…"
            mono
            className="h-7 w-44 text-xs"
          />
        </div>
      </Field>
      <Field label="Comment" htmlFor="role-comment">
        <Input
          id="role-comment"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="What this role is for"
        />
      </Field>
    </DialogShell>
  );
}

export function EditRoleDialog({
  db,
  role,
  me,
  onClose,
  onRenamed,
}: {
  db: string;
  role: RoleSummary;
  me: RolesResponse['me'];
  onClose: () => void;
  onRenamed: (name: string) => void;
}) {
  const [name, setName] = useState(role.name);
  const [attrs, setAttrs] = useState<RoleAttributes>(attrsOf(role));
  const [comment, setComment] = useState(role.comment ?? '');
  const action = useRoleAction(db, (res) => {
    if (res.name && res.name !== role.name) onRenamed(res.name);
    onClose();
  });

  const changed = changedAttributes(attrsOf(role), attrs);
  const update = {
    name: role.name,
    newName: name !== role.name ? name : undefined,
    attributes: Object.keys(changed).length ? changed : undefined,
    comment: comment !== (role.comment ?? '') ? comment : undefined,
  };
  const errors = [
    name !== role.name ? validateRoleName(name) : null,
    validUntilValid(attrs.validUntil) ? null : 'Enter a valid expiry date.',
  ].filter((e): e is string => !!e);
  const statements = alterRoleSql(update, undefined);

  return (
    <DialogShell
      title="Edit role"
      description={<span className="font-mono text-foreground">{role.name}</span>}
      statements={statements}
      errors={errors}
      error={action.error}
      pending={action.isPending}
      confirm="Save changes"
      onClose={onClose}
      onSubmit={() => action.mutate({ action: 'update', ...update })}
    >
      <Field
        label="Name"
        htmlFor="role-name"
        hint={
          role.current
            ? 'This is the role pgdeck is connected as, so it can’t be renamed here.'
            : 'Renaming clears an MD5 password; SCRAM passwords keep working.'
        }
      >
        <Input
          id="role-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={role.current}
          spellCheck={false}
          autoComplete="off"
          className="font-mono"
        />
      </Field>
      <FlagList value={attrs} onChange={setAttrs} me={me} />
      <LimitsFields value={attrs} onChange={setAttrs} />
      <Field label="Comment" htmlFor="role-comment">
        <Input
          id="role-comment"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="What this role is for"
        />
      </Field>
    </DialogShell>
  );
}

export function PasswordDialog({ db, role, onClose }: { db: string; role: RoleSummary; onClose: () => void }) {
  const [password, setPassword] = useState('');
  const [remove, setRemove] = useState(false);
  const action = useRoleAction(db, () => onClose());
  const statements = remove
    ? alterRoleSql({ name: role.name }, null)
    : password
      ? alterRoleSql({ name: role.name }, MASK)
      : [];

  return (
    <DialogShell
      title="Change password"
      description={
        <>
          For <span className="font-mono text-foreground">{role.name}</span>. Sessions that are already connected stay
          connected.
        </>
      }
      statements={statements}
      errors={[]}
      error={action.error}
      pending={action.isPending}
      confirm={remove ? 'Remove password' : 'Set password'}
      onClose={onClose}
      onSubmit={() => action.mutate({ action: 'update', name: role.name, password: remove ? null : password })}
    >
      <Field
        label="New password"
        htmlFor="role-new-pw"
        hint="Hashed with SCRAM-SHA-256 before it’s sent to Postgres, so it never appears in server logs."
      >
        <PasswordInput
          id="role-new-pw"
          value={remove ? '' : password}
          onChange={(v) => (setRemove(false), setPassword(v))}
          autoFocus
        />
      </Field>
      <label className="flex cursor-pointer items-start gap-2 text-sm">
        <Checkbox className="mt-0.5" checked={remove} onCheckedChange={(v) => setRemove(v === true)} />
        <span>
          Remove the password instead
          <span className="block text-xs text-muted-foreground">
            The role can then only log in with methods that need no password (such as trust or peer).
          </span>
        </span>
      </label>
    </DialogShell>
  );
}

export function DropRoleDialog({
  db,
  detail,
  roles,
  onClose,
  onDropped,
}: {
  db: string;
  detail: RoleDetail;
  roles: string[];
  onClose: () => void;
  onDropped: () => void;
}) {
  const here = detail.dependencies.find((d) => d.database === detail.database);
  const elsewhere = detail.dependencies.filter((d) => d.database !== detail.database);
  const owns = (here?.owned ?? 0) > 0;
  const [reassignTo, setReassignTo] = useState<string | undefined>(undefined);
  const [dropOwned, setDropOwned] = useState((here?.privileges ?? 0) > 0 || owns);
  const action = useRoleAction(db, () => onDropped());
  const name = detail.role.name;

  return (
    <AlertDialog open onOpenChange={(o) => !o && !action.isPending && onClose()}>
      <AlertDialogContent className="sm:max-w-lg">
        <AlertDialogHeader>
          <AlertDialogTitle>Drop role?</AlertDialogTitle>
          <AlertDialogDescription>
            <span className="font-mono text-foreground">{name}</span> will be removed from the whole server. Anyone
            logging in as it will be refused.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="space-y-3 text-sm">
          {owns && (
            <div className="space-y-1.5">
              <p>
                It owns <b>{here!.owned}</b> object{here!.owned === 1 ? '' : 's'} in{' '}
                <span className="font-mono">{detail.database}</span>. Give them to:
              </p>
              <Combobox
                value={reassignTo}
                onChange={setReassignTo}
                options={roles.filter((r) => r !== name).map((r) => ({ value: r }))}
                placeholder="Choose a new owner…"
                searchPlaceholder="Search roles…"
                mono
                className="w-full"
              />
            </div>
          )}
          <label className="flex cursor-pointer items-start gap-2">
            <Checkbox className="mt-0.5" checked={dropOwned} onCheckedChange={(v) => setDropOwned(v === true)} />
            <span>
              Remove its privileges{owns ? ' and anything it still owns' : ''} in {detail.database}
              <span className="block text-xs text-muted-foreground">
                Runs <span className="font-mono">DROP OWNED BY</span>.{' '}
                {owns && !reassignTo
                  ? 'Objects not given to another role are deleted with it.'
                  : 'Needed when it has been granted anything.'}
              </span>
            </span>
          </label>
          {(elsewhere.length > 0 || detail.ownedDatabases.length > 0) && (
            <p className="rounded-md border border-warning/40 bg-warning/5 px-3 py-2 text-xs">
              It also{' '}
              {detail.ownedDatabases.length > 0 && (
                <>
                  owns the database{detail.ownedDatabases.length > 1 ? 's' : ''}{' '}
                  <span className="font-mono">{detail.ownedDatabases.join(', ')}</span>
                </>
              )}
              {detail.ownedDatabases.length > 0 && elsewhere.length > 0 && ' and '}
              {elsewhere.length > 0 && (
                <>
                  has objects or privileges in{' '}
                  <span className="font-mono">{elsewhere.map((d) => d.database).join(', ')}</span>
                </>
              )}
              . Open each of those databases in pgdeck and clean up there first, or Postgres will refuse to drop the
              role.
            </p>
          )}
          {action.error && (
            <p className="max-h-32 overflow-auto font-mono text-xs whitespace-pre-wrap text-destructive">
              {errorMessage(action.error)}
            </p>
          )}
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={action.isPending}>Cancel</AlertDialogCancel>
          <Button
            variant="destructive"
            disabled={action.isPending}
            onClick={() => action.mutate({ action: 'drop', name, reassignTo, dropOwned })}
          >
            {action.isPending && <Spinner className="text-current" />}
            Drop role
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function SchemaPresetDialog({
  db,
  role,
  schemas,
  initialSchema,
  onClose,
}: {
  db: string;
  role: string;
  schemas: string[];
  initialSchema?: string;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [schema, setSchema] = useState(initialSchema ?? schemas[0] ?? 'public');
  const [preset, setPreset] = useState<SchemaPreset>('read');
  const [future, setFuture] = useState(true);
  const m = useMutation({
    mutationFn: () => api.grantPreset(db, role, schema, preset, future),
    onSuccess: (r) => {
      toast.success(r.message);
      void qc.invalidateQueries({ queryKey: [...keys.db(db), 'role'] });
      onClose();
    },
  });

  return (
    <DialogShell
      title="Set access to a schema"
      description={
        <>
          Grant <span className="font-mono text-foreground">{role}</span> access to every table and sequence in a schema
          at once.
        </>
      }
      statements={schemaPresetSql(role, schema, preset, future)}
      errors={[]}
      error={m.error}
      pending={m.isPending}
      confirm="Apply"
      onClose={onClose}
      onSubmit={() => m.mutate()}
    >
      <Field label="Schema">
        <Combobox
          value={schema}
          onChange={setSchema}
          options={schemas.map((s) => ({ value: s }))}
          mono
          className="w-full"
        />
      </Field>
      <div className="divide-y rounded-lg border" role="radiogroup" aria-label="Access">
        {SCHEMA_PRESETS.map((p) => (
          <label key={p.value} className="flex cursor-pointer items-start gap-3 px-3 py-2.5">
            <input
              type="radio"
              name="preset"
              className="mt-1 accent-primary"
              checked={preset === p.value}
              onChange={() => setPreset(p.value)}
            />
            <span className="text-sm">
              {p.label}
              <span className="block text-xs text-muted-foreground">{p.hint}</span>
            </span>
          </label>
        ))}
      </div>
      <label className="flex cursor-pointer items-start gap-2 text-sm">
        <Checkbox className="mt-0.5" checked={future} onCheckedChange={(v) => setFuture(v === true)} />
        <span>
          {preset === 'none'
            ? 'Also stop granting it on tables created later'
            : 'Also apply to tables and sequences created later'}
          <span className="block text-xs text-muted-foreground">
            Sets default privileges for objects that you (the role pgdeck connects as) create in this schema.
          </span>
        </span>
      </label>
    </DialogShell>
  );
}
