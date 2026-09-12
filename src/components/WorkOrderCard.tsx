import { Link } from 'react-router-dom';
import { CalendarClock, MapPin, User } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { PriorityBadge, StatusBadge } from '@/components/StatusBadges';
import { dueLabelPl } from '@/lib/utils';
import { formatWorkOrderNumber } from '@/lib/labels';
import type { Category, ProfileLite } from '@/components/types';
import type { CachedWorkOrder } from '@/data/db';

export interface WorkOrderCardProps {
  /** poziom nagłówka tytułu — na stronach bez sekcji h2 podnieś do 'h2' (kolejność nagłówków a11y) */
  titleTag?: 'h2' | 'h3';
  wo: CachedWorkOrder;
  locationName: string | null;
  lead: ProfileLite | null;
  category: Category | null;
  to?: string;
}

/** Karta zadania — tytuł, lokalizacja, priorytet, status, prowadzący, termin (wg briefu). */
export function WorkOrderCard({ wo, locationName, lead, category, to, titleTag = 'h3' }: WorkOrderCardProps) {
  const TitleTag = titleTag;
  const due = wo.expected_date ? dueLabelPl(wo.expected_date) : null;
  const overdue = due?.includes('po terminie');
  const href = to ?? `/zlecenia/${wo.id}`;
  return (
    <Card className="transition-shadow hover:shadow-md">
      <Link
        to={href}
        className="flex min-h-12 flex-col gap-2 rounded-2xl p-4 focus-visible:outline-3"
        aria-label={`${formatWorkOrderNumber(wo.sequential_number)}: ${wo.title}`}
      >
        <div className="flex flex-wrap items-center gap-2">
          <PriorityBadge priority={wo.priority} />
          <StatusBadge status={wo.status} dirty={wo.dirty} />
          <span className="ml-auto font-mono text-xs text-slate-500">{formatWorkOrderNumber(wo.sequential_number)}</span>
        </div>
        <TitleTag className="text-lg font-bold leading-6 text-slate-900">{wo.title}</TitleTag>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-slate-700">
          <span className="inline-flex items-center gap-1.5">
            <MapPin className="h-4 w-4 shrink-0" aria-hidden="true" />
            {locationName ?? 'brak lokalizacji'}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <User className="h-4 w-4 shrink-0" aria-hidden="true" />
            {lead ? `Prowadzi: ${lead.display_name}` : 'Brak prowadzącego'}
          </span>
          {category ? (
            <span className="inline-flex items-center gap-1.5 text-slate-600">
              <span
                className="inline-block h-2.5 w-2.5 rounded-full border border-slate-400"
                style={{ backgroundColor: category.color ?? '#94a3b8' }}
                aria-hidden="true"
              />
              {category.name}
            </span>
          ) : null}
          {wo.expected_date ? (
            <span className={`inline-flex items-center gap-1.5 ${overdue ? 'font-semibold text-red-700' : 'text-slate-600'}`}>
              <CalendarClock className="h-4 w-4 shrink-0" aria-hidden="true" />
              {due ? `Termin: ${due}` : wo.expected_date}
            </span>
          ) : null}
        </div>
      </Link>
    </Card>
  );
}
