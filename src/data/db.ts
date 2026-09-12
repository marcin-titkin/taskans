import Dexie, { type EntityTable, type Table } from 'dexie';
import type {
  Attachment,
  Category,
  DailyReportRecord,
  Location,
  MaterialRequest,
  Notification,
  OutboxEntry,
  Profile,
  WorkOrder,
  WorkOrderUpdate,
} from '@/types/domain';

/** Wiersz cache'u — identyczny kształt jak rekord serwera + znacznik brudnopisu. */
export interface CachedWorkOrder extends WorkOrder {
  /** true, gdy lokalna optimistic zmiana czeka na potwierdzenie z serwera. */
  dirty?: boolean;
}

export interface LocalPhoto {
  id: string;
  workOrderId: string | null;
  blob: Blob;
  fileName: string;
  mimeType: string;
  size: number;
  createdAt: string;
  /** Zdjęcie potwierdzone po stronie serwera (nie usuwać przed tym!). */
  synced: boolean;
}

export interface AssigneeRow {
  id: string;
  work_order_id: string;
  user_id: string;
  assignment_type: 'LEAD' | 'HELPER';
}

export interface ReportRow {
  id: string;
  report_date: string;
  status: 'DRAFT' | 'APPROVED';
  general_note: string | null;
  generated_by: string;
  approved_by: string | null;
  generated_at: string;
  approved_at: string | null;
  snapshot_json: DailyReportRecord['snapshot'];
}

const stores = {
  profiles: 'id',
  locations: 'id',
  categories: 'id',
  workOrders: 'id, status, priority, lead_worker_id, location_id, updated_at, created_at',
  updates: 'id, work_order_id, created_at, device_operation_id',
  assignees: 'id, work_order_id, user_id',
  attachments: 'id, work_order_id',
  materials: 'id, work_order_id',
  notifications: 'id, recipient_id, read_at',
  reports: 'id, report_date',
  photos: 'id, workOrderId, [workOrderId+synced]',
  outbox: '++seq, opId, status, workOrderId',

  // „Serwer” trybu demo (IndexedDB odzwierciedla schemat PostgreSQL wraz z ograniczeniami).
  server_profiles: 'id',
  server_locations: 'id',
  server_categories: 'id',
  server_workOrders: 'id, status, priority, lead_worker_id, created_at, updated_at',
  server_updates: 'id, work_order_id, created_at, device_operation_id',
  server_assignees: 'id, work_order_id, user_id',
  server_attachments: 'id, work_order_id',
  server_materials: 'id, work_order_id',
  server_notifications: 'id, recipient_id',
  server_reports: 'id, report_date',
  server_photos: 'id',
  server_audit: '++id, created_at',
  meta: 'key',
};

export type StoreName = keyof typeof stores;

export class TaskansDatabase extends Dexie {
  declare profiles: EntityTable<Profile, 'id'>;
  declare locations: EntityTable<Location, 'id'>;
  declare categories: EntityTable<Category, 'id'>;
  declare workOrders: EntityTable<CachedWorkOrder, 'id'>;
  declare updates: Table<WorkOrderUpdate, string>;
  declare assignees: Table<AssigneeRow, string>;
  declare attachments: Table<Attachment, string>;
  declare materials: Table<MaterialRequest, string>;
  declare notifications: Table<Notification, string>;
  declare reports: Table<ReportRow, string>;
  declare photos: Table<LocalPhoto, string>;
  declare outbox: Table<OutboxEntry, number>;

  declare server_profiles: Table<Profile, string>;
  declare server_locations: Table<Location, string>;
  declare server_categories: Table<Category, string>;
  declare server_workOrders: Table<WorkOrder, string>;
  declare server_updates: Table<WorkOrderUpdate, string>;
  declare server_assignees: Table<AssigneeRow, string>;
  declare server_attachments: Table<Attachment, string>;
  declare server_materials: Table<MaterialRequest, string>;
  declare server_notifications: Table<Notification, string>;
  declare server_reports: Table<ReportRow, string>;
  declare server_photos: Table<LocalPhoto, string>;
  declare server_audit: Table<{ id?: number; entity_type: string; entity_id: string; action: string; actor_id: string | null; metadata: Record<string, unknown>; created_at: string }, number>;
  declare meta: Table<{ key: string; value: unknown }, string>;

  constructor(name = 'taskans-v1') {
    super(name);
    this.version(1).stores(stores);
  }
}

let instance: TaskansDatabase | null = null;

/** Jedna współdzielona instancja w aplikacji (testy tworzą własne). */
export function getDb(): TaskansDatabase {
  instance ??= new TaskansDatabase();
  return instance;
}

export function resetDbForTests(name: string): TaskansDatabase {
  instance = new TaskansDatabase(name);
  return instance;
}
