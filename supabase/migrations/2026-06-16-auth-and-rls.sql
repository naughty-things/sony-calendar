-- =============================================================
-- 2026-06-16 — Auth + Row Level Security
--
-- Goal:
--   - Anyone (anon) can READ the calendar (client wants public view)
--   - Only authenticated users can WRITE (insert/update/delete)
--   - Service role key still works for server-side cron/inbound
--
-- Run this in Supabase SQL Editor on the production project.
-- After running, create the admin user via Supabase Auth UI
-- (Authentication → Users → Add user) and confirm their email
-- is whitelisted, then sign in at the app's /login page.
-- =============================================================

-- 1) Enable RLS on every public table.
--    Without this, policies are not enforced even if defined.
alter table clients        enable row level security;
alter table people         enable row level security;
alter table posts          enable row level security;
alter table email_ingests  enable row level security;
alter table app_state      enable row level security;

-- 2) Public read — anon key is safe to expose for SELECT
create policy "public read clients"       on clients       for select to anon, authenticated using (true);
create policy "public read people"        on people        for select to anon, authenticated using (true);
create policy "public read posts"         on posts         for select to anon, authenticated using (true);
create policy "public read email_ingests" on email_ingests for select to anon, authenticated using (true);
create policy "public read app_state"     on app_state     for select to anon, authenticated using (true);

-- 3) Authenticated users can do everything (single admin account
--    is the only one we'll create, so this is effectively admin-only)
create policy "auth write clients"       on clients       for all to authenticated using (true) with check (true);
create policy "auth write people"        on people        for all to authenticated using (true) with check (true);
create policy "auth write posts"         on posts         for all to authenticated using (true) with check (true);
create policy "auth write email_ingests" on email_ingests for all to authenticated using (true) with check (true);
create policy "auth write app_state"     on app_state     for all to authenticated using (true) with check (true);

-- 4) Realtime: keep the public-channel posts stream working for
--    unauthenticated viewers (the arrival flash + count badges
--    should update live for everyone). Supabase realtime honours
--    RLS, so this grants anon SELECT on the channel.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'posts'
  ) then
    execute 'alter publication supabase_realtime add table posts';
  end if;
end $$;
