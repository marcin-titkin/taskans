import { useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { useCategories, useLocations, useProfiles, useWorkOrders } from '@/data/queries';
import { WorkOrderCard } from '@/components/WorkOrderCard';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/form';
import { EmptyState } from '@/components/EmptyState';
import type { Priority, WorkOrderStatus } from '@/types/domain';
import { statusLabels } from '@/lib/labels';
import { compareForQueue } from '@/lib/transitions';

const STATUS_OPTIONS = Object.keys(statusLabels) as WorkOrderStatus[];

/** Tablica zespołu: wszystkie zadania + komplet filtrów (status, priorytet, osoba, kategoria, lokalizacja, data). */
export function TeamBoardPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const profiles = useProfiles();
  const locations = useLocations(true);
  const categories = useCategories(true);

  const status = params.get('status');
  const priority = params.get('priority');
  const personId = params.get('osoba');
  const categoryId = params.get('kategoria');
  const locationId = params.get('lokalizacja');
  const date = params.get('data');
  const search = params.get('szukaj') ?? '';

  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };

  const filtered = useWorkOrders({
    statuses: status ? [status as WorkOrderStatus] : undefined,
    priorities: priority === 'breakdown-urgent' ? (['BREAKDOWN', 'URGENT'] as Priority[]) : priority ? [priority as Priority] : undefined,
    assignedTo: personId,
    categoryId,
    locationId,
    search: search.trim() || undefined,
  });

  const rows = useMemo(() => {
    let list = filtered.data ?? [];
    if (date) {
      list = list.filter((w) => w.created_at.slice(0, 10) === date || (w.completed_at ?? '').slice(0, 10) === date);
    }
    return [...list].sort(compareForQueue);
  }, [filtered.data, date]);

  const locName = (id: string | null) => (id ? (locations.data ?? []).find((l) => l.id === id)?.name ?? null : null);
  const person = (id: string | null) => (id ? (profiles.data ?? []).find((p) => p.id === id) ?? null : null);
  const cat = (id: string | null) => (id ? (categories.data ?? []).find((c) => c.id === id) ?? null : null);
  const activeCount = [status, priority, personId, categoryId, locationId, date, search].filter(Boolean).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">Tablica zespołu</h1>
          <p className="text-slate-600">Wszystkie zadania — sortowanie: najpierw najważniejsze.</p>
        </div>
        <Button size="lg" onClick={() => navigate('/zlecenia/nowe')}>
          <Plus className="h-5 w-5" aria-hidden="true" /> Nowe zlecenie
        </Button>
      </div>

      <section aria-label="Filtry" className="rounded-2xl border border-slate-200 bg-white p-3">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="block text-sm font-semibold text-slate-700">
            Szukaj (tytuł, opis, numer)
            <Input className="mt-1 font-normal" value={search} onChange={(e) => setParam('szukaj', e.target.value || null)} placeholder="np. kran, 1042" aria-label="Szukaj" />
          </label>
          <label className="block text-sm font-semibold text-slate-700">
            Status
            <select
              className="mt-1 min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3 text-base font-normal"
              value={status ?? ''}
              onChange={(e) => setParam('status', e.target.value || null)}
            >
              <option value="">— wszystkie —</option>
              {STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {statusLabels[s]}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm font-semibold text-slate-700">
            Priorytet
            <select
              className="mt-1 min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3 text-base font-normal"
              value={priority ?? ''}
              onChange={(e) => setParam('priority', e.target.value || null)}
            >
              <option value="">— wszystkie —</option>
              <option value="breakdown-urgent">Awarie i pilne</option>
              <option value="BREAKDOWN">AWARIA</option>
              <option value="URGENT">PILNE</option>
              <option value="NORMAL">ZWYKŁE</option>
            </select>
          </label>
          <label className="block text-sm font-semibold text-slate-700">
            Osoba
            <select
              className="mt-1 min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3 text-base font-normal"
              value={personId ?? ''}
              onChange={(e) => setParam('osoba', e.target.value || null)}
            >
              <option value="">— każdy —</option>
              {(profiles.data ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.display_name}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm font-semibold text-slate-700">
            Kategoria
            <select
              className="mt-1 min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3 text-base font-normal"
              value={categoryId ?? ''}
              onChange={(e) => setParam('kategoria', e.target.value || null)}
            >
              <option value="">— wszystkie —</option>
              {(categories.data ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm font-semibold text-slate-700">
            Lokalizacja
            <select
              className="mt-1 min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3 text-base font-normal"
              value={locationId ?? ''}
              onChange={(e) => setParam('lokalizacja', e.target.value || null)}
            >
              <option value="">— wszystkie —</option>
              {(locations.data ?? []).map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm font-semibold text-slate-700">
            Data (zgłoszenia lub wykonania)
            <Input type="date" className="mt-1 font-normal" value={date ?? ''} onChange={(e) => setParam('data', e.target.value || null)} />
          </label>
          <div className="flex items-end">
            {activeCount > 0 ? (
              <Button variant="outline" onClick={() => setParams(new URLSearchParams(), { replace: true })}>
                Wyczyść filtry ({activeCount})
              </Button>
            ) : null}
          </div>
        </div>
      </section>

      {rows.length === 0 ? (
        <EmptyState title="Brak zadań dla wybranych filtrów" description="Zmień filtry albo utwórz nowe zlecenie." />
      ) : (
        <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3" aria-label={`Lista zadań, ${rows.length} pozycji`}>
          {rows.map((w) => (
            <li key={w.id}>
              <WorkOrderCard wo={w} locationName={locName(w.location_id)} lead={person(w.lead_worker_id)} category={cat(w.category_id)} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
