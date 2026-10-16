# Steam Wishlist Bot

A free Telegram bot that watches the Steam games you want and pings you the
moment one goes on sale - with custom alert rules per game, so you only hear
about the deals you actually care about.

## Get started

Open the bot on Telegram and send `/start`. You'll be asked for your Steam
store country (e.g. `US`, `TR`, `AZ`, `DE`) so prices are checked in your
local currency, then you're ready to go.

Everything after that is done through the button menu - no commands to
memorize (though they exist if you like typing: `/add <name>`, `/list`,
`/check`, `/region`, `/cancel`, `/help`).

## What it does

- **📋 My List** - your tracked games and their alerts. Tap a game to see its
  current price, change its alert, open the store page, or remove it. Clearing
  the whole list is here too (asks you to confirm first).
- **➕ Add Game** - search by name, tap the right match, and it's tracked
  straight away with an "any discount" alert. Pick a different rule right
  there, or later from My List:
  - 🔔 **Any discount** - notify the moment it's on sale at all
  - 📊 **Min. % off** - only notify at, say, 30% off or more
  - 💰 **Max. price** - only notify once it costs at most a price you set, in
    your store's currency (`15`, `15.99` and `15,99` all work)
  - 🎯 **% or price** - either condition triggers the alert
- **🔄 Check Now** - check all your games against Steam right now. Games that
  match your alerts come first, then other discounts, biggest first.
- **🌍 Region** - your current region shows as a flag on the button; tap to
  change it any time.

Once a day the bot checks prices and messages you the first time a game starts
matching its alert - once per sale, not every day it's still running. Several
deals at once arrive as a single message.

## Limits

- Up to 10 tracked games per person
- Prices checked once a day; Check Now can be used once a minute
- Changing region removes price alerts (they were in the old currency);
  % alerts are kept

## A note on data

The bot only stores what it needs to do its job: your Telegram chat ID, your
chosen region, the games and alerts you set up, and when you last used Check
Now. Nothing else.

---

## Running your own copy

Stack: TypeScript on [Vercel](https://vercel.com) serverless functions,
[Supabase](https://supabase.com) Postgres, Telegram Bot API webhooks, and the
public Steam store API. Node 20+.

```
api/webhook.ts       Telegram -> bot (verifies Telegram's secret token)
api/cron.ts          daily price check (verifies CRON_SECRET)
src/bot/             conversation handlers, message views, button payloads
src/jobs/            the price-check job
src/domain/          alert rules and input parsing (pure, heavily tested)
src/steam/           Steam store client (batched price lookups)
src/telegram/        Telegram client and formatting helpers
src/db/              Repo interface + Supabase implementation
test/                Vitest suite with in-memory fakes
```

### Setup

1. Create a bot with [@BotFather](https://t.me/BotFather) and a Supabase project.
2. In the Supabase SQL editor, run [`schema.sql`](schema.sql).
3. Copy `.env.example` to `.env` and fill it in. Add the same variables to the
   Vercel project (Settings -> Environment Variables).
4. Deploy to Vercel, then register the webhook, commands and description:
   ```bash
   npm install
   npm run setup:telegram -- https://your-project.vercel.app
   ```

### Upgrading from v1 (the JavaScript version)

1. Run [`migrations/002_v2.sql`](migrations/002_v2.sql) in the Supabase SQL editor.
   It only adds things, so the old version keeps working until you deploy.
2. Add `TELEGRAM_WEBHOOK_SECRET` to Vercel and your `.env`.
3. Deploy, then run `npm run setup:telegram -- https://your-project.vercel.app`
   so Telegram starts sending the secret. Until you do, the webhook rejects
   Telegram's requests.
4. Optional cleanup, once everything works: the commented lines at the end of
   the migration drop the v1-only columns and the unused `price_cache` table.

Users' tracked games and alerts carry over. Old keyboard buttons and command
names (`/addgame`, `/checknow`, ...) keep working.

### Development

```bash
npm run check        # typecheck + tests
npm run test:watch
```

CI runs the same checks on every push and pull request.

## Feedback / issues

Found a bug or have an idea? Contact me!
