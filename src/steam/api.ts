import { LIMITS } from '../config.js';
import { sleep } from '../log.js';

// Steam reports every currency in hundredths of the display unit (USD cents, JPY "sen"),
// so "cents" below is that minor unit regardless of currency.
export interface Price {
  finalCents: number;
  initialCents: number;
  discountPercent: number;
  currency: string;
  // Steam's own localized rendering, e.g. "¥ 2,633" or "$13.49 USD". Empty when not provided.
  formatted: string;
}

export interface AppDetails {
  appId: number;
  name: string;
  isFree: boolean;
  price: Price | null;
}

export interface SearchResult {
  appId: number;
  name: string;
}

// null price = free, or not sold in that region.
export type PriceLookup = Map<number, Price | null>;

export interface SteamClient {
  searchGames(query: string, region: string): Promise<SearchResult[]>;
  getAppDetails(appId: number, region: string): Promise<AppDetails | null>;
  // Apps Steam doesn't know (delisted, bad id) are absent from the returned map.
  getPrices(appIds: number[], region: string): Promise<PriceLookup>;
}

const STORE_API = 'https://store.steampowered.com/api';
const REQUEST_TIMEOUT_MS = 10_000;
// appdetails accepts many ids at once only with filters=price_overview. 50 keeps URLs short.
const PRICE_BATCH_SIZE = 50;
const BATCH_DELAY_MS = 1_000;

interface RawPriceOverview {
  currency: string;
  initial: number;
  final: number;
  discount_percent: number;
  final_formatted?: string;
}

type RawAppDetailsResponse = Record<
  string,
  | { success: false }
  | {
      success: true;
      // An empty array instead of an object when there's nothing to report (e.g. free games with the price filter).
      data: { name?: string; is_free?: boolean; price_overview?: RawPriceOverview } | [];
    }
>;

interface RawSearchResponse {
  items?: { id: number; name: string; type: string }[];
}

export class SteamApiError extends Error {}

async function getJson<T>(url: string): Promise<T> {
  // Steam answers 429 or 5xx under load; two quick retries ride out most blips.
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    if (res.ok) return (await res.json()) as T;
    const retryable = res.status === 429 || res.status >= 500;
    if (!retryable || attempt >= 2) throw new SteamApiError(`Steam request failed (${res.status}): ${url}`);
    await sleep(1_000 * 2 ** attempt);
  }
}

function toPrice(raw: RawPriceOverview | undefined): Price | null {
  if (!raw) return null;
  return {
    finalCents: raw.final,
    initialCents: raw.initial,
    discountPercent: raw.discount_percent,
    currency: raw.currency,
    formatted: raw.final_formatted ?? '',
  };
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export function createSteamClient(): SteamClient {
  return {
    async searchGames(query, region) {
      const params = new URLSearchParams({ term: query, l: 'english', cc: region });
      const data = await getJson<RawSearchResponse>(`${STORE_API}/storesearch/?${params}`);
      // Bundle ids aren't valid appdetails ids, so drop them.
      return (data.items ?? [])
        .filter((item) => item.type !== 'bundle')
        .slice(0, LIMITS.searchResults)
        .map((item) => ({ appId: item.id, name: item.name }));
    },

    async getAppDetails(appId, region) {
      const params = new URLSearchParams({ appids: String(appId), cc: region, l: 'english' });
      const data = await getJson<RawAppDetailsResponse>(`${STORE_API}/appdetails?${params}`);
      const entry = data[appId];
      if (!entry?.success || Array.isArray(entry.data)) return null;
      return {
        appId,
        name: entry.data.name ?? `App ${appId}`,
        isFree: Boolean(entry.data.is_free),
        price: toPrice(entry.data.price_overview),
      };
    },

    async getPrices(appIds, region) {
      const result: PriceLookup = new Map();
      const batches = chunk([...new Set(appIds)], PRICE_BATCH_SIZE);
      for (const [i, batch] of batches.entries()) {
        if (i > 0) await sleep(BATCH_DELAY_MS);
        const params = new URLSearchParams({ appids: batch.join(','), cc: region, filters: 'price_overview' });
        const data = await getJson<RawAppDetailsResponse>(`${STORE_API}/appdetails?${params}`);
        for (const appId of batch) {
          const entry = data[appId];
          if (!entry?.success) continue;
          result.set(appId, Array.isArray(entry.data) ? null : toPrice(entry.data.price_overview));
        }
      }
      return result;
    },
  };
}

export function storeUrl(appId: number): string {
  return `https://store.steampowered.com/app/${appId}/`;
}

// Common Steam store regions. Not exhaustive - an unlisted code still works, we just warn.
const KNOWN_REGIONS = new Set([
  'US', 'GB', 'DE', 'FR', 'TR', 'AZ', 'RU', 'UA', 'KZ', 'PL', 'NL', 'ES', 'IT', 'CA', 'AU', 'NZ',
  'BR', 'AR', 'MX', 'CL', 'CO', 'PE', 'UY', 'IN', 'JP', 'KR', 'CN', 'TW', 'HK', 'SE', 'NO', 'FI',
  'DK', 'CH', 'AT', 'BE', 'IE', 'PT', 'GR', 'CZ', 'SK', 'RO', 'HU', 'BG', 'HR', 'IL', 'ZA', 'SG',
  'MY', 'TH', 'PH', 'ID', 'VN', 'EG', 'SA', 'AE', 'QA', 'KW', 'GE', 'AM', 'UZ', 'BY', 'PK',
]);

export function isKnownRegion(code: string): boolean {
  return KNOWN_REGIONS.has(code.toUpperCase());
}
