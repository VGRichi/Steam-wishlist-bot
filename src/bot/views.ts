// Every message the bot sends, as pure functions of data. No I/O here, so it's all unit-testable.
import { LIMITS } from '../config.js';
import { describeAlert, formatMoney, formatPrice, isTriggered } from '../domain/alert.js';
import type { TrackedGame } from '../db/types.js';
import { storeUrl, type Price, type SearchResult } from '../steam/api.js';
import { escapeHtml, flagEmoji, inlineKeyboard, replyKeyboard, truncate } from '../telegram/format.js';
import type { InlineKeyboard, ReplyKeyboard } from '../telegram/types.js';
import { encode } from './callbacks.js';

export interface View {
  text: string;
  markup?: InlineKeyboard;
}

export const MENU = {
  list: '📋 My List',
  add: '➕ Add Game',
  check: '🔄 Check Now',
  help: '❓ Help',
  regionPrefix: '🌍',
} as const;

// Labels from the v1 keyboard. Users keep seeing an old keyboard until we send them a new one.
export const LEGACY_MENU = {
  remove: '➖ Remove Game',
  clear: '🗑 Clear List',
} as const;

export function mainMenu(region: string | null): ReplyKeyboard {
  return replyKeyboard([
    [MENU.list, MENU.add],
    [MENU.check, `${MENU.regionPrefix} Region ${flagEmoji(region)}`],
    [MENU.help],
  ]);
}

const gameLink = (appId: number, name: string) => `<a href="${storeUrl(appId)}">${escapeHtml(name)}</a>`;

export const text = {
  welcome: () =>
    [
      '👋 <b>Welcome to Steam Wishlist Bot!</b>',
      '',
      "Tell me which Steam games you want, and I'll message you when they go on sale - at any discount, past a % you choose, or under a price you set.",
      '',
      "First, what's your Steam store country? Send a 2-letter code, e.g. <code>US</code>, <code>TR</code>, <code>AZ</code>, <code>DE</code>.",
    ].join('\n'),

  welcomeBack: (region: string) =>
    `👋 Welcome back! Your region is ${flagEmoji(region)} <b>${region}</b>. Use the menu below.`,

  help: () =>
    [
      '<b>How it works</b>',
      `Track up to ${LIMITS.maxGamesPerUser} games. Once a day I check Steam and message you when a game starts matching its alert - once per sale, not every day.`,
      '',
      `${MENU.list} - your games; tap one to change its alert or remove it`,
      `${MENU.add} - search Steam and start tracking a game`,
      `${MENU.check} - check all your games right now`,
      `${MENU.regionPrefix} Region - change the store country/currency`,
      '',
      'You can also type: /add <i>name</i>, /list, /check, /region, /cancel',
    ].join('\n'),

  askRegion: () => "What's your Steam store country? Send a 2-letter code, e.g. <code>US</code>, <code>TR</code>, <code>DE</code>.",
  badRegion: () => "That doesn't look like a country code. Send 2 letters, e.g. <code>US</code> or <code>TR</code>.",
  regionSet: (region: string, known: boolean, clearedPriceAlerts: number) => {
    const lines = [`✅ Region set to ${flagEmoji(region)} <b>${region}</b>.`];
    if (!known) lines.push(`⚠️ <b>${region}</b> isn't a region I recognize. I'll use it anyway; if prices look wrong, change it.`);
    if (clearedPriceAlerts > 0) {
      lines.push(
        `ℹ️ Price alerts on ${clearedPriceAlerts} game(s) were in your old currency, so I removed them. Any % alerts are kept - check ${MENU.list}.`,
      );
    }
    return lines.join('\n');
  },

  askSearch: () => 'Type the name of the game to search for:',
  searchFailed: () => "Steam's search isn't responding right now. Try again in a minute.",
  noResults: (query: string) => `Nothing found for "<b>${escapeHtml(query)}</b>". Try a different spelling or a shorter name.`,
  limitReached: () =>
    `You're tracking the maximum of ${LIMITS.maxGamesPerUser} games. Remove one from ${MENU.list} to make room.`,
  notAvailable: () => "That game isn't available in your region's store.",
  notTracked: () => "You're not tracking that game anymore.",

  askPercent: (name: string, price: Price | null) =>
    [
      `Minimum discount for <b>${escapeHtml(name)}</b>? Send a number from 1 to 100 (e.g. <code>30</code> = 30% off or more).`,
      price && price.discountPercent > 0 ? `It's ${price.discountPercent}% off right now.` : '',
    ]
      .filter(Boolean)
      .join('\n'),
  badPercent: () => 'Send a whole number from 1 to 100, e.g. <code>30</code>. Or /cancel.',

  askPrice: (name: string, price: Price) =>
    `Alert me when <b>${escapeHtml(name)}</b> costs at most… (in ${price.currency}, it's ${escapeHtml(formatPrice(price))} now). E.g. <code>${suggestPrice(price)}</code>`,
  badPrice: () => 'Send a price as a number, e.g. <code>15</code> or <code>15.99</code>. Or /cancel.',
  noPriceForAlert: (name: string) =>
    `<b>${escapeHtml(name)}</b> has no price in your region's store (free or not sold there), so a price alert can't work.`,

  alertSaved: () => '✅ Alert saved.',
  removed: (name: string) => `🗑 Stopped tracking <b>${escapeHtml(name)}</b>.`,
  cancelled: () => 'OK, cancelled.',
  nothingToCancel: () => 'Nothing to cancel.',
  unknown: () => 'Not sure what you mean - use the menu below, or /help.',
  cooldown: (seconds: number) => `You just checked. Try again in ${seconds}s.`,
  checking: (count: number) => `Checking ${count} game(s)…`,
  checkFailed: () => "Couldn't reach Steam right now. Try again in a minute.",
  error: () => 'Something went wrong on my side. Please try again.',
  emptyList: () => `You're not tracking any games yet. Tap ${MENU.add} to start.`,
  cleared: () => '✅ Your list is now empty.',
};

function suggestPrice(price: Price): string {
  // Half the current price, rounded to a whole unit, is a believable sale target.
  return String(Math.max(1, Math.round(price.finalCents / 200)));
}

export function searchResults(query: string, results: SearchResult[]): View {
  return {
    text: `Results for "<b>${escapeHtml(query)}</b>" - tap the right one:`,
    markup: inlineKeyboard(results.map((r) => [{ text: truncate(r.name), callback_data: encode({ type: 'add', appId: r.appId }) }])),
  };
}

export function gameList(games: TrackedGame[]): View {
  if (!games.length) return { text: text.emptyList() };
  const lines = games.map((g, i) => `${i + 1}. ${gameLink(g.appId, g.name)} - <i>${escapeHtml(describeAlert(g.alert))}</i>`);
  return {
    text: [`<b>Your games (${games.length}/${LIMITS.maxGamesPerUser})</b>`, '', ...lines, '', 'Tap a game to change its alert or remove it.'].join('\n'),
    markup: inlineKeyboard([
      ...games.map((g) => [{ text: truncate(g.name), callback_data: encode({ type: 'game', appId: g.appId }) }]),
      [{ text: '🗑 Clear list', callback_data: encode({ type: 'clear' }) }],
    ]),
  };
}

function priceLine(price: Price | null): string {
  if (!price) return 'No price in your store (free or not sold there).';
  if (price.discountPercent > 0) {
    return `🔥 ${price.discountPercent}% off - <b>${escapeHtml(formatPrice(price))}</b> (was ${formatMoney(price.initialCents, price.currency)})`;
  }
  return `Price: ${escapeHtml(formatPrice(price))} (no sale)`;
}

// price: undefined = we didn't manage to look it up.
export function gameCard(game: TrackedGame, price: Price | null | undefined, note?: string): View {
  const lines = [`🎮 ${gameLink(game.appId, game.name)}`, '', price === undefined ? "Couldn't fetch the current price." : priceLine(price)];
  lines.push(`🔔 Alert: <b>${escapeHtml(describeAlert(game.alert))}</b>`);
  if (price && isTriggered(game.alert, price)) lines.push('✅ Matches your alert right now!');
  if (note) lines.push('', note);
  return {
    text: lines.join('\n'),
    markup: inlineKeyboard([
      [
        { text: '✏️ Change alert', callback_data: encode({ type: 'alert', appId: game.appId }) },
        { text: '🗑 Remove', callback_data: encode({ type: 'remove', appId: game.appId }) },
      ],
      [
        { text: '🛒 Store page', url: storeUrl(game.appId) },
        { text: '« My list', callback_data: encode({ type: 'list' }) },
      ],
    ]),
  };
}

export function alertPicker(appId: number, name: string, intro?: string): View {
  const set = (mode: 'any' | 'pct' | 'price' | 'both') => encode({ type: 'set', mode, appId });
  return {
    text: [intro, `How should I alert you about <b>${escapeHtml(name)}</b>?`].filter(Boolean).join('\n\n'),
    markup: inlineKeyboard([
      [
        { text: '🔔 Any discount', callback_data: set('any') },
        { text: '📊 Min. % off', callback_data: set('pct') },
      ],
      [
        { text: '💰 Max. price', callback_data: set('price') },
        { text: '🎯 % or price', callback_data: set('both') },
      ],
      [{ text: '« Back', callback_data: encode({ type: 'game', appId }) }],
    ]),
  };
}

export function addedIntro(name: string, alreadyOnSale: boolean): string {
  const lines = [`✅ Now tracking <b>${escapeHtml(name)}</b>. By default I'll alert you on any discount.`];
  if (alreadyOnSale) lines.push("🔥 It's on sale right now - check it out!");
  return lines.join('\n');
}

export function clearConfirm(count: number): View {
  return {
    text: `Remove all ${count} game(s) from your list? This can't be undone.`,
    markup: inlineKeyboard([
      [
        { text: '✅ Yes, clear it', callback_data: encode({ type: 'clearYes' }) },
        { text: '❌ Cancel', callback_data: encode({ type: 'clearNo' }) },
      ],
    ]),
  };
}

export interface CheckedGame {
  game: TrackedGame;
  price: Price | null | undefined;
}

export function checkResults(checked: CheckedGame[]): string {
  const rank = ({ game, price }: CheckedGame) =>
    !price ? -2 : isTriggered(game.alert, price) ? 1000 + price.discountPercent : price.discountPercent;
  // Array.prototype.sort is stable, so ties keep the order games were added in.
  const sorted = [...checked].sort((a, b) => rank(b) - rank(a));

  const lines = sorted.map(({ game, price }, i) => {
    const prefix = `${i + 1}. ${gameLink(game.appId, game.name)}`;
    if (price === undefined) return `${prefix} - ❓ couldn't fetch`;
    if (price === null) return `${prefix} - no price in your store`;
    const priceText = escapeHtml(formatPrice(price));
    if (isTriggered(game.alert, price)) return `${prefix} - ✅ <b>${price.discountPercent}% off, ${priceText}</b>`;
    if (price.discountPercent > 0) return `${prefix} - ${price.discountPercent}% off, ${priceText} <i>(below your alert)</i>`;
    return `${prefix} - ${priceText}`;
  });
  const matches = sorted.filter(({ game, price }) => price && isTriggered(game.alert, price)).length;
  const summary = matches ? `✅ <b>${matches}</b> game(s) match your alerts right now.` : 'Nothing matches your alerts right now.';
  return [summary, '', ...lines].join('\n');
}

export interface SaleNotice {
  game: TrackedGame;
  price: Price;
}

export function saleNotification(sales: SaleNotice[]): string {
  const header = sales.length === 1 ? '🔥 <b>A game you track is on sale!</b>' : `🔥 <b>${sales.length} games you track are on sale!</b>`;
  const blocks = sales.map(({ game, price }) => {
    const deal =
      price.discountPercent > 0
        ? `${price.discountPercent}% off - <b>${escapeHtml(formatPrice(price))}</b> (was ${formatMoney(price.initialCents, price.currency)})`
        : `Now <b>${escapeHtml(formatPrice(price))}</b>`;
    return `🎮 ${gameLink(game.appId, game.name)}\n${deal}\n<i>Your alert: ${escapeHtml(describeAlert(game.alert))}</i>`;
  });
  return [header, ...blocks].join('\n\n');
}
