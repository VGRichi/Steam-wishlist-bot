import { config } from '../config.js';
import { log, sleep } from '../log.js';
import type { InlineKeyboard, ReplyMarkup, SendResult, TelegramClient } from './types.js';

interface ApiResponse<T> {
  ok: boolean;
  result?: T;
  error_code?: number;
  description?: string;
  parameters?: { retry_after?: number };
}

export class TelegramApiError extends Error {
  constructor(
    readonly method: string,
    readonly code: number,
    readonly description: string,
  ) {
    super(`Telegram ${method} failed (${code}): ${description}`);
  }
}

const REQUEST_TIMEOUT_MS = 10_000;

export async function callTelegram<T>(method: string, body: object, token = config.telegramToken): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const data = (await res.json()) as ApiResponse<T>;
    if (data.ok) return data.result as T;

    // Flood control: Telegram tells us exactly how long to wait. Retry once.
    const retryAfter = data.parameters?.retry_after;
    if (data.error_code === 429 && retryAfter && attempt === 0) {
      await sleep(retryAfter * 1000);
      continue;
    }
    throw new TelegramApiError(method, data.error_code ?? res.status, data.description ?? 'unknown error');
  }
}

export function createTelegramClient(token = config.telegramToken): TelegramClient {
  return {
    async sendMessage(chatId, text, markup?: ReplyMarkup): Promise<SendResult> {
      try {
        const msg = await callTelegram<{ message_id: number }>(
          'sendMessage',
          {
            chat_id: chatId,
            text,
            parse_mode: 'HTML',
            link_preview_options: { is_disabled: true },
            reply_markup: markup,
          },
          token,
        );
        return { ok: true, messageId: msg.message_id };
      } catch (err) {
        // 403 = bot blocked by the user / user deactivated.
        const blocked = err instanceof TelegramApiError && err.code === 403;
        log.warn('sendMessage failed', { chatId, blocked, err });
        return { ok: false, blocked };
      }
    },

    async editMessage(chatId, messageId, text, markup?: InlineKeyboard) {
      try {
        await callTelegram(
          'editMessageText',
          {
            chat_id: chatId,
            message_id: messageId,
            text,
            parse_mode: 'HTML',
            link_preview_options: { is_disabled: true },
            reply_markup: markup,
          },
          token,
        );
      } catch (err) {
        // Tapping the same button twice produces an identical edit - harmless.
        if (err instanceof TelegramApiError && err.description.includes('message is not modified')) return;
        throw err;
      }
    },

    async answerCallback(callbackQueryId, text) {
      try {
        await callTelegram('answerCallbackQuery', { callback_query_id: callbackQueryId, text }, token);
      } catch (err) {
        // Expires after ~15s; failing to stop the button spinner isn't worth failing the request.
        log.warn('answerCallbackQuery failed', { err });
      }
    },
  };
}
