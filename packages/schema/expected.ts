import { z } from 'zod';
import { moneySchema } from './money.ts';

// Ground truth, and the same shape an implementation must emit. Two consequences the rest
// of this file exists to enforce:
//
//   - a match carries its justification (rule, fields_used, residual) or it does not
//     validate, so "it matched" is never a claim without evidence behind it;
//   - reason is a closed enum on both sides, because comparing "did not match" across
//     implementations has to be a set comparison, not free-text analysis.
//
// Adding a value to any enum below is a corpus change: minor version bump plus a CHANGELOG
// entry, not an edit made to let one case through.

const idSchema = z.string().min(1);

export const ruleSchema = z.enum([
  /** A shared reference identifies the pair outright. */
  'reference',
  /** Amount plus the policy's time window, with no reference to lean on. */
  'amount_and_window',
  /** Amounts differ, but within the tolerance the policy declares. */
  'amount_within_tolerance',
  /** n:1 - several records on side A sum to one on side B (category D1). */
  'group_sum',
  /** 1:n - one record on side A covers several on side B (category D2). */
  'split_sum',
  /** The pair only reconciles after the fx leg is converted (category C). */
  'fx_converted',
  /** The pair is the fee leg of another match, kept separate from gross (category B). */
  'fee_leg',
]);

export const unmatchedReasonSchema = z.enum([
  /** Still pending on the other side at the end of the period (A1, A7). */
  'not_yet_settled',
  /** Settled, but outside the window the policy allows (A3, A8). */
  'settled_outside_window',
  /** The counterpart record simply is not in the other file (E4). */
  'no_counterpart_record',
  /** The reference exists but points at nothing usable (E5). */
  'corrupted_reference',
  /** Superseded by a reprocessed record carrying a new id (E7). */
  'reprocessed_superseded',
  /** The payout failed and never credited (A6). */
  'payout_failed',
  /** Balance carried into the next period rather than paid out (A7, D4). */
  'balance_carried_forward',
  /** A payout of zero: nothing crossed to the other side (D5). */
  'zero_amount_payout',
  /** Movement between internal balances, not new revenue (D6). */
  'internal_transfer',
  /** A standalone fee with no gross leg of its own (B2, B3, B5). */
  'fee_leg_only',
  /** A candidate exists, but the difference exceeds the policy tolerance (E3). */
  'amount_beyond_tolerance',
  /** The amounts agree and the categories contradict each other (E10). */
  'category_mismatch',
  /** Credit against debit: the sign rules the pair out (E8). */
  'sign_mismatch',
]);

export const ambiguousReasonSchema = z.enum([
  /** Same amount, same minute, different customers (E1). */
  'identical_amount_same_minute',
  /** A real duplicate and a legitimate repeat charge are indistinguishable here (E2). */
  'duplicate_indistinguishable',
  /** More than one candidate falls inside the policy tolerance (C1, E3). */
  'multiple_candidates_within_tolerance',
  /** Several groupings sum to the same total, with no way to choose (D1, D2, D3). */
  'multiple_grouping_partitions',
  /** The payout carries no transaction-level link at all (A4, A5). */
  'payout_without_transaction_link',
  /** Rounding before or after conversion yields two defensible pairings (C4). */
  'fx_rounding_tie',
  /** The timestamp's offset is inconsistent with the rest of the file (E9). */
  'timestamp_zone_ambiguous',
  /** Events arrived out of order, so the sequence cannot settle the pairing (E6). */
  'out_of_order_events',
]);

export const matchSchema = z.strictObject({
  a: z.array(idSchema).min(1),
  b: z.array(idSchema).min(1),
  rule: ruleSchema,
  // What the rule actually read. An empty list is a match with no stated basis.
  fields_used: z.array(z.string().min(1)).min(1),
  // Money, not a bare number: a residual without a currency is the kind of amount this
  // project exists to make impossible. Zero residual is money(0, currency).
  residual: moneySchema,
});

export const unmatchedSchema = z.strictObject({
  id: idSchema,
  reason: unmatchedReasonSchema,
});

export const ambiguousSchema = z.strictObject({
  a: z.array(idSchema).min(1),
  // Fewer than two candidates is not an ambiguity: with one candidate the answer is a
  // match or an unmatched record, and abstaining there is a false abstain.
  candidates_b: z.array(idSchema).min(2),
  reason: ambiguousReasonSchema,
});

export const expectedSchema = z.strictObject({
  matches: z.array(matchSchema),
  unmatched_a: z.array(unmatchedSchema),
  unmatched_b: z.array(unmatchedSchema),
  ambiguous: z.array(ambiguousSchema),
});

export type Rule = z.output<typeof ruleSchema>;
export type UnmatchedReason = z.output<typeof unmatchedReasonSchema>;
export type AmbiguousReason = z.output<typeof ambiguousReasonSchema>;
export type Match = z.output<typeof matchSchema>;
export type Unmatched = z.output<typeof unmatchedSchema>;
export type Ambiguous = z.output<typeof ambiguousSchema>;
export type Expected = z.output<typeof expectedSchema>;
export type ExpectedInput = z.input<typeof expectedSchema>;
