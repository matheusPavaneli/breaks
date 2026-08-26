import { z } from 'zod';
import { submissionSchema } from './expected.ts';
import { policySchema } from './policy.ts';
import { settlementRecordListSchema } from './record.ts';

// The runner speaks to an implementation over a process boundary: one JSON line in, one
// JSON line out. Both sides are untrusted here - the case file may be hand-written and the
// implementation is someone else's program - so both are parsed, never cast.

export const runnerInputSchema = z.strictObject({
  case_id: z.string().min(1),
  policy: policySchema,
  records_a: settlementRecordListSchema,
  records_b: settlementRecordListSchema,
});

// The submission shape rather than the corpus one: same fields, built from the same
// definitions, but an unknown key on someone else's output is ignored instead of scoring the
// case zero. What survives parsing is the corpus shape, so the comparison is unaffected.
export const runnerOutputSchema = submissionSchema;

export type RunnerInput = z.output<typeof runnerInputSchema>;
export type RunnerInputPayload = z.input<typeof runnerInputSchema>;
export type RunnerOutput = z.output<typeof runnerOutputSchema>;
