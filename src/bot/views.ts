// Every message the bot sends, as pure functions of data. No I/O here, so it's all unit-testable.
import { LIMITS } from '../config.js';
import { describeAlert, formatMoney, formatPrice, isTriggered, type Alert } from '../domain/alert.js';
import type { TrackedGame } from '../db/types.js';
import { storeUrl, type Price, type SearchResult } from '../steam/api.js';
import { escapeHtml, flagEmoji, inlineKeyboard, truncate } from '../telegram/format.js';
import type { BotCommand, InlineKeyboard, RemoveKeyboard } from '../telegram/types.js';
import { encode, type NavTarget } from './callbacks.js';

export interface View {
  text: string;
  markup?: InlineKeyboard;
}

// Two ways in: the home panel (a message whose buttons edit it in place) and Telegram's command
// list (the "Menu" button next to the message box), which always leads back to the panel.
// Emoji are ones that render in color on iOS (➕ ➖ and 🗑 without VS16 show up grey).
export function commandMenu(region: string | null): BotCommand[] {
  return [
    { command: 'menu', description: '🏠 Home panel' },
    { command: 'list', description: '📋 Your tracked games' },
    { command: 'add', description: '🔍 Track a new game' },
    { command: 'check', description: '🔄 Check prices now' },
    { command: 'help', description: '❓ How the bot works' },
    { command: 'region', description: region ? `🌍 Change region (now ${flagEmoji(region)} ${region})` : '🌍 Change your region' },
  ];
}

const nav = (text: string, to: NavTarget) => ({ text, callback_data: encode({ type: 'nav', to }) });
const HOME_ROW = [nav('🏠 Home', 'home')];

// Must match the cron schedule in vercel.json ("0 0 * * *" = 00:00 UTC).
const DAILY_CHECK_HOUR_UTC = 0;

function untilNextCheck(now: Date): string {
  const next = new Date(now);
  next.setUTCHours(DAILY_CHECK_HOUR_UTC, 0, 0, 0);
  if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
  const hours = Math.floor((next.getTime() - now.getTime()) / 3_600_000);
  return hours < 1 ? 'under 1h' : `${hours}h`;
}

// Counts come from saved state (lastConditionMet is updated by the daily check and Check Now),
// so opening the panel never waits on Steam.
export function homePanel(region: string, games: TrackedGame[], now: Date): View {
  const onSale = games.filter((g) => g.lastConditionMet).length;
  const lines = ['🏠 <b>Steam Wishlist Bot</b>', '', `🎮 Tracking <b>${games.length}</b> of ${LIMITS.maxGamesPerUser} games`];
  if (games.length) {
    lines.push(onSale ? `🔥 <b>${onSale}</b> matched your alerts at the last check` : '😴 Nothing matched your alerts at the last check');
  }
  lines.push(`🌍 Region: ${flagEmoji(region)} ${region} · next check in ${untilNextCheck(now)}`);
  return {
    text: lines.join('\n'),
    markup: inlineKeyboard([
      [nav('📋 My List', 'list'), nav('🔍 Add Game', 'search')],
      [nav('🔄 Check Now', 'check'), nav('❌ Remove', 'remove')],
      [nav(`🌍 Region ${flagEmoji(region)}`, 'region'), nav('❓ Help', 'help')],
    ]),
  };
}

// Any text with a Home button under it. On prompts that wait for typed input, Home doubles as "cancel".
export const withHome = (message: string): View => ({ text: message, markup: inlineKeyboard([HOME_ROW]) });

// Clears the button keyboard older versions of the bot left on people's screens.
export const REMOVE_KEYBOARD: RemoveKeyboard = { remove_keyboard: true };

// Labels from those old keyboards, so a tap on one still does what it says.
const OLD_KEYBOARD: Record<string, string> = {
  '📋 My List': 'list',
  '➕ Add Game': 'add',
  '🔍 Add Game': 'add',
  '🔄 Check Now': 'check',
  '➖ Remove Game': 'remove',
  '❌ Remove Game': 'remove',
  '🗑 Clear List': 'clear',
  '🧹 Clear List': 'clear',
  '❓ Help': 'help',
};

export function oldKeyboardCommand(input: string): string | null {
  // The region button carried the current flag ("🌍 Set Region 🇹🇷"), so it's matched by prefix.
  if (input.startsWith('🌍 ')) return 'region';
  return OLD_KEYBOARD[input] ?? null;
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

  welcomeBack: () => '👋 Welcome back!',

  help: () =>
    [
      '❓ <b>How it works</b>',
      `Track up to ${LIMITS.maxGamesPerUser} games. Once a day I check Steam and message you when a game starts matching its alert - once per sale, not every day.`,
      '',
      '🏠 /menu — the home panel; everything is a tap from there',
      '📋 /list — your games; tap one to change its alert',
      '🔍 /add — search Steam and track a game (or /add <i>name</i>)',
      '🔄 /check — check all your games right now',
      '❌ /remove — stop tracking a game (🧹 /clear removes all)',
      '🌍 /region — change your store country/currency',
      '✖️ /cancel — stop what you were typing',
    ].join('\n'),

  askRegion: () => "What's your Steam store country? Send a 2-letter code, e.g. <code>US</code>, <code>TR</code>, <code>DE</code>.",
  badRegion: () => "That doesn't look like a country code. Send 2 letters, e.g. <code>US</code> or <code>TR</code>.",
  regionSet: (region: string, known: boolean, clearedPriceAlerts: number) => {
    const lines = [`✅ Region set to ${flagEmoji(region)} <b>${region}</b>.`];
    if (!known) lines.push(`⚠️ <b>${region}</b> isn't a region I recognize. I'll use it anyway; if prices look wrong, change it.`);
    if (clearedPriceAlerts > 0) {
      lines.push(
        `ℹ️ Price alerts on ${clearedPriceAlerts} game(s) were in your old currency, so I removed them. Any % alerts are kept - see /list.`,
      );
    }
    return lines.join('\n');
  },

  askSearch: () => 'Type the name of the game to search for:',
  searchFailed: () => "Steam's search isn't responding right now. Try again in a minute.",
  noResults: (query: string) => `Nothing found for "<b>${escapeHtml(query)}</b>". Try a different spelling or a shorter name.`,
  limitReached: () =>
    `You're tracking the maximum of ${LIMITS.maxGamesPerUser} games. Use /remove to make room.`,
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
  removed: (name: string) => `❌ Stopped tracking <b>${escapeHtml(name)}</b>.`,
  menuMoved: () => '⌨️ The buttons have moved to the home panel: send /menu anytime.',
  cancelled: () => 'OK, cancelled.',
  nothingToCancel: () => 'Nothing to cancel.',
  unknown: () => 'Not sure what you mean. Send /menu for the home panel.',
  cooldown: (seconds: number) => `You just checked. Try again in ${seconds}s.`,
  checking: (count: number) => `Checking ${count} game(s)…`,
  checkFailed: () => "Couldn't reach Steam right now. Try again in a minute.",
  error: () => 'Something went wrong on my side. Please try again.',
  emptyList: () => `You're not tracking any games yet. Send /add to start.`,
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

function alertEmoji(alert: Alert): string {
  const { minDiscountPercent: pct, maxPrice } = alert;
  if (pct != null && maxPrice != null) return '🎯';
  if (pct != null) return '📊';
  if (maxPrice != null) return '💰';
  return '🔔';
}

const alertLabel = (alert: Alert) => `${alertEmoji(alert)} <i>${escapeHtml(describeAlert(alert))}</i>`;

export function gameList(games: TrackedGame[]): View {
  if (!games.length) return withHome(text.emptyList());
  const lines = games.map((g) => `🎮 ${gameLink(g.appId, g.name)} — ${alertLabel(g.alert)}`);
  return {
    text: [
      `<b>📋 Your games (${games.length}/${LIMITS.maxGamesPerUser})</b>`,
      '',
      ...lines,
      '',
      'Tap a game below to see its price or change its alert.',
    ].join('\n'),
    markup: inlineKeyboard([
      ...games.map((g) => [{ text: truncate(g.name), callback_data: encode({ type: 'game', appId: g.appId }) }]),
      HOME_ROW,
    ]),
  };
}

export function removePicker(games: TrackedGame[]): View {
  if (!games.length) return withHome(text.emptyList());
  return {
    text: '❌ Tap a game to stop tracking it:',
    markup: inlineKeyboard([
      ...games.map((g) => [{ text: `❌ ${truncate(g.name)}`, callback_data: encode({ type: 'remove', appId: g.appId }) }]),
      [{ text: '🧹 Remove all', callback_data: encode({ type: 'clear' }) }, ...HOME_ROW],
    ]),
  };
}

function priceLine(price: Price | null): string {
  if (!price) return '🚫 No price in your store (free or not sold there)';
  if (price.discountPercent > 0) {
    return `🔥 ${price.discountPercent}% off — <b>${escapeHtml(formatPrice(price))}</b> (was ${formatMoney(price.initialCents, price.currency)})`;
  }
  return `💤 No sale — ${escapeHtml(formatPrice(price))}`;
}

// price: undefined = we didn't manage to look it up.
export function gameCard(game: TrackedGame, price: Price | null | undefined, note?: string): View {
  const lines = [
    `🎮 <b>${gameLink(game.appId, game.name)}</b>`,
    '',
    price === undefined ? "❓ Couldn't fetch the current price" : priceLine(price),
  ];
  lines.push(`${alertEmoji(game.alert)} Alert: <b>${escapeHtml(describeAlert(game.alert))}</b>`);
  if (price && isTriggered(game.alert, price)) lines.push('✅ Matches your alert right now!');
  if (note) lines.push('', note);
  return {
    text: lines.join('\n'),
    markup: inlineKeyboard([
      [
        { text: '✏️ Change alert', callback_data: encode({ type: 'alert', appId: game.appId }) },
        { text: '❌ Remove', callback_data: encode({ type: 'remove', appId: game.appId }) },
      ],
      [
        { text: '🛒 Store page', url: storeUrl(game.appId) },
        nav('« My list', 'list'),
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
    const name = gameLink(game.appId, game.name);
    const n = `${i + 1}.`;
    if (price === undefined) return `${n} ❓ ${name} — couldn't fetch right now`;
    if (price === null) return `${n} 🚫 ${name} — no price in your store`;
    const priceText = escapeHtml(formatPrice(price));
    if (isTriggered(game.alert, price)) {
      const deal = price.discountPercent > 0 ? `${price.discountPercent}% off, now ${priceText}` : `now ${priceText}`;
      return `${n} 🔥 ${name} — <b>${deal}</b> ✅`;
    }
    if (price.discountPercent > 0) {
      return `${n} 🏷️ ${name} — ${price.discountPercent}% off, now ${priceText} <i>(below your alert)</i>`;
    }
    return `${n} 💤 ${name} — no sale (${priceText})`;
  });
  const matches = sorted.filter(({ game, price }) => price && isTriggered(game.alert, price)).length;
  const summary = matches
    ? `✅ <b>${matches}</b> game(s) match your alerts right now!`
    : '😴 Nothing matches your alerts right now.';
  return ['<b>🔄 Price check</b>', summary, '', ...lines].join('\n');
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
        ? `💸 ${price.discountPercent}% off — <b>${escapeHtml(formatPrice(price))}</b> (was ${formatMoney(price.initialCents, price.currency)})`
        : `💸 Now <b>${escapeHtml(formatPrice(price))}</b>`;
    return `🎮 <b>${gameLink(game.appId, game.name)}</b>\n${deal}\n${alertEmoji(game.alert)} Your alert: <i>${escapeHtml(describeAlert(game.alert))}</i>`;
  });
  return [header, ...blocks].join('\n\n');
}
