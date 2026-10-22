/**
 * APEX Universal Business State — primitive types.
 *
 * Conventions (enforced across the whole engine):
 *  - ALL money is integer minor units (`Cents`). Floats never touch the ledger.
 *  - 1 tick = 1 day. Calendar is a 30/360 banking calendar (12 x 30-day months).
 *  - Ratios are fractions in [0, 1] unless stated otherwise.
 */
import { z } from "zod";

export const Id = z.string().min(1);
export type Id = z.infer<typeof Id>;

/** Integer minor currency units (e.g. cents). */
export const Cents = z.number().int();
export type Cents = z.infer<typeof Cents>;

export const Tick = z.number().int().min(0);
export type Tick = z.infer<typeof Tick>;

export const Ratio = z.number().min(0).max(1);
export const NonNeg = z.number().min(0);
export const Maturity = z.number().min(1).max(5);

/** Stochastic parameter. Sampled exclusively through the seeded PRNG. */
export const Distribution = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("fixed"), value: z.number() }),
  z.object({
    kind: z.literal("normal"),
    mean: z.number(),
    sd: z.number().min(0),
    min: z.number().optional(),
  }),
  z.object({
    kind: z.literal("triangular"),
    min: z.number(),
    mode: z.number(),
    max: z.number(),
  }),
]);
export type Distribution = z.infer<typeof Distribution>;

/** 12 monthly demand multipliers (Jan..Dec). */
export const Seasonality = z.array(z.number().min(0)).length(12);

export const HandlingClass = z.enum(["ambient", "chilled", "frozen", "hazmat", "oversize"]);
export type HandlingClass = z.infer<typeof HandlingClass>;

export const FreightMode = z.enum(["ocean", "rail", "ftl", "ltl", "air", "courier", "own_fleet"]);
export type FreightMode = z.infer<typeof FreightMode>;

export const Sourcing = z.enum(["insourced", "outsourced"]);
export type Sourcing = z.infer<typeof Sourcing>;
