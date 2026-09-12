import { useEffect, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider, useAuth } from '@/features/auth/AuthProvider';
import { ToastProvider } from '@/components/ui/toast';
import { getGateway, refreshCache } from '@/data/repository';
import { emitDataChanged } from '@/lib/bus';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 5_000,
      // odczyty idą offline-first przez cache (Dexie/IDB) — TanStack nie może ich
      // pauzować przy braku sieci; za serwer odpowiada SyncManager/outbox
      networkMode: 'always',
    },
    mutations: { retry: 0, networkMode: 'always' },
  },
});

/** Subskrypcja zmian po stronie serwera (supabase realtime) + odświeżenie cache po wejściu online. */
function DataLiveBridge() {
  const { status } = useAuth();
  useEffect(() => {
    if (status !== 'authenticated') return;
    void refreshCache().then(() => emitDataChanged('boot-refresh'));
    // Realtime tylko dla Supabase: w demo „serwer” siedzi w tej samej karcie i zmiany
    // idą przez magistralę — subskrypcja mostkowałaby emit→refresh→emit w nieskończoność.
    const gateway = getGateway();
    const off = gateway.mode === 'supabase' ? gateway.subscribeRealtime?.(() => {
      void refreshCache().then(() => emitDataChanged('realtime'));
    }) : undefined;
    const onOnline = () => void refreshCache().then(() => emitDataChanged('online'));
    window.addEventListener('online', onOnline);
    return () => {
      off?.();
      window.removeEventListener('online', onOnline);
    };
  }, [status]);
  return null;
}

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <ToastProvider>
          <DataLiveBridge />
          {children}
        </ToastProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}
