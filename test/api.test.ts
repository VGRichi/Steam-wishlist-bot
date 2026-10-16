import { beforeEach, describe, expect, it, vi } from 'vitest';

const handleUpdate = vi.fn(async () => undefined);
const runPriceCheck = vi.fn(async () => ({ notifiedUsers: 0 }));

vi.mock('../src/app.js', () => ({ getBot: () => ({ handleUpdate }), getDeps: () => ({}) }));
vi.mock('../src/jobs/priceCheck.js', () => ({ runPriceCheck: () => runPriceCheck() }));

const { POST } = await import('../api/webhook.js');
const { GET: cron } = await import('../api/cron.js');

describe('webhook endpoint', () => {
  beforeEach(() => {
    process.env.TELEGRAM_WEBHOOK_SECRET = 'hook-secret';
    handleUpdate.mockClear();
  });

  const post = (headers: Record<string, string>, body = '{"update_id":1}') =>
    POST(new Request('https://bot.test/api/webhook', { method: 'POST', headers, body }));

  it('rejects requests without the Telegram secret token', async () => {
    expect((await post({})).status).toBe(401);
    expect((await post({ 'x-telegram-bot-api-secret-token': 'wrong' })).status).toBe(401);
    expect(handleUpdate).not.toHaveBeenCalled();
  });

  it('passes authenticated updates to the bot', async () => {
    const res = await post({ 'x-telegram-bot-api-secret-token': 'hook-secret' });
    expect(res.status).toBe(200);
    expect(handleUpdate).toHaveBeenCalledWith({ update_id: 1 });
  });

  it('rejects malformed JSON', async () => {
    expect((await post({ 'x-telegram-bot-api-secret-token': 'hook-secret' }, '{nope')).status).toBe(400);
  });
});

describe('cron endpoint', () => {
  beforeEach(() => {
    process.env.CRON_SECRET = 'cron-secret';
    runPriceCheck.mockClear();
  });

  const get = (auth?: string) =>
    cron(new Request('https://bot.test/api/cron', { headers: auth ? { authorization: auth } : {} }));

  it('requires the bearer secret', async () => {
    expect((await get()).status).toBe(401);
    expect((await get('Bearer nope')).status).toBe(401);
    expect(runPriceCheck).not.toHaveBeenCalled();
  });

  it('does not accept "Bearer undefined" when the secret is unset', async () => {
    delete process.env.CRON_SECRET;
    await expect(get('Bearer undefined')).rejects.toThrow('CRON_SECRET');
    expect(runPriceCheck).not.toHaveBeenCalled();
  });

  it('runs the price check when authorized', async () => {
    const res = await get('Bearer cron-secret');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ notifiedUsers: 0 });
  });
});
