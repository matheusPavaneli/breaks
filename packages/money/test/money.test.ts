import assert from 'node:assert/strict';
import { test } from 'node:test';

import { UnknownCurrencyError } from '../iso4217.ts';
import {
  abs,
  add,
  AmountOverflowError,
  compare,
  CurrencyMismatchError,
  divRoundHalfEven,
  DivisionByZeroError,
  equals,
  format,
  isZero,
  money,
  multiplyByRatio,
  neg,
  NotAnIntegerAmountError,
  sub,
  sum,
  zero,
  type Money,
} from '../money.ts';

test('money rejects an amount that is not a safe integer', () => {
  assert.throws(() => money(10.5, 'USD'), NotAnIntegerAmountError);
  assert.throws(() => money(Number.NaN, 'USD'), NotAnIntegerAmountError);
  assert.throws(() => money(Number.MAX_SAFE_INTEGER + 2, 'USD'), NotAnIntegerAmountError);
});

test('money rejects an unknown currency', () => {
  assert.throws(() => money(100, 'ZZZ'), UnknownCurrencyError);
});

test('the exponent comes from the table, not from the caller', () => {
  assert.equal(money(100, 'JPY').exponent, 0);
  assert.equal(money(100, 'USD').exponent, 2);
  assert.equal(money(100, 'KWD').exponent, 3);
});

test('add and sub work in the minor unit and keep the currency', () => {
  const a = money(1250, 'USD');
  const b = money(99, 'USD');
  assert.deepEqual(add(a, b), money(1349, 'USD'));
  assert.deepEqual(sub(a, b), money(1151, 'USD'));
});

test('add and sub across different currencies throw', () => {
  const usd = money(100, 'USD');
  const eur = money(100, 'EUR');
  assert.throws(() => add(usd, eur), CurrencyMismatchError);
  assert.throws(() => sub(usd, eur), CurrencyMismatchError);
  assert.throws(() => compare(usd, eur), CurrencyMismatchError);
});

test('add detects safe integer overflow', () => {
  const big = money(Number.MAX_SAFE_INTEGER, 'USD');
  assert.throws(() => add(big, money(1, 'USD')), AmountOverflowError);
});

test('neg, abs, isZero and equals', () => {
  assert.deepEqual(neg(money(-500, 'USD')), money(500, 'USD'));
  assert.deepEqual(abs(money(-500, 'USD')), money(500, 'USD'));
  assert.deepEqual(abs(money(500, 'USD')), money(500, 'USD'));
  assert.equal(isZero(zero('USD')), true);
  assert.equal(isZero(money(1, 'USD')), false);
  assert.equal(equals(money(1, 'USD'), money(1, 'USD')), true);
  assert.equal(equals(money(1, 'USD'), money(1, 'EUR')), false);
});

test('compare orders negative, zero and positive', () => {
  assert.equal(compare(money(-1, 'USD'), money(0, 'USD')), -1);
  assert.equal(compare(money(0, 'USD'), money(0, 'USD')), 0);
  assert.equal(compare(money(1, 'USD'), money(0, 'USD')), 1);
});

test('sum requires an explicit currency and handles the empty list', () => {
  assert.deepEqual(sum([], 'JPY'), money(0, 'JPY'));
  assert.deepEqual(sum([money(1, 'USD'), money(2, 'USD'), money(-3, 'USD')], 'USD'), money(0, 'USD'));
  assert.throws(() => sum([money(1, 'EUR')], 'USD'), CurrencyMismatchError);
  assert.throws(() => sum([], 'ZZZ'), UnknownCurrencyError);
});

test('divRoundHalfEven rounds a tie to even, negatives included', () => {
  assert.equal(divRoundHalfEven(5n, 2n), 2n);
  assert.equal(divRoundHalfEven(7n, 2n), 4n);
  assert.equal(divRoundHalfEven(-5n, 2n), -2n);
  assert.equal(divRoundHalfEven(-7n, 2n), -4n);
  assert.equal(divRoundHalfEven(4n, 2n), 2n);
  assert.equal(divRoundHalfEven(8n, 3n), 3n);
  assert.throws(() => divRoundHalfEven(1n, 0n), DivisionByZeroError);
});

test('multiplyByRatio rounds half-even and validates the integers', () => {
  assert.deepEqual(multiplyByRatio(money(101, 'USD'), 1, 2), money(50, 'USD'));
  assert.deepEqual(multiplyByRatio(money(103, 'USD'), 1, 2), money(52, 'USD'));
  assert.throws(() => multiplyByRatio(money(100, 'USD'), 1.5, 2), NotAnIntegerAmountError);
  assert.throws(() => multiplyByRatio(money(100, 'USD'), 1, 2.5), NotAnIntegerAmountError);
});

test('money normalizes -0 so it compares equal to 0', () => {
  assert.equal(Object.is(money(-0, 'USD').amount, -0), false);
  assert.deepStrictEqual(money(-0, 'USD'), money(0, 'USD'));
  assert.deepStrictEqual(sub(money(5, 'USD'), money(5, 'USD')), money(0, 'USD'));
});

test('format derives the exponent from the currency, not from the object', () => {
  const stale = { ...money(1234, 'JPY'), exponent: 2 } as Money;
  assert.equal(format(stale), '1234');
});

test('format builds the string from the digits and the exponent', () => {
  assert.equal(format(money(1234, 'JPY')), '1234');
  assert.equal(format(money(-5, 'USD')), '-0.05');
  assert.equal(format(money(0, 'USD')), '0.00');
  assert.equal(format(money(123456, 'USD')), '1234.56');
  assert.equal(format(money(1, 'KWD')), '0.001');
  assert.equal(format(money(-1234, 'KWD')), '-1.234');
});
