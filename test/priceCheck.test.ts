import { beforeEach, describe, expect, it } from 'vitest';
import { runPriceCheck } from '../src/jobs/priceCheck.js';
import { FakeSteam, FakeTelegram, MemoryRepo, price } from './fakes.js';

describe('runPriceCheck', () => {
  let repo: MemoryRepo;
  let steam: FakeSteam;
  let tg: FakeTelegram;
  const run = () => runPriceCheck({ repo, steam, tg, sendDelayMs: 0 });

  beforeEach(() => {
    repo = new MemoryRepo();
    steam = new FakeSteam();
    tg = new FakeTelegram();
  });

  it('notifies once per sale and re-arms when the sale ends', async () => {
    repo.seedUser(1, 'US');
    repo.seedGame(1, { appId: 10, name: 'Hades' });
    steam.setPrice('US', 10, price(1249, 50));

    await run();
    expect(tg.sent).toHaveLength(1);
    expect(tg.last().text).toContain('Hades');
    expect(tg.last().text).toContain('50% off');

    await run(); // still on sale: no repeat
    expect(tg.sent).toHaveLength(1);

    steam.setPrice('US', 10, price(2499, 0));
    await run(); // sale over: re-armed silently
    expect(tg.sent).toHaveLength(1);
    expect((await repo.getGame(1, 10))?.lastConditionMet).toBe(false);

    steam.setPrice('US', 10, price(1249, 50));
    await run(); // next sale: notify again
    expect(tg.sent).toHaveLength(2);
  });

  it('respects each user’s own alert for the same game', async () => {
    repo.seedUser(1, 'US');
    repo.seedUser(2, 'US');
    repo.seedGame(1, { appId: 10, alert: { minDiscountPercent: 30, maxPrice: null } });
    repo.seedGame(2, { appId: 10, alert: { minDiscountPercent: 75, maxPrice: null } });
    steam.setPrice('US', 10, price(1000, 50));

    const stats = await run();
    expect(tg.sent.map((m) => m.chatId)).toEqual([1]);
    expect(stats.notifiedGames).toBe(1);
  });

  it('sends one message per user and one Steam request per region', async () => {
    repo.seedUser(1, 'US');
    repo.seedUser(2, 'TR');
    for (const appId of [10, 11, 12]) {
      repo.seedGame(1, { appId });
      repo.seedGame(2, { appId });
      steam.setPrice('US', appId, price(1000, 20));
      steam.setPrice('TR', appId, price(1000, 0, 'USD'));
    }

    const stats = await run();
    expect(steam.calls.getPrices).toBe(2);
    expect(tg.sent).toHaveLength(1);
    expect(tg.last().text).toContain('3 games you track are on sale');
    expect(stats).toMatchObject({ regions: 2, notifiedUsers: 1, notifiedGames: 3 });
  });

  it('escapes game names in notifications', async () => {
    repo.seedUser(1, 'US');
    repo.seedGame(1, { appId: 10, name: 'Command & Conquer <HD>' });
    steam.setPrice('US', 10, price(500, 75));
    await run();
    expect(tg.last().text).toContain('Command &amp; Conquer &lt;HD&gt;');
  });

  it('marks users who blocked the bot and skips them afterwards', async () => {
    repo.seedUser(1, 'US');
    repo.seedGame(1, { appId: 10 });
    steam.setPrice('US', 10, price(500, 75));
    tg.blockedChats.add(1);

    const first = await run();
    expect(first.blockedUsers).toBe(1);
    const second = await run();
    expect(second.subscriptions).toBe(0);
  });

  it('retries next run when a message fails to send', async () => {
    repo.seedUser(1, 'US');
    repo.seedGame(1, { appId: 10 });
    steam.setPrice('US', 10, price(500, 75));
    tg.failingChats.add(1);

    expect((await run()).sendFailures).toBe(1);
    expect((await repo.getGame(1, 10))?.lastConditionMet).toBe(false);

    tg.failingChats.clear();
    await run();
    expect(tg.sent).toHaveLength(1);
  });

  it('leaves state untouched for a region whose price lookup failed', async () => {
    repo.seedUser(1, 'US');
    repo.seedGame(1, { appId: 10, lastConditionMet: true });
    steam.failRegions.add('US');

    const stats = await run();
    expect(stats.regionErrors).toBe(1);
    expect((await repo.getGame(1, 10))?.lastConditionMet).toBe(true);
  });

  it('skips users without a region', async () => {
    repo.seedUser(1, null);
    repo.seedGame(1, { appId: 10 });
    expect((await run()).subscriptions).toBe(0);
  });
});
