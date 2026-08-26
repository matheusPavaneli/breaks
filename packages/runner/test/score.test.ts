import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ExpectedInput } from '@breaks/schema';
import { failedResult } from '../report.ts';
import { FALSE_MATCH_WEIGHT, scoreSubmission } from '../score.ts';
import {
  emptyExpectedInput,
  expectedFixture,
  expectedFrom,
  expectedInput,
  perfectSubmission,
  submissionFrom,
  usd,
} from './fixture.ts';

function scoreOf(submission: ExpectedInput) {
  return scoreSubmission(expectedFixture(), submissionFrom(submission));
}

function clone(): ExpectedInput {
  return structuredClone(expectedInput);
}

test('a submission identical to the ground truth scores every match and normalises to 1', () => {
  const score = scoreSubmission(expectedFixture(), perfectSubmission());

  assert.deepEqual(score.counters, {
    true_match: 2,
    false_match: 0,
    missed_match: 0,
    correct_abstain: 1,
    false_abstain: 0,
  });
  assert.equal(score.settlement_score_raw, 2);
  assert.equal(score.settlement_score, 1);
  assert.equal(score.explainability, 1);
});

test('the score is invariant under the order of matches and of ids inside a match', () => {
  const shuffled = clone();
  shuffled.matches = [...shuffled.matches].reverse();
  const grouped: ExpectedInput = {
    matches: [
      {
        a: ['ch_1', 'ch_2'],
        b: ['bt_1'],
        rule: 'group_sum',
        fields_used: ['gross'],
        residual: usd(0),
      },
    ],
    unmatched_a: [],
    unmatched_b: [],
    ambiguous: [],
  };
  const reordered = structuredClone(grouped);
  reordered.matches = [
    {
      a: ['ch_2', 'ch_1'],
      b: ['bt_1'],
      rule: 'group_sum',
      fields_used: ['gross'],
      residual: usd(0),
    },
  ];

  assert.deepEqual(scoreOf(shuffled).counters, scoreSubmission(expectedFixture(), perfectSubmission()).counters);
  assert.equal(scoreSubmission(expectedFixture(), submissionFrom(reordered)).counters.false_match, 1);
  assert.deepEqual(
    scoreSubmission(expectedFixture(), submissionFrom(grouped)).counters,
    scoreSubmission(expectedFixture(), submissionFrom(reordered)).counters,
  );
});

test('one false match costs exactly the weight, and it is a penalty not a credit', () => {
  const withFalseMatch = clone();
  withFalseMatch.matches = [
    ...withFalseMatch.matches,
    { a: ['ch_3'], b: ['bt_7'], rule: 'reference', fields_used: ['references'], residual: usd(0) },
  ];
  withFalseMatch.ambiguous = [];

  const missing = clone();
  missing.matches = missing.matches.slice(0, 1);

  const falseScore = scoreOf(withFalseMatch);
  const missedScore = scoreOf(missing);
  const perfect = scoreSubmission(expectedFixture(), perfectSubmission());

  assert.equal(falseScore.counters.false_match, 1);
  assert.equal(missedScore.counters.missed_match, 1);

  // Claiming a pair that does not exist costs the weight and nothing else: the two real
  // matches are still found, so only the penalty term moves.
  assert.equal(perfect.settlement_score_raw - falseScore.settlement_score_raw, FALSE_MATCH_WEIGHT);

  // Dropping a real pair costs two: the credit not earned plus the missed_match counted.
  assert.equal(perfect.settlement_score_raw - missedScore.settlement_score_raw, 2);

  for (const score of [perfect, falseScore, missedScore]) {
    assert.equal(
      score.settlement_score_raw,
      score.counters.true_match -
        FALSE_MATCH_WEIGHT * score.counters.false_match -
        score.counters.missed_match,
    );
  }

  assert.ok(falseScore.settlement_score_raw < missedScore.settlement_score_raw);
});

test('a grouping that strictly contains the expected one pays both a false match and a missed match', () => {
  const overGrouped = clone();
  overGrouped.matches = [
    {
      a: ['ch_1', 'ch_2'],
      b: ['bt_1'],
      rule: 'group_sum',
      fields_used: ['gross'],
      residual: usd(0),
    },
  ];

  const score = scoreOf(overGrouped);

  assert.equal(score.counters.false_match, 1);
  assert.equal(score.counters.missed_match, 2);
  assert.equal(score.counters.true_match, 0);
  assert.equal(score.settlement_score_raw, 0 - FALSE_MATCH_WEIGHT - 2);
});

test('the right pair with the wrong residual is a false match, not a worse-explained true one', () => {
  const offByOne = clone();
  const [first, ...rest] = offByOne.matches;
  assert.ok(first !== undefined);
  offByOne.matches = [{ ...first, residual: usd(1) }, ...rest];

  const score = scoreOf(offByOne);

  assert.equal(score.counters.false_match, 1);
  assert.equal(score.counters.true_match, 1);
  // The pair was named, so it is not also missed: the claim was wrong, not absent.
  assert.equal(score.counters.missed_match, 0);
});

test('the right pair with the wrong rule stays a true match and only costs explainability', () => {
  const wrongRule = clone();
  const [first, ...rest] = wrongRule.matches;
  assert.ok(first !== undefined);
  wrongRule.matches = [{ ...first, rule: 'fee_leg' }, ...rest];

  const score = scoreOf(wrongRule);

  assert.equal(score.counters.true_match, 2);
  assert.equal(score.counters.false_match, 0);
  assert.equal(score.settlement_score, 1);
  // two matches plus one correct abstention, one of them unjustified
  assert.equal(score.explainability, 2 / 3);
});

test('fields_used is compared as a set, so its order does not move the tie-break', () => {
  const reordered = clone();
  const [first, second] = reordered.matches;
  assert.ok(first !== undefined);
  assert.ok(second !== undefined);
  reordered.matches = [first, { ...second, fields_used: ['occurred_at', 'gross'] }];

  assert.equal(scoreOf(reordered).explainability, 1);
});

test('an abstention with the right sets and the wrong reason is still a correct abstention', () => {
  const otherReason = clone();
  otherReason.ambiguous = [
    { a: ['ch_3'], candidates_b: ['bt_7', 'bt_8'], reason: 'duplicate_indistinguishable' },
  ];

  const score = scoreOf(otherReason);

  assert.equal(score.counters.correct_abstain, 1);
  assert.equal(score.counters.false_abstain, 0);
  // Only the abstention is unjustified now: two true matches out of three correct decisions.
  assert.equal(score.explainability, 2 / 3);
});

test('abstaining where the ground truth holds a match is a false abstain and a missed match', () => {
  const abstained = clone();
  abstained.matches = abstained.matches.slice(1);
  abstained.ambiguous = [
    ...abstained.ambiguous,
    { a: ['ch_1'], candidates_b: ['bt_1'], reason: 'duplicate_indistinguishable' },
  ];

  const score = scoreOf(abstained);

  assert.equal(score.counters.false_abstain, 1);
  assert.equal(score.counters.missed_match, 1);
  assert.equal(score.counters.correct_abstain, 1);
  assert.equal(score.counters.true_match, 1);
});

test('repeating a correct abstention does not buy a second one, or a better tie-break', () => {
  const padded = clone();
  const [ambiguity] = padded.ambiguous;
  assert.ok(ambiguity !== undefined);
  // The submission schema permits this: ids inside `ambiguous` may repeat across entries, so
  // one verdict per id does not refuse a copy. Without a guard in the scorer, a padded output
  // bought correct_abstain and explainability by the copy - a free win on the published
  // tie-break. Ninety-eight copies is the shape of that attack, in miniature.
  padded.ambiguous = Array.from({ length: 99 }, () => structuredClone(ambiguity));
  // ...and the two matches carry the wrong rule, so a real tie-break figure is 2/3.
  padded.matches = padded.matches.map((match) => ({ ...match, rule: 'fee_leg' }));

  const score = scoreOf(padded);

  assert.equal(score.counters.correct_abstain, 1);
  assert.equal(score.counters.false_abstain, 98);
  // Two unjustified matches and one justified abstention out of three correct decisions.
  // Before the guard this read 0.98, bought outright with copies.
  assert.equal(score.explainability, 1 / 3);
});

test('fields_used is compared as a set even when one side repeats a field', () => {
  // `fields_used` carries no distinctness constraint in the schema, so a duplicate is
  // reachable - here on the ground-truth side. Comparing lengths and one-way containment
  // called these two the same set: two known elements against a list of length two.
  const groundTruth = expectedFrom({
    ...emptyExpectedInput,
    matches: [
      { a: ['ch_1'], b: ['bt_1'], rule: 'reference', fields_used: ['gross', 'gross'], residual: usd(0) },
    ],
  });
  const answer = submissionFrom({
    ...emptyExpectedInput,
    matches: [
      {
        a: ['ch_1'],
        b: ['bt_1'],
        rule: 'reference',
        fields_used: ['gross', 'occurred_at'],
        residual: usd(0),
      },
    ],
  });

  const score = scoreSubmission(groundTruth, answer);

  assert.equal(score.counters.true_match, 1);
  assert.equal(score.explainability, 0);
});

test('abstentions stay out of the ordering metric', () => {
  const noAbstention = clone();
  noAbstention.ambiguous = [];

  const withAbstention = scoreSubmission(expectedFixture(), perfectSubmission());
  const without = scoreOf(noAbstention);

  assert.equal(without.counters.correct_abstain, 0);
  assert.equal(without.settlement_score_raw, withAbstention.settlement_score_raw);
});

test('explainability divides by the correct decisions, so a well-justified wrong match cannot raise it', () => {
  const justifiedButWrong = clone();
  justifiedButWrong.matches = [
    ...justifiedButWrong.matches,
    { a: ['ch_3'], b: ['bt_7'], rule: 'reference', fields_used: ['references'], residual: usd(0) },
  ];
  justifiedButWrong.ambiguous = [];

  const score = scoreOf(justifiedButWrong);

  assert.equal(score.counters.false_match, 1);
  assert.equal(score.counters.true_match, 2);
  assert.equal(score.explainability, 1);
  assert.ok(score.settlement_score_raw < 0);
});

test('explainability is absent, not 1, when nothing was decided correctly', () => {
  const allWrong: ExpectedInput = {
    matches: [
      { a: ['ch_1'], b: ['bt_2'], rule: 'reference', fields_used: ['references'], residual: usd(0) },
    ],
    unmatched_a: [],
    unmatched_b: [],
    ambiguous: [],
  };

  const score = scoreOf(allWrong);

  assert.equal(score.counters.true_match, 0);
  assert.equal(score.counters.correct_abstain, 0);
  assert.equal(score.explainability, null);
});

test('a case whose ground truth holds no match normalises to 1 when nothing was claimed', () => {
  // No expected match means no denominator: answering "nothing here" correctly is a full
  // mark, and the only way below it is to have claimed a pair that does not exist.
  const nothingToMatch = expectedFrom(emptyExpectedInput);

  const abstained = scoreSubmission(nothingToMatch, submissionFrom(emptyExpectedInput));
  assert.equal(abstained.settlement_score, 1);

  const claimed = scoreSubmission(
    nothingToMatch,
    submissionFrom({
      ...emptyExpectedInput,
      matches: [
        { a: ['ch_1'], b: ['bt_1'], rule: 'reference', fields_used: ['references'], residual: usd(0) },
      ],
    }),
  );
  assert.equal(claimed.settlement_score, -FALSE_MATCH_WEIGHT);
});

test('the weight is the exported constant and a submission cannot carry its own', () => {
  assert.equal(FALSE_MATCH_WEIGHT, 5);

  const withExtraFields = JSON.parse(JSON.stringify(expectedInput)) as Record<string, unknown> & {
    matches: Record<string, unknown>[];
  };
  withExtraFields['false_match_weight'] = 0;
  const [first] = withExtraFields.matches;
  assert.ok(first !== undefined);
  first['weight'] = 0;
  first['confidence'] = 0.9;

  const score = scoreSubmission(expectedFixture(), submissionFrom(withExtraFields));

  // The unknown keys are dropped by the submission schema rather than read, so the score is
  // the same as the plain perfect answer.
  assert.deepEqual(score, scoreSubmission(expectedFixture(), perfectSubmission()));
});

test('a failed run scores nothing at all', () => {
  const result = failedResult('timing/fixture-case', 'timeout', 'no output within 10 ms', 10);

  assert.equal(result.status, 'failed');
  assert.equal(result.reason, 'timeout');
  assert.deepEqual(result.counters, {
    true_match: 0,
    false_match: 0,
    missed_match: 0,
    correct_abstain: 0,
    false_abstain: 0,
  });
  assert.equal(result.settlement_score, 0);
  assert.equal(result.settlement_score_raw, 0);
  assert.equal(result.explainability, null);
});
