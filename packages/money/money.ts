import {
  exponentOf,
  isSupportedCurrency,
  UnknownCurrencyError,
  type Currency,
  type MinorUnitExponent,
} from './iso4217.ts';

declare const moneyBrand: unique symbol;

// Branded: only money() can mint a Money. A plain object literal from JSON.parse does not
// type-check as one, so packages/schema is forced through the factory and its validation.
export type Money = {
  readonly amount: number;
  readonly currency: Currency;
  readonly exponent: MinorUnitExponent;
  readonly [moneyBrand]: 'Money';
};

export class NotAnIntegerAmountError extends Error {
  readonly amount: number;

  constructor(amount: number) {
    super(`monetary amount must be a safe integer in the currency minor unit: ${String(amount)}`);
    this.name = 'NotAnIntegerAmountError';
    this.amount = amount;
  }
}

export class AmountOverflowError extends Error {
  constructor(value: bigint) {
    super(`result outside the safe integer range: ${value.toString()}`);
    this.name = 'AmountOverflowError';
  }
}

export class CurrencyMismatchError extends Error {
  readonly left: string;
  readonly right: string;

  constructor(left: string, right: string) {
    super(`operation across different currencies: ${left} and ${right}`);
    this.name = 'CurrencyMismatchError';
    this.left = left;
    this.right = right;
  }
}

export class DivisionByZeroError extends Error {
  constructor() {
    super('denominator is zero');
    this.name = 'DivisionByZeroError';
  }
}

export function money(amount: number, currency: string): Money {
  if (!isSupportedCurrency(currency)) {
    throw new UnknownCurrencyError(currency);
  }
  if (!Number.isSafeInteger(amount)) {
    throw new NotAnIntegerAmountError(amount);
  }
  // -0 normalized to 0: JSON.parse('-0') yields -0, and Object.is(-0, 0) is false, which
  // would make a byte-identical result compare unequal in the runner.
  const normalized = amount === 0 ? 0 : amount;
  return { amount: normalized, currency, exponent: exponentOf(currency) } as Money;
}

export function zero(currency: string): Money {
  return money(0, currency);
}

export function assertSameCurrency(a: Money, b: Money): void {
  if (a.currency !== b.currency) {
    throw new CurrencyMismatchError(a.currency, b.currency);
  }
}

function fromBigInt(value: bigint, currency: Currency): Money {
  if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new AmountOverflowError(value);
  }
  return money(Number(value), currency);
}

export function add(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return fromBigInt(BigInt(a.amount) + BigInt(b.amount), a.currency);
}

export function sub(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return fromBigInt(BigInt(a.amount) - BigInt(b.amount), a.currency);
}

export function neg(a: Money): Money {
  return fromBigInt(-BigInt(a.amount), a.currency);
}

export function abs(a: Money): Money {
  const value = BigInt(a.amount);
  return fromBigInt(value < 0n ? -value : value, a.currency);
}

export function isZero(a: Money): boolean {
  return a.amount === 0;
}

export function compare(a: Money, b: Money): -1 | 0 | 1 {
  assertSameCurrency(a, b);
  if (a.amount < b.amount) return -1;
  if (a.amount > b.amount) return 1;
  return 0;
}

export function equals(a: Money, b: Money): boolean {
  return a.currency === b.currency && a.amount === b.amount;
}

export function sum(values: readonly Money[], currency: string): Money {
  if (!isSupportedCurrency(currency)) {
    throw new UnknownCurrencyError(currency);
  }
  const total = values.reduce((acc, value) => {
    if (value.currency !== currency) {
      throw new CurrencyMismatchError(currency, value.currency);
    }
    return acc + BigInt(value.amount);
  }, 0n);
  return fromBigInt(total, currency);
}

export function divRoundHalfEven(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) {
    throw new DivisionByZeroError();
  }
  const negative = numerator < 0n !== denominator < 0n;
  const n = numerator < 0n ? -numerator : numerator;
  const d = denominator < 0n ? -denominator : denominator;

  const quotient = n / d;
  const remainder = n % d;
  const twice = remainder * 2n;

  let rounded = quotient;
  if (twice > d || (twice === d && quotient % 2n !== 0n)) {
    rounded = quotient + 1n;
  }
  return negative ? -rounded : rounded;
}

export function multiplyByRatio(value: Money, num: number, den: number): Money {
  if (!Number.isSafeInteger(num) || !Number.isSafeInteger(den)) {
    throw new NotAnIntegerAmountError(Number.isSafeInteger(num) ? den : num);
  }
  const scaled = divRoundHalfEven(BigInt(value.amount) * BigInt(num), BigInt(den));
  return fromBigInt(scaled, value.currency);
}

export function format(value: Money): string {
  // The exponent comes from the table, never from the object: a stale exponent carried in
  // from a case file must not change how the amount reads.
  const exponent = exponentOf(value.currency);
  const sign = value.amount < 0 ? '-' : '';
  const digits = (value.amount < 0 ? -BigInt(value.amount) : BigInt(value.amount)).toString();
  if (exponent === 0) {
    return `${sign}${digits}`;
  }
  const padded = digits.padStart(exponent + 1, '0');
  const whole = padded.slice(0, padded.length - exponent);
  const fraction = padded.slice(padded.length - exponent);
  return `${sign}${whole}.${fraction}`;
}
