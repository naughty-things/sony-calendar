-- Allow separate jobs to remain on the calendar without contributing to a
-- monthly content quota. Existing posts retain the current behaviour.

begin;

alter table public.posts
  add column if not exists quota_enabled boolean not null default true;

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
  quota_enabled
from public.posts;

grant select (
  id, title, platform, category, publish_date, quota_month, quota_enabled,
  target_launch_date, request_date, status, designer, copy_writer,
  internal_pic, client_pic, created_at, updated_at
) on public.posts to anon;

notify pgrst, 'reload schema';

commit;
