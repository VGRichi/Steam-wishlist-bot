import { beforeEach, describe, expect, it } from 'vitest';
import { createBot } from '../src/bot/handlers.js';
import { LIMITS } from '../src/config.js';
import { callbackUpdate, FakeSteam, FakeTelegram, MemoryRepo, price, textUpdate } from './fakes.js';

const CHAT = 42;

describe('bot', () => {
  let repo: MemoryRepo;
  let steam: FakeSteam;
  let tg: FakeTelegram;
  let clock: Date;
  let bot: ReturnType<typeof createBot>;
  const say = (text: string) => bot.handleUpdate(textUpdate(CHAT, text));
  const tap = (data: string) => bot.handleUpdate(callbackUpdate(CHAT, data));

  beforeEach(() => {
    repo = new MemoryRepo();
    steam = new FakeSteam();
    tg = new FakeTelegram();
    clock = new Date('2026-10-16T12:00:00Z');
    bot = createBot({ repo, steam, tg, now: () => clock });
  });

  describe('onboarding', () => {
    it('asks for a region on /start and accepts it', async () => {
      await say('/start');
      expect(tg.last().text).toContain('Welcome');
      expect((await repo.getUser(CHAT))?.pending).toEqual({ kind: 'region' });

      await say('usa');
      expect(tg.last().text).toContain("doesn't look like a country code");

      await say('tr');
      expect(tg.sent.at(-2)?.text).toContain('Region set to');
      expect((await repo.getUser(CHAT))?.region).toBe('TR');
      expect((await repo.getUser(CHAT))?.pending).toBeNull();
    });

    it('asks for a region before anything that needs prices', async () => {
      await say('/check');
      expect(tg.last().text).toContain('store country');
      expect((await repo.getUser(CHAT))?.pending).toEqual({ kind: 'region' });
    });

    it('greets returning users, clears any old keyboard, sets their command menu and opens the panel', async () => {
      repo.seedUser(CHAT, 'DE');
      await say('/start');
      expect(tg.sent.at(-2)?.text).toContain('Welcome back');
      expect(tg.sent.at(-2)?.markup).toEqual({ remove_keyboard: true });
      expect(tg.last().text).toContain('🏠');
      expect(tg.chatCommands.get(CHAT)?.map((c) => c.command)).toEqual(['menu', 'list', 'add', 'check', 'help', 'region']);
      expect(tg.chatCommands.get(CHAT)?.at(-1)?.description).toBe('🌍 Change region (now 🇩🇪 DE)');
    });

    it('updates the region flag in the command menu', async () => {
      repo.seedUser(CHAT, 'DE');
      await say('/region');
      await say('TR');
      expect(tg.chatCommands.get(CHAT)?.at(-1)?.description).toBe('🌍 Change region (now 🇹🇷 TR)');
    });

    it('/help explains the commands', async () => {
      repo.seedUser(CHAT, 'DE');
      await say('/help');
      expect(tg.last().text).toContain('How it works');
      expect(tg.last().text).toContain('/remove');
    });

    it('drops price alerts when the region changes', async () => {
      repo.seedUser(CHAT, 'US');
      repo.seedGame(CHAT, { appId: 10, alert: { minDiscountPercent: 20, maxPrice: { cents: 1500, currency: 'USD' } } });
      await say('/region');
      await say('TR');
      expect(tg.sent.at(-2)?.text).toContain('Price alerts on 1 game(s)');
      expect((await repo.getGame(CHAT, 10))?.alert).toEqual({ minDiscountPercent: 20, maxPrice: null });
    });
  });

  describe('adding a game and setting its alert', () => {
    beforeEach(() => {
      repo.seedUser(CHAT, 'US');
      steam.searchResults = [{ appId: 1091500, name: 'Cyberpunk 2077' }];
      steam.names.set(1091500, 'Cyberpunk 2077');
      steam.setPrice('US', 1091500, price(5999, 0));
    });

    it('search -> pick -> percent alert', async () => {
      await say('/add');
      await say('cyberpunk');
      expect(tg.buttons()).toEqual([{ text: 'Cyberpunk 2077', data: 'add:1091500' }]);

      await tap('add:1091500');
      expect(tg.last().text).toContain('Now tracking <b>Cyberpunk 2077</b>');
      expect(await repo.getGame(CHAT, 1091500)).not.toBeNull();

      await tap('set:pct:1091500');
      await say('abc');
      expect(tg.last().text).toContain('whole number from 1 to 100');
      await say('40%');
      expect(tg.last().text).toContain('Alert saved');
      expect((await repo.getGame(CHAT, 1091500))?.alert).toEqual({ minDiscountPercent: 40, maxPrice: null });
      expect((await repo.getUser(CHAT))?.pending).toBeNull();
    });

    it('/add <name> searches directly', async () => {
      await say('/add cyberpunk');
      expect(tg.buttons()[0]?.data).toBe('add:1091500');
    });

    it('"both" asks for percent then price, in the store currency, accepting a decimal comma', async () => {
      await tap('add:1091500');
      await tap('set:both:1091500');
      await say('50');
      expect(tg.last().text).toContain('in USD');
      await say('19,99');
      expect((await repo.getGame(CHAT, 1091500))?.alert).toEqual({
        minDiscountPercent: 50,
        maxPrice: { cents: 1999, currency: 'USD' },
      });
    });

    it('marks an alert that already matches as notified, so the daily check does not repeat it', async () => {
      steam.setPrice('US', 1091500, price(1799, 70));
      await tap('add:1091500');
      expect(tg.last().text).toContain('on sale right now');
      await tap('set:pct:1091500');
      await say('50');
      expect(tg.last().text).toContain('Matches your alert right now');
      expect((await repo.getGame(CHAT, 1091500))?.lastConditionMet).toBe(true);
    });

    it('refuses a price alert for a game with no price in the region', async () => {
      steam.setPrice('US', 1091500, null);
      await tap('add:1091500');
      await tap('set:price:1091500');
      expect(tg.last().text).toContain('no price');
      expect((await repo.getUser(CHAT))?.pending).toBeNull();
    });

    it('reports duplicates with the game card', async () => {
      await tap('add:1091500');
      await tap('add:1091500');
      expect(tg.last().text).toContain('You already track this game');
    });

    it('enforces the per-user limit before searching', async () => {
      for (let i = 1; i <= LIMITS.maxGamesPerUser; i++) repo.seedGame(CHAT, { appId: i });
      await say('/add cyberpunk');
      expect(tg.last().text).toContain('maximum');
      expect(steam.calls.search).toBe(0);
    });

    it('a menu tap abandons a half-finished alert instead of misreading the next message', async () => {
      await tap('add:1091500');
      await tap('set:pct:1091500');
      await say('/list');
      expect((await repo.getUser(CHAT))?.pending).toBeNull();
      await say('30');
      expect(tg.last().text).toContain('Not sure what you mean');
    });

    it('/cancel clears pending input', async () => {
      await say('/add');
      await say('/cancel');
      expect(tg.last().text).toContain('cancelled');
      expect((await repo.getUser(CHAT))?.pending).toBeNull();
    });

    it('escapes user search text echoed back', async () => {
      steam.searchResults = [];
      await say('/add <b>&');
      expect(tg.last().text).toContain('&lt;b&gt;&amp;');
    });
  });

  describe('list, remove, clear', () => {
    beforeEach(() => {
      repo.seedUser(CHAT, 'US');
      repo.seedGame(CHAT, { appId: 10, name: 'Hades' });
      repo.seedGame(CHAT, { appId: 11, name: 'Celeste' });
    });

    it('lists games with buttons to manage each', async () => {
      await say('/list');
      expect(tg.last().text).toContain('Your games (2/');
      expect(tg.buttons().map((b) => b.data)).toEqual(['game:10', 'game:11', 'go:home']);
    });

    it('/remove offers each game as a remove button, plus remove all', async () => {
      await say('/remove');
      expect(tg.buttons()).toEqual([
        { text: '❌ Hades', data: 'remove:10' },
        { text: '❌ Celeste', data: 'remove:11' },
        { text: '🧹 Remove all', data: 'clear' },
        { text: '🏠 Home', data: 'go:home' },
      ]);
    });

    it('removes a game from its card and edits the message in place', async () => {
      await tap('remove:10');
      expect(tg.last().editedFrom).toBe(500);
      expect(tg.last().text).toContain('Stopped tracking <b>Hades</b>');
      expect((await repo.listGames(CHAT)).map((g) => g.appId)).toEqual([11]);
    });

    it('clears only after confirmation', async () => {
      await say('/clear');
      expect(await repo.listGames(CHAT)).toHaveLength(2);
      await tap('clear:no');
      expect(await repo.listGames(CHAT)).toHaveLength(2);
      await tap('clear:yes');
      expect(await repo.listGames(CHAT)).toHaveLength(0);
    });

    it.each([
      ['➖ Remove Game', 'stop tracking'],
      ['❌ Remove Game', 'stop tracking'],
      ['🗑 Clear List', 'Remove all 2 game(s)'],
      ['📋 My List', 'Your games'],
      ['🌍 Set Region 🇹🇷', 'store country'],
    ])('an old keyboard button %j still works, then the keyboard is removed', async (label, expected) => {
      await say(label);
      expect(tg.sent.at(-2)?.text).toContain(expected);
      expect(tg.last().text).toContain('buttons have moved');
      expect(tg.last().markup).toEqual({ remove_keyboard: true });
      expect(tg.chatCommands.has(CHAT)).toBe(true);
    });

    it('commands do not trigger the keyboard notice', async () => {
      await say('/clear');
      expect(tg.last().text).toContain('Remove all 2 game(s)');
    });
  });

  describe('home panel', () => {
    beforeEach(() => {
      repo.seedUser(CHAT, 'TR');
      repo.seedGame(CHAT, { appId: 10, name: 'Hades', lastConditionMet: true });
      repo.seedGame(CHAT, { appId: 11, name: 'Celeste' });
      steam.setPrice('TR', 10, price(500, 75));
      steam.setPrice('TR', 11, price(500, 0));
    });

    it('/menu shows saved counts, region and next check without calling Steam', async () => {
      await say('/menu');
      const panel = tg.last().text;
      expect(panel).toContain('Tracking <b>2</b> of 10');
      expect(panel).toContain('<b>1</b> matched your alerts');
      expect(panel).toContain('🇹🇷 TR · next check in 12h'); // clock is 12:00 UTC, check runs at 00:00 UTC
      expect(steam.calls.getPrices).toBe(0);
      expect(tg.buttons().map((b) => b.data)).toEqual(['go:list', 'go:search', 'go:check', 'go:remove', 'go:region', 'go:help']);
    });

    it.each([
      ['go:list', 'Your games'],
      ['go:remove', 'stop tracking'],
      ['go:help', 'How it works'],
      ['go:check', 'Price check'],
    ])('%s edits the panel in place and offers a way home', async (data, expected) => {
      await tap(data);
      expect(tg.last().editedFrom).toBe(500);
      expect(tg.last().text).toContain(expected);
      expect(tg.buttons().some((b) => b.data === 'go:home')).toBe(true);
    });

    it('Add Game from the panel waits for a name; Home cancels it', async () => {
      await tap('go:search');
      expect((await repo.getUser(CHAT))?.pending).toEqual({ kind: 'search' });
      await tap('go:home');
      expect((await repo.getUser(CHAT))?.pending).toBeNull();
      expect(tg.last().text).toContain('🏠');
    });
  });

  describe('check now', () => {
    beforeEach(() => {
      repo.seedUser(CHAT, 'US');
      repo.seedGame(CHAT, { appId: 10, name: 'Hades', alert: { minDiscountPercent: 60, maxPrice: null } });
      repo.seedGame(CHAT, { appId: 11, name: 'Celeste' });
      repo.seedGame(CHAT, { appId: 12, name: 'Gone' });
      steam.setPrice('US', 10, price(1000, 40));
      steam.setPrice('US', 11, price(500, 75));
    });

    it('fetches all prices in one request and puts alert matches first', async () => {
      await say('/check');
      expect(steam.calls.getPrices).toBe(1);
      const result = tg.last().text;
      expect(result).toContain('1</b> game(s) match');
      expect(result.indexOf('Celeste')).toBeLessThan(result.indexOf('Hades'));
      expect(result).toContain('below your alert');
      expect(result).toContain('no price in your store');
      expect((await repo.getGame(CHAT, 11))?.lastConditionMet).toBe(true);
    });

    it('has a cooldown', async () => {
      await say('/check');
      clock = new Date(clock.getTime() + 10_000);
      await say('/check');
      expect(tg.last().text).toContain('Try again in 50s');
      expect(steam.calls.getPrices).toBe(1);
    });

    it('tells the user when Steam is down', async () => {
      steam.failRegions.add('US');
      await say('/check');
      expect(tg.last().text).toContain("Couldn't reach Steam");
    });
  });

  it('ignores group chats', async () => {
    await bot.handleUpdate(textUpdate(CHAT, '/start', 'group'));
    expect(tg.sent).toHaveLength(0);
  });

  it('ignores forged or stale callback data', async () => {
    repo.seedUser(CHAT, 'US');
    await tap('filter:any');
    await tap('remove:abc');
    expect(tg.sent).toHaveLength(0);
    expect(tg.answered).toHaveLength(2);
  });

  it('tells the user when something breaks instead of going silent', async () => {
    repo.listGames = async () => {
      throw new Error('db down');
    };
    repo.seedUser(CHAT, 'US');
    await say('/list');
    expect(tg.last().text).toContain('Something went wrong');
  });
});
