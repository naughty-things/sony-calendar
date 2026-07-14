-- Keep extensions out of the exposed public schema.

begin;

create schema if not exists extensions;
alter extension moddatetime set schema extensions;

commit;
