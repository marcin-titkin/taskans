import { Link } from 'react-router-dom';
import { RefreshCw, XCircle, CloudOff, Database } from 'lucide-react';
import { useDataEvents, useQueryOnEvents } from '@/data/queries';
import { getDb } from '@/data/db';
import { getSyncManager, appMode } from '@/data/repository';
import { useSyncState } from '@/components/SyncPill';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/EmptyState';
import { setOfflineMode } from '@/data/repository';
import { relTimePl } from '@/lib/utils';
import type { OutboxEntry } from '@/types/domain';

/** Centrum synchronizacji: kolejka outbox, konflikty z decyzją użytkownika, tryb offline (demo). */
export function SyncPage() {
  const v = useDataEvents();
  const s = useSyncState();
  const q = useQueryOnEvents(['outboxAll'], () => getDb().outbox.toArray(), v);
  const items: OutboxEntry[] = (q.data ?? []).filter((e) => e.status !== 'SYNCED').reverse();
  const mgr = getSyncManager();

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <h1 className="flex items-center gap-2 text-2xl font-extrabold tracking-tight">
        <Database className="h-6 w-6" aria-hidden="true" /> Dane i synchronizacja
      </h1>

      <Card>
        <CardContent className="grid gap-2 text-[15px] sm:grid-cols-2">
          <p>
            <span className="font-semibold">Połączenie:</span>{' '}
            {s.online ? <Badge tone="success">online</Badge> : <Badge tone="warning"><CloudOff className="h-4 w-4" aria-hidden="true" /> offline</Badge>}
          </p>
          <p>
            <span className="font-semibold">Tryb aplikacji:</span>{' '}
            {appMode() === 'demo' ? 'demo lokalne (IndexedDB)' : 'Supabase'}
          </p>
          <p>
            <span className="font-semibold">W kolejce:</span> {s.pending} do wysłania
          </p>
          <p>
            <span className="font-semibold">Konflikty / błędy:</span> {s.conflicts + s.errors}
          </p>
          <p className="sm:col-span-2">
            <span className="font-semibold">Ostatnia synchronizacja:</span> {s.lastSyncAt ? relTimePl(s.lastSyncAt) : 'jeszcze w tej sesji'}
          </p>
          <div className="flex flex-wrap gap-2 sm:col-span-2">
            <Button variant="secondary" onClick={() => mgr.retryNow()} disabled={s.syncing}>
              <RefreshCw className={`h-5 w-5 ${s.syncing ? 'animate-spin' : ''}`} aria-hidden="true" /> Synchronizuj teraz
            </Button>
            {appMode() === 'demo' ? (
              <Button
                variant={s.online ? 'outline' : 'destructive'}
                onClick={() => void setOfflineMode(s.online)}
                aria-pressed={!s.online}
              >
                {s.online ? 'Symuluj odłączenie internetu' : 'Wróć do trybu online'}
              </Button>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle as="h2">Kolejka operacji ({items.length})</CardTitle>
          <p className="text-sm text-slate-600">
            Zmiany czekają w pamięci urządzenia do momentu potwierdzenia przez serwer. Nic nie ginie przy braku internetu ani
            awarii wysyłki — operacje ponawiamy automatycznie.
          </p>
        </CardHeader>
        <CardContent>
          {items.length === 0 ? (
            <EmptyState title="Kolejka pusta" description="Wszystkie lokalne zmiany zostały potwierdzone przez serwer." />
          ) : (
            <ul className="space-y-2">
              {items.map((e) => (
                <li key={e.seq} className="rounded-xl border border-slate-200 p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={e.status === 'CONFLICT' ? 'danger' : e.status === 'ERROR' ? 'warning' : 'neutral'}>
                      {e.status === 'CONFLICT' ? 'konflikt — wymaga decyzji' : e.status === 'ERROR' ? `błąd (próba ${e.attempts})` : e.status === 'PENDING' ? 'oczekuje' : e.status}
                    </Badge>
                    <span className="font-semibold">{e.label}</span>
                    <span className="ml-auto text-sm text-slate-500">{relTimePl(e.createdAt)}</span>
                  </div>
                  {e.lastError ? <p className="mt-1 text-sm text-red-800">{e.lastError}</p> : null}
                  {e.workOrderId ? (
                    <p className="mt-1 text-sm">
                      <Link className="font-semibold text-brand-800 underline" to={`/zlecenia/${e.workOrderId}`}>
                        Otwórz zadanie
                      </Link>
                    </p>
                  ) : null}
                  {e.status === 'CONFLICT' || e.status === 'ERROR' ? (
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Button size="sm" onClick={() => e.seq !== undefined && void mgr.retryOp(e.seq)}>
                        <RefreshCw className="h-4 w-4" aria-hidden="true" /> Spróbuj ponownie
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => e.seq !== undefined && void mgr.discardOp(e.seq, e.workOrderId ?? null)}
                      >
                        <XCircle className="h-4 w-4" aria-hidden="true" /> Porzuć tę zmianę (wygrywa serwer)
                      </Button>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
