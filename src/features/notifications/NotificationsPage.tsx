import { Link } from 'react-router-dom';
import { Bell, CheckCheck } from 'lucide-react';
import { useAuth } from '@/features/auth/AuthProvider';
import { useMyNotifications } from '@/data/queries';
import { getDb } from '@/data/db';
import { emitDataChanged } from '@/lib/bus';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/EmptyState';
import { notificationLabels } from '@/lib/labels';
import { relTimePl } from '@/lib/utils';
import { useToast } from '@/components/ui/toast';

const toneByKind: Record<string, 'danger' | 'warning' | 'info' | 'neutral'> = {
  HOLD_RAISED: 'danger',
  PRIORITY_ESCALATED: 'danger',
  REOPENED: 'warning',
  ASSIGNED: 'info',
  HOLD_REPLY: 'neutral',
};

export function NotificationsPage() {
  const { profile } = useAuth();
  const toast = useToast();
  const q = useMyNotifications(profile?.id ?? null);
  const items = q.data ?? [];
  const unread = items.filter((n) => !n.read_at);

  async function markAll() {
    if (!profile) return;
    const db = getDb();
    const now = new Date().toISOString();
    for (const n of unread) await db.notifications.put({ ...n, read_at: now });
    emitDataChanged('notifs-read');
    toast({ tone: 'ok', message: 'Oznaczono jako przeczytane.' });
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-extrabold tracking-tight">
            <Bell className="h-6 w-6" aria-hidden="true" /> Powiadomienia
          </h1>
          <p className="text-slate-600">
            Tylko to, co naprawdę wymaga uwagi: przydziały, eskalacje, blokady, odpowiedzi i ponowne otwarcia. Zwykłe
            komentarze i starty prac trafiają na pulpity i do raportu.
          </p>
        </div>
        {unread.length > 0 ? (
          <Button variant="secondary" onClick={() => void markAll()}>
            <CheckCheck className="h-5 w-5" aria-hidden="true" /> Oznacz wszystkie
          </Button>
        ) : null}
      </div>

      {items.length === 0 ? (
        <EmptyState title="Brak powiadomień" description="Gdy ktoś przydzieli Ci zadanie albo zgłosi blokadę, zobaczysz to tutaj." />
      ) : (
        <ul className="space-y-2">
          {items.map((n) => (
            <li key={n.id}>
              <Card className={!n.read_at ? 'border-brand-600/40 bg-brand-50/40' : undefined}>
                <CardContent className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold text-slate-900">
                      <Link className="underline-offset-2 hover:underline" to={n.work_order_id ? `/zlecenia/${n.work_order_id}` : '/zespol'}>
                        {n.message}
                      </Link>
                    </p>
                    <p className="text-sm text-slate-600">{relTimePl(n.created_at)}</p>
                  </div>
                  <Badge tone={toneByKind[n.kind] ?? 'neutral'}>{notificationLabels[n.kind]}</Badge>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
