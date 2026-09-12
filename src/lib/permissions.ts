import type { UserRole } from '@/types/domain';

/**
 * Reguły uprawnień klienta — lustrzane odbicie polityk RLS z `supabase/migrations`.
 * Serwer (RLS + funkcje) jest źródłem prawdy; ten moduł służy do:
 *  - sterowania widocznością przycisków (UX),
 *  - testów demo backendu (ta sama logika musi przepuszczać/odrzucać te same operacje, co RLS).
 * Test `permissions.test.ts` porównuje tablicę decyzyjną z oczekiwaniami, a `scripts/rls/test-rls.mjs` weryfikuje odpowiedniki w SQL.
 */

export function isManager(role: UserRole): boolean {
  return role === 'ADMIN' || role === 'COORDINATOR';
}

export function isAdmin(role: UserRole): boolean {
  return role === 'ADMIN';
}

export interface ActorContext {
  userId: string;
  role: UserRole;
  /** Czy aktor jest prowadzącym lub współpracownikiem zadania. */
  isParticipant: boolean;
  /** Czy aktor jest prowadzącym zadania. */
  isLead: boolean;
  /** Czy aktor zgłosił zadanie. */
  isRequester: boolean;
}

export type Action =
  | 'createWorkOrder'
  | 'editFields'
  | 'assign'
  | 'changePriority'
  | 'startWork'
  | 'hold'
  | 'complete'
  | 'comment'
  | 'logUpdateForOthers'
  | 'close'
  | 'reopen'
  | 'addUnrequestedWork'
  | 'addMaterial'
  | 'viewReports'
  | 'editReportDraft'
  | 'approveReport'
  | 'manageUsers'
  | 'manageCategories'
  | 'manageLocations';

/** Kto może co — zgodnie z briefem i politykami RLS. */
export const ACTION_RULES: Record<Action, (ctx: ActorContext) => boolean> = {
  createWorkOrder: () => true,
  // Uwaga: „zgłaszający tylko gdy status NEW” egzekwuje reduktor/serwer (tu nie mamy statusu w ctx).
  editFields: (c) => isManager(c.role) || c.isRequester,
  assign: (c) => isManager(c.role),
  changePriority: (c) => isManager(c.role),
  // Wykonawca startuje tylko tam, gdzie jest przydzielony; kierownik/dyrektor może wszędzie (w tym „w imieniu”).
  startWork: (c) => isManager(c.role) || c.isParticipant,
  hold: (c) => isManager(c.role) || c.isParticipant,
  complete: (c) => isManager(c.role) || c.isParticipant,
  comment: () => true, // przejrzystość zespołu: komentarz może dodać każdy członek zespołu
  logUpdateForOthers: (c) => isManager(c.role), // wykonywanie „w imieniu” pracownika bez smartfona
  close: (c) => isManager(c.role),
  reopen: (c) => isManager(c.role),
  addUnrequestedWork: () => true,
  addMaterial: (c) => isManager(c.role) || c.isParticipant,
  viewReports: (c) => isManager(c.role),
  editReportDraft: (c) => isManager(c.role),
  approveReport: (c) => isAdmin(c.role), // tylko dyrektor/administrator
  manageUsers: (c) => isAdmin(c.role),
  manageCategories: (c) => isManager(c.role),
  manageLocations: (c) => isManager(c.role),
};

export function can(action: Action, ctx: ActorContext): boolean {
  return ACTION_RULES[action](ctx);
}
