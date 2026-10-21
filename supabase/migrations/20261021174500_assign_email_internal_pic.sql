-- Keep email-created posts assigned even when the parser omits a person or
-- returns a full name. Explicit supported assignments win; otherwise the
-- trusted forwarding teammate becomes the internal PIC.
create or replace function public.assign_email_internal_pic()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  candidate text := lower(coalesce(new.internal_pic, ''));
  forwarder text := lower(coalesce(new.source_meta->>'from', ''));
begin
  if new.source is distinct from 'email' then
    return new;
  end if;

  if candidate ~ '(^|[^a-z])sam([^a-z]|$)' then
    new.internal_pic := 'Sam';
  elsif candidate ~ '(^|[^a-z])cheri([^a-z]|$)' then
    new.internal_pic := 'Cheri';
  elsif candidate ~ '(^|[^a-z])irvin([^a-z]|$)' then
    new.internal_pic := 'Irvin';
  elsif candidate ~ '(^|[^a-z])raymond([^a-z]|$)' then
    new.internal_pic := 'Raymond';
  elsif forwarder ~ '(^|[^a-z])sam([^a-z]|$)' then
    new.internal_pic := 'Sam';
  elsif forwarder ~ '(^|[^a-z])cheri([^a-z]|$)' then
    new.internal_pic := 'Cheri';
  elsif forwarder ~ '(^|[^a-z])irvin([^a-z]|$)' then
    new.internal_pic := 'Irvin';
  elsif forwarder ~ '(^|[^a-z])raymond([^a-z]|$)' then
    new.internal_pic := 'Raymond';
  else
    new.internal_pic := null;
  end if;

  return new;
end;
$$;

drop trigger if exists posts_assign_email_internal_pic on public.posts;
create trigger posts_assign_email_internal_pic
before insert or update of internal_pic, source, source_meta on public.posts
for each row execute function public.assign_email_internal_pic();
