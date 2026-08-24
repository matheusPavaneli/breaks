import assert from 'node:assert/strict';
import { test } from 'node:test';

import { expectedSchema } from '../expected.ts';
import {
  runnerInputSchema,
  runnerOutputSchema,
  type RunnerInputPayload,
} from '../protocol.ts';

function validInput(): RunnerInputPayload {
  return {
    case_id: 'timing/charge-crosses-month-boundary',
    policy: {
      amount_tolerance: { absolute_minor_units: 2, basis_points: 0 },
      time_window: { before: 'PT0S', after: 'P3D' },
      rounding: 'half_even',
      fx: { round_after_conversion: true },
    },
    records_a: [
      {
        id: 'ch_1',
        source: 'psp',
        source_system: 'stripe',
        version: 1,
        occurred_at: '2026-01-31T23:14:02-03:00',
        settled_at: null,
        gross: { amount: 10000, currency: 'USD', exponent: 2 },
        fee: null,
        net: null,
        fx: null,
        category: 'charge',
        status: 'pending',
        references: [],
        metadata: {},
      },
    ],
    records_b: [],
  };
}

test('a well-formed request parses, policy included', () => {
  const parsed = runnerInputSchema.parse(validInput());
  assert.equal(parsed.case_id, 'timing/charge-crosses-month-boundary');
  assert.equal(parsed.policy.time_window.after, 'P3D');
  assert.equal(parsed.records_a[0]?.gross.amount, 10000);
});

test('an empty side is a valid request: one file may legitimately have no records', () => {
  assert.equal(
    runnerInputSchema.safeParse({ ...validInput(), records_a: [], records_b: [] }).success,
    true,
  );
});

test('a request without a policy is rejected: tolerance never comes from the implementation', () => {
  const input: Partial<RunnerInputPayload> = validInput();
  delete input.policy;
  assert.equal(runnerInputSchema.safeParse(input).success, false);
});

test('a request without a case_id, or with an unknown key, is rejected', () => {
  const input: Partial<RunnerInputPayload> = validInput();
  delete input.case_id;
  assert.equal(runnerInputSchema.safeParse(input).success, false);
  assert.equal(runnerInputSchema.safeParse({ ...validInput(), timeout_s: 30 }).success, false);
});

test('a malformed record inside the request fails the whole request', () => {
  const input = validInput();
  const record = input.records_a[0];
  assert.ok(record !== undefined);
  assert.equal(
    runnerInputSchema.safeParse({
      ...input,
      records_a: [{ ...record, occurred_at: '2026-01-31T23:14:02' }],
    }).success,
    false,
  );
});

test('duplicate record ids on one side are rejected: an id has to name one record', () => {
  const input = validInput();
  const record = input.records_a[0];
  assert.ok(record !== undefined);
  const result = runnerInputSchema.safeParse({ ...input, records_a: [record, { ...record }] });
  assert.equal(result.success, false);
  assert.match(result.error.issues[0]?.message ?? '', /duplicate record id/);
});

test('the same id on opposite sides is fine: that is what a match is', () => {
  const input = validInput();
  const record = input.records_a[0];
  assert.ok(record !== undefined);
  assert.equal(
    runnerInputSchema.safeParse({ ...input, records_b: [{ ...record, source: 'bank' }] }).success,
    true,
  );
});

test('a request round-trips through JSON with every value intact', () => {
  // SPEC.md section 5: the runner writes this message to the implementation's stdin, so what
  // the schema produces has to serialise back into a valid request. Key order is normalised
  // by zod, which rebuilds objects in shape order - so this asserts the values, and uses a
  // fixture whose keys are deliberately in a different order from the schema's.
  const payload = JSON.parse(JSON.stringify(validInput())) as Record<string, unknown>;
  const shuffled = {
    records_b: payload['records_b'],
    policy: payload['policy'],
    records_a: payload['records_a'],
    case_id: payload['case_id'],
  };

  const parsed = runnerInputSchema.parse(shuffled);
  const roundTripped: unknown = JSON.parse(JSON.stringify(parsed));

  assert.deepEqual(roundTripped, payload);
  assert.equal(runnerInputSchema.safeParse(roundTripped).success, true);
});

test('the output is the same shape expected.json is held to', () => {
  const output = {
    matches: [
      {
        a: ['ch_1'],
        b: ['bt_1'],
        rule: 'reference',
        fields_used: ['references'],
        residual: { amount: 0, currency: 'USD', exponent: 2 },
      },
    ],
    unmatched_a: [],
    unmatched_b: [],
    ambiguous: [],
  };
  assert.equal(runnerOutputSchema.safeParse(output).success, true);
  assert.equal(expectedSchema.safeParse(output).success, true);
  // An extra key on a third-party submission costs the case nothing; it is dropped.
  assert.equal(runnerOutputSchema.safeParse({ ...output, engine: 'acme 1.0' }).success, true);

  const noJustification = {
    ...output,
    matches: [{ a: ['ch_1'], b: ['bt_1'], rule: 'reference', residual: 0 }],
  };
  assert.equal(runnerOutputSchema.safeParse(noJustification).success, false);
});
