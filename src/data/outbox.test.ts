import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SyncManager } from '@/data/outbox';
import { ConflictError, NetworkError, PermissionError, type ActorContext, type Gateway, type Snapshot } from '@/data/gateway';
import { getDb, resetDbForTests } from '@/data/db';
import type { OutboxEntry } from '@/types/domain';
import type { WorldState } from '@/data/gateway';

const ACTOR: ActorContext = { id: 'a', displayName: 'Anna', role: 'ADMIN' };

function emptySnapshot(): Snapshot {
  const w: WorldState = {
    workOrders: [],
    updates: [],
    assignees: [],
    attachments: [],
    materials: [],
    notifications: [],
    reports: [],
    profiles: [],
    locations: [],
    categories: [],
    nextNumber: 1030,
  };
  return { ...w };
}

function makeEntry(i: number): Omit<OutboxEntry, 'seq'> {
  return {
    opId: `op-${i}`,
    kind: 'TRANSITION',
    workOrderId: 'w1',
    payload: {
      kind: 'TRANSITION',
      payload: { id: 'w1', newStatus: 'IN_PROGRESS', expectedPrevious: 'ASSIGNED' },
    },
    status: 'PENDING',
    attempts: 0,
    lastError: null,
    conflictInfo: null,
    createdAt: new Date().toISOString(),
    syncedAt: null,
    label: `test ${i}`,
  };
}

async function waitFor(cond: () => boolean | Promise<boolean>, ms = 3000): Promise<void> {
  const start = Date.now();
  for (;;) {
    if (await cond()) return;
    if (Date.now() - start > ms) throw new Error('waitFor: przekroczono limit');
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe('SyncManager — kolejka i stany wpisów', () => {
  let applied: string[] = [];
  let behavior: (entry: OutboxEntry) => Promise<void>;
  let gateway: Gateway;
  let mgr: SyncManager;

  beforeEach(() => {
    resetDbForTests(`sync-${Math.random().toString(36).slice(2)}`);
    applied = [];
    behavior = () => {
      applied.push('ok');
      return Promise.resolve();
    };
    gateway = {
      mode: 'custom' as unknown as 'demo', // tryb „supabase-podobny”: bez pełnego snapshotu po ack
      fetchSnapshot: () => Promise.resolve(emptySnapshot()),
      applyOp: (_a, e) => behavior(e),
      attachmentUrl: () => Promise.resolve(null),
    };
    mgr = new SyncManager(gateway, () => ACTOR);
  });

  afterEach(() => {
    mgr.stop();
  });

  it('ACK bramki → wpis SYNCED z licznikami', async () => {
    await mgr.enqueue(makeEntry(1));
    const db = getDb();
    await waitFor(async () => (await db.outbox.get(1))?.status === 'SYNCED');
    const rows = await db.outbox.toArray();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe('SYNCED');
    expect(rows[0]!.syncedAt).toBeTruthy();
    expect(applied).toEqual(['ok']);
  });

  it('błąd sieci → próby rosną, wpis zostaje PENDING i po „powrocie sieci” dochodzi', async () => {
    let fail = true;
    let failed = 0;
    behavior = () => {
      if (fail) {
        failed += 1;
        return Promise.reject(new NetworkError());
      }
      applied.push('ok');
      return Promise.resolve();
    };
    const db = getDb();
    await mgr.enqueue(makeEntry(2));
    await waitFor(() => failed >= 1);
    let row = await db.outbox.get(1);
    expect(row!.status).toBe('PENDING');
    expect(row!.attempts).toBeGreaterThanOrEqual(1);
    fail = false;
    mgr.retryNow();
    await waitFor(async () => (await db.outbox.get(1))?.status === 'SYNCED');
    row = await db.outbox.get(1);
    expect(row!.status).toBe('SYNCED');
    expect(applied).toEqual(['ok']);
  });

  it('konflikt → status CONFLICT, retryOp ponawia, discardOp usuwa intencję', async () => {
    let conflict = true;
    behavior = () => {
      if (conflict) return Promise.reject(new ConflictError('Status na serwerze jest już inny'));
      applied.push('ok');
      return Promise.resolve();
    };
    await mgr.enqueue(makeEntry(3));
    const db = getDb();
    await waitFor(async () => (await db.outbox.get(1))?.status === 'CONFLICT');
    expect((await db.outbox.get(1))!.status).toBe('CONFLICT');
    conflict = false;
    await mgr.retryOp(1);
    await waitFor(() => mgr.stateSnapshot.pending === 0 && mgr.stateSnapshot.conflicts === 0);
    expect((await db.outbox.get(1))!.status).toBe('SYNCED');

    // drugi wpis: odrzucenie intencji
    conflict = true;
    await mgr.enqueue(makeEntry(4));
    await waitFor(() => mgr.stateSnapshot.conflicts === 1);
    await mgr.discardOp(2, null);
    expect(await db.outbox.get(2)).toBeUndefined();
  });

  it('błąd uprawnień → ERROR (brak auto-ponowień)', async () => {
    behavior = () => Promise.reject(new PermissionError('Ta operacja wymaga uprawnień przełożonego.'));
    await mgr.enqueue(makeEntry(5));
    const db = getDb();
    await waitFor(async () => (await db.outbox.get(1))?.status === 'ERROR');
    const row = await db.outbox.get(1);
    expect(row!.status).toBe('ERROR');
    expect(row!.attempts).toBe(0);
    expect(applied).toHaveLength(0);
  });

  it('tryb demo po ack odświeża cache i zdejmuje flagę dirty', async () => {
    gateway = {
      ...gateway,
      mode: 'demo',
      fetchSnapshot: () =>
        Promise.resolve({
          ...emptySnapshot(),
        workOrders: [
          {
            id: 'w1',
            sequential_number: 1030,
            title: 'T',
            description: 'D',
            category_id: null,
            location_id: null,
            priority: 'NORMAL',
            status: 'IN_PROGRESS',
            requester_id: 'a',
            lead_worker_id: null,
            contact_person: null,
            access_notes: null,
            expected_date: null,
            hold_reason: null,
            hold_details: null,
            next_action: null,
            hold_waiting_on: null,
            completion_summary: null,
            is_unrequested: false,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            started_at: null,
            completed_at: null,
            closed_at: null,
            reopened_at: null,
            dirty: false,
          },
        ],
        }),
    };
    mgr = new SyncManager(gateway, () => ACTOR);
    const db = getDb();
    await db.workOrders.put({
      id: 'w1',
      sequential_number: 1030,
      title: 'T',
      description: 'D',
      category_id: null,
      location_id: null,
      priority: 'NORMAL',
      status: 'ASSIGNED',
      requester_id: 'a',
      lead_worker_id: null,
      contact_person: null,
      access_notes: null,
      expected_date: null,
      hold_reason: null,
      hold_details: null,
      next_action: null,
      hold_waiting_on: null,
      completion_summary: null,
      is_unrequested: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      started_at: null,
      completed_at: null,
      closed_at: null,
      reopened_at: null,
      dirty: true,
    } as never);
    await mgr.enqueue(makeEntry(6));
    await waitFor(async () => (await db.outbox.get(1))?.status === 'SYNCED');
    const cached = await db.workOrders.get('w1');
    expect(cached!.status).toBe('IN_PROGRESS');
    expect(cached!.dirty).toBeFalsy(); // konwencja cache: brak flagi = czysty
  });
});
