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
  metadata: z.record(z.string(), z.string()),
});

export type Ref = z.output<typeof refSchema>;
export type RefType = z.output<typeof refTypeSchema>;
export type Source = z.output<typeof sourceSchema>;
export type Category = z.output<typeof categorySchema>;
export type Status = z.output<typeof statusSchema>;
export type SettlementRecord = z.output<typeof settlementRecordSchema>;
export type SettlementRecordInput = z.input<typeof settlementRecordSchema>;
