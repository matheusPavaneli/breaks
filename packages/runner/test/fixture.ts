import {
  expectedSchema,
  policySchema,
  settlementRecordListSchema,
  submissionSchema,
  type Expected,
  type ExpectedInput,
  type SettlementRecordInput,
  type Submission,
} from '@breaks/schema';
import type { CorpusCase } from '../case.ts';

// In-package fixtures. No corpus case is created or read in this slice: the corpus is the
// project's asset and it arrives narrative-first, not as scaffolding for a scorer's tests.

const USD = { currency: 'USD', exponent: 2 } as const;

export function usd(amount: number): { amount: number; currency: 'USD'; exponent: 2 } {
  return { amount, ...USD };
}

export function recordInput(
  id: string,
  overrides: Partial<SettlementRecordInput> = {},
): SettlementRecordInput {
  return {
    id,
    source: 'psp',
    source_system: 'acme_psp',
    version: 1,
    occurred_at: '2026-03-01T10:00:00Z',
    settled_at: '2026-03-02T10:00:00Z',
    gross: usd(10_000),
    fee: usd(290),
    net: usd(9_710),
    fx: null,
    category: 'charge',
    status: 'available',
    references: [],
    metadata: {},
    ...overrides,
  };
}

export const policyInput = {
  amount_tolerance: { absolute_minor_units: 0, basis_points: 0 },
  time_window: { before: 'PT0S', after: 'P3D' },
  rounding: 'half_even',
  fx: { round_after_conversion: true },
} as const;

/**
 * The reference case these tests score against: two matches, one abstention, one record left
 * unmatched. Small enough to reason about by hand, wide enough that every counter has
 * something to count.
 */
export const expectedInput: ExpectedInput = {
  matches: [
    { a: ['ch_1'], b: ['bt_1'], rule: 'reference', fields_used: ['references'], residual: usd(0) },
    {
      a: ['ch_2'],
      b: ['bt_2'],
      rule: 'amount_and_window',
      fields_used: ['gross', 'occurred_at'],
      residual: usd(0),
    },
  ],
  unmatched_a: [{ id: 'ch_4', reason: 'not_yet_settled' }],
  unmatched_b: [],
  ambiguous: [
    { a: ['ch_3'], candidates_b: ['bt_7', 'bt_8'], reason: 'identical_amount_same_minute' },
  ],
};

export const recordsAInput: SettlementRecordInput[] = [
  recordInput('ch_1', { references: [{ type: 'payout', id: 'po_1' }] }),
  recordInput('ch_2'),
  recordInput('ch_3'),
  recordInput('ch_4', { settled_at: null, status: 'pending' }),
];

export const recordsBInput: SettlementRecordInput[] = [
  recordInput('bt_1', { source: 'bank', source_system: 'acme_bank', references: [{ type: 'payout', id: 'po_1' }] }),
  recordInput('bt_2', { source: 'bank', source_system: 'acme_bank' }),
  recordInput('bt_7', { source: 'bank', source_system: 'acme_bank' }),
  recordInput('bt_8', { source: 'bank', source_system: 'acme_bank' }),
];

export function expectedFixture(): Expected {
  return expectedSchema.parse(structuredClone(expectedInput));
}

/** The ground truth read back as a submission - a perfect answer to the fixture case. */
export function perfectSubmission(): Submission {
  return submissionSchema.parse(structuredClone(expectedInput));
}

// `unknown` on purpose: a submission is someone else's output, and several tests need to hand
// it a shape TypeScript would refuse - an unknown key, a wrong enum - which is exactly what
// the schema is there to judge.
export function submissionFrom(input: unknown): Submission {
  return submissionSchema.parse(structuredClone(input));
}

export function expectedFrom(input: unknown): Expected {
  return expectedSchema.parse(structuredClone(input));
}

export const emptyExpectedInput: ExpectedInput = {
  matches: [],
  unmatched_a: [],
  unmatched_b: [],
  ambiguous: [],
};

export function caseFixture(case_id = 'timing/fixture-case'): CorpusCase {
  return {
    case_id,
    dir: `corpus/${case_id}`,
    policy: policySchema.parse(structuredClone(policyInput)),
    records_a: settlementRecordListSchema.parse(structuredClone(recordsAInput)),
    records_b: settlementRecordListSchema.parse(structuredClone(recordsBInput)),
    expected: expectedFixture(),
  };
}

/** The four files of a case directory, as the bytes they are written to disk as. */
export function caseFiles(): Record<string, string> {
  return {
    'policy.json': JSON.stringify(policyInput, null, 2),
    'input_a.json': JSON.stringify(recordsAInput, null, 2),
    'input_b.json': JSON.stringify(recordsBInput, null, 2),
    'expected.json': JSON.stringify(expectedInput, null, 2),
  };
}

/**
 * A seeded shuffle, so the determinism test is itself deterministic.
 *
 * mulberry32 over a Fisher-Yates pass: the point is a reproducible permutation, not
 * cryptographic quality, and a test whose failures cannot be replayed is not evidence.
 */
export function seededShuffle<T>(items: readonly T[], seed: number): T[] {
  let state = seed >>> 0;
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(next() * (i + 1));
    const a = out[i];
    const b = out[j];
    if (a === undefined || b === undefined) continue;
    out[i] = b;
    out[j] = a;
  }
  return out;
}
