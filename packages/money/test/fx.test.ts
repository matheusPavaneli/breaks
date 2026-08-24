import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  convert,
  FxCurrencyMismatchError,
  fxRate,
  identityRate,
  InvalidFxRateError,
  type FxRate,
} from '../fx.ts';
import { UnknownCurrencyError } from '../iso4217.ts';
import { add, money, NotAnIntegerAmountError, sum } from '../money.ts';

test('fxRate validates numerator, denominator and currencies', () => {
  assert.throws(() => fxRate(1, 0, 'USD', 'EUR'), InvalidFxRateError);
  assert.throws(() => fxRate(1, -2, 'USD', 'EUR'), InvalidFxRateError);
  assert.throws(() => fxRate(-1, 2, 'USD', 'EUR'), InvalidFxRateError);
  assert.throws(() => fxRate(1.5, 2, 'USD', 'EUR'), NotAnIntegerAmountError);
  assert.throws(() => fxRate(1, 2.5, 'USD', 'EUR'), NotAnIntegerAmountError);
  assert.throws(() => fxRate(1, 2, 'ZZZ', 'EUR'), UnknownCurrencyError);
  assert.throws(() => fxRate(1, 2, 'USD', 'ZZZ'), UnknownCurrencyError);
});

test('quoted_at is present only when supplied', () => {
  assert.equal('quoted_at' in fxRate(1, 2, 'USD', 'EUR'), false);
  assert.equal(fxRate(1, 2, 'USD', 'EUR', '2026-08-24T00:00:00Z').quoted_at, '2026-08-24T00:00:00Z');
});

test('convert requires the amount to be in the rate source currency', () => {
  const rate = fxRate(1, 2, 'USD', 'EUR');
  assert.throws(() => convert(money(100, 'EUR'), rate), FxCurrencyMismatchError);
});

test('convert from exponent 2 to 0 (USD -> JPY)', () => {
  const rate = fxRate(15025, 100, 'USD', 'JPY');
  assert.deepEqual(convert(money(1000, 'USD'), rate), money(1502, 'JPY'));
});

test('convert from exponent 0 to 2 (JPY -> USD)', () => {
  const rate = fxRate(1, 150, 'JPY', 'USD');
  assert.deepEqual(convert(money(1000, 'JPY'), rate), money(667, 'USD'));
});

test('an exact tie rounds to even, negative amounts included', () => {
  const rate = fxRate(1, 2, 'USD', 'EUR');
  assert.deepEqual(convert(money(5, 'USD'), rate), money(2, 'EUR'));
  assert.deepEqual(convert(money(7, 'USD'), rate), money(4, 'EUR'));
  assert.deepEqual(convert(money(-5, 'USD'), rate), money(-2, 'EUR'));
  assert.deepEqual(convert(money(-7, 'USD'), rate), money(-4, 'EUR'));
});

test('rounding after conversion differs from rounding before', () => {
  const rate = fxRate(1, 2, 'USD', 'EUR');
  const parts = [money(5, 'USD'), money(5, 'USD')];

  const roundedBefore = sum(parts.map((part) => convert(part, rate)), 'EUR');
  const roundedAfter = convert(parts.reduce(add), rate);

  assert.deepEqual(roundedBefore, money(4, 'EUR'));
  assert.deepEqual(roundedAfter, money(5, 'EUR'));
});

test('fxRate rejects a zero numerator, which would wipe the leg', () => {
  assert.throws(() => fxRate(0, 1, 'USD', 'EUR'), InvalidFxRateError);
});

test('convert re-validates a rate that bypassed the factory', () => {
  const forged = (num: number, den: number): FxRate =>
    ({ num, den, from: 'USD', to: 'USD' }) as unknown as FxRate;

  // A negative denominator would flip the sign of the money: credit turned into debit.
  assert.throws(() => convert(money(1000, 'USD'), forged(1, -2)), InvalidFxRateError);
  assert.throws(() => convert(money(1000, 'USD'), forged(0, 1)), InvalidFxRateError);
  assert.throws(() => convert(money(1000, 'USD'), forged(1, 0)), InvalidFxRateError);
  assert.throws(() => convert(money(1000, 'USD'), forged(1.5, 1)), NotAnIntegerAmountError);
});

test('identityRate leaves the amount unchanged', () => {
  assert.deepEqual(convert(money(1234, 'BRL'), identityRate('BRL')), money(1234, 'BRL'));
});
