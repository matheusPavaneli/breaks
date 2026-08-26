import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { equals, money } from '@breaks/money';
import type { RunnerOutput } from '@breaks/schema';
import { functionImplementation } from '../adapter.ts';
import { processImplementation } from '../protocol.ts';
import { runCase } from '../report.ts';
import { caseFixture, expectedInput, perfectSubmission, submissionFrom } from './fixture.ts';

// The adapter exists so the reference engine can be run without a process, and it earns that
// only if it is no gentler than a process. Every test here is a comparison against the same
// answer given the other way.

test('the same answer scores the same in-process as it does out of one', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'breaks-adapter-'));
  const script = join(dir, 'impl.mjs');
  await writeFile(
    script,
    `
      let input = '';
      process.stdin.setEncoding('utf8');
      process.stdin.on('data', (chunk) => { input += chunk; });
      process.stdin.on('end', () => {
        JSON.parse(input);
        process.stdout.write(${JSON.stringify(JSON.stringify(expectedInput))} + '\\n');
      });
    `,
    'utf8',
  );

  try {
    const spawned = await runCase(caseFixture(), processImplementation(process.execPath, [script]), {
      timeoutMs: 10_000,
    });
    const inProcess = await runCase(
      caseFixture(),
      functionImplementation(() => perfectSubmission()),
      { timeoutMs: 10_000 },
    );

    assert.deepEqual(inProcess.counters, spawned.counters);
    assert.equal(inProcess.settlement_score, spawned.settlement_score);
    assert.equal(inProcess.explainability, spawned.explainability);
    assert.equal(inProcess.status, 'scored');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('the wrapped function is handed the case as money, not as JSON that looks like it', async () => {
  let seen: { case_id: string; records: number; sameCurrency: boolean } | undefined;

  const result = await runCase(
    caseFixture(),
    functionImplementation((input) => {
      const first = input.records_a[0];
      assert.ok(first !== undefined);
      seen = {
        case_id: input.case_id,
        records: input.records_a.length,
        // equals() is from @breaks/money and asserts on branded values: it passing here is
        // what says the leg arrived minted rather than as an object literal.
        sameCurrency: equals(first.gross, money(first.gross.amount, first.gross.currency)),
      };
      return perfectSubmission();
    }),
    { timeoutMs: 10_000 },
  );

  assert.equal(result.status, 'scored');
  assert.equal(seen?.case_id, 'timing/fixture-case');
  assert.equal(seen?.records, 4);
  assert.equal(seen?.sameCurrency, true);
});

test('a function that throws is a failed run, not a thrown runner', async () => {
  const result = await runCase(
    caseFixture(),
    functionImplementation(() => {
      throw new Error('no rule matched');
    }),
    { timeoutMs: 10_000 },
  );

  assert.equal(result.status, 'failed');
  assert.equal(result.reason, 'exit_nonzero');
  assert.match(result.detail, /no rule matched/);
  assert.equal(result.settlement_score, 0);
});

test('a case the adapter cannot serialise errors the case, it does not reject the run', async () => {
  const broken = caseFixture();
  const policy = structuredClone(broken.policy) as { time_window: { after: string } };
  policy.time_window.after = 'P1M';

  const result = await runCase(
    { ...broken, policy: policy as typeof broken.policy },
    functionImplementation(() => perfectSubmission()),
    { timeoutMs: 10_000 },
  );

  assert.equal(result.status, 'errored');
  assert.equal(result.reason, 'input_rejected');
});

test('a function that rejects is a failed run too', async () => {
  const result = await runCase(
    caseFixture(),
    functionImplementation(() => Promise.reject(new Error('engine unavailable'))),
    { timeoutMs: 10_000 },
  );

  assert.equal(result.status, 'failed');
  assert.equal(result.reason, 'exit_nonzero');
});

test('a function that overruns the budget is a timeout', async () => {
  const result = await runCase(
    caseFixture(),
    functionImplementation(
      () =>
        new Promise<RunnerOutput>((resolve) => {
          const timer = setTimeout(() => {
            resolve(perfectSubmission());
          }, 5_000);
          // Nothing here holds the test process open once the runner has given up on it.
          timer.unref();
        }),
    ),
    { timeoutMs: 200 },
  );

  assert.equal(result.status, 'failed');
  assert.equal(result.reason, 'timeout');
});

test('an in-process result gets no laxer treatment than a printed one', async () => {
  const invalid = await runCase(
    caseFixture(),
    functionImplementation(() =>
      submissionFrom({
        ...expectedInput,
        matches: [],
        unmatched_a: [],
        unmatched_b: [],
        ambiguous: [{ a: ['ch_3'], candidates_b: ['bt_7', 'bt_8'], reason: 'fx_rounding_tie' }],
      }),
    ),
    { timeoutMs: 10_000 },
  );

  // A valid submission with the wrong answer is scored, not rejected: the schema judges shape,
  // the score judges the answer.
  assert.equal(invalid.status, 'scored');
  assert.equal(invalid.counters.missed_match, 2);
  assert.equal(invalid.counters.correct_abstain, 1);
});
