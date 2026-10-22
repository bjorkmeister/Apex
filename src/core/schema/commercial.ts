/**
 * Commercial: sales channels, offerings & pricing architecture, marketing funnel, orders, B2B pipeline.
 */
import { z } from "zod";
import { Cents, Id, NonNeg, Ratio, Tick } from "./primitives";

export const PricingModel = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("cost_plus"), markupPct: z.number().min(0) }),
  z.object({ kind: z.literal("value_based"), listPrice: Cents.positive() }),
  z.object({
    kind: z.literal("dynamic_surge"),
    basePrice: Cents.positive(),
    surgeMaxPct: z.number().min(0),
    /** Utilization above which surge kicks in (0..1). */
    utilizationTrigger: Ratio,
  }),
  z.object({
    kind: z.literal("tiered_volume"),
    tiers: z.array(z.object({ minQty: NonNeg, unitPrice: Cents.positive() })).min(1),
  }),
  z.object({
    kind: z.literal("wholesale"),
    msrp: Cents.positive(),
    distributorMarginPct: Ratio,
  }),
  z.object({
    kind: z.literal("subscription"),
    monthlyPrice: Cents.positive(),
    unitsPerMonth: NonNeg,
    churnMonthly: Ratio,
  }),
  z.object({
    kind: z.literal("razor_blades"),
    razorPrice: Cents.min(0),
    bladeItemId: Id,
    bladePrice: Cents.positive(),
    bladesPerMonth: NonNeg,
  }),
]);
export type PricingModel = z.infer<typeof PricingModel>;

export const ChannelKind = z.enum([
  "d2c_web",
  "marketplace",
  "retail",
  "wholesale",
  "distributor",
  "direct_sales",
  "field_service",
]);

export const Channel = z.object({
  id: Id,
  name: z.string(),
  kind: ChannelKind,
  /** Marketplace commission / payment processing, deducted from receipts. */
  feePct: Ratio,
  /** Customer payment terms (DSO driver). 0 = paid at shipment. */
  paymentTermsDays: z.number().int().min(0),
  fulfillmentWarehouseId: Id,
  outboundLaneId: Id.optional(),
  handlingDays: NonNeg,
  returnRate: Ratio,
  restockRate: Ratio,
  capabilityId: Id.optional(),
  segmentIds: z.array(Id),
});
export type Channel = z.infer<typeof Channel>;

export const Offering = z.object({
  id: Id,
  name: z.string(),
  itemId: Id,
  channelId: Id,
  segmentId: Id,
  pricing: PricingModel,
  discountPct: Ratio,
  active: z.boolean(),
});
export type Offering = z.infer<typeof Offering>;

export const OfferingState = z.object({
  offeringId: Id,
  /** Subscribers (subscription) or installed razors (razor_blades). */
  installedBase: NonNeg,
  recurringAccrual: NonNeg,
  deferredBalance: Cents.min(0),
  qualityScore: Ratio,
  deliveryDaysEma: NonNeg,
  fillRateEma: Ratio,
  unitsSoldMtd: NonNeg,
  revenueMtd: Cents,
  lastPrice: Cents.min(0),
});
export type OfferingState = z.infer<typeof OfferingState>;

export const MarketingChannelKind = z.enum([
  "paid_performance",
  "brand_campaign",
  "trade_shows",
  "retail_placement",
  "referral",
  "content_seo",
]);

export const MarketingChannel = z.object({
  id: Id,
  name: z.string(),
  kind: MarketingChannelKind,
  dailyBudget: Cents.min(0),
  /** Effective spend at which response reaches 50% of its ceiling (diminishing returns). */
  halfSaturationSpend: Cents.positive(),
  awarenessGain: NonNeg,
  brandGain: NonNeg,
  leadYield: NonNeg,
  /** Ad fatigue 0..1 — erodes effectiveness with sustained heavy spend. */
  fatigue: Ratio,
  fatigueRate: NonNeg,
  targetSegmentIds: z.array(Id),
});
export type MarketingChannel = z.infer<typeof MarketingChannel>;

export const SalesOrder = z.object({
  id: Id,
  offeringId: Id,
  itemId: Id,
  qty: z.number().positive(),
  shippedQty: NonNeg,
  /** Net price per unit received by the company (before channel fee). */
  unitPrice: Cents.min(0),
  createdTick: Tick,
  dueTick: Tick,
  source: z.enum(["spot", "contract", "subscription", "consumable"]),
  contractId: Id.optional(),
});
export type SalesOrder = z.infer<typeof SalesOrder>;

export const OpportunityStage = z.enum(["lead", "qualified", "proposal", "negotiation"]);
export type OpportunityStage = z.infer<typeof OpportunityStage>;

export const Opportunity = z.object({
  id: Id,
  segmentId: Id,
  offeringId: Id,
  stage: OpportunityStage,
  unitsPerMonth: z.number().positive(),
  unitPrice: Cents.min(0),
  stageEnteredTick: Tick,
  createdTick: Tick,
});
export type Opportunity = z.infer<typeof Opportunity>;

export const Contract = z.object({
  id: Id,
  customerName: z.string(),
  segmentId: Id,
  offeringId: Id,
  unitsPerMonth: z.number().positive(),
  unitPrice: Cents.min(0),
  startTick: Tick,
  endTick: Tick,
  slaFillRate: Ratio,
  penaltyPct: Ratio,
  fillRateEma: Ratio,
  status: z.enum(["active", "expired", "churned"]),
  orderAccrual: NonNeg,
  shippedMtd: NonNeg,
  orderedMtd: NonNeg,
});
export type Contract = z.infer<typeof Contract>;

export const PendingReturn = z.object({
  id: Id,
  offeringId: Id,
  itemId: Id,
  qty: z.number().positive(),
  refund: Cents.min(0),
  costValue: Cents.min(0),
  dueTick: Tick,
  restockRate: Ratio,
  warehouseId: Id,
});
export type PendingReturn = z.infer<typeof PendingReturn>;
