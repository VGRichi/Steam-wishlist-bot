// Wires the real clients together. Kept apart from the handlers so tests can pass fakes instead.
import { createBot } from './bot/handlers.js';
import { createSupabaseRepo } from './db/supabase.js';
import { createSteamClient } from './steam/api.js';
import { createTelegramClient } from './telegram/api.js';

let deps: ReturnType<typeof buildDeps> | undefined;

function buildDeps() {
  return { repo: createSupabaseRepo(), steam: createSteamClient(), tg: createTelegramClient() };
}

// Reused across invocations while Vercel keeps the function instance warm.
export function getDeps() {
  deps ??= buildDeps();
  return deps;
}

export function getBot() {
  return createBot(getDeps());
}
