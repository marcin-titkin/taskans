#!/usr/bin/env node
/**
 * Generator supabase/seed.sql na podstawie src/data/seed.ts — jedno źródło danych
 * dla trybu demo (przeglądarka) i trybu Supabase (raz uruchomiony seed).
 * Użycie: npm run gen:seed  (uruchamiane przez tsx — patrz package.json)
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

globalThis.indexedDB ??= undefined; // seed nie dotyka bazy, tylko liczy dane
const { buildSeedWorld, DEMO_PROFILES, DEMO_LOCATIONS, DEMO_CATEGORIES } = await import(path.join(root, 'src/data/seed.ts'));

const world = buildSeedWorld();

const q = (s) => (s === null || s === undefined ? 'null' : `'${String(s).replaceAll("'", "''")}'`);
const json = (v) => `(${q(JSON.stringify(v))}::jsonb)`;

/** Czas ISO → wyrażenie SQL względem „teraz” (seed ma sens niezależnie od dnia uruchomienia). */
function ts(iso) {
  if (!iso) return 'null';
  const diff = Math.round((new Date(iso).getTime() - Date.now()) / 1000);
  return `now() ${diff >= 0 ? '+' : '-'} interval '${Math.abs(diff)} seconds'`;
}
function ddate(str) {
  if (!str) return 'null';
  const days = Math.round((new Date(str + 'T12:00:00Z').getTime() - new Date(new Date().toISOString().slice(0, 10) + 'T12:00:00Z').getTime()) / 86400000);
  return days === 0 ? 'current_date' : `current_date ${days > 0 ? '+' : '-'} ${Math.abs(days)}`;
}

const out = [];
out.push(
  '-- Taskans — dane demonstracyjne/ startowe, WYGENEROWANE przez scripts/gen-seed-sql.mjs ze src/data/seed.ts.',
  '-- Uruchom raz po wdrożeniu migracji: supabase db reset albo psql -f supabase/seed.sql.',
  '-- Bezpieczne do powtórzenia (ON CONFLICT DO NOTHING). Czasy względne: „dziś” = dzień uruchomienia.',
  '',
  'begin;',
  '',
);

const cols = (obj, map) => Object.keys(map).join(', ');
const vals = (obj, map) => Object.values(map).map((f) => f(obj)).join(', ');

function insert(table, rows, map) {
  if (!rows.length) return;
  out.push(`insert into public.${table} (${cols(null, map)}) values`);
  const body = rows.map((r) => `  (${vals(r, map)})`);
  out.push(body.join(',\n') + '\non conflict do nothing;');
  out.push('');
}

// słowniki i użytkownicy dokładnie ze src/data/seed.ts
for (const p of DEMO_PROFILES) {
  out.push(
    `insert into public.profiles (id, display_name, role, active) values (${q(p.id)}, ${q(p.display_name)}, ${q(p.role)}, ${p.active ? 'true' : 'false'}) on conflict do nothing;`,
  );
}
out.push('');
for (const l of DEMO_LOCATIONS) {
  out.push(
    `insert into public.locations (id, name, building, floor, room, active) values (${q(l.id)}, ${q(l.name)}, ${q(l.building)}, ${q(l.floor)}, ${q(l.room)}, ${l.active ? 'true' : 'false'}) on conflict do nothing;`,
  );
}
out.push('');
for (const cat of DEMO_CATEGORIES) {
  out.push(
    `insert into public.categories (id, name, icon, color, active) values (${q(cat.id)}, ${q(cat.name)}, ${q(cat.icon)}, ${q(cat.color)}, ${cat.active ? 'true' : 'false'}) on conflict do nothing;`,
  );
}
out.push('');

insert('work_orders', world.workOrders, {
  id: (r) => q(r.id),
  sequential_number: (r) => String(r.sequential_number),
  title: (r) => q(r.title),
  description: (r) => q(r.description),
  category_id: (r) => q(r.category_id),
  location_id: (r) => q(r.location_id),
  priority: (r) => q(r.priority),
  status: (r) => q(r.status),
  requester_id: (r) => q(r.requester_id),
  lead_worker_id: (r) => q(r.lead_worker_id),
  contact_person: (r) => q(r.contact_person),
  access_notes: (r) => q(r.access_notes),
  expected_date: (r) => ddate(r.expected_date),
  hold_reason: (r) => q(r.hold_reason),
  hold_details: (r) => q(r.hold_details),
  next_action: (r) => q(r.next_action),
  hold_waiting_on: (r) => q(r.hold_waiting_on),
  completion_summary: (r) => q(r.completion_summary),
  is_unrequested: (r) => (r.is_unrequested ? 'true' : 'false'),
  created_at: (r) => ts(r.created_at),
  updated_at: (r) => ts(r.updated_at),
  started_at: (r) => ts(r.started_at),
  completed_at: (r) => ts(r.completed_at),
  closed_at: (r) => ts(r.closed_at),
  reopened_at: (r) => ts(r.reopened_at),
});

insert('work_order_assignees', world.assignees, {
  id: (r) => `md5(${q(r.id)})::uuid`,
  work_order_id: (r) => q(r.work_order_id),
  user_id: (r) => q(r.user_id),
  assignment_type: (r) => q(r.assignment_type),
});

insert('work_order_updates', world.updates, {
  id: (r) => q(r.id),
  work_order_id: (r) => q(r.work_order_id),
  update_type: (r) => q(r.update_type),
  previous_status: (r) => q(r.previous_status),
  new_status: (r) => q(r.new_status),
  message: (r) => q(r.message),
  next_action: (r) => q(r.next_action),
  performed_by: (r) => q(r.performed_by),
  entered_by: (r) => q(r.entered_by),
  created_at: (r) => ts(r.created_at),
  client_created_at: (r) => 'null',
  device_operation_id: (r) => 'null',
});

// historia zmian w work_orders narusza append-only trigger? Nie: insert dozwolony.
insert('attachments', world.attachments, {
  id: (r) => q(r.id),
  work_order_id: (r) => q(r.work_order_id),
  update_id: (r) => q(r.update_id),
  storage_path: (r) => q(r.storage_path),
  file_name: (r) => q(r.file_name),
  mime_type: (r) => q(r.mime_type),
  size: (r) => String(r.size),
  uploaded_by: (r) => q(r.uploaded_by),
});

insert('material_requests', world.materials, {
  id: (r) => q(r.id),
  work_order_id: (r) => q(r.work_order_id),
  name: (r) => q(r.name),
  quantity: (r) => String(r.quantity),
  unit: (r) => q(r.unit),
  status: (r) => q(r.status),
  note: (r) => q(r.note),
  created_by: (r) => q(r.created_by),
});

insert('notifications', world.notifications, {
  id: (r) => q(r.id),
  recipient_id: (r) => q(r.recipient_id),
  work_order_id: (r) => q(r.work_order_id),
  kind: (r) => q(r.kind),
  message: (r) => q(r.message),
  read_at: (r) => ts(r.read_at),
});

for (const rep of world.reports) {
  out.push(
    `insert into public.daily_reports (id, report_date, status, general_note, generated_by, approved_by, generated_at, approved_at, snapshot_json)
values (${q(rep.id)}, ${q(rep.report_date)}, ${q(rep.status)}, ${q(rep.general_note)}, ${q(rep.generated_by)}, ${q(rep.approved_by)}, ${ts(rep.generated_at)}, ${ts(rep.approved_at)}, ${json(rep.snapshot_json)})
on conflict do nothing;`,
  );
}
out.push('');
out.push(`select setval('public.work_order_number_seq', (select coalesce(max(sequential_number), 1000) + 1 from public.work_orders), false);`);
out.push('commit;');
out.push('');
out.push('-- pliki zdjęć z załączników NIE są dołączane do repo (seeds są metadanymi); w demo zdjęcia są generowane na bieżąco.');

writeFileSync(path.join(root, 'supabase', 'seed.sql'), out.join('\n'), 'utf8');
console.log('Zapisano supabase/seed.sql');
