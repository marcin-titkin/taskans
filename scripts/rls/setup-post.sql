grant usage on schema public to anon, authenticated;
grant usage on schema auth to anon, authenticated; -- RLS wywołuje auth.uid()
grant usage on schema app to authenticated;
grant all on all tables in schema public to authenticated;
grant select on all tables in schema public to anon; -- parzystość z Supabase; RLS zostawia 0 wierszy
grant all on all sequences in schema public to authenticated;
grant execute on all functions in schema app to authenticated;
grant execute on all functions in schema public to authenticated;
