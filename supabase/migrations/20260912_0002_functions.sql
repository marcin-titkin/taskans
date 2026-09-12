-- Taskans — funkcje domenowe (RPC wywoływane z klienta) + wyzwalacze powiadomień/audytu.
-- Wszystkie reguły, które zna klient (macierz statusów, wymagane pola, uprawnienia),
-- są egzekwowane TU ponownie. Klient jest traktowany jak wróg: rola pochodzi z auth.uid(), nie z payloadu.

-- ── pomocnicze ───────────────────────────────────────────────────────────
create or replace function app.current_role()
returns public.user_role
language sql stable security definer set search_path = public
as $$
  select role from public.profiles where id = auth.uid() and active;
$$;

create or replace function app.is_manager()
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(app.current_role() in ('ADMIN','COORDINATOR'), false);
$$;

create or replace function app.is_admin()
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(app.current_role() = 'ADMIN', false);
$$;

create or replace function app.is_participant(p_work_order_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.work_orders w
    where w.id = p_work_order_id
      and (w.lead_worker_id = auth.uid() or w.requester_id = auth.uid())
  ) or exists (
    select 1 from public.work_order_assignees a
    where a.work_order_id = p_work_order_id and a.user_id = auth.uid()
  );
$$;

-- macierz dozwolonych przejść (lustrzane odbicie src/lib/transitions.ts; pilnuje tego test RLS)
create or replace function app.validate_transition(from_st public.work_order_status, to_st public.work_order_status)
returns boolean
language sql immutable
as $$
  select case
    when from_st = 'NEW'        then to_st in ('ASSIGNED','ON_HOLD','CLOSED','DONE')
    when from_st = 'ASSIGNED'   then to_st in ('IN_PROGRESS','ON_HOLD','NEW','CLOSED','DONE')
    when from_st = 'IN_PROGRESS'then to_st in ('ON_HOLD','DONE')
    when from_st = 'ON_HOLD'    then to_st in ('IN_PROGRESS','ASSIGNED','CLOSED')
    when from_st = 'DONE'       then to_st in ('CLOSED','REOPENED')
    when from_st = 'CLOSED'     then to_st in ('REOPENED')
    when from_st = 'REOPENED'   then to_st in ('IN_PROGRESS','ASSIGNED','ON_HOLD','DONE','CLOSED')
    else false
  end;
$$;

-- zapis audytu przez SECURITY DEFINER (invoker nie ma polityki INSERT na audit_log — to celowe)
create or replace function app.audit(p_entity text, p_id text, p_action text, p_meta jsonb default '{}'::jsonb)
returns void
language sql security definer set search_path = public
as $$
  insert into public.audit_log (entity_type, entity_id, action, actor_id, metadata)
  values (p_entity, p_id, p_action, auth.uid(), p_meta);
$$;

-- ── strażnik kolumn: wykonawca nie zmieni pól „kierowniczych” nawet przez REST ──
create or replace function app.guard_wo_columns()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  manager boolean := app.is_manager();
begin
  if not manager then
    if new.sequential_number      is distinct from old.sequential_number
    or new.title                 is distinct from old.title
    or new.description           is distinct from old.description
    or new.category_id           is distinct from old.category_id
    or new.location_id           is distinct from old.location_id
    or new.priority              is distinct from old.priority
    or new.requester_id          is distinct from old.requester_id
    or new.lead_worker_id        is distinct from old.lead_worker_id
    or new.contact_person        is distinct from old.contact_person
    or new.access_notes          is distinct from old.access_notes
    or new.expected_date         is distinct from old.expected_date
    or new.is_unrequested        is distinct from old.is_unrequested
    or new.created_offline_id    is distinct from old.created_offline_id
    then
      raise exception 'Nie masz uprawnień do zmiany tych pól zadania' using errcode = '42501';
    end if;
  end if;

  if new.status is distinct from old.status then
    if not app.validate_transition(old.status, new.status) then
      raise exception 'Dozwolone przejścia statusów nie obejmują % → %', old.status, new.status using errcode = 'P0001';
    end if;
    if not manager and not app.is_participant(new.id) then
      raise exception 'Zmieniać status może tylko osoba przydzielona lub przełożony' using errcode = '42501';
    end if;
    if new.status in ('CLOSED','REOPENED') and not manager then
      raise exception 'Zamknięcie i ponowne otwarcie wymaga uprawnień przełożonego' using errcode = '42501';
    end if;
    if new.status = 'ON_HOLD' and (new.hold_reason is null or coalesce(new.hold_details,'') = '' or char_length(coalesce(new.next_action,'')) < 5) then
      raise exception 'Wstrzymanie wymaga powodu, opisu sytuacji i następnego kroku' using errcode = 'P0001';
    end if;
    if new.status = 'DONE' and not old.is_unrequested and char_length(coalesce(new.completion_summary,'')) < 10 then
      raise exception 'Przy oznaczeniu wykonania wymagany jest krótki opis rezultatu' using errcode = 'P0001';
    end if;
    -- znaczniki czasu i porządkowanie pól blokady
    if new.status = 'IN_PROGRESS' then
      new.started_at := coalesce(old.started_at, now());
      new.hold_reason := null; new.hold_details := null; new.next_action := null; new.hold_waiting_on := null;
    end if;
    if new.status = 'DONE' then
      new.completed_at := now();
      new.hold_reason := null; new.hold_details := null; new.next_action := null; new.hold_waiting_on := null;
    end if;
    if new.status = 'CLOSED' then
      new.closed_at := now();
    end if;
    if new.status = 'REOPENED' then
      new.reopened_at := now(); new.completed_at := null; new.closed_at := null;
    end if;
    if old.status = 'ON_HOLD' and new.status <> 'ON_HOLD' then
      new.hold_reason := null; new.hold_details := null; new.next_action := null; new.hold_waiting_on := null;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_wo_guard on public.work_orders;
create trigger trg_wo_guard before update on public.work_orders
  for each row execute function app.guard_wo_columns();

-- ── powiadomienia wewnątrz aplikacji (tylko istotne zdarzenia) ────────────
create or replace function app.notify(
  p_recipient uuid, p_work_order uuid, p_kind public.notification_kind, p_message text
)
returns void
language sql security definer set search_path = public
as $$
  insert into public.notifications (recipient_id, work_order_id, kind, message)
  select p_recipient, p_work_order, p_kind, p_message
  where p_recipient is not null and p_recipient <> auth.uid()
    and exists (select 1 from public.profiles pr where pr.id = p_recipient and pr.active);
$$;

create or replace function app.wo_participants(p_work_order uuid)
returns setof uuid
language sql stable security definer set search_path = public
as $$
  select lead_worker_id from public.work_orders where id = p_work_order and lead_worker_id is not null
  union
  select user_id from public.work_order_assignees where work_order_id = p_work_order;
$$;

-- ranga priorytetu do porównań „w górę” (CASE w warunku IF myli parser plpgsql — stąd helper)
create or replace function app.priority_rank(p public.priority)
returns int
language sql immutable
as $$
  select case p when 'NORMAL' then 0 when 'URGENT' then 1 when 'BREAKDOWN' then 2 end;
$$;

-- dopisanie uczestników przy tworzeniu (WORKER też tworzy zlecenie z sobą jako prowadzącym —
-- polityka assigns_write dotyczy tylko „zarządzania cudzymi przydziałami”, stąd definer-helper z pełną walidacją w wywołującym)
create or replace function app.insert_assignees(p_wo uuid, p_users uuid[], p_lead uuid)
returns void
language sql security definer set search_path = public
as $$
  insert into public.work_order_assignees (work_order_id, user_id, assignment_type)
  select p_wo, u, (case when u = p_lead then 'LEAD' else 'HELPER' end)::public.assignment_type
  from unnest(p_users) u
  on conflict (work_order_id, user_id) do nothing;
$$;

-- eskalacja priorytetu → powiadom uczestników (tylko w górę: do URGENT/BREAKDOWN)
create or replace function app.notify_priority_escalation()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare u uuid;
begin
  if new.priority is distinct from old.priority
     and app.priority_rank(new.priority) > app.priority_rank(old.priority)
  then
    for u in select app.wo_participants(new.id) loop
      perform app.notify(u, new.id, 'PRIORITY_ESCALATED', 'Podniesiono priorytet: ' || new.title);
    end loop;
    insert into public.audit_log (entity_type, entity_id, action, actor_id, metadata)
      values ('work_order', new.id::text, 'priority_changed', auth.uid(), jsonb_build_object('from', old.priority, 'to', new.priority));
  end if;
  return new;
end $$;

drop trigger if exists trg_wo_priority_notify on public.work_orders;
create trigger trg_wo_priority_notify after update on public.work_orders
  for each row execute function app.notify_priority_escalation();

-- zmiana prowadzącego → powiadom nowego i (jeśli był) starego
create or replace function app.notify_lead_change()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.lead_worker_id is distinct from old.lead_worker_id then
    perform app.notify(new.lead_worker_id, new.id, 'ASSIGNED', 'Nowy przydział: ' || new.title);
    perform app.notify(old.lead_worker_id, new.id, 'ASSIGNED', 'Zadanie przekazane dalej: ' || new.title);
    insert into public.audit_log (entity_type, entity_id, action, actor_id, metadata)
      values ('work_order', new.id::text, 'lead_changed', auth.uid(),
              jsonb_build_object('from', old.lead_worker_id, 'to', new.lead_worker_id));
  end if;
  return new;
end $$;

drop trigger if exists trg_wo_lead_notify on public.work_orders;
create trigger trg_wo_lead_notify after update on public.work_orders
  for each row execute function app.notify_lead_change();

-- audyt zmiany ról użytkowników
create or replace function app.audit_profile_change()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.role is distinct from old.role or new.active is distinct from old.active then
    insert into public.audit_log (entity_type, entity_id, action, actor_id, metadata)
      values ('profile', new.id::text, 'role_or_active_changed', auth.uid(),
              jsonb_build_object('role_from', old.role, 'role_to', new.role, 'active', new.active));
  end if;
  return new;
end $$;

drop trigger if exists trg_profiles_audit on public.profiles;
create trigger trg_profiles_audit after update on public.profiles
  for each row execute function app.audit_profile_change();

-- zmiana przydziału tylko przez administratora (rola/aktywność), self może zmienić nazwę
create or replace function app.guard_profile_update()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if not app.is_admin() then
    if new.role is distinct from old.role or new.active is distinct from old.active then
      raise exception 'Rolę i aktywność konta zmienia tylko administrator' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_profiles_guard on public.profiles;
create trigger trg_profiles_guard before update on public.profiles
  for each row execute function app.guard_profile_update();

-- ── RPC: tworzenie zlecenia (id klienta = uuid generowany offline) ───────
create or replace function public.create_work_order(
  p_id uuid,
  p_title text, p_description text,
  p_location_id uuid, p_category_id uuid,
  p_priority text,
  p_contact_person text default null,
  p_access_notes text default null,
  p_expected_date date default null,
  p_lead_worker_id uuid default null,
  p_helper_ids uuid[] default '{}',
  p_op_id uuid default null
)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_id uuid;
  v_status public.work_order_status;
begin
  if char_length(trim(p_title)) < 3 then
    raise exception 'Tytuł musi mieć co najmniej 3 znaki' using errcode = 'P0001';
  end if;
  if char_length(trim(p_description)) < 5 then
    raise exception 'Opisz problem lub oczekiwany rezultat' using errcode = 'P0001';
  end if;
  if p_location_id is null or not exists (select 1 from locations l where l.id = p_location_id and l.active) then
    raise exception 'Wybierz poprawną lokalizację' using errcode = 'P0001';
  end if;
  if not app.is_manager() and p_lead_worker_id is not null and p_lead_worker_id <> auth.uid() then
    raise exception 'Przypisać prowadzącego może tylko przełożony' using errcode = '42501';
  end if;
  v_status := case when p_lead_worker_id is not null then 'ASSIGNED'::public.work_order_status else 'NEW'::public.work_order_status end;

  insert into work_orders (
    id, created_offline_id, title, description, location_id, category_id, priority,
    status, requester_id, lead_worker_id, contact_person, access_notes, expected_date
  ) values (
    p_id, p_op_id, trim(p_title), trim(p_description), p_location_id, p_category_id,
    p_priority::public.priority, v_status, auth.uid(), p_lead_worker_id,
    nullif(trim(coalesce(p_contact_person,'')), ''), nullif(trim(coalesce(p_access_notes,'')), ''), p_expected_date
  )
  on conflict (id) do nothing
  returning id into v_id;

  if v_id is null then
    return p_id; -- idempotentne odtworzenie operacji offline
  end if;

  if p_lead_worker_id is not null or coalesce(array_length(p_helper_ids, 1), 0) > 0 then
    perform app.insert_assignees(v_id, array_remove(array_prepend(p_lead_worker_id, p_helper_ids), null), p_lead_worker_id);
  end if;

  return v_id;
exception when unique_violation then
  return p_id; -- created_offline_id już zastosowany
end $$;

-- ── RPC: zmiana pól przez przełożonego (lub zgłaszającego gdy status NEW) ─
create or replace function public.update_work_order_fields(
  p_id uuid,
  p_title text default null, p_description text default null,
  p_location_id uuid default null, p_category_id uuid default null,
  p_priority text default null,
  p_expected_date date default null,
  p_contact_person text default null,
  p_access_notes text default null
)
returns void
language plpgsql security invoker
set search_path = public
as $$
declare wo work_orders;
begin
  select * into wo from work_orders where id = p_id for update;
  if not found then raise exception 'Nie znaleziono zadania' using errcode = 'P0002'; end if;
  if not (app.is_manager() or (wo.status = 'NEW' and wo.requester_id = auth.uid())) then
    raise exception 'Pola zadania może edytować tylko przełożony lub zgłaszający (gdy status: Nowe)' using errcode = '42501';
  end if;
  update work_orders set
    title           = coalesce(nullif(trim(p_title), ''), title),
    description     = coalesce(nullif(trim(p_description), ''), description),
    location_id     = coalesce(p_location_id, location_id),
    category_id     = coalesce(p_category_id, category_id),
    priority        = coalesce(p_priority::public.priority, priority),
    expected_date   = coalesce(p_expected_date, expected_date),
    contact_person  = coalesce(p_contact_person, contact_person),
    access_notes    = coalesce(p_access_notes, access_notes)
  where id = p_id;
end $$;

-- ── RPC: przydział prowadzącego + współpracowników (tylko przełożony) ────
create or replace function public.assign_work_order(
  p_id uuid, p_lead uuid, p_helpers uuid[] default '{}', p_op_id uuid default null
)
returns void
language plpgsql security invoker
set search_path = public
as $$
declare wo work_orders; v_prev_status public.work_order_status;
begin
  if not app.is_manager() then
    raise exception 'Przypisywać innych użytkowników może tylko dyrektor lub koordynator' using errcode = '42501';
  end if;
  if p_op_id is not null and exists (select 1 from work_order_updates u where u.device_operation_id = p_op_id) then
    return;
  end if;
  select * into wo from work_orders where id = p_id for update;
  if not found then raise exception 'Nie znaleziono zadania' using errcode = 'P0002'; end if;

  v_prev_status := wo.status;
  delete from work_order_assignees where work_order_id = p_id;
  if p_lead is not null then
    insert into work_order_assignees (work_order_id, user_id, assignment_type) values (p_id, p_lead, 'LEAD');
  end if;
  insert into work_order_assignees (work_order_id, user_id, assignment_type)
    select p_id, u, 'HELPER' from unnest(p_helpers) as u
    where u <> coalesce(p_lead, '00000000-0000-0000-0000-000000000000'::uuid);

  update work_orders set
    lead_worker_id = p_lead,
    status = case
      when v_prev_status = 'NEW' and p_lead is not null then 'ASSIGNED'
      when v_prev_status = 'ASSIGNED' and p_lead is null then 'NEW'
      else v_prev_status end
  where id = p_id;

  insert into work_order_updates (
    work_order_id, update_type, previous_status, new_status, message, performed_by, entered_by, device_operation_id
  ) values (
    p_id, 'STATUS', v_prev_status,
    case when v_prev_status = 'NEW' and p_lead is not null then 'ASSIGNED'
         when v_prev_status = 'ASSIGNED' and p_lead is null then 'NEW'
         else v_prev_status end,
    'Przydział zaktualizowany przez przełożonego.', auth.uid(), auth.uid(), p_op_id
  );
end $$;

-- ── RPC: kontrolowana zmiana statusu (serce obiegu) ───────────────────────
create or replace function public.transition_work_order(
  p_work_order_id uuid,
  p_new_status text,
  p_message text default null,
  p_hold_reason text default null,
  p_hold_details text default null,
  p_next_action text default null,
  p_hold_waiting_on uuid default null,
  p_completion_summary text default null,
  p_performed_by uuid default null,
  p_expected_previous text default null,
  p_device_operation_id uuid default null
)
returns uuid
language plpgsql security invoker
set search_path = public
as $$
declare
  wo work_orders;
  v_actor uuid := auth.uid();
  v_recipient uuid;
  v_new public.work_order_status := p_new_status::public.work_order_status;
  v_update_id uuid;
begin
  if p_device_operation_id is not null then
    select id into v_update_id from work_order_updates where device_operation_id = p_device_operation_id;
    if v_update_id is not null then
      return v_update_id; -- ponowna wysyłka z kolejki: już zastosowane
    end if;
  end if;

  select * into wo from work_orders where id = p_work_order_id for update;
  if not found then
    raise exception 'Nie znaleziono zadania' using errcode = 'P0002';
  end if;

  if p_expected_previous is not null and wo.status <> p_expected_previous::public.work_order_status then
    raise exception 'Status na serwerze jest już inny (zadanie zmieniło etap, gdy pracowałeś offline)' using errcode = 'P0001';
  end if;

  if not (app.is_manager() or app.is_participant(wo.id)) then
    raise exception 'Zmieniać status może tylko osoba przydzielona lub przełożony' using errcode = '42501';
  end if;
  if not app.validate_transition(wo.status, v_new) then
    raise exception 'Dozwolone przejścia statusów nie obejmują % → %', wo.status, v_new using errcode = 'P0001';
  end if;
  if v_new in ('CLOSED','REOPENED') and not app.is_manager() then
    raise exception 'Zamknięcie lub ponowne otwarcie wymaga uprawnień przełożonego' using errcode = '42501';
  end if;
  if v_new = 'ON_HOLD' and (p_hold_reason is null or coalesce(p_hold_details,'') = '' or char_length(coalesce(p_next_action,'')) < 5) then
    raise exception 'Wstrzymanie wymaga powodu, opisu i następnego kroku' using errcode = 'P0001';
  end if;
  if v_new = 'DONE' and not wo.is_unrequested and char_length(coalesce(p_completion_summary, wo.completion_summary, '')) < 10 then
    raise exception 'Krótko napisz, co zostało wykonane i jaki jest rezultat' using errcode = 'P0001';
  end if;
  if v_new = 'REOPENED' and char_length(coalesce(p_message,'')) < 5 then
    raise exception 'Przy ponownym otwarciu podaj, dlaczego zadanie wraca' using errcode = 'P0001';
  end if;
  if p_performed_by is not null and p_performed_by <> v_actor and not app.is_manager() then
    raise exception 'Wpis w imieniu innej osoby może wprowadzić tylko przełożony' using errcode = '42501';
  end if;

  update work_orders set
    status             = v_new,
    hold_reason        = case when v_new = 'ON_HOLD' then coalesce(p_hold_reason, 'inne') else null end,
    hold_details       = case when v_new = 'ON_HOLD' then nullif(p_hold_details,'') else null end,
    next_action        = case when v_new in ('ON_HOLD') then nullif(p_next_action,'') else null end,
    hold_waiting_on    = case when v_new = 'ON_HOLD' then p_hold_waiting_on else null end,
    completion_summary = case when v_new = 'DONE' then coalesce(nullif(p_completion_summary,''), completion_summary) else completion_summary end
  where id = wo.id;

  insert into work_order_updates (
    work_order_id, update_type, previous_status, new_status, message, next_action,
    performed_by, entered_by, device_operation_id, client_created_at
  ) values (
    wo.id, 'STATUS', wo.status, v_new,
    coalesce(nullif(p_message,''),
             nullif(p_completion_summary,''),
             case when v_new = 'ON_HOLD' and p_hold_details is not null
                  then 'Powód: ' || coalesce(p_hold_reason,'') || '. ' || p_hold_details
                  else null end),
    nullif(p_next_action,''),
    coalesce(p_performed_by, v_actor), v_actor, p_device_operation_id, now()
  )
  returning id into v_update_id;

  if v_new = 'ON_HOLD' then
    for v_recipient in select id from profiles where role in ('ADMIN','COORDINATOR') and active loop
      perform app.notify(v_recipient, wo.id, 'HOLD_RAISED', 'Blokada wymaga decyzji: ' || wo.title);
    end loop;
  end if;
  if v_new = 'REOPENED' then
    for v_recipient in select app.wo_participants(wo.id) loop
      perform app.notify(v_recipient, wo.id, 'REOPENED', 'Zadanie wróciło do pracy: ' || wo.title);
    end loop;
  end if;

  return v_update_id;
end $$;

-- ── RPC: komentarze i aktualizacje (append-only, nigdy nie nadpisujemy) ───
create or replace function public.log_work_order_update(
  p_id uuid,
  p_update_type text,
  p_message text,
  p_next_action text default null,
  p_performed_by uuid default null,
  p_op_id uuid default null
)
returns uuid
language plpgsql security invoker
set search_path = public
as $$
declare wo work_orders; v_id uuid; v_actor uuid := auth.uid();
begin
  if p_op_id is not null then
    select id into v_id from work_order_updates where device_operation_id = p_op_id;
    if v_id is not null then return v_id; end if;
  end if;
  if char_length(trim(coalesce(p_message,''))) < 3 then
    raise exception 'Wpis jest za krótki' using errcode = 'P0001';
  end if;
  select * into wo from work_orders where id = p_id for update;
  if not found then raise exception 'Nie znaleziono zadania' using errcode = 'P0002'; end if;
  if p_performed_by is not null and p_performed_by <> v_actor and not app.is_manager() then
    raise exception 'Wpis w imieniu innej osoby tylko przez przełożonego' using errcode = '42501';
  end if;

  insert into work_order_updates (work_order_id, update_type, message, next_action, performed_by, entered_by, device_operation_id)
  values (p_id, p_update_type::public.update_type, trim(p_message), nullif(p_next_action,''), coalesce(p_performed_by, v_actor), v_actor, p_op_id)
  returning id into v_id;

  -- odpowiedź na blokadę: przełożony komentuje zadanie ON_HOLD → powiadom zgłaszającego blokadę
  if wo.status = 'ON_HOLD' and app.is_manager() then
    perform app.notify(u.entered_by, p_id, 'HOLD_REPLY', 'Odpowiedź na blokadę: ' || wo.title)
    from work_order_updates u
    where u.work_order_id = p_id and u.new_status = 'ON_HOLD' and u.entered_by <> v_actor
    order by u.created_at desc limit 1;
  end if;

  return v_id;
end $$;

-- ── RPC: materiały ───────────────────────────────────────────────────────
create or replace function public.add_material_request(
  p_id uuid, p_name text, p_quantity numeric default 1, p_unit text default 'szt.', p_note text default null
)
returns uuid
language plpgsql security invoker
set search_path = public
as $$
declare v uuid;
begin
  if not (app.is_manager() or app.is_participant(p_id)) then
    raise exception 'Materiał zgłasza uczestnik zadania lub przełożony' using errcode = '42501';
  end if;
  if char_length(trim(coalesce(p_name,''))) < 2 then
    raise exception 'Podaj nazwę materiału' using errcode = 'P0001';
  end if;
  insert into material_requests (work_order_id, name, quantity, unit, note)
  values (p_id, trim(p_name), greatest(p_quantity, 0.01), coalesce(nullif(trim(p_unit),''), 'szt.'), nullif(trim(coalesce(p_note,'')),''))
  returning id into v;
  return v;
end $$;

create or replace function public.set_material_status(p_id uuid, p_status text)
returns void
language sql security invoker
set search_path = public
as $$
  update material_requests set status = p_status::public.material_status
  where id = p_id and app.is_manager();
$$;

-- ── RPC: praca wykonana bez zlecenia (status DONE od razu) ────────────────
create or replace function public.create_unrequested_work(
  p_id uuid,
  p_title text, p_description text,
  p_location_id uuid, p_category_id uuid,
  p_performed_by uuid[],
  p_completion_summary text,
  p_op_id uuid default null
)
returns uuid
language plpgsql security invoker
set search_path = public
as $$
declare v_id uuid; v_lead uuid := (p_performed_by)[1];
begin
  if p_op_id is not null then
    select id into v_id from work_orders where created_offline_id = p_op_id;
    if v_id is not null then return v_id; end if;
  end if;
  if coalesce(array_length(p_performed_by,1),0) = 0 then
    raise exception 'Wskaż, kto wykonał pracę' using errcode = 'P0001';
  end if;
  if not app.is_manager() and not auth.uid() = any(p_performed_by) then
    raise exception 'Wykonawca zgłasza pracę wykonaną przez siebie; za inne osoby wpis wprowadza przełożony' using errcode = '42501';
  end if;
  if char_length(trim(coalesce(p_completion_summary,''))) < 10 then
    raise exception 'Opisz krótko rezultat wykonanej pracy' using errcode = 'P0001';
  end if;

  insert into work_orders (
    id, created_offline_id, title, description, location_id, category_id, priority, status,
    requester_id, lead_worker_id, is_unrequested, completion_summary, started_at, completed_at
  ) values (
    p_id, p_op_id, trim(p_title), trim(coalesce(nullif(p_description,''), p_completion_summary)), p_location_id, p_category_id,
    'NORMAL', 'DONE', auth.uid(), v_lead, true, trim(p_completion_summary), now(), now()
  )
  on conflict (id) do nothing
  returning id into v_id;

  if v_id is null then return p_id; end if;

  perform app.insert_assignees(v_id, p_performed_by, v_lead);

  insert into work_order_updates (work_order_id, update_type, previous_status, new_status, message, performed_by, entered_by, device_operation_id)
  values (v_id, 'STATUS', null, 'DONE',
          'Praca wykonana bez wcześniejszego zlecenia. Wykonawcy: '
            || (select string_agg(display_name, ', ') from profiles where id = any(p_performed_by)),
          v_lead, auth.uid(), p_op_id);
  return v_id;
exception when unique_violation then
  return p_id;
end $$;

-- ── raport dzienny ───────────────────────────────────────────────────────
create or replace function public.save_report_draft(p_date date, p_snapshot jsonb, p_note text default null)
returns void
language plpgsql security invoker
set search_path = public
as $$
declare cur daily_reports;
begin
  if not app.is_manager() then
    raise exception 'Raport tworzy i zapisuje przełożony' using errcode = '42501';
  end if;
  select * into cur from daily_reports where report_date = p_date for update;
  if cur.id is not null and cur.status = 'APPROVED' then
    raise exception 'Zatwierdzony raport jest niezmienny' using errcode = '42501';
  end if;
  if cur.id is null then
    insert into daily_reports (report_date, status, general_note, generated_by, snapshot_json)
    values (p_date, 'DRAFT', nullif(p_note,''), auth.uid(), p_snapshot);
  else
    update daily_reports set snapshot_json = p_snapshot, general_note = nullif(p_note,''), generated_at = now(), generated_by = auth.uid()
    where id = cur.id;
  end if;
end $$;

create or replace function public.approve_report(p_date date, p_snapshot jsonb, p_note text default null)
returns void
language plpgsql security invoker
set search_path = public
as $$
declare cur daily_reports;
begin
  if not app.is_admin() then
    raise exception 'Raport zatwierdza tylko dyrektor lub administrator' using errcode = '42501';
  end if;
  select * into cur from daily_reports where report_date = p_date for update;
  if cur.id is null then
    insert into daily_reports (report_date, status, general_note, generated_by, approved_by, approved_at, snapshot_json)
    values (p_date, 'APPROVED', nullif(p_note,''), auth.uid(), auth.uid(), now(), p_snapshot);
  else
    if cur.status = 'APPROVED' then
      raise exception 'Ten raport jest już zatwierdzony i pozostaje niezmienny' using errcode = '42501';
    end if;
    update daily_reports
      set status = 'APPROVED', general_note = nullif(p_note,''), approved_by = auth.uid(), approved_at = now(), snapshot_json = p_snapshot
      where id = cur.id;
  end if;
  perform app.audit('daily_report', p_date::text, 'approved', jsonb_build_object('note_len', char_length(coalesce(p_note,''))));
end $$;

-- ── powiadomienia: oznacz przeczytane (własne) ───────────────────────────
create or replace function public.mark_notifications_read(p_ids uuid[] default null)
returns void
language sql security invoker
set search_path = public
as $$
  update notifications set read_at = now()
  where recipient_id = auth.uid()
    and (p_ids is null or id = any(p_ids));
$$;

-- ── auto-profil po rejestracji w Supabase Auth (tylko gdy istnieje auth.users) ─
do $$ begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'auth' and p.proname = 'uid')
     and exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'auth' and c.relname = 'users')
  then
    execute $fn$
      create or replace function public.handle_new_user()
      returns trigger language plpgsql security definer set search_path = public
      as $body$
      begin
        insert into public.profiles (id, display_name, role)
        values (new.id,
                coalesce(nullif(new.raw_user_meta_data->>'display_name',''), split_part(new.email,'@',1)),
                'WORKER')
        on conflict (id) do nothing;
        return new;
      end $body$;
    $fn$;
    execute 'drop trigger if exists on_auth_user_created on auth.users';
    execute 'create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user()';
  end if;
end $$;

-- real-time (dopuszcza zmianę tabel) — tylko jeśli publikacja istnieje (Supabase)
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin execute 'alter publication supabase_realtime add table public.work_orders'; exception when duplicate_object then null; end;
    begin execute 'alter publication supabase_realtime add table public.work_order_updates'; exception when duplicate_object then null; end;
    begin execute 'alter publication supabase_realtime add table public.notifications'; exception when duplicate_object then null; end;
    begin execute 'alter publication supabase_realtime add table public.daily_reports'; exception when duplicate_object then null; end;
  end if;
end $$;
