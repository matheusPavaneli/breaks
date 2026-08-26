import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { caseIdFromDir, CaseFileError, loadCase } from '../case.ts';
import { caseFiles } from './fixture.ts';

async function writeCase(overrides: Record<string, string> = {}): Promise<{
  dir: string;
  cleanup: () => Promise<void>;
}> {
  const root = await mkdtemp(join(tmpdir(), 'breaks-case-'));
  const dir = join(root, 'timing', 'fixture-case');
  await mkdir(dir, { recursive: true });

  const files = { ...caseFiles(), ...overrides };
  for (const [name, contents] of Object.entries(files)) {
    await writeFile(join(dir, name), contents, 'utf8');
  }

  return { dir, cleanup: () => rm(root, { recursive: true, force: true }) };
}

test('the case id is the last two path segments, whatever separator the platform uses', () => {
  assert.equal(caseIdFromDir('corpus/timing/charge-crosses-month-boundary'), 'timing/charge-crosses-month-boundary');
  assert.equal(caseIdFromDir('C:\\corpus\\timing\\fixture-case'), 'timing/fixture-case');
  assert.equal(caseIdFromDir('./corpus/fees/fee-not-refunded/'), 'fees/fee-not-refunded');
});

test('a well-formed case directory loads with its four files parsed', async () => {
  const { dir, cleanup } = await writeCase();
  try {
    const loaded = await loadCase(dir);

    assert.equal(loaded.case_id, 'timing/fixture-case');
    assert.equal(loaded.records_a.length, 4);
    assert.equal(loaded.records_b.length, 4);
    assert.equal(loaded.expected.matches.length, 2);
    assert.equal(loaded.policy.time_window.after, 'P3D');
    // Money arrived as a branded value, not as the object literal that was on disk.
    assert.equal(loaded.records_a[0]?.gross.currency, 'USD');
  } finally {
    await cleanup();
  }
});

test('a malformed policy.json names the file and the field that failed', async () => {
  const broken = JSON.stringify({
    amount_tolerance: { absolute_minor_units: 0.5, basis_points: 0 },
    time_window: { before: 'PT0S', after: 'P3D' },
    rounding: 'half_even',
    fx: { round_after_conversion: true },
  });
  const { dir, cleanup } = await writeCase({ 'policy.json': broken });

  try {
    await assert.rejects(
      () => loadCase(dir),
      (error: unknown) => {
        assert.ok(error instanceof CaseFileError);
        assert.equal(error.file, 'policy.json');
        assert.ok(error.paths.includes('amount_tolerance.absolute_minor_units'));
        assert.notEqual(error.cause, undefined);
        return true;
      },
    );
  } finally {
    await cleanup();
  }
});

test('a record whose exponent contradicts its currency is a case error, located', async () => {
  const records = JSON.parse(caseFiles()['input_a.json'] ?? '[]') as Record<string, unknown>[];
  const first = records[0];
  assert.ok(first !== undefined);
  first['gross'] = { amount: 1_000, currency: 'JPY', exponent: 2 };
  const { dir, cleanup } = await writeCase({ 'input_a.json': JSON.stringify(records) });

  try {
    await assert.rejects(
      () => loadCase(dir),
      (error: unknown) => {
        assert.ok(error instanceof CaseFileError);
        assert.equal(error.file, 'input_a.json');
        assert.ok(error.paths.some((path) => path.startsWith('0.gross')));
        assert.match(error.message, /JPY/);
        return true;
      },
    );
  } finally {
    await cleanup();
  }
});

test('an unknown key in expected.json is rejected rather than ignored', async () => {
  const expected = JSON.parse(caseFiles()['expected.json'] ?? '{}') as Record<string, unknown>;
  expected['confidence'] = 0.9;
  const { dir, cleanup } = await writeCase({ 'expected.json': JSON.stringify(expected) });

  try {
    await assert.rejects(
      () => loadCase(dir),
      (error: unknown) => {
        assert.ok(error instanceof CaseFileError);
        assert.equal(error.file, 'expected.json');
        return true;
      },
    );
  } finally {
    await cleanup();
  }
});

test('expected.json naming a record that no input file holds is a case error', async () => {
  const expected = JSON.parse(caseFiles()['expected.json'] ?? '{}') as {
    matches: { a: string[] }[];
  };
  const first = expected.matches[0];
  assert.ok(first !== undefined);
  // A typo, not a wrong answer: ch_l for ch_1. Each file still validates on its own, and the
  // case becomes unwinnable - every implementation takes a missed_match on it forever, and
  // the symptom reads as an engine bug rather than as the corpus defect it is.
  first.a = ['ch_l'];
  const { dir, cleanup } = await writeCase({ 'expected.json': JSON.stringify(expected) });

  try {
    await assert.rejects(
      () => loadCase(dir),
      (error: unknown) => {
        assert.ok(error instanceof CaseFileError);
        assert.equal(error.file, 'expected.json');
        assert.match(error.message, /ch_l/);
        assert.match(error.message, /input_a\.json/);
        assert.ok(error.paths.includes('matches.a'));
        return true;
      },
    );
  } finally {
    await cleanup();
  }
});

test('the coherence check covers every side and every list expected.json can cite', async () => {
  const cases: [string, Record<string, unknown>][] = [
    ['matches.b', { matches: [{ a: ['ch_1'], b: ['bt_9'], rule: 'reference', fields_used: ['references'], residual: { amount: 0, currency: 'USD', exponent: 2 } }], unmatched_a: [], unmatched_b: [], ambiguous: [] }],
    ['unmatched_a.id', { matches: [], unmatched_a: [{ id: 'ch_9', reason: 'not_yet_settled' }], unmatched_b: [], ambiguous: [] }],
    ['unmatched_b.id', { matches: [], unmatched_a: [], unmatched_b: [{ id: 'bt_9', reason: 'no_counterpart_record' }], ambiguous: [] }],
    ['ambiguous.candidates_b', { matches: [], unmatched_a: [], unmatched_b: [], ambiguous: [{ a: ['ch_3'], candidates_b: ['bt_7', 'bt_9'], reason: 'identical_amount_same_minute' }] }],
  ];

  for (const [path, expected] of cases) {
    const { dir, cleanup } = await writeCase({ 'expected.json': JSON.stringify(expected) });
    try {
      await assert.rejects(
        () => loadCase(dir),
        (error: unknown) => {
          assert.ok(error instanceof CaseFileError, `${path} was not caught`);
          assert.ok(error.paths.includes(path), `${path} was not the reported path`);
          return true;
        },
      );
    } finally {
      await cleanup();
    }
  }
});

test('a file that is not JSON, and a file that is not there at all, both name themselves', async () => {
  const notJson = await writeCase({ 'input_b.json': '{ not json' });
  try {
    await assert.rejects(
      () => loadCase(notJson.dir),
      (error: unknown) => {
        assert.ok(error instanceof CaseFileError);
        assert.equal(error.file, 'input_b.json');
        assert.match(error.message, /not valid JSON/);
        return true;
      },
    );
  } finally {
    await notJson.cleanup();
  }

  const root = await mkdtemp(join(tmpdir(), 'breaks-case-'));
  const empty = join(root, 'timing', 'no-files');
  await mkdir(empty, { recursive: true });
  try {
    await assert.rejects(
      () => loadCase(empty),
      (error: unknown) => {
        assert.ok(error instanceof CaseFileError);
        assert.equal(error.file, 'policy.json');
        assert.match(error.message, /cannot be read/);
        return true;
      },
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
