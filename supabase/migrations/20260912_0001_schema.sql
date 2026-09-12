-- Taskans — schemat bazy (Supabase / PostgreSQL 15+)
-- Konwencje: snake_case, UUIDv7 nie wymagane (gen_random_uuid enumy + CHECK zamiast luźnych textów).
-- UWAGA o profilach: profiles.id NIE ma FK do auth.users — dzięki temu seed/SCIM/historia działają,
-- a więź z kontem zapewnia trigger handle_new_user (0003) i polityki RLS (wygodnie i bezpiecznie dla 5-7 osób).

do $$ begin
  create extension if not exists pgcrypto;
exception when others then
  raise notice 'pgcrypto niedostępny — pomijam (PG15+ ma gen_random_uuid w rdzeniu)';
end $$;

create schema if not exists app;

-- ── typy ─────────────────────────────────────────────────────────────────
do $$ begin
  create type public.user_role as enum ('ADMIN','COORDINATOR','WORKER');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.priority as enum ('BREAKDOWN','URGENT','NORMAL');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.work_order_status as enum ('NEW','ASSIGNED','IN_PROGRESS','ON_HOLD','DONE','CLOSED','REOPENED');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.update_type as enum ('STATUS','COMMENT','NOTE');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.assignment_type as enum ('LEAD','HELPER');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.material_status as enum ('REQUESTED','APPROVED','BOUGHT');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.report_status as enum ('DRAFT','APPROVED');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.notification_kind as enum ('ASSIGNED','PRIORITY_ESCALATED','HOLD_RAISED','HOLD_REPLY','REOPENED');
exception when duplicate_object then null; end $$;

-- ── pomocnicze ───────────────────────────────────────────────────────────
create or replace function app.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ── tabele ───────────────────────────────────────────────────────────────
create table if not exists public.profiles (
  id           uuid primary key,
  display_name text not null check (char_length(display_name) between 1 and 80),
  role         public.user_role not null default 'WORKER',
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table if not exists public.locations (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (char_length(name) between 1 and 120),
  building   text,
  floor      text,
  room       text,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index if not exists ix_locations_unique
  on public.locations (lower(name), coalesce(lower(building), ''), coalesce(lower(floor), ''), coalesce(lower(room), ''));

create table if not exists public.categories (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique check (char_length(name) between 1 and 80),
  icon       text,
  color      text check (color is null or color ~* '^#[0-9a-f]{6}$'),
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

create sequence if not exists public.work_order_number_seq start 1000;

create table if not exists public.work_orders (
  id                 uuid primary key default gen_random_uuid(),
  sequential_number  integer not null unique default nextval('public.work_order_number_seq'),
  title              text not null check (char_length(title) between 3 and 140),
  description        text not null check (char_length(description) >= 5),
  category_id        uuid references public.categories(id) on delete set null,
  location_id        uuid references public.locations(id) on delete set null,
  priority           public.priority not null default 'NORMAL',
  status             public.work_order_status not null default 'NEW',
  requester_id       uuid not null references public.profiles(id),
  lead_worker_id     uuid references public.profiles(id),
  contact_person     text,
  access_notes       text,
  expected_date      date,
  hold_reason        text,
  hold_details       text,
  next_action        text,
  hold_waiting_on    uuid references public.profiles(id),
  completion_summary text,
  is_unrequested     boolean not null default false,
  created_offline_id uuid unique, -- idempotentność tworzenia offline (operator z kolejki)
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  started_at         timestamptz,
  completed_at       timestamptz,
  closed_at          timestamptz,
  reopened_at        timestamptz,
  constraint hold_requires_fields check (
    status <> 'ON_HOLD' or (hold_reason is not null and char_length(coalesce(next_action,'')) >= 5)
  ),
  constraint done_requires_summary check (
    status <> 'DONE' or is_unrequested or char_length(coalesce(completion_summary,'')) >= 10
  )
);

create index if not exists ix_wo_status        on public.work_orders (status);
create index if not exists ix_wo_priority_open on public.work_orders (priority) where status in ('NEW','ASSIGNED','IN_PROGRESS','ON_HOLD','REOPENED');
create index if not exists ix_wo_lead          on public.work_orders (lead_worker_id);
create index if not exists ix_wo_requester     on public.work_orders (requester_id);
create index if not exists ix_wo_location      on public.work_orders (location_id);
create index if not exists ix_wo_category      on public.work_orders (category_id);
create index if not exists ix_wo_expected      on public.work_orders (expected_date);
create index if not exists ix_wo_created       on public.work_orders (created_at desc);
create index if not exists ix_wo_open_board    on public.work_orders (updated_at desc)
  where status in ('NEW','ASSIGNED','IN_PROGRESS','ON_HOLD','REOPENED');

create table if not exists public.work_order_assignees (
  id              uuid primary key default gen_random_uuid(),
  work_order_id   uuid not null references public.work_orders(id) on delete cascade,
  user_id         uuid not null references public.profiles(id) on delete cascade,
  assignment_type public.assignment_type not null,
  created_at      timestamptz not null default now(),
  unique (work_order_id, user_id),
  unique (work_order_id, assignment_type, user_id)
);
create index if not exists ix_woa_user on public.work_order_assignees (user_id);
-- najwyżej jeden prowadzący
create unique index if not exists ux_woa_one_lead on public.work_order_assignees (work_order_id) where assignment_type = 'LEAD';

-- append-only: komentarze, aktualizacje, historia statusów; NIE aktualizujemy i nie usuwamy wierszy
create table if not exists public.work_order_updates (
  id                  uuid primary key default gen_random_uuid(),
  work_order_id       uuid not null references public.work_orders(id) on delete cascade,
  update_type         public.update_type not null,
  previous_status     public.work_order_status,
  new_status          public.work_order_status,
  message             text,
  next_action         text,
  performed_by        uuid references public.profiles(id),  -- kto WYKONAŁ pracę
  entered_by          uuid not null default auth.uid() references public.profiles(id), -- kto WPISAŁ do systemu
  created_at          timestamptz not null default now(),
  client_created_at   timestamptz,
  device_operation_id uuid unique, -- deduplikacja ponowień wysyłki z kolejki offline
  check (message is not null or new_status is not null)
);
create index if not exists ix_wou_wo_time on public.work_order_updates (work_order_id, created_at);

create table if not exists public.attachments (
  id            uuid primary key default gen_random_uuid(),
  work_order_id uuid not null references public.work_orders(id) on delete cascade,
  update_id     uuid references public.work_order_updates(id) on delete set null,
  storage_path  text not null unique,
  file_name     text not null,
  mime_type     text not null check (mime_type in ('image/jpeg','image/png','image/webp')),
  size          bigint not null check (size > 0 and size < 26214400), -- <25 MB
  uploaded_by   uuid not null default auth.uid() references public.profiles(id),
  created_at    timestamptz not null default now()
);
create index if not exists ix_att_wo on public.attachments (work_order_id);

create table if not exists public.material_requests (
  id            uuid primary key default gen_random_uuid(),
  work_order_id uuid not null references public.work_orders(id) on delete cascade,
  name          text not null check (char_length(name) between 1 and 200),
  quantity      numeric(10,2) not null default 1 check (quantity > 0),
  unit          text not null default 'szt.',
  status        public.material_status not null default 'REQUESTED',
  note          text,
  created_by    uuid not null default auth.uid() references public.profiles(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists ix_mat_wo on public.material_requests (work_order_id);
create index if not exists ix_mat_status on public.material_requests (status) where status = 'REQUESTED';

create table if not exists public.daily_reports (
  id            uuid primary key default gen_random_uuid(),
  report_date   date not null unique,
  status        public.report_status not null default 'DRAFT',
  general_note  text,
  generated_by  uuid not null references public.profiles(id),
  approved_by   uuid references public.profiles(id),
  generated_at  timestamptz not null default now(),
  approved_at   timestamptz,
  snapshot_json jsonb not null
);

create table if not exists public.audit_log (
  id          bigint generated always as identity primary key,
  entity_type text not null,
  entity_id   text not null,
  action      text not null,
  actor_id    uuid,
  metadata    jsonb not null default '{}',
  created_at  timestamptz not null default now()
);
create index if not exists ix_audit_entity on public.audit_log (entity_type, entity_id, created_at desc);

create table if not exists public.notifications (
  id            uuid primary key default gen_random_uuid(),
  recipient_id  uuid not null references public.profiles(id) on delete cascade,
  work_order_id uuid references public.work_orders(id) on delete cascade,
  kind          public.notification_kind not null,
  message       text not null,
  read_at       timestamptz,
  created_at    timestamptz not null default now()
);
create index if not exists ix_notif_recipient on public.notifications (recipient_id, read_at, created_at desc);

-- ── wyzwalacze updated_at ───────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array['profiles','work_orders','material_requests'] loop
    execute format('drop trigger if exists trg_%1$s_updated_at on public.%1$I', t);
    execute format('create trigger trg_%1$s_updated_at before update on public.%1$I for each row execute function app.set_updated_at()', t);
  end loop;
end $$;

-- zatwierdzone raporty są niezmienne (snapshot dokumentu)
create or replace function app.guard_report_immutable()
returns trigger language plpgsql as $$
begin
  if old.status = 'APPROVED' then
    raise exception 'Raport zatwierdzony jest niezmienny (snapshot dokumentu)' using errcode = '42501';
  end if;
  if new.status = 'APPROVED' and auth.uid() is not null
     and (select role from public.profiles where id = auth.uid()) is distinct from 'ADMIN' then
    raise exception 'Raport może zatwierdzić tylko dyrektor lub administrator' using errcode = '42501';
  end if;
  return new;
end $$;

drop trigger if exists trg_reports_immutable on public.daily_reports;
create trigger trg_reports_immutable before update or delete on public.daily_reports
  for each row execute function app.guard_report_immutable();

-- updates są append-only
create or replace function app.guard_updates_append_only()
returns trigger language plpgsql as $$
begin
  raise exception 'Wpisy historii są dopisywane i nie można ich zmieniać' using errcode = '42501';
end $$;

drop trigger if exists trg_updates_no_delete on public.work_order_updates;
create trigger trg_updates_no_delete before update or delete on public.work_order_updates
  for each row execute function app.guard_updates_append_only();

comment on table public.work_order_updates is 'Append-only: wykonawca (performed_by) i autor wpisu (entered_by) zapisywani osobno.';
comment on column public.work_orders.created_offline_id is 'UUID operacji z kolejki offline klienta; unikalny, zapewnia idempotentne tworzenie.';
