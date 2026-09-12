import { useState } from 'react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { relTimePl, initials } from '@/lib/utils';
import { statusLabels } from '@/lib/labels';
import type { Attachment, Profile, WorkOrderUpdate } from '@/types/domain';

const nameOf = (profiles: Profile[], id: string | null | undefined): string =>
  (id ? profiles.find((p) => p.id === id)?.display_name : null) ?? 'Ktoś';

const shortName = (n: string): string => n.split(' ').map((s) => s[0]).join(' ').slice(0, 4) + '.';

/**
 * Historia zadania. Kluczowa zasada z briefu: wykonawca pracy i autor wpisu do systemu
 * są zawsze pokazywani osobno (np. Marek wykonał, Piotr wpisał przy wspólnym komputerze).
 */
export function HistoryTimeline({
  updates,
  profiles,
  actorId,
}: {
  updates: WorkOrderUpdate[];
  profiles: Profile[];
  actorId: string;
}) {
  const reversed = [...updates].reverse();
  return (
    <ol className="space-y-3" aria-label="Historia zadania">
      {reversed.map((u) => {
        const performedName = nameOf(profiles, u.performed_by);
        const enteredName = nameOf(profiles, u.entered_by);
        const actingForOther = u.performed_by !== u.entered_by;
        const isStatus = u.update_type === 'STATUS' && u.previous_status && u.new_status;
        return (
          <li key={u.id} className="flex gap-3">
            <span
              className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-200 text-xs font-bold text-slate-700"
              aria-hidden="true"
              title={performedName}
            >
              {initials(performedName)}
            </span>
            <div className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-white p-3">
              <p className="text-sm font-semibold text-slate-900">
                {isStatus ? (
                  <>
                    <span className="text-slate-600">{statusLabels[u.previous_status!]} → </span>
                    <span>{statusLabels[u.new_status!]}</span>
                  </>
                ) : u.update_type === 'NOTE' ? (
                  'Aktualizacja przebiegu'
                ) : u.update_type === 'COMMENT' ? (
                  'Komentarz'
                ) : (
                  'Wpis'
                )}
                <span className="ml-2 font-normal text-slate-500">{relTimePl(u.created_at)}</span>
              </p>
              {u.message ? <p className="mt-1 whitespace-pre-wrap text-[15px] leading-6 text-slate-800">{u.message}</p> : null}
              {u.next_action ? (
                <p className="mt-1 text-sm text-slate-700">
                  <span className="font-semibold">Następny krok:</span> {u.next_action}
                </p>
              ) : null}
              <p className="mt-1 text-xs text-slate-600" aria-label={`Wykonał ${performedName}, wpisał ${enteredName}`}>
                {actingForOther ? (
                  <>
                    <span className="font-semibold text-slate-700">Wykonał(a): {performedName}</span>
                    <span aria-hidden="true"> • </span>
                    <span>
                      wpisał(a): {enteredName} {u.entered_by === actorId ? `(${shortName(enteredName)})` : ''}
                    </span>
                  </>
                ) : (
                  <span>
                    {performedName} {u.performed_by === actorId ? `(${shortName(performedName)})` : ''}
                  </span>
                )}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export function PhotoStrip({
  attachments,
  profiles,
  getUrl,
}: {
  attachments: Attachment[];
  profiles: Profile[];
  getUrl: (att: Attachment) => Promise<string | null>;
}) {
  const [src, setSrc] = useState<string | null>(null);
  if (attachments.length === 0) return null;
  return (
    <>
      <ul className="flex flex-wrap gap-2" aria-label={`Zdjęcia (${attachments.length})`}>
        {attachments.map((a) => (
          <li key={a.id}>
            <button
              type="button"
              className="tap-target flex min-w-12 flex-col items-center gap-1 rounded-xl border border-slate-200 bg-white p-2 text-xs text-slate-700 hover:bg-slate-50"
              onClick={() => void getUrl(a).then(setSrc)}
              aria-label={`Otwórz zdjęcie: ${a.file_name}`}
            >
              <span className="text-2xl" aria-hidden="true">
                🖼️
              </span>
              <span className="max-w-28 truncate">{a.file_name}</span>
              <span>{nameOf(profiles, a.uploaded_by)}</span>
            </button>
          </li>
        ))}
      </ul>
      <Dialog open={!!src} onOpenChange={(v) => (v ? undefined : setSrc(null))}>
        <DialogContent className="max-w-2xl">
          <DialogTitle className="sr-only">Podgląd zdjęcia</DialogTitle>
          {src ? (
            <img src={src} alt="Zdjęcie z zadania" className="max-h-[75vh] w-full rounded-xl object-contain" />
          ) : null}
          <p className="text-sm text-slate-600">Zdjęcia są przechowywane prywatnie i widoczne tylko dla zespołu.</p>
        </DialogContent>
      </Dialog>
    </>
  );
}
