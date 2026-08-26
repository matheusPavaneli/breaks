import { equals } from '@breaks/money';
import type { Expected, Submission } from '@breaks/schema';

// SPEC.md section 3: four numbers, five counters, never collapsed into one. The seven
// semantics SPEC.md leaves open were settled by the maintainer on 2026-08-26 and are
// implemented here; each is marked with the decision it comes from. Changing one of them is a
// versioned metric change that moves with the corpus, not a bug fix in this file.

/**
 * The weight on a false match, from SPEC.md section 3.
 *
 * Exported as a constant and read from here alone: a scorer that let an implementation supply
 * its own weight would let it price its own mistakes.
 */
export const FALSE_MATCH_WEIGHT = 5;

export type Counters = {
  readonly true_match: number;
  readonly false_match: number;
  readonly missed_match: number;
  readonly correct_abstain: number;
  readonly false_abstain: number;
};

export type Score = {
  readonly counters: Counters;
  /** `true_match - 5*false_match - missed_match`, before normalisation. Always an integer. */
  readonly settlement_score_raw: number;
  /** Decision 1: the raw score over the number of expected matches. */
  readonly settlement_score: number;
  /** Decision 6: null rather than 1 when there was no correct decision to justify. */
  readonly explainability: number | null;
};

export const ZERO_COUNTERS: Counters = {
  true_match: 0,
  false_match: 0,
  missed_match: 0,
  correct_abstain: 0,
  false_abstain: 0,
};

/**
 * The identity of a match: two sets of ids, not two lists.
 *
 * Order of records, order of matches and order of ids inside a match are all presentation.
 * Sorting before keying is what makes the score invariant under every shuffle the
 * determinism test throws at it. Ids are already distinct within a list - the schema refuses
 * a repeat - so a sorted join is a faithful set.
 */
function setKey(a: readonly string[], b: readonly string[]): string {
  return `${JSON.stringify(a.toSorted())}|${JSON.stringify(b.toSorted())}`;
}

/**
 * Set equality, in both directions.
 *
 * `fields_used` carries no distinctness constraint in the schema, so comparing lengths and
 * one-way containment is not a set comparison: `['gross', 'occurred_at']` against
 * `['gross', 'gross']` would pass it. The sets are built first and compared both ways.
 */
function sameFieldSet(left: readonly string[], right: readonly string[]): boolean {
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  if (leftSet.size !== rightSet.size) return false;
  for (const value of leftSet) {
    if (!rightSet.has(value)) return false;
  }
  return true;
}

type MatchTally = {
  true_match: number;
  false_match: number;
  missed_match: number;
  justified: number;
};

/**
 * Decisions 2 and 3.
 *
 * Set equality is binary: a submitted grouping that overlaps an expected one without being it
 * is a wrong claim *and* leaves the expected pair unfound, so it pays `false_match` and
 * `missed_match` both. On an identical set the residual decides - it is an arithmetic claim,
 * and a wrong one is a wrong match - while a divergent `rule` costs explainability only,
 * because the pair itself is right.
 *
 * A wrong residual on the right sets therefore scores worse than silence: no `true_match`,
 * one `false_match`, and no `missed_match` because the pair was in fact named. That is the
 * project's thesis about false positives applied to its own arithmetic.
 */
function tallyMatches(expected: Expected, submission: Submission): MatchTally {
  const expectedByKey = new Map(expected.matches.map((match) => [setKey(match.a, match.b), match]));
  const tally: MatchTally = { true_match: 0, false_match: 0, missed_match: 0, justified: 0 };
  // Every expected pair the submission actually named, whether or not the residual on it was
  // right. A pair named with wrong arithmetic is a wrong claim, not an absent one, so it pays
  // the weight once and is not also counted as missed.
  const named = new Set<string>();

  for (const submitted of submission.matches) {
    const key = setKey(submitted.a, submitted.b);
    const expectedMatch = expectedByKey.get(key);

    if (expectedMatch === undefined) {
      tally.false_match += 1;
      continue;
    }

    // One expected pair can be credited once. The submission schema already refuses an id
    // resolved twice across matches, so a repeat cannot reach here today; the guard is here
    // because the score must not depend on that holding, and the same padding trick is live
    // on the abstention side.
    if (named.has(key)) {
      tally.false_match += 1;
      continue;
    }

    named.add(key);

    if (!equals(submitted.residual, expectedMatch.residual)) {
      tally.false_match += 1;
      continue;
    }

    tally.true_match += 1;
    if (
      submitted.rule === expectedMatch.rule &&
      sameFieldSet(submitted.fields_used, expectedMatch.fields_used)
    ) {
      tally.justified += 1;
    }
  }

  for (const key of expectedByKey.keys()) {
    if (!named.has(key)) tally.missed_match += 1;
  }

  return tally;
}

type AbstainTally = {
  correct_abstain: number;
  false_abstain: number;
  justified: number;
};

/**
 * Decisions 4 and 7.
 *
 * An abstention is judged on the sets it names - which record, against which candidates -
 * because that is the part another implementation can be compared against. A divergent
 * `reason` on the right sets is a correct abstention that is worse explained, not a wrong
 * one, so it moves the tie-break and nothing else.
 *
 * `correct_abstain` and `false_abstain` stay out of `settlement_score` exactly as SPEC.md
 * section 3 has them: reported raw, never folded into the ordering.
 */
function tallyAbstentions(expected: Expected, submission: Submission): AbstainTally {
  const expectedByKey = new Map(
    expected.ambiguous.map((entry) => [setKey(entry.a, entry.candidates_b), entry]),
  );
  const tally: AbstainTally = { correct_abstain: 0, false_abstain: 0, justified: 0 };
  // An expected abstention is worth exactly one correct abstention. The submission schema
  // lets the same ambiguity be listed repeatedly - ids inside `ambiguous` may legitimately
  // repeat across entries, so `checkOneVerdictPerId` cannot refuse it - and without this set
  // a padded output would buy `correct_abstain` and `explainability` by the copy. Since
  // explainability is the published tie-break, that was a free ranking win.
  const credited = new Set<string>();

  for (const submitted of submission.ambiguous) {
    const key = setKey(submitted.a, submitted.candidates_b);
    const expectedEntry = expectedByKey.get(key);
    if (expectedEntry === undefined || credited.has(key)) {
      tally.false_abstain += 1;
      continue;
    }
    credited.add(key);
    tally.correct_abstain += 1;
    if (submitted.reason === expectedEntry.reason) tally.justified += 1;
  }

  return tally;
}

/**
 * Decision 1.
 *
 * The raw score is divided by the number of matches the case actually contains, so one case
 * is one vote however many pairs it holds. A case whose ground truth is "nothing matches"
 * has no denominator: getting it right is a full mark, and the only way to score below that
 * is to have claimed a match, which is already priced at the weight.
 */
export function normaliseSettlementScore(raw: number, expectedMatchCount: number): number {
  if (expectedMatchCount > 0) return raw / expectedMatchCount;
  return raw === 0 ? 1 : raw;
}

/**
 * Score one submission against one case's ground truth.
 *
 * `expected` comes from the case file and is only ever read here. The runner is not the
 * oracle: nothing in this direction writes back.
 */
export function scoreSubmission(expected: Expected, submission: Submission): Score {
  const matches = tallyMatches(expected, submission);
  const abstentions = tallyAbstentions(expected, submission);

  const counters: Counters = {
    true_match: matches.true_match,
    false_match: matches.false_match,
    missed_match: matches.missed_match,
    correct_abstain: abstentions.correct_abstain,
    false_abstain: abstentions.false_abstain,
  };

  const settlement_score_raw =
    counters.true_match - FALSE_MATCH_WEIGHT * counters.false_match - counters.missed_match;

  // Decision 6: the denominator is the decisions that were counted correct. Justifying a
  // wrong match well must not buy a tie-break, and an implementation that abstained from
  // everything has nothing to be explainable about.
  const correctDecisions = counters.true_match + counters.correct_abstain;
  const explainability =
    correctDecisions === 0 ? null : (matches.justified + abstentions.justified) / correctDecisions;

  return {
    counters,
    settlement_score_raw,
    settlement_score: normaliseSettlementScore(settlement_score_raw, expected.matches.length),
    explainability,
  };
}
