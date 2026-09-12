import { Badge } from '@/components/ui/badge';
import { priorityClasses, priorityIcons, priorityLabels, statusClasses, statusIcons, statusLabels } from '@/lib/labels';
import type { Priority, WorkOrderStatus } from '@/types/domain';

/**
 * Status i priorytet NIGDY nie są rozpoznawane tylko po kolorze — zawsze ikona + etykieta tekstowa
 * (WCAG 2.2, kryterium 1.4.1 użycie koloru).
 */
export function StatusBadge({ status, dirty }: { status: WorkOrderStatus; dirty?: boolean }) {
  return (
    <Badge className={statusClasses[status]}>
      <span aria-hidden="true">{statusIcons[status]}</span>
      {statusLabels[status]}
      {dirty ? (
        <span className="ml-1 text-xs font-normal text-slate-600" title="Zapisano lokalnie, czeka na synchronizację">
          • czeka na sync
        </span>
      ) : null}
    </Badge>
  );
}

export function PriorityBadge({ priority, size = 'sm' }: { priority: Priority; size?: 'sm' | 'md' }) {
  const label = priorityLabels[priority];
  const icon = priorityIcons[priority];
  return (
    <Badge
      className={`${priorityClasses[priority]} ${size === 'md' ? 'px-3 py-1 text-base' : ''}`}
      aria-label={`Priorytet: ${label}`}
    >
      <span aria-hidden="true">{icon}</span>
      {label}
    </Badge>
  );
}
