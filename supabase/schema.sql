-- Additive schema. Run once in the separate Recipe project's SQL editor.
begin;
create table public.recipe_entries (
  user_id uuid not null references auth.users(id),
  id text not null check (length(id) > 0),
  data jsonb not null check (jsonb_typeof(data) = 'object'),
  primary key (user_id, id)
);
create table public.recipe_preferences (
  user_id uuid not null references auth.users(id),
  id text not null check (length(id) > 0),
  data jsonb not null,
  primary key (user_id, id)
);
alter table public.recipe_entries enable row level security;
alter table public.recipe_preferences enable row level security;
revoke all on public.recipe_entries, public.recipe_preferences from anon, authenticated;
grant select, insert, update, delete on public.recipe_entries, public.recipe_preferences to authenticated;
create policy recipe_entries_select on public.recipe_entries for select to authenticated using ((select auth.uid()) = user_id);
create policy recipe_entries_insert on public.recipe_entries for insert to authenticated with check ((select auth.uid()) = user_id);
create policy recipe_entries_update on public.recipe_entries for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy recipe_entries_delete on public.recipe_entries for delete to authenticated using ((select auth.uid()) = user_id);
create policy recipe_preferences_select on public.recipe_preferences for select to authenticated using ((select auth.uid()) = user_id);
create policy recipe_preferences_insert on public.recipe_preferences for insert to authenticated with check ((select auth.uid()) = user_id);
create policy recipe_preferences_update on public.recipe_preferences for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy recipe_preferences_delete on public.recipe_preferences for delete to authenticated using ((select auth.uid()) = user_id);

-- Atomic, explicit import. RLS applies to every statement. Existing cloud
-- preferences are retained, and an account with recipes cannot be imported over.
create function public.recipe_import_device(entries jsonb, preferences jsonb)
returns void language plpgsql security invoker set search_path = '' as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'Sign in before importing'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(uid::text, 0));
  if exists (select 1 from public.recipe_entries where user_id = uid) then
    raise exception 'Cloud already contains recipes. Import cancelled; no data changed.';
  end if;
  if jsonb_typeof(entries) is distinct from 'array' or jsonb_typeof(preferences) is distinct from 'object' then
    raise exception 'Invalid device export';
  end if;
  insert into public.recipe_entries(user_id, id, data)
    select uid, item->>'id', item from jsonb_array_elements(entries) item;
  insert into public.recipe_preferences(user_id, id, data)
    select uid, key, value from jsonb_each(preferences)
    on conflict (user_id, id) do nothing;
end;
$$;
revoke all on function public.recipe_import_device(jsonb,jsonb) from public, anon;
grant execute on function public.recipe_import_device(jsonb,jsonb) to authenticated;
commit;
