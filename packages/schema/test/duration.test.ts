import assert from 'node:assert/strict';
import { test } from 'node:test';

import { durationSchema, InvalidDurationError, parseIso8601Duration } from '../duration.ts';

test('the fixed-length designators parse into whole seconds', () => {
  assert.equal(parseIso8601Duration('PT0S'), 0);
  assert.equal(parseIso8601Duration('P3D'), 259200);
  assert.equal(parseIso8601Duration('PT1H30M'), 5400);
  assert.equal(parseIso8601Duration('P1W'), 604800);
  assert.equal(parseIso8601Duration('P1WT12H'), 604800 + 43200);
  assert.equal(parseIso8601Duration('P1DT2H3M4S'), 86400 + 7200 + 180 + 4);
});

test('years and months are rejected: neither is a fixed number of seconds', () => {
  assert.throws(() => parseIso8601Duration('P1Y'), InvalidDurationError);
  assert.throws(() => parseIso8601Duration('P1M'), InvalidDurationError);
  assert.throws(() => parseIso8601Duration('P1Y6M'), InvalidDurationError);
});

test('a fractional component is rejected: it would reintroduce a float', () => {
  assert.throws(() => parseIso8601Duration('PT0.5S'), InvalidDurationError);
  assert.throws(() => parseIso8601Duration('PT1,5H'), InvalidDurationError);
});

test('a duration with no component at all is rejected', () => {
  assert.throws(() => parseIso8601Duration('P'), InvalidDurationError);
  assert.throws(() => parseIso8601Duration('PT'), InvalidDurationError);
  assert.throws(() => parseIso8601Duration('P1DT'), InvalidDurationError);
});

test('a sign, an empty string and stray text are rejected', () => {
  assert.throws(() => parseIso8601Duration('-PT1H'), InvalidDurationError);
  assert.throws(() => parseIso8601Duration('PT-1H'), InvalidDurationError);
  assert.throws(() => parseIso8601Duration(''), InvalidDurationError);
  assert.throws(() => parseIso8601Duration('3 days'), InvalidDurationError);
});

test('input longer than the bound is rejected before parsing', () => {
  assert.throws(() => parseIso8601Duration(`PT${'9'.repeat(70)}S`), InvalidDurationError);
});

test('a total beyond the safe integer range is rejected', () => {
  assert.throws(() => parseIso8601Duration('P999999999999999W'), InvalidDurationError);
});

test('the schema validates without converting, so a policy round-trips byte-identical', () => {
  assert.equal(durationSchema.parse('P3D'), 'P3D');
  assert.equal(durationSchema.parse('PT0S'), 'PT0S');
});

test('the schema reports the parser message and keeps the cause', () => {
  const result = durationSchema.safeParse('P1M');
  assert.equal(result.success, false);
  const [issue] = result.error.issues;
  assert.match(issue?.message ?? '', /invalid ISO 8601 duration/);
  assert.ok(issue?.code === 'custom' && issue.params?.['cause'] instanceof InvalidDurationError);
});
