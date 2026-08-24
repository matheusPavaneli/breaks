import {
  exponentOf,
  fxRate,
  isSupportedCurrency,
  money,
  type FxRate,
  type Money,
} from '@breaks/money';
import { z } from 'zod';

// Every monetary schema ends in a transform through the @breaks/money factory. Money and
// FxRate are branded there, so an object literal out of JSON.parse cannot stand in for one:
// the validation in money() and fxRate() is the only way to mint a value, and this file
// exists to make a case file take that route.

function reject(ctx: z.RefinementCtx, message: string, cause: unknown): never {
  ctx.addIssue({ code: 'custom', message, params: { cause } });
  return z.NEVER;
}

const moneyFields = {
  amount: z.int(),
  currency: z.string(),
  exponent: z.union([z.literal(0), z.literal(2), z.literal(3)]),
};

function toMoney(
  value: { amount: number; currency: string; exponent: 0 | 2 | 3 },
  ctx: z.RefinementCtx,
): Money {
  if (!isSupportedCurrency(value.currency)) {
    ctx.addIssue({
      code: 'custom',
      message: `unknown ISO 4217 currency: ${value.currency}`,
    });
    return z.NEVER;
  }

  // The exponent is redundant with the ISO 4217 table on purpose: a case file that declares
  // one is asserting which minor unit it meant, and a mismatch is the bug the assertion is
  // there to catch (2 for JPY, 2 for KWD), not a value to silently correct.
  const expected = exponentOf(value.currency);
  if (value.exponent !== expected) {
    ctx.addIssue({
      code: 'custom',
      message: `exponent ${String(value.exponent)} does not match the ISO 4217 minor unit of ${value.currency}, which is ${String(expected)}`,
    });
    return z.NEVER;
  }

  try {
    return money(value.amount, value.currency);
  } catch (cause) {
    return reject(ctx, `rejected by @breaks/money: ${String(cause)}`, cause);
  }
}

export const moneySchema = z.strictObject(moneyFields).transform(toMoney);

// The same fields with an unknown key ignored instead of fatal. A third-party implementation
// that decorates its residual with a formatted string or a provider tag should not score zero
// for the case over a field the runner never reads; what survives parsing is a Money either
// way, so the comparison sees exactly the same value.
export const submissionMoneySchema = z.object(moneyFields).transform(toMoney);

const fxRateShape = z.strictObject({
  num: z.int(),
  den: z.int(),
  from: z.string(),
  to: z.string(),
  quoted_at: z.iso.datetime({ offset: true }).optional(),
});

export const fxRateSchema = fxRateShape.transform((value, ctx): FxRate => {
  try {
    return fxRate(value.num, value.den, value.from, value.to, value.quoted_at);
  } catch (cause) {
    return reject(ctx, `rejected by @breaks/money: ${String(cause)}`, cause);
  }
});

const fxLegShape = z.strictObject({
  rate: fxRateSchema,
  presentment: moneySchema,
  settlement: moneySchema,
});

export const fxLegSchema = fxLegShape.superRefine((leg, ctx) => {
  // A rate whose ends do not match the two legs converts nothing: it would turn a EUR
  // presentment into a USD settlement by assertion rather than by arithmetic.
  if (leg.rate.from !== leg.presentment.currency) {
    ctx.addIssue({
      code: 'custom',
      path: ['rate', 'from'],
      message: `rate.from ${leg.rate.from} does not match the presentment currency ${leg.presentment.currency}`,
    });
  }
  if (leg.rate.to !== leg.settlement.currency) {
    ctx.addIssue({
      code: 'custom',
      path: ['rate', 'to'],
      message: `rate.to ${leg.rate.to} does not match the settlement currency ${leg.settlement.currency}`,
    });
  }
});

export type MoneyInput = z.input<typeof moneySchema>;
export type FxRateInput = z.input<typeof fxRateSchema>;
export type FxLeg = z.output<typeof fxLegSchema>;
