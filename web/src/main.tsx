import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import type { SessionInfo } from '@shared/types';
import { isUnauthorized } from '@/api/client';
import { keys } from '@/api/hooks';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ThemeProvider } from '@/lib/theme';
import { App } from './App';
import './styles.css';

// Any 401 means the session expired (or pgdeck restarted): drop back to the login screen.
const onError = (error: unknown) => {
  if (!isUnauthorized(error)) return;
  queryClient.setQueryData<SessionInfo>(keys.session, (s) => (s ? { ...s, authenticated: false, username: null } : s));
};

const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError }),
  mutationCache: new MutationCache({ onError }),
  defaultOptions: {
    queries: { retry: false, refetchOnWindowFocus: false, staleTime: 30_000 },
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <TooltipProvider delayDuration={300}>
          <App />
          <Toaster position="bottom-right" />
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  </StrictMode>,
);
