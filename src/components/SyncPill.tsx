import { Link } from 'react-router-dom';
import { useSyncExternalStore } from 'react';
import { CloudOff, RefreshCw, CircleCheck, CircleAlert } from 'lucide-react';
import { getSyncManager } from '@/data/repository';
import type { SyncState } from '@/data/outbox';
import { cn } from '@/lib/utils';

export function useSyncState(): SyncState {
  const mgr = getSyncManager();
  return useSyncExternalStore(
    (cb) => mgr.subscribe(cb),
    () => mgr.stateSnapshot
  );
}

function describe(s: SyncState): { icon: React.ReactNode; text: string; tone: string } {
  if (!s.online)
    return {
      icon: <CloudOff className="h-4 w-4" aria-hidden="true" />,
      text: `Offline — zapisane lokalnie${s.pending ? ` (${s.pending})` : ''}`,
      tone: 'bg-amber-50 text-amber-900 border-amber-300',
    };
  if (s.conflicts > 0)
    return { icon: <CircleAlert className="h-4 w-4" aria-hidden="true" />, text: `Konflikt do rozwiązania (${s.conflicts})`, tone: 'bg-red-50 text-red-800 border-red-300' };
  if (s.errors > 0)
    return { icon: <CircleAlert className="h-4 w-4" aria-hidden="true" />, text: `Błąd synchronizacji (${s.errors})`, tone: 'bg-red-50 text-red-800 border-red-300' };
  if (s.syncing || s.pending > 0)
    return {
      icon: <RefreshCw className="h-4 w-4 animate-spin" aria-hidden="true" />,
      text: s.pending > 0 ? `Synchronizuję (pozostało ${s.pending})` : 'Synchronizuję…',
      tone: 'bg-sky-50 text-sky-900 border-sky-300',
    };
  return { icon: <CircleCheck className="h-4 w-4" aria-hidden="true" />, text: 'Wszystko zsynchronizowane', tone: 'bg-emerald-50 text-emerald-900 border-emerald-300' };
}

/**
 * Ciągła informacja o zapisie i synchronizacji (brief): użytkownik zawsze wie,
 * czy dane są lokalne, wysyłane, czy potwierdzone. Kliknięcie otwiera centrum synchronizacji.
 */
export function SyncPill({ compact = false }: { compact?: boolean }) {
  const s = useSyncState();
  const d = describe(s);
  return (
    <Link
      to="/synchronizacja"
      data-testid="sync-pill"
      className={cn('inline-flex items-center gap-2 rounded-full border px-3 py-2 text-sm font-semibold no-underline', compact && 'px-2', d.tone)}
      aria-label={`Stan synchronizacji: ${d.text}. Otwórz szczegóły.`}
    >
      {d.icon}
      {!compact ? <span>{d.text}</span> : null}
    </Link>
  );
}
