import { zodResolver } from '@hookform/resolvers/zod';
import { loginSchema, type LoginInput } from '@shared/schemas';
import { CircleAlert, LogIn } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { errorText } from '@/api/client';
import { useLogin, useMe } from '@/api/hooks';
import { FormField } from '@/components/app/form-field';
import { Logo } from '@/components/app/logo';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { FieldGroup, FieldSeparator } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';

/** Error passed back from a failed single sign-on (?login_error=…). Read once, then removed from the URL. */
const ssoError = (() => {
  const q = new URLSearchParams(location.search);
  const msg = q.get('login_error');
  if (msg) {
    q.delete('login_error');
    history.replaceState(null, '', `${location.pathname}${q.size ? `?${q}` : ''}`);
  }
  return msg;
})();

export function LoginView() {
  const login = useLogin();
  const me = useMe();
  const sso = me.data?.sso;
  const form = useForm<LoginInput>({ resolver: zodResolver(loginSchema), defaultValues: { username: '', password: '' } });
  const { errors } = form.formState;

  return (
    <main className="grid min-h-full place-items-center bg-muted/40 p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <div className="flex items-center gap-3">
            <Logo className="size-9 shrink-0" />
            <div className="grid gap-0.5">
              <CardTitle className="text-lg">Sign in to s3deck</CardTitle>
              <CardDescription>Use the login printed when s3deck started.</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <form onSubmit={form.handleSubmit((v) => login.mutate(v))} noValidate>
            <FieldGroup className="gap-4">
              <FormField label="Username" htmlFor="username" error={errors.username?.message}>
                <Input id="username" autoComplete="username" autoFocus aria-invalid={!!errors.username} {...form.register('username')} />
              </FormField>
              <FormField label="Password" htmlFor="password" error={errors.password?.message}>
                <Input id="password" type="password" autoComplete="current-password" aria-invalid={!!errors.password} {...form.register('password')} />
              </FormField>
              {ssoError && !login.isError && (
                <Alert variant="destructive">
                  <CircleAlert />
                  <AlertDescription>{ssoError}</AlertDescription>
                </Alert>
              )}
              {login.isError && (
                <Alert variant="destructive">
                  <CircleAlert />
                  <AlertDescription>{errorText(login.error)}</AlertDescription>
                </Alert>
              )}
              <Button type="submit" className="w-full" disabled={login.isPending}>
                {login.isPending && <Spinner />}
                Sign in
              </Button>
              {sso?.enabled && (
                <>
                  <FieldSeparator>or</FieldSeparator>
                  <Button asChild variant="outline" className="w-full">
                    <a href="api/auth/sso/start">
                      <LogIn /> {sso.label}
                    </a>
                  </Button>
                </>
              )}
            </FieldGroup>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
