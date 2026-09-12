/**
 * Taskans — typy domenowe.
 * Odzwierciedlają schemat PostgreSQL (supabase/migrations). Zmiana tutaj wymaga zmiany w migracjach.
 */

export type UserRole = 'ADMIN' | 'COORDINATOR' | 'WORKER';

/** AWARIA = ryzyko dla ludzi/mienia/obiektu, PILNE = utrudnia zajęcia lub ważne wydarzenie, ZWYKŁE = kolejka. */
export type Priority = 'BREAKDOWN' | 'URGENT' | 'NORMAL';

export type WorkOrderStatus =
  | 'NEW'
  | 'ASSIGNED'
  | 'IN_PROGRESS'
  | 'ON_HOLD'
  | 'DONE'
  | 'CLOSED'
  | 'REOPENED';

export type UpdateType = 'STATUS' | 'COMMENT' | 'NOTE';
export type AssignmentType = 'LEAD' | 'HELPER';
export type MaterialStatus = 'REQUESTED' | 'APPROVED' | 'BOUGHT';
export type ReportStatus = 'DRAFT' | 'APPROVED';

export type NotificationKind =
  | 'ASSIGNED'
  | 'PRIORITY_ESCALATED'
  | 'HOLD_RAISED'
  | 'HOLD_REPLY'
  | 'REOPENED';

export interface Profile {
  id: string;
  display_name: string;
  role: UserRole;
  active: boolean;
}

export interface Location {
  id: string;
  name: string;
  building: string | null;
  floor: string | null;
  room: string | null;
  active: boolean;
}

export interface Category {
  id: string;
  name: string;
  icon: string | null;
  color: string | null;
  active: boolean;
}

export interface WorkOrder {
  id: string;
  sequential_number: number;
  title: string;
  description: string;
  category_id: string | null;
  location_id: string | null;
  priority: Priority;
  status: WorkOrderStatus;
  requester_id: string;
  lead_worker_id: string | null;
  contact_person: string | null;
  access_notes: string | null;
  expected_date: string | null; // ISO yyyy-mm-dd
  hold_reason: string | null;
  hold_details: string | null;
  next_action: string | null;
  hold_waiting_on: string | null;
  completion_summary: string | null;
  is_unrequested: boolean;
  created_at: string; // ISO timestamp
  updated_at: string;
  started_at: string | null;
  completed_at: string | null;
  closed_at: string | null;
  reopened_at: string | null;
}

export interface Assignee {
  id: string;
  work_order_id: string;
  user_id: string;
  assignment_type: AssignmentType;
}

export interface WorkOrderUpdate {
  id: string;
  work_order_id: string;
  update_type: UpdateType;
  previous_status: WorkOrderStatus | null;
  new_status: WorkOrderStatus | null;
  message: string | null;
  next_action: string | null;
  /** Kto faktycznie wykonał pracę. */
  performed_by: string | null;
  /** Kto wprowadził wpis do systemu (przy wspólnym komputerze może być inną osobą). */
  entered_by: string;
  created_at: string;
  client_created_at: string | null;
  device_operation_id: string | null;
}

export interface Attachment {
  id: string;
  work_order_id: string;
  update_id: string | null;
  /** Ścieżka w prywatnym bucketcie Supabase Storage (demo: identyfikator bloba). */
  storage_path: string;
  file_name: string;
  mime_type: string;
  size: number;
  uploaded_by: string;
  created_at: string;
}

export interface MaterialRequest {
  id: string;
  work_order_id: string;
  name: string;
  quantity: number;
  unit: string;
  status: MaterialStatus;
  note: string | null;
  created_by: string;
  created_at: string;
}

export interface Notification {
  id: string;
  recipient_id: string;
  work_order_id: string | null;
  kind: NotificationKind;
  message: string;
  read_at: string | null;
  created_at: string;
}

export interface DailyReportEntry {
  work_order_id: string;
  sequential_number: number;
  title: string;
  location: string | null;
  summary: string;
  workers: string[];
  hold_reason: string | null;
  next_action: string | null;
}

export interface DailyReportSections {
  completed: DailyReportEntry[];
  inProgress: DailyReportEntry[];
  onHold: DailyReportEntry[];
  newUrgent: DailyReportEntry[];
  materials: { name: string; quantity: number; unit: string; note: string | null; workOrderTitle: string }[];
  handover: DailyReportEntry[];
  unrequested: DailyReportEntry[];
}

export interface DailyReportSnapshot {
  report_date: string; // yyyy-MM-dd
  generated_at: string;
  generated_by_name: string;
  sections: DailyReportSections;
  counters: {
    completed: number;
    inProgress: number;
    onHold: number;
    newUrgent: number;
    unrequested: number;
  };
}

export interface DailyReportRecord {
  id: string;
  report_date: string;
  status: ReportStatus;
  general_note: string | null;
  generated_by: string;
  approved_by: string | null;
  generated_at: string;
  approved_at: string | null;
  snapshot: DailyReportSnapshot;
}

/** Zadanie z doklejonymi danymi — to, co czyta UI (cache lokalny). */
export interface WorkOrderDetail {
  workOrder: WorkOrder;
  assignees: (Assignee & { user: Profile | null })[];
  updates: WorkOrderUpdate[];
  attachments: (Attachment & { url?: string })[];
  materials: MaterialRequest[];
}

/* ── Kolejka synchronizacji (outbox) ──────────────────────────────────── */

export type OutboxOpKind =
  | 'CREATE_WORK_ORDER'
  | 'CREATE_UNREQUESTED_WORK'
  | 'UPDATE_FIELDS'
  | 'ASSIGN'
  | 'TRANSITION'
  | 'ADD_COMMENT'
  | 'LOG_UPDATE'
  | 'ADD_MATERIAL'
  | 'SAVE_PHOTO'
  | 'SAVE_REPORT_DRAFT'
  | 'APPROVE_REPORT'
  | 'UPSERT_LOCATION'
  | 'UPSERT_CATEGORY'
  | 'UPSERT_PROFILE';

export type OutboxOp =
  | { kind: 'CREATE_WORK_ORDER'; payload: NewWorkOrderInput }
  | { kind: 'CREATE_UNREQUESTED_WORK'; payload: UnrequestedWorkInput }
  | { kind: 'UPDATE_FIELDS'; payload: { id: string; fields: Partial<NewWorkOrderInput> } }
  | { kind: 'ASSIGN'; payload: { id: string; leadWorkerId: string | null; helperIds: string[] } }
  | {
      kind: 'TRANSITION';
      payload: {
        id: string;
        newStatus: WorkOrderStatus;
        message?: string | null;
        holdReason?: string | null;
        holdDetails?: string | null;
        nextAction?: string | null;
        holdWaitingOn?: string | null;
        completionSummary?: string | null;
        performedBy?: string | null;
        /** Oczekiwany status bazowy — konflikt, gdy serwer jest już gdzie indziej. */
        expectedPrevious: WorkOrderStatus;
      };
    }
  | {
      kind: 'LOG_UPDATE';
      payload: {
        id: string;
        updateType: UpdateType;
        message: string;
        nextAction?: string | null;
        performedBy?: string | null;
      };
    }
  | { kind: 'ADD_MATERIAL'; payload: { id: string; name: string; quantity: number; unit: string; note?: string | null } }
  | { kind: 'SAVE_PHOTO'; payload: { id: string; photoId: string; updateId?: string | null; fileName: string } }
  | { kind: 'SAVE_REPORT_DRAFT'; payload: { date: string; snapshot: DailyReportSnapshot; generalNote: string | null } }
  | { kind: 'APPROVE_REPORT'; payload: { date: string; generalNote: string | null; snapshot: DailyReportSnapshot } }
  | {
      kind: 'UPSERT_LOCATION' | 'UPSERT_CATEGORY' | 'UPSERT_PROFILE';
      payload: { id?: string; data: Record<string, string | number | boolean | null> };
    };

export interface NewWorkOrderInput {
  /** UUID generowany po stronie klienta — ten sam w cache i na serwerze (essential dla trybu offline). */
  id: string;
  title: string;
  description: string;
  locationId: string;
  categoryId: string | null;
  priority: Priority;
  requesterId: string;
  contactPerson: string | null;
  accessNotes: string | null;
  expectedDate: string | null;
  leadWorkerId: string | null;
  helperIds: string[];
  /** Zdjęcia trzymane lokalnie (IndexedDB), wysyłane razem z utworem. */
  photoIds: string[];
}

export interface UnrequestedWorkInput {
  /** j.w. — uuid klienta. */
  id: string;
  title: string;
  description: string;
  locationId: string;
  categoryId: string | null;
  performedByIds: string[];
  completionSummary: string;
  photoIds: string[];
  /** Kto wpisał pracę do systemu (wykonawca lub np. kierownik przy wspólnym komputerze). */
  enteredById: string;
}

export interface OutboxEntry {
  seq?: number;
  opId: string;
  kind: OutboxOpKind;
  workOrderId: string | null;
  payload: OutboxOp;
  status: 'PENDING' | 'SYNCED' | 'CONFLICT' | 'ERROR';
  attempts: number;
  lastError: string | null;
  conflictInfo: string | null;
  createdAt: string;
  syncedAt: string | null;
  /** Zrzut intencji dla ekranu konfliktów (bez danych wrażliwych spoza zadań). */
  label: string;
}
