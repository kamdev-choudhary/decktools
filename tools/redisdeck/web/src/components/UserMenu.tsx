import { LogOut, Type } from 'lucide-react';
import { toast } from 'sonner';
import type { ServerInfo, SessionInfo } from '@shared/types';
import { Button } from '@deck/ui/components/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@deck/ui/components/dropdown-menu';
import { ThemeSwitcher } from '@deck/ui/components/theme-switcher';
import { useLogout } from '@/api/hooks';
import { MONO_FONTS, SANS_FONTS, useFonts, type MonoFont, type SansFont } from '@/lib/fonts';
import { errorMessage } from './feedback';

export function UserMenu({ session, info }: { session: SessionInfo; info?: ServerInfo }) {
  const logout = useLogout();
  const name = session.username ?? 'local';
  const fonts = useFonts();

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
            <div className="truncate text-xs text-muted-foreground">
              {info.host}:{info.port} · {info.product === 'redis' ? 'Redis' : info.product} {info.version}
            </div>
          )}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <div className="flex items-center justify-between px-2 py-1.5 text-sm">
          Theme
          <ThemeSwitcher />
        </div>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <Type /> Interface font
            <span className="ml-auto pl-3 text-xs text-muted-foreground">{SANS_FONTS.find((f) => f.id === fonts.sans)?.label}</span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-52">
            <DropdownMenuRadioGroup value={fonts.sans} onValueChange={(v) => fonts.setSans(v as SansFont)}>
              {SANS_FONTS.map((f) => (
                <DropdownMenuRadioItem key={f.id} value={f.id} onSelect={(e) => e.preventDefault()} style={{ fontFamily: f.stack }}>
                  {f.label}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <Type /> Code font
            <span className="ml-auto pl-3 text-xs text-muted-foreground">{MONO_FONTS.find((f) => f.id === fonts.mono)?.label}</span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-56">
            <DropdownMenuRadioGroup value={fonts.mono} onValueChange={(v) => fonts.setMono(v as MonoFont)}>
              {MONO_FONTS.map((f) => (
                <DropdownMenuRadioItem key={f.id} value={f.id} onSelect={(e) => e.preventDefault()} style={{ fontFamily: f.stack }}>
                  {f.label}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        {session.authRequired && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => logout.mutate(undefined, { onError: (e) => toast.error(errorMessage(e)) })} className="justify-between">
              Log out
              <LogOut />
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
