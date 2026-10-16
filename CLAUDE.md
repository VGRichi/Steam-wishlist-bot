# Steam Wishlist Bot

Telegram bot (@SteamWishful_bot): users track Steam games with per-game alerts; a daily cron notifies once per sale.
TypeScript, ESM, Node 20, Vercel functions + Supabase Postgres. No framework.

## Map
- `api/webhook.ts` Telegram → bot; checks `x-telegram-bot-api-secret-token`. `api/cron.ts` daily check; checks `CRON_SECRET`.
- `src/bot/handlers.ts` all conversation logic (`createBot(deps)`); `navigate()` serves both slash commands and home-panel buttons.
- `src/bot/views.ts` every message/keyboard as pure functions; `commandMenu()` is the slash menu, `homePanel()` the panel.
- `src/bot/callbacks.ts` inline-button payloads (≤64 bytes, validated on decode).
- `src/jobs/priceCheck.ts` daily job: batch Steam prices per region, notify on false→true of `lastConditionMet`.
- `src/domain/` pure alert rules (`isTriggered`) and input parsing. `src/steam/`, `src/telegram/` thin API clients.
- `src/db/types.ts` `Repo` interface; `src/db/supabase.ts` the real one; `test/fakes.ts` in-memory fakes for all deps.
- `schema.sql` fresh install; `migrations/` upgrades (already applied in prod).

## Rules
- Relative imports need `.js` extensions (NodeNext). Without them Vercel crashes at load; `tsc` enforces it.
- Escape all non-literal text with `escapeHtml` (messages are HTML mode).
- Emoji in UI must render in color on iOS: avoid ➕ ➖ and bare 🗑.
- `DAILY_CHECK_HOUR_UTC` in views.ts must match the cron in `vercel.json`.
- Schema change → update `schema.sql` and add a migration.

## Commands
- `npm run check` typecheck + tests (must pass before pushing).
- Deploy = push to `main` (Vercel builds it). Verify: `/api/cron` and unsigned `POST /api/webhook` both return 401.
- After changing `commandMenu()` or bot description: `npm run setup:telegram -- https://steam-wishlist-bot.vercel.app` (needs `.env`).
