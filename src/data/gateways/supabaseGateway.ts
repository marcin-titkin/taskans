import { createClient, type PostgrestError } from '@supabase/supabase-js';
import { getDb } from '@/data/db';
import {
  ConflictError,
  NetworkError,
  PermissionError,
  ValidationError,
  type ActorContext,
  type Gateway,
  type Snapshot,
} from '@/data/gateway';
import type { Attachment, OutboxEntry } from '@/types/domain';
import type { ReportRow } from '@/data/db';

/**
 * Bramka produkcyjna: Supabase (PostgREST + RPC + Storage + Realtime).
 * Uwaga: rola NIGDY nie jest pobierana z formularza — polityki RLS i funkcje SQL
 * pobierają ją z profilu powiązanego z tokenem (auth.uid()).
 */
export class SupabaseGateway implements Gateway {
  readonly mode = 'supabase' as const;
  private client: SupaClient;

  constructor(url: string, anonKey: string) {
    this.client = createSupaClientInternal(url, anonKey);
  }

  getClient(): SupaClient {
    return this.client;
  }

  async fetchSnapshot(_actor: ActorContext): Promise<Snapshot> {
    const supa = this.client;
    const [wo, upd, att, mat, notif, rep, prof, loc, cat, assigns] = await Promise.all([
      supa.from('work_orders').select('*'),
      supa.from('work_order_updates').select('*').order('created_at'),
      supa.from('attachments').select('*'),
      supa.from('material_requests').select('*'),
      supa.from('notifications').select('*').order('created_at', { ascending: false }).limit(200),
      supa.from('daily_reports').select('*'),
      supa.from('profiles').select('id, display_name, role, active'),
      supa.from('locations').select('*'),
      supa.from('categories').select('*'),
      supa.from('work_order_assignees').select('*'),
    ]);
    for (const r of [wo, upd, att, mat, notif, rep, prof, loc, cat, assigns]) this.mapErr(r.error);
    const workOrders = rows<Snapshot['workOrders']>(wo);
    const updates = rows<Snapshot['updates']>(upd);
    const assignees = rows<Snapshot['assignees']>(assigns);
    const attachments = rows<Snapshot['attachments']>(att);
    const materials = rows<Snapshot['materials']>(mat);
    const notifications = rows<Snapshot['notifications']>(notif);
    const profiles = rows<Snapshot['profiles']>(prof);
    const locations = rows<Snapshot['locations']>(loc);
    const categories = rows<Snapshot['categories']>(cat);
    return {
      workOrders,
      updates,
      assignees,
      attachments,
      materials,
      notifications,
      reports: rows<Record<string, unknown>[]>(rep).map(mapReport),
      profiles,
      locations,
      categories,
    };
  }

  async applyOp(actor: ActorContext, entry: OutboxEntry): Promise<void> {
    const op = entry.payload;
    const supa = this.client;
    switch (op.kind) {
      case 'CREATE_WORK_ORDER': {
        const p = op.payload;
        const { error } = await supa.rpc('create_work_order', {
          p_id: p.id,
          p_title: p.title,
          p_description: p.description,
          p_location_id: p.locationId,
          p_category_id: p.categoryId,
          p_priority: p.priority,
          p_contact_person: p.contactPerson,
          p_access_notes: p.accessNotes,
          p_expected_date: p.expectedDate,
          p_lead_worker_id: p.leadWorkerId,
          p_helper_ids: p.helperIds,
          p_op_id: entry.opId,
        });
        this.mapErr(error, entry.opId);
        await this.uploadPendingPhotos(actor, p.id, p.photoIds);
        break;
      }
      case 'CREATE_UNREQUESTED_WORK': {
        const p = op.payload;
        const { error } = await supa.rpc('create_unrequested_work', {
          p_id: p.id,
          p_title: p.title,
          p_description: p.description,
          p_location_id: p.locationId,
          p_category_id: p.categoryId,
          p_performed_by: p.performedByIds,
          p_completion_summary: p.completionSummary,
          p_op_id: entry.opId,
        });
        this.mapErr(error, entry.opId);
        await this.uploadPendingPhotos(actor, p.id, p.photoIds);
        break;
      }
      case 'UPDATE_FIELDS': {
        const p = op.payload;
        const { error } = await supa.rpc('update_work_order_fields', {
          p_id: p.id,
          p_title: p.fields.title,
          p_description: p.fields.description,
          p_location_id: p.fields.locationId,
          p_category_id: p.fields.categoryId,
          p_priority: p.fields.priority,
          p_expected_date: p.fields.expectedDate,
          p_contact_person: p.fields.contactPerson,
          p_access_notes: p.fields.accessNotes,
        });
        this.mapErr(error, entry.opId);
        break;
      }
      case 'ASSIGN': {
        const p = op.payload;
        const { error } = await supa.rpc('assign_work_order', {
          p_id: p.id,
          p_lead: p.leadWorkerId,
          p_helpers: p.helperIds,
          p_op_id: entry.opId,
        });
        this.mapErr(error, entry.opId);
        break;
      }
      case 'TRANSITION': {
        const p = op.payload;
        const { error } = await supa.rpc('transition_work_order', {
          p_work_order_id: p.id,
          p_new_status: p.newStatus,
          p_message: p.message ?? null,
          p_hold_reason: p.holdReason ?? null,
          p_hold_details: p.holdDetails ?? null,
          p_next_action: p.nextAction ?? null,
          p_hold_waiting_on: p.holdWaitingOn ?? null,
          p_completion_summary: p.completionSummary ?? null,
          p_performed_by: p.performedBy ?? null,
          p_expected_previous: p.expectedPrevious,
          p_device_operation_id: entry.opId,
        });
        this.mapErr(error, entry.opId);
        break;
      }
      case 'LOG_UPDATE': {
        const p = op.payload;
        const { error } = await supa.rpc('log_work_order_update', {
          p_id: p.id,
          p_update_type: p.updateType,
          p_message: p.message,
          p_next_action: p.nextAction ?? null,
          p_performed_by: p.performedBy ?? null,
          p_op_id: entry.opId,
        });
        this.mapErr(error, entry.opId);
        break;
      }
      case 'ADD_MATERIAL': {
        const p = op.payload;
        const { error } = await supa.rpc('add_material_request', {
          p_id: p.id,
          p_name: p.name,
          p_quantity: p.quantity,
          p_unit: p.unit,
          p_note: p.note ?? null,
        });
        this.mapErr(error, entry.opId);
        break;
      }
      case 'SAVE_PHOTO': {
        const p = op.payload;
        await this.uploadPhoto(p.id, p.photoId, entry.opId);
        break;
      }
      case 'SAVE_REPORT_DRAFT': {
        const p = op.payload;
        const { error } = await supa.rpc('save_report_draft', {
          p_date: p.date,
          p_snapshot: p.snapshot,
          p_note: p.generalNote,
        });
        this.mapErr(error, entry.opId);
        break;
      }
      case 'APPROVE_REPORT': {
        const p = op.payload;
        const { error } = await supa.rpc('approve_report', {
          p_date: p.date,
          p_note: p.generalNote,
          p_snapshot: p.snapshot,
        });
        this.mapErr(error, entry.opId);
        break;
      }
      case 'UPSERT_PROFILE': {
        const p = op.payload;
        const { error } = await supa.from('profiles').upsert({
          id: p.id ?? p.data.id,
          ...p.data,
        });
        this.mapErr(error, entry.opId);
        break;
      }
      case 'UPSERT_LOCATION': {
        const p = op.payload;
        const { error } = await supa.from('locations').upsert({ id: p.id, ...p.data });
        this.mapErr(error, entry.opId);
        break;
      }
      case 'UPSERT_CATEGORY': {
        const p = op.payload;
        const { error } = await supa.from('categories').upsert({ id: p.id, ...p.data });
        this.mapErr(error, entry.opId);
        break;
      }
      default: {
        const never: never = op;
        throw new Error(`Nieznana operacja kolejki: ${JSON.stringify(never)}`);
      }
    }
  }

  /** Upload skompresowanego zdjęcia z IndexedDB do prywatnego bucketu i wiersz załącznika. */
  private async uploadPhoto(workOrderId: string, photoId: string, opId: string): Promise<void> {
    const db = getDb();
    const local = await db.photos.get(photoId);
    if (!local) throw new ValidationError('Zdjęcie nie znajduje się już w pamięci lokalnej.');
    const path = `wo/${workOrderId}/${photoId}.jpg`;
    const { error: upErr } = await this.client.storage.from('attachments').upload(path, local.blob, {
      contentType: 'image/jpeg',
      upsert: true,
    });
    if (upErr) {
      if (/failed to fetch|networkerror|fetch failed/i.test(upErr.message)) throw new NetworkError();
      throw new ValidationError(`Nie udało się wgrać zdjęcia: ${upErr.message}`);
    }
    const { error } = await this.client.from('attachments').upsert({
      id: photoId,
      work_order_id: workOrderId,
      update_id: null,
      storage_path: path,
      file_name: local.fileName,
      mime_type: 'image/jpeg',
      size: local.size,
    });
    // uploaded_by uzupełnia domyślna wartość kolumny (auth.uid()) — nie ufamy klientowi
    if (error && error.code !== '23505') this.mapErr(error, opId);
  }

  private async uploadPendingPhotos(_actor: ActorContext, workOrderId: string, photoIds: string[]): Promise<void> {
    for (const pid of photoIds) {
      const db = getDb();
      const local = await db.photos.get(pid);
      if (!local || local.synced) continue;
      const path = `wo/${workOrderId}/${pid}.jpg`;
      const { error: upErr } = await this.client.storage.from('attachments').upload(path, local.blob, {
        contentType: 'image/jpeg',
        upsert: true,
      });
      if (upErr) {
        if (/failed to fetch|networkerror|fetch failed/i.test(upErr.message)) throw new NetworkError();
        throw new ValidationError(`Nie udało się wgrać zdjęcia: ${upErr.message}`);
      }
      const { error } = await this.client
        .from('attachments')
        .upsert(
          {
            id: pid,
            work_order_id: workOrderId,
            update_id: null,
            storage_path: path,
            file_name: local.fileName,
            mime_type: 'image/jpeg',
            size: local.size,
          },
          { onConflict: 'id' }
        );
      if (error && error.code !== '23505') this.mapErr(error, null);
      await db.photos.put({ ...local, synced: true });
    }
  }

  async attachmentUrl(att: Attachment): Promise<string | null> {
    try {
      const { data } = await this.client.storage.from('attachments').createSignedUrl(att.storage_path, 120);
      return data?.signedUrl ?? null;
    } catch {
      return null;
    }
  }

  subscribeRealtime(onChanged: () => void): () => void {
    const channel = this.client
      .channel('taskans-db')
      .on('postgres_changes', { event: '*', schema: 'public' }, () => onChanged())
      .subscribe();
    return () => {
      void this.client.removeChannel(channel);
    };
  }

  /** Mapowanie błędów PostgREST na błędy domenowe kolejki. */
  mapErr(error: PostgrestError | null | Error | undefined, _opId?: string | null): void {
    if (!error) return;
    const pg = error as PostgrestError;
    if (pg.code === '42501' || /row-level security/i.test(pg.message ?? '')) throw new PermissionError(pg.message);
    if (pg.code === '23505' && /device_operation_id|created_offline_id/.test(pg.message ?? '')) return; // idempotentnie: już zastosowane
    if (pg.code === 'P0001') {
      const msg = pg.message ?? '';
      if (/uprawnien|permissions|policy/i.test(msg)) throw new PermissionError(msg);
      if (/konflikt|conflict|status/i.test(msg) && /inny|changed/i.test(msg)) throw new ConflictError(msg);
      throw new ValidationError(msg);
    }
    if (/fetch failed|Failed to fetch|NetworkError/i.test(pg.message ?? '')) throw new NetworkError();
    throw new Error(pg.message ?? String(error));
  }
}

type SupaClient = ReturnType<typeof createSupaClientInternal>;

/** Klient surowy; rzędy zawężamy jednym punktem (`rows<T>`), bo PostgREST nie niesie typów. */
function createSupaClientInternal(url: string, anonKey: string) {
  return createClient(url, anonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });
}

/** Jedyne miejsce rzutowania wierszy API na typy domenowe (walidacja właściwa jest w bazie: RLS + CHECK). */
function rows<T>(res: { data: unknown; error: PostgrestError | null }): T {
  if (res.error) throw new Error(res.error.message);
  return (res.data ?? []) as T;
}

function mapReport(r: Record<string, unknown>): ReportRow {
  return {
    id: String(r.id),
    report_date: String(r.report_date),
    status: r.status === 'APPROVED' ? 'APPROVED' : 'DRAFT',
    general_note: (r.general_note as string | null) ?? null,
    generated_by: String(r.generated_by),
    approved_by: (r.approved_by as string | null) ?? null,
    generated_at: String(r.generated_at),
    approved_at: (r.approved_at as string | null) ?? null,
    snapshot_json: r.snapshot_json as ReportRow['snapshot_json'],
  };
}
