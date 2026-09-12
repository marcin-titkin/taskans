import { Link, useNavigate } from 'react-router-dom';
import { useDataEvents, useQueryOnEvents } from '@/data/queries';
import { getDb } from '@/data/db';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { todayDateStr } from '@/features/reports/reportUtils';
import { formatDatePl } from '@/lib/utils';

/** Lista raportów: 14 ostatnich dni + wejście w dziś. */
export function ReportsPage() {
  const v = useDataEvents();
  const navigate = useNavigate();
  const q = useQueryOnEvents(['reportsList'], () => getDb().reports.toArray(), v);
  const days: string[] = [];
  const start = new Date();
  for (let i = 0; i < 14; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() - i);
    days.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
  }
  const byDate = new Map((q.data ?? []).map((r) => [r.report_date, r]));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">Raporty dzienne</h1>
          <p className="text-slate-600">Raport składa się sam — z zadań, aktualizacji i blokad zapisanych w ciągu dnia.</p>
        </div>
        <Button size="lg" onClick={() => navigate(`/raporty/${todayDateStr()}`)}>
          Raport na dziś
        </Button>
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {days.map((d) => {
          const r = byDate.get(d);
          return (
            <Card key={d} className={d === todayDateStr() ? 'ring-2 ring-brand-600' : undefined}>
              <CardHeader>
                <CardTitle as="h2" className="flex items-center justify-between gap-2">
                  <Link to={`/raporty/${d}`} className="underline-offset-2 hover:underline">
                    {formatDatePl(`${d}T12:00:00`)}
                  </Link>
                  {r ? (
                    <Badge tone={r.status === 'APPROVED' ? 'success' : 'warning'}>
                      {r.status === 'APPROVED' ? '✓ zatwierdzony' : '• roboczy'}
                    </Badge>
                  ) : (
                    <Badge tone="neutral">nie wygenerowany</Badge>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-slate-600">
                {r
                  ? `Wykonano: ${r.snapshot_json.counters.completed} • w toku: ${r.snapshot_json.counters.inProgress} • blokady: ${r.snapshot_json.counters.onHold}`
                  : d === todayDateStr()
                    ? 'Otwórz, podejrz sekcje i zapisz wersję roboczą, gdy zespół skończy dzień.'
                    : 'Brak wersji zapisanej tego dnia.'}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
