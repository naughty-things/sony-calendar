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
  platform text[],             -- IG / FB / YouTube / Email / Other (multi-platform post)
  category text,               -- PA / HE / MO / DI / EC / INZONE / OTHER (SONY product line)
  publish_date date not null,
  status text not null default 'draft'
    check (status in ('draft','in_progress','needs_review','client_review','approved','scheduled','posted','blocked','archived')),
  internal_assignee_id uuid references people(id) on delete set null,
  internal_pic_id uuid references people(id) on delete set null,
  client_pic_id uuid references people(id) on delete set null,
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
create index on posts(client_id, category);
create index on posts using gin (platform);

create trigger posts_updated_at
before update on posts
for each row execute function moddatetime(updated_at);

-- helper: app-wide moddatetime if not already installed
create extension if not exists moddatetime;

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
   set platform = 'Other',
       source_meta = coalesce(source_meta, '{}'::jsonb)
                     || jsonb_build_object(
                          'platform_migrated_from', platform,
                          'platform_migrated_at',   to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SSOF')
                        )
 where platform in ('X','LinkedIn','TikTok','Blog')
   and coalesce(source_meta->>'platform_migrated_from','') = '';

-- Normalize the legacy 'Instagram' label to the canonical 'IG' glyph.
update posts
   set platform = 'IG'
 where platform = 'Instagram';

-- ─────────────────────────────────────────
-- Grants (needed when "Automatically expose new tables" is OFF)
-- ─────────────────────────────────────────
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on all tables in schema public to anon, authenticated;
grant usage, select on all sequences in schema public to anon, authenticated;
grant execute on all functions in schema public to anon, authenticated;

-- ─────────────────────────────────────────
-- App state (small key/value store for cron markers etc.)
-- ─────────────────────────────────────────
create table if not exists app_state (
  key text primary key,
  value text not null,
  updated_at timestamptz default now()
);
