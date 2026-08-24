import { z } from 'zod';
import { durationSchema } from './duration.ts';

// The policy travels with the case. An implementation that reads tolerance from its own
// config is cheating, so this is the only shape the runner hands it, and every field is
// required: a missing tolerance is not "no tolerance", it is an unanswered question.

export const roundingSchema = z.enum(['half_even']);

export const amountToleranceSchema = z.strictObject({
  // Minor units of the currency being compared. Never a decimal: 2 means two of whatever
  // the ISO 4217 exponent says the minor unit is, which is 2 yen and 2 fils alike.
  absolute_minor_units: z.int().min(0),
  basis_points: z.int().min(0),
});

export const timeWindowSchema = z.strictObject({
  before: durationSchema,
  after: durationSchema,
});

export const fxPolicySchema = z.strictObject({
  round_after_conversion: z.boolean(),
});

export const policySchema = z.strictObject({
  amount_tolerance: amountToleranceSchema,
  time_window: timeWindowSchema,
  rounding: roundingSchema,
  fx: fxPolicySchema,
});

export type Policy = z.output<typeof policySchema>;
export type PolicyInput = z.input<typeof policySchema>;
export type Rounding = z.output<typeof roundingSchema>;
