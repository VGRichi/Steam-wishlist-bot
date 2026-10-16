import { LIMITS } from '../config.js';
import { ANY_DISCOUNT, isTriggered, type Alert } from '../domain/alert.js';
import { parsePercent, parsePriceCents, parseRegion } from '../domain/parse.js';
import type { Pending, Repo, TrackedGame, User } from '../db/types.js';
import { log } from '../log.js';
import { isKnownRegion, type Price, type SteamClient } from '../steam/api.js';
import type { TelegramClient, TgCallbackQuery, TgMessage, TgUpdate } from '../telegram/types.js';
import { decode } from './callbacks.js';
import * as views from './views.js';
import { REMOVE_KEYBOARD, text, type View } from './views.js';

export interface BotDeps {
  repo: Repo;
  steam: SteamClient;
  tg: TelegramClient;
  now?: () => Date;
}

const MAX_QUERY_LENGTH = 100;

// Old v1 command names keep working for people with muscle memory.
const COMMAND_ALIASES: Record<string, string> = {
  start: 'start',
  help: 'help',
  list: 'list',
  mylist: 'list',
  remove: 'remove',
  removegame: 'remove',
  add: 'add',
  addgame: 'add',
  check: 'check',
  checknow: 'check',
  region: 'region',
  setregion: 'region',
  clear: 'clear',
  clearlist: 'clear',
  cancel: 'cancel',
};

export function parseCommand(input: string): { command: string; arg: string } | null {
  const match = input.match(/^\/([a-z_]+)(?:@\w+)?(?:\s+([\s\S]*))?$/i);
  if (!match) return null;
  const command = COMMAND_ALIASES[match[1]!.toLowerCase()];
  return command ? { command, arg: (match[2] ?? '').trim() } : null;
}

export function createBot({ repo, steam, tg, now = () => new Date() }: BotDeps) {
  // Where a reply goes: edit the message the button was on, or send a new one.
  type Reply = (view: View) => Promise<void>;

  const send = (chatId: number): Reply => async (view) => {
    await tg.sendMessage(chatId, view.text, view.markup);
  };

  // undefined = lookup failed; null = Steam has no price for it in this region.
  async function fetchPrice(appId: number, region: string): Promise<Price | null | undefined> {
    try {
      const prices = await steam.getPrices([appId], region);
      return prices.get(appId) ?? null;
    } catch (err) {
      log.warn('price lookup failed', { appId, region, err });
      return undefined;
    }
  }

  async function requireRegion(user: User): Promise<string | null> {
    if (user.region) return user.region;
    await repo.setPending(user.chatId, { kind: 'region' });
    await tg.sendMessage(user.chatId, text.askRegion());
    return null;
  }

  // ---------- Flows ----------

  // Puts this user's region flag into their command menu.
  const refreshMenu = (chatId: number, region: string | null) => tg.setChatCommands(chatId, views.commandMenu(region));

  async function start(user: User) {
    await refreshMenu(user.chatId, user.region);
    if (!user.region) {
      await repo.setPending(user.chatId, { kind: 'region' });
      await tg.sendMessage(user.chatId, text.welcome(), REMOVE_KEYBOARD);
      return;
    }
    await tg.sendMessage(user.chatId, text.welcomeBack(user.region), REMOVE_KEYBOARD);
  }

  async function askRegion(user: User) {
    await repo.setPending(user.chatId, { kind: 'region' });
    await tg.sendMessage(user.chatId, text.askRegion());
  }

  async function onRegionInput(user: User, input: string) {
    const region = parseRegion(input);
    if (!region) {
      await tg.sendMessage(user.chatId, text.badRegion());
      return;
    }
    const { clearedPriceAlerts } = await repo.setRegion(user.chatId, region);
    await refreshMenu(user.chatId, region);
    await tg.sendMessage(user.chatId, text.regionSet(region, isKnownRegion(region), clearedPriceAlerts), REMOVE_KEYBOARD);
  }

  async function startAdd(user: User, query: string) {
    const region = await requireRegion(user);
    if (!region) return;
    if (!query) {
      await repo.setPending(user.chatId, { kind: 'search' });
      await tg.sendMessage(user.chatId, text.askSearch());
      return;
    }
    await search(user.chatId, region, query);
  }

  async function search(chatId: number, region: string, rawQuery: string) {
    const games = await repo.listGames(chatId);
    if (games.length >= LIMITS.maxGamesPerUser) {
      await tg.sendMessage(chatId, text.limitReached());
      return;
    }
    const query = rawQuery.slice(0, MAX_QUERY_LENGTH);
    let results;
    try {
      results = await steam.searchGames(query, region);
    } catch (err) {
      log.warn('search failed', { query, err });
      await tg.sendMessage(chatId, text.searchFailed());
      return;
    }
    const view = results.length ? views.searchResults(query, results) : { text: text.noResults(query) };
    await tg.sendMessage(chatId, view.text, view.markup);
  }

  async function addGame(user: User, appId: number, reply: Reply) {
    const region = await requireRegion(user);
    if (!region) return;
    let details;
    try {
      details = await steam.getAppDetails(appId, region);
    } catch (err) {
      log.warn('appdetails failed', { appId, err });
      await reply({ text: text.checkFailed() });
      return;
    }
    if (!details) {
      await reply({ text: text.notAvailable() });
      return;
    }

    const onSale = isTriggered(ANY_DISCOUNT, details.price);
    const result = await repo.addGame(user.chatId, appId, details.name, onSale, LIMITS.maxGamesPerUser);
    if (result === 'limit') {
      await reply({ text: text.limitReached() });
      return;
    }
    if (result === 'duplicate') {
      const game = await repo.getGame(user.chatId, appId);
      if (game) await reply(views.gameCard(game, details.price, 'You already track this game.'));
      return;
    }
    await reply(views.alertPicker(appId, details.name, views.addedIntro(details.name, onSale)));
  }

  async function showList(chatId: number, reply: Reply, prefix?: string) {
    const view = views.gameList(await repo.listGames(chatId));
    await reply(prefix ? { ...view, text: `${prefix}\n\n${view.text}` } : view);
  }

  async function showGame(user: User, appId: number, reply: Reply) {
    const game = await repo.getGame(user.chatId, appId);
    if (!game) {
      await reply({ text: text.notTracked() });
      return;
    }
    const price = user.region ? await fetchPrice(appId, user.region) : undefined;
    await reply(views.gameCard(game, price));
  }

  async function saveAlert(chatId: number, region: string, game: TrackedGame, alert: Alert, reply: Reply) {
    const price = await fetchPrice(game.appId, region);
    // Count a deal the user can already see as "notified", so the daily check doesn't repeat it.
    const met = price ? isTriggered(alert, price) : false;
    await repo.updateAlert(chatId, game.appId, alert, met);
    await repo.setPending(chatId, null);
    await reply(views.gameCard({ ...game, alert, lastConditionMet: met }, price, text.alertSaved()));
  }

  async function askPrice(chatId: number, region: string, game: TrackedGame, percent: number | null) {
    const price = await fetchPrice(game.appId, region);
    if (price === undefined) {
      await repo.setPending(chatId, null);
      await tg.sendMessage(chatId, text.checkFailed());
      return;
    }
    if (price === null) {
      await tg.sendMessage(chatId, text.noPriceForAlert(game.name));
      if (percent != null) {
        await saveAlert(chatId, region, game, { minDiscountPercent: percent, maxPrice: null }, send(chatId));
      } else {
        await repo.setPending(chatId, null);
      }
      return;
    }
    await repo.setPending(chatId, { kind: 'price', appId: game.appId, percent, currency: price.currency });
    await tg.sendMessage(chatId, text.askPrice(game.name, price));
  }

  async function chooseAlertMode(user: User, appId: number, mode: 'any' | 'pct' | 'price' | 'both', reply: Reply) {
    const region = await requireRegion(user);
    if (!region) return;
    const game = await repo.getGame(user.chatId, appId);
    if (!game) {
      await reply({ text: text.notTracked() });
      return;
    }
    if (mode === 'any') {
      await saveAlert(user.chatId, region, game, ANY_DISCOUNT, reply);
      return;
    }
    if (mode === 'price') {
      await askPrice(user.chatId, region, game, null);
      return;
    }
    await repo.setPending(user.chatId, { kind: 'percent', appId, thenPrice: mode === 'both' });
    const price = await fetchPrice(appId, region);
    await tg.sendMessage(user.chatId, text.askPercent(game.name, price ?? null));
  }

  async function onPercentInput(user: User, pending: Extract<Pending, { kind: 'percent' }>, input: string) {
    const percent = parsePercent(input);
    if (percent == null) {
      await tg.sendMessage(user.chatId, text.badPercent());
      return;
    }
    const region = await requireRegion(user);
    const game = await repo.getGame(user.chatId, pending.appId);
    if (!region || !game) {
      await repo.setPending(user.chatId, null);
      if (!game) await tg.sendMessage(user.chatId, text.notTracked());
      return;
    }
    if (pending.thenPrice) {
      await askPrice(user.chatId, region, game, percent);
      return;
    }
    await saveAlert(user.chatId, region, game, { minDiscountPercent: percent, maxPrice: null }, send(user.chatId));
  }

  async function onPriceInput(user: User, pending: Extract<Pending, { kind: 'price' }>, input: string) {
    const cents = parsePriceCents(input);
    if (cents == null) {
      await tg.sendMessage(user.chatId, text.badPrice());
      return;
    }
    const region = await requireRegion(user);
    const game = await repo.getGame(user.chatId, pending.appId);
    if (!region || !game) {
      await repo.setPending(user.chatId, null);
      if (!game) await tg.sendMessage(user.chatId, text.notTracked());
      return;
    }
    const alert: Alert = { minDiscountPercent: pending.percent, maxPrice: { cents, currency: pending.currency } };
    await saveAlert(user.chatId, region, game, alert, send(user.chatId));
  }

  async function checkNow(user: User) {
    const region = await requireRegion(user);
    if (!region) return;

    const current = now();
    if (user.lastCheckAt) {
      const waitMs = LIMITS.checkNowCooldownMs - (current.getTime() - user.lastCheckAt.getTime());
      if (waitMs > 0) {
        await tg.sendMessage(user.chatId, text.cooldown(Math.ceil(waitMs / 1000)));
        return;
      }
    }

    const games = await repo.listGames(user.chatId);
    if (!games.length) {
      await tg.sendMessage(user.chatId, text.emptyList());
      return;
    }
    // Stamp before calling Steam so rapid repeat taps can't fan out requests.
    await repo.setLastCheckAt(user.chatId, current);

    const status = await tg.sendMessage(user.chatId, text.checking(games.length));
    const show = async (body: string) => {
      if (status.ok) await tg.editMessage(user.chatId, status.messageId, body);
      else await tg.sendMessage(user.chatId, body);
    };

    let prices;
    try {
      prices = await steam.getPrices(
        games.map((g) => g.appId),
        region,
      );
    } catch (err) {
      log.warn('check now failed', { chatId: user.chatId, err });
      await show(text.checkFailed());
      return;
    }

    const checked = games.map((game) => ({ game, price: prices.get(game.appId) ?? null }));
    await show(views.checkResults(checked));

    // The user has now seen every current deal, so the daily check shouldn't announce them again.
    for (const { game, price } of checked) {
      const met = isTriggered(game.alert, price);
      if (met !== game.lastConditionMet) await repo.setConditionMet(user.chatId, game.appId, met);
    }
  }

  async function confirmClear(chatId: number, reply: Reply) {
    const games = await repo.listGames(chatId);
    await reply(games.length ? views.clearConfirm(games.length) : { text: text.emptyList() });
  }

  async function cancel(user: User) {
    if (user.pending) await repo.setPending(user.chatId, null);
    await tg.sendMessage(user.chatId, user.pending ? text.cancelled() : text.nothingToCancel());
  }

  // ---------- Dispatch ----------

  async function runCommand(user: User, command: string, arg: string) {
    const chatId = user.chatId;
    switch (command) {
      case 'start':
        return start(user);
      case 'help':
        return tg.sendMessage(chatId, text.help());
      case 'list':
        return showList(chatId, send(chatId));
      case 'add':
        return startAdd(user, arg);
      case 'check':
        return checkNow(user);
      case 'region':
        return askRegion(user);
      case 'remove':
        return send(chatId)(views.removePicker(await repo.listGames(chatId)));
      case 'clear':
        return confirmClear(chatId, send(chatId));
      case 'cancel':
        return cancel(user);
    }
  }

  async function onMessage(message: TgMessage) {
    // Lists and alerts are per person; group chats aren't supported.
    if (message.chat.type !== 'private') return;
    const chatId = message.chat.id;
    const input = (message.text ?? '').trim();
    let user = await repo.touchUser(chatId);

    const parsed = parseCommand(input);
    const oldButton = parsed ? null : views.oldKeyboardCommand(input);
    const command = parsed?.command ?? oldButton;
    if (command) {
      // Any explicit action abandons a half-finished conversation, except /cancel which reports on it.
      if (user.pending && command !== 'cancel') {
        await repo.setPending(chatId, null);
        user = { ...user, pending: null };
      }
      await runCommand(user, command, parsed?.arg ?? '');
      // A tap on a button from an older version: do what it said, then retire that keyboard.
      if (oldButton) {
        await refreshMenu(chatId, user.region);
        await tg.sendMessage(chatId, text.menuMoved(), REMOVE_KEYBOARD);
      }
      return;
    }

    const pending = user.pending;
    if (input && pending) {
      switch (pending.kind) {
        case 'region':
          return onRegionInput(user, input);
        case 'search':
          await repo.setPending(chatId, null);
          return startAdd(user, input);
        case 'percent':
          return onPercentInput(user, pending, input);
        case 'price':
          return onPriceInput(user, pending, input);
      }
    }

    await tg.sendMessage(chatId, text.unknown());
  }

  async function onCallback(query: TgCallbackQuery) {
    // Stop the button's loading spinner first; everything after can take a moment.
    await tg.answerCallback(query.id);
    if (query.message && query.message.chat.type !== 'private') return;

    const callback = decode(query.data ?? '');
    if (!callback) return;
    // In a private chat the chat id is the user id, so this works even without the message.
    const chatId = query.message?.chat.id ?? query.from.id;
    const messageId = query.message?.message_id;
    const user = await repo.touchUser(chatId);

    const edit: Reply = messageId
      ? (view) => tg.editMessage(chatId, messageId, view.text, view.markup)
      : send(chatId);

    switch (callback.type) {
      case 'add':
        return addGame(user, callback.appId, edit);
      case 'game':
        return showGame(user, callback.appId, edit);
      case 'alert': {
        const game = await repo.getGame(chatId, callback.appId);
        return edit(game ? views.alertPicker(game.appId, game.name) : { text: text.notTracked() });
      }
      case 'set':
        return chooseAlertMode(user, callback.appId, callback.mode, edit);
      case 'remove': {
        const game = await repo.getGame(chatId, callback.appId);
        if (game) await repo.removeGame(chatId, callback.appId);
        return showList(chatId, edit, game ? text.removed(game.name) : undefined);
      }
      case 'list':
      case 'clearNo':
        return showList(chatId, edit);
      case 'clear':
        return confirmClear(chatId, edit);
      case 'clearYes':
        await repo.clearGames(chatId);
        return edit({ text: text.cleared() });
    }
  }

  return {
    async handleUpdate(update: TgUpdate): Promise<void> {
      const chatId = update.message?.chat.id ?? update.callback_query?.message?.chat.id ?? update.callback_query?.from.id;
      try {
        if (update.message) await onMessage(update.message);
        else if (update.callback_query) await onCallback(update.callback_query);
      } catch (err) {
        log.error('update failed', { updateId: update.update_id, chatId, err });
        if (chatId != null) await tg.sendMessage(chatId, text.error()).catch(() => undefined);
      }
    },
  };
}
