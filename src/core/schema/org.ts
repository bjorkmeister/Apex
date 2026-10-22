/**
 * Organizational design: departments, roles, workforce cohorts, RACI processes, governance.
 */
import { z } from "zod";
import { Cents, Distribution, Id, NonNeg, Ratio, Tick } from "./primitives";

export const RoleTier = z.enum(["executive", "management", "specialist", "frontline"]);
export type RoleTier = z.infer<typeof RoleTier>;

export const Department = z.object({
  id: Id,
  name: z.string(),
  parentId: Id.optional(),
  headRoleId: Id.optional(),
});
export type Department = z.infer<typeof Department>;

export const SalesCapacity = z.object({
  /** Leads a fully-ramped rep self-generates per day. */
  leadsPerDay: NonNeg,
  maxOpenOpportunities: NonNeg,
  segmentIds: z.array(Id),
});

export const Role = z.object({
  id: Id,
  title: z.string(),
  departmentId: Id,
  tier: RoleTier,
  reportsToRoleId: Id.optional(),
  annualSalary: Cents.min(0),
  /** Market reference salary at wageIndex = 1. */
  marketSalary: Cents.min(0),
  benefitsLoad: NonNeg,
  hoursPerDay: NonNeg,
  isManager: z.boolean(),
  idealSpan: NonNeg,
  /** Direct labor is booked to COGS; everyone else to OpEx. */
  isDirectLabor: z.boolean(),
  /** Days until a new hire reaches 100% productivity (starts at 30%). */
  rampDays: z.number().int().min(0),
  recruitingLeadDays: Distribution,
  recruitingCost: Cents.min(0),
  severanceWeeks: NonNeg,
  sales: SalesCapacity.optional(),
});
export type Role = z.infer<typeof Role>;

export const Cohort = z.object({ count: z.number().int().min(0), hiredTick: z.number().int() });
export const PendingHire = z.object({ count: z.number().int().positive(), readyTick: Tick });

export const PositionState = z.object({
  roleId: Id,
  cohorts: z.array(Cohort),
  pendingHires: z.array(PendingHire),
  morale: Ratio,
  proficiency: Ratio,
  fatigue: Ratio,
  /** Scheduled overtime hours per person per day (driven by work-center overtime). */
  overtimeHoursPerPerson: NonNeg,
  attritionYtd: z.number().int().min(0),
  laborHoursAvailable: NonNeg,
  laborHoursUsed: NonNeg,
});
export type PositionState = z.infer<typeof PositionState>;

/** RACI-governed business process. Unowned processes cause Governance Drift. */
export const Process = z.object({
  id: Id,
  name: z.string(),
  capabilityId: Id.optional(),
  accountableRoleId: Id.optional(),
  responsibleRoleIds: z.array(Id),
  consultedRoleIds: z.array(Id),
  informedRoleIds: z.array(Id),
  criticality: z.number().int().min(1).max(5),
  complianceCritical: z.boolean(),
  fineCents: Cents.min(0),
});
export type Process = z.infer<typeof Process>;

export const Governance = z.object({
  drift: Ratio,
  unownedProcessIds: z.array(Id),
  coordinationTax: z.record(z.string(), Ratio),
  lastMissedPayrollTick: Tick.optional(),
});
export type Governance = z.infer<typeof Governance>;
