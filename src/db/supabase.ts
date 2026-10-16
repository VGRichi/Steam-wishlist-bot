import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config } from '../config.js';
import type { Pending, Repo, Subscription, TrackedGame, User } from './types.js';

interface UserRow {
  chat_id: number;
  region_code: string | null;
  pending: Pending | null;
  last_check_at: string | null;
}

interface GameRow {
  app_id: number;
  game_name: string;
  threshold_percent: number | null;
  threshold_price_cents: number | null;
  threshold_currency: string | null;
  last_condition_met: boolean;
}

interface SubscriptionRow extends GameRow {
  chat_id: number;
  users: { region_code: string };
}

const USER_COLUMNS = 'chat_id, region_code, pending, last_check_at';
const GAME_COLUMNS = 'app_id, game_name, threshold_percent, threshold_price_cents, threshold_currency, last_condition_met';
// PostgREST caps responses (1000 rows by default), so large reads are paged.
const PAGE_SIZE = 1000;
const UNIQUE_VIOLATION = '23505';

function toUser(row: UserRow): User {
  return {
    chatId: row.chat_id,
    region: row.region_code,
    pending: row.pending,
    lastCheckAt: row.last_check_at ? new Date(row.last_check_at) : null,
  };
}

function toGame(row: GameRow): TrackedGame {
  return {
    appId: row.app_id,
    name: row.game_name,
    alert: {
      minDiscountPercent: row.threshold_percent,
      maxPrice:
        row.threshold_price_cents == null ? null : { cents: row.threshold_price_cents, currency: row.threshold_currency },
    },
    lastConditionMet: row.last_condition_met,
  };
}

function check(error: { message: string; code?: string } | null): void {
  if (error) throw Object.assign(new Error(`Supabase: ${error.message}`), { code: error.code });
}

export function createSupabaseRepo(
  client: SupabaseClient = createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
    auth: { persistSession: false },
  }),
): Repo {
  const users = () => client.from('users');
  const games = () => client.from('tracked_games');

  return {
    async touchUser(chatId) {
      const { data, error } = await users()
        .upsert({ chat_id: chatId, blocked_at: null }, { onConflict: 'chat_id' })
        .select(USER_COLUMNS)
        .single<UserRow>();
      check(error);
      return toUser(data!);
    },

    async setRegion(chatId, region) {
      const current = await users().select('region_code').eq('chat_id', chatId).maybeSingle<{ region_code: string | null }>();
      check(current.error);
      const { error } = await users().upsert({ chat_id: chatId, region_code: region, pending: null }, { onConflict: 'chat_id' });
      check(error);

      if (!current.data?.region_code || current.data.region_code === region) return { clearedPriceAlerts: 0 };
      // A price threshold typed in the old currency means nothing in the new one.
      const cleared = await games()
        .update({ threshold_price_cents: null, threshold_currency: null })
        .eq('chat_id', chatId)
        .not('threshold_price_cents', 'is', null)
        .select('app_id');
      check(cleared.error);
      // Different store, different deals: let the next check report whatever matches there.
      const reset = await games().update({ last_condition_met: false }).eq('chat_id', chatId);
      check(reset.error);
      return { clearedPriceAlerts: cleared.data?.length ?? 0 };
    },

    async setPending(chatId, pending) {
      const { error } = await users().upsert({ chat_id: chatId, pending }, { onConflict: 'chat_id' });
      check(error);
    },

    async setLastCheckAt(chatId, at) {
      const { error } = await users().update({ last_check_at: at.toISOString() }).eq('chat_id', chatId);
      check(error);
    },

    async markBlocked(chatId) {
      const { error } = await users().update({ blocked_at: new Date().toISOString() }).eq('chat_id', chatId);
      check(error);
    },

    async listGames(chatId) {
      const { data, error } = await games()
        .select(GAME_COLUMNS)
        .eq('chat_id', chatId)
        .order('added_at', { ascending: true })
        .returns<GameRow[]>();
      check(error);
      return (data ?? []).map(toGame);
    },

    async getGame(chatId, appId) {
      const { data, error } = await games()
        .select(GAME_COLUMNS)
        .eq('chat_id', chatId)
        .eq('app_id', appId)
        .maybeSingle<GameRow>();
      check(error);
      return data ? toGame(data) : null;
    },

    async addGame(chatId, appId, name, conditionMet, limit) {
      const { count, error: countError } = await games()
        .select('app_id', { count: 'exact', head: true })
        .eq('chat_id', chatId);
      check(countError);
      if ((count ?? 0) >= limit) return 'limit';

      const { error } = await games().insert({
        chat_id: chatId,
        app_id: appId,
        game_name: name,
        last_condition_met: conditionMet,
      });
      // The (chat_id, app_id) unique constraint is the real duplicate check; it also covers double taps.
      if (error?.code === UNIQUE_VIOLATION) return 'duplicate';
      check(error);
      return 'added';
    },

    async updateAlert(chatId, appId, alert, conditionMet) {
      const { error } = await games()
        .update({
          threshold_percent: alert.minDiscountPercent,
          threshold_price_cents: alert.maxPrice?.cents ?? null,
          threshold_currency: alert.maxPrice?.currency ?? null,
          last_condition_met: conditionMet,
        })
        .eq('chat_id', chatId)
        .eq('app_id', appId);
      check(error);
    },

    async setConditionMet(chatId, appId, met) {
      const { error } = await games().update({ last_condition_met: met }).eq('chat_id', chatId).eq('app_id', appId);
      check(error);
    },

    async removeGame(chatId, appId) {
      const { error } = await games().delete().eq('chat_id', chatId).eq('app_id', appId);
      check(error);
    },

    async clearGames(chatId) {
      const { error } = await games().delete().eq('chat_id', chatId);
      check(error);
    },

    async listActiveSubscriptions() {
      const out: Subscription[] = [];
      for (let from = 0; ; from += PAGE_SIZE) {
        const { data, error } = await games()
          .select(`chat_id, ${GAME_COLUMNS}, users!inner(region_code)`)
          .is('users.blocked_at', null)
          .not('users.region_code', 'is', null)
          .order('id')
          .range(from, from + PAGE_SIZE - 1)
          .returns<SubscriptionRow[]>();
        check(error);
        const rows = data ?? [];
        for (const row of rows) {
          out.push({ ...toGame(row), chatId: row.chat_id, region: row.users.region_code });
        }
        if (rows.length < PAGE_SIZE) return out;
      }
    },
  };
}
