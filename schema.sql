-- Fresh install: run this whole file in the Supabase SQL editor.
-- Upgrading an existing v1 database instead? Run migrations/002_v2.sql.

create table if not exists users (
  chat_id       bigint primary key,
  region_code   text check (region_code ~ '^[A-Z]{2}$'),
  -- What the bot expects in the user's next text message (see src/db/types.ts `Pending`).
  pending       jsonb,
  last_check_at timestamptz,
  -- Set when Telegram says the user blocked the bot; cleared when they message it again.
  blocked_at    timestamptz,
  created_at    timestamptz not null default now()
);

create table if not exists tracked_games (
  id                    uuid primary key default gen_random_uuid(),
  chat_id               bigint not null references users(chat_id) on delete cascade,
  app_id                integer not null check (app_id > 0),
  game_name             text not null,
  -- Alert rule. Both thresholds null = any discount; both set = either one triggers.
  threshold_percent     integer check (threshold_percent between 1 and 100),
  threshold_price_cents integer check (threshold_price_cents > 0),
  threshold_currency    text,
  -- Whether the alert matched at the last check; we notify only on false -> true.
  last_condition_met    boolean not null default false,
  added_at              timestamptz not null default now(),
  unique (chat_id, app_id)
);

-- The bot uses the service-role key, which bypasses RLS. Enabling RLS with no policies
-- means the public anon key can't read or write these tables at all.
alter table users enable row level security;
alter table tracked_games enable row level security;
