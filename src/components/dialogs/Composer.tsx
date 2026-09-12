import * as React from 'react';
import { Mic, Paperclip } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label, Textarea } from '@/components/ui/form';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useDictation } from '@/lib/speech';
import { mutations } from '@/data/repository';
import { cn } from '@/lib/utils';
import type { Profile } from '@/types/domain';

/**
 * Wspólny edytor wpisu: pole tekstowe + dyktowanie głosowe (natywne Web Speech API, bez kosztów)
 * + załączniki zdjęć + wybór osoby, która wykonała pracę (widoczne tylko dla przełożonych,
 * do wprowadzania danych „w imieniu” pracownika bez smartfona).
 */
export function Composer({
  label,
  placeholder,
  value,
  onChange,
  error,
  photoIds,
  onPhotos,
  workOrderId,
  performedBy,
  onPerformedBy,
  profiles,
  actorId,
  showPerformedBy,
}: {
  label: React.ReactNode;
  placeholder?: string;
  value: string;
  onChange: (v: string) => void;
  error?: string | null;
  photoIds: string[];
  onPhotos: (ids: string[]) => void;
  workOrderId: string;
  performedBy: string;
  onPerformedBy: (v: string) => void;
  profiles: Profile[];
  actorId: string;
  showPerformedBy: boolean;
}) {
  const fileRef = React.useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = React.useState(false);
  const dictation = useDictation({
    onText: (chunk) => onChange(value ? `${value} ${chunk}` : chunk),
  });

  async function handleFiles(list: FileList | null) {
    if (!list || list.length === 0) return;
    setUploading(true);
    const added: string[] = [];
    for (const file of Array.from(list)) {
      const res = await mutations.addPhoto(workOrderId, file);
      if (res.ok && res.photoId) added.push(res.photoId);
    }
    setUploading(false);
    if (added.length > 0) onPhotos([...photoIds, ...added]);
    if (fileRef.current) fileRef.current.value = '';
  }

  return (
    <div className="space-y-3">
      <div>
        <div className="flex items-center justify-between gap-2">
          <Label htmlFor="composer-text">{label}</Label>
          {dictation.supported ? (
            <Button
              type="button"
              size="sm"
              variant={dictation.listening ? 'destructive' : 'secondary'}
              onClick={dictation.toggle}
              aria-pressed={dictation.listening}
            >
              <Mic className="h-5 w-5" aria-hidden="true" />
              {dictation.listening ? 'Zatrzymaj dyktowanie' : 'Dyktuj notatkę'}
            </Button>
          ) : null}
        </div>
        {dictation.error ? (
          <p role="status" className="mt-1 text-sm text-amber-800">
            {dictation.error}
          </p>
        ) : dictation.listening ? (
          <p role="status" className="mt-1 text-sm font-medium text-emerald-800">
            Słucham… mów, tekst dopiszę w polu.
          </p>
        ) : null}
        <Textarea
          id="composer-text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? 'composer-err' : undefined}
          rows={4}
        />
        {error ? (
          <p id="composer-err" role="alert" className="text-sm font-medium text-red-700">
            {error}
          </p>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          capture="environment"
          multiple
          className="sr-only"
          id={`composer-photo-${workOrderId}`}
          onChange={(e) => void handleFiles(e.target.files)}
        />
        <Button type="button" variant="outline" size="sm" onClick={() => fileRef.current?.click()} disabled={uploading}>
          <Paperclip className="h-5 w-5" aria-hidden="true" />
          {uploading ? 'Przetwarzam zdjęcie…' : 'Dodaj zdjęcie (opcjonalnie)'}
        </Button>
        {photoIds.length > 0 ? <span className="text-sm text-slate-600">Dołączone: {photoIds.length}</span> : null}
      </div>

      {showPerformedBy ? (
        <div className="space-y-1.5">
          <Label htmlFor="composer-performed">Osoba, która wykonała pracę</Label>
          <Select value={performedBy} onValueChange={onPerformedBy}>
            <SelectTrigger id="composer-performed" className={cn('max-w-xs')}>
              <SelectValue placeholder="Wybierz osobę" />
            </SelectTrigger>
            <SelectContent>
              {profiles.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.display_name}
                  {p.id === actorId ? ' (ja — wprowadzam osobiście)' : ''}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-sm text-slate-600">
            Wpis zostanie zapisany z rozdzieleniem: wykonawca oraz autor wprowadzenia (Ty).
          </p>
        </div>
      ) : null}
    </div>
  );
}
