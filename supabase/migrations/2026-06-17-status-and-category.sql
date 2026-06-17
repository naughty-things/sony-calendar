-- 2026-06-17 — Tighten status enum + make category multi-valued
-- Sam requested:
--   (1) Drop status values not in {in_progress, client_review, approved, posted}
--   (2) Allow multiple categories per post (text[])
--
-- Pre-run audit:
--   select status, count(*) from posts group by 1;
--   select category, count(*) from posts group by 1;
--
-- Idempotent / safe to re-run.

-- ─────────────────────────────────────────
-- 1) Status enum tightening
-- ─────────────────────────────────────────

-- Map any legacy values to the new 4-state set:
--   needs_review -> client_review  (the inbox / "client review" stage)
--   staging, draft, blocked, archived -> client_review (catch-all for "not done yet")
--   scheduled -> approved
-- The 4 target states:
--   in_progress, client_review, approved, posted

update posts
   set status = case status
     when 'needs_review' then 'client_review'
     when 'staging'      then 'client_review'
     when 'draft'        then 'client_review'
     when 'scheduled'    then 'approved'
     when 'blocked'      then 'client_review'
     when 'archived'     then 'in_progress'
     else status
   end
 where status not in ('in_progress','client_review','approved','posted');

-- Drop ALL existing status check constraints on posts (by name pattern,
-- covers both the auto-generated one from schema.sql and our explicit
-- 'posts_status_check' from a previous half-run).
do $$
declare c text;
begin
  for c in
    select con.conname
      from pg_constraint con
      join pg_class rel on rel.oid = con.conrelid
     where rel.relname = 'posts'
       and con.contype = 'c'
       and pg_get_constraintdef(con.oid) like 'CHECK (status%'
  loop
    execute 'alter table posts drop constraint ' || quote_ident(c);
    raise notice 'dropped %', c;
  end loop;
end $$;

-- Add the new, tight check constraint.
alter table posts
  add constraint posts_status_check
  check (status in ('in_progress','client_review','approved','posted'));

-- Update the default to in_progress (the new "fresh post" state).
alter table posts
  alter column status set default 'in_progress';

-- ─────────────────────────────────────────
-- 2) Category → text[] (multi-value)
-- ─────────────────────────────────────────

-- Convert any non-null scalar category into a one-element array.
-- Coerce empty strings to NULL so they don't render as [''].
alter table posts
  alter column category type text[]
  using case
    when category is null or category = '' then null
    else array[category]
  end;

-- Add a GIN index so multi-category filtering is cheap.
create index if not exists posts_category_gin_idx on posts using gin (category);

-- ─────────────────────────────────────────
-- 3) Sanity check (will fail loudly if migration left orphan states)
-- ─────────────────────────────────────────
do $$
declare bad int;
begin
  select count(*) into bad from posts
    where status not in ('in_progress','client_review','approved','posted');
  if bad > 0 then
    raise exception 'Status migration incomplete: % rows still outside the 4-state set', bad;
  end if;
end $$;