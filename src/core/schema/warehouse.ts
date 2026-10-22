/**
 * Warehouse physics: zones (cubic volume by handling class), throughput limits, inventory lots.
 */
import { z } from "zod";
import { Cents, HandlingClass, Id, NonNeg, Ratio, Tick } from "./primitives";

export const WarehouseZone = z.object({ handling: HandlingClass, capacityM3: NonNeg });
export type WarehouseZone = z.infer<typeof WarehouseZone>;

export const Warehouse = z.object({
  id: Id,
  name: z.string(),
  region: z.string(),
  mode: z.enum(["owned", "leased", "3pl"]),
  capabilityId: Id.optional(),
  zones: z.array(WarehouseZone),
  receivingUnitsPerDay: NonNeg,
  pickPackUnitsPerDay: NonNeg,
  laborRoleId: Id.optional(),
  unitsPerLaborHour: NonNeg,
  rentPerDay: Cents.min(0),
  threePl: z
    .object({ handlingFeePerUnit: Cents.min(0), storagePerM3Day: Cents.min(0) })
    .optional(),
  /** 0..1 — multiplies receiving & pick throughput by (1 + automationLevel). */
  automationLevel: Ratio,
  insuranceRateAnnual: Ratio,
  shrinkageRateAnnual: Ratio,
  /** Charged per m3/day on goods stuck at the dock (no space / no receiving capacity). */
  demurragePerM3Day: Cents.min(0),
  telemetry: z.object({
    utilization: NonNeg,
    receivingBacklogUnits: NonNeg,
    pickBacklogUnits: NonNeg,
    pickUtilization: NonNeg,
  }),
});
export type Warehouse = z.infer<typeof Warehouse>;

/**
 * Inventory is tracked as valued lots (FEFO/FIFO). `value` is the capitalized cost in cents;
 * the sum of lot values reconciles exactly to the GL inventory accounts every tick.
 */
export const InventoryLot = z.object({
  id: Id,
  itemId: Id,
  warehouseId: Id,
  qty: NonNeg,
  value: Cents.min(0),
  receivedTick: Tick,
  expiryTick: Tick.optional(),
});
export type InventoryLot = z.infer<typeof InventoryLot>;
