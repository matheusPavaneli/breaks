import { exponentOf, isSupportedCurrency, UnknownCurrencyError, type Currency } from './iso4217.ts';
import {
  AmountOverflowError,
  divRoundHalfEven,
  money,
  NotAnIntegerAmountError,
  type Money,
} from './money.ts';

declare const fxRateBrand: unique symbol;

// Branded for the same reason as Money: a rate parsed out of a case file cannot reach
// convert() without passing fxRate(). convert() still re-checks at runtime, because a
// wrong sign here turns a credit into a debit with no other symptom.
export type FxRate = {
  readonly num: number;
  readonly den: number;
  readonly from: Currency;
  readonly to: Currency;
  readonly quoted_at?: string;
  readonly [fxRateBrand]: 'FxRate';
};

export class InvalidFxRateError extends Error {
  constructor(reason: string) {
    super(`invalid fx rate: ${reason}`);
    this.name = 'InvalidFxRateError';
  }
}

export class FxCurrencyMismatchError extends Error {
  readonly expected: string;
  readonly received: string;

  constructor(expected: string, received: string) {
    super(`rate converts from ${expected}, amount is in ${received}`);
    this.name = 'FxCurrencyMismatchError';
    this.expected = expected;
    this.received = received;
  }
}

export function fxRate(
  num: number,
  den: number,
  from: string,
  to: string,
  quotedAt?: string,
): FxRate {
  if (!isSupportedCurrency(from)) throw new UnknownCurrencyError(from);
  if (!isSupportedCurrency(to)) throw new UnknownCurrencyError(to);
  assertUsableRatio(num, den);

  return (quotedAt === undefined
    ? { num, den, from, to }
    : { num, den, from, to, quoted_at: quotedAt }) as FxRate;
}

// A zero numerator is not a rate: it silently wipes the value of the leg. The identity
// case ("no conversion happened") is identityRate, which is 1/1.
function assertUsableRatio(num: number, den: number): void {
  if (!Number.isSafeInteger(num)) throw new NotAnIntegerAmountError(num);
  if (!Number.isSafeInteger(den)) throw new NotAnIntegerAmountError(den);
  if (num <= 0) throw new InvalidFxRateError('num must be greater than zero');
  if (den <= 0) throw new InvalidFxRateError('den must be greater than zero');
}

export function identityRate(currency: string): FxRate {
  return fxRate(1, 1, currency, currency);
}

export function convert(value: Money, rate: FxRate): Money {
  assertUsableRatio(rate.num, rate.den);
  if (value.currency !== rate.from) {
    throw new FxCurrencyMismatchError(rate.from, value.currency);
  }
  const exponentDelta = exponentOf(rate.to) - exponentOf(rate.from);
  const scale = 10n ** BigInt(Math.abs(exponentDelta));

  const base = BigInt(value.amount) * BigInt(rate.num);
  const numerator = exponentDelta >= 0 ? base * scale : base;
  const denominator = exponentDelta >= 0 ? BigInt(rate.den) : BigInt(rate.den) * scale;

  const converted = divRoundHalfEven(numerator, denominator);
  if (converted > BigInt(Number.MAX_SAFE_INTEGER) || converted < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new AmountOverflowError(converted);
  }
  return money(Number(converted), rate.to);
}
