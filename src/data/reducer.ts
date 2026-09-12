import { can, isManager, type Action } from '@/lib/permissions';
import { canTransition, isEscalation, validateTransition } from '@/lib/transitions';
import { ConflictError, PermissionError, ValidationError, type ApplyOutcome, type AuditEvent, type ActorContext, type WorldState } from '@/data/gateway';
import type {
  AssigneeRow,
  CachedWorkOrder,
  ReportRow,
} from '@/data/db';
import type {
  Attachment,
  Category,
  DailyReportEntry,
  DailyReportSnapshot,
  Location,
  MaterialRequest,
  Notification,
  NotificationKind,
  OutboxEntry,
  Profile,
  WorkOrder,
  WorkOrderStatus,
  WorkOrderUpdate,
} from '@/types/domain';

/**
 * Czysty reduktor operacji kolejki (outbox). To samo źródło logiki dla:
 *  - „serwera” trybu demo,
 *  - lokalnego cache (optimistic apply),
 *  - testów jednostkowych.
 * Po stronie Supabase równoważną walidację wykonują funkcje SQL i polityki RLS
 * (supabase/migrations) — testy RLS porównują zachowanie obu światów dla kluczowych reguł.
 */

export interface ReducerCtx {
  now: string; // ISO
  newId: () => string;
}

interface TouchedAcc {
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
}

export function applyOp(state: WorldState, entry: OutboxEntry, actor: ActorContext, ctx: ReducerCtx): ApplyOutcome {
  const touched: TouchedAcc = emptyTouched();
  const next = cloneState(state);

  // Idempotentność: operacja o tym opId została już zastosowana → brak zmian (ponowna wysyłka kolejki).
  if (next.updates.some((u) => u.device_operation_id === entry.opId)) {
    return { changed: next, touched: emptyTouched() };
  }

  const op = entry.payload;
  switch (op.kind) {
    case 'CREATE_WORK_ORDER': {
      // Idempotentność tworzenia offline: ten sam kliencki uuid = ponowna wysyłka → bez zmian (jak ON CONFLICT na serwerze).
      if (next.workOrders.some((w) => w.id === op.payload.id)) {
        return { changed: state, touched: emptyTouched() };
      }
      const wo = createWorkOrder(next, actor, op.payload, ctx, touched, entry.opId);
      touched.workOrders.push(wo);
      // zdjęcia z formularza zgłoszenia — wiersze załączników (id = photoId, wspólne dla cache i serwera)
      for (const photoId of op.payload.photoIds) {
        const att: Attachment = {
          id: photoId,
          work_order_id: wo.id,
          update_id: null,
          storage_path: `wo/${wo.id}/${photoId}.jpg`,
          file_name: `photo-${photoId.slice(0, 8)}.jpg`,
          mime_type: 'image/jpeg',
          size: 0,
          uploaded_by: actor.id,
          created_at: ctx.now,
        };
        next.attachments.push(att);
        touched.attachments.push(att);
      }
      break;
    }
    case 'CREATE_UNREQUESTED_WORK': {
      if (next.workOrders.some((w) => w.id === op.payload.id)) {
        return { changed: state, touched: emptyTouched() };
      }
      const p = op.payload;
      if (p.performedByIds.length === 0) throw new ValidationError('Wskaż, kto wykonał pracę.');
      if (!isActorAllowedToLogFor(actor, p.performedByIds)) {
        throw new PermissionError('Wykonawca może zgłaszać pracę wykonaną przez siebie; dla innych osób wpis wprowadza przełożony.');
      }
      const wo = createWorkOrder(
        next,
        actor,
        {
          id: p.id,
          title: p.title,
          description: p.description || p.completionSummary,
          locationId: p.locationId,
          categoryId: p.categoryId,
          priority: 'NORMAL',
          requesterId: actor.id,
          contactPerson: null,
          accessNotes: null,
          expectedDate: null,
          leadWorkerId: p.performedByIds[0] ?? actor.id,
          helperIds: p.performedByIds.slice(1),
          photoIds: p.photoIds,
        },
        ctx,
        touched,
        entry.opId,
        /* unrequested */ true
      );
      wo.status = 'DONE';
      wo.is_unrequested = true;
      wo.completion_summary = p.completionSummary;
      wo.completed_at = ctx.now;
      wo.started_at = ctx.now;
      wo.updated_at = ctx.now;
      touched.workOrders.push(wo);
      const upd: WorkOrderUpdate = {
        id: ctx.newId(),
        work_order_id: wo.id,
        update_type: 'STATUS',
        previous_status: null,
        new_status: 'DONE',
        message: `Praca wykonana bez wcześniejszego zlecenia. Wykonawcy: ${namesFor(next, p.performedByIds)}.`,
        next_action: null,
        performed_by: p.performedByIds[0] ?? actor.id,
        entered_by: p.enteredById,
        created_at: ctx.now,
        client_created_at: ctx.now,
        device_operation_id: entry.opId,
      };
      next.updates.push(upd);
      touched.updates.push(upd);
      for (const photoId of p.photoIds) {
        const att: Attachment = {
          id: photoId,
          work_order_id: wo.id,
          update_id: upd.id,
          storage_path: `wo/${wo.id}/${photoId}.jpg`,
          file_name: `photo-${photoId.slice(0, 8)}.jpg`,
          mime_type: 'image/jpeg',
          size: 0,
          uploaded_by: actor.id,
          created_at: ctx.now,
        };
        next.attachments.push(att);
        touched.attachments.push(att);
      }
      break;
    }
    case 'UPDATE_FIELDS': {
      const wo = requireWO(next, op.payload.id);
      const requesterOwnsNew = wo.status === 'NEW' && wo.requester_id === actor.id;
      if (!(isManager(actor.role) || requesterOwnsNew)) {
        throw new PermissionError('Pola zadania może edytować przełożony lub zgłaszający, dopóki zadanie jest nowe.');
      }
      const before = wo.priority;
      const f = op.payload.fields;
      if (f.title !== undefined) wo.title = f.title.trim();
      if (f.description !== undefined) wo.description = f.description.trim();
      if (f.locationId !== undefined) wo.location_id = f.locationId;
      if (f.categoryId !== undefined) wo.category_id = f.categoryId;
      if (f.priority !== undefined) wo.priority = f.priority;
      if (f.expectedDate !== undefined) wo.expected_date = f.expectedDate;
      if (f.contactPerson !== undefined) wo.contact_person = f.contactPerson;
      if (f.accessNotes !== undefined) wo.access_notes = f.accessNotes;
      if (wo.title.trim().length < 3) throw new ValidationError('Tytuł jest za krótki.');
      wo.updated_at = ctx.now;
      touched.workOrders.push(wo);
      if (isEscalation(before, wo.priority)) {
        pushEscalationNotifs(next, wo, actor, ctx, touched);
      }
      touched.audit.push({
        entity_type: 'work_order',
        entity_id: wo.id,
        action: 'fields_updated',
        actor_id: actor.id,
        metadata: { from_priority: before },
      });
      break;
    }
    case 'ASSIGN': {
      require('assign', actor);
      const wo = requireWO(next, op.payload.id);
      wo.lead_worker_id = op.payload.leadWorkerId;
      next.assignees = next.assignees.filter((a) => a.work_order_id !== wo.id);
  const rows: AssigneeRow[] = [];
  if (op.payload.leadWorkerId) {
    rows.push({ id: `${wo.id}:${op.payload.leadWorkerId}`, work_order_id: wo.id, user_id: op.payload.leadWorkerId, assignment_type: 'LEAD' });
  }
  for (const h of op.payload.helperIds) {
    if (h !== op.payload.leadWorkerId) {
      rows.push({ id: `${wo.id}:${h}`, work_order_id: wo.id, user_id: h, assignment_type: 'HELPER' });
    }
  }
      next.assignees.push(...rows);
      touched.assignees.push(...rows);
      if (wo.status === 'NEW' && op.payload.leadWorkerId) wo.status = 'ASSIGNED';
      if (wo.status === 'ASSIGNED' && !op.payload.leadWorkerId) wo.status = 'NEW';
      wo.updated_at = ctx.now;
      touched.workOrders.push(wo);

      const upd = mkStatusUpdate(wo.id, null, 'ASSIGNED', 'Przydzielono wykonawców.', actor, ctx, entry.opId);
      next.updates.push(upd);
      touched.updates.push(upd);

      for (const r of rows) notify(next, r.user_id, wo.id, 'ASSIGNED', `Przydział: ${wo.title}`, ctx, touched, actor);
      touched.audit.push({
        entity_type: 'work_order',
        entity_id: wo.id,
        action: 'assigned',
        actor_id: actor.id,
        metadata: { lead: op.payload.leadWorkerId, helpers: op.payload.helperIds },
      });
      break;
    }
    case 'TRANSITION': {
      const wo = requireWO(next, op.payload.id);
      const p = op.payload;
      if (p.expectedPrevious && wo.status !== p.expectedPrevious) {
        throw new ConflictError(
          `Status na serwerze jest już inny (serwer: ${wo.status}, Twoja operacja: ${p.expectedPrevious}). Wczytaj aktualny stan i zdecyduj.`
        );
      }
      const action = transitionAction(p.newStatus);
      const participant = isParticipantOf(next, wo.id, actor.id);
      if (!can(action, { userId: actor.id, role: actor.role, isParticipant: participant, isLead: wo.lead_worker_id === actor.id, isRequester: wo.requester_id === actor.id })) {
        throw new PermissionError(permissionMessage(p.newStatus));
      }
      if (!canTransition(wo.status, p.newStatus)) {
        throw new ValidationError(`Nie można przejść ze statusu „${wo.status}” do „${p.newStatus}”.`);
      }
      const errors = validateTransition(p.newStatus, p);
      if (errors.length) throw new ValidationError(errors[0] ?? 'Niepełne dane zmiany statusu.');
      if (p.performedBy && p.performedBy !== actor.id) {
        require('logUpdateForOthers', actor);
      }
      const previous = wo.status;
      wo.status = p.newStatus;
      wo.updated_at = ctx.now;
      applyStatusSideEffects(wo, p, ctx);
      touched.workOrders.push(wo);

      const message =
        p.message ??
        (p.newStatus === 'DONE' ? p.completionSummary ?? null : p.newStatus === 'ON_HOLD' ? holdSummary(p) : null);
      const upd = mkStatusUpdate(wo.id, previous, p.newStatus, message, actor, ctx, entry.opId, p.performedBy ?? null);
      upd.next_action = p.nextAction ?? null;
      next.updates.push(upd);
      touched.updates.push(upd);

      if (p.newStatus === 'ON_HOLD') {
        for (const m of managersOf(next)) {
          notify(next, m.id, wo.id, 'HOLD_RAISED', `Blokada wymaga decyzji: ${wo.title}`, ctx, touched, actor);
        }
      }
      if (p.newStatus === 'REOPENED') {
        const targets = participantsOf(next, wo).filter((u) => u !== actor.id);
        for (const u of targets) notify(next, u, wo.id, 'REOPENED', `Zadanie wróciło do pracy: ${wo.title}`, ctx, touched, actor);
      }
      touched.audit.push({
        entity_type: 'work_order',
        entity_id: wo.id,
        action: 'status_change',
        actor_id: actor.id,
        metadata: { from: previous, to: p.newStatus },
      });
      break;
    }
    case 'LOG_UPDATE': {
      const wo = requireWO(next, op.payload.id);
      const participant = isParticipantOf(next, wo.id, actor.id);
      requireWithParticipant('comment', actor, participant);
      if (!op.payload.message.trim()) throw new ValidationError('Wpis nie może być pusty.');
      if (op.payload.performedBy && op.payload.performedBy !== actor.id) require('logUpdateForOthers', actor);
      const upd: WorkOrderUpdate = {
        id: ctx.newId(),
        work_order_id: wo.id,
        update_type: op.payload.updateType,
        previous_status: null,
        new_status: null,
        message: op.payload.message.trim(),
        next_action: op.payload.nextAction ?? null,
        performed_by: op.payload.performedBy ?? actor.id,
        entered_by: actor.id,
        created_at: ctx.now,
        client_created_at: ctx.now,
        device_operation_id: entry.opId,
      };
      next.updates.push(upd);
      touched.updates.push(upd);

      // Odpowiedź na blokadę: przełożony komentuje zadanie wstrzymane → powiadamiamy osobę zgłaszającą blokadę.
      if (wo.status === 'ON_HOLD' && isManager(actor.role)) {
        const holder = [...next.updates].reverse().find(
          (u) => u.work_order_id === wo.id && u.update_type === 'STATUS' && u.new_status === 'ON_HOLD'
        );
        if (holder && holder.entered_by !== actor.id) {
          notify(next, holder.entered_by, wo.id, 'HOLD_REPLY', `Odpowiedź na blokadę: ${wo.title}`, ctx, touched, actor);
        }
      }
      break;
    }
    case 'ADD_MATERIAL': {
      const wo = requireWO(next, op.payload.id);
      const participant = isParticipantOf(next, wo.id, actor.id);
      requireWithParticipant('addMaterial', actor, participant);
      if (!op.payload.name.trim()) throw new ValidationError('Podaj nazwę materiału.');
      const m: MaterialRequest = {
        id: ctx.newId(),
        work_order_id: wo.id,
        name: op.payload.name.trim(),
        quantity: op.payload.quantity,
        unit: op.payload.unit,
        status: 'REQUESTED',
        note: op.payload.note ?? null,
        created_by: actor.id,
        created_at: ctx.now,
      };
      next.materials.push(m);
      touched.materials.push(m);
      break;
    }
    case 'SAVE_PHOTO': {
      const wo = requireWO(next, op.payload.id);
      const participant = isParticipantOf(next, wo.id, actor.id);
      requireWithParticipant('comment', actor, participant);
      const att: Attachment = {
        id: op.payload.photoId,
        work_order_id: wo.id,
        update_id: op.payload.updateId ?? null,
        storage_path: `wo/${wo.id}/${op.payload.photoId}.jpg`,
        file_name: op.payload.fileName,
        mime_type: 'image/jpeg',
        size: 0,
        uploaded_by: actor.id,
        created_at: ctx.now,
      };
      next.attachments.push(att);
      touched.attachments.push(att);
      break;
    }
    case 'SAVE_REPORT_DRAFT': {
      require('viewReports', actor);
      upsertReportDraft(next, op.payload.date, actor, ctx, op.payload.generalNote, op.payload.snapshot, touched, false);
      break;
    }
    case 'APPROVE_REPORT': {
      require('approveReport', actor);
      upsertReportDraft(next, op.payload.date, actor, ctx, op.payload.generalNote, op.payload.snapshot, touched, true);
      touched.audit.push({
        entity_type: 'daily_report',
        entity_id: op.payload.date,
        action: 'approved',
        actor_id: actor.id,
        metadata: {},
      });
      break;
    }
    case 'UPSERT_PROFILE': {
      require('manageUsers', actor);
      const d = op.payload.data;
      const id = op.payload.id ?? (d.id as string | undefined);
      if (!id) throw new ValidationError('Brak identyfikatora użytkownika.');
      const existing = next.profiles.find((p) => p.id === id);
      const role = (d.role as Profile['role'] | undefined) ?? existing?.role ?? 'WORKER';
      const active = (d.active as boolean | undefined) ?? existing?.active ?? true;
      const displayName = (d.display_name as string | undefined) ?? existing?.display_name ?? 'Użytkownik';
      const row: Profile = { id, display_name: displayName, role, active };
      upsertById(next.profiles, row);
      touched.profiles.push(row);
      if (existing && existing.role !== role) {
        touched.audit.push({
          entity_type: 'profile',
          entity_id: id,
          action: 'role_changed',
          actor_id: actor.id,
          metadata: { from: existing.role, to: role },
        });
      }
      break;
    }
    case 'UPSERT_LOCATION': {
      require('manageLocations', actor);
      const id = op.payload.id ?? ctx.newId();
      const row: Location = {
        id,
        name: String(op.payload.data.name ?? 'Nowa lokalizacja'),
        building: (op.payload.data.building as string | null) ?? null,
        floor: (op.payload.data.floor as string | null) ?? null,
        room: (op.payload.data.room as string | null) ?? null,
        active: (op.payload.data.active as boolean) ?? true,
      };
      upsertById(next.locations, row);
      touched.locations.push(row);
      break;
    }
    case 'UPSERT_CATEGORY': {
      require('manageCategories', actor);
      const id = op.payload.id ?? ctx.newId();
      const row: Category = {
        id,
        name: String(op.payload.data.name ?? 'Nowa kategoria'),
        icon: (op.payload.data.icon as string | null) ?? null,
        color: (op.payload.data.color as string | null) ?? null,
        active: (op.payload.data.active as boolean) ?? true,
      };
      upsertById(next.categories, row);
      touched.categories.push(row);
      break;
    }
    default: {
      const exhaustive: never = op;
      throw new Error(`Nieznana operacja: ${JSON.stringify(exhaustive)}`);
    }
  }

  return { changed: next, touched };
}

/* ── pomocnicze ───────────────────────────────────────────────────────── */

function emptyTouched(): ApplyOutcome['touched'] {
  return {
    workOrders: [],
    updates: [],
    assignees: [],
    attachments: [],
    materials: [],
    notifications: [],
    reports: [],
    audit: [],
    profiles: [],
    locations: [],
    categories: [],
  };
}

function cloneState(s: WorldState): WorldState {
  return {
    workOrders: s.workOrders.map((w) => ({ ...w })),
    updates: [...s.updates],
    assignees: [...s.assignees],
    attachments: [...s.attachments],
    materials: [...s.materials],
    notifications: [...s.notifications],
    reports: [...s.reports],
    profiles: [...s.profiles],
    locations: [...s.locations],
    categories: [...s.categories],
    nextNumber: s.nextNumber,
  };
}

function requireWO(state: WorldState, id: string): WorkOrder {
  const wo = state.workOrders.find((w) => w.id === id);
  if (!wo) throw new ValidationError('Zadanie nie istnieje lub zostało usunięte.');
  return wo;
}

function require(action: Action, actor: ActorContext): void {
  requireWithParticipant(action, actor, false);
}

function requireWithParticipant(action: Action, actor: ActorContext, isParticipant: boolean): void {
  const ok = can(action, {
    userId: actor.id,
    role: actor.role,
    isParticipant,
    isLead: false,
    isRequester: false,
  });
  if (!ok) throw new PermissionError('Ta operacja wymaga uprawnień przełożonego.');
}

function isActorAllowedToLogFor(actor: ActorContext, performedByIds: string[]): boolean {
  return isManager(actor.role) || performedByIds.includes(actor.id);
}

function transitionAction(to: WorkOrderStatus): Action {
  switch (to) {
    case 'IN_PROGRESS':
      return 'startWork';
    case 'ON_HOLD':
      return 'hold';
    case 'DONE':
      return 'complete';
    case 'CLOSED':
      return 'close';
    case 'REOPENED':
      return 'reopen';
    default:
      return 'assign';
  }
}

function permissionMessage(to: WorkOrderStatus): string {
  switch (to) {
    case 'CLOSED':
      return 'Zamknąć zadanie może tylko dyrektor lub koordynator.';
    case 'REOPENED':
      return 'Ponownie otworzyć zadanie może tylko dyrektor lub koordynator.';
    default:
      return 'Zmieniać status może tylko osoba przydzielona do zadania lub przełożony.';
  }
}

function isParticipantOf(state: WorldState, woId: string, userId: string): boolean {
  const wo = state.workOrders.find((w) => w.id === woId);
  if (wo?.lead_worker_id === userId) return true;
  if (wo?.requester_id === userId) return false;
  return state.assignees.some((a) => a.work_order_id === woId && a.user_id === userId);
}

function participantsOf(state: WorldState, wo: WorkOrder): string[] {
  const ids = new Set<string>([wo.requester_id]);
  if (wo.lead_worker_id) ids.add(wo.lead_worker_id);
  for (const a of state.assignees) if (a.work_order_id === wo.id) ids.add(a.user_id);
  return [...ids];
}

function managersOf(state: WorldState): Profile[] {
  return state.profiles.filter((p) => isManager(p.role) && p.active);
}

function namesFor(state: WorldState, ids: string[]): string {
  return ids.map((id) => state.profiles.find((p) => p.id === id)?.display_name ?? '?').join(', ');
}

function mkStatusUpdate(
  woId: string,
  previous: WorkOrderStatus | null,
  to: WorkOrderStatus,
  message: string | null,
  actor: ActorContext,
  ctx: ReducerCtx,
  opId: string,
  performedBy?: string | null
): WorkOrderUpdate {
  return {
    id: ctx.newId(),
    work_order_id: woId,
    update_type: 'STATUS',
    previous_status: previous,
    new_status: to,
    message,
    next_action: null,
    performed_by: performedBy ?? actor.id,
    entered_by: actor.id,
    created_at: ctx.now,
    client_created_at: ctx.now,
    device_operation_id: opId,
  };
}

interface TransitionPayloadLite {
  holdReason?: string | null;
  holdDetails?: string | null;
  nextAction?: string | null;
  holdWaitingOn?: string | null;
  completionSummary?: string | null;
}

function holdSummary(p: TransitionPayloadLite): string {
  const parts = [p.holdReason ? `Powód: ${p.holdReason}` : null, p.holdDetails ?? null, p.nextAction ? `Następny krok: ${p.nextAction}` : null].filter(
    Boolean
  );
  return parts.join(' • ');
}

function applyStatusSideEffects(wo: WorkOrder, p: TransitionPayloadLite, ctx: ReducerCtx): void {
  switch (wo.status) {
    case 'IN_PROGRESS':
      wo.started_at ??= ctx.now;
      wo.hold_reason = null;
      wo.hold_details = null;
      wo.next_action = null;
      wo.hold_waiting_on = null;
      break;
    case 'ON_HOLD':
      wo.hold_reason = p.holdReason ?? 'inne';
      wo.hold_details = p.holdDetails ?? null;
      wo.next_action = p.nextAction ?? null;
      wo.hold_waiting_on = p.holdWaitingOn ?? null;
      break;
    case 'DONE':
      wo.completion_summary = p.completionSummary ?? wo.completion_summary;
      wo.completed_at = ctx.now;
      wo.hold_reason = null;
      wo.hold_details = null;
      wo.next_action = null;
      wo.hold_waiting_on = null;
      break;
    case 'CLOSED':
      wo.closed_at = ctx.now;
      break;
    case 'REOPENED':
      wo.reopened_at = ctx.now;
      wo.completed_at = null;
      wo.closed_at = null;
      break;
    case 'ASSIGNED':
    case 'NEW':
      break;
  }
}

function createWorkOrder(
  state: WorldState,
  actor: ActorContext,
  input: {
    id?: string;
    title: string;
    description: string;
    locationId: string;
    categoryId: string | null;
    priority: WorkOrder['priority'];
    requesterId: string;
    contactPerson: string | null;
    accessNotes: string | null;
    expectedDate: string | null;
    leadWorkerId: string | null;
    helperIds: string[];
    photoIds: string[];
  },
  ctx: ReducerCtx,
  touched: TouchedAcc,
  opId: string,
  unrequested = false
): WorkOrder {
  if (input.title.trim().length < 3) throw new ValidationError('Tytuł musi mieć co najmniej 3 znaki.');
  if (input.description.trim().length < 5) throw new ValidationError('Opisz problem lub oczekiwany rezultat (min. 5 znaków).');
  if (!unrequested) {
    const hasAssignments = input.leadWorkerId !== null || input.helperIds.length > 0;
    if (hasAssignments && !isManager(actor.role)) {
      throw new PermissionError('Przypisać prowadzącego i współpracowników może tylko dyrektor lub koordynator.');
    }
  }
  const id = input.id ?? ctx.newId();
  const wo: WorkOrder = {
    id,
    sequential_number: state.nextNumber++,
    title: input.title.trim(),
    description: input.description.trim(),
    category_id: input.categoryId,
    location_id: input.locationId,
    priority: input.priority,
    status: !unrequested && input.leadWorkerId ? 'ASSIGNED' : unrequested ? 'DONE' : 'NEW',
    requester_id: actor.id,
    lead_worker_id: input.leadWorkerId ?? (unrequested ? actor.id : null),
    contact_person: input.contactPerson,
    access_notes: input.accessNotes,
    expected_date: input.expectedDate,
    hold_reason: null,
    hold_details: null,
    next_action: null,
    hold_waiting_on: null,
    completion_summary: null,
    is_unrequested: unrequested,
    created_at: ctx.now,
    updated_at: ctx.now,
    started_at: null,
    completed_at: unrequested ? ctx.now : null,
    closed_at: null,
    reopened_at: null,
  };
  state.workOrders.push(wo);
  if (input.leadWorkerId) {
    const leadRow: AssigneeRow = { id: `${id}:${input.leadWorkerId}`, work_order_id: id, user_id: input.leadWorkerId, assignment_type: 'LEAD' };
    state.assignees.push(leadRow);
    touched.assignees.push(leadRow);
  }
  for (const h of input.helperIds) {
    if (h !== input.leadWorkerId) {
      const row: AssigneeRow = { id: `${id}:${h}`, work_order_id: id, user_id: h, assignment_type: 'HELPER' };
      state.assignees.push(row);
      touched.assignees.push(row);
    }
  }
  if (input.leadWorkerId && input.leadWorkerId !== actor.id) {
    notify(state, input.leadWorkerId, id, 'ASSIGNED', `Nowy przydział: ${wo.title}`, ctx, touched, actor);
  }
  touched.audit.push({
    entity_type: 'work_order',
    entity_id: id,
    action: unrequested ? 'unrequested_work_logged' : 'created',
    actor_id: actor.id,
    metadata: { op: opId },
  });
  return wo;
}

function pushEscalationNotifs(
  state: WorldState,
  wo: WorkOrder,
  actor: ActorContext,
  ctx: ReducerCtx,
  touched: TouchedAcc
): void {
  for (const u of participantsOf(state, wo)) {
    if (u === actor.id) continue;
    notify(state, u, wo.id, 'PRIORITY_ESCALATED', `Podniesiono priorytet: ${wo.title}`, ctx, touched, actor);
  }
}

function notify(
  _state: WorldState,
  recipientId: string,
  woId: string | null,
  kind: NotificationKind,
  message: string,
  ctx: ReducerCtx,
  touched: TouchedAcc,
  _actor: ActorContext
): void {
  const n: Notification = {
    id: ctx.newId(),
    recipient_id: recipientId,
    work_order_id: woId,
    kind,
    message,
    read_at: null,
    created_at: ctx.now,
  };
  touched.notifications.push(n);
}

function upsertReportDraft(
  state: WorldState,
  date: string,
  actor: ActorContext,
  ctx: ReducerCtx,
  note: string | null,
  snapshot: DailyReportSnapshot,
  touched: TouchedAcc,
  approve: boolean
): void {
  const existing = state.reports.find((r) => r.report_date === date);
  if (existing?.status === 'APPROVED') {
    throw new ValidationError('Raport został zatwierdzony i jest niezmienny. Wygeneruj nową wersję tylko dla raportu roboczego.');
  }
  const row: ReportRow = {
    id: existing?.id ?? ctx.newId(),
    report_date: date,
    status: approve ? 'APPROVED' : 'DRAFT',
    general_note: note,
    generated_by: existing?.generated_by ?? actor.id,
    approved_by: approve ? actor.id : null,
    generated_at: existing?.generated_at ?? ctx.now,
    approved_at: approve ? ctx.now : null,
    snapshot_json: snapshot,
  };
  if (existing) {
    state.reports = state.reports.map((r) => (r.report_date === date ? row : r));
  } else {
    state.reports.push(row);
  }
  touched.reports.push(row);
}

function upsertById<T extends { id: string }>(list: T[], row: T): void {
  const i = list.findIndex((x) => x.id === row.id);
  if (i >= 0) list[i] = row;
  else list.push(row);
}

/** Eksport dla testów i demo-serwera: buduje wiersz cache'u z flags. */
export function asCached(wo: WorkOrder, dirty = false): CachedWorkOrder {
  return { ...wo, dirty };
}

/* ── Raport dzienny: czysta funkcja na stanie świata ──────────────────── */

export function buildDailyReport(
  state: Pick<WorldState, 'workOrders' | 'updates' | 'materials' | 'assignees' | 'profiles' | 'locations'>,
  date: string, // yyyy-MM-dd
  generatedBy: Profile,
  now: string = new Date().toISOString()
): DailyReportSnapshot {
  const dayOf = (iso: string | null): string | null => (iso ? iso.slice(0, 10) : null);
  const locName = (id: string | null): string | null =>
    id ? (state.locations.find((l) => l.id === id)?.name ?? null) : null;
  const workerNames = (wo: WorkOrder): string[] => {
    const ids = new Set<string>();
    if (wo.lead_worker_id) ids.add(wo.lead_worker_id);
    for (const a of state.assignees) if (a.work_order_id === wo.id) ids.add(a.user_id);
    // uwzględnijmy też faktycznych wykonawców z aktualizacji dzisiejszych
    for (const u of state.updates) {
      if (u.work_order_id === wo.id && dayOf(u.created_at) === date && u.performed_by) ids.add(u.performed_by);
    }
    return [...ids]
      .map((id) => state.profiles.find((p) => p.id === id)?.display_name ?? '?')
      .filter((n) => n !== 'undefined');
  };
  const entry = (wo: WorkOrder, summary: string): DailyReportEntry => ({
    work_order_id: wo.id,
    sequential_number: wo.sequential_number,
    title: wo.title,
    location: locName(wo.location_id),
    summary,
    workers: workerNames(wo),
    hold_reason: wo.hold_reason,
    next_action: wo.next_action,
  });
  const lastUpdateOf = (woId: string): WorkOrderUpdate | undefined => {
    let found: WorkOrderUpdate | undefined;
    for (const u of state.updates) {
      const ud = dayOf(u.created_at);
      if (u.work_order_id === woId && ud !== null && ud <= date) found = u;
    }
    return found;
  };
  const stageOf = (wo: WorkOrder): string => {
    const u = lastUpdateOf(wo.id);
    return u?.message ?? `Status: ${wo.status}`;
  };

  const doneToday = state.workOrders.filter(
    (w) => !w.is_unrequested && (dayOf(w.completed_at) === date || (dayOf(w.closed_at) === date && w.status === 'CLOSED'))
  );
  const inProgress = state.workOrders.filter((w) => w.status === 'IN_PROGRESS' || w.status === 'REOPENED');
  const onHold = state.workOrders.filter((w) => w.status === 'ON_HOLD');
  const newUrgent = state.workOrders.filter(
    (w) =>
      dayOf(w.created_at) === date &&
      (w.priority === 'BREAKDOWN' || w.priority === 'URGENT') &&
      (w.status === 'NEW' || w.status === 'ASSIGNED')
  );
  const unrequested = state.workOrders.filter((w) => w.is_unrequested && dayOf(w.completed_at) === date);
  const handover = state.workOrders.filter(
    (w) =>
      w.status !== 'CLOSED' &&
      w.status !== 'DONE' &&
      w.next_action &&
      (dayOf(w.updated_at) === date || w.status === 'ON_HOLD')
  );
  const materials = state.materials
    .filter((m) => dayOf(m.created_at) === date || (m.status === 'REQUESTED' && isStillOpen(state, m.work_order_id)))
    .map((m) => ({
      name: m.name,
      quantity: m.quantity,
      unit: m.unit,
      note: m.note,
      workOrderTitle: state.workOrders.find((w) => w.id === m.work_order_id)?.title ?? '?',
    }));

  return {
    report_date: date,
    generated_at: now,
    generated_by_name: generatedBy.display_name,
    counters: {
      completed: doneToday.length,
      inProgress: inProgress.length,
      onHold: onHold.length,
      newUrgent: newUrgent.length,
      unrequested: unrequested.length,
    },
    sections: {
      completed: doneToday.map((w) => entry(w, w.completion_summary ?? 'Wykonano zgodnie ze zgłoszeniem.')),
      inProgress: inProgress.map((w) => entry(w, stageOf(w))),
      onHold: onHold.map((w) => entry(w, `Zatrzymane: ${w.hold_details ?? w.hold_reason ?? '—'}`)),
      newUrgent: newUrgent.map((w) => entry(w, w.description)),
      materials,
      handover: handover.map((w) => entry(w, w.next_action ?? '—')),
      unrequested: unrequested.map((w) => entry(w, w.completion_summary ?? w.description)),
    },
  };
}

function isStillOpen(state: Pick<WorldState, 'workOrders'>, woId: string): boolean {
  const wo = state.workOrders.find((w) => w.id === woId);
  return !!wo && wo.status !== 'CLOSED';
}
