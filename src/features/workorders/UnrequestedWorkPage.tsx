import { useState } from 'react';
import { useForm } from 'react-hook-form';
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

/**
 * „Dodaj wykonaną pracę” — uproszczony formularz dla czynności z dnia bez formalnego zlecenia.
 * Wpis od razu ma status WYKONANE i trafia do raportu dziennego (sekcja 7).
 */
export function UnrequestedWorkPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const { profile } = useAuth();
  const locations = useLocations();
  const categories = useCategories();
  const profiles = useProfiles();
  const isManager = profile?.role !== 'WORKER';
  const [busy, setBusy] = useState(false);
  const [photos, setPhotos] = useState<{ photoId: string; fileName: string }[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const { register, handleSubmit, setValue, watch } = useForm<{
    title: string;
    locationId: string;
    categoryId: string;
    summary: string;
    performedByIds: string[];
  }>({
    defaultValues: { performedByIds: profile ? [profile.id] : [] },
  });
  const performed = new Set(watch('performedByIds') ?? []);

  async function submit(v: { title: string; locationId: string; categoryId: string; summary: string; performedByIds: string[] }) {
    if (!profile) return;
    const errs: Record<string, string> = {};
    if (v.title.trim().length < 3) errs.title = 'Podaj krótki tytuł (min. 3 znaki).';
    if (!v.locationId) errs.locationId = 'Wybierz lokalizację.';
    if (v.summary.trim().length < 10) errs.summary = 'Opisz jednym-dwoma zdaniami, co zostało zrobione.';
    const workers = v.performedByIds.length > 0 ? v.performedByIds : [profile.id];
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;
    setBusy(true);
    const id = await mutations.addUnrequestedWork({
      title: v.title.trim(),
      description: v.summary.trim(),
      locationId: v.locationId,
      categoryId: v.categoryId || null,
      performedByIds: workers,
      completionSummary: v.summary.trim(),
      photoIds: photos.map((p) => p.photoId),
      enteredById: profile.id,
    });
    setBusy(false);
    toast({ tone: 'ok', message: 'Zapisane. Praca trafi do raportu dziennego bez dodatkowego przepisywania.' });
    void navigate(`/zlecenia/${id}`);
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight">Dodaj wykonaną pracę</h1>
        <p className="text-slate-600">
          Co zrobiliście „przy okazji”, bez formalnego zgłoszenia? Wpis zapisuje się od razu jako <strong>Wykonane</strong> i
          trafi do raportu dziennego.
        </p>
      </div>

      <form onSubmit={(e) => void handleSubmit((v) => void submit(v))(e)} className="space-y-4" noValidate>
        <Card className="space-y-4 p-4">
          <Field name="u-title" label="Tytuł" required error={errors.title}>
            {(ids) => <Input {...ids} {...register('title')} placeholder="np. Przeniesienie krzeseł do sali 007" />}
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field name="u-loc" label="Lokalizacja" required error={errors.locationId}>
              {(ids) => (
                <Select value={watch('locationId') || undefined} onValueChange={(x) => setValue('locationId', x, { shouldValidate: true })}>
                  <SelectTrigger id={ids.id} aria-invalid={errors.locationId ? true : undefined}>
                    <SelectValue placeholder="Wybierz" />
                  </SelectTrigger>
                  <SelectContent>
                    {(locations.data ?? []).map((l) => (
                      <SelectItem key={l.id} value={l.id}>
                        {l.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </Field>
            <Field name="u-cat" label="Kategoria">
              {(ids) => (
                <Select value={watch('categoryId') || undefined} onValueChange={(x) => setValue('categoryId', x === '__none' ? '' : x)}>
                  <SelectTrigger id={ids.id}>
                    <SelectValue placeholder="— brak —" />
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
          </div>

          <fieldset>
            <legend className="mb-1 text-sm font-semibold text-slate-800">Kto wykonał pracę</legend>
            <div className="flex flex-wrap gap-x-4">
              {(profiles.data ?? [])
                .filter((p) => p.active)
                .map((p) => (
                  <Checkbox
                    key={p.id}
                    id={`unreq-${p.id}`}
                    label={`${p.display_name}${p.id === profile?.id ? ' (Ty)' : ''}`}
                    checked={performed.has(p.id)}
                    onCheckedChange={(c) => {
                      const next = new Set(performed);
                      if (c === true) next.add(p.id);
                      else next.delete(p.id);
                      setValue('performedByIds', [...next]);
                    }}
                  />
                ))}
            </div>
            {!isManager ? <p className="text-sm text-slate-600">Możesz odhaczyć współpracowników, którzy pomagali.</p> : null}
          </fieldset>

          <Field name="u-summary" label="Co zostało zrobione? (trafia wprost do raportu dziennego)" required error={errors.summary}>
            {(ids) => (
              <Textarea {...ids} {...register('summary')} rows={4} placeholder="np. Przeniesionych 12 krzeseł z auli do sali 007, ustawione wg wskazówek prowadzącej." />
            )}
          </Field>

          <div className="space-y-2">
            <Label htmlFor="unreq-photo">Zdjęcie (opcjonalne)</Label>
            <input
              id="unreq-photo"
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
            <Button type="button" variant="outline" onClick={() => document.getElementById('unreq-photo')?.click()}>
              <Paperclip className="h-5 w-5" aria-hidden="true" /> Dodaj zdjęcie ({photos.length})
            </Button>
          </div>
        </Card>

        <div className="flex gap-3">
          <Button type="submit" size="lg" className="flex-1" disabled={busy}>
            {busy ? 'Zapisywanie…' : 'Zapisz jako wykonane'}
          </Button>
          <Button type="button" variant="secondary" size="lg" onClick={() => navigate(-1)}>
            Anuluj
          </Button>
        </div>
      </form>
    </div>
  );
}
