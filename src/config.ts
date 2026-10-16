// Read lazily so tests and scripts that don't need every variable can still import modules that use them.
function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
}

export const config = {
  get telegramToken() {
    return required('TELEGRAM_BOT_TOKEN');
  },
  get webhookSecret() {
    return required('TELEGRAM_WEBHOOK_SECRET');
  },
  get supabaseUrl() {
    return required('SUPABASE_URL');
  },
  get supabaseServiceRoleKey() {
    return required('SUPABASE_SERVICE_ROLE_KEY');
  },
  get cronSecret() {
    return required('CRON_SECRET');
  },
};

export const LIMITS = {
  maxGamesPerUser: 10,
  searchResults: 5,
  checkNowCooldownMs: 60_000,
} as const;
