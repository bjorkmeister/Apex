/**
 * Value-chain topology: units of value (Items) and transformation recipes (BOM / Service Delivery Recipe).
 */
import { z } from "zod";
import { Cents, HandlingClass, Id, NonNeg, Ratio } from "./primitives";

/**
 * raw/component → stocked in `inventory_raw`
 * finished      → stocked in `inventory_finished`
 * service       → non-storable capacity unit (billable hour, delivery slot, MWh). Produced on demand,
 *                 expires at the end of the next tick if unused (perishable capacity).
 */
export const ItemKind = z.enum(["raw", "component", "finished", "service"]);
export type ItemKind = z.infer<typeof ItemKind>;

export const Item = z.object({
  id: Id,
  name: z.string(),
  kind: ItemKind,
  uom: z.string(),
  unitVolumeM3: NonNeg,
  handling: HandlingClass,
  /** Perishables: lots expire `shelfLifeDays` after receipt/production. */
  shelfLifeDays: z.number().int().positive().optional(),
  obsolescenceAnnual: Ratio,
  /** Intrinsic design quality perceived by customers (0..1). */
  designQuality: Ratio,
  /** Optional standard cost used for cost-plus pricing when no stock exists. */
  standardCost: Cents.optional(),
});
export type Item = z.infer<typeof Item>;

export const RecipeInput = z.object({ itemId: Id, qty: z.number().positive() });
export type RecipeInput = z.infer<typeof RecipeInput>;

/** One batch consumes `inputs`, `machineHours` and `laborHours` at `workCenterId` and yields `outputQty`. */
export const Recipe = z.object({
  id: Id,
  name: z.string(),
  outputItemId: Id,
  outputQty: z.number().positive(),
  inputs: z.array(RecipeInput),
  workCenterId: Id,
  machineHours: NonNeg,
  laborHours: NonNeg,
  baseDefectRate: Ratio,
});
export type Recipe = z.infer<typeof Recipe>;
