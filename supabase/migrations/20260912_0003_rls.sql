-- Taskans — Row Level Security. Model: cała załoga widzi zgłoszenia i zadania (wspólny obieg),
-- zapis/edycja zgodna z macierzą ról (src/lib/permissions.ts — te same reguły po stronie bazy).
-- regresa: patrz scripts/rls/test-rls.mjs (test RLS na czystym PostgreSQL).

alter table public.profiles            enable row level security;
alter table public.locations           enable row level security;
alter table public.categories          enable row level security;
alter table public.work_orders         enable row level security;
alter table public.work_order_assignees enable row level security;
alter table public.work_order_updates  enable row level security;
alter table public.attachments         enable row level security;
alter table public.material_requests   enable row level security;
alter table public.daily_reports       enable row level security;
alter table public.audit_log           enable row level security;
alter table public.notifications       enable row level security;

-- profiles: każdy zalogowany widzi listę załogi (potrzebna do przydziałów i nazwisk offline)
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated using (true);

drop policy if exists profiles_self_or_admin on public.profiles;
create policy profiles_self_or_admin on public.profiles
  for update to authenticated
  using (id = (select auth.uid()) or app.is_admin())
  with check (id = (select auth.uid()) or app.is_admin());

-- słowniki: odczyt dla załogi, zapis dla przełożonych (nazwy lokalizacji nie mogą się rozjechać)
drop policy if exists dict_select on public.locations;
create policy dict_select on public.locations for select to authenticated using (true);
drop policy if exists dict_write on public.locations;
create policy dict_write on public.locations
  for all to authenticated
  using (app.is_manager()) with check (app.is_manager());

drop policy if exists cat_select on public.categories;
create policy cat_select on public.categories for select to authenticated using (true);
drop policy if exists cat_write on public.categories;
create policy cat_write on public.categories
  for all to authenticated
  using (app.is_manager()) with check (app.is_manager());

-- zlecenia: wszyscy czytają; tworzy każdy (requester = sobie); aktualizacja przez funkcje RPC
drop policy if exists wo_select on public.work_orders;
create policy wo_select on public.work_orders for select to authenticated using (true);

drop policy if exists wo_insert on public.work_orders;
create policy wo_insert on public.work_orders
  for insert to authenticated
  with check (
    requester_id = (select auth.uid()) or app.is_manager()
  );

-- aktualizacja: warunek globalny, a pola i statusy dozoruje trigger app.guard_wo_columns()
drop policy if exists wo_update on public.work_orders;
create policy wo_update on public.work_orders
  for update to authenticated
  using (app.is_manager() or app.is_participant(id) or requester_id = (select auth.uid()))
  with check (app.is_manager() or app.is_participant(id) or requester_id = (select auth.uid()));

-- usuwanie zleceń nie istnieje w obiegu (historyjne zostają)
drop policy if exists wo_delete on public.work_orders;

-- przydziały: czyta każdy, pisze tylko przełożony (przez assign_work_order)
drop policy if exists assigns_select on public.work_order_assignees;
create policy assigns_select on public.work_order_assignees for select to authenticated using (true);
drop policy if exists assigns_write on public.work_order_assignees;
create policy assigns_write on public.work_order_assignees
  for all to authenticated
  using (app.is_manager()) with check (app.is_manager());

-- historia: czytają wszyscy, dopisuje uczestnik lub przełożony; performed_by innego pracownika tylko przez przełożonego
drop policy if exists upd_select on public.work_order_updates;
create policy upd_select on public.work_order_updates for select to authenticated using (true);

drop policy if exists upd_insert on public.work_order_updates;
create policy upd_insert on public.work_order_updates
  for insert to authenticated
  with check (
    -- jawność: każdy członek zespołu komentuje; „w imieniu” tylko przez przełożonego
    entered_by = (select auth.uid())
    and (performed_by is null or performed_by = (select auth.uid()) or app.is_manager())
  );
-- brak polityki update/delete → append-only również na poziomie RLS (plus trigger)

-- zdjęcia: widoczne dla załogi (spójny cache offline), wgrywa właściciel, sprząta autor lub admin
drop policy if exists att_select on public.attachments;
create policy att_select on public.attachments for select to authenticated using (true);
drop policy if exists att_insert on public.attachments;
create policy att_insert on public.attachments for insert to authenticated with check (uploaded_by = (select auth.uid()));
drop policy if exists att_delete on public.attachments;
create policy att_delete on public.attachments for delete to authenticated using (uploaded_by = (select auth.uid()) or app.is_admin());

-- materiały: czytają wszyscy; zgłasza uczestnik/przełożony; status zmienia przełożony
drop policy if exists mat_select on public.material_requests;
create policy mat_select on public.material_requests for select to authenticated using (true);
drop policy if exists mat_insert on public.material_requests;
create policy mat_insert on public.material_requests
  for insert to authenticated with check (created_by = (select auth.uid()));
drop policy if exists mat_update on public.material_requests;
create policy mat_update on public.material_requests
  for update to authenticated using (app.is_manager()) with check (app.is_manager());

-- raporty: wyłącznie przełożeni (zatwierdzanie: admin — pilnowane triggerem i funkcją)
drop policy if exists rep_manager on public.daily_reports;
create policy rep_manager on public.daily_reports
  for all to authenticated
  using (app.is_manager()) with check (app.is_manager());

-- audyt: tylko administrator (przegląd)
drop policy if exists audit_admin on public.audit_log;
create policy audit_admin on public.audit_log
  for select to authenticated using (app.is_admin());

-- powiadomienia: tylko odbiorca
drop policy if exists notif_self on public.notifications;
create policy notif_self on public.notifications
  for select to authenticated using (recipient_id = (select auth.uid()));
drop policy if exists notif_read on public.notifications;
create policy notif_read on public.notifications
  for update to authenticated
  using (recipient_id = (select auth.uid()))
  with check (recipient_id = (select auth.uid()));
-- insert tylko przez app.notify() (security definer) i wyzwalacze

grant usage on schema public to authenticated;
grant execute on function
  public.create_work_order(uuid,text,text,uuid,uuid,text,text,text,date,uuid,uuid[],uuid),
  public.update_work_order_fields(uuid,text,text,uuid,uuid,text,date,text,text),
  public.assign_work_order(uuid,uuid,uuid[],uuid),
  public.transition_work_order(uuid,text,text,text,text,text,uuid,text,uuid,text,uuid),
  public.log_work_order_update(uuid,text,text,text,uuid,uuid),
  public.add_material_request(uuid,text,numeric,text,text),
  public.set_material_status(uuid,text),
  public.create_unrequested_work(uuid,text,text,uuid,uuid,uuid[],text,uuid),
  public.save_report_draft(date,jsonb,text),
  public.approve_report(date,jsonb,text),
  public.mark_notifications_read(uuid[])
to authenticated;
