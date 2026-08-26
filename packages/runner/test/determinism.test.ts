import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ExpectedInput } from '@breaks/schema';
import { functionImplementation } from '../adapter.ts';
import { buildCorpusReport, failedResult, reportHash, runCase, stableStringify } from '../report.ts';
import { caseFixture, expectedInput, seededShuffle, submissionFrom } from './fixture.ts';

// CLAUDE.md invariant 5: the same case, in any order, produces byte-identical output. The
// runner is the first place that can be held to it, and it is held to it here rather than
// asserted in a README.

const SEEDS = [1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144, 233, 377, 610, 987, 1_597];

function shuffledSubmission(seed: number): ExpectedInput {
  const shuffled = structuredClone(expectedInput);
  shuffled.matches = seededShuffle(shuffled.matches, seed).map((match) => ({
    ...match,
    a: seededShuffle(match.a, seed + 1),
    b: seededShuffle(match.b, seed + 2),
  }));
  shuffled.ambiguous = seededShuffle(shuffled.ambiguous, seed + 3).map((entry) => ({
    ...entry,
    a: seededShuffle(entry.a, seed + 4),
    candidates_b: seededShuffle(entry.candidates_b, seed + 5),
  }));
  shuffled.unmatched_a = seededShuffle(shuffled.unmatched_a, seed + 6);
  return shuffled;
}

test('shuffling the records and the answer leaves the report hash byte-identical', async () => {
  const hashes = new Set<string>();

  for (const seed of SEEDS) {
    const base = caseFixture();
    const shuffledCase = {
      ...base,
      records_a: seededShuffle(base.records_a, seed),
      records_b: seededShuffle(base.records_b, seed + 100),
    };

    const answer = shuffledSubmission(seed);
    const result = await runCase(
      shuffledCase,
      functionImplementation(() => submissionFrom(answer)),
      { timeoutMs: 10_000 },
    );

    assert.equal(result.status, 'scored', `seed ${String(seed)} did not score`);
    hashes.add(reportHash(buildCorpusReport([result])));
  }

  assert.equal(hashes.size, 1, `expected one hash across ${String(SEEDS.length)} seeds`);
});

test('the order the corpus was walked in cannot reach the hash', () => {
  const first = failedResult('timing/a-case', 'timeout', 'no output within 10 ms', 10);
  const second = failedResult('fees/b-case', 'exit_nonzero', 'implementation ended with exit code 1', 10);

  assert.equal(
    reportHash(buildCorpusReport([first, second])),
    reportHash(buildCorpusReport([second, first])),
  );
  assert.deepEqual(
    buildCorpusReport([first, second]).cases.map((result) => result.case_id),
    ['fees/b-case', 'timing/a-case'],
  );
});

test('the corpus version is stamped on the report and reaches the hash', () => {
  const result = failedResult('timing/a-case', 'timeout', 'no output within 10 ms', 10);

  // Same results, two corpora. Without the stamp these two runs are byte-identical, and a
  // score measured on twelve cases is indistinguishable from one measured on forty.
  assert.notEqual(
    reportHash(buildCorpusReport([result], '0.1.0')),
    reportHash(buildCorpusReport([result], '0.2.0')),
  );
  assert.equal(buildCorpusReport([result], '0.1.0').corpus_version, '0.1.0');
  // No corpus root to read - a synthetic run - says so rather than inventing a version.
  assert.equal(buildCorpusReport([result]).corpus_version, null);
});

test('a duplicate case id is refused rather than ordered by the walk', () => {
  // `caseIdFromDir` keeps only the last two segments, so corpusA/timing/case-1 and
  // corpusB/timing/case-1 collide. Sorting by a shared key leaves those two in input order -
  // filesystem order - and puts it straight into the hash.
  const left = failedResult('timing/case-1', 'timeout', 'no output within 10 ms', 10);
  const right = failedResult('timing/case-1', 'exit_nonzero', 'implementation ended with exit code 1', 10);

  assert.throws(() => buildCorpusReport([left, right]), /duplicate case id/);
});

test('a case the runner could not deliver is kept out of the score, in its own column', async () => {
  const scored = await runCase(
    caseFixture(),
    functionImplementation(() => submissionFrom(expectedInput)),
    { timeoutMs: 10_000 },
  );
  const errored = failedResult('fees/b-case', 'input_rejected', 'invalid ISO 8601 duration', 10);

  assert.equal(errored.status, 'errored');
  assert.equal(scored.settlement_score, 1);

  const report = buildCorpusReport([scored, errored]);

  assert.equal(report.errored_cases, 1);
  assert.equal(report.failed_cases, 0);
  assert.equal(report.scored_cases, 1);
  // Averaging the corpus defect in would have read 0.5 and put a corpus bug on the
  // participant's leaderboard row.
  assert.equal(report.settlement_score, 1);
  assert.equal(buildCorpusReport([errored]).settlement_score, 0);
});

test('stableStringify sorts keys and leaves arrays alone', () => {
  assert.equal(stableStringify({ b: 1, a: { d: 2, c: 3 } }), '{"a":{"c":3,"d":2},"b":1}');
  assert.equal(stableStringify({ a: 1, b: 2 }), stableStringify({ b: 2, a: 1 }));
  assert.equal(stableStringify([3, 1, 2]), '[3,1,2]');
  assert.notEqual(stableStringify([1, 2]), stableStringify([2, 1]));
  assert.equal(stableStringify({ a: null, b: undefined }), '{"a":null}');
});

test('failures are counted in their own column instead of hiding in the mean', async () => {
  const scored = await runCase(
    caseFixture(),
    functionImplementation(() => submissionFrom(expectedInput)),
    { timeoutMs: 10_000 },
  );
  const failed = failedResult('fees/broken-case', 'timeout', 'no output within 10 ms', 10);

  const report = buildCorpusReport([scored, failed]);

  assert.equal(report.failed_cases, 1);
  assert.equal(report.scored_cases, 1);
  assert.equal(report.errored_cases, 0);
  assert.equal(report.settlement_score, 0.5);
  assert.deepEqual(report.counters, {
    true_match: 2,
    false_match: 0,
    missed_match: 0,
    correct_abstain: 1,
    false_abstain: 0,
  });
  // Only the case that decided something correctly contributes a tie-break figure.
  assert.equal(report.explainability, 1);
});

test('an empty corpus reports zero rather than a division by nothing', () => {
  const report = buildCorpusReport([]);

  assert.equal(report.settlement_score, 0);
  assert.equal(report.failed_cases, 0);
  assert.equal(report.scored_cases, 0);
  assert.equal(report.errored_cases, 0);
  assert.equal(report.explainability, null);
});
