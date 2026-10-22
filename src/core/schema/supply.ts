/**
 * Supply chain: suppliers, freight lanes, purchase orders, reorder policies.
 */
import { z } from "zod";
import { Cents, Distribution, FreightMode, Id, NonNeg, Ratio, Tick } from "./primitives";

/** cia = cash-in-advance (prepaid at order), cod = due on receipt, net = due `days` after receipt. */
export const PaymentTerms = z.object({
  kind: z.enum(["cia", "cod", "net"]),
  days: z.number().int().min(0),
});
export type PaymentTerms = z.infer<typeof PaymentTerms>;

export const PriceBreak = z.object({ minQty: NonNeg, unitPrice: Cents.positive() });

export const SupplierOffer = z.object({
  itemId: Id,
  unitPrice: Cents.positive(),
  moq: NonNeg,
  priceBreaks: z.array(PriceBreak),
});
export type SupplierOffer = z.infer<typeof SupplierOffer>;

export const Supplier = z.object({
  id: Id,
  name: z.string(),
  tier: z.number().int().min(1).max(3),
  region: z.string(),
  /** Probability an order ships on time & complete. */
  reliability: Ratio,
  /** Production/handling lead time before shipment (days). */
  leadTimeDays: Distribution,
  terms: PaymentTerms,
  offers: z.array(SupplierOffer),
  laneIds: z.array(Id),
  creditHold: z.boolean(),
  relationship: Ratio,
  overdueSinceTick: Tick.optional(),
});
export type Supplier = z.infer<typeof Supplier>;

export const FreightLane = z.object({
  id: Id,
  name: z.string(),
  mode: FreightMode,
  direction: z.enum(["inbound", "outbound"]),
  origin: z.string(),
  destination: z.string(),
  transitDays: Distribution,
  costPerM3: Cents.min(0),
  fixedCostPerShipment: Cents.min(0),
  damageRate: Ratio,
  delayProb: Ratio,
  delayDays: Distribution,
});
export type FreightLane = z.infer<typeof FreightLane>;

export const PurchaseOrder = z.object({
  id: Id,
  supplierId: Id,
  itemId: Id,
  warehouseId: Id,
  laneId: Id,
  qty: z.number().positive(),
  unitPrice: Cents.min(0),
  freightCost: Cents.min(0),
  placedTick: Tick,
  shipTick: Tick,
  etaTick: Tick,
  status: z.enum(["placed", "in_transit", "at_dock", "received", "cancelled"]),
  receivedQty: NonNeg,
  damagedQty: NonNeg,
  /** Remaining prepaid balance (CIA terms) carried in the `prepaid` account. */
  prepaid: Cents.min(0),
  auto: z.boolean(),
});
export type PurchaseOrder = z.infer<typeof PurchaseOrder>;

export const ReorderPolicy = z.object({
  id: Id,
  itemId: Id,
  warehouseId: Id,
  supplierId: Id,
  laneId: Id,
  mode: z.enum(["eoq", "min_max", "jit", "manual"]),
  /** JIT keeps lean buffers; JIC carries the full safety-stock days. */
  strategy: z.enum(["jit", "jic"]),
  safetyStockDays: NonNeg,
  serviceLevelZ: NonNeg,
  maxStockUnits: NonNeg.optional(),
  reviewPeriodDays: z.number().int().positive(),
  lastReviewTick: Tick.optional(),
});
export type ReorderPolicy = z.infer<typeof ReorderPolicy>;

/** Consumption statistics used by reorder policies (EMA mean & variance of daily usage). */
export const UsageStat = z.object({ ema: NonNeg, varEma: NonNeg });
export type UsageStat = z.infer<typeof UsageStat>;
