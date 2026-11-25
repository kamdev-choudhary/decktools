import { CircleAlert, LogOut } from 'lucide-react';
import { useLogout, useMe } from '@/api/hooks';
import { ConnectionForm } from '@/components/app/connection-form';
import { IconButton } from '@/components/app/icon-button';
import { Logo } from '@/components/app/logo';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

/** Shown when s3deck has no usable credentials: connect from the browser. */
export function ConnectView() {
  const me = useMe();
  const logout = useLogout();

  return (
    <main className="min-h-full bg-muted/40 px-4 py-10">
      <Card className="mx-auto w-full max-w-lg">
        <CardHeader>
          <div className="flex items-center gap-3">
            <Logo className="size-9 shrink-0" />
            <div className="grid gap-0.5">
              <CardTitle className="text-lg">Connect to storage</CardTitle>
              <CardDescription>Enter an access key for AWS S3 or any S3-compatible service.</CardDescription>
            </div>
          </div>
          {me.data?.authRequired && (
            <CardAction>
              <IconButton label="Log out" onClick={() => logout.mutate()}>
                <LogOut />
              </IconButton>
            </CardAction>
          )}
        </CardHeader>
        <CardContent>
          {me.data?.browserConnections ? (
            <ConnectionForm />
          ) : (
            <Alert>
              <CircleAlert />
              <AlertTitle>No storage credentials</AlertTitle>
              <AlertDescription>
                Entering credentials in the browser is disabled on this server. Restart s3deck with credentials (see s3deck --help).
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
