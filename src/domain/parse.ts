// Parsers for free-text replies. Each returns null when the input isn't usable.

export function parseRegion(text: string): string | null {
  const code = text.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(code) ? code : null;
}

export function parsePercent(text: string): number | null {
  const match = text.trim().match(/^(\d{1,3})\s*%?$/);
  if (!match) return null;
  const value = Number(match[1]);
  return value >= 1 && value <= 100 ? value : null;
}

// Fits the integer column and still covers big-number currencies (IDR, VND).
const MAX_PRICE_CENTS = 1_000_000_000;

// Accepts what people actually type in different locales: "15", "15.99", "15,99",
// "$15", "1,299.50", "1.299,50", "1 299". Returns hundredths of the currency unit.
export function parsePriceCents(text: string): number | null {
  if (text.includes('-')) return null;
  const cleaned = text.trim().replace(/[\s '_]/g, '').replace(/^[^\d.,]+|[^\d.,]+$/g, '');
  if (!/^[\d.,]+$/.test(cleaned) || !/\d/.test(cleaned)) return null;

  const lastDot = cleaned.lastIndexOf('.');
  const lastComma = cleaned.lastIndexOf(',');
  let normalized: string;

  if (lastDot !== -1 && lastComma !== -1) {
    // Both present: whichever comes last is the decimal separator.
    const decimalSep = lastDot > lastComma ? '.' : ',';
    const thousandsSep = decimalSep === '.' ? ',' : '.';
    const [intPart, fracPart, ...rest] = cleaned.split(thousandsSep).join('').split(decimalSep);
    if (rest.length || intPart === undefined) return null;
    normalized = `${intPart}.${fracPart ?? ''}`;
  } else {
    const sep = lastDot !== -1 ? '.' : lastComma !== -1 ? ',' : null;
    if (!sep) {
      normalized = cleaned;
    } else {
      const groups = cleaned.split(sep);
      const last = groups[groups.length - 1] ?? '';
      // A single separator followed by 1-2 digits is a decimal point ("15,99");
      // otherwise it's grouping ("1,299", "1.299.000").
      if (groups.length === 2 && last.length >= 1 && last.length <= 2) {
        normalized = `${groups[0]}.${last}`;
      } else if (groups.slice(1).every((g) => g.length === 3) && groups[0] !== '') {
        normalized = groups.join('');
      } else {
        return null;
      }
    }
  }

  const value = Number(normalized);
  if (!Number.isFinite(value) || value <= 0) return null;
  const cents = Math.round(value * 100);
  return cents > 0 && cents <= MAX_PRICE_CENTS ? cents : null;
}
