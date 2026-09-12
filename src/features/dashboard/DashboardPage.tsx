import { useNavigate } from 'react-router-dom';
import { useMemo } from 'react';
import { AlertTriangle, ClipboardCheck, PauseCircle, Plus, Wrench } from 'lucide-react';
import { useAuth } from '@/features/auth/AuthProvider';
import { useCategories, useLocations, useProfiles, useWorkOrders } from '@/data/queries';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { WorkOrderCard } from '@/components/WorkOrderCard';
import { EmptyState } from '@/components/EmptyState';
import { isSameDay } from '@/lib/utils';
import type { CachedWorkOrder } from '@/data/db';

function Stat({ label, value, tone, onClick }: { label: string; value: number; tone?: string; onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className={`tap-target flex min-h-20 flex-col items-start justify-between rounded-2xl border p-3 text-left transition ${tone ?? 'border-slate-200 bg-white'} ${onClick ? 'hover:shadow-md' : 'cursor-default'}`}
    >
      <span className="text-3xl font-extrabold text-slate-900">{value}</span>
      <span className="text-sm font-semibold leading-4 text-slate-700">{label}</span>
    </button>
  );
}

export function DashboardPage() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const all = useWorkOrders();
  const profiles = useProfiles();
  const locations = useLocations(true);
  const categories = useCategories(true);

  const stats = useMemo(() => {
    const rows: CachedWorkOrder[] = all.data ?? [];
    const today = new Date();
    return {
      fresh: rows.filter((w) => w.status === 'NEW').length,
      breakdown: rows.filter((w) => (w.priority === 'BREAKDOWN' || w.priority === 'URGENT') && w.status !== 'CLOSED' && w.status !== 'DONE').length,
      inProgress: rows.filter((w) => w.status === 'IN_PROGRESS' || w.status === 'REOPENED').length,
      hold: rows.filter((w) => w.status === 'ON_HOLD').length,
      doneToday: rows.filter((w) => (w.status === 'DONE' || w.status === 'CLOSED') && w.completed_at && isSameDay(w.completed_at, today)).length,
      awaitingClose: rows.filter((w) => w.status === 'DONE').length,
    };
  }, [all.data]);

  if (!profile) return null;
  const rows = all.data ?? [];
  const needsDecision = rows.filter((w) => w.status === 'ON_HOLD' || w.status === 'DONE' || w.status === 'NEW');
  const locName = (id: string | null) => (id ? (locations.data ?? []).find((l) => l.id === id)?.name ?? null : null);
  const person = (id: string | null) => (id ? (profiles.data ?? []).find((p) => p.id === id) ?? null : null);
  const cat = (id: string | null) => (id ? (categories.data ?? []).find((c) => c.id === id) ?? null : null);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">Pulpit</h1>
          <p className="text-slate-600">
            Najważniejsze są wyjątki i blokady — nie liczby dla ozdoby. Dzień: {new Date().toLocaleDateString('pl-PL')}
          </p>
        </div>
        <Button size="lg" onClick={() => navigate('/zlecenia/nowe')}>
          <Plus className="h-5 w-5" aria-hidden="true" /> Nowe zlecenie
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Stat label="Nowe (bez przydziału)" value={stats.fresh} tone={stats.fresh ? 'border-amber-300 bg-amber-50' : undefined} onClick={() => navigate('/zespol?status=NEW')} />
        <Stat label="Awarie i pilne (otwarte)" value={stats.breakdown} tone={stats.breakdown ? 'border-red-300 bg-red-50' : undefined} onClick={() => navigate('/zespol?priority=breakdown-urgent')} />
        <Stat label="W trakcie" value={stats.inProgress} onClick={() => navigate('/zespol?status=IN_PROGRESS')} />
        <Stat label="Wstrzymane" value={stats.hold} tone={stats.hold ? 'border-rose-300 bg-rose-50' : undefined} onClick={() => navigate('/zespol?status=ON_HOLD')} />
        <Stat label="Wykonane dzisiaj" value={stats.doneToday} />
        <Stat label="Czekają na zamknięcie" value={stats.awaitingClose} onClick={() => navigate('/zespol?status=DONE')} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section aria-labelledby="sec-holds">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <PauseCircle className="h-5 w-5 text-red-700" aria-hidden="true" />
                <h2 id="sec-holds">Blokady wymagające decyzji</h2>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {rows.filter((w) => w.status === 'ON_HOLD').length === 0 ? (
                <EmptyState title="Brak blokad" description="Gdy wykonawca wstrzyma pracę, sprawa pojawi się tutaj od razu." />
              ) : (
                rows
                  .filter((w) => w.status === 'ON_HOLD')
                  .map((w) => (
                    <div key={w.id} className="rounded-xl border border-rose-200 bg-rose-50/50 p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-bold">
                            <a className="text-slate-900 underline-offset-2 hover:underline" href={`#/zlecenia/${w.id}`}>
                              {w.title}
                            </a>
                          </p>
                          <p className="text-sm text-slate-700">{w.hold_details}</p>
                          <p className="mt-1 text-sm">
                            <span className="font-semibold">Następny krok:</span> {w.next_action}
                          </p>
                          {w.hold_waiting_on ? (
                            <p className="text-sm text-slate-700">Czeka na: {person(w.hold_waiting_on)?.display_name ?? '—'}</p>
                          ) : null}
                        </div>
                        <Button variant="secondary" size="sm" onClick={() => navigate(`/zlecenia/${w.id}#komantarz`)}>
                          Odpowiedz
                        </Button>
                      </div>
                    </div>
                  ))
              )}
            </CardContent>
          </Card>
        </section>

        <section aria-labelledby="sec-decisions">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <ClipboardCheck className="h-5 w-5 text-emerald-700" aria-hidden="true" />
                <h2 id="sec-decisions">Sprawy wymagające decyzji dyrektora</h2>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {needsDecision.length === 0 ? (
                <EmptyState title="Wszystko rozegrane" description="Brak nowych zgłoszeń bez przydziału i wykonań do zamknięcia." />
              ) : (
                needsDecision.slice(0, 8).map((w) => (
                  <WorkOrderCard
                    key={w.id}
                    wo={w}
                    locationName={locName(w.location_id)}
                    lead={person(w.lead_worker_id)}
                    category={cat(w.category_id)}
                  />
                ))
              )}
            </CardContent>
          </Card>
        </section>
      </div>

      <section aria-labelledby="sec-progress">
        <h2 id="sec-progress" className="mb-3 flex items-center gap-2 text-xl font-bold">
          <Wrench className="h-5 w-5" aria-hidden="true" /> Zadania w toku i pilne
        </h2>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {rows
            .filter((w) => (w.status === 'IN_PROGRESS' || w.status === 'REOPENED' || w.priority === 'BREAKDOWN') && w.status !== 'CLOSED' && w.status !== 'DONE')
            .slice(0, 12)
            .map((w) => (
              <WorkOrderCard key={w.id} wo={w} locationName={locName(w.location_id)} lead={person(w.lead_worker_id)} category={cat(w.category_id)} />
            ))}
          {rows.filter((w) => (w.status === 'IN_PROGRESS' || w.status === 'REOPENED' || w.priority === 'BREAKDOWN') && w.status !== 'CLOSED').length === 0 ? (
            <div className="md:col-span-2 xl:col-span-3">
              <EmptyState title="Brak prac w toku" description="Nowe zgłoszenia pojawią się tutaj natychmiast po utworzeniu." />
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}

void AlertTriangle;
