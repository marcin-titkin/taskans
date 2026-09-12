import { useState } from 'react';
import { Building2, FolderCog, UsersRound, Info, ShieldCheck } from 'lucide-react';
import { useAuth } from '@/features/auth/AuthProvider';
import { useCategories, useDataEvents, useLocations, useQueryOnEvents } from '@/data/queries';
import { getDb } from '@/data/db';
import { appMode, mutations } from '@/data/repository';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Field, Input } from '@/components/ui/form';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { roleLabels, statusLabels } from '@/lib/labels';
import { cn } from '@/lib/utils';
import { useToast } from '@/components/ui/toast';
import type { Category, Location, Profile, UserRole } from '@/types/domain';

type Tab = 'uzytkownicy' | 'kategorie' | 'lokalizacje' | 'system';

export function SettingsPage() {
  const { profile } = useAuth();
  const isAdmin = profile?.role === 'ADMIN';
  const isManager = profile?.role === 'ADMIN' || profile?.role === 'COORDINATOR';
  const [tab, setTab] = useState<Tab>(isAdmin ? 'uzytkownicy' : isManager ? 'kategorie' : 'system');

  const tabs: { id: Tab; label: string; icon: React.ReactNode; show: boolean }[] = [
    { id: 'uzytkownicy', label: 'Użytkownicy', icon: <UsersRound className="h-5 w-5" aria-hidden="true" />, show: isAdmin },
    { id: 'kategorie', label: 'Kategorie prac', icon: <FolderCog className="h-5 w-5" aria-hidden="true" />, show: isManager },
    { id: 'lokalizacje', label: 'Lokalizacje', icon: <Building2 className="h-5 w-5" aria-hidden="true" />, show: isManager },
    { id: 'system', label: 'System i prywatność', icon: <Info className="h-5 w-5" aria-hidden="true" />, show: true },
  ];

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-extrabold tracking-tight">Ustawienia</h1>
      <nav aria-label="Zakładki ustawień" className="flex flex-wrap gap-1 rounded-2xl border border-slate-200 bg-white p-1">
        {tabs.filter((t) => t.show).map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            aria-current={tab === t.id ? 'page' : undefined}
            className={cn('tap-target inline-flex items-center gap-2 rounded-xl px-3 text-sm font-bold', tab === t.id ? 'bg-brand-700 text-white' : 'text-slate-700 hover:bg-slate-100')}
          >
            {t.icon} {t.label}
          </button>
        ))}
      </nav>

      {tab === 'uzytkownicy' && isAdmin ? <UsersPanel /> : null}
      {tab === 'kategorie' && isManager ? <CategoriesPanel /> : null}
      {tab === 'lokalizacje' && isManager ? <LocationsPanel /> : null}
      {tab === 'system' ? <SystemPanel /> : null}
    </div>
  );
}

function UsersPanel() {
  const v = useDataEvents();
  const q = useQueryOnEvents(['profilesAll'], () => getDb().profiles.toArray(), v);
  const toast = useToast();
  const [newName, setNewName] = useState('');

  async function save(p: Profile, patch: Partial<Pick<Profile, 'role' | 'active' | 'display_name'>>) {
    await mutations.upsertProfile(p.id, patch);
    toast({ tone: 'ok', message: 'Zapisano — zmiana w kolejce synchronizacji.' });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Użytkownicy i role</CardTitle>
        <p className="text-sm text-slate-600">
          Każda osoba ma własne konto — żadnych wspólnych loginów. Role: {Object.values(roleLabels).join(', ')}. W trybie
          Supabase nowe konta zakłada administrator w Supabase Dashboard (pod tym samym e-mailem), a profilu nie da się
          podnieść samodzielnie (RLS).
        </p>
      </CardHeader>
      <CardContent className="space-y-2">
        {(q.data ?? []).map((p) => (
          <div key={p.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 p-3">
            <span className="min-w-44 flex-1 font-bold">{p.display_name}</span>
            <Select value={p.role} onValueChange={(r) => void save(p, { role: r as UserRole })}>
              <SelectTrigger className="w-64" aria-label={`Rola: ${p.display_name}`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(roleLabels) as UserRole[]).map((r) => (
                  <SelectItem key={r} value={r}>
                    {roleLabels[r]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Switch label={p.active ? 'aktywne' : 'nieaktywne'} checked={p.active} onCheckedChange={(c) => void save(p, { active: c })} />
            <span className="text-xs text-slate-400">{p.id.slice(0, 8)}…</span>
          </div>
        ))}
        {appMode() === 'demo' ? (
          <form
            className="flex flex-wrap items-end gap-2 rounded-xl border border-dashed border-slate-300 p-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (newName.trim().length < 3) return;
              void (async () => {
                const db = getDb();
                const id = crypto.randomUUID();
                // w demo: dodaj zarówno do „serwera” jak i do cache, przez kolejkę
                await db.server_profiles.add({ id, display_name: newName.trim(), role: 'WORKER', active: true });
                await mutations.upsertProfile(id, { display_name: newName.trim(), role: 'WORKER', active: true });
                setNewName('');
                toast({ tone: 'ok', message: 'Dodano użytkownika demo.' });
              })();
            }}
          >
            <Field name="new-user" label="Nowy użytkownik (tylko tryb demo)">
              {(ids) => <Input {...ids} value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Imię i nazwisko" />}
            </Field>
            <Button type="submit">Dodaj</Button>
          </form>
        ) : null}
      </CardContent>
    </Card>
  );
}

function CategoriesPanel() {
  const categories = useCategories(true);
  const toast = useToast();
  const [name, setName] = useState('');
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Kategorie prac</CardTitle>
        <p className="text-sm text-slate-600">Kolejność i nazwy dostosowane do obiektu; wyłączenie kategorii nie usuwa jej z historii zadań.</p>
      </CardHeader>
      <CardContent className="space-y-2">
        {(categories.data ?? []).map((c: Category) => (
          <div key={c.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 p-3">
            <span className="inline-block h-4 w-4 rounded-full border border-slate-400" style={{ backgroundColor: c.color ?? '#94a3b8' }} aria-hidden="true" />
            <span className="min-w-40 flex-1 font-bold">{c.name}</span>
            <Switch label={c.active ? 'widoczna' : 'ukryta'} checked={c.active} onCheckedChange={(v2) => void mutations.upsertCategory(c.id, { name: c.name, icon: c.icon, color: c.color, active: v2 })} />
          </div>
        ))}
        <form
          className="flex flex-wrap items-end gap-2 rounded-xl border border-dashed border-slate-300 p-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim().length < 2) return;
            void mutations.upsertCategory(null, { name: name.trim(), active: true }).then(() => {
              setName('');
              toast({ tone: 'ok', message: 'Dodano kategorię.' });
            });
          }}
        >
          <Field name="new-cat" label="Nowa kategoria">
            {(ids) => <Input {...ids} value={name} onChange={(e) => setName(e.target.value)} />}
          </Field>
          <Button type="submit">Dodaj</Button>
        </form>
      </CardContent>
    </Card>
  );
}

function LocationsPanel() {
  const locations = useLocations(true);
  const toast = useToast();
  const [form, setForm] = useState({ name: '', building: '', room: '' });
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Lokalizacje</CardTitle>
        <p className="text-sm text-slate-600">Budynek, piętro i numer pomieszczenia są opcjonalne — ważna jest czytelna nazwa, którą zna zespół.</p>
      </CardHeader>
      <CardContent className="space-y-2">
        {(locations.data ?? []).map((l: Location) => (
          <div key={l.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 p-3">
            <span className="min-w-40 flex-1">
              <span className="block font-bold">{l.name}</span>
              <span className="block text-sm text-slate-600">
                {[l.building, l.floor, l.room].filter(Boolean).join(' • ') || '—'}
              </span>
            </span>
            <Switch label={l.active ? 'aktywna' : 'ukryta'} checked={l.active} onCheckedChange={(v2) => void mutations.upsertLocation(l.id, { ...l, active: v2 })} />
          </div>
        ))}
        <form
          className="grid gap-2 rounded-xl border border-dashed border-slate-300 p-3 sm:grid-cols-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (form.name.trim().length < 2) return;
            void mutations
              .upsertLocation(null, { name: form.name.trim(), building: form.building.trim() || null, room: form.room.trim() || null, active: true })
              .then(() => {
                setForm({ name: '', building: '', room: '' });
                toast({ tone: 'ok', message: 'Dodano lokalizację.' });
              });
          }}
        >
          <Field name="new-loc-name" label="Nazwa">
            {(ids) => <Input {...ids} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Sala 104" />}
          </Field>
          <Field name="new-loc-bld" label="Budynek">
            {(ids) => <Input {...ids} value={form.building} onChange={(e) => setForm({ ...form, building: e.target.value })} placeholder="A" />}
          </Field>
          <Field name="new-loc-room" label="Numer">
            {(ids) => <Input {...ids} value={form.room} onChange={(e) => setForm({ ...form, room: e.target.value })} placeholder="A-104" />}
          </Field>
          <div className="flex items-end">
            <Button type="submit">Dodaj</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function SystemPanel() {
  const { profile } = useAuth();
  const v = useDataEvents();
  const stats = useQueryOnEvents(
    ['sysStats'],
    async () => {
      const db = getDb();
      const wos = await db.workOrders.toArray();
      return {
        total: wos.length,
        open: wos.filter((w) => w.status !== 'CLOSED').length,
        statuses: Object.fromEntries(Object.entries(statusLabels).map(([k]) => [k, wos.filter((w) => w.status === k).length])),
      };
    },
    v
  );
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <ShieldCheck className="h-5 w-5 text-emerald-700" aria-hidden="true" /> Prywatność i zaufanie
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-[15px] text-slate-800">
          <p>System zbiera wyłącznie dane potrzebne do rozliczenia prac: tytuły, opisy, lokalizacje, statusy, wpisy zespołu i zdjęcia zadania.</p>
          <ul className="list-disc space-y-1 pl-5">
            <li>Brak GPS i śledzenia lokalizacji pracowników.</li>
            <li>Brak minutników, rankingów i automatycznej oceny pracy.</li>
            <li>Historia służy ciągłości pracy i wyjaśnieniu stanu zadania.</li>
            <li>Zdjęcia w prywatnym magazynie, dostępne tylko dla zespołu.</li>
            <li>Dane demo przeglądarki (tryb demo) nie opuszczają urządzenia.</li>
          </ul>
          <p className="text-sm text-slate-600">Zalogowany profil: {profile?.display_name} ({profile ? roleLabels[profile.role] : ''})</p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Stan lokalny</CardTitle>
        </CardHeader>
        <CardContent>
          {stats.data ? (
            <div className="flex flex-wrap gap-2">
              <Badge>Zadań w cache: {stats.data.total}</Badge>
              <Badge>Otwartych: {stats.data.open}</Badge>
              {Object.entries(stats.data.statuses).map(([k, n]) => (
                <Badge key={k}>
                  {statusLabels[k as keyof typeof statusLabels]}: {n}
                </Badge>
              ))}
            </div>
          ) : (
            <p role="status" className="text-slate-600">Liczę…</p>
          )}
          <p className="mt-3 text-sm text-slate-600">
            Tryb aplikacji: <strong>{appMode() === 'demo' ? 'demo lokalne' : 'Supabase'}</strong>. W trybie demo dane trzymane są w IndexedDB tego
            urządzenia i służą do pilotażu oraz testów.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
