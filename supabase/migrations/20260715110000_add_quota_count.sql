-- Allow one post to consume more than one monthly quota slot.

begin;

alter table public.posts
  add column if not exists quota_count integer;

update public.posts
   set quota_count = 1
 where quota_count is null or quota_count < 1;

alter table public.posts
  alter column quota_count set default 1,
  alter column quota_count set not null;

alter table public.posts
  drop constraint if exists posts_quota_count_check;

alter table public.posts
  add constraint posts_quota_count_check check (quota_count >= 1);

-- CREATE OR REPLACE VIEW permits new columns only at the end of the existing
-- projection, so quota_count is appended after the publish-time addition.
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
  publish_time,
  quota_count
from public.posts;

grant select (
  id, title, platform, category, publish_date, publish_time, quota_month, quota_enabled,
  quota_count, target_launch_date, request_date, status, designer, copy_writer,
  internal_pic, client_pic, created_at, updated_at
) on public.posts to anon;

notify pgrst, 'reload schema';

commit;
