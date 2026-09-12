import type { Priority, WorkOrderStatus } from '@/types/domain';

/**
 * Kontrolowany przepływ statusów — jedno źródło prawdy dla klienta, demo backendu i dokumentacji.
 * Po stronie bazy macierz egzekwuje funkcja `public.app_validate_transition` (migracja 0002).
 * Test `transitions.test.ts` pilnuje, żeby obie wersje się nie rozjechały.
 */
export const TRANSITION_MATRIX: Record<WorkOrderStatus, readonly WorkOrderStatus[]> = {
  NEW: ['ASSIGNED', 'ON_HOLD', 'CLOSED', 'DONE'],
  ASSIGNED: ['IN_PROGRESS', 'ON_HOLD', 'NEW', 'CLOSED', 'DONE'],
  IN_PROGRESS: ['ON_HOLD', 'DONE'],
  ON_HOLD: ['IN_PROGRESS', 'ASSIGNED', 'CLOSED'],
  DONE: ['CLOSED', 'REOPENED'],
  CLOSED: ['REOPENED'],
  REOPENED: ['IN_PROGRESS', 'ASSIGNED', 'ON_HOLD', 'DONE', 'CLOSED'],
} as const;

export function canTransition(from: WorkOrderStatus, to: WorkOrderStatus): boolean {
  return TRANSITION_MATRIX[from].includes(to);
}

export interface TransitionContext {
  message?: string | null;
  completionSummary?: string | null;
  holdReason?: string | null;
  holdDetails?: string | null;
  nextAction?: string | null;
}

/**
 * Reguły dodatkowe przy zmianie statusu (z briefu):
 * - WSTRZYMANE: wymagan powód + opis + następny krok.
 * - WYKONANE: wymagany krótki opis rezultatu.
 * - Ponowne otwarcie i zamknięcie: wymagany komentarz dyrektora.
 * Zwraca listę komunikatów po polsku (pusta = OK).
 */
export function validateTransition(to: WorkOrderStatus, ctx: TransitionContext): string[] {
  const errors: string[] = [];
  switch (to) {
    case 'ON_HOLD':
      if (!ctx.holdReason) errors.push('Wybierz powód wstrzymania.');
      if (!isFilled(ctx.holdDetails)) errors.push('Opisz krótko sytuację (co się dzieje).');
      if (!isFilled(ctx.nextAction)) errors.push('Podaj następny krok — co trzeba zrobić, żeby ruszyć dalej.');
      break;
    case 'DONE':
      if (!isFilled(ctx.completionSummary)) errors.push('Krótko napisz, co zostało wykonane i jaki jest rezultat.');
      break;
    case 'REOPENED':
      if (!isFilled(ctx.message)) errors.push('Napisz, dlaczego zadanie wraca do pracy.');
      break;
    case 'CLOSED':
      if (ctx.message && !isFilled(ctx.message)) errors.push('Komentarz zamknięcia nie może być samymi spacjami.');
      break;
    default:
      break;
  }
  return errors;
}

/** Czy priorytet został „poważnie podniesiony” (do powiadomień). */
export function isEscalation(from: Priority, to: Priority): boolean {
  const rank: Record<Priority, number> = { NORMAL: 0, URGENT: 1, BREAKDOWN: 2 };
  return rank[to] > rank[from] && rank[to] >= 1;
}

/** Kolejność na liście: najpierw awarie i pilne, potem po terminie i dacie zgłoszenia. */
export function compareForQueue(
  a: { priority: Priority; expected_date: string | null; created_at: string },
  b: { priority: Priority; expected_date: string | null; created_at: string }
): number {
  const rank: Record<Priority, number> = { BREAKDOWN: 0, URGENT: 1, NORMAL: 2 };
  if (rank[a.priority] !== rank[b.priority]) return rank[a.priority] - rank[b.priority];
  const da = a.expected_date ?? '9999-12-31';
  const db = b.expected_date ?? '9999-12-31';
  if (da !== db) return da < db ? -1 : 1;
  return a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0;
}

function isFilled(v: string | null | undefined): boolean {
  return typeof v === 'string' && v.trim().length > 0;
}

export const OPEN_STATUSES: readonly WorkOrderStatus[] = ['NEW', 'ASSIGNED', 'IN_PROGRESS', 'ON_HOLD', 'REOPENED'];
export const TERMINAL_OR_DONE: readonly WorkOrderStatus[] = ['DONE', 'CLOSED'];

export function isOpen(status: WorkOrderStatus): boolean {
  return OPEN_STATUSES.includes(status);
}
