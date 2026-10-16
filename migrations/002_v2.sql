-- Upgrades a v1 database (any commit up to bb3229c) to v2. Safe to run more than once.
-- Run it in the Supabase SQL editor *before* deploying v2.

begin;

-- users: one JSON "pending" column replaces pending_action + pending_data.
alter table users
  add column if not exists pending       jsonb,
  add column if not exists last_check_at timestamptz,
  add column if not exists blocked_at    timestamptz;
-- tracked_games: alert columns. v1's schema.sql never had these, so a database created
-- from it may or may not have them, depending on whether they were added by hand.
alter table tracked_games
  add column if not exists threshold_percent     integer,
  add column if not exists threshold_price_cents integer,
  add column if not exists threshold_currency    text,
  add column if not exists last_condition_met    boolean;
update tracked_games set last_condition_met = false where last_condition_met is null;
alter table tracked_games
  alter column last_condition_met set default false,
  alter column last_condition_met set not null;

-- Constraints (dropped first so re-running works). NOT VALID: don't fail on odd v1 rows.
alter table users drop constraint if exists users_region_code_check;
alter table users add constraint users_region_code_check
  check (region_code ~ '^[A-Z]{2}$') not valid;
alter table tracked_games drop constraint if exists tracked_games_threshold_percent_check;
alter table tracked_games add constraint tracked_games_threshold_percent_check
  check (threshold_percent between 1 and 100) not valid;
alter table tracked_games drop constraint if exists tracked_games_threshold_price_cents_check;
alter table tracked_games add constraint tracked_games_threshold_price_cents_check
  check (threshold_price_cents > 0) not valid;

-- Covered by the (chat_id, app_id) unique index / no longer queried by app_id alone.
drop index if exists idx_tracked_games_chat_id;
drop index if exists idx_tracked_games_app_id;

-- Lock the tables to the service-role key only.
alter table users enable row level security;
alter table tracked_games enable row level security;

commit;

-- Cleanup, once v2 is deployed and working. Left out of the transaction above so the
-- v1 code keeps working between running this migration and deploying v2.
--
-- v1 conversation state (only ever held half-finished conversations):
-- alter table users drop column if exists pending_action, drop column if exists pending_data;
--
-- v1 wrote price_cache on every cron run but never read it; v2 doesn't use it:
-- drop table if exists price_cache;
