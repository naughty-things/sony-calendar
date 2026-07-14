-- Make the anonymous calendar view obey the caller's RLS policies instead of
-- executing with its owner privileges.

begin;

alter table public.posts enable row level security;

drop policy if exists "public published posts" on public.posts;
create policy "public published posts"
  on public.posts for select to anon
  using (status in ('approved', 'posted') and publish_date is not null);

revoke all on public.posts from anon;
grant select (
  id, title, platform, category, publish_date, quota_month,
  target_launch_date, request_date, status, designer, copy_writer,
  internal_pic, client_pic, created_at, updated_at
) on public.posts to anon;

alter view public.public_calendar_posts
  set (security_invoker = true, security_barrier = true);

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
