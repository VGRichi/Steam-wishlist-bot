// The subset of the Telegram Bot API this bot uses. https://core.telegram.org/bots/api

export interface TgUser {
  id: number;
  first_name?: string;
  language_code?: string;
}

export interface TgChat {
  id: number;
  type: 'private' | 'group' | 'supergroup' | 'channel';
}

export interface TgMessage {
  message_id: number;
  chat: TgChat;
  from?: TgUser;
  text?: string;
}

export interface TgCallbackQuery {
  id: string;
  from: TgUser;
  // Absent when the original message is too old for Telegram to send along.
  message?: TgMessage;
  data?: string;
}

export interface TgUpdate {
  update_id: number;
  message?: TgMessage;
  callback_query?: TgCallbackQuery;
}

export interface InlineButton {
  text: string;
  callback_data?: string;
  url?: string;
}

export interface InlineKeyboard {
  inline_keyboard: InlineButton[][];
}

export interface ReplyKeyboard {
  keyboard: { text: string }[][];
  resize_keyboard: true;
  is_persistent: true;
}

export type ReplyMarkup = InlineKeyboard | ReplyKeyboard;

export type SendResult =
  | { ok: true; messageId: number }
  // blocked = the user blocked the bot or deleted their account; stop messaging them.
  | { ok: false; blocked: boolean };

export interface TelegramClient {
  sendMessage(chatId: number, text: string, markup?: ReplyMarkup): Promise<SendResult>;
  editMessage(chatId: number, messageId: number, text: string, markup?: InlineKeyboard): Promise<void>;
  answerCallback(callbackQueryId: string, text?: string): Promise<void>;
}
