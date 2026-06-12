-- SONY Calendar — initial people
-- Run after schema.sql. Idempotent.

insert into people (client_id, name, email, side, role)
select id, 'Sam Lee', 'sam.lee@naughtythings.com.hk', 'internal', 'PM'
from clients where slug = 'sony'
on conflict do nothing;

-- Add more team members and client contacts here as you onboard them.
-- Example:
-- insert into people (client_id, name, email, side, role)
-- select id, 'Raymond Kwan', 'raymond.kwan@naughtythings.com.hk', 'internal', 'PIC'
-- from clients where slug = 'sony'
-- on conflict do nothing;
