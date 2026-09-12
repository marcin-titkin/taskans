import * as React from 'react';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/form';
import { useProfiles } from '@/data/queries';
import { mutations } from '@/data/repository';
import { roleLabels } from '@/lib/labels';
import type { WorkOrder } from '@/types/domain';

/** Przydział prowadzącego i współpracowników — tylko dyrektor/koordynator. */
export function ReassignDialog({ open, onOpenChange, wo }: { open: boolean; onOpenChange: (v: boolean) => void; wo: WorkOrder }) {
  const profiles = useProfiles();
  const workers = (profiles.data ?? []).filter((p) => p.active);
  const [lead, setLead] = React.useState<string>('');
  const [helpers, setHelpers] = React.useState<Set<string>>(new Set());
  const [busy, setBusy] = React.useState(false);
  const initialLoaded = React.useRef(false);

  React.useEffect(() => {
    if (!open) {
      initialLoaded.current = false;
      return;
    }
    if (initialLoaded.current || !profiles.data) return;
    initialLoaded.current = true;
    void (async () => {
      const { getDb } = await import('@/data/db');
      const rows = await getDb()
        .assignees.where('work_order_id')
        .equals(wo.id)
        .toArray();
      setLead(rows.find((r) => r.assignment_type === 'LEAD')?.user_id ?? '');
      setHelpers(new Set(rows.filter((r) => r.assignment_type === 'HELPER').map((r) => r.user_id)));
    })();
  }, [open, profiles.data, wo.id]);

  async function submit() {
    setBusy(true);
    await mutations.assign(wo.id, lead || null, [...helpers]);
    setBusy(false);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Przydział zadania</DialogTitle>
          <DialogDescription>Wskaż osobę prowadzącą i pomoc. Zmiana trafi do historii i powiadomień.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label htmlFor="reassign-lead">Prowadzący</Label>
            <Select value={lead || undefined} onValueChange={(v) => setLead(v === '__none' ? '' : v)}>
              <SelectTrigger id="reassign-lead">
                <SelectValue placeholder="— bez przydziału —" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none">— bez przydziału (status: Nowe) —</SelectItem>
                {workers.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.display_name} <span className="text-slate-500">({roleLabels[p.role]})</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <fieldset>
            <legend className="mb-1 text-sm font-semibold text-slate-800">Współpracownicy</legend>
            <div className="space-y-1">
              {workers
                .filter((p) => p.id !== lead)
                .map((p) => (
                  <Checkbox
                    key={p.id}
                    id={`helper-${p.id}`}
                    label={p.display_name}
                    checked={helpers.has(p.id)}
                    onCheckedChange={(c) => {
                      const next = new Set(helpers);
                      if (c === true) next.add(p.id);
                      else next.delete(p.id);
                      setHelpers(next);
                    }}
                  />
                ))}
            </div>
          </fieldset>
        </div>
        <DialogFooter>
          <Button variant="secondary" size="lg" onClick={() => onOpenChange(false)}>
            Anuluj
          </Button>
          <Button size="lg" onClick={() => void submit()} disabled={busy}>
            Zapisz przydział
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
