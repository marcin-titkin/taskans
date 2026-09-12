import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useNavigate } from 'react-router-dom';
import { Paperclip } from 'lucide-react';
import { useAuth } from '@/features/auth/AuthProvider';
import { useCategories, useLocations, useProfiles } from '@/data/queries';
import { mutations } from '@/data/repository';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Field, Input, Label, Textarea } from '@/components/ui/form';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { useToast } from '@/components/ui/toast';
import { priorityDescriptions, priorityLabels, roleLabels } from '@/lib/labels';
import type { Priority } from '@/types/domain';

const schema = z.object({
  title: z.string().trim().min(3, 'Tytuł musi mieć co najmniej 3 znaki.').max(140),
  description: z.string().trim().min(5, 'Opisz krótko problem lub oczekiwany rezultat (min. 5 znaków).').max(4000),
  locationId: z.string().min(1, 'Wybierz lokalizację.'),
  priority: z.enum(['BREAKDOWN', 'URGENT', 'NORMAL']),
  categoryId: z.string().optional(),
  expectedDate: z.string().optional(),
  contactPerson: z.string().max(80).optional(),
  accessNotes: z.string().max(500).optional(),
  leadWorkerId: z.string().optional(),
  helperIds: z.array(z.string()).optional(),
});

type FormValues = z.input<typeof schema>;

export function NewWorkOrderPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const { profile } = useAuth();
  const locations = useLocations();
  const categories = useCategories();
  const profiles = useProfiles();
  const isManager = profile?.role !== 'WORKER';

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { priority: 'NORMAL', helperIds: [] },
  });

  const [photos, setPhotos] = useState<{ photoId: string; fileName: string }[]>([]);
  const [busy, setBusy] = useState(false);

  const priority = watch('priority');
  const leadWorkerId = watch('leadWorkerId');
  const helperIds = new Set(watch('helperIds') ?? []);

  useEffect(() => {
    register('locationId');
    register('categoryId');
    register('priority');
    register('leadWorkerId');
    register('helperIds');
  }, [register]);

  const locationName = (id: string | undefined) => locations.data?.find((l) => l.id === id)?.name;

  async function submit(values: FormValues) {
    if (!profile) return;
    setBusy(true);
    const id = await mutations.createWorkOrder({
      title: values.title,
      description: values.description,
      locationId: values.locationId,
      categoryId: values.categoryId?.trim() ? values.categoryId : null,
      priority: values.priority,
      requesterId: profile.id,
      contactPerson: values.contactPerson?.trim() ? values.contactPerson.trim() : null,
      accessNotes: values.accessNotes?.trim() ? values.accessNotes.trim() : null,
      expectedDate: values.expectedDate?.trim() ? values.expectedDate : null,
      leadWorkerId: isManager && values.leadWorkerId ? values.leadWorkerId : null,
      helperIds: isManager ? [...helperIds] : [],
      photoIds: photos.map((p) => p.photoId),
    });
    setBusy(false);
    toast({ tone: 'ok', message: 'Zlecenie zapisane. Trafi do kolejki synchronizacji i zobaczy je zespół.' });
    void navigate(`/zlecenia/${id}`);
  }

  const workers = useMemo(() => (profiles.data ?? []).filter((p) => p.active), [profiles.data]);

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight">Nowe zlecenie</h1>
        <p className="text-slate-600">
          Opisz, co się dzieje albo jaki efekt jest potrzebny — diagnozę przyczyny zostaw wykonawcy.
        </p>
      </div>

      <form onSubmit={(e) => void handleSubmit((v) => void submit(v))(e)} className="space-y-4" noValidate>
        <Card className="space-y-4 p-4">
          <Field name="title" label="Tytuł" required error={errors.title?.message} hint="Jedno zdanie, jak na kartce: „Cieknący kran w sali 104”.">
            {(ids) => <Input {...ids} {...register('title')} placeholder="Co się stało?" autoComplete="off" />}
          </Field>

          <Field name="description" label="Opis problemu lub oczekiwanego rezultatu" required error={errors.description?.message}>
            {(ids) => (
              <Textarea
                {...ids}
                {...register('description')}
                rows={4}
                placeholder="np. Z kranu kapie od wczoraj, w zlewie stoi woda. Efekt: suchy zlew i działający kran do zajęć o 10:00."
              />
            )}
          </Field>

          <Field name="locationId" label="Lokalizacja" required error={errors.locationId?.message}>
            {(ids) => (
              <Select
                value={watch('locationId') || undefined}
                onValueChange={(v) => setValue('locationId', v, { shouldValidate: true })}
              >
                <SelectTrigger id={ids.id}>
                  <SelectValue placeholder={locationName(watch('locationId')) ?? 'Wybierz pomieszczenie'} />
                </SelectTrigger>
                <SelectContent>
                  {(locations.data ?? []).map((l) => (
                    <SelectItem key={l.id} value={l.id}>
                      {l.name}
                      {l.building ? ` — ${l.building}${l.room ? `, ${l.room}` : ''}` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </Field>

          <fieldset className="space-y-2">
            <legend className="text-sm font-semibold text-slate-800">
              Priorytet <span className="text-red-700">*</span>
            </legend>
            {(Object.keys(priorityLabels) as Priority[]).map((p) => (
              <label key={p} className="flex min-h-12 cursor-pointer items-start gap-3 rounded-xl border border-slate-200 p-3 has-[:checked]:border-brand-700 has-[:checked]:bg-brand-50">
                <input
                  type="radio"
                  value={p}
                  {...register('priority')}
                  className="mt-1 h-5 w-5 accent-teal-700"
                  checked={priority === p}
                  onChange={(e) => setValue('priority', e.target.value as Priority)}
                />
                <span>
                  <span className="block font-bold">{priorityLabels[p]}</span>
                  <span className="block text-sm text-slate-600">{priorityDescriptions[p]}</span>
                </span>
              </label>
            ))}
          </fieldset>

          <Field name="requester" label="Zgłaszający" hint="Dane zalogowanej osoby — nie musisz ich wpisywać.">
            {(ids) => <Input {...ids} readOnly value={`${profile?.display_name ?? ''} (Ty)`} className="bg-slate-100" />}
          </Field>
        </Card>

        <details className="group rounded-2xl border border-slate-200 bg-white p-4" open>
          <summary className="min-h-8 cursor-pointer text-base font-bold text-slate-800">
            Pola opcjonalne (kategoria, termin, przydział, zdjęcia)
          </summary>
          <div className="mt-4 space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field name="categoryId" label="Kategoria prac">
                {(ids) => (
                  <Select value={watch('categoryId')?.length ? watch('categoryId') : undefined} onValueChange={(v) => setValue('categoryId', v === '__none' ? '' : v)}>
                    <SelectTrigger id={ids.id}>
                      <SelectValue placeholder="— dobierz po zgłoszeniu —" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none">— bez kategorii —</SelectItem>
                      {(categories.data ?? []).map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </Field>
              <Field name="expectedDate" label="Oczekiwany termin" hint="Pozostaw puste, jeśli sprawa nie goni.">
                {(ids) => <Input {...ids} type="date" {...register('expectedDate')} />}
              </Field>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field name="contactPerson" label="Osoba kontaktowa">
                {(ids) => <Input {...ids} {...register('contactPerson')} placeholder="np. dziekanat, p. Ilona (wew. 214)" />}
              </Field>
              <Field name="accessNotes" label="Dostęp do pomieszczenia">
                {(ids) => <Input {...ids} {...register('accessNotes')} placeholder="np. klucz w portierni, alarm do odłączenia" />}
              </Field>
            </div>

            {isManager ? (
              <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
                <p className="text-sm font-bold uppercase tracking-wide text-slate-500">Przydział (tylko przełożony)</p>
                <Field name="leadWorkerId" label="Prowadzący">
                  {(ids) => (
                    <Select value={leadWorkerId?.length ? leadWorkerId : undefined} onValueChange={(v) => setValue('leadWorkerId', v === '__none' ? '' : v)}>
                      <SelectTrigger id={ids.id}>
                        <SelectValue placeholder="— później —" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none">— bez przydziału —</SelectItem>
                        {workers.map((p) => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.display_name} <span className="text-slate-500">({roleLabels[p.role]})</span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </Field>
                <fieldset>
                  <legend className="mb-1 text-sm font-semibold text-slate-800">Współpracownicy</legend>
                  {workers
                    .filter((p) => p.id !== leadWorkerId)
                    .map((p) => (
                      <Checkbox
                        key={p.id}
                        id={`new-helper-${p.id}`}
                        label={p.display_name}
                        checked={helperIds.has(p.id)}
                        onCheckedChange={(c) => {
                          const next = new Set(watch('helperIds') ?? []);
                          if (c === true) next.add(p.id);
                          else next.delete(p.id);
                          setValue('helperIds', [...next]);
                        }}
                      />
                    ))}
                </fieldset>
              </div>
            ) : null}

            <div className="space-y-2">
              <Label htmlFor="wo-photos">Zdjęcia (opcjonalne)</Label>
              <input
                id="wo-photos"
                type="file"
                accept="image/jpeg,image/png,image/webp"
                multiple
                capture="environment"
                className="sr-only"
                onChange={async (e) => {
                  const files = e.target.files;
                  if (!files) return;
                  for (const f of Array.from(files)) {
                    const res = await mutations.preparePhoto(f);
                    const pid = res.photoId;
                    if (res.ok && pid) setPhotos((p) => [...p, { photoId: pid, fileName: f.name }]);
                    else if (res.error) toast({ tone: 'warn', message: res.error });
                  }
                  e.target.value = '';
                }}
              />
              <Button type="button" variant="outline" onClick={() => document.getElementById('wo-photos')?.click()}>
                <Paperclip className="h-5 w-5" aria-hidden="true" /> Dodaj zdjęcie ({photos.length})
              </Button>
              <ul className="flex flex-wrap gap-2 text-sm text-slate-700">
                {photos.map((p) => (
                  <li key={p.photoId} className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1">
                    {p.fileName}
                  </li>
                ))}
              </ul>
              <p className="text-sm text-slate-600">Zdjęcia są zmniejszane na telefonie i zapisywane prywatnie — tylko dla zespołu.</p>
            </div>
          </div>
        </details>

        <div className="sticky bottom-16 z-10 flex flex-col-reverse gap-2 rounded-2xl border border-slate-200 bg-white/95 p-3 backdrop-blur sm:flex-row sm:flex-wrap sm:items-center sm:gap-3 md:static md:border-0 md:bg-transparent">
          <Button type="submit" size="lg" className="w-full flex-1" disabled={busy || isSubmitting}>
            {busy ? 'Zapisywanie…' : 'Zapisz zlecenie'}
          </Button>
          <Button type="button" variant="secondary" size="lg" className="w-full sm:w-auto" onClick={() => navigate(-1)}>
            Anuluj
          </Button>
        </div>
      </form>
    </div>
  );
}
