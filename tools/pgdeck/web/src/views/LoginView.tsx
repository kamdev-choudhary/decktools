import { useState } from 'react';
import { useLogin } from '@/api/hooks';
import { ErrorAlert, Spinner } from '@/components/app/feedback';
import { Logo } from '@/components/app/Logo';
import { ThemeSwitcher } from '@deck/ui/components/theme-switcher';
import { Button } from '@deck/ui/components/button';
import { Input } from '@deck/ui/components/input';
import { Label } from '@deck/ui/components/label';

export function LoginView() {
  const login = useLogin();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  return (
    <div className="flex min-h-full flex-col">
      <main className="flex flex-1 items-center justify-center px-4 py-16">
        <div className="w-full max-w-[360px]">
          <div className="mb-8 flex flex-col items-center gap-4 text-center">
            <Logo className="size-11" />
            <div className="space-y-1.5">
              <h1 className="text-2xl font-semibold tracking-tight">Log in to pgdeck</h1>
              <p className="text-sm text-muted-foreground">
                Use the credentials printed in the terminal where pgdeck is running.
              </p>
            </div>
          </div>

          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              login.mutate({ username, password });
            }}
          >
            <div className="space-y-2">
              <Label htmlFor="username">Username</Label>
              <Input
                id="username"
                autoComplete="username"
                autoFocus
                required
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="admin"
                className="h-10"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="h-10"
              />
            </div>

            {login.isError && <ErrorAlert error={login.error} />}

            <Button type="submit" className="h-10 w-full" disabled={login.isPending}>
              {login.isPending && <Spinner className="text-current" />}
              Continue
            </Button>
          </form>
        </div>
      </main>
      <footer className="flex items-center justify-between border-t px-6 py-4 text-xs text-muted-foreground">
        <span>pgdeck · PostgreSQL in your browser</span>
        <ThemeSwitcher />
      </footer>
    </div>
  );
}
