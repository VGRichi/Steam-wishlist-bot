import { describe, expect, it } from 'vitest';
import { describeAlert, formatMoney, isTriggered, type Alert } from '../src/domain/alert.js';
import { parsePercent, parsePriceCents, parseRegion } from '../src/domain/parse.js';
import { price } from './fakes.js';

describe('parseRegion', () => {
  it.each([
    ['us', 'US'],
    [' TR ', 'TR'],
    ['Az', 'AZ'],
  ])('accepts %j', (input, expected) => expect(parseRegion(input)).toBe(expected));

  it.each(['USA', 'U', '12', '', 'u s', '🇺🇸'])('rejects %j', (input) => expect(parseRegion(input)).toBeNull());
});

describe('parsePercent', () => {
  it.each([
    ['30', 30],
    ['30%', 30],
    [' 5 % ', 5],
    ['100', 100],
    ['1', 1],
  ])('accepts %j', (input, expected) => expect(parsePercent(input)).toBe(expected));

  it.each(['0', '101', '-5', '30.5', 'thirty', '', '30abc', '1000'])('rejects %j', (input) =>
    expect(parsePercent(input)).toBeNull(),
  );
});

describe('parsePriceCents', () => {
  it.each([
    ['15', 1500],
    ['15.99', 1599],
    ['15,99', 1599], // decimal comma (DE, TR, AZ, ...)
    ['15,9', 1590],
    ['$15', 1500],
    ['15 USD', 1500],
    ['₺499,99', 49999],
    ['1,299', 129900], // thousands comma
    ['1.299', 129900], // thousands dot
    ['1,299.50', 129950],
    ['1.299,50', 129950],
    ['1 299', 129900],
    ['1.299.000', 129900000],
    ['0.5', 50],
  ])('parses %j as %i cents', (input, expected) => expect(parsePriceCents(input)).toBe(expected));

  it.each(['', 'free', '0', '0,00', '-5', '15.99.99', '1,2,3', '12,3456', '.', ',', '99999999999'])(
    'rejects %j',
    (input) => expect(parsePriceCents(input)).toBeNull(),
  );
});

describe('isTriggered', () => {
  const any: Alert = { minDiscountPercent: null, maxPrice: null };
  const pct30: Alert = { minDiscountPercent: 30, maxPrice: null };
  const under15: Alert = { minDiscountPercent: null, maxPrice: { cents: 1500, currency: 'USD' } };
  const both: Alert = { minDiscountPercent: 50, maxPrice: { cents: 1000, currency: 'USD' } };

  it('never triggers without a price', () => {
    for (const alert of [any, pct30, under15, both]) expect(isTriggered(alert, null)).toBe(false);
  });

  it('any discount', () => {
    expect(isTriggered(any, price(1999, 10))).toBe(true);
    expect(isTriggered(any, price(1999, 0))).toBe(false);
  });

  it('percent threshold is inclusive', () => {
    expect(isTriggered(pct30, price(1000, 30))).toBe(true);
    expect(isTriggered(pct30, price(1000, 29))).toBe(false);
  });

  it('price threshold is inclusive and works without a discount', () => {
    expect(isTriggered(under15, price(1500))).toBe(true);
    expect(isTriggered(under15, price(1501, 50))).toBe(false);
  });

  it('either condition triggers "both"', () => {
    expect(isTriggered(both, price(4000, 50))).toBe(true);
    expect(isTriggered(both, price(999, 5))).toBe(true);
    expect(isTriggered(both, price(4000, 20))).toBe(false);
  });

  it('ignores a price limit in another currency', () => {
    expect(isTriggered(under15, price(100, 0, 'TRY'))).toBe(false);
    const legacy: Alert = { minDiscountPercent: null, maxPrice: { cents: 1500, currency: null } };
    expect(isTriggered(legacy, price(100, 0, 'TRY'))).toBe(true);
  });
});

describe('formatting', () => {
  it('formats money per currency', () => {
    expect(formatMoney(1349, 'USD')).toBe('$13.49');
    expect(formatMoney(263300, 'JPY')).toBe('¥2,633');
    expect(formatMoney(1500, null)).toBe('15.00');
    expect(formatMoney(1500, 'XYZ1')).toBe('15.00 XYZ1');
  });

  it('describes alerts', () => {
    expect(describeAlert({ minDiscountPercent: null, maxPrice: null })).toBe('any discount');
    expect(describeAlert({ minDiscountPercent: 30, maxPrice: { cents: 1500, currency: 'USD' } })).toBe(
      '30%+ off or under $15.00',
    );
  });
});
