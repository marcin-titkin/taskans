import { getDb } from '@/data/db';
import { upsertSnapshot, optimisticApply, saveLocalPhoto } from '@/data/cache';
import { compressImage as compressForUpload, validateImageFile as validateForUpload } from '@/lib/compress';
import { errorKind, NetworkError, type ActorContext, type Gateway } from '@/data/gateway';
import { resolveAppMode, supabaseConfig } from '@/lib/env';
import { DemoGateway } from '@/data/gateways/demoGateway';
import { SupabaseGateway } from '@/data/gateways/supabaseGateway';
import { newId } from '@/lib/id';
import { compressImage, validateImageFile } from '@/lib/compress';
import type {
  DailyReportSnapshot,
  Location,
  NewWorkOrderInput,
  OutboxOp,
  UnrequestedWorkInput,
  WorkOrderStatus,
} from '@/types/domain';
import { SyncManager } from '@/data/outbox';
import { setDemoFlag } from '@/data/demoServer';
import type { Priority } from '@/types/domain';

/* ── singleton bramki/synchronizacji ──────────────────────────────────── */

let gateway: Gateway | null = null;
let sync: SyncManager | null = null;
let currentActor: ActorContext | null = null;

export function setActorForSync(actor: ActorContext | null): void {
  currentActor = actor;
}

export function getSyncManager(): SyncManager {
  sync ??= new SyncManager(getGateway(), () => currentActor);
  return sync;
}

export function getGateway(): Gateway {
  if (gateway) return gateway;
  const mode = resolveAppMode();
  if (mode === 'supabase') {
    const cfg = supabaseConfig();
    if (!cfg) throw new Error('Brak konfiguracji Supabase');
    gateway = new SupabaseGateway(cfg.url, cfg.anonKey);
  } else {
    gateway = new DemoGateway();
  }
  return gateway;
}

export function appMode(): 'demo' | 'supabase' {
  return getGateway().mode;
}

export function supabaseClientOrNull(): SupabaseGateway | null {
  const g = getGateway();
  return g.mode === 'supabase' ? (g as SupabaseGateway) : null;
}

/* ── kolejkowanie operacji ─────────────────────────────────────────────── */

export async function enqueueOp(op: OutboxOp, opts: { workOrderId: string | null; label: string }): Promise<number> {
  const entry = {
    opId: newId(),
    kind: op.kind,
    workOrderId: opts.workOrderId,
    payload: op,
    status: 'PENDING' as const,
    attempts: 0,
    lastError: null,
    conflictInfo: null,
    createdAt: new Date().toISOString(),
    syncedAt: null,
    label: opts.label,
  };
  if (currentActor) {
    // zapis optymistyczny do cache (UI natychmiastowe, działa offline)
    await optimisticApply(entry, currentActor);
  }
  return getSyncManager().enqueue(entry);
}

/* ── API Mutacji (używane przez UI) ───────────────────────────────────── */

export const mutations = {
  /**
   * Zdjęcia do nowego zlecenia (jeszcze bez UUID zadania): kompresja + zapis lokalny.
   * Zwraca photoId do umieszczenia w formularzu; blob zostaje w IndexedDB do potwierdzenia z serwera.
   */
  async preparePhoto(file: File): Promise<{ ok: boolean; photoId?: string; size?: number; error?: string }> {
    const invalid = validateForUpload(file);
    if (invalid) return { ok: false, error: invalid };
    const compressed = await compressForUpload(file);
    const photo = await saveLocalPhoto(null, compressed.blob, compressed.fileName, compressed.mimeType);
    return { ok: true, photoId: photo.id, size: photo.size };
  },
  async createWorkOrder(input: Omit<NewWorkOrderInput, 'id'>): Promise<string> {
    const id = newId();
    await enqueueOp({ kind: 'CREATE_WORK_ORDER', payload: { ...input, id } }, { workOrderId: id, label: `Zlecenie: ${input.title}` });
    return id;
  },
  async addUnrequestedWork(input: Omit<UnrequestedWorkInput, 'id'>): Promise<string> {
    const id = newId();
    await enqueueOp({ kind: 'CREATE_UNREQUESTED_WORK', payload: { ...input, id } }, { workOrderId: id, label: `Praca bez zlecenia: ${input.title}` });
    return id;
  },
  async updateFields(id: string, fields: Partial<Pick<NewWorkOrderInput, 'title' | 'description' | 'locationId' | 'categoryId' | 'priority' | 'expectedDate' | 'contactPerson' | 'accessNotes'>>): Promise<void> {
    const wo = await getDb().workOrders.get(id);
    await enqueueOp({ kind: 'UPDATE_FIELDS', payload: { id, fields } }, { workOrderId: id, label: `Edycja: ${wo?.title ?? id}` });
  },
  async assign(id: string, leadWorkerId: string | null, helperIds: string[]): Promise<void> {
    const wo = await getDb().workOrders.get(id);
    await enqueueOp({ kind: 'ASSIGN', payload: { id, leadWorkerId, helperIds } }, { workOrderId: id, label: `Przydział: ${wo?.title ?? id}` });
  },
  async transition(
    id: string,
    newStatus: WorkOrderStatus,
    expectedPrevious: WorkOrderStatus,
    opts: {
      message?: string | null;
      holdReason?: string | null;
      holdDetails?: string | null;
      nextAction?: string | null;
      holdWaitingOn?: string | null;
      completionSummary?: string | null;
      performedBy?: string | null;
    }
  ): Promise<void> {
    const wo = await getDb().workOrders.get(id);
    await enqueueOp(
      { kind: 'TRANSITION', payload: { id, newStatus, expectedPrevious, ...opts } },
      { workOrderId: id, label: `Status → ${newStatus}: ${wo?.title ?? id}` }
    );
  },
  async logUpdate(
    id: string,
    updateType: 'COMMENT' | 'NOTE',
    message: string,
    opts: { nextAction?: string | null; performedBy?: string | null } = {}
  ): Promise<void> {
    const wo = await getDb().workOrders.get(id);
    await enqueueOp({ kind: 'LOG_UPDATE', payload: { id, updateType, message, ...opts } }, { workOrderId: id, label: `Wpis: ${wo?.title ?? id}` });
  },
  async addMaterial(id: string, name: string, quantity: number, unit: string, note: string | null): Promise<void> {
    const wo = await getDb().workOrders.get(id);
    await enqueueOp({ kind: 'ADD_MATERIAL', payload: { id, name, quantity, unit, note } }, { workOrderId: id, label: `Materiał: ${name} (${wo?.title ?? id})` });
  },
  async addPhoto(workOrderId: string, file: File): Promise<{ ok: boolean; photoId?: string; error?: string }> {
    const invalid = validateImageFile(file);
    if (invalid) return { ok: false, error: invalid };
    const compressed = await compressImage(file);
    const photo = await saveLocalPhoto(workOrderId, compressed.blob, compressed.fileName, compressed.mimeType);
    await enqueueOp(
      { kind: 'SAVE_PHOTO', payload: { id: workOrderId, photoId: photo.id, fileName: photo.fileName } },
      { workOrderId, label: `Zdjęcie: ${photo.fileName}` }
    );
    return { ok: true, photoId: photo.id };
  },
  async saveReportDraft(date: string, snapshot: DailyReportSnapshot, generalNote: string | null): Promise<void> {
    await enqueueOp({ kind: 'SAVE_REPORT_DRAFT', payload: { date, snapshot, generalNote } }, { workOrderId: null, label: `Raport roboczy ${date}` });
  },
  async approveReport(date: string, snapshot: DailyReportSnapshot, generalNote: string | null): Promise<void> {
    await enqueueOp({ kind: 'APPROVE_REPORT', payload: { date, snapshot, generalNote } }, { workOrderId: null, label: `Zatwierdzenie raportu ${date}` });
  },
  async upsertLocation(id: string | null, data: Partial<Location>): Promise<void> {
    await enqueueOp({ kind: 'UPSERT_LOCATION', payload: { id: id ?? newId(), data: data } }, { workOrderId: null, label: `Lokalizacja: ${data.name ?? ''}` });
  },
  async upsertCategory(id: string | null, data: { name: string; icon?: string | null; color?: string | null; active?: boolean }): Promise<void> {
    await enqueueOp({ kind: 'UPSERT_CATEGORY', payload: { id: id ?? newId(), data: data } }, { workOrderId: null, label: `Kategoria: ${data.name}` });
  },
  async upsertProfile(id: string, data: { display_name?: string; role?: string; active?: boolean }): Promise<void> {
    await enqueueOp({ kind: 'UPSERT_PROFILE', payload: { id, data: data } }, { workOrderId: null, label: `Użytkownik: ${id.slice(0, 8)}` });
  },
};

/* ── odświeżanie cache ────────────────────────────────────────────────── */

export async function refreshCache(): Promise<void> {
  if (!currentActor) return;
  try {
    const snap = await getGateway().fetchSnapshot(currentActor);
    await upsertSnapshot(snap);
  } catch (e) {
    if (e instanceof NetworkError || errorKind(e) === 'network') {
      // offline: korzystamy z cache'u — to oczekiwane zachowanie
      return;
    }
    throw e;
  }
}

export async function setOfflineMode(offline: boolean): Promise<void> {
  if (appMode() === 'demo') {
    await setDemoFlag({ networkDown: offline });
  }
  getSyncManager().setSimulatedNetworkDown(offline);
}

export async function changePriority(id: string, priority: Priority): Promise<void> {
  await mutations.updateFields(id, { priority });
}
