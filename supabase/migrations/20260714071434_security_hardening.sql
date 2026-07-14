-- Security hardening for the public calendar and staff administration.
--
-- Anonymous users receive one deliberately redacted, published-only view.
-- Sensitive columns and unpublished rows stay private. Authenticated access is restricted to the trusted
-- calendar administrator email in the signed Supabase JWT. Server-side
-- service_role operations continue to bypass RLS for Gmail ingestion.

begin;

alter table public.clients       enable row level security;
alter table public.people        enable row level security;
alter table public.posts         enable row level security;
alter table public.email_ingests enable row level security;
alter table public.app_state     enable row level security;

-- Remove every historical policy before installing the final policy set.
drop policy if exists "public read clients" on public.clients;
drop policy if exists "public read people" on public.people;
drop policy if exists "public read posts" on public.posts;
drop policy if exists "public read email_ingests" on public.email_ingests;
drop policy if exists "public read app_state" on public.app_state;
drop policy if exists "auth write clients" on public.clients;
drop policy if exists "auth write people" on public.people;
drop policy if exists "auth write posts" on public.posts;
drop policy if exists "auth write email_ingests" on public.email_ingests;
drop policy if exists "auth write app_state" on public.app_state;
drop policy if exists "calendar admin clients" on public.clients;
drop policy if exists "calendar admin people" on public.people;
drop policy if exists "calendar admin posts" on public.posts;
drop policy if exists "public published posts" on public.posts;
drop policy if exists "calendar admin email ingests" on public.email_ingests;
drop policy if exists "calendar admin app state" on public.app_state;

-- auth.jwt() is issued and signed by Supabase Auth. We intentionally use the
-- verified email claim rather than user_metadata, and reject anonymous Auth
-- identities even though they use the authenticated Postgres role.
create policy "calendar admin clients"
  on public.clients for all to authenticated
  using (
    lower(coalesce((select auth.jwt() ->> 'email'), '')) = 'sam.lee@naughtythings.com.hk'
    and not coalesce(((select auth.jwt() ->> 'is_anonymous')::boolean), false)
  )
  with check (
    lower(coalesce((select auth.jwt() ->> 'email'), '')) = 'sam.lee@naughtythings.com.hk'
    and not coalesce(((select auth.jwt() ->> 'is_anonymous')::boolean), false)
  );

create policy "calendar admin people"
  on public.people for all to authenticated
  using (
    lower(coalesce((select auth.jwt() ->> 'email'), '')) = 'sam.lee@naughtythings.com.hk'
    and not coalesce(((select auth.jwt() ->> 'is_anonymous')::boolean), false)
  )
  with check (
    lower(coalesce((select auth.jwt() ->> 'email'), '')) = 'sam.lee@naughtythings.com.hk'
    and not coalesce(((select auth.jwt() ->> 'is_anonymous')::boolean), false)
  );

create policy "calendar admin posts"
  on public.posts for all to authenticated
  using (
    lower(coalesce((select auth.jwt() ->> 'email'), '')) = 'sam.lee@naughtythings.com.hk'
    and not coalesce(((select auth.jwt() ->> 'is_anonymous')::boolean), false)
  )
  with check (
    lower(coalesce((select auth.jwt() ->> 'email'), '')) = 'sam.lee@naughtythings.com.hk'
    and not coalesce(((select auth.jwt() ->> 'is_anonymous')::boolean), false)
  );

-- The invoker view below needs access to its projected base columns. RLS keeps
-- every unpublished row private, while column grants keep briefs and ingest
-- metadata unavailable even through direct Data API queries.
create policy "public published posts"
  on public.posts for select to anon
  using (status in ('approved', 'posted') and publish_date is not null);

create policy "calendar admin email ingests"
  on public.email_ingests for all to authenticated
  using (
    lower(coalesce((select auth.jwt() ->> 'email'), '')) = 'sam.lee@naughtythings.com.hk'
    and not coalesce(((select auth.jwt() ->> 'is_anonymous')::boolean), false)
  )
  with check (
    lower(coalesce((select auth.jwt() ->> 'email'), '')) = 'sam.lee@naughtythings.com.hk'
    and not coalesce(((select auth.jwt() ->> 'is_anonymous')::boolean), false)
  );

create policy "calendar admin app state"
  on public.app_state for all to authenticated
  using (
    lower(coalesce((select auth.jwt() ->> 'email'), '')) = 'sam.lee@naughtythings.com.hk'
    and not coalesce(((select auth.jwt() ->> 'is_anonymous')::boolean), false)
  )
  with check (
    lower(coalesce((select auth.jwt() ->> 'email'), '')) = 'sam.lee@naughtythings.com.hk'
    and not coalesce(((select auth.jwt() ->> 'is_anonymous')::boolean), false)
  );

-- The view executes as its caller, so the underlying RLS policy still applies.
-- It also projects only non-sensitive columns and filters pre-publication state.
drop view if exists public.public_calendar_posts;
create view public.public_calendar_posts
with (security_invoker = true, security_barrier = true)
as
select
  id,
  title,
  platform,
  category,
  publish_date,
  quota_month,
  target_launch_date,
  request_date,
  status,
  designer,
  copy_writer,
  internal_pic,
  client_pic,
  created_at,
  updated_at
from public.posts
where status in ('approved', 'posted')
  and publish_date is not null;

comment on view public.public_calendar_posts is
  'Redacted published-only calendar projection for anonymous viewers.';

grant usage on schema public to anon, authenticated;

-- Clear legacy broad privileges first, including future-exposure defaults.
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;

alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke execute on functions from public, anon, authenticated;

grant select on public.public_calendar_posts to anon;
grant select (
  id, title, platform, category, publish_date, quota_month,
  target_launch_date, request_date, status, designer, copy_writer,
  internal_pic, client_pic, created_at, updated_at
) on public.posts to anon;
grant select, insert, update, delete
  on public.clients, public.people, public.posts, public.email_ingests, public.app_state
  to authenticated;
grant usage, select on all sequences in schema public to authenticated;

-- Do not publish posts through Realtime: WAL payloads are a wider surface than
-- the deliberately projected public view. The application uses bounded polling.
do $$
begin
  if exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'posts'
  ) then
    execute 'alter publication supabase_realtime drop table public.posts';
  end if;
end $$;

notify pgrst, 'reload schema';

commit;
