import { z } from 'zod';
import { expectedSchema } from './expected.ts';
import { policySchema } from './policy.ts';
import { settlementRecordSchema } from './record.ts';

// The runner speaks to an implementation over a process boundary: one JSON line in, one
// JSON line out. Both sides are untrusted here - the case file may be hand-written and the
// implementation is someone else's program - so both are parsed, never cast.

export const runnerInputSchema = z.strictObject({
  case_id: z.string().min(1),
  policy: policySchema,
  records_a: z.array(settlementRecordSchema),
  records_b: z.array(settlementRecordSchema),
});

// Deliberately the same shape as expected.json rather than a parallel definition: the
// runner compares one against the other, and two definitions would drift apart exactly
// where the comparison stops being meaningful.
export const runnerOutputSchema = expectedSchema;

export type RunnerInput = z.output<typeof runnerInputSchema>;
export type RunnerInputPayload = z.input<typeof runnerInputSchema>;
export type RunnerOutput = z.output<typeof runnerOutputSchema>;
