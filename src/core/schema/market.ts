/**
 * Market: macro-economy, customer segments (utility-based choice), player presence, AI competitors.
 */
import { z } from "zod";
import { Cents, Distribution, Id, NonNeg, Ratio, Seasonality, Tick } from "./primitives";

export const MacroState = z.object({
  baseRateBps: z.number(),
  inflationAnnual: z.number(),
  materialPriceIndex: z.number().positive(),
  wageIndex: z.number().positive(),
  demandIndex: z.number().positive(),
  cyclePhase: z.enum(["expansion", "slowdown", "contraction", "recovery"]),
  cycleDay: z.number().int().min(0),
});
export type MacroState = z.infer<typeof MacroState>;

/** Multinomial-logit utility weights. Price enters as -w.price * (price / wtpMean). */
export const UtilityWeights = z.object({
  price: NonNeg,
  quality: NonNeg,
  speed: NonNeg,
  availability: NonNeg,
  brand: NonNeg,
});

const Stages = z.object({ lead: z.number(), qualified: z.number(), proposal: z.number(), negotiation: z.number() });

export const B2BProfile = z.object({
  avgDealUnitsPerMonth: Distribution,
  contractMonths: z.number().int().positive(),
  /** Probability of advancing out of each stage. */
  stageConversion: Stages,
  /** Days spent in each stage before a decision. */
  stageDays: Stages,
  maxDiscount: Ratio,
  slaFillRate: Ratio,
  penaltyPct: Ratio,
  renewalBase: Ratio,
});
export type B2BProfile = z.infer<typeof B2BProfile>;

export const Segment = z.object({
  id: Id,
  name: z.string(),
  kind: z.enum(["b2c", "b2b"]),
  region: z.string(),
  tamUnitsPerYear: NonNeg,
  samUnitsPerYear: NonNeg,
  /** In-market shoppers per day in the SAM (before choice; includes the outside option). */
  baseDailyDemand: NonNeg,
  growthAnnual: z.number(),
  seasonality: Seasonality,
  wtpMean: Cents.positive(),
  weights: UtilityWeights,
  /** Utility of not buying / substitutes. Drives category-level price elasticity. */
  outsideOptionUtility: z.number(),
  /** Loyalty inertia; higher → customers stick with last period's choice. */
  switchingCost: Ratio,
  maxDeliveryDays: z.number().positive(),
  /** B2C patience: unfilled spot orders cancel after this many days (stockout churn). */
  maxWaitDays: z.number().int().min(0),
  avgOrderQty: z.number().positive(),
  defaultRatePct: Ratio,
  b2b: B2BProfile.optional(),
});
export type Segment = z.infer<typeof Segment>;

/** Player's commercial position in a segment. */
export const Presence = z.object({
  segmentId: Id,
  awareness: Ratio,
  brandEquity: Ratio,
  availabilityScore: Ratio,
  /** Player share of purchases (excluding outside option). */
  marketShare: Ratio,
  lastShares: z.record(z.string(), Ratio),
  potentialToday: NonNeg,
  customers: NonNeg,
});
export type Presence = z.infer<typeof Presence>;

export const CompetitorArchetype = z.enum([
  "cost_leader",
  "blitzscaler",
  "premium_artisan",
  "fast_follower",
  "regional_incumbent",
]);
export type CompetitorArchetype = z.infer<typeof CompetitorArchetype>;

export const CompetitorOffering = z.object({
  segmentId: Id,
  price: Cents.positive(),
  quality: Ratio,
  deliveryDays: NonNeg,
  availability: Ratio,
  awareness: Ratio,
  brand: Ratio,
  unitsToday: NonNeg,
});
export type CompetitorOffering = z.infer<typeof CompetitorOffering>;

export const Competitor = z.object({
  id: Id,
  name: z.string(),
  archetype: CompetitorArchetype,
  persona: z.string(),
  cash: Cents,
  fixedCostPerDay: Cents.min(0),
  unitCost: Cents.min(0),
  capacityUnitsPerDay: NonNeg,
  aggression: Ratio,
  priceFloorMargin: z.number(),
  offerings: z.array(CompetitorOffering),
  /** Weekly total share snapshots (most recent last, max 8). */
  shareHistory: z.array(z.number()),
  strategyMemo: z.string(),
  lastMoveTick: Tick,
  bankrupt: z.boolean(),
});
export type Competitor = z.infer<typeof Competitor>;
