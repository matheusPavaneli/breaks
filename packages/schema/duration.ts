import { z } from 'zod';

// policy.json states its time window as an ISO 8601 duration ("PT0S", "P3D"). Only the
// fixed-length designators are accepted: a year or a month is not a number of seconds
// (Feb vs Jul, leap years), so a window of "P1M" would mean a different tolerance
// depending on when the case is run, and this corpus is deterministic by contract.
//
// Fractional components are rejected for the other invariant: "PT0.5S" would have to
// become a float somewhere, and no float is allowed in the engine's inputs.

const SECONDS_PER_WEEK = 604800;
const SECONDS_PER_DAY = 86400;
const SECONDS_PER_HOUR = 3600;
const SECONDS_PER_MINUTE = 60;

// Bounded: a case file is untrusted input, and an unbounded digit run has no business
// reaching the parser. 64 characters is far past any window a real policy declares.
const MAX_LENGTH = 64;

const PATTERN =
  /^P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/;

export class InvalidDurationError extends Error {
  readonly input: string;

  constructor(input: string, reason: string) {
    super(`invalid ISO 8601 duration ${JSON.stringify(input)}: ${reason}`);
    this.name = 'InvalidDurationError';
    this.input = input;
  }
}

function componentSeconds(raw: string | undefined, multiplier: number): number {
  if (raw === undefined) return 0;
  return Number(raw) * multiplier;
}

/**
 * Parse an ISO 8601 duration into whole seconds.
 *
 * Accepts weeks, days, hours, minutes and seconds. Rejects years, months, fractional
 * components, a sign, and a duration with no component at all ("P", "PT", "P1DT").
 */
export function parseIso8601Duration(input: string): number {
  if (input.length > MAX_LENGTH) {
    throw new InvalidDurationError(input, `longer than ${String(MAX_LENGTH)} characters`);
  }

  const match = PATTERN.exec(input);
  if (match === null) {
    throw new InvalidDurationError(
      input,
      'only P[nW][nD][T[nH][nM][nS]] is accepted; years, months, fractions and signs are not',
    );
  }

  const [, weeks, days, hours, minutes, seconds] = match;
  const hasTimePart = hours !== undefined || minutes !== undefined || seconds !== undefined;
  if (weeks === undefined && days === undefined && !hasTimePart) {
    throw new InvalidDurationError(input, 'no component; a duration needs at least one');
  }
  // "P1DT" matches the pattern but is not a duration: the time designator has to be
  // followed by a time component.
  if (input.includes('T') && !hasTimePart) {
    throw new InvalidDurationError(input, 'the time designator T carries no component');
  }

  const total =
    componentSeconds(weeks, SECONDS_PER_WEEK) +
    componentSeconds(days, SECONDS_PER_DAY) +
    componentSeconds(hours, SECONDS_PER_HOUR) +
    componentSeconds(minutes, SECONDS_PER_MINUTE) +
    componentSeconds(seconds, 1);

  if (!Number.isSafeInteger(total)) {
    throw new InvalidDurationError(input, 'total exceeds the safe integer range');
  }

  return total;
}

export type Duration = {
  /** The literal string from the case file, kept so the policy round-trips byte-identical. */
  readonly iso: string;
  readonly seconds: number;
};

export const durationSchema = z.string().transform((value, ctx): Duration => {
  try {
    return { iso: value, seconds: parseIso8601Duration(value) };
  } catch (cause) {
    ctx.addIssue({
      code: 'custom',
      message: cause instanceof Error ? cause.message : String(cause),
      params: { cause },
    });
    return z.NEVER;
  }
});
