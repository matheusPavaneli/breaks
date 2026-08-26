import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { runCase } from '../report.ts';
import {
  DEFAULT_TIMEOUT_MS,
  encodeRunnerInput,
  minimalEnv,
  processImplementation,
} from '../protocol.ts';
import { caseFixture, expectedInput } from './fixture.ts';

// Every implementation in this file is a real child process. The contract SPEC.md section 5
// states is about processes, and a stub that pretends to be one would not exercise the part
// that actually breaks: stdio, exit codes and killing something that will not stop.

const PERFECT_OUTPUT = JSON.stringify(expectedInput);

async function withScript<T>(
  body: string,
  use: (script: string, dir: string) => Promise<T>,
): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'breaks-impl-'));
  const script = join(dir, 'impl.mjs');
  await writeFile(script, body, 'utf8');
  try {
    return await use(script, dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function run(script: string, timeoutMs: number) {
  return runCase(caseFixture(), processImplementation(process.execPath, [script]), { timeoutMs });
}

test('the default per-case budget is the 30s SPEC.md declares', () => {
  assert.equal(DEFAULT_TIMEOUT_MS, 30_000);
});

test('the input line the implementation receives is the case, and it survives the round trip', async () => {
  const fixture = caseFixture();
  const line = encodeRunnerInput({
    case_id: fixture.case_id,
    policy: fixture.policy,
    records_a: [...fixture.records_a],
    records_b: [...fixture.records_b],
  });

  assert.ok(!line.includes('\n'));
  const parsed = JSON.parse(line) as { case_id: string; records_a: unknown[] };
  assert.equal(parsed.case_id, 'timing/fixture-case');
  assert.equal(parsed.records_a.length, 4);
});

test('an implementation that reads stdin and prints a valid line is scored', async () => {
  const body = `
    let input = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { input += chunk; });
    process.stdin.on('end', () => {
      const request = JSON.parse(input);
      if (request.case_id !== 'timing/fixture-case') { process.exit(2); }
      if (request.records_a.length !== 4) { process.exit(3); }
      if (typeof request.policy.time_window.after !== 'string') { process.exit(4); }
      process.stdout.write(${JSON.stringify(PERFECT_OUTPUT)} + '\\n');
    });
  `;

  await withScript(body, async (script) => {
    const result = await run(script, 10_000);
    assert.equal(result.status, 'scored');
    assert.equal(result.reason, null);
    assert.equal(result.settlement_score, 1);
    assert.equal(result.counters.true_match, 2);
    assert.equal(result.network_isolated, false);
    assert.equal(result.timeout_ms, 10_000);
  });
});

test('an implementation that never answers fails as timeout, and is not left running', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'breaks-impl-'));
  const pidFile = join(dir, 'pid');
  const script = join(dir, 'impl.mjs');
  await writeFile(
    script,
    `
      import { writeFileSync } from 'node:fs';
      writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));
      setTimeout(() => { process.stdout.write('too late'); }, 60_000);
    `,
    'utf8',
  );

  try {
    const result = await runCase(caseFixture(), processImplementation(process.execPath, [script]), {
      timeoutMs: 500,
    });

    assert.equal(result.status, 'failed');
    assert.equal(result.reason, 'timeout');
    assert.equal(result.settlement_score, 0);
    assert.deepEqual(result.counters, {
      true_match: 0,
      false_match: 0,
      missed_match: 0,
      correct_abstain: 0,
      false_abstain: 0,
    });

    const pid = Number.parseInt(await readFile(pidFile, 'utf8'), 10);
    assert.ok(Number.isInteger(pid));
    assert.throws(() => process.kill(pid, 0), /ESRCH|EPERM/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('a non-zero exit fails as exit_nonzero and hands back what the implementation printed', async () => {
  const body = `
    process.stderr.write('policy.json: unsupported rounding mode\\n');
    process.exit(3);
  `;

  await withScript(body, async (script) => {
    const result = await run(script, 10_000);
    assert.equal(result.status, 'failed');
    assert.equal(result.reason, 'exit_nonzero');
    assert.match(result.detail, /exit code 3/);
    // "exit code 3" is not a diagnostic; the line the participant's own program printed is.
    assert.match(result.stderr, /unsupported rounding mode/);
  });
});

test('the child does not inherit the parent environment', async () => {
  const body = `
    const leaked = process.env.BREAKS_FAKE_PUBLISH_TOKEN;
    if (leaked !== undefined) { process.stderr.write('leaked: ' + leaked); process.exit(9); }
    process.stdout.write(${JSON.stringify(PERFECT_OUTPUT)} + '\\n');
  `;

  process.env['BREAKS_FAKE_PUBLISH_TOKEN'] = 'not-a-real-token';
  try {
    await withScript(body, async (script) => {
      const result = await run(script, 10_000);
      assert.equal(result.status, 'scored', `child saw the parent env: ${result.stderr}`);
    });
  } finally {
    delete process.env['BREAKS_FAKE_PUBLISH_TOKEN'];
  }
});

test('a caller that passes env explicitly owns what the child sees', async () => {
  const body = `
    if (process.env.BREAKS_OPT_IN !== 'yes') { process.exit(9); }
    process.stdout.write(${JSON.stringify(PERFECT_OUTPUT)} + '\\n');
  `;

  await withScript(body, async (script) => {
    const implementation = processImplementation(process.execPath, [script], {
      env: { ...minimalEnv(), BREAKS_OPT_IN: 'yes' },
    });
    const result = await runCase(caseFixture(), implementation, { timeoutMs: 10_000 });
    assert.equal(result.status, 'scored');
  });
});

test('minimalEnv carries what a process needs to start and nothing else', () => {
  const env = minimalEnv();
  const names = Object.keys(env);

  assert.ok(names.length > 0);
  assert.ok(names.every((name) => !name.toLowerCase().includes('token')));
  const hasPath = env['PATH'] !== undefined || env['Path'] !== undefined;
  assert.ok(hasPath, 'a child with no PATH cannot start anything');
});

test('flooding stdout fails as output_too_large, not as a schema rejection', async () => {
  const body = `
    const chunk = 'x'.repeat(1024 * 1024);
    for (let i = 0; i < 12; i += 1) { process.stdout.write(chunk); }
  `;

  await withScript(body, async (script) => {
    const result = await run(script, 20_000);
    assert.equal(result.status, 'failed');
    // Telling a participant the schema rejected output that was never parsed is a lie the
    // leaderboard would repeat.
    assert.equal(result.reason, 'output_too_large');
    assert.match(result.detail, /exceeded/);
  });
});

test('a case the runner cannot serialise is the corpus errored, not the implementation zeroed', async () => {
  const broken = caseFixture();
  // A duration the schema refuses. Reaching this state needs a cast: `loadCase` cannot
  // produce it, which is the point - it is the schema drift this failure mode exists for,
  // and before the fix it rejected the promise and took the whole corpus run with it.
  const policy = structuredClone(broken.policy) as { time_window: { after: string } };
  policy.time_window.after = 'P1M';

  const result = await runCase(
    { ...broken, policy: policy as typeof broken.policy },
    processImplementation(process.execPath, ['--version']),
    { timeoutMs: 5_000 },
  );

  assert.equal(result.status, 'errored');
  assert.equal(result.reason, 'input_rejected');
  assert.equal(result.settlement_score, 0);
});

test('a command that does not exist fails as spawn_failed', async () => {
  const implementation = processImplementation(
    join(tmpdir(), 'breaks-no-such-implementation-binary'),
    [],
  );
  const result = await runCase(caseFixture(), implementation, { timeoutMs: 5_000 });

  assert.equal(result.status, 'failed');
  assert.equal(result.reason, 'spawn_failed');
  assert.equal(result.settlement_score, 0);
});

test('output that is not JSON fails as unparseable_output', async () => {
  await withScript(`process.stdout.write('reconciled everything, trust me\\n');`, async (script) => {
    const result = await run(script, 10_000);
    assert.equal(result.status, 'failed');
    assert.equal(result.reason, 'unparseable_output');
  });
});

test('printing nothing at all fails as unparseable_output', async () => {
  await withScript(`process.exit(0);`, async (script) => {
    const result = await run(script, 10_000);
    assert.equal(result.status, 'failed');
    assert.equal(result.reason, 'unparseable_output');
    assert.match(result.detail, /no non-empty line/);
  });
});

test('JSON the submission schema rejects fails as invalid_output, saying which field', async () => {
  const body = `
    process.stdout.write(JSON.stringify({
      matches: [{ a: ['ch_1'], b: ['bt_1'], rule: 'telepathy', fields_used: [], residual: 0 }],
      unmatched_a: [], unmatched_b: [], ambiguous: [],
    }) + '\\n');
  `;

  await withScript(body, async (script) => {
    const result = await run(script, 10_000);
    assert.equal(result.status, 'failed');
    assert.equal(result.reason, 'invalid_output');
    assert.match(result.detail, /matches\.0\.rule/);
  });
});

test('an unknown key on the implementation side is ignored, not fatal', async () => {
  const decorated = JSON.parse(PERFECT_OUTPUT) as Record<string, unknown>;
  decorated['engine_version'] = '1.2.3';
  const body = `process.stdout.write(${JSON.stringify(JSON.stringify(decorated))} + '\\n');`;

  await withScript(body, async (script) => {
    const result = await run(script, 10_000);
    assert.equal(result.status, 'scored');
    assert.equal(result.settlement_score, 1);
  });
});

test('blank lines around the answer are tolerated; blank lines instead of one are not', async () => {
  // Only the first non-empty line is read, per SPEC.md section 5: one JSON line out. A
  // *non-empty* banner before the answer is therefore not tolerated, and should not be - it
  // would make "the answer" mean whichever line the runner felt like picking.
  const padded = `
    process.stdout.write('\\n');
    process.stdout.write(${JSON.stringify(PERFECT_OUTPUT)} + '\\n');
  `;
  await withScript(padded, async (script) => {
    assert.equal((await run(script, 10_000)).status, 'scored');
  });

  const chatty = `
    process.stdout.write('loading policy...\\n');
    process.stdout.write(${JSON.stringify(PERFECT_OUTPUT)} + '\\n');
  `;
  await withScript(chatty, async (script) => {
    assert.equal((await run(script, 10_000)).reason, 'unparseable_output');
  });

  await withScript(`process.stdout.write('\\n\\n   \\n');`, async (script) => {
    const result = await run(script, 10_000);
    assert.equal(result.reason, 'unparseable_output');
  });
});
