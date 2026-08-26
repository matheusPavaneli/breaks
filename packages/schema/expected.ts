import { z } from 'zod';
import { moneySchema, submissionMoneySchema } from './money.ts';

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
const idListSchema = z.array(idSchema).min(1);

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

// A list of ids is a set written as an array. Counting entries instead of distinct ids would
// let a repeat stand in for a second record: "candidates_b": ["bt_7", "bt_7"] would clear a
// minimum of two while naming one candidate, turning a false abstain into a scored one.
function requireDistinct(ids: readonly string[], field: string, ctx: z.RefinementCtx): void {
  const seen = new Set<string>();
  ids.forEach((id, index) => {
    if (seen.has(id)) {
      ctx.addIssue({
        code: 'custom',
        path: [field, index],
        message: `duplicate id ${JSON.stringify(id)} in ${field}`,
      });
      return;
    }
    seen.add(id);
  });
}

function matchFields(residual: typeof moneySchema | typeof submissionMoneySchema) {
  return {
    a: idListSchema,
    b: idListSchema,
    rule: ruleSchema,
    // What the rule actually read. An empty list is a match with no stated basis, and
    // invariant 8 holds for a submission as much as for the corpus: an unexplained match does
    // not pass the schema on either side.
    fields_used: z.array(z.string().min(1)).min(1),
    // Money, not a bare number: a residual without a currency is the kind of amount this
    // project exists to make impossible. Zero residual is money(0, currency).
    residual,
  };
}

function checkMatch(match: { a: readonly string[]; b: readonly string[] }, ctx: z.RefinementCtx) {
  requireDistinct(match.a, 'a', ctx);
  requireDistinct(match.b, 'b', ctx);
}

const unmatchedShape = {
  id: idSchema,
  reason: unmatchedReasonSchema,
};

const ambiguousShape = {
  // Both sides are lists, and either one may hold the contenders. Case E1 - two charges
  // contending for one bank record - is a two-against-one abstention, and a shape that only
  // allowed one A against several B would have no way to write it down.
  a: idListSchema,
  candidates_b: idListSchema,
  reason: ambiguousReasonSchema,
};

type AmbiguousIds = { a: readonly string[]; candidates_b: readonly string[] };

function checkAmbiguousIds(ambiguous: AmbiguousIds, ctx: z.RefinementCtx) {
  requireDistinct(ambiguous.a, 'a', ctx);
  requireDistinct(ambiguous.candidates_b, 'candidates_b', ctx);
}

// Ground-truth policy, and only that: one against one is not an ambiguity, because there the
// answer is a match or an unmatched record. It is a rule about what a *case* may claim, so it
// belongs to expected.json alone. An implementation that abstains one against one is wrong in
// a way the score already names - false_abstain - and rejecting its whole stdout line would
// throw away every correct match in the same case instead of scoring the mistake.
function checkAmbiguousIsAmbiguous(ambiguous: AmbiguousIds, ctx: z.RefinementCtx) {
  checkAmbiguousIds(ambiguous, ctx);

  if (ambiguous.a.length + ambiguous.candidates_b.length < 3) {
    ctx.addIssue({
      code: 'custom',
      message:
        'an ambiguity needs at least two contenders on one side; one against one is a match or an unmatched record',
    });
  }
}

// A record gets one verdict per side. Distinctness inside a single list is not enough: an id
// matched twice, or matched and also reported unmatched, double-counts in a comparison that
// is keyed by id - it would inflate true_match and missed_match at once. Ids inside
// `ambiguous` may repeat across entries (two records can contend for the same counterpart),
// so those are collected as a set and only checked against the resolved ones.
function checkOneVerdictPerId(
  result: {
    matches: readonly { a: readonly string[]; b: readonly string[] }[];
    unmatched_a: readonly { id: string }[];
    unmatched_b: readonly { id: string }[];
    ambiguous: readonly AmbiguousIds[];
  },
  ctx: z.RefinementCtx,
) {
  const sides = [
    {
      name: 'a',
      resolved: [
        ...result.matches.flatMap((match) => match.a),
        ...result.unmatched_a.map((unmatched) => unmatched.id),
      ],
      ambiguous: new Set(result.ambiguous.flatMap((ambiguous) => ambiguous.a)),
    },
    {
      name: 'b',
      resolved: [
        ...result.matches.flatMap((match) => match.b),
        ...result.unmatched_b.map((unmatched) => unmatched.id),
      ],
      ambiguous: new Set(result.ambiguous.flatMap((ambiguous) => ambiguous.candidates_b)),
    },
  ];

  for (const side of sides) {
    const seen = new Set<string>();
    for (const id of side.resolved) {
      if (seen.has(id)) {
        ctx.addIssue({
          code: 'custom',
          message: `id ${JSON.stringify(id)} on side ${side.name} is resolved more than once across matches and unmatched`,
        });
        continue;
      }
      seen.add(id);
    }

    for (const id of side.ambiguous) {
      if (seen.has(id)) {
        ctx.addIssue({
          code: 'custom',
          message: `id ${JSON.stringify(id)} on side ${side.name} is both resolved and listed as ambiguous`,
        });
      }
    }
  }
}

// The corpus side. Strict at every level: a key nobody reads is how ground truth quietly
// stops meaning what its README says.
export const matchSchema = z.strictObject(matchFields(moneySchema)).superRefine(checkMatch);
export const unmatchedSchema = z.strictObject(unmatchedShape);
export const ambiguousSchema = z
  .strictObject(ambiguousShape)
  .superRefine(checkAmbiguousIsAmbiguous);

export const expectedSchema = z
  .strictObject({
    matches: z.array(matchSchema),
    unmatched_a: z.array(unmatchedSchema),
    unmatched_b: z.array(unmatchedSchema),
    ambiguous: z.array(ambiguousSchema),
  })
  .superRefine(checkOneVerdictPerId);

// The submission side. The same field definitions instantiated a second time, so the two
// cannot drift where the comparison lives, but an unknown key is ignored rather than fatal -
// at every level, residual included. A third-party implementation stamping a "confidence" or
// a version on its output should not score zero for the case over a field the runner never
// reads; z.object drops it, so what reaches the comparison is the corpus shape.
//
// What stays enforced is what carries meaning: closed enums, ids as sets, one verdict per id,
// a justification on every match. What is relaxed is the rule about what a *case* may claim
// (see checkAmbiguousIsAmbiguous) - judging a submission is the score's job, and rejecting a
// whole stdout line would throw away the correct matches in it along with the mistake.
export const submissionMatchSchema = z
  .object(matchFields(submissionMoneySchema))
  .superRefine(checkMatch);
export const submissionUnmatchedSchema = z.object(unmatchedShape);
export const submissionAmbiguousSchema = z.object(ambiguousShape).superRefine(checkAmbiguousIds);

export const submissionSchema = z
  .object({
    matches: z.array(submissionMatchSchema),
    unmatched_a: z.array(submissionUnmatchedSchema),
    unmatched_b: z.array(submissionUnmatchedSchema),
    ambiguous: z.array(submissionAmbiguousSchema),
  })
  .superRefine(checkOneVerdictPerId);

export type Rule = z.output<typeof ruleSchema>;
export type UnmatchedReason = z.output<typeof unmatchedReasonSchema>;
export type AmbiguousReason = z.output<typeof ambiguousReasonSchema>;
export type Match = z.output<typeof matchSchema>;
export type Unmatched = z.output<typeof unmatchedSchema>;
export type Ambiguous = z.output<typeof ambiguousSchema>;
export type Expected = z.output<typeof expectedSchema>;
export type ExpectedInput = z.input<typeof expectedSchema>;
export type Submission = z.output<typeof submissionSchema>;
