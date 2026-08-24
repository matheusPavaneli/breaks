import { money } from '@breaks/money';
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  ambiguousSchema,
  expectedSchema,
  matchSchema,
  unmatchedSchema,
  type ExpectedInput,
} from '../expected.ts';

const zeroUsd = { amount: 0, currency: 'USD', exponent: 2 } as const;

function validMatch() {
  return {
    a: ['ch_1'],
    b: ['bt_1'],
    rule: 'reference' as const,
    fields_used: ['references'],
    residual: zeroUsd,
  };
}

test('a match carries its justification and its residual as Money', () => {
  const parsed = matchSchema.parse(validMatch());
  assert.deepEqual(parsed.residual, money(0, 'USD'));
  assert.deepEqual(parsed.fields_used, ['references']);
});

test('a match without fields_used does not validate', () => {
  const match: Partial<ReturnType<typeof validMatch>> = validMatch();
  delete match.fields_used;
  assert.equal(matchSchema.safeParse(match).success, false);
});

test('an empty fields_used is a match with no stated basis, and is rejected', () => {
  assert.equal(matchSchema.safeParse({ ...validMatch(), fields_used: [] }).success, false);
});

test('a residual as a bare number is rejected; only Money is accepted', () => {
  assert.equal(matchSchema.safeParse({ ...validMatch(), residual: 0 }).success, false);
  assert.equal(
    matchSchema.safeParse({ ...validMatch(), residual: { amount: 1, currency: 'USD', exponent: 2 } })
      .success,
    true,
  );
});

test('a match with no id on either side is rejected', () => {
  assert.equal(matchSchema.safeParse({ ...validMatch(), a: [] }).success, false);
  assert.equal(matchSchema.safeParse({ ...validMatch(), b: [] }).success, false);
});

test('a rule outside the enum is rejected', () => {
  assert.equal(matchSchema.safeParse({ ...validMatch(), rule: 'fuzzy' }).success, false);
});

test('a grouping match may list several ids on one side', () => {
  const grouped = { ...validMatch(), a: ['ch_1', 'ch_2', 'ch_3'], rule: 'group_sum' as const };
  assert.equal(matchSchema.parse(grouped).a.length, 3);
});

test('an unmatched reason outside the enum is rejected', () => {
  assert.equal(unmatchedSchema.safeParse({ id: 'ch_2', reason: 'not_yet_settled' }).success, true);
  assert.equal(unmatchedSchema.safeParse({ id: 'ch_2', reason: 'dunno' }).success, false);
  assert.equal(
    unmatchedSchema.safeParse({ id: 'ch_2', reason: 'identical_amount_same_minute' }).success,
    false,
  );
});

test('an ambiguity needs at least two candidates', () => {
  const base = { a: ['ch_3'], reason: 'identical_amount_same_minute' as const };
  assert.equal(ambiguousSchema.safeParse({ ...base, candidates_b: ['bt_7', 'bt_8'] }).success, true);
  assert.equal(ambiguousSchema.safeParse({ ...base, candidates_b: ['bt_7'] }).success, false);
  assert.equal(ambiguousSchema.safeParse({ ...base, candidates_b: [] }).success, false);
});

test('an ambiguous reason from the unmatched enum is rejected', () => {
  assert.equal(
    ambiguousSchema.safeParse({
      a: ['ch_3'],
      candidates_b: ['bt_7', 'bt_8'],
      reason: 'not_yet_settled',
    }).success,
    false,
  );
});

test('the four lists are all required, empty being a valid answer for each', () => {
  const empty: ExpectedInput = { matches: [], unmatched_a: [], unmatched_b: [], ambiguous: [] };
  assert.equal(expectedSchema.safeParse(empty).success, true);

  for (const key of ['matches', 'unmatched_a', 'unmatched_b', 'ambiguous'] as const) {
    const partial: Partial<ExpectedInput> = { ...empty };
    delete partial[key];
    assert.equal(expectedSchema.safeParse(partial).success, false, key);
  }
});

test('the example from SPEC.md parses once it carries fields_used and a residual in Money', () => {
  const expected: ExpectedInput = {
    matches: [validMatch()],
    unmatched_a: [{ id: 'ch_2', reason: 'not_yet_settled' }],
    unmatched_b: [],
    ambiguous: [
      {
        a: ['ch_3'],
        candidates_b: ['bt_7', 'bt_8'],
        reason: 'identical_amount_same_minute',
      },
    ],
  };
  assert.equal(expectedSchema.safeParse(expected).success, true);
});

test('an unknown key anywhere in expected.json is rejected', () => {
  assert.equal(
    expectedSchema.safeParse({
      matches: [],
      unmatched_a: [],
      unmatched_b: [],
      ambiguous: [],
      notes: 'x',
    }).success,
    false,
  );
  assert.equal(matchSchema.safeParse({ ...validMatch(), confidence: 0.9 }).success, false);
});
