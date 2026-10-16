// Inline-button payloads. Telegram caps callback_data at 64 bytes and sends it back verbatim,
// so anything decoded here is untrusted input and gets validated.

export type AlertMode = 'any' | 'pct' | 'price' | 'both';

export type Callback =
  | { type: 'add'; appId: number }
  | { type: 'game'; appId: number }
  | { type: 'alert'; appId: number }
  | { type: 'set'; mode: AlertMode; appId: number }
  | { type: 'remove'; appId: number }
  // Home panel navigation; each target edits the panel message in place.
  | { type: 'nav'; to: NavTarget }
  | { type: 'clear' }
  | { type: 'clearYes' }
  | { type: 'clearNo' };

export type NavTarget = 'home' | 'list' | 'search' | 'check' | 'remove' | 'region' | 'help';

const ALERT_MODES: readonly AlertMode[] = ['any', 'pct', 'price', 'both'];
const NAV_TARGETS: readonly NavTarget[] = ['home', 'list', 'search', 'check', 'remove', 'region', 'help'];

export function encode(cb: Callback): string {
  switch (cb.type) {
    case 'add':
    case 'game':
    case 'alert':
    case 'remove':
      return `${cb.type}:${cb.appId}`;
    case 'set':
      return `set:${cb.mode}:${cb.appId}`;
    case 'nav':
      return `go:${cb.to}`;
    case 'clear':
      return 'clear';
    case 'clearYes':
      return 'clear:yes';
    case 'clearNo':
      return 'clear:no';
  }
}

function parseAppId(raw: string | undefined): number | null {
  if (!raw || !/^\d{1,10}$/.test(raw)) return null;
  const id = Number(raw);
  return id > 0 && id <= 2_147_483_647 ? id : null;
}

export function decode(data: string): Callback | null {
  const [head, a, b, ...rest] = data.split(':');
  if (rest.length) return null;

  if (head === 'go' && b === undefined) {
    const to = NAV_TARGETS.find((t) => t === a);
    return to ? { type: 'nav', to } : null;
  }
  // "« My list" buttons on messages sent before the home panel existed.
  if (head === 'list' && a === undefined) return { type: 'nav', to: 'list' };
  if (head === 'clear') {
    if (a === undefined) return { type: 'clear' };
    if (a === 'yes' && b === undefined) return { type: 'clearYes' };
    if (a === 'no' && b === undefined) return { type: 'clearNo' };
    return null;
  }
  if (head === 'set') {
    const mode = ALERT_MODES.find((m) => m === a);
    const appId = parseAppId(b);
    return mode && appId ? { type: 'set', mode, appId } : null;
  }
  if ((head === 'add' || head === 'game' || head === 'alert' || head === 'remove') && b === undefined) {
    const appId = parseAppId(a);
    return appId ? { type: head, appId } : null;
  }
  return null;
}
