import { add, money } from '@breaks/money';
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { fxLegSchema, fxRateSchema, moneySchema } from '../money.ts';

const usd = { amount: 1250, currency: 'USD', exponent: 2 } as const;
const jpy = { amount: 1250, currency: 'JPY', exponent: 0 } as const;

test('a valid Money parses into the value @breaks/money would have built', () => {
  assert.deepEqual(moneySchema.parse(usd), money(1250, 'USD'));
  assert.deepEqual(moneySchema.parse(jpy), money(1250, 'JPY'));
});

test('the parsed value is accepted by @breaks/money without a cast', () => {
  const a = moneySchema.parse(usd);
  const b = moneySchema.parse({ amount: 99, currency: 'USD', exponent: 2 });
  assert.deepEqual(add(a, b), money(1349, 'USD'));
});

test('an exponent that contradicts the ISO 4217 table is rejected', () => {
  const result = moneySchema.safeParse({ amount: 1250, currency: 'JPY', exponent: 2 });
  assert.equal(result.success, false);
  assert.match(result.error.issues[0]?.message ?? '', /does not match the ISO 4217 minor unit/);
});

test('an exponent outside 0, 2 and 3 is rejected before the table is consulted', () => {
  assert.equal(moneySchema.safeParse({ amount: 1, currency: 'USD', exponent: 1 }).success, false);
});

test('a fractional amount is rejected', () => {
  assert.equal(
    moneySchema.safeParse({ amount: 12.5, currency: 'USD', exponent: 2 }).success,
    false,
  );
});

test('a currency outside the ISO 4217 table is rejected', () => {
  const result = moneySchema.safeParse({ amount: 1, currency: 'ZZZ', exponent: 2 });
  assert.equal(result.success, false);
  assert.match(result.error.issues[0]?.message ?? '', /unknown ISO 4217 currency/);
});

test('an unknown key on a Money is rejected', () => {
  assert.equal(
    moneySchema.safeParse({ amount: 1, currency: 'USD', exponent: 2, note: 'x' }).success,
    false,
  );
});

test('a valid fx rate parses and keeps quoted_at when present', () => {
  const rate = fxRateSchema.parse({
    num: 108,
    den: 100,
    from: 'EUR',
    to: 'USD',
    quoted_at: '2026-03-01T00:00:00Z',
  });
  assert.equal(rate.num, 108);
  assert.equal(rate.den, 100);
  assert.equal(rate.quoted_at, '2026-03-01T00:00:00Z');
});

test('a rate with a zero, negative or fractional component is rejected', () => {
  const base = { from: 'EUR', to: 'USD' };
  assert.equal(fxRateSchema.safeParse({ ...base, num: 1, den: 0 }).success, false);
  assert.equal(fxRateSchema.safeParse({ ...base, num: 1, den: -100 }).success, false);
  assert.equal(fxRateSchema.safeParse({ ...base, num: 0, den: 100 }).success, false);
  assert.equal(fxRateSchema.safeParse({ ...base, num: 1.08, den: 1 }).success, false);
});

test('the error from @breaks/money is preserved as the issue cause', () => {
  const result = fxRateSchema.safeParse({ num: 1, den: 0, from: 'EUR', to: 'USD' });
  assert.equal(result.success, false);
  const [issue] = result.error.issues;
  assert.ok(issue?.code === 'custom' && issue.params?.['cause'] instanceof Error);
});

test('a rate quoted between currencies outside the table is rejected', () => {
  assert.equal(
    fxRateSchema.safeParse({ num: 1, den: 1, from: 'EUR', to: 'ZZZ' }).success,
    false,
  );
});

test('an fx leg whose rate does not span its two currencies is rejected', () => {
  const leg = {
    rate: { num: 108, den: 100, from: 'EUR', to: 'USD' },
    presentment: { amount: 1000, currency: 'EUR', exponent: 2 },
    settlement: { amount: 1080, currency: 'USD', exponent: 2 },
  };
  assert.equal(fxLegSchema.safeParse(leg).success, true);

  const wrongEnd = {
    ...leg,
    settlement: { amount: 1080, currency: 'GBP', exponent: 2 },
  };
  const result = fxLegSchema.safeParse(wrongEnd);
  assert.equal(result.success, false);
  assert.match(result.error.issues[0]?.message ?? '', /does not match the settlement currency/);
});
