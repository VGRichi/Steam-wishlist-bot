import type { Price } from '../steam/api';

export interface PriceLimit {
  cents: number;
  // Currency the user typed the amount in. null = unknown (only from rows created before v2).
  currency: string | null;
}

// Both null = notify on any discount. Both set = either one triggers.
export interface Alert {
  minDiscountPercent: number | null;
  maxPrice: PriceLimit | null;
}

export const ANY_DISCOUNT: Alert = { minDiscountPercent: null, maxPrice: null };

export function isTriggered(alert: Alert, price: Price | null): boolean {
  if (!price) return false;
  const { minDiscountPercent, maxPrice } = alert;
  if (minDiscountPercent == null && maxPrice == null) return price.discountPercent > 0;
  const discountMet = minDiscountPercent != null && price.discountPercent >= minDiscountPercent;
  // A limit in another currency can't be compared (Steam does move regions between currencies).
  const sameCurrency = maxPrice != null && (maxPrice.currency == null || maxPrice.currency === price.currency);
  const priceMet = maxPrice != null && sameCurrency && price.finalCents <= maxPrice.cents;
  return discountMet || priceMet;
}

export function formatMoney(cents: number, currency: string | null): string {
  const amount = cents / 100;
  if (currency) {
    try {
      return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount);
    } catch {
      // Unknown ISO code - fall through to the plain format.
    }
  }
  return `${amount.toFixed(2)}${currency ? ` ${currency}` : ''}`;
}

export function formatPrice(price: Price): string {
  return price.formatted || formatMoney(price.finalCents, price.currency);
}

export function describeAlert(alert: Alert): string {
  const parts: string[] = [];
  if (alert.minDiscountPercent != null) parts.push(`${alert.minDiscountPercent}%+ off`);
  if (alert.maxPrice != null) parts.push(`under ${formatMoney(alert.maxPrice.cents, alert.maxPrice.currency)}`);
  return parts.length ? parts.join(' or ') : 'any discount';
}
