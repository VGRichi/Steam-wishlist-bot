import type { Pending, Repo, Subscription, TrackedGame, User } from '../src/db/types.js';
import type { AppDetails, Price, PriceLookup, SearchResult, SteamClient } from '../src/steam/api.js';
import type { InlineKeyboard, ReplyMarkup, SendResult, TelegramClient, TgUpdate } from '../src/telegram/types.js';

interface StoredUser extends User {
  blocked: boolean;
}

export class MemoryRepo implements Repo {
  users = new Map<number, StoredUser>();
  games = new Map<number, TrackedGame[]>();

  seedUser(chatId: number, region: string | null, extra: Partial<StoredUser> = {}) {
    this.users.set(chatId, { chatId, region, pending: null, lastCheckAt: null, blocked: false, ...extra });
  }

  seedGame(chatId: number, game: Partial<TrackedGame> & { appId: number }) {
    const list = this.games.get(chatId) ?? [];
    list.push({
      name: `Game ${game.appId}`,
      alert: { minDiscountPercent: null, maxPrice: null },
      lastConditionMet: false,
      ...game,
    });
    this.games.set(chatId, list);
  }

  private user(chatId: number): StoredUser {
    let user = this.users.get(chatId);
    if (!user) {
      user = { chatId, region: null, pending: null, lastCheckAt: null, blocked: false };
      this.users.set(chatId, user);
    }
    return user;
  }

  private find(chatId: number, appId: number) {
    return (this.games.get(chatId) ?? []).find((g) => g.appId === appId);
  }

  async getUser(chatId: number) {
    const u = this.users.get(chatId);
    return u ? { ...u } : null;
  }
  async touchUser(chatId: number) {
    const u = this.user(chatId);
    u.blocked = false;
    return { chatId: u.chatId, region: u.region, pending: u.pending, lastCheckAt: u.lastCheckAt };
  }
  async setRegion(chatId: number, region: string) {
    const u = this.user(chatId);
    const changed = u.region != null && u.region !== region;
    u.region = region;
    u.pending = null;
    let clearedPriceAlerts = 0;
    if (changed) {
      for (const g of this.games.get(chatId) ?? []) {
        if (g.alert.maxPrice) {
          g.alert = { ...g.alert, maxPrice: null };
          clearedPriceAlerts++;
        }
        g.lastConditionMet = false;
      }
    }
    return { clearedPriceAlerts };
  }
  async setPending(chatId: number, pending: Pending | null) {
    this.user(chatId).pending = pending;
  }
  async setLastCheckAt(chatId: number, at: Date) {
    this.user(chatId).lastCheckAt = at;
  }
  async markBlocked(chatId: number) {
    this.user(chatId).blocked = true;
  }
  async listGames(chatId: number) {
    return (this.games.get(chatId) ?? []).map((g) => ({ ...g }));
  }
  async getGame(chatId: number, appId: number) {
    const g = this.find(chatId, appId);
    return g ? { ...g } : null;
  }
  async addGame(chatId: number, appId: number, name: string, conditionMet: boolean, limit: number) {
    const list = this.games.get(chatId) ?? [];
    if (list.length >= limit) return 'limit' as const;
    if (list.some((g) => g.appId === appId)) return 'duplicate' as const;
    list.push({ appId, name, alert: { minDiscountPercent: null, maxPrice: null }, lastConditionMet: conditionMet });
    this.games.set(chatId, list);
    return 'added' as const;
  }
  async updateAlert(chatId: number, appId: number, alert: TrackedGame['alert'], conditionMet: boolean) {
    const g = this.find(chatId, appId);
    if (g) Object.assign(g, { alert, lastConditionMet: conditionMet });
  }
  async setConditionMet(chatId: number, appId: number, met: boolean) {
    const g = this.find(chatId, appId);
    if (g) g.lastConditionMet = met;
  }
  async removeGame(chatId: number, appId: number) {
    this.games.set(chatId, (this.games.get(chatId) ?? []).filter((g) => g.appId !== appId));
  }
  async clearGames(chatId: number) {
    this.games.delete(chatId);
  }
  async listActiveSubscriptions() {
    const out: Subscription[] = [];
    for (const [chatId, list] of this.games) {
      const u = this.users.get(chatId);
      if (!u || u.blocked || !u.region) continue;
      for (const g of list) out.push({ ...g, chatId, region: u.region });
    }
    return out;
  }
}

export function price(finalCents: number, discountPercent = 0, currency = 'USD'): Price {
  const initialCents = discountPercent ? Math.round(finalCents / (1 - discountPercent / 100)) : finalCents;
  return { finalCents, initialCents, discountPercent, currency, formatted: '' };
}

export class FakeSteam implements SteamClient {
  // region -> appId -> price (null = free / not sold)
  prices = new Map<string, Map<number, Price | null>>();
  names = new Map<number, string>();
  searchResults: SearchResult[] = [];
  failRegions = new Set<string>();
  calls = { getPrices: 0, search: 0 };

  setPrice(region: string, appId: number, p: Price | null) {
    if (!this.prices.has(region)) this.prices.set(region, new Map());
    this.prices.get(region)!.set(appId, p);
  }

  async searchGames(): Promise<SearchResult[]> {
    this.calls.search++;
    return this.searchResults;
  }
  async getAppDetails(appId: number, region: string): Promise<AppDetails | null> {
    const regionPrices = this.prices.get(region);
    if (!regionPrices?.has(appId)) return null;
    const p = regionPrices.get(appId) ?? null;
    return { appId, name: this.names.get(appId) ?? `Game ${appId}`, isFree: p === null, price: p };
  }
  async getPrices(appIds: number[], region: string): Promise<PriceLookup> {
    this.calls.getPrices++;
    if (this.failRegions.has(region)) throw new Error(`steam down for ${region}`);
    const out: PriceLookup = new Map();
    const regionPrices = this.prices.get(region);
    for (const id of appIds) if (regionPrices?.has(id)) out.set(id, regionPrices.get(id) ?? null);
    return out;
  }
}

export interface SentMessage {
  chatId: number;
  text: string;
  markup?: ReplyMarkup;
  editedFrom?: number;
}

export class FakeTelegram implements TelegramClient {
  sent: SentMessage[] = [];
  answered: string[] = [];
  blockedChats = new Set<number>();
  failingChats = new Set<number>();
  private nextId = 1000;

  async sendMessage(chatId: number, text: string, markup?: ReplyMarkup): Promise<SendResult> {
    if (this.blockedChats.has(chatId)) return { ok: false, blocked: true };
    if (this.failingChats.has(chatId)) return { ok: false, blocked: false };
    this.sent.push({ chatId, text, markup });
    return { ok: true, messageId: this.nextId++ };
  }
  async editMessage(chatId: number, messageId: number, text: string, markup?: InlineKeyboard) {
    this.sent.push({ chatId, text, markup, editedFrom: messageId });
  }
  async answerCallback(id: string) {
    this.answered.push(id);
  }

  last(): SentMessage {
    const msg = this.sent[this.sent.length - 1];
    if (!msg) throw new Error('no messages sent');
    return msg;
  }
  buttons(msg = this.last()): { text: string; data?: string }[] {
    if (!msg.markup || !('inline_keyboard' in msg.markup)) return [];
    return msg.markup.inline_keyboard.flat().map((b) => ({ text: b.text, data: b.callback_data }));
  }
}

let updateId = 1;
export function textUpdate(chatId: number, text: string, chatType: 'private' | 'group' = 'private'): TgUpdate {
  return { update_id: updateId++, message: { message_id: updateId, chat: { id: chatId, type: chatType }, text } };
}
export function callbackUpdate(chatId: number, data: string, messageId = 500): TgUpdate {
  return {
    update_id: updateId++,
    callback_query: {
      id: `cb${updateId}`,
      from: { id: chatId },
      data,
      message: { message_id: messageId, chat: { id: chatId, type: 'private' } },
    },
  };
}
