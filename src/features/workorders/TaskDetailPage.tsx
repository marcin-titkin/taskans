import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  CalendarClock,
  DoorOpen,
  KeyRound,
  MapPin,
  Pause,
  PencilLine,
  Play,
  Repeat,
  ShoppingCart,
  SquareCheck,
  MessageSquarePlus,
  UserCheck,
} from 'lucide-react';
import { useAuth } from '@/features/auth/AuthProvider';
import { useCategories, useDataEvents, useLocations, useProfiles, useQueryOnEvents, useWorkOrder } from '@/data/queries';
import { getDb } from '@/data/db';
import { mutations } from '@/data/repository';
import { getGateway } from '@/data/repository';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Field, Label, Textarea, Input } from '@/components/ui/form';
import { PriorityBadge, StatusBadge } from '@/components/StatusBadges';
import { HoldDialog, CompleteDialog, UpdateDialog, ReopenDialog } from '@/components/dialogs/TaskActionDialogs';
import { HistoryTimeline, PhotoStrip } from '@/components/HistoryTimeline';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { ReassignDialog } from '@/features/workorders/ReassignDialog';
import { formatWorkOrderNumber, holdReasonLabel, priorityLabels, statusLabels } from '@/lib/labels';
import { can, isManager } from '@/lib/permissions';
import { dueLabelPl, relTimePl } from '@/lib/utils';
import type { Priority } from '@/types/domain';
import { materialStatusLabels } from '@/lib/labels';

export function TaskDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { profile } = useAuth();
  const v = useDataEvents();
  const detail = useWorkOrder(id);
  const profiles = useProfiles();
  const locations = useLocations(true);
  const categories = useCategories(true);
  const reportsForWo = useQueryOnEvents(['reportsFor', id], async () => (await getDb().reports.toArray()).filter((r) => JSON.stringify(r.snapshot_json).includes(id)), v);

  const [dlg, setDlg] = useState<null | 'hold' | 'complete' | 'update' | 'note' | 'reopen' | 'close' | 'resume' | 'reassign'>(null);
  const [busy, setBusy] = useState(false);

  const wo = detail.data?.workOrder;
  const isParticipant = useMemo(() => {
    if (!wo || !profile) return false;
    if (wo.lead_worker_id === profile.id) return true;
    return (detail.data?.assignees ?? []).some((a) => a.user_id === profile.id);
  }, [wo, profile, detail.data?.assignees]);

  if (!profile || !wo) {
    return (
      <div className="py-10 text-center">
        {detail.isError ? <p role="alert" className="text-red-700">Nie znaleziono zadania lub brak dostępu.</p> : <p role="status">Ładowanie zadania…</p>}
        <Button className="mt-4" variant="outline" onClick={() => navigate(-1)}>
          Wróć
        </Button>
      </div>
    );
  }

  const ctx = {
    userId: profile.id,
    role: profile.role,
    isParticipant,
    isLead: wo.lead_worker_id === profile.id,
    isRequester: wo.requester_id === profile.id,
  };
  const manager = isManager(profile.role);
  const location = locations.data?.find((l) => l.id === wo.location_id) ?? null;
  const category = categories.data?.find((c) => c.id === wo.category_id) ?? null;
  const lead = profiles.data?.find((p) => p.id === wo.lead_worker_id) ?? null;
  const helpers = (detail.data?.assignees ?? []).filter((a) => a.assignment_type === 'HELPER').map((a) => profiles.data?.find((p) => p.id === a.user_id)).filter(Boolean);
  const due = wo.expected_date ? dueLabelPl(wo.expected_date) : null;
  const overdue = due?.includes('po terminie');

  async function act(next: Parameters<typeof mutations.transition>[1]) {
    setBusy(true);
    await mutations.transition(wo!.id, next, wo!.status, { message: next === 'CLOSED' ? 'Zamknięte po akceptacji.' : null });
    setBusy(false);
    setDlg(null);
  }

  const canStart = can('startWork', ctx) && (wo.status === 'ASSIGNED' || wo.status === 'REOPENED');
  const canHold = can('hold', ctx) && (wo.status === 'IN_PROGRESS' || wo.status === 'ASSIGNED' || wo.status === 'REOPENED' || wo.status === 'NEW');
  const canComplete = can('complete', ctx) && (wo.status === 'IN_PROGRESS' || wo.status === 'ASSIGNED' || wo.status === 'REOPENED' || wo.status === 'NEW');
  const canResume = can('startWork', ctx) && wo.status === 'ON_HOLD';
  const canClose = manager && (wo.status === 'DONE' || wo.status === 'NEW' || wo.status === 'ASSIGNED' || wo.status === 'ON_HOLD');
  const canReopen = manager && (wo.status === 'DONE' || wo.status === 'CLOSED');

  const attachments = detail.data?.attachments ?? [];
  const materials = detail.data?.materials ?? [];
  const reopenHistory = (detail.data?.updates ?? []).filter((u) => u.new_status === 'REOPENED');

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div className="flex items-center justify-between gap-2">
        <Button variant="ghost" size="sm" className="-ml-2" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-5 w-5" aria-hidden="true" /> Wróć
        </Button>
        <Badge tone="outline" className="font-mono">{formatWorkOrderNumber(wo.sequential_number)}</Badge>
      </div>

      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <PriorityBadge priority={wo.priority} size="md" />
          <StatusBadge status={wo.status} dirty={wo.dirty} />
          {wo.is_unrequested ? <Badge tone="info">praca bez zlecenia</Badge> : null}
        </div>
        <h1 className="text-2xl font-extrabold leading-tight tracking-tight">{wo.title}</h1>
        <p className="whitespace-pre-wrap text-[17px] leading-7 text-slate-800">{wo.description}</p>
      </header>

      <Card>
        <CardContent className="grid gap-2 text-[15px] sm:grid-cols-2">
          <p className="flex items-center gap-2">
            <MapPin className="h-5 w-5 shrink-0 text-slate-500" aria-hidden="true" />
            <span>
              <strong>Lokalizacja:</strong> {location?.name ?? '—'}
              {location?.building ? <span className="text-slate-500"> ({location.building}{location.floor ? `, ${location.floor}` : ''}{location.room ? `, ${location.room}` : ''})</span> : null}
            </span>
          </p>
          <p className="flex items-center gap-2">
            <CalendarClock className="h-5 w-5 shrink-0 text-slate-500" aria-hidden="true" />
            <span>
              <strong>Termin:</strong>{' '}
              {wo.expected_date ? (
                <span className={overdue ? 'font-bold text-red-700' : ''}>
                  {wo.expected_date} {due ? `— ${due}` : ''}
                </span>
              ) : (
                'bez terminu'
              )}
            </span>
          </p>
          <p className="flex items-center gap-2">
            <KeyRound className="h-5 w-5 shrink-0 text-slate-500" aria-hidden="true" />
            <span>
              <strong>Zgłosił(a):</strong> {profiles.data?.find((p) => p.id === wo.requester_id)?.display_name ?? '—'}
            </span>
          </p>
          <p className="flex items-center gap-2">
            <UserCheck className="h-5 w-5 shrink-0 text-slate-500" aria-hidden="true" />
            <span>
              <strong>Prowadzący:</strong> {lead?.display_name ?? 'brak przydziału'}
              {helpers.length ? <span> • pomoc: {helpers.map((h) => h!.display_name).join(', ')}</span> : null}
            </span>
          </p>
          {category ? (
            <p className="flex items-center gap-2">
              <span className="inline-block h-3 w-3 rounded-full border border-slate-400" style={{ backgroundColor: category.color ?? '#94a3b8' }} aria-hidden="true" />
              <span>
                <strong>Kategoria:</strong> {category.name}
              </span>
            </p>
          ) : null}
          {wo.contact_person ? (
            <p className="flex items-center gap-2">
              <DoorOpen className="h-5 w-5 shrink-0 text-slate-500" aria-hidden="true" />
              <span>
                <strong>Kontakt:</strong> {wo.contact_person}
              </span>
            </p>
          ) : null}
          {wo.access_notes ? (
            <p className="flex items-start gap-2 sm:col-span-2">
              <DoorOpen className="mt-0.5 h-5 w-5 shrink-0 text-slate-500" aria-hidden="true" />
              <span>
                <strong>Dostęp do pomieszczenia:</strong> {wo.access_notes}
              </span>
            </p>
          ) : null}
        </CardContent>
      </Card>

      {manager ? (
        <Card>
          <CardContent className="flex flex-wrap items-end gap-3">
            <div className="min-w-52 flex-1">
              <Label htmlFor="prio-edit">Priorytet (zmiana widoczna w historii i powiadomieniach)</Label>
              <select
                id="prio-edit"
                className="mt-1 min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3 text-base"
                value={wo.priority}
                onChange={(e) => void mutations.updateFields(wo.id, { priority: e.target.value as Priority })}
              >
                {(Object.keys(priorityLabels) as Priority[]).map((p) => (
                  <option key={p} value={p}>
                    {priorityLabels[p]}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => setDlg('reassign')}>
                <PencilLine className="h-5 w-5" aria-hidden="true" /> Przydział
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {/* ── Cztery duże akcje ─────────────────────────────────────────── */}
      <section aria-label="Akcje wykonawcy" className="grid gap-2">
        <div className="grid gap-2 sm:grid-cols-2">
          <Button size="action" className="bg-emerald-700 hover:bg-emerald-800 active:bg-emerald-900" disabled={!canStart || busy} onClick={() => void act('IN_PROGRESS')}>
            <Play className="h-6 w-6" aria-hidden="true" /> Rozpocznij
          </Button>
          <Button size="action" variant="outline" className="border-amber-500 bg-amber-50 text-amber-950 hover:bg-amber-100" disabled={!canHold || busy} onClick={() => setDlg('hold')}>
            <Pause className="h-6 w-6" aria-hidden="true" /> Wstrzymaj
          </Button>
          <Button size="action" variant="secondary" onClick={() => setDlg('note')}>
            <MessageSquarePlus className="h-6 w-6" aria-hidden="true" /> Dodaj aktualizację
          </Button>
          <Button size="action" variant="default" disabled={!canComplete || busy} onClick={() => setDlg('complete')}>
            <SquareCheck className="h-6 w-6" aria-hidden="true" /> Zakończ
          </Button>
        </div>
        {manager ? (
          <div className="grid gap-2 sm:grid-cols-2">
            {canClose ? (
              <Button size="action" variant="secondary" disabled={busy} onClick={() => setDlg('close')}>
                <SquareCheck className="h-6 w-6" aria-hidden="true" /> Zamknij zadanie
              </Button>
            ) : null}
            {canReopen ? (
              <Button size="action" variant="outline" onClick={() => setDlg('reopen')}>
                <Repeat className="h-6 w-6" aria-hidden="true" /> Ponownie otwórz
              </Button>
            ) : null}
          </div>
        ) : null}
        {canResume ? (
          <Button size="action" variant="default" disabled={busy} onClick={() => void act('IN_PROGRESS')}>
            <Play className="h-6 w-6" aria-hidden="true" /> Wznów pracę
          </Button>
        ) : null}
      </section>

      {wo.status === 'ON_HOLD' ? (
        <Card className="border-rose-300 bg-rose-50/70">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-rose-900">
              <Pause className="h-5 w-5" aria-hidden="true" /> Praca wstrzymana
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-[15px]">
            <p>
              <strong>Powód:</strong> {holdReasonLabel(wo.hold_reason ?? 'inne')}
            </p>
            {wo.hold_details ? <p><strong>Opis:</strong> {wo.hold_details}</p> : null}
            {wo.next_action ? <p><strong>Następny krok:</strong> {wo.next_action}</p> : null}
            {wo.hold_waiting_on ? (
              <p>
                <strong>Czeka na:</strong> {profiles.data?.find((p) => p.id === wo.hold_waiting_on)?.display_name ?? '—'}
              </p>
            ) : null}
            <div className="pt-2" id="komantarz">
              <Button variant="secondary" onClick={() => setDlg('update')}>
                <MessageSquarePlus className="h-5 w-5" aria-hidden="true" /> Odpowiedz / skomentuj
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {wo.completion_summary ? (
        <Card className="border-emerald-300 bg-emerald-50/60">
          <CardHeader>
            <CardTitle className="text-emerald-900">Wynik końcowy</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-[15px] leading-6">{wo.completion_summary}</p>
            {wo.completed_at ? <p className="mt-1 text-sm text-slate-600">Wykonano {relTimePl(wo.completed_at)}.</p> : null}
          </CardContent>
        </Card>
      ) : null}

      {reopenHistory.length > 0 ? (
        <Card className="border-violet-300 bg-violet-50/50">
          <CardHeader>
            <CardTitle className="text-violet-900">Historia ponownych otwarć</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-[15px]">
            {reopenHistory.map((u) => (
              <p key={u.id}>
                • {u.message ?? '—'}{' '}
                <span className="text-sm text-slate-600">
                  ({relTimePl(u.created_at)}, wpisał {profiles.data?.find((p) => p.id === u.entered_by)?.display_name ?? '—'})
                </span>
              </p>
            ))}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShoppingCart className="h-5 w-5" aria-hidden="true" /> Materiały do kontynuacji
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {materials.length === 0 ? <p className="text-sm text-slate-600">Brak zgłoszonych potrzeb materiałowych.</p> : null}
          <ul className="space-y-1 text-[15px]">
            {materials.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center gap-2">
                <Badge tone={m.status === 'BOUGHT' ? 'success' : m.status === 'APPROVED' ? 'info' : 'warning'}>
                  {materialStatusLabels[m.status]}
                </Badge>
                <span className="font-semibold">{m.name}</span>
                <span className="text-slate-600">
                  {m.quantity} {m.unit}
                </span>
                {m.note ? <span className="text-sm text-slate-600">— {m.note}</span> : null}
              </li>
            ))}
          </ul>
          {can('addMaterial', ctx) ? <AddMaterialInline woId={wo.id} /> : null}
        </CardContent>
      </Card>

      {attachments.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Zdjęcia ({attachments.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <PhotoStrip
              attachments={attachments}
              profiles={profiles.data ?? []}
              getUrl={(att) => getGateway().attachmentUrl(att)}
            />
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Aktualizacje i komentarze</CardTitle>
        </CardHeader>
        <CardContent>
          <HistoryTimeline updates={detail.data?.updates ?? []} profiles={profiles.data ?? []} actorId={profile.id} />
          <div className="mt-3">
            <Button variant="secondary" onClick={() => setDlg('update')}>
              <MessageSquarePlus className="h-5 w-5" aria-hidden="true" /> Dodaj komentarz
            </Button>
          </div>
        </CardContent>
      </Card>

      {reportsForWo.data && reportsForWo.data.length > 0 ? (
        <p className="text-sm text-slate-500">
          Zadanie występuje w raportach:{' '}
          {reportsForWo.data.map((r) => (
            <Link key={r.id} className="font-semibold text-brand-800 underline" to={`/raporty/${r.report_date}`}>
              {r.report_date}{' '}
            </Link>
          ))}
        </p>
      ) : null}

      <HoldDialog open={dlg === 'hold'} onOpenChange={(v2) => setDlg(v2 ? 'hold' : null)} wo={wo} profiles={profiles.data ?? []} />
      <CompleteDialog open={dlg === 'complete'} onOpenChange={(v2) => setDlg(v2 ? 'complete' : null)} wo={wo} profiles={profiles.data ?? []} />
      <UpdateDialog mode="NOTE" open={dlg === 'note'} onOpenChange={(v2) => setDlg(v2 ? 'note' : null)} wo={wo} profiles={profiles.data ?? []} />
      <UpdateDialog mode="COMMENT" open={dlg === 'update'} onOpenChange={(v2) => setDlg(v2 ? 'update' : null)} wo={wo} profiles={profiles.data ?? []} />
      <ReopenDialog open={dlg === 'reopen'} onOpenChange={(v2) => setDlg(v2 ? 'reopen' : null)} wo={wo} profiles={profiles.data ?? []} />
      <ConfirmDialog
        open={dlg === 'close'}
        onOpenChange={(v2) => setDlg(v2 ? 'close' : null)}
        title="Zamknąć zadanie?"
        description={
          <>
            Zamykasz zadanie <strong>„{wo.title}”</strong> jako zaakceptowane. Wykonawca zobaczy to w historii; w razie
            potrzeby możesz je jeszcze ponownie otworzyć.
          </>
        }
        confirmLabel="Tak, zamknij"
        busy={busy}
        onConfirm={() => void act('CLOSED')}
      />
      <ReassignDialog open={dlg === 'reassign'} onOpenChange={(v2) => setDlg(v2 ? 'reassign' : null)} wo={wo} />
    </div>
  );
}

function AddMaterialInline({ woId }: { woId: string }) {
  const [name, setName] = useState('');
  const [qty, setQty] = useState('1');
  const [unit, setUnit] = useState('szt.');
  const [note, setNote] = useState('');
  return (
    <form
      className="mt-3 grid gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (!name.trim()) return;
        void mutations.addMaterial(woId, name.trim(), Number(qty) || 1, unit.trim() || 'szt.', note.trim() || null);
        setName('');
        setQty('1');
        setNote('');
      }}
    >
      <Field name="mat-name" label="Potrzebny materiał lub zakup">
        {(ids) => <Input {...ids} value={name} onChange={(e) => setName(e.target.value)} placeholder="np. uszczelka 3/4, farba do plam" />}
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field name="mat-qty" label="Ilość">
          {(ids) => <Input {...ids} inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} />}
        </Field>
        <Field name="mat-unit" label="Jednostka">
          {(ids) => <Input {...ids} value={unit} onChange={(e) => setUnit(e.target.value)} />}
        </Field>
      </div>
      <Field name="mat-note" label="Uwaga (np. model, dokładna lokalizacja)" className="sm:col-span-2">
        {(ids) => <Textarea id={ids.id} rows={2} value={note} onChange={(e) => setNote(e.target.value)} />}
      </Field>
      <div className="flex justify-end sm:col-span-2">
        <Button type="submit">Zgłoś do raportu</Button>
      </div>
    </form>
  );
}

void statusLabels;
