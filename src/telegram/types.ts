// The subset of the Telegram Bot API this bot uses. https://core.telegram.org/bots/api

export interface TgUser {
  id: number;
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

export interface RemoveKeyboard {
  remove_keyboard: true;
}

export type ReplyMarkup = InlineKeyboard | RemoveKeyboard;

// One line in the "Menu" command list.
export interface BotCommand {
  command: string;
  description: string;
}

export type SendResult =
  | { ok: true; messageId: number }
  // blocked = the user blocked the bot or deleted their account; stop messaging them.
  | { ok: false; blocked: boolean };

export interface TelegramClient {
  sendMessage(chatId: number, text: string, markup?: ReplyMarkup): Promise<SendResult>;
  editMessage(chatId: number, messageId: number, text: string, markup?: InlineKeyboard): Promise<void>;
  answerCallback(callbackQueryId: string, text?: string): Promise<void>;
  // Sets the command menu this one chat sees (overrides the bot-wide default).
  setChatCommands(chatId: number, commands: BotCommand[]): Promise<void>;
}
