import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Field, Label, Textarea } from '@/components/ui/form';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Composer } from '@/components/dialogs/Composer';
import { holdReasonOptions } from '@/lib/labels';
import { mutations } from '@/data/repository';
import { useAuth } from '@/features/auth/AuthProvider';
import type { Profile, WorkOrder } from '@/types/domain';

interface BaseDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  wo: WorkOrder;
  profiles: Profile[];
}

/** WSTRZYMANE — wymaga powodu, opisu, następnego kroku i opcjonalnie osoby oczekiwanej. */
export function HoldDialog({ open, onOpenChange, wo, profiles }: BaseDialogProps) {
  const { profile } = useAuth();
  const [reason, setReason] = React.useState<string>('');
  const [details, setDetails] = React.useState('');
  const [next, setNext] = React.useState('');
  const [waitingOn, setWaitingOn] = React.useState('');
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [busy, setBusy] = React.useState(false);
  const isManager = profile?.role === 'ADMIN' || profile?.role === 'COORDINATOR';

  React.useEffect(() => {
    if (open) {
      setReason('');
      setDetails('');
      setNext('');
      setWaitingOn('');
      setErrors({});
    }
  }, [open]);

  async function submit() {
    const errs: Record<string, string> = {};
    if (!reason) errs.reason = 'Wybierz powód wstrzymania.';
    if (details.trim().length < 5) errs.details = 'Opisz krótko sytuację (min. 5 znaków).';
    if (next.trim().length < 5) errs.next = 'Podaj następny krok (min. 5 znaków).';
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;
    setBusy(true);
    await mutations.transition(wo.id, 'ON_HOLD', wo.status, {
      holdReason: reason,
      holdDetails: details.trim(),
      nextAction: next.trim(),
      holdWaitingOn: waitingOn || null,
      performedBy: profile?.id ?? null,
    });
    setBusy(false);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Wstrzymaj zadanie</DialogTitle>
          <DialogDescription>
            Podaj powód, opisz sytuację i następny krok — dyrektor zobaczy blokadę na pulpicie i będzie mógł zareagować.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <Field name="hold-reason" label="Powód wstrzymania" required error={errors.reason}>
            {(ids) => (
              <Select value={reason} onValueChange={setReason}>
                <SelectTrigger id={ids.id} aria-invalid={errors.reason ? true : undefined}>
                  <SelectValue placeholder="Wybierz powód" />
                </SelectTrigger>
                <SelectContent>
                  {holdReasonOptions.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </Field>
          <Field name="hold-details" label="Opis sytuacji" required error={errors.details} hint="Kilka zdań: co się stało, co już zostało sprawdzone.">
            {(ids) => (
              <Textarea id={ids.id} rows={3} value={details} onChange={(e) => setDetails(e.target.value)} aria-invalid={!!errors.details} placeholder="np. Rozebrany kran, brak uszczelki w magazynie…" />
            )}
          </Field>
          <Field name="hold-next" label="Następny krok" required error={errors.next} hint="Co trzeba zrobić, żeby praca mogła ruszyć.">
            {(ids) => <Textarea id={ids.id} rows={2} value={next} onChange={(e) => setNext(e.target.value)} aria-invalid={!!errors.next} placeholder="np. zamówić uszczelkę 3/4 w sklepie technicznym" />}
          </Field>
          <Field name="hold-waiting" label="Osoba, od której zależy odblokowanie">
            {(ids) => (
              <Select value={waitingOn || undefined} onValueChange={(v) => setWaitingOn(v === '__none' ? '' : v)}>
                <SelectTrigger id={ids.id}>
                  <SelectValue placeholder="— nikt konkretny —" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">— nikt konkretny —</SelectItem>
                  {profiles
                    .filter((p) => p.id !== profile?.id)
                    .map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.display_name}
                        {isManager ? '' : ''}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            )}
          </Field>
        </div>
        <DialogFooter>
          <Button variant="secondary" size="lg" onClick={() => onOpenChange(false)}>
            Anuluj
          </Button>
          <Button size="lg" onClick={() => void submit()} disabled={busy}>
            Zatrzymaj zadanie
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** WYKONANE — jedna krótka odpowiedź: co zostało zrobione i jaki jest rezultat. */
export function CompleteDialog({ open, onOpenChange, wo, profiles }: BaseDialogProps) {
  const { profile } = useAuth();
  const isManager = profile?.role === 'ADMIN' || profile?.role === 'COORDINATOR';
  const [summary, setSummary] = React.useState('');
  const [performedBy, setPerformedBy] = React.useState(profile?.id ?? '');
  const [photos, setPhotos] = React.useState<string[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (open) {
      setSummary('');
      setPhotos([]);
      setError(null);
      setPerformedBy(profile?.id ?? '');
    }
  }, [open, profile]);

  async function submit() {
    if (summary.trim().length < 10) {
      setError('Napisz krótko, co zostało wykonane i jaki jest rezultat (min. 10 znaków).');
      return;
    }
    setBusy(true);
    await mutations.transition(wo.id, 'DONE', wo.status, {
      completionSummary: summary.trim(),
      performedBy: performedBy || null,
    });
    setBusy(false);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Zakończ zadanie</DialogTitle>
          <DialogDescription>
            Odpowiedz jednym zdaniem na pytanie: <strong>co zostało wykonane i jaki jest rezultat?</strong> Zdjęcie nie
            jest wymagane — dodaj je tylko, gdy pomaga ocenić efekt.
          </DialogDescription>
        </DialogHeader>
        <Composer
          label="Co zostało wykonane i jaki jest rezultat?"
          placeholder="np. Wymieniona uszczelka, zakręcony kran, sucho w zlewie — sprawdzono 3-krotnym odkręceniem."
          value={summary}
          onChange={(v) => {
            setSummary(v);
            if (error) setError(null);
          }}
          error={error}
          photoIds={photos}
          onPhotos={setPhotos}
          workOrderId={wo.id}
          performedBy={performedBy}
          onPerformedBy={setPerformedBy}
          profiles={profiles}
          actorId={profile?.id ?? ''}
          showPerformedBy={isManager}
        />
        <DialogFooter>
          <Button variant="secondary" size="lg" onClick={() => onOpenChange(false)}>
            Anuluj
          </Button>
          <Button size="lg" onClick={() => void submit()} disabled={busy}>
            Oznacz jako wykonane
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Zwykła aktualizacja / komentarz — może dodać każdy członek zespołu. */
export function UpdateDialog({
  open,
  onOpenChange,
  wo,
  profiles,
  mode = 'COMMENT',
}: BaseDialogProps & { mode?: 'COMMENT' | 'NOTE' }) {
  const { profile } = useAuth();
  const isManager = profile?.role === 'ADMIN' || profile?.role === 'COORDINATOR';
  const [text, setText] = React.useState('');
  const [next, setNext] = React.useState('');
  const [performedBy, setPerformedBy] = React.useState(profile?.id ?? '');
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (open) {
      setText('');
      setNext('');
      setError(null);
      setPerformedBy(profile?.id ?? '');
    }
  }, [open, profile]);

  async function submit() {
    if (text.trim().length < 3) {
      setError('Wpis jest za krótki — napisz jedno zdanie.');
      return;
    }
    setBusy(true);
    await mutations.logUpdate(wo.id, mode, text.trim(), {
      nextAction: next.trim() || null,
      performedBy: performedBy || null,
    });
    setBusy(false);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{mode === 'NOTE' ? 'Dodaj aktualizację przebiegu' : 'Dodaj komentarz'}</DialogTitle>
          <DialogDescription>
            {mode === 'NOTE'
              ? 'Krótko: na jakim etapie jest praca i co dalej.'
              : 'Komentarz widzą wszyscy z zespołu. Odpowiedź na blokadę powiadomi osobę, która ją zgłosiła.'}
          </DialogDescription>
        </DialogHeader>
        <Composer
          label={mode === 'NOTE' ? 'Aktualizacja' : 'Komentarz'}
          placeholder={mode === 'NOTE' ? 'np. Zdemontowana bateria, czekam na część z magazynu' : 'np. Klucz do pomieszczenia do odbioru w portierni'}
          value={text}
          onChange={(v) => {
            setText(v);
            if (error) setError(null);
          }}
          error={error}
          photoIds={[]}
          onPhotos={() => undefined}
          workOrderId={wo.id}
          performedBy={performedBy}
          onPerformedBy={setPerformedBy}
          profiles={profiles}
          actorId={profile?.id ?? ''}
          showPerformedBy={isManager}
        />
        {mode === 'NOTE' ? (
          <Field name="upd-next" label="Następny krok">
            {(ids) => <Textarea id={ids.id} rows={2} value={next} onChange={(e) => setNext(e.target.value)} placeholder="co ma się wydarzyć dalej" />}
          </Field>
        ) : null}
        <DialogFooter>
          <Button variant="secondary" size="lg" onClick={() => onOpenChange(false)}>
            Anuluj
          </Button>
          <Button size="lg" onClick={() => void submit()} disabled={busy}>
            Zapisz
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** PONOWNIE OTWARTE — komentarz wymagany (dlaczego zadanie wraca). */
export function ReopenDialog({ open, onOpenChange, wo }: BaseDialogProps) {
  const [text, setText] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => {
    if (open) {
      setText('');
      setError(null);
    }
  }, [open]);
  async function submit() {
    if (text.trim().length < 5) {
      setError('Napisz, dlaczego zadanie wraca do pracy (min. 5 znaków).');
      return;
    }
    setBusy(true);
    await mutations.transition(wo.id, 'REOPENED', wo.status, { message: text.trim() });
    setBusy(false);
    onOpenChange(false);
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Ponownie otwórz zadanie</DialogTitle>
          <DialogDescription>Problem wrócił albo rezultat wymaga poprawy. Opisz, co trzeba zrobić — zespół dostanie powiadomienie.</DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="reopen-text">Powód ponownego otwarcia</Label>
          <Textarea id="reopen-text" rows={3} value={text} onChange={(e) => setText(e.target.value)} aria-invalid={!!error} />
          {error ? (
            <p role="alert" className="text-sm font-medium text-red-700">
              {error}
            </p>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="secondary" size="lg" onClick={() => onOpenChange(false)}>
            Anuluj
          </Button>
          <Button size="lg" onClick={() => void submit()} disabled={busy}>
            Otwórz ponownie
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
