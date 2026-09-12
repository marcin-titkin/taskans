import { getDb } from '@/data/db';
import { applyOp, type ReducerCtx } from '@/data/reducer';
import { emitDataChanged } from '@/lib/bus';
import { newId } from '@/lib/id';
import type { ActorContext, WorldState } from '@/data/gateway';
import type { LocalPhoto } from '@/data/db';
import type { Attachment, OutboxEntry } from '@/types/domain';
import type { Snapshot } from '@/data/gateway';

/**
 * Warstwa cache’u lokalnego: UI czyta wyłącznie stąd (local-first).
 * Zapisy aplikacyjne trafiają tu od razu (optimistic), a potwierdzenie z serwera spływa przez refreshSnapshot.
 */

export async function upsertSnapshot(snap: Snapshot): Promise<void> {
  const db = getDb();
  await db.transaction(
    'rw',
    [db.workOrders, db.updates, db.assignees, db.attachments, db.materials, db.notifications, db.reports, db.profiles, db.locations, db.categories],
    async () => {
      await db.profiles.bulkPut(snap.profiles);
      await db.locations.bulkPut(snap.locations);
      await db.categories.bulkPut(snap.categories);
      // Aktualizacje append-only: rekord serwera zastępuje jego lokalny odpowiednik (ten sam device_operation_id).
      const serverOpIds = new Set(snap.updates.map((u) => u.device_operation_id).filter((x): x is string => !!x));
      const localDupes = (await db.updates.toArray())
        .filter((u) => u.device_operation_id && serverOpIds.has(u.device_operation_id))
        .map((u) => u.id);
      if (localDupes.length) await db.updates.bulkDelete(localDupes);
      await db.updates.bulkPut(snap.updates);
      // Przydziały: serwer wygrywa dla istniejących par (zadanie, osoba).
      const serverPairs = new Set(snap.assignees.map((a) => `${a.work_order_id}|${a.user_id}`));
      const dupeAssignees = (await db.assignees.toArray())
        .filter((a) => serverPairs.has(`${a.work_order_id}|${a.user_id}`))
        .map((a) => a.id);
      if (dupeAssignees.length) await db.assignees.bulkDelete(dupeAssignees);
      await db.assignees.bulkPut(snap.assignees);
      // Materiały: deduplikacja po (zadanie, nazwa, autor).
      const serverMats = new Set(snap.materials.map((m) => `${m.work_order_id}|${m.name}|${m.created_by}`));
      const dupeMats = (await db.materials.toArray())
        .filter((m) => serverMats.has(`${m.work_order_id}|${m.name}|${m.created_by}`))
        .map((m) => m.id);
      if (dupeMats.length) await db.materials.bulkDelete(dupeMats);
      await db.materials.bulkPut(snap.materials);
      await db.attachments.bulkPut(snap.attachments);
      await db.notifications.bulkPut(snap.notifications);
      // Raporty: klucz biznesowy to data — nadpisujemy cache wersją z serwera.
      const cachedReports = await db.reports.toArray();
      const reportIdsToDrop = cachedReports
        .filter((c) => snap.reports.some((r) => r.report_date === c.report_date && r.id !== c.id))
        .map((c) => c.id);
      if (reportIdsToDrop.length) await db.reports.bulkDelete(reportIdsToDrop);
      await db.reports.bulkPut(snap.reports);
      // zadania: nadpisujemy tylko te, które nie mają lokalnego „brudnopisu” (optimistic);
      // usunięte na serwerze zostają w cache, dopóki kolejka nie potwierdzi stanu.
      const cached = await db.workOrders.toArray();
      const dirtyIds = new Set(cached.filter((w) => w.dirty).map((w) => w.id));
      await db.workOrders.bulkPut(
        snap.workOrders.map((w) => (dirtyIds.has(w.id) ? { ...w, dirty: true } : { ...w, dirty: undefined }))
      );
    }
  );
}

/** Oznacz zadania zsynchronizowane (po pomyślnym flushu kolejki i refreshu). */
export async function clearDirty(workOrderIds: string[]): Promise<void> {
  const db = getDb();
  await db.transaction('rw', db.workOrders, async () => {
    for (const id of workOrderIds) {
      const row = await db.workOrders.get(id);
      if (row) {
        delete row.dirty;
        await db.workOrders.put(row);
      }
    }
  });
}

export async function pruneSyncedSnapshot(): Promise<void> {
  // Przycinanie starych, zamkniętych zadań z cache (urządzenie współdzielone = mało miejsca).
  const db = getDb();
  const cutoff = new Date(Date.now() - 90 * 86400000).toISOString();
  await db.transaction('rw', [db.workOrders, db.attachments, db.photos], async () => {
    const stale = await db.workOrders
      .where('updated_at')
      .below(cutoff)
      .filter((w) => w.status === 'CLOSED' && !w.dirty)
      .toArray();
    for (const wo of stale) {
      await db.attachments.where('work_order_id').equals(wo.id).delete();
      await db.workOrders.delete(wo.id);
    }
  });
}

/** Zdjęcia lokalne (przed potwierdzeniem z serwera nie mogą być usunięte). */
export async function saveLocalPhoto(workOrderId: string | null, blob: Blob, fileName: string, mimeType: string): Promise<LocalPhoto> {
  const db = getDb();
  const row: LocalPhoto = {
    id: newId(),
    workOrderId,
    blob,
    fileName,
    mimeType,
    size: blob.size,
    createdAt: new Date().toISOString(),
    synced: false,
  };
  await db.photos.add(row);
  return row;
}

export async function markPhotoSynced(photoId: string): Promise<void> {
  const db = getDb();
  const p = await db.photos.get(photoId);
  if (p) await db.photos.put({ ...p, synced: true });
}

export async function listLocalPhotosFor(woId: string): Promise<LocalPhoto[]> {
  return getDb().photos.where('workOrderId').equals(woId).toArray();
}

export function attachmentKey(att: Attachment): string {
  return att.id;
}

/**
 * Optymistyczne zastosowanie operacji do cache’u (ten sam reduktor co serwer demo).
 * Błędy reguł traktujemy tu ulgowo — cache ma prezentować intencję użytkownika do czasu potwierdzenia.
 */
export async function optimisticApply(entry: OutboxEntry, actor: ActorContext): Promise<void> {
  const db = getDb();
  const cacheWorld = await buildCacheWorld();
  const ctx: ReducerCtx = { now: new Date().toISOString(), newId };
  try {
    const outcome = applyOp(cacheWorld, entry, actor, ctx);
    const t = outcome.touched;
    await db.transaction(
      'rw',
      [db.workOrders, db.updates, db.assignees, db.attachments, db.materials, db.reports, db.profiles, db.locations, db.categories],
      async () => {
        for (const wo of t.workOrders) await db.workOrders.put({ ...wo, dirty: true });
        for (const u of t.updates) await db.updates.put(u);
        for (const a of t.assignees) await db.assignees.put(a);
        for (const m of t.materials) await db.materials.put(m);
        for (const a of t.attachments) await db.attachments.put(a);
        for (const r of t.reports) await db.reports.put(r);
        for (const p of t.profiles) await db.profiles.put(p);
        for (const l of t.locations) await db.locations.put(l);
        for (const c of t.categories) await db.categories.put(c);
        // Powiadomienia generuje serwer (ma pełny obraz) — w cache lądują przy najbliższym refreshu.
      }
    );
  } catch (e) {
    // Nie blokuj UI — właściwy błąd zgłosi kolejka przy synchronizacji.
    console.warn('[taskans] cache reject (zaplanowany błąd trafi do kolejki):', e instanceof Error ? e.message : e);
  }
  emitDataChanged('optimistic');
}

async function buildCacheWorld(): Promise<WorldState> {
  const db = getDb();
  const [workOrders, updates, assignees, attachments, materials, notifications, reports, profiles, locations, categories] =
    await Promise.all([
      db.workOrders.toArray(),
      db.updates.toArray(),
      db.assignees.toArray(),
      db.attachments.toArray(),
      db.materials.toArray(),
      db.notifications.toArray(),
      db.reports.toArray(),
      db.profiles.toArray(),
      db.locations.toArray(),
      db.categories.toArray(),
    ]);
  return {
    // cache może zawierać flagi pomocnicze — redukujemy do czystego rekordu
    workOrders: workOrders.map(({ dirty: _dirty, ...rest }) => rest),
    updates,
    assignees,
    attachments,
    materials,
    notifications,
    reports,
    profiles,
    locations,
    categories,
    nextNumber: (await db.meta.get('nextNumber'))?.value ? Number((await db.meta.get('nextNumber'))?.value) : 1000,
  };
}
