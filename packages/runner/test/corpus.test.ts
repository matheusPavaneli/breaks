import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { CaseFileError } from '../case.ts';
import { findCaseDirs, loadCorpus, readCorpusVersion } from '../corpus.ts';
import { caseFiles } from './fixture.ts';

const CORPUS_ROOT = join(import.meta.dirname, '..', '..', '..', 'corpus');

async function writeCorpus(
  cases: readonly (readonly [string, Record<string, string>?])[],
  extras: readonly string[] = [],
): Promise<{ root: string; cleanup: () => Promise<void> }> {
  const root = await mkdtemp(join(tmpdir(), 'breaks-corpus-'));

  for (const [id, overrides] of cases) {
    const dir = join(root, ...id.split('/'));
    await mkdir(dir, { recursive: true });
    const files = { ...caseFiles(), 'README.md': '# fixture case\n', ...overrides };
    for (const [name, contents] of Object.entries(files)) {
      await writeFile(join(dir, name), contents, 'utf8');
    }
  }
  for (const path of extras) {
    await mkdir(join(root, ...path.split('/')), { recursive: true });
  }
  await writeFile(join(root, 'VERSION'), '9.9.9\n', 'utf8');

  return { root, cleanup: () => rm(root, { recursive: true, force: true }) };
}

test('cases come back ordered by case id, not in the order the filesystem lists them', async () => {
  const { root, cleanup } = await writeCorpus([
    ['timing/zulu'],
    ['adversarial/alpha'],
    ['timing/alpha'],
    ['fx/mike'],
  ]);
  try {
    const loaded = (await loadCorpus(root)).cases;

    assert.deepEqual(
      loaded.map((corpusCase) => corpusCase.case_id),
      ['adversarial/alpha', 'fx/mike', 'timing/alpha', 'timing/zulu'],
    );
  } finally {
    await cleanup();
  }
});

test('a directory with none of the case files is skipped rather than failing the corpus', async () => {
  const { root, cleanup } = await writeCorpus(
    [['timing/real-case']],
    ['timing/empty-slot', 'grouping', 'timing/real-case/notes'],
  );
  try {
    await writeFile(join(root, 'VERSION'), '0.1.0\n', 'utf8');

    const dirs = await findCaseDirs(root);

    assert.deepEqual(dirs, [join(root, 'timing', 'real-case')]);
  } finally {
    await cleanup();
  }
});

// This test used to assert the opposite - that a directory holding only some of the four
// files was skipped like an empty one. That encoded the bug: rename `expected.json` in a case
// and the corpus would load one case short, with no error, and every per-case mean would be
// computed over a denominator nobody chose.
test('a half-written case fails the corpus instead of quietly disappearing from it', async () => {
  const { root, cleanup } = await writeCorpus([['timing/real-case'], ['timing/half-written']]);
  try {
    await rm(join(root, 'timing', 'half-written', 'expected.json'));

    await assert.rejects(findCaseDirs(root), (error: unknown) => {
      assert.ok(error instanceof CaseFileError);
      // One file name, never a comma-joined list: `withCaseId` slices the message by its
      // length, and every consumer reads it as a path.
      assert.equal(error.file, 'expected.json');
      assert.match(error.message, /timing\/half-written/);
      return true;
    });
  } finally {
    await cleanup();
  }
});

test('a case with no README is refused: without the narrative there is no case', async () => {
  const { root, cleanup } = await writeCorpus([['timing/real-case'], ['timing/no-narrative']]);
  try {
    await rm(join(root, 'timing', 'no-narrative', 'README.md'));

    await assert.rejects(findCaseDirs(root), (error: unknown) => {
      assert.ok(error instanceof CaseFileError);
      assert.equal(error.file, 'README.md');
      assert.match(error.message, /timing\/no-narrative/);
      return true;
    });
  } finally {
    await cleanup();
  }
});

test('a malformed case fails the load, naming the case and the file inside it', async () => {
  const { root, cleanup } = await writeCorpus([
    ['timing/good-case'],
    ['timing/bad-case', { 'policy.json': '{"amount_tolerance": {}}' }],
  ]);
  try {
    await assert.rejects(loadCorpus(root), (error: unknown) => {
      assert.ok(error instanceof CaseFileError);
      assert.equal(error.file, 'timing/bad-case/policy.json');
      // The original error is kept, not replaced: the field paths that failed are what makes
      // the message actionable, and the cause chain still reaches zod's own issue list.
      assert.ok(error.paths.length > 0);
      assert.ok(error.cause instanceof CaseFileError);
      return true;
    });
  } finally {
    await cleanup();
  }
});

test('the corpus version is read from VERSION, and a root without a usable one is refused', async () => {
  const { root, cleanup } = await writeCorpus([['timing/real-case']]);
  try {
    await rm(join(root, 'VERSION'));
    await assert.rejects(readCorpusVersion(root), (error: unknown) => {
      assert.ok(error instanceof CaseFileError);
      assert.equal(error.file, 'VERSION');
      return true;
    });

    await writeFile(join(root, 'VERSION'), 'v0.1\n', 'utf8');
    await assert.rejects(readCorpusVersion(root), /not a three-part version/);

    await writeFile(join(root, 'VERSION'), '0.1.0\n', 'utf8');
    assert.equal(await readCorpusVersion(root), '0.1.0');
  } finally {
    await cleanup();
  }
});

test('a root with no case directory is refused instead of scoring an empty run', async () => {
  // Categories, and nothing written in them yet. Pointing the runner at a tree like this - or
  // at the repository root - used to return zero cases and publish a scored run of zero.
  const { root, cleanup } = await writeCorpus([], ['timing', 'grouping']);
  try {
    await assert.rejects(loadCorpus(root), (error: unknown) => {
      assert.ok(error instanceof CaseFileError);
      assert.match(error.message, /holds no case directory/);
      return true;
    });
  } finally {
    await cleanup();
  }
});

test('a case buried one level too deep is refused, not walked past', async () => {
  const { root, cleanup } = await writeCorpus([['timing/real-case'], ['timing/nested/buried']]);
  try {
    await assert.rejects(findCaseDirs(root), (error: unknown) => {
      assert.ok(error instanceof CaseFileError);
      assert.match(error.message, /below <category>\/<slug>/);
      assert.match(error.file, /buried/);
      return true;
    });
  } finally {
    await cleanup();
  }
});

test('a case placed above <category>/<slug> is refused too', async () => {
  const { root, cleanup } = await writeCorpus([['timing/real-case'], ['stray-case']]);
  try {
    await assert.rejects(findCaseDirs(root), (error: unknown) => {
      assert.ok(error instanceof CaseFileError);
      assert.match(error.message, /above <category>\/<slug>/);
      return true;
    });
  } finally {
    await cleanup();
  }
});

test('a path that cannot be listed says which path, not just an errno', async () => {
  await assert.rejects(loadCorpus(join(tmpdir(), 'breaks-corpus-does-not-exist')), (error: unknown) => {
    assert.ok(error instanceof CaseFileError);
    assert.match(error.message, /cannot be listed while walking the corpus/);
    return true;
  });
});

test('a case reached through a symlinked directory is part of the corpus', async () => {
  const { root, cleanup } = await writeCorpus([['timing/real-case']]);
  const elsewhere = await mkdtemp(join(tmpdir(), 'breaks-linked-'));
  try {
    await mkdir(join(elsewhere, 'linked-case'), { recursive: true });
    const files = { ...caseFiles(), 'README.md': '# linked case\n' };
    for (const [name, contents] of Object.entries(files)) {
      await writeFile(join(elsewhere, 'linked-case', name), contents, 'utf8');
    }
    // 'junction' on Windows, where a directory symlink otherwise needs elevation.
    await symlink(
      join(elsewhere, 'linked-case'),
      join(root, 'timing', 'linked-case'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );

    const loaded = (await loadCorpus(root)).cases;

    assert.deepEqual(
      loaded.map((corpusCase) => corpusCase.case_id),
      ['timing/linked-case', 'timing/real-case'],
    );
  } finally {
    await cleanup();
    await rm(elsewhere, { recursive: true, force: true });
  }
});

test('the version travels with the cases rather than being the caller to remember', async () => {
  const { root, cleanup } = await writeCorpus([['timing/real-case']]);
  try {
    assert.equal((await loadCorpus(root)).version, '9.9.9');
  } finally {
    await cleanup();
  }
});

// The corpus of this repository, not a fixture. This is the test that stops a hand-written
// case from drifting away from the schema it is supposed to be written against.

test('this corpus declares the version every score of it is stamped with', async () => {
  // Deliberately not the literal current version: CHANGELOG.md mandates a minor bump whenever
  // a case changes, and a hard-coded '0.1.0' here would make the corpus workflow red-fail a
  // runner test that has nothing to do with corpus content.
  const version = await readCorpusVersion(CORPUS_ROOT);

  assert.match(version, /^\d+\.\d+\.\d+$/);
  assert.equal((await loadCorpus(CORPUS_ROOT)).version, version);
});

test('every case in corpus/ loads and validates', async () => {
  const loaded = (await loadCorpus(CORPUS_ROOT)).cases;

  assert.equal(loaded.length, 12);
  assert.deepEqual(
    loaded.map((corpusCase) => corpusCase.case_id),
    [
      'adversarial/identical-amount-same-minute',
      'adversarial/one-cent-inside-versus-outside-tolerance',
      'adversarial/record-present-in-a-absent-in-b',
      'adversarial/sums-match-categories-contradict',
      'fee-legs/dispute-fee-separate-from-disputed-amount',
      'fee-legs/fee-not-returned-on-refund',
      'fx/presentment-differs-from-settlement',
      'fx/round-before-versus-after-conversion',
      'grouping/many-charges-one-payout',
      'grouping/one-deposit-covers-two-payouts',
      'timing/charge-crosses-month-boundary',
      'timing/manual-payout-without-transaction-link',
    ],
  );
});

// `loadCase` checks the referential half of coherence - every id in expected.json exists in
// the inputs. This is the other half: every record in the inputs is accounted for in
// expected.json. A record with no verdict is a case whose ground truth is silent about part
// of its own input, and every implementation would be scored on an answer the case never
// stated. CLAUDE.md puts the full pass in `breaks verify`; until that slice exists, the
// corpus does not ship without it.
test('every record in every case gets exactly one verdict', async () => {
  const loaded = (await loadCorpus(CORPUS_ROOT)).cases;

  for (const corpusCase of loaded) {
    const sides = [
      {
        name: 'a',
        records: corpusCase.records_a,
        cited: [
          ...corpusCase.expected.matches.flatMap((match) => match.a),
          ...corpusCase.expected.unmatched_a.map((entry) => entry.id),
          ...corpusCase.expected.ambiguous.flatMap((entry) => entry.a),
        ],
      },
      {
        name: 'b',
        records: corpusCase.records_b,
        cited: [
          ...corpusCase.expected.matches.flatMap((match) => match.b),
          ...corpusCase.expected.unmatched_b.map((entry) => entry.id),
          ...corpusCase.expected.ambiguous.flatMap((entry) => entry.candidates_b),
        ],
      },
    ];

    for (const side of sides) {
      const cited = new Set(side.cited);
      const missing = side.records
        .map((record) => record.id)
        .filter((id) => !cited.has(id));

      assert.deepEqual(
        missing,
        [],
        `${corpusCase.case_id}: side ${side.name} has records with no verdict in expected.json`,
      );
    }
  }
});

test('the corpus exercises every match rule and abstains in at least four cases', async () => {
  const loaded = (await loadCorpus(CORPUS_ROOT)).cases;

  const rules = new Set(
    loaded.flatMap((corpusCase) => corpusCase.expected.matches.map((match) => match.rule)),
  );
  assert.deepEqual(
    [...rules].sort(),
    [
      'amount_and_window',
      'amount_within_tolerance',
      'fee_leg',
      'fx_converted',
      'group_sum',
      'reference',
      'split_sum',
    ],
    'a rule with no case behind it is a leaderboard column nothing measures',
  );

  const abstaining = loaded.filter((corpusCase) => corpusCase.expected.ambiguous.length > 0);
  assert.ok(
    abstaining.length >= 4,
    `abstention is a correct answer and needs weight in the corpus; found ${String(abstaining.length)} case(s)`,
  );
});

// Exact integer rounding of n/d, in the two modes a case could plausibly be scored under.
// BigInt because the fx numerator is a product of three integers and this is the one place in
// the tests where the corpus's own arithmetic is redone rather than trusted.
function roundHalf(n: bigint, d: bigint, mode: 'even' | 'up'): bigint {
  // Floor division, not BigInt's truncation toward zero: with a negative numerator - the
  // first refund or dispute with an fx leg - truncation leaves a negative remainder, every
  // comparison below reads as "round down", and this helper would quietly stop distinguishing
  // the two modes at all.
  const quotient = n / d - (n % d !== 0n && n < 0n !== d < 0n ? 1n : 0n);
  const twice = (n - quotient * d) * 2n;
  if (twice < d) return quotient;
  if (twice > d) return quotient + 1n;
  return mode === 'up' || quotient % 2n !== 0n ? quotient + 1n : quotient;
}

function tenTo(exponent: number): bigint {
  return 10n ** BigInt(exponent);
}

// invariant 6: tolerance and rounding come from the case. A corpus where half_even and
// half-up never disagree cannot tell an implementation that reads `policy.rounding` from one
// that hard-codes the rule it happens to know - both score a perfect run, and the field the
// policy declares is decorative.
test('at least one case separates half_even from half-up', async () => {
  const loaded = (await loadCorpus(CORPUS_ROOT)).cases;

  const divergent = loaded.flatMap((corpusCase) =>
    [...corpusCase.records_a, ...corpusCase.records_b]
      .filter((record) => record.fx !== null)
      .filter((record) => {
        const leg = record.fx;
        if (leg === null) return false;
        const scale = leg.settlement.exponent - leg.presentment.exponent;
        const numerator =
          BigInt(leg.presentment.amount) * BigInt(leg.rate.num) * tenTo(Math.max(scale, 0));
        const denominator = BigInt(leg.rate.den) * tenTo(Math.max(-scale, 0));
        return (
          roundHalf(numerator, denominator, 'even') !== roundHalf(numerator, denominator, 'up')
        );
      })
      .map((record) => `${corpusCase.case_id}/${record.id}`),
  );

  assert.notDeepEqual(divergent, [], 'no record in the corpus rounds differently under half-up');
});

test('every match carries money as its residual, in a currency the case uses', async () => {
  const loaded = (await loadCorpus(CORPUS_ROOT)).cases;

  for (const corpusCase of loaded) {
    const currencies = new Set(
      [...corpusCase.records_a, ...corpusCase.records_b].flatMap((record) => [
        record.gross.currency,
        ...(record.fx === null ? [] : [record.fx.settlement.currency]),
      ]),
    );

    for (const match of corpusCase.expected.matches) {
      assert.ok(
        currencies.has(match.residual.currency),
        `${corpusCase.case_id}: residual in ${match.residual.currency}, which no record in the case is denominated in`,
      );
    }
  }
});
