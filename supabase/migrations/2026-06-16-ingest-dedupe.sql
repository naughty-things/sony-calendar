-- =============================================================
-- 2026-06-16 — Email ingest dedupe (defense in depth)
--
-- Problem:
--   pollGmail() was being invoked 5-10x per minute on Railway
--   (self-pinger + Next.js hot-reload + a brief launch race),
--   and there was no per-gmail_id dedupe in code or in the DB
--   schema. Each invocation re-processed the same forwarded
--   email, producing 100+ duplicate staging posts for one
--   real message.
--
-- Fix:
--   1) Add a unique constraint on email_ingests.gmail_id (the
--      path is stored in raw_payload->>gmail_id via a generated
--      column). The insert path will now hard-fail on dups
--      even if the in-code check is bypassed.
--   2) Backfill: collapse any existing dupes to a single row
--      per gmail_id (keep the OLDEST one), then add the constraint.
--   3) Same dedupe for posts.source_meta->>gmail_id: collapse
--      duplicate posts to a single one per gmail_id (keep the
--      oldest).
--
-- Run this in Supabase SQL Editor on the production project.
-- Re-runnable: each step is idempotent.
-- =============================================================

begin;

-- 1) Generated column on email_ingests: extract gmail_id from
--    raw_payload so we can put a unique index on it. This is
--    immutable, so it satisfies Postgres' requirements for
--    a unique index on a computed expression.
alter table email_ingests
  add column if not exists gmail_id text
  generated always as (raw_payload->>'gmail_id') stored;

-- 2) Backfill email_ingests: keep only the OLDEST per gmail_id.
--    We rank and delete everything beyond rn=1. We pick the one
--    with the oldest received_at; ties broken by id (uuid).
--    We prefer to KEEP a row that already has a created_post_id
--    (so we don't lose the link to a post the user already
--    started editing), if one exists among the dupes.
with keepers as (
  select distinct on (gmail_id) id
  from email_ingests
  where gmail_id is not null
  order by gmail_id,
           (case when created_post_id is not null then 0 else 1 end),
           received_at asc,
           id asc
),
ranked as (
  select id, gmail_id, row_number() over (
    partition by gmail_id order by received_at asc, id asc
  ) as rn
  from email_ingests
  where gmail_id is not null
)
delete from email_ingests e
using ranked r
where e.id = r.id
  and r.rn > 1
  and e.id not in (select id from keepers);

-- 3) Now add the unique index. Partial: only enforce on rows
--    where gmail_id is not null (so legacy/manual rows with no
--    raw_payload aren't affected).
create unique index if not exists email_ingests_gmail_id_key
  on email_ingests (gmail_id)
  where gmail_id is not null;

-- 4) Backfill posts: collapse duplicate posts that came from the
--    same Gmail message. Keep the OLDEST post per gmail_id.
--    If multiple have publish_date set, prefer the one with the
--    earliest publish_date (most likely the original brief).
--    First: clear any email_ingests.created_post_id pointing at
--    a post we're about to delete (so the FK doesn't fire).
with ranked as (
  select id, row_number() over (
    partition by (source_meta->>'gmail_id')
    order by created_at asc,
             coalesce(publish_date, '9999-12-31'::date) asc
  ) as rn
  from posts
  where source = 'email'
    and source_meta->>'gmail_id' is not null
),
losers as (
  select id from ranked where rn > 1
)
update email_ingests
  set created_post_id = null
  where created_post_id in (select id from losers);

with ranked as (
  select id, row_number() over (
    partition by (source_meta->>'gmail_id')
    order by created_at asc,
             coalesce(publish_date, '9999-12-31'::date) asc
  ) as rn
  from posts
  where source = 'email'
    and source_meta->>'gmail_id' is not null
)
delete from posts p
using ranked r
where p.id = r.id
  and r.rn > 1;

-- 5) Partial unique index on posts for the same key, so the
--    post insert path also hard-fails on dups.
create unique index if not exists posts_gmail_id_key
  on posts ((source_meta->>'gmail_id'))
  where source = 'email'
    and source_meta->>'gmail_id' is not null;

-- 6) Future-proof the FK: ON DELETE SET NULL, so deleting a
--    post (e.g. via the UI) doesn't leave a dangling reference
--    in email_ingests. The original constraint was the default
--    NO ACTION, which would block the delete. We use a DO block
--    to drop & re-add so this migration is re-runnable.
do $$
begin
  if exists (
    select 1 from information_schema.table_constraints
    where constraint_name = 'email_ingests_created_post_id_fkey'
      and table_name = 'email_ingests'
  ) then
    alter table email_ingests
      drop constraint email_ingests_created_post_id_fkey;
  end if;
end$$;

alter table email_ingests
  add constraint email_ingests_created_post_id_fkey
  foreign key (created_post_id) references posts(id)
  on delete set null;

commit;

-- After this migration, the data should look like:
--   - 1 row in email_ingests per real Gmail message
--   - 1 row in posts per real Gmail message (where the parse
--     produced a post)
--   - 0 staging duplicates
--
-- Verify with:
--   select gmail_id, count(*) from email_ingests
--     where gmail_id is not null group by 1 order by 2 desc;
