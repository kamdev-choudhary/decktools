import { CircleAlert } from 'lucide-react';
import { errorText } from '@/api/client';
import { useConnections, useMe } from '@/api/hooks';
import { Shell } from '@/components/app/shell';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Spinner } from '@/components/ui/spinner';
import { ConnectView } from '@/views/connect';
import { LoginView } from '@/views/login';

function FullPageError({ title, error }: { title: string; error: unknown }) {
  return (
    <div className="grid h-full place-items-center p-4">
      <Alert variant="destructive" className="max-w-md">
        <CircleAlert />
        <AlertTitle>{title}</AlertTitle>
        <AlertDescription>{errorText(error)}</AlertDescription>
      </Alert>
    </div>
  );
}

export function App() {
  const me = useMe();
  const loggedIn = !!me.data?.authenticated;
  const connections = useConnections(loggedIn);

  if (me.isPending || (loggedIn && connections.isPending)) {
    return (
      <div className="grid h-full place-items-center">
        <Spinner className="size-6 text-muted-foreground" />
      </div>
    );
  }
  if (me.isError) return <FullPageError title="Can’t reach s3deck" error={me.error} />;
  if (!loggedIn) return <LoginView />;
  if (connections.isError) return <FullPageError title="Couldn’t load connections" error={connections.error} />;
  if (!connections.data?.activeId) return <ConnectView />;
  return <Shell me={me.data} connections={connections.data} />;
}
