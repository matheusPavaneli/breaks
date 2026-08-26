import { z } from 'zod';
import { fxLegSchema, moneySchema } from './money.ts';

// Every object here is strict. A case file that carries a field this schema does not know
// is a case file whose author expected the engine to read something it never reads, and a
// silently ignored key is exactly how a corpus stops meaning what its README says.

export const refTypeSchema = z.enum([
  'charge',
  'refund',
  'dispute',
  'payout',
  'transfer',
  'order',
  'invoice',
  'external',
]);

export const refSchema = z.strictObject({
  type: refTypeSchema,
  id: z.string().min(1),
});

export const sourceSchema = z.enum(['psp', 'bank', 'ledger']);

export const categorySchema = z.enum([
  'charge',
  'refund',
  'dispute',
  'dispute_reversal',
  'fee',
  'payout',
  'payout_failure',
  'payout_reversal',
  'transfer',
  'topup',
  'adjustment',
]);

export const statusSchema = z.enum(['pending', 'available', 'failed', 'reversed']);

// RFC3339 with an offset, never a bare local timestamp: case E9 is a record whose timezone
// is wrong, and a wrong timezone needs a field where the timezone exists at all.
const timestampSchema = z.iso.datetime({ offset: true });

// JSON.parse('{"__proto__": ...}') produces an own property that z.record drops on the floor
// rather than copying, to avoid prototype pollution. Dropping it silently is the failure this
// file's strict objects exist to prevent: an implementation reading the case file with a raw
// JSON.parse would see a key the reference engine never does, and the two would disagree
// about their own input. So it is rejected here, loudly, instead.
const metadataSchema = z
  .unknown()
  .superRefine((value, ctx) => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return;
    for (const key of Object.getOwnPropertyNames(value)) {
      if (key === '__proto__') {
        ctx.addIssue({
          code: 'custom',
          message: 'metadata must not carry a __proto__ key',
        });
      }
    }
  })
  .pipe(z.record(z.string(), z.string()));

export const settlementRecordSchema = z.strictObject({
  id: z.string().min(1),
  source: sourceSchema,
  source_system: z.string().min(1),
  // Reprocessing increments it (case E7), so the first version of a record is 1, not 0.
  version: z.int().min(1),
  occurred_at: timestampSchema,
  settled_at: timestampSchema.nullable(),
  gross: moneySchema,
  // null means the source did not report the leg. It never means zero: a fee of zero and
  // an unreported fee are different facts, and category B turns on the difference.
  fee: moneySchema.nullable(),
  net: moneySchema.nullable(),
  fx: fxLegSchema.nullable(),
  category: categorySchema,
  status: statusSchema,
  references: z.array(refSchema),
  metadata: metadataSchema,
});

/**
 * One side of a case: input_a.json, input_b.json, or one half of a runner request.
 *
 * Ids are unique within the list. SPEC.md states the invariant for the record itself ("unico
 * dentro de (source_system, source)"), and expected.json leans on it: every reference there -
 * matches.a, unmatched.id, ambiguous.candidates_b - is a bare id string. With two records
 * sharing one id, "a": ["ch_1"] no longer names a single record, the case has no single
 * ground truth, and the runner's id-based comparison double-counts it.
 */
export const settlementRecordListSchema = z
  .array(settlementRecordSchema)
  .superRefine((records, ctx) => {
    const seen = new Set<string>();
    records.forEach((record, index) => {
      if (seen.has(record.id)) {
        ctx.addIssue({
          code: 'custom',
          path: [index, 'id'],
          message: `duplicate record id ${JSON.stringify(record.id)} on this side`,
        });
        return;
      }
      seen.add(record.id);
    });
  });

export type Ref = z.output<typeof refSchema>;
export type RefType = z.output<typeof refTypeSchema>;
export type Source = z.output<typeof sourceSchema>;
export type Category = z.output<typeof categorySchema>;
export type Status = z.output<typeof statusSchema>;
export type SettlementRecord = z.output<typeof settlementRecordSchema>;
export type SettlementRecordInput = z.input<typeof settlementRecordSchema>;
