-- Taskans — Storage: prywatny bucket załączników + polityki (tylko na Supabase).
-- Ścieżka: wo/{workOrderId}/{photoId}.jpg. Podgląd przez signed URL (~120 s) generowany przez klienta.
do $$ begin
  if not exists (select 1 from pg_namespace where nspname = 'storage') then
    return;
  end if;

  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('attachments', 'attachments', false, 26214400, array['image/jpeg','image/png','image/webp'])
  on conflict (id) do nothing;

  execute $p$
    drop policy if exists "taskans read attachments" on storage.objects;
    create policy "taskans read attachments" on storage.objects
      for select to authenticated
      using (bucket_id = 'attachments');
  $p$;
  execute $p$
    drop policy if exists "taskans write own attachments" on storage.objects;
    create policy "taskans write own attachments" on storage.objects
      for insert to authenticated
      with check (
        bucket_id = 'attachments'
        and (storage.foldername(name))[1] = 'wo'
        and exists (
          select 1 from public.attachments a
          where a.storage_path = storage.objects.name
            and a.uploaded_by = auth.uid()
        )
      );
  $p$;
  execute $p$
    drop policy if exists "taskans delete own attachments" on storage.objects;
    create policy "taskans delete own attachments" on storage.objects
      for delete to authenticated
      using (
        bucket_id = 'attachments'
        and (
          exists (select 1 from public.attachments a where a.storage_path = storage.objects.name and a.uploaded_by = auth.uid())
          or app.is_admin()
        )
      );
  $p$;
exception when undefined_table then
  raise notice 'Storage niedostępny w tym środowisku — pomijam (dotyczy tylko Supabase).';
end $$;
