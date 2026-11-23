import { LogOut } from 'lucide-react';
import { toast } from 'sonner';
import type { DbInfo, SessionInfo } from '@shared/types';
import { useLogout } from '@/api/hooks';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { errorMessage } from './feedback';
import { ThemeSwitcher } from './ThemeSwitcher';

export function UserMenu({ session, info }: { session: SessionInfo; info?: DbInfo }) {
  const logout = useLogout();
  const name = session.username ?? info?.user ?? 'local';

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" className="rounded-full" aria-label="Account menu">
          <span className="flex size-7 items-center justify-center rounded-full bg-gradient-to-br from-neutral-400 to-neutral-700 text-[11px] font-semibold text-white uppercase dark:from-neutral-500 dark:to-neutral-800">
            {name.slice(0, 1)}
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="font-normal">
          <div className="text-sm font-medium">{session.authRequired ? name : 'Auth disabled'}</div>
          {info && (
            <div className="truncate text-xs text-muted-foreground" title={info.version}>
              {info.user}@{info.host ?? 'local'}
              {info.port ? `:${info.port}` : ''} · {info.version.split(' ').slice(0, 2).join(' ')}
            </div>
          )}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <div className="flex items-center justify-between px-2 py-1.5 text-sm">
          Theme
          <ThemeSwitcher />
        </div>
        {session.authRequired && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() => logout.mutate(undefined, { onError: (e) => toast.error(errorMessage(e)) })}
              className="justify-between"
            >
              Log out
              <LogOut />
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
