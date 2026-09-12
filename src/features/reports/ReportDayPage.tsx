import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Printer, Save, Stamp, RefreshCw } from 'lucide-react';
import { useAuth } from '@/features/auth/AuthProvider';
import { useDataEvents, useProfiles, useQueryOnEvents } from '@/data/queries';
import { getDb } from '@/data/db';
import { mutations } from '@/data/repository';
import { computeReport, shiftDate, todayDateStr } from '@/features/reports/reportUtils';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Label, Textarea } from '@/components/ui/form';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { formatDatePl, weekdayNamePl, initials } from '@/lib/utils';
import { holdReasonLabel } from '@/lib/labels';
import type { DailyReportEntry, DailyReportSnapshot } from '@/types/domain';

function EntryRow({ e }: { e: DailyReportEntry }) {
  return (
    <li className="flex flex-col gap-1 border-b border-slate-200 py-2 last:border-b-0 md:flex-row md:items-baseline md:gap-3">
      <span className="w-20 shrink-0 font-mono text-xs text-slate-500">ZL-{String(e.sequential_number).padStart(4, '0')}</span>
      <span className="min-w-0 flex-1">
        <Link to={`/zlecenia/${e.work_order_id}`} className="font-bold text-slate-900 underline-offset-2 hover:underline print:no-underline">
          {e.title}
        </Link>
        {e.location ? <span className="text-slate-600"> — {e.location}</span> : null}
        <span className="block text-[15px] text-slate-800">{e.summary}</span>
        {e.hold_reason ? <span className="block text-sm text-rose-800">Blokada: {holdReasonLabel(e.hold_reason)}</span> : null}
        {e.next_action ? <span className="block text-sm text-slate-700"><strong>Dalej:</strong> {e.next_action}</span> : null}
      </span>
      <span className="flex shrink-0 items-center gap-1 text-sm text-slate-600">
        {e.workers.length > 0 ? (
          <>
            {e.workers.slice(0, 3).map((w) => (
              <span key={w} className="grid h-7 w-7 place-items-center rounded-full bg-slate-200 text-[10px] font-bold text-slate-700" title={w} aria-label={w}>
                {initials(w)}
              </span>
            ))}
            <span>{e.workers.join(', ')}</span>
          </>
        ) : (
          <span className="text-slate-500">—</span>
        )}
      </span>
    </li>
  );
}

function Section({ title, entries, tone }: { title: string; entries: DailyReportEntry[]; tone?: 'rose' | 'amber' | 'emerald' | 'slate' | 'violet' | 'sky' }) {
  const toneClass =
    tone === 'rose'
      ? 'border-rose-300 bg-rose-50/40'
      : tone === 'amber'
        ? 'border-amber-300 bg-amber-50/40'
        : tone === 'emerald'
          ? 'border-emerald-300 bg-emerald-50/40'
          : tone === 'violet'
            ? 'border-violet-300 bg-violet-50/40'
            : tone === 'sky'
              ? 'border-sky-300 bg-sky-50/40'
              : 'border-slate-200 bg-white';
  return (
    <section className={`rounded-2xl border p-4 ${toneClass}`} aria-label={title}>
      <h2 className="mb-2 flex items-center justify-between text-lg font-extrabold">
        {title}
        <span className="text-sm font-semibold text-slate-600">{entries.length}</span>
      </h2>
      {entries.length === 0 ? (
        <p className="text-sm text-slate-600">Brak pozycji w tej sekcji.</p>
      ) : (
        <ul>
          {entries.map((e) => (
            <EntryRow key={`${title}-${e.work_order_id}`} e={e} />
          ))}
        </ul>
      )}
    </section>
  );
}

export function ReportDayPage() {
  const { date = todayDateStr() } = useParams();
  const navigate = useNavigate();
  const { profile } = useAuth();
  const v = useDataEvents();
  const profiles = useProfiles();
  const [live, setLive] = useState<DailyReportSnapshot | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [confirmApprove, setConfirmApprove] = useState(false);
  const [busy, setBusy] = useState(false);

  const saved = useQueryOnEvents(['report', date], () => getDb().reports.where('report_date').equals(date).first(), v);
  const isApproved = saved.data?.status === 'APPROVED';
  const snapshot = isApproved ? saved.data!.snapshot_json : (saved.data?.snapshot_json ?? live);

  useEffect(() => {
    if (!profile) return;
    void computeReport(date, profile.id).then((s) => {
      setLive(s);
      setNote(saved.data?.general_note ?? null);
    });
    // odśwież przy każdej zmianie danych, chyba że zatwierdzony (wtedy snapshot jest niezmienny)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, v, profile?.id, isApproved]);

  if (!profile || !snapshot) return <p role="status" className="py-8 text-center text-slate-600">Budowanie raportu…</p>;

  const isAdmin = profile.role === 'ADMIN';
  const generatedByName = profiles.data?.find((p) => p.id === saved.data?.generated_by)?.display_name ?? snapshot.generated_by_name;

  async function saveDraft() {
    setBusy(true);
    await mutations.saveReportDraft(date, snapshot!, note);
    setBusy(false);
  }
  async function approve() {
    setBusy(true);
    await mutations.approveReport(date, snapshot!, note);
    setBusy(false);
    setConfirmApprove(false);
  }
  async function regenerate() {
    setBusy(true);
    const fresh = await computeReport(date, profile!.id);
    await mutations.saveReportDraft(date, fresh, note);
    setLive(fresh);
    setBusy(false);
  }

  return (
    <div className="space-y-4 print:p-0">
      <div className="flex flex-wrap items-center justify-between gap-3 print-hide">
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" aria-label="Poprzedni dzień" onClick={() => navigate(`/raporty/${shiftDate(date, -1)}`)}>
            <ChevronLeft className="h-6 w-6" aria-hidden="true" />
          </Button>
          <div>
            <h1 className="text-xl font-extrabold leading-6">{formatDatePl(`${date}T12:00:00`)}</h1>
            <p className="text-sm text-slate-600">{weekdayNamePl(`${date}T12:00:00`)}</p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Następny dzień"
            disabled={date >= todayDateStr()}
            onClick={() => navigate(`/raporty/${shiftDate(date, 1)}`)}
          >
            <ChevronRight className="h-6 w-6" aria-hidden="true" />
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {isApproved ? (
            <Badge tone="success" className="text-base">
              ✓ Zatwierdzony {saved.data?.approved_at ? `przez ${profiles.data?.find((p) => p.id === saved.data?.approved_by)?.display_name ?? ''}` : ''} — wersja niezmienna
            </Badge>
          ) : saved.data ? (
            <Badge tone="warning" className="text-base">
              wersja robocza zapisana
            </Badge>
          ) : (
            <Badge tone="neutral" className="text-base">
              raport liczony na bieżąco
            </Badge>
          )}
          <Button variant="outline" onClick={() => window.print()}>
            <Printer className="h-5 w-5" aria-hidden="true" /> Drukuj / PDF
          </Button>
          {!isApproved ? (
            <>
              <Button variant="secondary" onClick={() => void regenerate()} disabled={busy}>
                <RefreshCw className="h-5 w-5" aria-hidden="true" /> Odśwież z danych
              </Button>
              <Button onClick={() => void saveDraft()} disabled={busy}>
                <Save className="h-5 w-5" aria-hidden="true" /> Zapisz roboczą
              </Button>
              {isAdmin ? (
                <Button className="bg-emerald-700 hover:bg-emerald-800" onClick={() => setConfirmApprove(true)} disabled={busy}>
                  <Stamp className="h-5 w-5" aria-hidden="true" /> Zatwierdź raport
                </Button>
              ) : null}
            </>
          ) : null}
        </div>
      </div>

      <Card className="print-area">
        <CardHeader className="border-b border-slate-200">
          <CardTitle className="flex flex-wrap items-baseline justify-between gap-2 text-xl">
            <span>Raport dzienny — {formatDatePl(`${date}T12:00:00`)}</span>
            <span className="text-sm font-medium text-slate-600">
              wygenerowany {new Date(snapshot.generated_at).toLocaleString('pl-PL')} • {generatedByName}
            </span>
          </CardTitle>
          <div className="flex flex-wrap gap-2 text-sm text-slate-700" aria-label="Podsumowanie dnia">
            <Badge>wykonane: {snapshot.counters.completed}</Badge>
            <Badge>w toku: {snapshot.counters.inProgress}</Badge>
            <Badge tone={snapshot.counters.onHold ? 'danger' : 'neutral'}>wstrzymane: {snapshot.counters.onHold}</Badge>
            <Badge tone={snapshot.counters.newUrgent ? 'warning' : 'neutral'}>nowe pilne: {snapshot.counters.newUrgent}</Badge>
            <Badge tone="info">bez zlecenia: {snapshot.counters.unrequested}</Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <Section title="1. Wykonano dzisiaj" entries={snapshot.sections.completed} tone="emerald" />
          <Section title="2. Prace w toku" entries={snapshot.sections.inProgress} tone="sky" />
          <Section title="3. Prace wstrzymane" entries={snapshot.sections.onHold} tone="rose" />
          <Section title="4. Nowe pilne sprawy" entries={snapshot.sections.newUrgent} tone="amber" />

          <section className="rounded-2xl border border-slate-200 bg-white p-4" aria-label="5. Materiały lub zakupy potrzebne do kontynuacji">
            <h2 className="mb-2 text-lg font-extrabold">5. Materiały lub zakupy potrzebne do kontynuacji</h2>
            {snapshot.sections.materials.length === 0 ? (
              <p className="text-sm text-slate-600">Brak zgłoszonych potrzeb materiałowych.</p>
            ) : (
              <ul className="space-y-1 text-[15px]">
                {snapshot.sections.materials.map((m, i) => (
                  <li key={`${m.name}-${i}`}>
                    • <strong>{m.name}</strong> — {m.quantity} {m.unit} <span className="text-slate-600">({m.workOrderTitle})</span>
                    {m.note ? <span className="block text-sm text-slate-600">uwaga: {m.note}</span> : null}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <Section title="6. Przekazane na następny dzień / zmianę" entries={snapshot.sections.handover} tone="violet" />
          <Section title="7. Prace wykonane bez wcześniejszego zlecenia" entries={snapshot.sections.unrequested} tone="slate" />

          <section className="rounded-2xl border border-slate-300 bg-slate-50 p-4" aria-label="8. Ogólna uwaga osoby zatwierdzającej">
            <h2 className="mb-2 text-lg font-extrabold">8. Ogólna uwaga osoby zatwierdzającej</h2>
            {isApproved ? (
              <p className="whitespace-pre-wrap text-[15px]">{saved.data?.general_note?.trim() ? saved.data.general_note : '— (bez uwag)'}</p>
            ) : (
              <div className="space-y-1.5">
                <Label htmlFor="gen-note">Jedna ogólna uwaga na cały dzień (nie opisuj zadań ponownie — one są wyżej).</Label>
                <Textarea id="gen-note" value={note ?? ''} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="np. Jutro priorytet: zasilacz na korytarz; proszę nie planować nowych prac do 10:00." />
              </div>
            )}
          </section>

          {isApproved ? (
            <p className="text-sm text-slate-600">
              Zatwierdzony raport jest zapisany jako niezmienny snapshot — późniejsze zmiany zadań nie zmieniają tego dokumentu.
            </p>
          ) : null}
        </CardContent>
      </Card>

      {!isApproved && !saved.data ? (
        <p className="text-sm text-slate-600 print-hide">
          Widok liczony na bieżąco z danych zespołu. „Zapisz roboczą” zamrozi tę wersję (można ją odświeżyć przed zatwierdzeniem), a „Zatwierdź” zapisze niezmienialny snapshot.
        </p>
      ) : null}

      <ConfirmDialog
        open={confirmApprove}
        onOpenChange={setConfirmApprove}
        title="Zatwierdzić raport dzienny?"
        description={
          <>
            Zatwierdzona wersja staje się <strong>niezmiennym dokumentem</strong> (snapshot). Późniejsze zmiany w zadaniach
            nie nadpiszą raportu. Raport będzie można wydrukować lub pobrać jako PDF.
          </>
        }
        confirmLabel="Tak, zatwierdź"
        busy={busy}
        onConfirm={() => void approve()}
      />
    </div>
  );
}
