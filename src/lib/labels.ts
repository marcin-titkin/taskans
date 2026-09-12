import type { Priority, UserRole, WorkOrderStatus, NotificationKind, MaterialStatus } from '@/types/domain';

export const statusLabels: Record<WorkOrderStatus, string> = {
  NEW: 'Nowe',
  ASSIGNED: 'Przydzielone',
  IN_PROGRESS: 'W trakcie',
  ON_HOLD: 'Wstrzymane',
  DONE: 'Wykonane',
  CLOSED: 'Zamknięte',
  REOPENED: 'Ponownie otwarte',
};

/** Ikony towarzyszą etykietom — status nigdy nie jest rozpoznawany tylko po kolorze. */
export const statusIcons: Record<WorkOrderStatus, string> = {
  NEW: '●',
  ASSIGNED: '→',
  IN_PROGRESS: '▶',
  ON_HOLD: '⏸',
  DONE: '✓',
  CLOSED: '■',
  REOPENED: '↺',
};

export const priorityLabels: Record<Priority, string> = {
  BREAKDOWN: 'AWARIA',
  URGENT: 'PILNE',
  NORMAL: 'ZWYKŁE',
};

export const priorityIcons: Record<Priority, string> = {
  BREAKDOWN: '⚠',
  URGENT: '▲',
  NORMAL: '▬',
};

export const priorityDescriptions: Record<Priority, string> = {
  BREAKDOWN: 'Ryzyko dla ludzi, mienia lub działania obiektu',
  URGENT: 'Utrudnia zajęcia, pracę administracji lub ważne wydarzenie',
  NORMAL: 'Może zostać wykonane zgodnie z kolejką',
};

export const roleLabels: Record<UserRole, string> = {
  ADMIN: 'Dyrektor / Administrator',
  COORDINATOR: 'Koordynator',
  WORKER: 'Wykonawca',
};

export const notificationLabels: Record<NotificationKind, string> = {
  ASSIGNED: "Nowy przydział",
  PRIORITY_ESCALATED: 'Zmiana priorytetu',
  HOLD_RAISED: 'Blokada wymaga decyzji',
  HOLD_REPLY: 'Odpowiedź na blokadę',
  REOPENED: 'Zadanie ponownie otwarte',
};

export const materialStatusLabels: Record<MaterialStatus, string> = {
  REQUESTED: 'Zgłoszone',
  APPROVED: 'Zatwierdzone',
  BOUGHT: 'Kupione / dostarczone',
};

/** Powody wstrzymania — stałe, zrozumiałe listy do wyboru (RLS nie ufa dowolnemu tekstowi, UI porządkuje dane). */
export const holdReasonOptions = [
  { value: 'brak_materialow', label: 'Brak materiałów lub części' },
  { value: 'czekam_na_zamowienie', label: 'Czekam na zamówienie / dostawę' },
  { value: 'firma_zewnetrzna', label: 'Wymagana firma zewnętrzna' },
  { value: 'brak_dostepu', label: 'Brak dostępu do pomieszczenia' },
  { value: 'zglloszenie_glowne', label: 'Wymaga decyzji przełożonego' },
  { value: 'warunki', label: 'Warunki uniemożliwiają pracę (pogoda, bezpieczeństwo)' },
  { value: 'inne', label: 'Inny powód' },
] as const;

export type HoldReason = (typeof holdReasonOptions)[number]['value'];

export function holdReasonLabel(value: string): string {
  return holdReasonOptions.find((o) => o.value === value)?.label ?? value;
}

export function formatWorkOrderNumber(n: number): string {
  return `ZL-${String(n).padStart(4, '0')}`;
}

/** Kontrastowe pary klas dla plakietek priorytetu (ikona + tekst + kolor). */
export const priorityClasses: Record<Priority, string> = {
  BREAKDOWN: 'bg-red-50 text-red-800 border-red-300',
  URGENT: 'bg-orange-50 text-orange-800 border-orange-300',
  NORMAL: 'bg-blue-50 text-blue-900 border-blue-200',
};

export const statusClasses: Record<WorkOrderStatus, string> = {
  NEW: 'bg-slate-100 text-slate-800 border-slate-300',
  ASSIGNED: 'bg-sky-50 text-sky-900 border-sky-300',
  IN_PROGRESS: 'bg-amber-50 text-amber-900 border-amber-300',
  ON_HOLD: 'bg-rose-50 text-rose-900 border-rose-300',
  DONE: 'bg-emerald-50 text-emerald-900 border-emerald-300',
  CLOSED: 'bg-slate-200 text-slate-800 border-slate-400',
  REOPENED: 'bg-violet-50 text-violet-900 border-violet-300',
};
