-- Quota always follows the current publish_date. Retain the legacy column
-- as null so older deployed clients also fall back to the publish month.
-- Never rewrite publish_date, target_launch_date, status, or quota weights.
create or replace function public.use_publish_month_for_quota()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $$
begin
  new.quota_month := null;
  return new;
end;
$$;

revoke all on function public.use_publish_month_for_quota() from public;

create trigger posts_use_publish_month_for_quota
before insert or update of quota_month, publish_date on public.posts
for each row execute function public.use_publish_month_for_quota();

-- Verify the backfill cannot alter publishing dates or any other post content.
do $migration$
declare
  protected_before text;
  protected_after text;
begin
  lock table public.posts in share row exclusive mode;
  select md5(string_agg((to_jsonb(p) - 'quota_month' - 'updated_at')::text, '' order by id))
    into protected_before from public.posts p;

  update public.posts set quota_month = null where quota_month is not null;

  select md5(string_agg((to_jsonb(p) - 'quota_month' - 'updated_at')::text, '' order by id))
    into protected_after from public.posts p;
  if protected_before is distinct from protected_after then
    raise exception 'Quota backfill changed protected post fields';
  end if;
end;
$migration$;
