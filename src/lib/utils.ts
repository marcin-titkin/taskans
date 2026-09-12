export function cn(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(' ');
}

const MONTHS_GEN = [
  'stycznia',
  'lutego',
  'marca',
  'kwietnia',
  'maja',
  'czerwca',
  'lipca',
  'sierpnia',
  'września',
  'października',
  'listopada',
  'grudnia',
];

const WEEKDAYS = ['niedziela', 'poniedziałek', 'wtorek', 'środa', 'czwartek', 'piątek', 'sobota'];

function parseDate(value: string | Date): Date {
  return value instanceof Date ? value : new Date(value);
}

/** „12 września 2026” */
export function formatDatePl(value: string | Date): string {
  const d = parseDate(value);
  if (Number.isNaN(d.getTime())) return '—';
  return `${d.getDate()} ${MONTHS_GEN[d.getMonth()]} ${d.getFullYear()}`;
}

/** „12.09, 14:30” — skrót dla osi czasu. */
export function formatDateTimePl(value: string | Date): string {
  const d = parseDate(value);
  if (Number.isNaN(d.getTime())) return '—';
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${dd}.${mm}, ${hh}:${mi}`;
}

export function weekdayNamePl(value: string | Date): string {
  return WEEKDAYS[parseDate(value).getDay()] ?? '';
}

/** „przed chwilą / 14 minut / 3 godziny / wczoraj / 5 dni temu” */
export function relTimePl(value: string | Date, now: Date = new Date()): string {
  const d = parseDate(value);
  const diffSec = Math.round((now.getTime() - d.getTime()) / 1000);
  if (diffSec < 60) return 'przed chwilą';
  const min = Math.floor(diffSec / 60);
  if (min < 60) return `${min} ${plural(min, 'minutę', 'minuty', 'minut')} temu`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours} ${plural(hours, 'godzinę', 'godziny', 'godzin')} temu`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'wczoraj';
  if (days < 31) return `${days} ${plural(days, 'dzień', 'dni', 'dni')} temu`;
  return formatDatePl(d);
}

export function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (n === 1) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
  return many;
}

/** „za 2 dni / jutro / dziś / 3 dni po terminie” */
export function dueLabelPl(expectedDate: string, now: Date = new Date()): string | null {
  const today = startOfToday(now);
  const due = new Date(`${expectedDate}T00:00:00`);
  if (Number.isNaN(due.getTime())) return null;
  const days = Math.round((due.getTime() - today.getTime()) / 86400000);
  if (days < 0) return `${-days} ${plural(-days, 'dzień', 'dni', 'dni')} po terminie`;
  if (days === 0) return 'dzisiaj';
  if (days === 1) return 'jutro';
  return `za ${days} ${plural(days, 'dzień', 'dni', 'dni')}`;
}

export function startOfToday(now: Date = new Date()): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

export function toDateInputValue(d: Date): string {
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

export function isSameDay(a: string | Date, b: string | Date): boolean {
  const da = parseDate(a);
  const db = parseDate(b);
  return (
    da.getFullYear() === db.getFullYear() && da.getMonth() === db.getMonth() && da.getDate() === db.getDate()
  );
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((p) => p[0] ?? '')
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} kB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** Bezpieczne etykiety dla aria-live (bez HTML). */
export function humanList(items: string[]): string {
  if (items.length === 0) return '';
  if (items.length === 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} i ${items.at(-1)}`;
}
