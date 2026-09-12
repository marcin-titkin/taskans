import type {
  AssigneeRow,
  ReportRow,
} from '@/data/db';
import type {
  Attachment,
  Category,
  Location,
  MaterialRequest,
  Notification,
  OutboxEntry,
  OutboxOp,
  Profile,
  WorkOrder,
  WorkOrderStatus,
  WorkOrderUpdate,
} from '@/types/domain';

/** Środowisko wykonania operacji (kto i kiedy). Id jest always auth.uid() po stronie serwera. */
export interface ActorContext {
  id: string;
  displayName: string;
  role: Profile['role'];
}

/* ── Typy błędów sterujące kolejką synchronizacji ─────────────────────── */

export class PermissionError extends Error {
  readonly kind = 'permission' as const;
  constructor(message: string) {
    super(message);
    this.name = 'PermissionError';
  }
}

export class ValidationError extends Error {
  readonly kind = 'validation' as const;
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

export class ConflictError extends Error {
  readonly kind = 'conflict' as const;
  constructor(message: string) {
    super(message);
    this.name = 'ConflictError';
  }
}

export class NetworkError extends Error {
  readonly kind = 'network' as const;
  constructor(message = 'Brak połączenia z serwerem.') {
    super(message);
    this.name = 'NetworkError';
  }
}

export type ApplyErrorKind = 'permission' | 'validation' | 'conflict' | 'network' | 'server';

export function errorKind(e: unknown): ApplyErrorKind {
  if (e instanceof PermissionError) return 'permission';
  if (e instanceof ValidationError) return 'validation';
  if (e instanceof ConflictError) return 'conflict';
  if (e instanceof NetworkError) return 'network';
  return 'server';
}

export function friendlyErrorMessage(e: unknown): string {
  if (e instanceof PermissionError) return 'Nie masz uprawnień do tej operacji.';
  if (e instanceof ValidationError) return e.message;
  if (e instanceof ConflictError) return e.message;
  if (e instanceof NetworkError) return 'Brak połączenia — zmiana zapisana lokalnie w kolejce.';
  return e instanceof Error && e.message ? `Błąd serwera: ${e.message}` : 'Nieznany błąd serwera.';
}

/* ── Stan świata dla reduktora (używany przez serwer demo i cache) ────── */

export interface WorldState {
  workOrders: WorkOrder[];
  updates: WorkOrderUpdate[];
  assignees: AssigneeRow[];
  attachments: Attachment[];
  materials: MaterialRequest[];
  notifications: Notification[];
  reports: ReportRow[];
  profiles: Profile[];
  locations: Location[];
  categories: Category[];
  nextNumber: number;
}

export interface AuditEvent {
  entity_type: 'work_order' | 'daily_report' | 'profile' | 'material_request';
  entity_id: string;
  action: string;
  actor_id: string | null;
  metadata: Record<string, unknown>;
}

export interface ApplyOutcome {
  /** Zmienione rekordy do zapisu (po stronie serwera demo / cache). */
  changed: WorldState;
  /** Tylko nowe/zmienione wiersze (do wydajnego persystowania). */
  touched: {
    workOrders: WorkOrder[];
    updates: WorkOrderUpdate[];
    assignees: AssigneeRow[];
    attachments: Attachment[];
    materials: MaterialRequest[];
    notifications: Notification[];
    reports: ReportRow[];
    audit: AuditEvent[];
    profiles: Profile[];
    locations: Location[];
    categories: Category[];
  };
}

/* ── Interfejs bramki ─────────────────────────────────────────────────── */

export interface Snapshot {
  workOrders: WorkOrder[];
  updates: WorkOrderUpdate[];
  assignees: AssigneeRow[];
  attachments: Attachment[];
  materials: MaterialRequest[];
  notifications: Notification[];
  reports: ReportRow[];
  profiles: Profile[];
  locations: Location[];
  categories: Category[];
}

export interface PendingOp {
  entry: OutboxEntry;
  op: OutboxOp;
}

export interface Gateway {
  readonly mode: 'demo' | 'supabase';
  /** Czy bramka wymaga sieci (demo działa „lokalnie”, ale symuluje wysyłkę). */
  fetchSnapshot(actor: ActorContext): Promise<Snapshot>;
  /** Wykonuje pojedynczą operację z kolejki. Idempotentność po opId. Błędy typowane. */
  applyOp(actor: ActorContext, entry: OutboxEntry): Promise<void>;
  /** Adres zdjęcia (demo: object URL, supabase: signed URL). */
  attachmentUrl(att: Attachment): Promise<string | null>;
  /** Realtime (supabase) — demo używa własnego emitu. */
  subscribeRealtime?(onChanged: () => void): () => void;
}

/** Pomocnicze typy dla implementacji. */
export interface StatusRow { id: string; status: WorkOrderStatus }
