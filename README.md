# Steam Wishlist Bot

A free Telegram bot that pings you when Steam games you want go on sale, with
an alert rule per game so you only hear about deals you care about.

## Get started

Open [@SteamWishful_bot](https://t.me/SteamWishful_bot), send `/start`, and
enter your Steam store country (e.g. `US`, `TR`, `AZ`) so prices are in your
currency. Everything else is done with the menu buttons.

## Features

- **📋 My List** - your games and alerts. Tap a game to see its price, change
  its alert, or remove it.
- **➕ Add Game** - search by name, tap the match, then choose an alert:
  - 🔔 any discount
  - 📊 at least X% off
  - 💰 at most a price you set
  - 🎯 either of the two
- **🔄 Check Now** - live prices for all your games, alert matches first.
- **🌍 Region** - change your store country any time.

Prices are checked daily, and you're notified once when a game starts matching
its alert, not every day the sale runs.

Limits: 10 games per person; Check Now once a minute.

The bot stores only your chat ID, region, and tracked games with their alerts.

## Self-hosting

TypeScript on Vercel + Supabase. Node 20+.

1. Create a bot with [@BotFather](https://t.me/BotFather) and a Supabase project.
2. Run [`schema.sql`](schema.sql) in the Supabase SQL editor.
3. Fill in `.env` from [`.env.example`](.env.example) and add the same
   variables to your Vercel project.
4. Deploy to Vercel, then register the webhook:
   ```bash
   npm install
   npm run setup:telegram -- https://your-project.vercel.app
   ```

Run `npm run check` for typecheck and tests.

## Feedback / issues

Found a bug or have an idea? Contact me!
