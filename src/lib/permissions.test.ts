import { describe, expect, it } from 'vitest';
import { ACTION_RULES, can, isAdmin, isManager, type ActorContext } from '@/lib/permissions';

const actor = (over: Partial<ActorContext> = {}): ActorContext => ({
  userId: 'u1',
  role: 'WORKER',
  isParticipant: false,
  isLead: false,
  isRequester: false,
  ...over,
});

describe('role', () => {
  it('koordynator i admin to przełożeni; wykonawca nie', () => {
    expect(isManager('COORDINATOR')).toBe(true);
    expect(isManager('ADMIN')).toBe(true);
    expect(isManager('WORKER')).toBe(false);
    expect(isAdmin('COORDINATOR')).toBe(false);
    expect(isAdmin('ADMIN')).toBe(true);
  });
});

describe('akcje domenowe', () => {
  it('zgłosić zlecenie może każdy, przydzielać tylko przełożony', () => {
    expect(can('createWorkOrder', actor())).toBe(true);
    expect(can('assign', actor({ isLead: true }))).toBe(false);
    expect(can('assign', actor({ role: 'COORDINATOR' }))).toBe(true);
  });

  it('start/hold/complete: uczestnik lub przełożony', () => {
    for (const a of ['startWork', 'hold', 'complete'] as const) {
      expect(can(a, actor({ isParticipant: true }))).toBe(true);
      expect(can(a, actor())).toBe(false);
      expect(can(a, actor({ role: 'ADMIN' }))).toBe(true);
    }
  });

  it('zamknięcie/otwarcie, priorytet i „w imieniu” wymagają rangi', () => {
    expect(can('close', actor({ isLead: true, role: 'WORKER' }))).toBe(false);
    expect(can('close', actor({ role: 'COORDINATOR' }))).toBe(true);
    expect(can('reopen', actor({ role: 'COORDINATOR' }))).toBe(true);
    expect(can('changePriority', actor({ role: 'WORKER', isLead: true }))).toBe(false);
    expect(can('logUpdateForOthers', actor({ role: 'COORDINATOR' }))).toBe(true);
    expect(can('logUpdateForOthers', actor({ role: 'WORKER', isParticipant: true }))).toBe(false);
  });

  it('raporty: wgląd i draft u przełożonych, zatwierdzenie tylko admin', () => {
    expect(can('approveReport', actor({ role: 'COORDINATOR' }))).toBe(false);
    expect(can('approveReport', actor({ role: 'ADMIN' }))).toBe(true);
    expect(can('viewReports', actor())).toBe(false);
    expect(can('viewReports', actor({ role: 'COORDINATOR' }))).toBe(true);
    expect(can('editReportDraft', actor({ role: 'COORDINATOR' }))).toBe(true);
  });

  it('słowniki i konta wyłącznie dla przełożonych; role tylko dla admina', () => {
    expect(can('manageLocations', actor({ role: 'COORDINATOR' }))).toBe(true);
    expect(can('manageCategories', actor({ role: 'COORDINATOR' }))).toBe(true);
    expect(can('manageUsers', actor({ role: 'COORDINATOR' }))).toBe(false);
    expect(can('manageUsers', actor({ role: 'ADMIN' }))).toBe(true);
  });

  it('komentarz jawny dla zespołu; zgłaszający może edytować pola', () => {
    expect(can('comment', actor())).toBe(true);
    expect(can('editFields', actor({ isRequester: true }))).toBe(true);
    expect(can('editFields', actor())).toBe(false);
    expect(can('addUnrequestedWork', actor())).toBe(true);
    expect(can('addMaterial', actor({ isParticipant: true }))).toBe(true);
    expect(can('addMaterial', actor())).toBe(false);
  });

  it('każda akcja ma regułę (brak „dziur” w tabeli)', () => {
    for (const key of Object.keys(ACTION_RULES)) {
      expect(typeof ACTION_RULES[key as keyof typeof ACTION_RULES]).toBe('function');
    }
  });
});
