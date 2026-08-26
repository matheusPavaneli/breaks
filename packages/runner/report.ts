import { createHash } from 'node:crypto';
import type { CorpusCase } from './case.ts';
import { DEFAULT_TIMEOUT_MS, type FailureReason, type Implementation } from './protocol.ts';
import { scoreSubmission, ZERO_COUNTERS, type Counters, type Score } from './score.ts';

// The result of a run, in a shape that hashes to the same bytes whatever order the inputs
// arrived in. CLAUDE.md invariant 5 is a property of this file as much as of the engine: if
// the report is not stable, "same input, same output" cannot be tested at all.

export type CaseStatus =
  /** The implementation answered and the answer was scored. */
  | 'scored'
  /** The implementation failed to answer. Its own fault, and it scores zero. */
  | 'failed'
  /**
   * The runner never got the case to the implementation - a corpus or runner defect.
   *
   * Kept apart from `failed` because scoring a participant zero for a case nobody could
   * receive would put a corpus bug on their leaderboard row. It is excluded from the
   * aggregate and counted in its own column instead.
   */
  | 'errored';

export type CaseResult = {
  readonly case_id: string;
  readonly status: CaseStatus;
  /** Why the run produced nothing, or null when it produced a submission. */
  readonly reason: FailureReason | null;
  /** The runner's own one-line account of the failure. Empty for a scored case. */
  readonly detail: string;
  /**
   * What the implementation left on stderr, tail only, capped by the protocol.
   *
   * Carried through to the result rather than dropped: for a participant debugging a failing
   * case, "exit code 3" is not a diagnostic and the line their own program printed is.
   */
  readonly stderr: string;
  readonly timeout_ms: number;
  /**
   * Honest, and false on purpose: SPEC.md section 5 asks the runner to disable the network
   * where the OS allows it, and this slice does not. The flag exists so the leaderboard can
   * say so rather than let the absence pass for a guarantee.
   */
  readonly network_isolated: boolean;
  readonly counters: Counters;
  readonly settlement_score_raw: number;
  readonly settlement_score: number;
  readonly explainability: number | null;
};

export type CorpusReport = {
  readonly cases: readonly CaseResult[];
  readonly counters: Counters;
  /** Decision 1: the mean of the per-case normalised scores - one case, one vote. */
  readonly settlement_score: number;
  /** Decision 5: failures get their own column instead of hiding inside the mean. */
  readonly failed_cases: number;
  readonly scored_cases: number;
  /** Cases the runner could not deliver at all. Excluded from `settlement_score` entirely. */
  readonly errored_cases: number;
  readonly explainability: number | null;
};

/**
 * Decision 5: a run that produced nothing scores nothing.
 *
 * Every counter at zero and a normalised score of zero, so crashing can never outrank an
 * implementation that answered and was wrong in only one place - and never rank below one
 * that answered and was wrong everywhere, which is what counting a `missed_match` per
 * expected pair would have done.
 */
export function failedResult(
  case_id: string,
  reason: FailureReason,
  detail: string,
  timeoutMs: number,
  stderr = '',
): CaseResult {
  return {
    case_id,
    // `input_rejected` is the runner's own failure to hand over the case, so it is not the
    // implementation's zero to carry.
    status: reason === 'input_rejected' ? 'errored' : 'failed',
    reason,
    detail,
    stderr,
    timeout_ms: timeoutMs,
    network_isolated: false,
    counters: ZERO_COUNTERS,
    settlement_score_raw: 0,
    settlement_score: 0,
    explainability: null,
  };
}

function scoredResult(case_id: string, score: Score, timeoutMs: number): CaseResult {
  return {
    case_id,
    status: 'scored',
    reason: null,
    detail: '',
    stderr: '',
    timeout_ms: timeoutMs,
    network_isolated: false,
    counters: score.counters,
    settlement_score_raw: score.settlement_score_raw,
    settlement_score: score.settlement_score,
    explainability: score.explainability,
  };
}

export type RunCaseOptions = {
  readonly timeoutMs?: number;
};

/** Hand one case to an implementation and score whatever comes back. */
export async function runCase(
  corpusCase: CorpusCase,
  implementation: Implementation,
  options: RunCaseOptions = {},
): Promise<CaseResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const outcome = await implementation(
    {
      case_id: corpusCase.case_id,
      policy: corpusCase.policy,
      records_a: [...corpusCase.records_a],
      records_b: [...corpusCase.records_b],
    },
    { timeoutMs },
  );

  if (outcome.status === 'failed') {
    return failedResult(corpusCase.case_id, outcome.reason, outcome.detail, timeoutMs, outcome.stderr);
  }

  return scoredResult(corpusCase.case_id, scoreSubmission(corpusCase.expected, outcome.submission), timeoutMs);
}

function addCounters(left: Counters, right: Counters): Counters {
  return {
    true_match: left.true_match + right.true_match,
    false_match: left.false_match + right.false_match,
    missed_match: left.missed_match + right.missed_match,
    correct_abstain: left.correct_abstain + right.correct_abstain,
    false_abstain: left.false_abstain + right.false_abstain,
  };
}

/**
 * Aggregate per-case results into one report.
 *
 * Cases are sorted by `case_id`, so the order the corpus was walked in - which depends on the
 * filesystem - cannot reach the hash. The aggregate score is the mean over every case,
 * failures included at zero; the explainability tie-break averages only the cases that had a
 * correct decision to explain, and is null when none did.
 */
export function buildCorpusReport(results: readonly CaseResult[]): CorpusReport {
  // Sorting by a key two cases can share would leave their relative order decided by the walk
  // - which is filesystem order - and put it straight into the hash this function exists to
  // stabilise. A duplicate id is a corpus defect, so it is refused rather than tie-broken.
  const seen = new Set<string>();
  for (const result of results) {
    if (seen.has(result.case_id)) {
      throw new TypeError(`duplicate case id in the report: ${JSON.stringify(result.case_id)}`);
    }
    seen.add(result.case_id);
  }

  const cases = [...results].toSorted((left, right) => (left.case_id < right.case_id ? -1 : 1));

  const counters = cases.reduce<Counters>((acc, result) => addCounters(acc, result.counters), ZERO_COUNTERS);
  const failed_cases = cases.filter((result) => result.status === 'failed').length;
  const errored_cases = cases.filter((result) => result.status === 'errored').length;
  const ranked = cases.filter((result) => result.status !== 'errored');
  const explainable = cases.filter((result) => result.explainability !== null);

  return {
    cases,
    counters,
    settlement_score:
      ranked.length === 0
        ? 0
        : ranked.reduce((acc, result) => acc + result.settlement_score, 0) / ranked.length,
    failed_cases,
    scored_cases: cases.length - failed_cases - errored_cases,
    errored_cases,
    explainability:
      explainable.length === 0
        ? null
        : explainable.reduce((acc, result) => acc + (result.explainability ?? 0), 0) /
          explainable.length,
  };
}

/**
 * JSON with object keys in sorted order.
 *
 * Key order is not semantic anywhere in this report, and leaving it to insertion order would
 * make the hash depend on which branch of the code happened to build the object. Array order
 * *is* semantic here - `cases` is sorted deliberately - so arrays are left alone.
 */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .toSorted(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));

  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(',')}}`;
}

/** sha-256 of the stable serialisation - the value the determinism test compares. */
export function reportHash(report: CorpusReport): string {
  return createHash('sha256').update(stableStringify(report), 'utf8').digest('hex');
}
