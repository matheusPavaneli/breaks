import { money } from '@breaks/money';
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  ambiguousSchema,
  expectedSchema,
  matchSchema,
  submissionSchema,
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

test('a repeated id in a match is rejected: a list of ids is a set', () => {
  assert.equal(matchSchema.safeParse({ ...validMatch(), a: ['ch_1', 'ch_1'] }).success, false);
  assert.equal(matchSchema.safeParse({ ...validMatch(), b: ['bt_1', 'bt_1'] }).success, false);
  assert.equal(
    matchSchema.safeParse({ ...validMatch(), a: ['ch_1', 'ch_2'], rule: 'group_sum' }).success,
    true,
  );
});

test('padding candidates_b with a repeat does not buy a second candidate', () => {
  const padded = {
    a: ['ch_3'],
    candidates_b: ['bt_7', 'bt_7'],
    reason: 'identical_amount_same_minute' as const,
  };
  assert.equal(ambiguousSchema.safeParse(padded).success, false);
});

test('two records contending for one counterpart is a valid ambiguity', () => {
  // Case E1 read from the other side: two charges, one bank record. A shape that only
  // allowed one A against several B could not express it.
  const twoAgainstOne = {
    a: ['ch_1', 'ch_2'],
    candidates_b: ['bt_1'],
    reason: 'identical_amount_same_minute' as const,
  };
  assert.equal(ambiguousSchema.safeParse(twoAgainstOne).success, true);
});

test('one against one is not an ambiguity', () => {
  const result = ambiguousSchema.safeParse({
    a: ['ch_3'],
    candidates_b: ['bt_7'],
    reason: 'identical_amount_same_minute',
  });
  assert.equal(result.success, false);
  assert.match(result.error.issues[0]?.message ?? '', /at least two contenders/);
});

test('the submission shape ignores an unknown key the corpus shape rejects', () => {
  const output = {
    matches: [{ ...validMatch(), confidence: 0.9 }],
    unmatched_a: [],
    unmatched_b: [],
    ambiguous: [],
    engine_version: '1.2.3',
  };
  assert.equal(expectedSchema.safeParse(output).success, false);

  const parsed = submissionSchema.parse(output);
  assert.equal(Object.hasOwn(parsed, 'engine_version'), false);
  assert.equal(Object.hasOwn(parsed.matches[0] ?? {}, 'confidence'), false);
});

test('the submission shape still enforces every invariant that carries meaning', () => {
  const noJustification = {
    matches: [{ a: ['ch_1'], b: ['bt_1'], rule: 'reference', residual: zeroUsd }],
    unmatched_a: [],
    unmatched_b: [],
    ambiguous: [],
  };
  assert.equal(submissionSchema.safeParse(noJustification).success, false);

  const badReason = {
    matches: [],
    unmatched_a: [{ id: 'ch_2', reason: 'dunno' }],
    unmatched_b: [],
    ambiguous: [],
  };
  assert.equal(submissionSchema.safeParse(badReason).success, false);
});

test('an id cannot be matched twice or matched and unmatched at once', () => {
  const doubleMatched = {
    matches: [validMatch(), { ...validMatch(), b: ['bt_2'] }],
    unmatched_a: [],
    unmatched_b: [],
    ambiguous: [],
  };
  const result = expectedSchema.safeParse(doubleMatched);
  assert.equal(result.success, false);
  assert.match(result.error.issues[0]?.message ?? '', /resolved more than once/);

  const matchedAndUnmatched = {
    matches: [validMatch()],
    unmatched_a: [{ id: 'ch_1', reason: 'not_yet_settled' as const }],
    unmatched_b: [],
    ambiguous: [],
  };
  assert.equal(expectedSchema.safeParse(matchedAndUnmatched).success, false);
});

test('an id cannot be resolved and ambiguous at the same time', () => {
  const both = {
    matches: [validMatch()],
    unmatched_a: [],
    unmatched_b: [],
    ambiguous: [
      {
        a: ['ch_1'],
        candidates_b: ['bt_7', 'bt_8'],
        reason: 'identical_amount_same_minute' as const,
      },
    ],
  };
  const result = expectedSchema.safeParse(both);
  assert.equal(result.success, false);
  assert.match(result.error.issues[0]?.message ?? '', /both resolved and listed as ambiguous/);
});

test('a candidate may appear in more than one ambiguity', () => {
  // Two charges each contending with bt_2, against different other candidates. Nothing is
  // resolved here, so there is no double count to prevent.
  const shared = {
    matches: [],
    unmatched_a: [],
    unmatched_b: [],
    ambiguous: [
      { a: ['ch_1'], candidates_b: ['bt_1', 'bt_2'], reason: 'fx_rounding_tie' as const },
      { a: ['ch_2'], candidates_b: ['bt_2', 'bt_3'], reason: 'fx_rounding_tie' as const },
    ],
  };
  assert.equal(expectedSchema.safeParse(shared).success, true);
});

test('a submission may decorate its residual without losing the case', () => {
  const decorated = {
    matches: [
      {
        ...validMatch(),
        residual: { amount: 0, currency: 'USD', exponent: 2, formatted: '0.00' },
      },
    ],
    unmatched_a: [],
    unmatched_b: [],
    ambiguous: [],
  };
  assert.equal(expectedSchema.safeParse(decorated).success, false);

  const parsed = submissionSchema.parse(decorated);
  assert.deepEqual(parsed.matches[0]?.residual, money(0, 'USD'));
});

test('a submission that abstains one against one is scored, not rejected', () => {
  // Wrong answer, and the score names it: false_abstain. Rejecting the whole stdout line
  // would throw away every correct match in the same case.
  const abstained = {
    matches: [validMatch()],
    unmatched_a: [],
    unmatched_b: [],
    ambiguous: [
      { a: ['ch_9'], candidates_b: ['bt_9'], reason: 'out_of_order_events' as const },
    ],
  };
  assert.equal(submissionSchema.safeParse(abstained).success, true);
  assert.equal(expectedSchema.safeParse(abstained).success, false);
});

test('a submission is still held to one verdict per id', () => {
  const doubleMatched = {
    matches: [validMatch(), { ...validMatch(), b: ['bt_2'] }],
    unmatched_a: [],
    unmatched_b: [],
    ambiguous: [],
  };
  assert.equal(submissionSchema.safeParse(doubleMatched).success, false);
});
