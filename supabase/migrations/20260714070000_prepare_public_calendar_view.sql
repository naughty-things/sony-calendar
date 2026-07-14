-- Zero-downtime deployment bridge.
--
-- Install the redacted view before deploying application code that reads it.
-- Existing clients may continue reading public.posts until the subsequent
-- security_hardening migration revokes that legacy access.

begin;

drop view if exists public.public_calendar_posts;
create view public.public_calendar_posts
with (security_barrier = true)
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

grant usage on schema public to anon;
grant select on public.public_calendar_posts to anon;

notify pgrst, 'reload schema';

commit;
