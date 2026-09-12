-- Środowisko testowe RLS na czystym PostgreSQL (bez Supabase):
-- zamienniki ról i funkcji, na których polegają migracje Taskans.
create schema if not exists auth;

create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('app.uid', true), '')::uuid;
$$;

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon login password 'anon';
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated login password 'authenticated';
  end if;
end $$;

