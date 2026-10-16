import type { Alert } from '../domain/alert.js';

// What the bot is waiting for in the user's next plain-text message.
// Stored as JSON in users.pending because serverless functions keep no memory between requests.
export type Pending =
  | { kind: 'region' }
  | { kind: 'search' }
  // thenPrice: the user picked "both", so ask for the price after the percentage.
  | { kind: 'percent'; appId: number; thenPrice: boolean }
  | { kind: 'price'; appId: number; percent: number | null; currency: string };

export interface User {
  chatId: number;
  region: string | null;
  pending: Pending | null;
  lastCheckAt: Date | null;
}

export interface TrackedGame {
  appId: number;
  name: string;
  alert: Alert;
  // Whether the alert was true at the last check; we only notify on a false -> true change.
  lastConditionMet: boolean;
}

// One user's interest in one game, as the price check sees it.
export interface Subscription extends TrackedGame {
  chatId: number;
  region: string;
}

export type AddGameResult = 'added' | 'duplicate' | 'limit';

export interface Repo {
  // Creates the user on first contact and clears the blocked flag, since they're talking to us again.
  touchUser(chatId: number): Promise<User>;
  // On an actual change, drops price alerts (they were in the old currency) and resets every
  // game's lastConditionMet. Returns how many price alerts were dropped.
  setRegion(chatId: number, region: string): Promise<{ clearedPriceAlerts: number }>;
  setPending(chatId: number, pending: Pending | null): Promise<void>;
  setLastCheckAt(chatId: number, at: Date): Promise<void>;
  markBlocked(chatId: number): Promise<void>;

  listGames(chatId: number): Promise<TrackedGame[]>;
  getGame(chatId: number, appId: number): Promise<TrackedGame | null>;
  addGame(chatId: number, appId: number, name: string, conditionMet: boolean, limit: number): Promise<AddGameResult>;
  updateAlert(chatId: number, appId: number, alert: Alert, conditionMet: boolean): Promise<void>;
  setConditionMet(chatId: number, appId: number, met: boolean): Promise<void>;
  removeGame(chatId: number, appId: number): Promise<void>;
  clearGames(chatId: number): Promise<void>;

  // Every subscription of every user who has a region and hasn't blocked the bot.
  listActiveSubscriptions(): Promise<Subscription[]>;
}
