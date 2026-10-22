/**
 * Action Payloads — the ONLY way the player, C-suite agents, competitor agents and the Director AI
 * can mutate the world. Every payload is Zod-validated, then semantically validated by Engine A
 * before execution. LLM tool-calls must emit exactly these shapes.
 */
import { z } from "zod";
import { PricingModel } from "./commercial";
import { Covenant } from "./finance";
import { ProductionPolicy } from "./operations";
import { Cents, Id, NonNeg, Ratio, Tick } from "./primitives";
import { ReorderPolicy } from "./supply";
import { Warehouse } from "./warehouse";

const A = <T extends string, S extends z.ZodRawShape>(type: T, shape: S) =>
  z.object({ type: z.literal(type), ...shape });

export const ActionPayload = z.discriminatedUnion("type", [
  // ── Pricing & commercial ──────────────────────────────────────────────
  A("SET_PRICING", { offeringId: Id, pricing: PricingModel }),
  A("SET_DISCOUNT", { offeringId: Id, discountPct: z.number().min(0).max(0.9) }),
  A("TOGGLE_OFFERING", { offeringId: Id, active: z.boolean() }),
  A("SET_MARKETING_BUDGET", { channelId: Id, dailyBudget: Cents.min(0) }),
  A("SET_CHANNEL_TERMS", { channelId: Id, paymentTermsDays: z.number().int().min(0).max(180) }),
  // ── Supply chain ──────────────────────────────────────────────────────
  A("PLACE_PURCHASE_ORDER", {
    supplierId: Id,
    itemId: Id,
    qty: z.number().positive(),
    warehouseId: Id,
    laneId: Id,
  }),
  A("SET_REORDER_POLICY", { policy: ReorderPolicy }),
  // ── Operations ────────────────────────────────────────────────────────
  A("SET_PRODUCTION_POLICY", { policy: ProductionPolicy }),
  A("SCHEDULE_PRODUCTION", { recipeId: Id, batches: z.number().int().positive() }),
  A("SET_OVERTIME", { workCenterId: Id, hoursPerDay: NonNeg }),
  A("SET_SOURCING", { workCenterId: Id, sourcing: z.enum(["insourced", "outsourced"]) }),
  A("CAPEX_UPGRADE", {
    targetKind: z.enum(["work_center", "warehouse"]),
    targetId: Id,
    upgrade: z.enum(["capacity", "automation", "maintenance_overhaul", "cold_zone"]),
    amount: Cents.positive(),
    financing: z.enum(["cash", "equipment_loan"]),
  }),
  A("LEASE_WAREHOUSE", { warehouse: Warehouse }),
  A("SET_CAPABILITY_INVESTMENT", { capabilityId: Id, dailyInvestment: Cents.min(0) }),
  A("SET_CAPABILITY_OWNER", { capabilityId: Id, roleId: Id }),
  // ── Organization ──────────────────────────────────────────────────────
  A("HIRE", { roleId: Id, count: z.number().int().positive() }),
  A("LAYOFF", { roleId: Id, count: z.number().int().positive() }),
  A("SET_SALARY", { roleId: Id, annualSalary: Cents.positive() }),
  A("ASSIGN_RACI", {
    processId: Id,
    accountableRoleId: Id.optional(),
    responsibleRoleIds: z.array(Id).optional(),
  }),
  // ── Treasury & capital structure ─────────────────────────────────────
  A("DRAW_REVOLVER", { debtId: Id, amount: Cents.positive() }),
  A("REPAY_DEBT", { debtId: Id, amount: Cents.positive() }),
  A("TAKE_LOAN", {
    kind: z.enum(["term_loan", "venture_debt"]),
    lender: z.string(),
    principal: Cents.positive(),
    spreadBps: z.number().int().min(0),
    termMonths: z.number().int().positive(),
    covenants: z.array(Covenant),
  }),
  A("RAISE_EQUITY", {
    investor: z.string(),
    roundName: z.string(),
    amount: Cents.positive(),
    preMoneyValuation: Cents.positive(),
    boardSeat: z.boolean(),
  }),
  A("FACTOR_RECEIVABLES", { fraction: Ratio, discountPct: z.number().min(0).max(0.3) }),
  // ── Game loop ─────────────────────────────────────────────────────────
  A("RESOLVE_DECISION", { decisionId: Id, optionId: Id }),
  // ── External world agents (competitor CEOs) ──────────────────────────
  A("COMPETITOR_SET_PRICE", { competitorId: Id, segmentId: Id, price: Cents.positive() }),
  A("COMPETITOR_INVEST", {
    competitorId: Id,
    kind: z.enum(["capacity", "quality", "brand"]),
    amount: Cents.positive(),
  }),
  A("NOOP", { note: z.string().optional() }),
]);
export type ActionPayload = z.infer<typeof ActionPayload>;
export type ActionType = ActionPayload["type"];

/**
 * issuedBy: "player" | "agent:cfo" | "agent:coo" | "agent:cro" | "agent:chro" | "director" | "competitor:<id>"
 */
export const ActionEnvelope = z.object({
  id: Id,
  issuedBy: z.string().min(1),
  issuedAtTick: Tick,
  /** Defaults to the next tick processed. */
  executeAtTick: Tick.optional(),
  rationale: z.string().optional(),
  payload: ActionPayload,
});
export type ActionEnvelope = z.infer<typeof ActionEnvelope>;

export const ActionResult = z.object({
  envelopeId: Id,
  issuedBy: z.string(),
  type: z.string(),
  tick: Tick,
  ok: z.boolean(),
  errors: z.array(z.string()),
  effects: z.array(z.string()),
});
export type ActionResult = z.infer<typeof ActionResult>;

/** Structured diagnostic returned by Phase 1 (`validateAction`) of the Two-Phase Action Commit lifecycle. */
export const ActionDiagnostic = z.object({
  code: z.string(),
  field: z.string().optional(),
  message: z.string(),
  available: z.number().optional(),
  required: z.number().optional(),
});
export type ActionDiagnostic = z.infer<typeof ActionDiagnostic>;

/** Branded payload produced exclusively by `validateAction` and required by `commitAction`. */
export interface ValidatedActionPayload {
  readonly __validated: true;
  readonly validatedAtTick: number;
  readonly payload: ActionPayload;
}

export type ValidationResult =
  | {
      valid: true;
      validatedAction: ValidatedActionPayload;
      errors: [];
      diagnostics: ActionDiagnostic[];
    }
  | {
      valid: false;
      validatedAction?: undefined;
      errors: ActionDiagnostic[];
      diagnostics: ActionDiagnostic[];
    };

