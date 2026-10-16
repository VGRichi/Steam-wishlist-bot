import { getBot } from '../src/app';
import { config } from '../src/config';
import { log } from '../src/log';
import { secretsMatch } from '../src/security';
import type { TgUpdate } from '../src/telegram/types';

// Telegram -> bot. Set up with `npm run setup:telegram`, which registers the secret token.
export async function POST(request: Request): Promise<Response> {
  if (!secretsMatch(request.headers.get('x-telegram-bot-api-secret-token'), config.webhookSecret)) {
    return new Response('unauthorized', { status: 401 });
  }

  let update: TgUpdate;
  try {
    update = (await request.json()) as TgUpdate;
  } catch {
    return new Response('bad request', { status: 400 });
  }

  try {
    await getBot().handleUpdate(update);
  } catch (err) {
    // handleUpdate already reports per-update errors; this is a last resort (e.g. bad config).
    log.error('webhook failed', { updateId: update.update_id, err });
  }
  // Always 200 once authenticated: Telegram re-sends failed updates, which would only repeat the failure.
  return new Response('ok');
}

export function GET(): Response {
  return new Response('ok');
}
