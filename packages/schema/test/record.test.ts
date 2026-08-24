import assert from 'node:assert/strict';
import { test } from 'node:test';

import { refSchema, settlementRecordSchema, type SettlementRecordInput } from '../record.ts';

function validRecord(): SettlementRecordInput {
  return {
    id: 'ch_1',
    source: 'psp',
    source_system: 'stripe',
    version: 1,
    occurred_at: '2026-01-31T23:14:02-03:00',
    settled_at: '2026-02-02T09:00:00Z',
    gross: { amount: 10000, currency: 'USD', exponent: 2 },
    fee: { amount: -320, currency: 'USD', exponent: 2 },
    net: { amount: 9680, currency: 'USD', exponent: 2 },
    fx: null,
    category: 'charge',
    status: 'available',
    references: [{ type: 'order', id: 'ord_9' }],
    metadata: { region: 'br' },
  };
}

test('a complete record parses and its money fields come back as Money', () => {
  const parsed = settlementRecordSchema.parse(validRecord());
  assert.equal(parsed.gross.currency, 'USD');
  assert.equal(parsed.gross.exponent, 2);
  assert.equal(parsed.fee?.amount, -320);
});

test('occurred_at without an offset is rejected', () => {
  const result = settlementRecordSchema.safeParse({
    ...validRecord(),
    occurred_at: '2026-01-31T23:14:02',
  });
  assert.equal(result.success, false);
});

test('settled_at is nullable but not optional', () => {
  assert.equal(
    settlementRecordSchema.safeParse({ ...validRecord(), settled_at: null }).success,
    true,
  );

  const record = validRecord();
  delete (record as Partial<SettlementRecordInput>).settled_at;
  assert.equal(settlementRecordSchema.safeParse(record).success, false);
});

test('a fee or net of null is accepted: unreported is not zero', () => {
  const parsed = settlementRecordSchema.parse({ ...validRecord(), fee: null, net: null });
  assert.equal(parsed.fee, null);
  assert.equal(parsed.net, null);
});

test('a category or status outside the enum is rejected', () => {
  assert.equal(
    settlementRecordSchema.safeParse({ ...validRecord(), category: 'chargeback' }).success,
    false,
  );
  assert.equal(
    settlementRecordSchema.safeParse({ ...validRecord(), status: 'settled' }).success,
    false,
  );
});

test('a version below 1 is rejected', () => {
  assert.equal(settlementRecordSchema.safeParse({ ...validRecord(), version: 0 }).success, false);
});

test('an unknown key on the record is rejected rather than ignored', () => {
  const result = settlementRecordSchema.safeParse({ ...validRecord(), amount_usd: 100 });
  assert.equal(result.success, false);
});

test('a reference with an unknown type is rejected', () => {
  assert.equal(refSchema.safeParse({ type: 'settlement', id: 'x' }).success, false);
  assert.equal(refSchema.safeParse({ type: 'charge', id: '' }).success, false);
  assert.equal(refSchema.safeParse({ type: 'charge', id: 'ch_1' }).success, true);
});

test('metadata values must be strings: a number would arrive parsed differently per language', () => {
  assert.equal(
    settlementRecordSchema.safeParse({ ...validRecord(), metadata: { attempt: 2 } }).success,
    false,
  );
});

test('an fx leg on the record is validated as a whole', () => {
  const withFx = {
    ...validRecord(),
    gross: { amount: 1000, currency: 'EUR', exponent: 2 },
    fee: null,
    net: null,
    fx: {
      rate: { num: 108, den: 100, from: 'EUR', to: 'USD' },
      presentment: { amount: 1000, currency: 'EUR', exponent: 2 },
      settlement: { amount: 1080, currency: 'USD', exponent: 2 },
    },
  };
  assert.equal(settlementRecordSchema.safeParse(withFx).success, true);

  const brokenFx = {
    ...withFx,
    fx: { ...withFx.fx, settlement: { amount: 1080, currency: 'GBP', exponent: 2 } },
  };
  assert.equal(settlementRecordSchema.safeParse(brokenFx).success, false);
});
