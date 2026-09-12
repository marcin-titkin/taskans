import { useMemo, useSyncExternalStore } from 'react';
import { useQuery, type QueryKey } from '@tanstack/react-query';
import { getDb } from '@/data/db';
import { bus } from '@/lib/bus';
import { compareForQueue, isOpen } from '@/lib/transitions';
import type { Priority, WorkOrderStatus } from '@/types/domain';
import type { CachedWorkOrder } from '@/data/db';

/**
 * Odczyty zawsze z lokalnego cache’u (IndexedDB/Dexie) — dzięki temu interfejs działa też offline.
 * Unieważnianie zapytań napędza magistrala zdarzeń (sync, realtime, zmiany lokalne).
 */
/*
 * Globalny (monotoniczny) licznik zdarzeń danych. Wcześniejsza wersja per-komponent
 * resetowała się przy remoncie, a klucz v${n} zderzał z wynikiem zcache'owanym w
 * poprzedniej sesji — TanStack brał ŚWIEŻĄ-pozornie wpiskę i oddawał stare dane
 (np. „Wstrzymane • czeka na sync” zamiast „Zamknięte”). Globalny licznik gwarantuje
 unikalny klucz na każde zdarzenie magistrali.
 */
let dataVersion = 0;
const versionListeners = new Set<() => void>();
bus.on((e) => {
  if (e.type === 'data-changed' || e.type === 'outbox-changed' || e.type === 'conflict') {
    dataVersion += 1;
    for (const notify of versionListeners) notify();
  }
});

export function useDataEvents(): number {
  return useSyncExternalStore(
    (cb) => {
      versionListeners.add(cb);
      return () => {
        versionListeners.delete(cb);
      };
    },
    () => dataVersion,
    () => dataVersion
  );
}

export function useQueryOnEvents<T>(key: QueryKey, fn: () => Promise<T>, version: number) {
  
  return useQuery({
    // wersja z magistrali zdarzeń wymusza refetch po każdej zmianie danych (sync, realtime, zapis lokalny)
    queryKey: [...key, `v${version}`],
    queryFn: fn,
    staleTime: 10_000,
    gcTime: 5 * 60_000,
    refetchOnMount: 'always',
    refetchInterval: false,
  });
}

export interface WorkOrderFilters {
  statuses?: WorkOrderStatus[];
  priorities?: Priority[];
  assignedTo?: string | null;
  categoryId?: string | null;
  locationId?: string | null;
  search?: string;
  openOnly?: boolean;
}

export function useProfiles() {
  const v = useDataEvents();
  return useQueryOnEvents(['profiles'], async () => (await getDb().profiles.toArray()), v);
}

export function useLocations(includeInactive = false) {
  const v = useDataEvents();
  return useQueryOnEvents(
    ['locations', includeInactive],
    async () => {
      const all = await getDb().locations.toArray();
      return includeInactive ? all : all.filter((l) => l.active);
    },
    v
  );
}

export function useCategories(includeInactive = false) {
  const v = useDataEvents();
  return useQueryOnEvents(
    ['categories', includeInactive],
    async () => {
      const all = await getDb().categories.toArray();
      return includeInactive ? all : all.filter((c) => c.active);
    },
    v
  );
}

export function useWorkOrders(filters: WorkOrderFilters = {}) {
  const v = useDataEvents();
  const q = useQueryOnEvents(['workOrders', stableKey(filters)], async () => {
    const db = getDb();
    let rows = await db.workOrders.toArray();
    if (filters.openOnly) rows = rows.filter((w) => isOpen(w.status));
    if (filters.statuses?.length) rows = rows.filter((w) => filters.statuses!.includes(w.status));
    if (filters.priorities?.length) rows = rows.filter((w) => filters.priorities!.includes(w.priority));
    if (filters.assignedTo) {
      const uid = filters.assignedTo;
      const assignedIds = new Set(
        (await db.assignees.where('user_id').equals(uid).toArray()).map((a) => a.work_order_id)
      );
      rows = rows.filter((w) => w.lead_worker_id === uid || assignedIds.has(w.id));
    }
    if (filters.categoryId) rows = rows.filter((w) => w.category_id === filters.categoryId);
    if (filters.locationId) rows = rows.filter((w) => w.location_id === filters.locationId);
    if (filters.search) {
      const s = filters.search.toLowerCase();
      rows = rows.filter(
        (w) => w.title.toLowerCase().includes(s) || w.description.toLowerCase().includes(s) || String(w.sequential_number).includes(s)
      );
    }
    return rows.sort(compareForQueue);
  }, v);
  return { ...q, data: useMemo(() => q.data ?? [], [q.data]) };
}

export function useWorkOrder(id: string) {
  const v = useDataEvents();
  return useQueryOnEvents(
    ['workOrder', id],
    async () => {
      const db = getDb();
      const wo = await db.workOrders.get(id);
      if (!wo) return null;
      const [updates, assignees, attachments, materials] = await Promise.all([
        db.updates.where('work_order_id').equals(id).toArray(),
        db.assignees.where('work_order_id').equals(id).toArray(),
        db.attachments.where('work_order_id').equals(id).toArray(),
        db.materials.where('work_order_id').equals(id).toArray(),
      ]);
      updates.sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
      return {
        workOrder: wo,
        updates,
        assignees,
        attachments,
        materials: materials.sort((a, b) => (a.created_at < b.created_at ? 1 : -1)),
      };
    },
    v
  );
}

export function useMyNotifications(recipientId: string | null) {
  const v = useDataEvents();
  return useQueryOnEvents(
    ['notifications', recipientId],
    async () => {
      if (!recipientId) return [];
      const db = getDb();
      const rows = await db.notifications.where('recipient_id').equals(recipientId).toArray();
      return rows.sort((a, b) => (a.created_at > b.created_at ? -1 : 1));
    },
    v
  );
}

export function useOutboxPending() {
  const v = useDataEvents();
  return useQueryOnEvents(['outboxPending'], async () => {
    const db = getDb();
    const all = await db.outbox.toArray();
    const pending = all.filter((e) => e.status === 'PENDING' || e.status === 'ERROR' || e.status === 'CONFLICT');
    return {
      pending: pending.length,
      conflicts: all.filter((e) => e.status === 'CONFLICT'),
      errors: all.filter((e) => e.status === 'ERROR'),
      latestLabel: pending.at(-1)?.label ?? null,
    };
  }, v);
}

export function useUnsyncedPhotoCount(woId: string | null) {
  const v = useDataEvents();
  return useQueryOnEvents(
    ['unsyncedPhotos', woId],
    async () => (woId ? (await getDb().photos.where('workOrderId').equals(woId).filter((p) => !p.synced).count()) : 0),
    v
  );
}

export function workOrderLocationName(wo: CachedWorkOrder, locations: { id: string; name: string }[]): string {
  return locations.find((l) => l.id === wo.location_id)?.name ?? '—';
}

export function stableKey(filters: WorkOrderFilters): string {
  return JSON.stringify(filters, Object.keys(filters).sort());
}
