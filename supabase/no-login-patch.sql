-- Run ONCE in Supabase > SQL Editor after schema.sql. Makes the app work without user accounts:
-- anyone who has the link can view and enter stock. GRN and issue records still cannot be edited or deleted.
do $$ declare r record; begin
 for r in select policyname, tablename from pg_policies where schemaname='public' loop
  execute format('drop policy %I on public.%I', r.policyname, r.tablename);
 end loop;
end $$;
drop policy if exists "upload" on storage.objects;
drop policy if exists "view" on storage.objects;

grant usage on schema public to anon;
grant select, insert, update on all tables in schema public to anon;
grant usage, select on all sequences in schema public to anon;
grant execute on all functions in schema public to anon;

create policy "read" on public.branches for select to anon, authenticated using (true);
create policy "read" on public.items for select to anon, authenticated using (true);
create policy "read" on public.suppliers for select to anon, authenticated using (true);
create policy "read" on public.supplier_prices for select to anon, authenticated using (true);
create policy "read" on public.grns for select to anon, authenticated using (true);
create policy "read" on public.grn_lines for select to anon, authenticated using (true);
create policy "read" on public.issues for select to anon, authenticated using (true);
create policy "read" on public.reorder_levels for select to anon, authenticated using (true);
create policy "add" on public.items for insert to anon, authenticated with check (true);
create policy "add" on public.suppliers for insert to anon, authenticated with check (true);
create policy "add" on public.supplier_prices for insert to anon, authenticated with check (true);
create policy "change" on public.supplier_prices for update to anon, authenticated using (true) with check (true);
create policy "add" on public.grns for insert to anon, authenticated with check (true);
create policy "add" on public.grn_lines for insert to anon, authenticated with check (true);
create policy "add" on public.issues for insert to anon, authenticated with check (true);
create policy "all" on public.reorder_levels for all to anon, authenticated using (true) with check (true);

create policy "upload" on storage.objects for insert to anon, authenticated with check (bucket_id='grn-files');
create policy "view" on storage.objects for select to anon, authenticated using (bucket_id='grn-files');
