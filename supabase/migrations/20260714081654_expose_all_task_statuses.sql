-- The calendar is a shared agency/client progress tracker. Anonymous viewers
-- may see every task status, but still receive only the redacted column set.

begin;

alter table public.posts enable row level security;

drop policy if exists "public published posts" on public.posts;
drop policy if exists "public task progress" on public.posts;
create policy "public task progress"
  on public.posts for select to anon
  using (true);

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
  updated_at
from public.posts;

comment on view public.public_calendar_posts is
  'Redacted all-status task progress projection for anonymous viewers.';

grant select on public.public_calendar_posts to anon;
grant select (
  id, title, platform, category, publish_date, quota_month,
  target_launch_date, request_date, status, designer, copy_writer,
  internal_pic, client_pic, created_at, updated_at
) on public.posts to anon;

notify pgrst, 'reload schema';

commit;
