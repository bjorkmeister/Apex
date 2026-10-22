/**
 * Operations: capabilities (L1/L2/L3), work centers, production policies & orders.
 */
import { z } from "zod";
import { Cents, Id, Maturity, NonNeg, Ratio, Sourcing, Tick } from "./primitives";

export const Capability = z.object({
  id: Id,
  name: z.string(),
  level: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  parentId: Id.optional(),
  description: z.string().optional(),
  /** Current maturity (1..5, continuous). */
  maturity: Maturity,
  /** Maturity the business model requires. Gap => friction (cost, cycle time, error rate). */
  requiredMaturity: Maturity,
  dailyInvestment: Cents.min(0),
  /** Spend per day needed to hold maturity; below this, maturity decays (organizational entropy). */
  maintenanceSpendPerDay: Cents.min(0),
  /** Cost to gain +1.0 maturity from level 1; scales x1.6 per level. */
  costPerMaturityPoint: Cents.positive(),
  decayPerDay: NonNeg,
  ownerRoleId: Id.optional(),
  /** People/Process/Technology dependency weights (sum ≈ 1). */
  pillars: z.object({ people: Ratio, process: Ratio, technology: Ratio }),
  sourcing: Sourcing,
  vendor: z
    .object({ name: z.string(), maturity: Maturity, feePerDay: Cents.min(0), riskScore: Ratio })
    .optional(),
  scalabilityCeilingUnitsPerDay: NonNeg.optional(),
});
export type Capability = z.infer<typeof Capability>;

export const WorkCenterTelemetry = z.object({
  /** Offered load ρ = arriving work / capacity (can exceed 1 → unstable queue). */
  utilization: NonNeg,
  offeredHoursEma: NonNeg,
  /** λ — batches released per day (EMA). */
  arrivalRateEma: NonNeg,
  queueBatches: NonNeg,
  /** W — expected time in system (days), Kingman approximation or backlog-based. */
  avgWaitDays: NonNeg,
  /** L = λW (Little's Law). */
  littlesL: NonNeg,
  defectRateEma: Ratio,
  hoursUsedToday: NonNeg,
  capacityHoursToday: NonNeg,
});
export type WorkCenterTelemetry = z.infer<typeof WorkCenterTelemetry>;

export const WorkCenter = z.object({
  id: Id,
  name: z.string(),
  capabilityId: Id.optional(),
  /** Warehouse that supplies inputs and receives outputs. */
  warehouseId: Id,
  sourcing: Sourcing,
  machineHoursPerDay: NonNeg,
  laborRoleId: Id.optional(),
  overtimeHoursPerDay: NonNeg,
  maxOvertimeHoursPerDay: NonNeg,
  variableCostPerHour: Cents.min(0),
  maintenanceCostPerDay: Cents.min(0),
  /** Equipment condition (1 = new). Low condition reduces capacity and raises defects/breakdowns. */
  condition: Ratio,
  wearPerHour: NonNeg,
  maintenanceRestorePerDay: NonNeg,
  outsource: z
    .object({
      vendorName: z.string(),
      costPerBatch: Cents.min(0),
      leadDays: z.number().int().min(0),
      reliability: Ratio,
      capacityBatchesPerDay: NonNeg,
    })
    .optional(),
  telemetry: WorkCenterTelemetry,
});
export type WorkCenter = z.infer<typeof WorkCenter>;

export const ProductionPolicy = z.object({
  recipeId: Id,
  mode: z.enum(["make_to_stock", "make_to_order", "manual"]),
  targetStockUnits: NonNeg,
  maxBatchesPerDay: NonNeg,
});
export type ProductionPolicy = z.infer<typeof ProductionPolicy>;

export const ProductionOrder = z.object({
  id: Id,
  recipeId: Id,
  batches: z.number().int().positive(),
  status: z.enum(["awaiting_materials", "in_progress", "at_vendor"]),
  createdTick: Tick,
  startedTick: Tick.optional(),
  remainingMachineHours: NonNeg,
  remainingLaborHours: NonNeg,
  /** Capitalized cost currently sitting in `inventory_wip`. */
  wipValue: Cents.min(0),
  vendorDueTick: Tick.optional(),
});
export type ProductionOrder = z.infer<typeof ProductionOrder>;
