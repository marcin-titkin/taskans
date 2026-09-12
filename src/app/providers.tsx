import { useEffect, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider, useAuth } from '@/features/auth/AuthProvider';
import { ToastProvider } from '@/components/ui/toast';
import { getGateway, refreshCache } from '@/data/repository';
import { emitDataChanged } from '@/lib/bus';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 5_000 },
    mutations: { retry: 0 },
  },
});

/** Subskrypcja zmian po stronie serwera (supabase realtime) + odświeżenie cache po wejściu online. */
function DataLiveBridge() {
  const { status } = useAuth();
  useEffect(() => {
    if (status !== 'authenticated') return;
    void refreshCache().then(() => emitDataChanged('boot-refresh'));
    const off = getGateway().subscribeRealtime?.(() => {
      void refreshCache().then(() => emitDataChanged('realtime'));
    });
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
