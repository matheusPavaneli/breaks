import assert from 'node:assert/strict';
import { test } from 'node:test';

import { exponentOf, isSupportedCurrency, UnknownCurrencyError } from '../iso4217.ts';

test('exponent 0 for currencies with no subunit', () => {
  assert.equal(exponentOf('JPY'), 0);
  assert.equal(exponentOf('KRW'), 0);
});

test('exponent 2 for cent-based currencies', () => {
  assert.equal(exponentOf('USD'), 2);
  assert.equal(exponentOf('BRL'), 2);
});

test('exponent 3 for thousandth-based currencies', () => {
  assert.equal(exponentOf('KWD'), 3);
  assert.equal(exponentOf('BHD'), 3);
  assert.equal(exponentOf('JOD'), 3);
});

test('a currency outside the table throws instead of assuming 2', () => {
  assert.throws(() => exponentOf('XXX'), UnknownCurrencyError);
  assert.throws(() => exponentOf('MGA'), UnknownCurrencyError);
  assert.throws(() => exponentOf('usd'), UnknownCurrencyError);
});

test('isSupportedCurrency tells known from unknown', () => {
  assert.equal(isSupportedCurrency('EUR'), true);
  assert.equal(isSupportedCurrency('ZZZ'), false);
});
