import { getDb } from '@/data/db';
import { buildDailyReport } from '@/data/reducer';
import type { DailyReportSnapshot } from '@/types/domain';

/** Buduje raport z bieżącego cache’u — te same dane, które zapisywał zespół w ciągu dnia. */
export async function computeReport(date: string, generatedById: string): Promise<DailyReportSnapshot> {
  const db = getDb();
  const [workOrders, updates, assignees, attachments, materials, notifications, reports, profiles, locations, categories, meta] =
    await Promise.all([
      db.workOrders.toArray(),
      db.updates.toArray(),
      db.assignees.toArray(),
      db.attachments.toArray(),
      db.materials.toArray(),
      db.notifications.toArray(),
      db.reports.toArray(),
      db.profiles.toArray(),
      db.locations.toArray(),
      db.categories.toArray(),
      db.meta.get('nextNumber'),
    ]);
  const author = profiles.find((p) => p.id === generatedById) ?? {
    id: generatedById,
    display_name: 'System',
    role: 'WORKER' as const,
    active: true,
  };
  void attachments;
  void notifications;
  void reports;
  void categories;
  void meta;
  return buildDailyReport(
    {
      workOrders: workOrders.map(({ dirty: _d, ...rest }) => rest),
      updates,
      assignees,
      materials,
      profiles,
      locations,
    },
    date,
    author
  );
}

export function todayDateStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function shiftDate(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00`);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
