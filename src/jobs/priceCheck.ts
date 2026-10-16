import { isTriggered } from '../domain/alert';
import type { Repo, Subscription } from '../db/types';
import { log, sleep } from '../log';
import type { PriceLookup, SteamClient } from '../steam/api';
import type { TelegramClient } from '../telegram/types';
import { saleNotification, type SaleNotice } from '../bot/views';

export interface PriceCheckDeps {
  repo: Repo;
  steam: SteamClient;
  tg: TelegramClient;
  // Gap between outgoing messages; Telegram allows ~30/s across all chats.
  sendDelayMs?: number;
}

export interface PriceCheckStats {
  subscriptions: number;
  regions: number;
  regionErrors: number;
  notifiedUsers: number;
  notifiedGames: number;
  sendFailures: number;
  blockedUsers: number;
}

function groupBy<T, K>(items: T[], key: (item: T) => K): Map<K, T[]> {
  const map = new Map<K, T[]>();
  for (const item of items) {
    const k = key(item);
    const list = map.get(k);
    if (list) list.push(item);
    else map.set(k, [item]);
  }
  return map;
}

// Notifies each user once when a game starts matching their alert, and re-arms the alert
// when the deal ends. One Steam request per region per 50 games; one message per user.
export async function runPriceCheck({ repo, steam, tg, sendDelayMs = 50 }: PriceCheckDeps): Promise<PriceCheckStats> {
  const subscriptions = await repo.listActiveSubscriptions();
  const byRegion = groupBy(subscriptions, (s) => s.region);
  const stats: PriceCheckStats = {
    subscriptions: subscriptions.length,
    regions: byRegion.size,
    regionErrors: 0,
    notifiedUsers: 0,
    notifiedGames: 0,
    sendFailures: 0,
    blockedUsers: 0,
  };

  const pricesByRegion = new Map<string, PriceLookup>();
  for (const [region, subs] of byRegion) {
    try {
      pricesByRegion.set(region, await steam.getPrices(subs.map((s) => s.appId), region));
    } catch (err) {
      // Skip the region entirely: treating "unknown" as "not on sale" would wrongly re-arm alerts.
      log.error('price fetch failed for region', { region, err });
      stats.regionErrors++;
    }
  }

  const newDeals: (SaleNotice & { sub: Subscription })[] = [];
  for (const sub of subscriptions) {
    const prices = pricesByRegion.get(sub.region);
    if (!prices) continue;
    const price = prices.get(sub.appId) ?? null;
    const met = isTriggered(sub.alert, price);
    if (met && !sub.lastConditionMet && price) {
      newDeals.push({ sub, game: sub, price });
    } else if (!met && sub.lastConditionMet) {
      await repo.setConditionMet(sub.chatId, sub.appId, false);
    }
  }

  for (const [chatId, deals] of groupBy(newDeals, (d) => d.sub.chatId)) {
    const result = await tg.sendMessage(chatId, saleNotification(deals));
    if (result.ok) {
      // Only mark as notified once the message actually went out; otherwise the next run retries.
      for (const { sub } of deals) await repo.setConditionMet(chatId, sub.appId, true);
      stats.notifiedUsers++;
      stats.notifiedGames += deals.length;
    } else if (result.blocked) {
      await repo.markBlocked(chatId);
      stats.blockedUsers++;
    } else {
      stats.sendFailures++;
    }
    if (sendDelayMs) await sleep(sendDelayMs);
  }

  log.info('price check finished', { ...stats });
  return stats;
}
