import { getDb, type ReportRow } from '@/data/db';
import { applyOp, type ReducerCtx } from '@/data/reducer';
import type { ActorContext, ApplyErrorKind, Snapshot, WorldState } from '@/data/gateway';
import { NetworkError, ValidationError, errorKind } from '@/data/gateway';
import type { OutboxEntry } from '@/types/domain';
import { newId } from '@/lib/id';
import { emitDataChanged } from '@/lib/bus';

/**
 * „Serwer” trybu demo: weryfikuje operacje dokładnie tak samo, jak robiłby to backend Supabase
 * (te same reguły w funkcjach SQL + RLS), a następnie zapisuje je w oddzielnych tabelach IndexedDB.
 * Symuluje też: opóźnienie sieci, błędy sieciowe (offline) i jednorazowe awersje (do testów kolejki).
 */

export class DemoApplyError extends Error {
  kind: ApplyErrorKind;
  constructor(kind: ApplyErrorKind, message: string) {
    super(message);
    this.kind = kind;
    this.name = 'DemoApplyError';
  }
}

export interface DemoServerFlags {
  /** Symulacja braku internetu dla warstwy sieciowej (wstrzymuje kolejkę). */
  networkDown: boolean;
  /** Następną operację odrzuca błędem sieci (do testu „retry bez utraty danych”). */
  failNextOnce: boolean;
  /** Odstęp „sieci” w ms. */
  latencyMs: number;
}

const DEFAULT_FLAGS: DemoServerFlags = { networkDown: false, failNextOnce: false, latencyMs: 250 };

async function loadFlags(): Promise<DemoServerFlags> {
  const db = getDb();
  const row = await db.meta.get('demoFlags');
  return { ...DEFAULT_FLAGS, ...(row?.value as Partial<DemoServerFlags> | undefined) };
}

export async function setDemoFlag(patch: Partial<DemoServerFlags>): Promise<void> {
  const db = getDb();
  const cur = await loadFlags();
  await db.meta.put({ key: 'demoFlags', value: { ...cur, ...patch } });
}

export async function getDemoFlags(): Promise<DemoServerFlags> {
  return loadFlags();
}

async function sleep(ms: number): Promise<void> {
  if (ms > 0) await new Promise((r) => setTimeout(r, ms));
}

export async function loadWorld(): Promise<WorldState> {
  const db = getDb();
  const [workOrders, updates, assignees, attachments, materials, notifications, reports, profiles, locations, categories, meta] =
    await Promise.all([
      db.server_workOrders.toArray(),
      db.server_updates.toArray(),
      db.server_assignees.toArray(),
      db.server_attachments.toArray(),
      db.server_materials.toArray(),
      db.server_notifications.toArray(),
      db.server_reports.toArray(),
      db.server_profiles.toArray(),
      db.server_locations.toArray(),
      db.server_categories.toArray(),
      db.meta.get('nextNumber'),
    ]);
  const nextNumber = typeof meta?.value === 'number' ? meta.value : 1000;
  return { workOrders, updates, assignees, attachments, materials, notifications, reports, profiles, locations, categories, nextNumber };
}

/** Wykonuje jedną operację z kolejki na „serwerze” demo. */
export async function demoApplyOp(entry: OutboxEntry, actor: ActorContext): Promise<void> {
  const flags = await loadFlags();
  await sleep(flags.latencyMs);
  if (flags.networkDown) throw new NetworkError();
  if (flags.failNextOnce) {
    await setDemoFlag({ failNextOnce: false });
    throw new NetworkError('Symulacja awarii sieci (test kolejki).');
  }
  const db = getDb();
  const state = await loadWorld();
  if (state.updates.some((u) => u.device_operation_id === entry.opId)) return; // idempotentnie
  const ctx: ReducerCtx = { now: new Date().toISOString(), newId };
  let outcome;
  try {
    outcome = applyOp(state, entry, actor, ctx);
  } catch (e) {
    // Błędy domenowe (Permission/Validation/Conflict/Network) propagujemy bez zmian — kolejka rozpoznaje je po typie.
    if (e instanceof Error && 'kind' in e && typeof (e as DemoApplyError).kind === 'string' && (e as DemoApplyError).kind !== 'server') throw e;
    throw new DemoApplyError(errorKind(e), e instanceof Error ? e.message : String(e));
  }
  const t = outcome.touched;
  await db.transaction(
    'rw',
    [
      db.server_workOrders,
      db.server_updates,
      db.server_assignees,
      db.server_attachments,
      db.server_materials,
      db.server_notifications,
      db.server_reports,
      db.server_profiles,
      db.server_locations,
      db.server_categories,
      db.server_photos,
      db.photos,
      db.meta,
      db.server_audit,
    ],
    async () => {
      for (const wo of t.workOrders) await db.server_workOrders.put(wo);
      for (const u of t.updates) await db.server_updates.put(u);
      if (t.assignees.length > 0 || entry.payload.kind === 'ASSIGN') {
        // przełóż komplet przydziałów dla zadania z przebudowanego stanu
        const woIds = new Set(t.assignees.map((a) => a.work_order_id));
        if (entry.payload.kind === 'ASSIGN') woIds.add(entry.payload.payload.id);
        for (const woId of woIds) {
          await db.server_assignees.where('work_order_id').equals(woId).delete();
          const rows = outcome.changed.assignees.filter((a) => a.work_order_id === woId);
          if (rows.length) await db.server_assignees.bulkAdd(rows);
        }
      }
      for (const a of t.attachments) await db.server_attachments.put(a);
      for (const m of t.materials) await db.server_materials.put(m);
      for (const n of t.notifications) await db.server_notifications.put(n);
      for (const r of t.reports) await db.server_reports.put(r);
      for (const p of t.profiles) await db.server_profiles.put(p);
      for (const l of t.locations) await db.server_locations.put(l);
      for (const c of t.categories) await db.server_categories.put(c);
      for (const a of t.audit) {
        await db.server_audit.add({ ...a, created_at: ctx.now });
      }
      // zdjęcia: przekopiuj bloby z lokalu (photos) do „storage” serwera (server_photos)
      if (entry.payload.kind === 'SAVE_PHOTO' || entry.payload.kind === 'CREATE_WORK_ORDER' || entry.payload.kind === 'CREATE_UNREQUESTED_WORK') {
        const photoIds =
          entry.payload.kind === 'SAVE_PHOTO'
            ? [entry.payload.payload.photoId]
            : entry.payload.payload.photoIds;
        for (const pid of photoIds) {
          const local = await db.photos.get(pid);
          if (local) await db.server_photos.put({ ...local, synced: true });
        }
      }
      await db.meta.put({ key: 'nextNumber', value: outcome.changed.nextNumber });
    }
  );
  emitDataChanged('demo-server');
}

/** Podgląd „bazy” dla testów i narzędzi deweloperskich. */
export async function demoSnapshot(): Promise<Snapshot> {
  const w = await loadWorld();
  return {
    workOrders: w.workOrders,
    updates: w.updates,
    assignees: w.assignees,
    attachments: w.attachments,
    materials: w.materials,
    notifications: w.notifications,
    reports: w.reports,
    profiles: w.profiles,
    locations: w.locations,
    categories: w.categories,
  };
}

export async function demoGetReport(date: string): Promise<ReportRow | undefined> {
  const db = getDb();
  return db.server_reports.where('report_date').equals(date).first();
}

export function demoAssert(cond: boolean, message: string): void {
  if (!cond) throw new ValidationError(message);
}
