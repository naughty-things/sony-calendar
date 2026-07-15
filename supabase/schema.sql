-- SONY Content Calendar schema
-- Multi-tenant-ready: every domain table is scoped by client_id.
-- v1: single client (SONY) seeded below.

create extension if not exists pgcrypto;

-- ─────────────────────────────────────────
-- Tenants
-- ─────────────────────────────────────────
create table if not exists clients (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text unique not null,
  created_at timestamptz default now()
);

-- ─────────────────────────────────────────
-- People (team members + client contacts)
-- ─────────────────────────────────────────
create table if not exists people (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references clients(id) on delete cascade,
  name text not null,
  email text,
  side text not null check (side in ('internal', 'client')),
  role text,                   -- e.g. "copywriter", "designer", "client PM"
  created_at timestamptz default now()
);
create index on people(client_id);

-- ─────────────────────────────────────────
-- Posts (calendar items)
-- ─────────────────────────────────────────
create table if not exists posts (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references clients(id) on delete cascade,
  title text not null,
  platform text[],             -- IG / FB / Other (multi-platform post)
  category text[],             -- PA / TV / MO / DI / EC / INZONE / OTHER (SONY product line)
  publish_date date,           -- nullable while a post sits in staging
  publish_time time without time zone, -- optional schedule time, independent of publish_date
  quota_month date,            -- optional manual month override for quota / summary counting
  quota_enabled boolean not null default true, -- false excludes separate work from every quota month
  target_launch_date date,
  request_date date,
  status text not null default 'in_progress'
    check (status in ('staging','in_progress','client_review','approved','posted')),
  /* Free-text names — every name ever typed becomes a future autocomplete option. */
  designer text,
  copy_writer text,
  internal_pic text,
  client_pic text,
  notes text,
  copy_draft text,
  source text default 'manual'  -- 'manual' | 'email' | 'ai_draft'
    check (source in ('manual','email','ai_draft')),
  source_meta jsonb default '{}'::jsonb,  -- raw email payload, forwarder, etc.
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index on posts(client_id, publish_date);
create index on posts(status);
create index on posts(client_id);
create index on posts using gin (platform);
create index if not exists posts_category_gin_idx on posts using gin (category);
create index on posts(designer) where designer is not null;
create index on posts(copy_writer) where copy_writer is not null;
create index on posts(internal_pic) where internal_pic is not null;
create index on posts(client_pic) where client_pic is not null;

-- helper: app-wide moddatetime, kept outside the exposed public schema
create schema if not exists extensions;
create extension if not exists moddatetime with schema extensions;

create trigger posts_updated_at
before update on posts
for each row execute function extensions.moddatetime(updated_at);

-- ─────────────────────────────────────────
-- Email ingest log (audit trail for AI agent)
-- ─────────────────────────────────────────
create table if not exists email_ingests (
  id uuid primary key default gen_random_uuid(),
  from_email text not null,
  subject text,
  raw_payload jsonb not null,
  parsed jsonb,
  matched_client_id uuid references clients(id),
  created_post_id uuid references posts(id),
  status text not null default 'pending'
    check (status in ('pending','parsed','created','rejected','error')),
  error text,
  received_at timestamptz default now()
);
create index on email_ingests(received_at desc);

-- ─────────────────────────────────────────
-- Seed: SONY
-- ─────────────────────────────────────────
insert into clients (name, slug) values ('SONY', 'sony')
on conflict (slug) do nothing;

-- ─────────────────────────────────────────
-- Platform migration (2026-06-15)
-- SONY dropped X / LinkedIn / TikTok / Blog. Re-tag any existing rows to
-- 'Other' and record the original value in source_meta for audit.
-- Safe to re-run: only touches rows that haven't been migrated yet.
-- ─────────────────────────────────────────
update posts
   set platform = array['Other']::text[],
       source_meta = coalesce(source_meta, '{}'::jsonb)
                     || jsonb_build_object(
                          'platform_migrated_from', platform,
                          'platform_migrated_at',   to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SSOF')
                        )
 where platform && array['X','LinkedIn','TikTok','Blog']::text[]
   and coalesce(source_meta->>'platform_migrated_from','') = '';

-- Normalize the legacy 'Instagram' label to the canonical 'IG' glyph.
update posts
   set platform = array_replace(platform, 'Instagram', 'IG')
 where 'Instagram' = any(platform);

-- ─────────────────────────────────────────
-- App state (small key/value store for cron markers etc.)
-- ─────────────────────────────────────────
create table if not exists app_state (
  key text primary key,
  value text not null,
  updated_at timestamptz default now()
);

-- ─────────────────────────────────────────
-- Security boundary
-- ─────────────────────────────────────────
-- Anonymous viewers use a redacted, all-status progress view. Sensitive
-- columns stay private, and authenticated writes require the trusted admin email in the
-- signed Supabase JWT. The service role continues to bypass RLS for ingestion.
alter table clients        enable row level security;
alter table people         enable row level security;
alter table posts          enable row level security;
alter table email_ingests  enable row level security;
alter table app_state      enable row level security;

drop policy if exists "calendar admin clients" on clients;
drop policy if exists "calendar admin people" on people;
drop policy if exists "calendar admin posts" on posts;
drop policy if exists "public published posts" on posts;
drop policy if exists "public task progress" on posts;
drop policy if exists "calendar admin email ingests" on email_ingests;
drop policy if exists "calendar admin app state" on app_state;

create policy "calendar admin clients" on clients for all to authenticated
  using (
    lower(coalesce((select auth.jwt() ->> 'email'), '')) = 'sam.lee@naughtythings.com.hk'
    and not coalesce(((select auth.jwt() ->> 'is_anonymous')::boolean), false)
  )
  with check (
    lower(coalesce((select auth.jwt() ->> 'email'), '')) = 'sam.lee@naughtythings.com.hk'
    and not coalesce(((select auth.jwt() ->> 'is_anonymous')::boolean), false)
  );
create policy "calendar admin people" on people for all to authenticated
  using (
    lower(coalesce((select auth.jwt() ->> 'email'), '')) = 'sam.lee@naughtythings.com.hk'
    and not coalesce(((select auth.jwt() ->> 'is_anonymous')::boolean), false)
  )
  with check (
    lower(coalesce((select auth.jwt() ->> 'email'), '')) = 'sam.lee@naughtythings.com.hk'
    and not coalesce(((select auth.jwt() ->> 'is_anonymous')::boolean), false)
  );
create policy "calendar admin posts" on posts for all to authenticated
  using (
    lower(coalesce((select auth.jwt() ->> 'email'), '')) = 'sam.lee@naughtythings.com.hk'
    and not coalesce(((select auth.jwt() ->> 'is_anonymous')::boolean), false)
  )
  with check (
    lower(coalesce((select auth.jwt() ->> 'email'), '')) = 'sam.lee@naughtythings.com.hk'
    and not coalesce(((select auth.jwt() ->> 'is_anonymous')::boolean), false)
  );
create policy "public task progress" on posts for select to anon
  using (true);
create policy "calendar admin email ingests" on email_ingests for all to authenticated
  using (
    lower(coalesce((select auth.jwt() ->> 'email'), '')) = 'sam.lee@naughtythings.com.hk'
    and not coalesce(((select auth.jwt() ->> 'is_anonymous')::boolean), false)
  )
  with check (
    lower(coalesce((select auth.jwt() ->> 'email'), '')) = 'sam.lee@naughtythings.com.hk'
    and not coalesce(((select auth.jwt() ->> 'is_anonymous')::boolean), false)
  );
create policy "calendar admin app state" on app_state for all to authenticated
  using (
    lower(coalesce((select auth.jwt() ->> 'email'), '')) = 'sam.lee@naughtythings.com.hk'
    and not coalesce(((select auth.jwt() ->> 'is_anonymous')::boolean), false)
  )
  with check (
    lower(coalesce((select auth.jwt() ->> 'email'), '')) = 'sam.lee@naughtythings.com.hk'
    and not coalesce(((select auth.jwt() ->> 'is_anonymous')::boolean), false)
  );

drop view if exists public_calendar_posts;
create view public_calendar_posts
with (security_invoker = true, security_barrier = true)
as
select
  id, title, platform, category, publish_date, publish_time, quota_month, quota_enabled,
  target_launch_date, request_date, status, designer, copy_writer,
  internal_pic, client_pic, created_at, updated_at
from posts
;

comment on view public_calendar_posts is
  'Redacted all-status task progress projection for anonymous viewers.';

grant usage on schema public to anon, authenticated;
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;

alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke execute on functions from public, anon, authenticated;

grant select on public_calendar_posts to anon;
grant select (
  id, title, platform, category, publish_date, publish_time, quota_month, quota_enabled,
  target_launch_date, request_date, status, designer, copy_writer,
  internal_pic, client_pic, created_at, updated_at
) on posts to anon;
grant select, insert, update, delete
  on clients, people, posts, email_ingests, app_state
  to authenticated;
grant usage, select on all sequences in schema public to authenticated;
