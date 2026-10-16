import type { InlineButton, InlineKeyboard, ReplyKeyboard } from './types';

// Every piece of text not written by us (game names, user input) must go through this
// before it's put in an HTML-mode message, or Telegram rejects the whole message.
export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function flagEmoji(regionCode: string | null | undefined): string {
  const code = (regionCode ?? '').toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) return '🏳️';
  return String.fromCodePoint(...[...code].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}

export function inlineKeyboard(rows: InlineButton[][]): InlineKeyboard {
  return { inline_keyboard: rows.filter((row) => row.length > 0) };
}

export function replyKeyboard(rows: string[][]): ReplyKeyboard {
  return {
    keyboard: rows.map((row) => row.map((text) => ({ text }))),
    resize_keyboard: true,
    is_persistent: true,
  };
}

// Telegram's button labels get cut off on phones well before the API limit.
export function truncate(text: string, max = 40): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}
