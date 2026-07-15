-- Add an optional time-only schedule value. It deliberately remains separate
-- from publish_date because the publishing time is often decided later.

begin;

alter table public.posts
  add column if not exists publish_time time without time zone;

-- CREATE OR REPLACE VIEW permits new columns only at the end of the existing
-- projection, so publish_time is appended here even though it sits beside
-- publish_date in the base table and application model.
create or replace view public.public_calendar_posts
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
  updated_at,
  quota_enabled,
  publish_time
from public.posts;

grant select (
  id, title, platform, category, publish_date, publish_time, quota_month, quota_enabled,
  target_launch_date, request_date, status, designer, copy_writer,
  internal_pic, client_pic, created_at, updated_at
) on public.posts to anon;

notify pgrst, 'reload schema';

commit;
