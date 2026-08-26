import { z } from 'zod';

// policy.json states its time window as an ISO 8601 duration ("PT0S", "P3D"). Only the
// fixed-length designators are accepted: a year or a month is not a number of seconds
// (Feb vs Jul, leap years), so a window of "P1M" would mean a different tolerance
// depending on when the case is run, and this corpus is deterministic by contract.
//
// Fractional components are rejected for the other invariant: "PT0.5S" would have to
// become a float somewhere, and no float is allowed in the engine's inputs.
//
// The week designator is rejected too, for a reason that has nothing to do with arithmetic:
// this string crosses a process boundary into implementations in other languages, and
// java.time.Duration.parse refuses "W" outright. "P7D" says the same thing everywhere. ISO
// 8601 also makes the week form exclusive, which "P1W1D" would violate.

const SECONDS_PER_DAY = 86400;
const SECONDS_PER_HOUR = 3600;
const SECONDS_PER_MINUTE = 60;

// Bounded: a case file is untrusted input, and an unbounded digit run has no business
// reaching the parser. 64 characters is far past any window a real policy declares.
const MAX_LENGTH = 64;

const PATTERN = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/;

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
 * Accepts days, hours, minutes and seconds. Rejects years, months, weeks, fractional
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
      'only P[nD][T[nH][nM][nS]] is accepted; years, months, weeks, fractions and signs are not',
    );
  }

  const [, days, hours, minutes, seconds] = match;
  const hasTimePart = hours !== undefined || minutes !== undefined || seconds !== undefined;
  if (days === undefined && !hasTimePart) {
    throw new InvalidDurationError(input, 'no component; a duration needs at least one');
  }
  // "P1DT" matches the pattern but is not a duration: the time designator has to be
  // followed by a time component.
  if (input.includes('T') && !hasTimePart) {
    throw new InvalidDurationError(input, 'the time designator T carries no component');
  }

  const total =
    componentSeconds(days, SECONDS_PER_DAY) +
    componentSeconds(hours, SECONDS_PER_HOUR) +
    componentSeconds(minutes, SECONDS_PER_MINUTE) +
    componentSeconds(seconds, 1);

  if (!Number.isSafeInteger(total)) {
    throw new InvalidDurationError(input, 'total exceeds the safe integer range');
  }

  return total;
}

/**
 * A duration validated but left exactly as it was written.
 *
 * The schema does not convert: the runner hands the policy on to the implementation as JSON
 * (SPEC.md section 5), so a parsed policy has to serialise back to the bytes it arrived as.
 * A schema returning `{ iso, seconds }` would make the output of `runnerInputSchema` invalid
 * as its own input. Seconds come from `parseIso8601Duration` at the point of use.
 */
export const durationSchema = z.string().superRefine((value, ctx) => {
  try {
    parseIso8601Duration(value);
  } catch (cause) {
    ctx.addIssue({
      code: 'custom',
      message: cause instanceof Error ? cause.message : String(cause),
      params: { cause },
    });
  }
});
