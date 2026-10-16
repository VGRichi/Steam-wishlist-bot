// One-time (and re-runnable) Telegram setup: webhook with secret token, command menu, bot description.
// Usage: npm run setup:telegram -- https://your-project.vercel.app
import 'dotenv/config';
import { config } from '../src/config.js';
import { callTelegram } from '../src/telegram/api.js';

async function main() {
  const deployedUrl = process.argv[2];
  if (!deployedUrl || !/^https:\/\//.test(deployedUrl)) {
    console.error('Usage: npm run setup:telegram -- https://your-project.vercel.app');
    process.exit(1);
  }
  const secret = config.webhookSecret;
  if (!/^[A-Za-z0-9_-]{1,256}$/.test(secret)) {
    console.error('TELEGRAM_WEBHOOK_SECRET may only contain A-Z, a-z, 0-9, _ and - (max 256 chars).');
    process.exit(1);
  }

  const url = `${deployedUrl.replace(/\/+$/, '')}/api/webhook`;
  await callTelegram('setWebhook', {
    url,
    secret_token: secret,
    allowed_updates: ['message', 'callback_query'],
  });
  console.log(`Webhook set to ${url}`);

  await callTelegram('setMyCommands', {
    commands: [
      { command: 'list', description: 'Your tracked games' },
      { command: 'add', description: 'Track a game: /add <name>' },
      { command: 'check', description: 'Check prices right now' },
      { command: 'region', description: 'Change store region' },
      { command: 'cancel', description: 'Cancel what you were doing' },
      { command: 'help', description: 'How the bot works' },
    ],
  });
  await callTelegram('setMyShortDescription', {
    short_description: 'Get a message when Steam games you want go on sale.',
  });
  await callTelegram('setMyDescription', {
    description:
      "Track Steam games and I'll message you when they go on sale - at any discount, past a % you pick, or under a price you set. Prices are checked in your own region's currency.",
  });
  console.log('Commands and description updated.');

  const info = await callTelegram<{ pending_update_count: number; last_error_message?: string }>('getWebhookInfo', {});
  console.log('Webhook info:', info);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
