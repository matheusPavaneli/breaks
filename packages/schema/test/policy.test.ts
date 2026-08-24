import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseIso8601Duration } from '../duration.ts';
import { policySchema, type PolicyInput } from '../policy.ts';

function validPolicy(): PolicyInput {
  return {
    amount_tolerance: { absolute_minor_units: 2, basis_points: 0 },
    time_window: { before: 'PT0S', after: 'P3D' },
    rounding: 'half_even',
    fx: { round_after_conversion: true },
  };
}

test('the policy from SPEC.md parses', () => {
  const parsed = policySchema.parse(validPolicy());
  assert.equal(parsed.time_window.before, 'PT0S');
  assert.equal(parsed.time_window.after, 'P3D');
  assert.equal(parsed.amount_tolerance.absolute_minor_units, 2);
});

test('a parsed policy serialises back to the bytes it arrived as', () => {
  // The runner hands the policy on to the implementation as JSON (SPEC.md section 5), so the
  // output of the schema has to be valid input to it.
  const wire = JSON.stringify(validPolicy());
  const roundTripped = JSON.stringify(policySchema.parse(JSON.parse(wire)));
  assert.equal(roundTripped, wire);
  assert.equal(policySchema.safeParse(JSON.parse(roundTripped)).success, true);
});

test('the window is available in seconds through the parser', () => {
  const parsed = policySchema.parse(validPolicy());
  assert.equal(parseIso8601Duration(parsed.time_window.after), 259200);
});

test('a negative or fractional tolerance is rejected', () => {
  for (const amount_tolerance of [
    { absolute_minor_units: -1, basis_points: 0 },
    { absolute_minor_units: 0.5, basis_points: 0 },
    { absolute_minor_units: 0, basis_points: -1 },
    { absolute_minor_units: 0, basis_points: 12.5 },
  ]) {
    assert.equal(
      policySchema.safeParse({ ...validPolicy(), amount_tolerance }).success,
      false,
      JSON.stringify(amount_tolerance),
    );
  }
});

test('a window with a duration the parser refuses is rejected', () => {
  assert.equal(
    policySchema.safeParse({
      ...validPolicy(),
      time_window: { before: 'PT0S', after: 'P1M' },
    }).success,
    false,
  );
});

test('a rounding mode outside the enum is rejected', () => {
  assert.equal(policySchema.safeParse({ ...validPolicy(), rounding: 'half_up' }).success, false);
});

test('every section is required: a missing one is an unanswered question, not a default', () => {
  for (const key of ['amount_tolerance', 'time_window', 'rounding', 'fx'] as const) {
    const policy: Partial<PolicyInput> = validPolicy();
    delete policy[key];
    assert.equal(policySchema.safeParse(policy).success, false, key);
  }
});

test('an unknown key on the policy is rejected', () => {
  assert.equal(
    policySchema.safeParse({ ...validPolicy(), max_candidates: 3 }).success,
    false,
  );
});
