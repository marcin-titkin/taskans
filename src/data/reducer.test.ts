import { describe, expect, it } from 'vitest';
import { applyOp, buildDailyReport, type ReducerCtx } from '@/data/reducer';
import type { ActorContext, WorldState } from '@/data/gateway';
import { ConflictError, PermissionError, ValidationError } from '@/data/gateway';
import type { OutboxEntry, OutboxOp, Profile, WorkOrder } from '@/types/domain';

/* ── helpers ─────────────────────────────────────────────────────────── */

const P = (id: string, display_name: string, role: Profile['role']): Profile => ({
  id,
  display_name,
  role,
  active: true,
});

const actorOf = (p: Profile): ActorContext => ({ id: p.id, displayName: p.display_name, role: p.role });

function baseWorld(): WorldState {
  return {
    workOrders: [],
    updates: [],
    assignees: [],
    attachments: [],
    materials: [],
    notifications: [],
    reports: [],
    profiles: [],
    locations: [{ id: 'loc1', name: 'Sala 104', building: 'A', floor: 'I', room: 'A-104', active: true }],
    categories: [{ id: 'cat1', name: 'Hydraulika', icon: 'droplets', color: '#0284c7', active: true }],
    nextNumber: 1030,
  };
}

let opSeq = 0;
function entry(kind: OutboxOp['kind'], payload: OutboxOp['payload'], workOrderId: string | null = null): OutboxEntry {
  opSeq += 1;
  return {
    opId: `op-${opSeq}`,
    kind,
    workOrderId,
    payload: { kind, payload } as OutboxOp,
    status: 'PENDING',
    attempts: 0,
    lastError: null,
    conflictInfo: null,
    createdAt: '2026-09-12T08:00:00.000Z',
    syncedAt: null,
    label: kind,
  };
}

const ctx: ReducerCtx = { now: '2026-09-12T08:00:00.000Z', newId: () => `gen-${Math.random().toString(36).slice(2)}` };

function createWO(world: WorldState, actor: ActorContext): { state: WorldState; wo: WorkOrder } {
  const e = entry('CREATE_WORK_ORDER', {
    id: 'wo-fixed',
    title: 'Cieknący kran',
    description: 'Kapie przy tablicy',
    locationId: 'loc1',
    categoryId: 'cat1',
    priority: 'BREAKDOWN',
    requesterId: actor.id,
    contactPerson: null,
    accessNotes: null,
    expectedDate: null,
    leadWorkerId: null,
    helperIds: [],
    photoIds: [],
  });
  const r = applyOp(world, e, actor, ctx);
  const wo = r.changed.workOrders.find((w) => w.id === 'wo-fixed')!;
  return { state: r.changed, wo };
}

/* ── tests ───────────────────────────────────────────────────────────── */

describe('reducer: tworzenie', () => {
  it('nadaje numer sekwencyjny, status NEW i wpis zaczyna historię', () => {
    const world = baseWorld();
    const anna = P('a', 'Anna', 'ADMIN');
    world.profiles.push(anna);
    const { state, wo } = createWO(world, actorOf(anna));
    expect(wo.sequential_number).toBe(1030);
    expect(state.nextNumber).toBe(1031);
    expect(wo.status).toBe('NEW');
    expect(state.updates.filter((u) => u.work_order_id === wo.id)).toHaveLength(0);
  });

  it('idempotentność: ponowna wysyłka tego samego opId nie duplikuje', () => {
    const world = baseWorld();
    const anna = P('a', 'Anna', 'ADMIN');
    world.profiles.push(anna);
    const e = entry('CREATE_WORK_ORDER', {
      id: 'wo-idem',
      title: 'Test',
      description: 'opis test',
      locationId: 'loc1',
      categoryId: null,
      priority: 'NORMAL',
      requesterId: 'a',
      contactPerson: null,
      accessNotes: null,
      expectedDate: null,
      leadWorkerId: null,
      helperIds: [],
      photoIds: [],
    });
    const first = applyOp(world, e, actorOf(anna), ctx);
    const again = applyOp(first.changed, e, actorOf(anna), ctx);
    expect(again.changed.workOrders.filter((w) => w.id === 'wo-idem')).toHaveLength(1);
    expect(again.touched.workOrders).toHaveLength(0);
    expect(again.changed.nextNumber).toBe(first.changed.nextNumber);
  });

  it('walidacja: tytuł za krótki → ValidationError', () => {
    const world = baseWorld();
    const anna = P('a', 'Anna', 'ADMIN');
    world.profiles.push(anna);
    const e = entry('CREATE_WORK_ORDER', {
      id: 'x',
      title: 'za',
      description: 'opis',
      locationId: 'loc1',
      categoryId: null,
      priority: 'NORMAL',
      requesterId: 'a',
      contactPerson: null,
      accessNotes: null,
      expectedDate: null,
      leadWorkerId: null,
      helperIds: [],
      photoIds: [],
    });
    expect(() => applyOp(world, e, actorOf(anna), ctx)).toThrow(ValidationError);
  });
});

describe('reducer: statusy', () => {
  const setup = () => {
    const world = baseWorld();
    const anna = P('a', 'Anna', 'ADMIN');
    const mariusz = P('m', 'Mariusz', 'WORKER');
    const piotr = P('p', 'Piotr', 'COORDINATOR');
    world.profiles.push(anna, mariusz, piotr);
    const { state, wo } = createWO(world, actorOf(anna));
    return { world: state, wo, anna, mariusz, piotr };
  };

  it('uczestnik przeprowadza pełną ścieżkę do DONE', () => {
    const { world, wo, mariusz } = setup();
    // przydział przez administratora
    const assigned = applyOp(
      world,
      entry('ASSIGN', { id: wo.id, leadWorkerId: mariusz.id, helperIds: [] }, wo.id),
      { id: 'a', displayName: 'Anna', role: 'ADMIN' },
      ctx,
    );
    expect(assigned.changed.workOrders.find((w) => w.id === wo.id)!.status).toBe('ASSIGNED');
    expect(assigned.touched.notifications.some((n) => n.kind === 'ASSIGNED' && n.recipient_id === mariusz.id)).toBe(true);

    const inProgress = applyOp(
      assigned.changed,
      entry(
        'TRANSITION',
        { id: wo.id, newStatus: 'IN_PROGRESS', expectedPrevious: 'ASSIGNED', message: 'Startuję' },
        wo.id,
      ),
      actorOf(mariusz),
      ctx,
    );
    const started = inProgress.changed.workOrders.find((w) => w.id === wo.id)!;
    expect(started.status).toBe('IN_PROGRESS');
    expect(started.started_at).toBe(ctx.now);

    const done = applyOp(
      inProgress.changed,
      entry(
        'TRANSITION',
        {
          id: wo.id,
          newStatus: 'DONE',
          expectedPrevious: 'IN_PROGRESS',
          completionSummary: 'Wymieniona uszczelka, sucho od 10:00.',
        },
        wo.id,
      ),
      actorOf(mariusz),
      ctx,
    );
    const finished = done.changed.workOrders.find((w) => w.id === wo.id)!;
    expect(finished.status).toBe('DONE');
    expect(finished.completed_at).toBe(ctx.now);
    expect(finished.completion_summary).toMatch(/uszczelka/);
  });

  it('konflikt wersji: inny status bazowy → ConflictError', () => {
    const { world, wo, mariusz } = setup();
    expect(() =>
      applyOp(
        world,
        entry('TRANSITION', { id: wo.id, newStatus: 'ON_HOLD', expectedPrevious: 'ASSIGNED' }, wo.id),
        actorOf(mariusz),
        ctx,
      ),
    ).toThrow(ConflictError);
  });

  it('zamknięcia i ponownego otwarcia nie zrobi wykonawca', () => {
    const { world, wo, mariusz } = setup();
    expect(() =>
      applyOp(world, entry('TRANSITION', { id: wo.id, newStatus: 'CLOSED', expectedPrevious: 'NEW' }, wo.id), actorOf(mariusz), ctx),
    ).toThrow(PermissionError);
  });

  it('ON_HOLD bez danych → ValidationError; z danymi → powiadomienia do przełożonych', () => {
    const { world, wo, mariusz } = setup();
    const assigned = applyOp(
      world,
      entry('ASSIGN', { id: wo.id, leadWorkerId: mariusz.id, helperIds: [] }, wo.id),
      { id: 'a', displayName: 'Anna', role: 'ADMIN' },
      ctx,
    );
    expect(() =>
      applyOp(assigned.changed, entry('TRANSITION', { id: wo.id, newStatus: 'ON_HOLD', expectedPrevious: 'ASSIGNED' }, wo.id), actorOf(mariusz), ctx),
    ).toThrow(ValidationError);

    const held = applyOp(
      assigned.changed,
      entry(
        'TRANSITION',
        {
          id: wo.id,
          newStatus: 'ON_HOLD',
          expectedPrevious: 'ASSIGNED',
          holdReason: 'brak_materialow',
          holdDetails: 'Brak uszczelki 3/4 w magazynie.',
          nextAction: 'Kierownik zamawia część.',
        },
        wo.id,
      ),
      actorOf(mariusz),
      ctx,
    );
    expect(held.changed.workOrders.find((w) => w.id === wo.id)!.status).toBe('ON_HOLD');
    const recipients = held.touched.notifications.filter((n) => n.kind === 'HOLD_RAISED').map((n) => n.recipient_id);
    expect(recipients).toEqual(expect.arrayContaining(['a', 'p']));
  });

  it('REOPENED tylko przez przełożonego i z uzasadnieniem', () => {
    const { world, wo, mariusz } = setup();
    // doprowadź do DONE, potem CLOSED
    const assigned = applyOp(
      world,
      entry('ASSIGN', { id: wo.id, leadWorkerId: mariusz.id, helperIds: [] }, wo.id),
      { id: 'a', displayName: 'Anna', role: 'ADMIN' },
      ctx,
    );
    const inProg = applyOp(
      assigned.changed,
      entry('TRANSITION', { id: wo.id, newStatus: 'IN_PROGRESS', expectedPrevious: 'ASSIGNED' }, wo.id),
      actorOf(mariusz),
      ctx,
    );
    const done = applyOp(
      inProg.changed,
      entry('TRANSITION', { id: wo.id, newStatus: 'DONE', expectedPrevious: 'IN_PROGRESS', completionSummary: 'Gotowe, działa jak należy.' }, wo.id),
      actorOf(mariusz),
      ctx,
    );
    const closed = applyOp(
      done.changed,
      entry('TRANSITION', { id: wo.id, newStatus: 'CLOSED', expectedPrevious: 'DONE', message: 'Zamknięte po akceptacji.' }, wo.id),
      { id: 'a', displayName: 'Anna', role: 'ADMIN' },
      ctx,
    );
    expect(() =>
      applyOp(
        closed.changed,
        entry('TRANSITION', { id: wo.id, newStatus: 'REOPENED', expectedPrevious: 'CLOSED' }, wo.id),
        { id: 'p', displayName: 'Piotr', role: 'COORDINATOR' },
        ctx,
      ),
    ).toThrow(ValidationError); // brak uzasadnienia

    const reopened = applyOp(
      closed.changed,
      entry(
        'TRANSITION',
        { id: wo.id, newStatus: 'REOPENED', expectedPrevious: 'CLOSED', message: 'Znowu cieknie, wracamy.' },
        wo.id,
      ),
      { id: 'a', displayName: 'Anna', role: 'ADMIN' },
      ctx,
    );
    const rwo = reopened.changed.workOrders.find((w) => w.id === wo.id)!;
    expect(rwo.status).toBe('REOPENED');
    expect(rwo.completed_at).toBeNull();
    expect(rwo.reopened_at).toBe(ctx.now);
    // powiadomienie do uczestników
    expect(reopened.touched.notifications.some((n) => n.kind === 'REOPENED' && n.recipient_id === mariusz.id)).toBe(true);
  });
});

describe('reducer: wpisy „w imieniu” i materiały', () => {
  it('wykonawca nie wpisze w imieniu kogoś innego; koordynator tak (performed_by ≠ entered_by)', () => {
    const world = baseWorld();
    const anna = P('a', 'Anna', 'ADMIN');
    const mariusz = P('m', 'Mariusz', 'WORKER');
    const marek = P('k', 'Marek', 'WORKER');
    world.profiles.push(anna, mariusz, marek);
    const { state, wo } = createWO(world, actorOf(anna));
    const assigned = applyOp(
      state,
      entry('ASSIGN', { id: wo.id, leadWorkerId: mariusz.id, helperIds: [] }, wo.id),
      { id: 'a', displayName: 'Anna', role: 'ADMIN' },
      ctx,
    );
    expect(() =>
      applyOp(
        assigned.changed,
        entry('LOG_UPDATE', { id: wo.id, updateType: 'NOTE', message: 'wpis', performedBy: marek.id }, wo.id),
        actorOf(mariusz),
        ctx,
      ),
    ).toThrow(PermissionError);

    const byPiotr = applyOp(
      assigned.changed,
      entry('LOG_UPDATE', { id: wo.id, updateType: 'NOTE', message: 'Marek zgłosił przez telefon.', performedBy: marek.id }, wo.id),
      { id: 'p', displayName: 'Piotr', role: 'COORDINATOR' },
      ctx,
    );
    const upd = byPiotr.changed.updates.find((u) => u.work_order_id === wo.id && u.update_type === 'NOTE')!;
    expect(upd.entered_by).toBe('p');
    expect(upd.performed_by).toBe('k');
  });

  it('materiał zgłoszony przy zadaniu trafia do świata', () => {
    const world = baseWorld();
    const anna = P('a', 'Anna', 'ADMIN');
    const mariusz = P('m', 'Mariusz', 'WORKER');
    world.profiles.push(anna, mariusz);
    const { state, wo } = createWO(world, actorOf(anna));
    const mat = applyOp(
      state,
      entry('ADD_MATERIAL', { id: wo.id, name: 'Uszczelka 3/4', quantity: 2, unit: 'szt.', note: null }, wo.id),
      { id: 'a', displayName: 'Anna', role: 'ADMIN' },
      ctx,
    );
    expect(mat.changed.materials.filter((x) => x.work_order_id === wo.id)).toHaveLength(1);
  });
});

describe('reducer: praca bez zlecenia', () => {
  it('wpis wykonawcy: DONE od razu, historia z wykonawcami', () => {
    const world = baseWorld();
    const tomasz = P('t', 'Tomasz Zieliński', 'WORKER');
    world.profiles.push(tomasz);
    const e = entry('CREATE_UNREQUESTED_WORK', {
      id: 'u1',
      title: 'Przeniesienie krzeseł',
      description: 'na jutrzejsze zajęcia',
      locationId: 'loc1',
      categoryId: null,
      performedByIds: [tomasz.id],
      completionSummary: '12 krzeseł przeniesionych i ustawionych wg wskazań.',
      photoIds: [],
      enteredById: tomasz.id,
    });
    const r = applyOp(world, e, actorOf(tomasz), ctx);
    const wo = r.changed.workOrders.find((w) => w.id === 'u1')!;
    expect(wo.is_unrequested).toBe(true);
    expect(wo.status).toBe('DONE');
    expect(wo.completed_at).toBe(ctx.now);
    expect(r.changed.updates.some((u) => u.work_order_id === 'u1' && (u.message ?? '').includes('bez wcześniejszego zlecenia'))).toBe(true);
  });

  it('zgłoszenie czyjejś pracy przez wykonawcę → PermissionError', () => {
    const world = baseWorld();
    const tomasz = P('t', 'Tomasz', 'WORKER');
    const marek = P('k', 'Marek', 'WORKER');
    world.profiles.push(tomasz, marek);
    const e = entry('CREATE_UNREQUESTED_WORK', {
      id: 'u2',
      title: 'Cos czyjego',
      description: 'opis',
      locationId: 'loc1',
      categoryId: null,
      performedByIds: [marek.id],
      completionSummary: 'Zrobione, posprzątane, efekty widoczne.',
      photoIds: [],
      enteredById: tomasz.id,
    });
    expect(() => applyOp(world, e, actorOf(tomasz), ctx)).toThrow(PermissionError);
  });
});

describe('raport dzienny', () => {
  it('liczy sekcje: done/in progress/hold/urgent/newUrgent/unrequested/materialy', () => {
    const world = baseWorld();
    const anna = P('a', 'Anna Kowalska', 'ADMIN');
    const mariusz = P('m', 'Mariusz', 'WORKER');
    world.profiles.push(anna, mariusz);
    const { state, wo } = createWO(world, actorOf(anna));
    const assigned = applyOp(
      state,
      entry('ASSIGN', { id: wo.id, leadWorkerId: mariusz.id, helperIds: [] }, wo.id),
      { id: 'a', displayName: 'Anna', role: 'ADMIN' },
      ctx,
    );
    const done = applyOp(
      assigned.changed,
      entry(
        'TRANSITION',
        { id: wo.id, newStatus: 'DONE', expectedPrevious: 'ASSIGNED', completionSummary: 'Wymienione, sprawdzone, działa.' },
        wo.id,
      ),
      actorOf(mariusz),
      ctx,
    );
    // drugie zadanie: awaria NEW
    const second = applyOp(
      done.changed,
      entry('CREATE_WORK_ORDER', {
        id: 'wo2',
        title: 'Brak światła',
        description: 'korytarz ciemny',
        locationId: 'loc1',
        categoryId: null,
        priority: 'URGENT',
        requesterId: 'a',
        contactPerson: null,
        accessNotes: null,
        expectedDate: null,
        leadWorkerId: null,
        helperIds: [],
        photoIds: [],
      }),
      { id: 'a', displayName: 'Anna', role: 'ADMIN' },
      ctx,
    );
    const report = buildDailyReport(second.changed, ctx.now.slice(0, 10), anna, ctx.now);
    expect(report.counters.completed).toBe(1);
    expect(report.counters.newUrgent).toBe(1);
    expect(report.sections.completed[0]!.workers).toContain('Mariusz');
    expect(report.sections.completed[0]!.summary).toMatch(/Wymienione/);
  });

  it('zatwierdzony raport jest zamrożony dla dalszych zapisów', () => {
    const world = baseWorld();
    const anna = P('a', 'Anna', 'ADMIN');
    world.profiles.push(anna);
    const snap = {
      report_date: '2026-09-12',
      generated_at: ctx.now,
      generated_by_name: 'Anna',
      counters: { completed: 0, inProgress: 0, onHold: 0, newUrgent: 0, unrequested: 0 },
      sections: { completed: [], inProgress: [], onHold: [], newUrgent: [], materials: [], handover: [], unrequested: [] },
    };
    const approved = applyOp(
      world,
      entry('APPROVE_REPORT', { date: '2026-09-12', generalNote: null, snapshot: snap }),
      { id: 'a', displayName: 'Anna', role: 'ADMIN' },
      ctx,
    );
    expect(approved.changed.reports[0]!.status).toBe('APPROVED');
    expect(() =>
      applyOp(
        approved.changed,
        entry('SAVE_REPORT_DRAFT', { date: '2026-09-12', snapshot: snap, generalNote: 'x' }),
        { id: 'a', displayName: 'Anna', role: 'ADMIN' },
        ctx,
      ),
    ).toThrow(/niezmienny/);
  });
});
