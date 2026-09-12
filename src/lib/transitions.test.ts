import { describe, expect, it } from 'vitest';
import {
  canTransition,
  compareForQueue,
  isEscalation,
  validateTransition,
  OPEN_STATUSES,
  isOpen,
} from '@/lib/transitions';
import type { WorkOrder } from '@/types/domain';

describe('macierz statusów', () => {
  it('pozwala na legalne przejścia', () => {
    expect(canTransition('NEW', 'ASSIGNED')).toBe(true);
    expect(canTransition('ASSIGNED', 'IN_PROGRESS')).toBe(true);
    expect(canTransition('IN_PROGRESS', 'ON_HOLD')).toBe(true);
    expect(canTransition('ON_HOLD', 'IN_PROGRESS')).toBe(true);
    expect(canTransition('DONE', 'CLOSED')).toBe(true);
    expect(canTransition('CLOSED', 'REOPENED')).toBe(true);
    expect(canTransition('REOPENED', 'DONE')).toBe(true);
  });

  it('blokuje skróty pomijające obieg', () => {
    expect(canTransition('NEW', 'IN_PROGRESS')).toBe(false);
    expect(canTransition('IN_PROGRESS', 'CLOSED')).toBe(false);
    expect(canTransition('DONE', 'IN_PROGRESS')).toBe(false);
    expect(canTransition('CLOSED', 'IN_PROGRESS')).toBe(false);
    expect(canTransition('ON_HOLD', 'DONE')).toBe(false);
  });

  it('NEW/DONE→DONE dla awarii uproszczonym tokiem (serwer i tak pilnuje reguł)', () => {
    expect(canTransition('NEW', 'DONE')).toBe(true);
    expect(canTransition('ASSIGNED', 'DONE')).toBe(true);
  });
});

describe('walidacja warunków przejścia', () => {
  it('ON_HOLD wymaga powodu, szczegółów i następnego kroku', () => {
    const errs = validateTransition('ON_HOLD', {
      holdReason: null,
      holdDetails: null,
      nextAction: null,
      completionSummary: null,
      message: null,
    });
    expect(errs.length).toBeGreaterThan(0);
  });

  it('DONE wymaga opisu rezultatu', () => {
    const errs = validateTransition('DONE', {
      holdReason: null,
      holdDetails: null,
      nextAction: null,
      completionSummary: '',
      message: null,
    });
    expect(errs.join(' ')).toMatch(/rezultat/i);
  });

  it('DONE z krótkim, ale pełnym opisem przechodzi', () => {
    const errs = validateTransition('DONE', {
      holdReason: null,
      holdDetails: null,
      nextAction: null,
      completionSummary: 'Wymienione, działa.',
      message: null,
    });
    expect(errs).toHaveLength(0);
  });
});

describe('priorytety i kolejka', () => {
  it('eskalacją jest tylko ruch w górę', () => {
    expect(isEscalation('NORMAL', 'URGENT')).toBe(true);
    expect(isEscalation('URGENT', 'BREAKDOWN')).toBe(true);
    expect(isEscalation('BREAKDOWN', 'URGENT')).toBe(false);
    expect(isEscalation('URGENT', 'URGENT')).toBe(false);
  });

  const wo = (over: Partial<WorkOrder>): WorkOrder => ({
    id: Math.random().toString(),
    sequential_number: 1,
    title: 't',
    description: 'd',
    category_id: null,
    location_id: null,
    priority: 'NORMAL',
    status: 'NEW',
    requester_id: 'x',
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
    created_at: '2026-09-01T08:00:00.000Z',
    updated_at: '2026-09-01T08:00:00.000Z',
    started_at: null,
    completed_at: null,
    closed_at: null,
    reopened_at: null,
    ...over,
  });

  it('awaria przed pilnym, pilne przed zwykłym; blokowane po sprawcy', () => {
    const a = wo({ priority: 'NORMAL' });
    const b = wo({ priority: 'URGENT' });
    const c = wo({ priority: 'BREAKDOWN' });
    const ordered = [a, b, c].sort((x, y) => compareForQueue(x, y));
    expect(ordered.map((w) => w.priority)).toEqual(['BREAKDOWN', 'URGENT', 'NORMAL']);
  });

  it('otwarte statusy to podzbiór stanu świata', () => {
    for (const s of OPEN_STATUSES) expect(isOpen(s)).toBe(true);
    expect(isOpen('CLOSED')).toBe(false);
  });
});
