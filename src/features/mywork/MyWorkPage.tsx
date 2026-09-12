import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Play } from 'lucide-react';
import { useAuth } from '@/features/auth/AuthProvider';
import { useCategories, useLocations, useMyNotifications, useProfiles, useWorkOrders } from '@/data/queries';
import { WorkOrderCard } from '@/components/WorkOrderCard';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/EmptyState';
import { isSameDay } from '@/lib/utils';
import { mutations } from '@/data/repository';
import type { CachedWorkOrder } from '@/data/db';

/**
 * „Moja praca” — ekran wykonawcy. Pięć sekcji wg briefu, a w nich najszybsza
 * możliwa akcja: jedno dotknięcie, aby rozpocząć przydzielone zadanie.
 */
export function MyWorkPage() {
  const { profile } = useAuth();
  const me = profile?.id ?? '';
  const navigate = useNavigate();
  const allMine = useWorkOrders({ assignedTo: me });
  const profiles = useProfiles();
  const locations = useLocations(true);
  const categories = useCategories(true);
  const notes = useMyNotifications(profile?.id ?? null);
  const unread = (notes.data ?? []).filter((n) => !n.read_at).length;

  const buckets = useMemo(() => {
    const rows = allMine.data ?? [];
    const today = new Date();
    const mineOf = (pred: (w: CachedWorkOrder) => boolean) => rows.filter(pred);
    return {
      pilne: mineOf((w) => (w.priority === 'BREAKDOWN' || w.priority === 'URGENT') && (w.status === 'NEW' || w.status === 'ASSIGNED' || w.status === 'REOPENED' || w.status === 'IN_PROGRESS')),
      wToku: mineOf((w) => w.status === 'IN_PROGRESS'),
      doZrobienia: mineOf((w) => w.status === 'ASSIGNED' || (w.status === 'REOPENED' && w.priority === 'NORMAL')),
      wstrzymane: mineOf((w) => w.status === 'ON_HOLD'),
      wykonaneDzis: mineOf((w) => (w.status === 'DONE' || w.status === 'CLOSED') && w.completed_at !== null && isSameDay(w.completed_at, today)),
    };
  }, [allMine.data]);

  if (!profile) return null;

  const locName = (id: string | null) => (id ? (locations.data ?? []).find((l) => l.id === id)?.name ?? null : null);
  const person = (id: string | null) => (id ? (profiles.data ?? []).find((p) => p.id === id) ?? null : null);
  const cat = (id: string | null) => (id ? (categories.data ?? []).find((c) => c.id === id) ?? null : null);

  const renderList = (title: string, list: CachedWorkOrder[], empty: string, showStart: boolean) => (
    <section aria-label={title} className="space-y-2">
      <div className="flex items-baseline justify-between">
        <h2 className="text-lg font-bold">{title}</h2>
        {list.length > 0 ? <span className="text-sm text-slate-500">{list.length}</span> : null}
      </div>
      {list.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-300 px-4 py-3 text-sm text-slate-600">{empty}</p>
      ) : (
        <ul className="space-y-2">
          {list.map((w) => (
            <li key={w.id} className="relative">
              <WorkOrderCard wo={w} locationName={locName(w.location_id)} lead={person(w.lead_worker_id)} category={cat(w.category_id)} />
              {showStart && (w.status === 'ASSIGNED' || w.status === 'REOPENED') ? (
                <Button
                  size="lg"
                  className="absolute bottom-3 right-3 shadow-lg"
                  onClick={() => void mutations.transition(w.id, 'IN_PROGRESS', w.status, { message: null }).then(() => navigate(`/zlecenia/${w.id}`))}
                >
                  <Play className="h-5 w-5" aria-hidden="true" /> Rozpocznij
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">Moja praca</h1>
          <p className="text-slate-600">Cześć {profile.display_name.split(' ')[0]} — poniżej Twoje zadania na dziś.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="lg" onClick={() => navigate('/praca-bez-zlecenia')}>
            Dodaj wykonaną pracę
          </Button>
          <Button variant="outline" size="lg" onClick={() => navigate('/powiadomienia')} aria-label={`Powiadomienia${unread ? `, ${unread} nieprzeczytane` : ''}`}>
            Powiadomienia{unread ? ` (${unread})` : ''}
          </Button>
        </div>
      </div>

      {renderList('Pilne', buckets.pilne, 'Brak pilnych spraw — świetnie.', true)}
      {renderList('W trakcie', buckets.wToku, 'Nic aktualnie nie jest wykonywane przez Ciebie.', false)}
      {renderList('Do zrobienia', buckets.doZrobienia, 'Brak nowych przydziałów.', true)}
      {renderList('Wstrzymane', buckets.wstrzymane, 'Nie masz zatrzymanych zadań.', false)}
      {renderList('Wykonane dzisiaj', buckets.wykonaneDzis, 'Jeszcze nic dziś nie oznaczyłeś jako wykonane.', false)}

      {buckets.pilne.length + buckets.doZrobienia.length + buckets.wToku.length === 0 ? (
        <EmptyState
          title="Na dziś pusto"
          description="Nowe przydziały pojawią się tu natychmiast. Możesz też wpisać pracę wykonaną bez zlecenia."
          action={
            <Button size="lg" onClick={() => navigate('/praca-bez-zlecenia')}>
              Dodaj wykonaną pracę
            </Button>
          }
        />
      ) : null}
    </div>
  );
}
