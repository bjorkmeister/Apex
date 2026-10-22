/**
 * Action Validator & Deterministic Mutation Executor.
 *
 * Every `ActionEnvelope` (from Player, C-Suite Agents, Competitor Agents, or Director AI)
 * passes through `executeActionEnvelope`:
 *  1. Zod schema validation on `ActionPayload`.
 *  2. Semantic conservation-law validation (liquidity, revolver headroom, MOQ, role existence, etc.).
 *  3. Atomic state + double-entry ledger mutation.
 */
import {
  type ActionDiagnostic,
  ActionEnvelope,
  ActionPayload,
  type ActionResult,
  type SimulationState,
  type ValidatedActionPayload,
  type ValidationResult,
  type WorldState,
} from "../schema";
import { debitBalance, payOrQueuePayable, postJournal } from "./ledger";
import { nextId } from "./modifiers";
import { scheduleProductionOrder } from "./operations";
import { getRole, removeFromCohorts, roleHeadcount } from "./org";
import { clamp, SeededRng } from "./rng";
import { placePurchaseOrder, resolveSupplierUnitPrice } from "./supply";
import { availableZoneVolumeM3, getItem } from "./warehouse";

/**
 * PHASE 1 OF TWO-PHASE COMMIT:
 * Pure, side-effect-free feasibility & schema validation of an `ActionPayload` against `SimulationState`.
 * Never mutates `state`.
 */
export function validateAction(
  state: SimulationState,
  action: ActionPayload,
): ValidationResult {
  const parsed = ActionPayload.safeParse(action);
  if (!parsed.success) {
    const errors: ActionDiagnostic[] = parsed.error.issues.map((issue) => ({
      code: "SCHEMA_INVALID",
      field: issue.path.join("."),
      message: issue.message,
    }));
    return { valid: false, errors, diagnostics: errors };
  }

  const p = parsed.data;
  const errors: ActionDiagnostic[] = [];
  const cash = debitBalance(state.finance.ledger, "cash");

  switch (p.type) {
    case "SET_PRICING":
    case "SET_DISCOUNT":
    case "TOGGLE_OFFERING": {
      const off = state.commercial.offerings.find((o) => o.id === p.offeringId);
      if (!off) {
        errors.push({
          code: "OFFERING_NOT_FOUND",
          field: "offeringId",
          message: `Offering ${p.offeringId} not found`,
        });
      }
      break;
    }

    case "SET_MARKETING_BUDGET": {
      const ch = state.commercial.marketing.find((m) => m.id === p.channelId);
      if (!ch) {
        errors.push({
          code: "MARKETING_CHANNEL_NOT_FOUND",
          field: "channelId",
          message: `Marketing channel ${p.channelId} not found`,
        });
      }
      break;
    }

    case "SET_CHANNEL_TERMS": {
      const ch = state.commercial.channels.find((c) => c.id === p.channelId);
      if (!ch) {
        errors.push({
          code: "CHANNEL_NOT_FOUND",
          field: "channelId",
          message: `Sales channel ${p.channelId} not found`,
        });
      }
      break;
    }

    case "PLACE_PURCHASE_ORDER": {
      const sup = state.supply.suppliers.find((s) => s.id === p.supplierId);
      if (!sup) {
        errors.push({
          code: "SUPPLIER_NOT_FOUND",
          field: "supplierId",
          message: `Unknown supplier ${p.supplierId}`,
        });
        break;
      }
      if (sup.creditHold) {
        errors.push({
          code: "SUPPLIER_CREDIT_HOLD",
          field: "supplierId",
          message: `Supplier ${sup.name} has placed account on credit hold`,
        });
      }
      const offer = sup.offers.find((o) => o.itemId === p.itemId);
      if (!offer) {
        errors.push({
          code: "ITEM_NOT_OFFERED",
          field: "itemId",
          message: `Supplier ${sup.name} does not supply item ${p.itemId}`,
        });
      }
      const wh = state.warehouses.sites.find((w) => w.id === p.warehouseId);
      if (!wh) {
        errors.push({
          code: "WAREHOUSE_NOT_FOUND",
          field: "warehouseId",
          message: `Unknown warehouse ${p.warehouseId}`,
        });
      }
      const lane = state.supply.lanes.find((l) => l.id === p.laneId);
      if (!lane) {
        errors.push({
          code: "LANE_NOT_FOUND",
          field: "laneId",
          message: `Unknown freight lane ${p.laneId}`,
        });
      }
      if (offer && wh) {
        const item = state.catalog.items.find((i) => i.id === p.itemId);
        if (item) {
          const hasZone = wh.zones.some((z) => z.handling === item.handling);
          if (!hasZone) {
            errors.push({
              code: "WAREHOUSE_ZONE_MISMATCH",
              field: "warehouseId",
              message: `Warehouse ${wh.name} lacks a ${item.handling} handling zone for ${item.name}`,
            });
          } else if (item.unitVolumeM3 > 0) {
            const totalZoneCap = wh.zones
              .filter((z) => z.handling === item.handling)
              .reduce((s, z) => s + z.capacityM3, 0);
            const orderVol = Math.max(offer.moq, Math.ceil(p.qty)) * item.unitVolumeM3;
            if (orderVol > totalZoneCap) {
              errors.push({
                code: "WAREHOUSE_CAPACITY_EXCEEDED",
                field: "qty",
                message: `Order volume (${orderVol.toFixed(1)} m³) exceeds total ${item.handling} zone capacity (${totalZoneCap.toFixed(1)} m³)`,
                available: totalZoneCap,
                required: orderVol,
              });
            }
            void availableZoneVolumeM3;
            void getItem;
          }
        }
        if (sup.terms.kind === "cia") {
          const effQty = Math.max(offer.moq, Math.ceil(p.qty));
          const unitPrice = resolveSupplierUnitPrice(state, sup, offer, effQty);
          const requiredCash = Math.round(effQty * unitPrice);
          if (cash < requiredCash) {
            errors.push({
              code: "INSUFFICIENT_CASH_CIA",
              field: "qty",
              message: `Insufficient treasury cash ($${(cash / 100).toFixed(2)}) for Cash-in-Advance PO ($${(requiredCash / 100).toFixed(2)})`,
              available: cash,
              required: requiredCash,
            });
          }
        }
      }
      break;
    }

    case "SCHEDULE_PRODUCTION": {
      const recipe = state.catalog.recipes.find((r) => r.id === p.recipeId);
      if (!recipe) {
        errors.push({
          code: "RECIPE_NOT_FOUND",
          field: "recipeId",
          message: `Recipe ${p.recipeId} not found`,
        });
      }
      break;
    }

    case "SET_OVERTIME": {
      const wc = state.operations.workCenters.find((w) => w.id === p.workCenterId);
      if (!wc) {
        errors.push({
          code: "WORK_CENTER_NOT_FOUND",
          field: "workCenterId",
          message: `Work center ${p.workCenterId} not found`,
        });
      } else if (p.hoursPerDay > wc.maxOvertimeHoursPerDay) {
        errors.push({
          code: "OVERTIME_LIMIT_EXCEEDED",
          field: "hoursPerDay",
          message: `Requested overtime (${p.hoursPerDay}h) exceeds work-center max (${wc.maxOvertimeHoursPerDay}h)`,
          available: wc.maxOvertimeHoursPerDay,
          required: p.hoursPerDay,
        });
      }
      break;
    }

    case "SET_SOURCING": {
      const wc = state.operations.workCenters.find((w) => w.id === p.workCenterId);
      if (!wc) {
        errors.push({
          code: "WORK_CENTER_NOT_FOUND",
          field: "workCenterId",
          message: `Work center ${p.workCenterId} not found`,
        });
      } else if (p.sourcing === "outsourced" && !wc.outsource) {
        errors.push({
          code: "OUTSOURCE_VENDOR_MISSING",
          field: "sourcing",
          message: `Work center ${wc.name} has no contract manufacturer configured`,
        });
      }
      break;
    }

    case "CAPEX_UPGRADE": {
      const amt = Math.round(p.amount);
      if (p.financing === "cash" && cash < amt) {
        errors.push({
          code: "INSUFFICIENT_CASH_CAPEX",
          field: "amount",
          message: `Insufficient unallocated cash ($${(cash / 100).toFixed(0)}) for CapEx upgrade ($${(amt / 100).toFixed(0)})`,
          available: cash,
          required: amt,
        });
      }
      if (p.targetKind === "work_center") {
        if (!state.operations.workCenters.some((w) => w.id === p.targetId)) {
          errors.push({
            code: "WORK_CENTER_NOT_FOUND",
            field: "targetId",
            message: `Work center ${p.targetId} not found`,
          });
        }
      } else {
        if (!state.warehouses.sites.some((w) => w.id === p.targetId)) {
          errors.push({
            code: "WAREHOUSE_NOT_FOUND",
            field: "targetId",
            message: `Warehouse ${p.targetId} not found`,
          });
        }
      }
      break;
    }

    case "LEASE_WAREHOUSE": {
      if (state.warehouses.sites.some((w) => w.id === p.warehouse.id)) {
        errors.push({
          code: "WAREHOUSE_ALREADY_EXISTS",
          field: "warehouse.id",
          message: `Warehouse ${p.warehouse.id} already exists`,
        });
      }
      break;
    }

    case "SET_CAPABILITY_INVESTMENT": {
      if (!state.operations.capabilities.some((c) => c.id === p.capabilityId)) {
        errors.push({
          code: "CAPABILITY_NOT_FOUND",
          field: "capabilityId",
          message: `Capability ${p.capabilityId} not found`,
        });
      }
      break;
    }

    case "SET_CAPABILITY_OWNER": {
      if (!state.operations.capabilities.some((c) => c.id === p.capabilityId)) {
        errors.push({
          code: "CAPABILITY_NOT_FOUND",
          field: "capabilityId",
          message: `Capability ${p.capabilityId} not found`,
        });
      }
      if (!state.org.roles.some((r) => r.id === p.roleId)) {
        errors.push({
          code: "ROLE_NOT_FOUND",
          field: "roleId",
          message: `Role ${p.roleId} not found`,
        });
      }
      break;
    }

    case "HIRE": {
      if (!state.org.positions.some((x) => x.roleId === p.roleId)) {
        errors.push({
          code: "ROLE_NOT_FOUND",
          field: "roleId",
          message: `Role ${p.roleId} not found`,
        });
      }
      break;
    }

    case "LAYOFF": {
      const pos = state.org.positions.find((x) => x.roleId === p.roleId);
      if (!pos) {
        errors.push({
          code: "ROLE_NOT_FOUND",
          field: "roleId",
          message: `Role ${p.roleId} not found`,
        });
      } else {
        const hc = roleHeadcount(pos);
        if (hc < p.count || hc === 0) {
          errors.push({
            code: "INSUFFICIENT_HEADCOUNT",
            field: "count",
            message: `Cannot lay off ${p.count} staff from ${p.roleId}; active headcount is ${hc}`,
            available: hc,
            required: p.count,
          });
        }
      }
      break;
    }

    case "SET_SALARY": {
      if (!state.org.roles.some((r) => r.id === p.roleId)) {
        errors.push({
          code: "ROLE_NOT_FOUND",
          field: "roleId",
          message: `Role ${p.roleId} not found`,
        });
      }
      break;
    }

    case "ASSIGN_RACI": {
      if (!state.org.processes.some((x) => x.id === p.processId)) {
        errors.push({
          code: "PROCESS_NOT_FOUND",
          field: "processId",
          message: `Process ${p.processId} not found`,
        });
      }
      break;
    }

    case "DRAW_REVOLVER": {
      const debt = state.finance.debts.find(
        (d) => d.id === p.debtId && d.kind === "revolver",
      );
      if (!debt) {
        errors.push({
          code: "REVOLVER_NOT_FOUND",
          field: "debtId",
          message: `Revolver facility ${p.debtId} not found`,
        });
      } else if (debt.status !== "active") {
        errors.push({
          code: "REVOLVER_FROZEN",
          field: "debtId",
          message: `Revolver ${debt.lender} is in status "${debt.status}" and cannot be drawn`,
        });
      } else {
        const avail = Math.max(0, debt.limit - debt.principal);
        if (avail <= 0 || p.amount > avail) {
          errors.push({
            code: "REVOLVER_LIMIT_EXCEEDED",
            field: "amount",
            message: `Requested draw ($${(p.amount / 100).toFixed(0)}) exceeds available revolver headroom ($${(avail / 100).toFixed(0)})`,
            available: avail,
            required: p.amount,
          });
        }
      }
      break;
    }

    case "REPAY_DEBT": {
      const debt = state.finance.debts.find((d) => d.id === p.debtId);
      if (!debt || debt.principal <= 0) {
        errors.push({
          code: "DEBT_NOT_FOUND",
          field: "debtId",
          message: `Active debt facility ${p.debtId} not found`,
        });
      } else if (cash <= 0) {
        errors.push({
          code: "INSUFFICIENT_CASH_DEBT_REPAY",
          field: "amount",
          message: `Insufficient cash ($${(cash / 100).toFixed(0)}) to repay debt ${debt.lender}`,
          available: cash,
          required: p.amount,
        });
      }
      break;
    }

    case "FACTOR_RECEIVABLES": {
      if (state.finance.receivables.length === 0) {
        errors.push({
          code: "NO_RECEIVABLES",
          message: "No open Accounts Receivable available to factor",
        });
      }
      break;
    }

    case "RESOLVE_DECISION": {
      const dec = state.events.decisions.find((d) => d.id === p.decisionId);
      if (!dec || dec.status !== "pending") {
        errors.push({
          code: "DECISION_NOT_FOUND",
          field: "decisionId",
          message: `Pending decision card ${p.decisionId} not found`,
        });
      } else {
        const opt = dec.options.find((o) => o.id === p.optionId);
        if (!opt) {
          errors.push({
            code: "DECISION_OPTION_NOT_FOUND",
            field: "optionId",
            message: `Option ${p.optionId} not found on decision ${dec.id}`,
          });
        }
      }
      break;
    }

    case "COMPETITOR_SET_PRICE": {
      const comp = state.market.competitors.find((c) => c.id === p.competitorId);
      const coff = comp?.offerings.find((o) => o.segmentId === p.segmentId);
      if (!comp || !coff) {
        errors.push({
          code: "COMPETITOR_OFFERING_NOT_FOUND",
          message: `Competitor offering ${p.competitorId}/${p.segmentId} not found`,
        });
      }
      break;
    }

    case "COMPETITOR_INVEST": {
      if (!state.market.competitors.some((c) => c.id === p.competitorId)) {
        errors.push({
          code: "COMPETITOR_NOT_FOUND",
          field: "competitorId",
          message: `Competitor ${p.competitorId} not found`,
        });
      }
      break;
    }

    case "SET_REORDER_POLICY":
    case "SET_PRODUCTION_POLICY":
    case "TAKE_LOAN":
    case "RAISE_EQUITY":
    case "NOOP":
      break;
  }

  if (errors.length > 0) {
    return { valid: false, errors, diagnostics: errors };
  }

  const validatedAction: ValidatedActionPayload = Object.freeze({
    __validated: true as const,
    validatedAtTick: state.calendar.tick,
    payload: p,
  });

  return {
    valid: true,
    validatedAction,
    errors: [],
    diagnostics: [],
  };
}

/**
 * PHASE 2 OF TWO-PHASE COMMIT:
 * Commits a previously validated `ValidatedActionPayload` to `SimulationState`.
 * Throws if an unvalidated action object is passed directly.
 */
export function commitAction(
  state: SimulationState,
  action: ValidatedActionPayload,
  opts: { issuedBy?: string; envelopeId?: string; rng?: SeededRng } = {},
): SimulationState {
  if (!action || action.__validated !== true || !action.payload) {
    throw new Error(
      "Two-Phase Commit Violation: commitAction requires a ValidatedActionPayload returned by validateAction().",
    );
  }

  const rng = opts.rng ?? new SeededRng(state.rngState);
  const errors: string[] = [];
  const effects: string[] = [];

  applyPayload(state, rng, action.payload, errors, effects);

  if (!opts.rng) {
    state.rngState = rng.state;
  }

  const result: ActionResult = {
    envelopeId: opts.envelopeId ?? nextId(state, "act"),
    issuedBy: opts.issuedBy ?? "commitAction",
    type: action.payload.type,
    tick: state.calendar.tick,
    ok: errors.length === 0,
    errors,
    effects,
  };

  state.actionHistory.push(result);
  if (state.actionHistory.length > 300) {
    state.actionHistory.splice(0, state.actionHistory.length - 300);
  }

  return state;
}

export function executeActionEnvelope(
  state: WorldState,
  rng: SeededRng,
  envelope: ActionEnvelope,
): ActionResult {
  const parsed = ActionEnvelope.safeParse(envelope);
  if (!parsed.success) {
    const res: ActionResult = {
      envelopeId: envelope.id ?? "invalid",
      issuedBy: envelope.issuedBy ?? "unknown",
      type: (envelope.payload as { type?: string })?.type ?? "INVALID",
      tick: state.calendar.tick,
      ok: false,
      errors: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
      effects: [],
    };
    state.actionHistory.push(res);
    return res;
  }

  const env = parsed.data;
  const validation = validateAction(state, env.payload);
  if (!validation.valid) {
    const res: ActionResult = {
      envelopeId: env.id,
      issuedBy: env.issuedBy,
      type: env.payload.type,
      tick: state.calendar.tick,
      ok: false,
      errors: validation.errors.map((d) => `${d.code}: ${d.message}`),
      effects: [],
    };
    state.actionHistory.push(res);
    return res;
  }

  commitAction(state, validation.validatedAction, {
    issuedBy: env.issuedBy,
    envelopeId: env.id,
    rng,
  });

  return state.actionHistory[state.actionHistory.length - 1];
}

function applyPayload(
  state: WorldState,
  rng: SeededRng,
  p: ActionPayload,
  errors: string[],
  effects: string[],
): void {
  const tick = state.calendar.tick;

  switch (p.type) {
    case "SET_PRICING": {
      const off = state.commercial.offerings.find((o) => o.id === p.offeringId);
      if (!off) {
        errors.push(`Offering ${p.offeringId} not found`);
        return;
      }
      off.pricing = p.pricing;
      effects.push(`Updated pricing model on ${off.name} to ${p.pricing.kind}`);
      return;
    }

    case "SET_DISCOUNT": {
      const off = state.commercial.offerings.find((o) => o.id === p.offeringId);
      if (!off) {
        errors.push(`Offering ${p.offeringId} not found`);
        return;
      }
      off.discountPct = clamp(p.discountPct, 0, 0.9);
      effects.push(`Set discount on ${off.name} to ${(off.discountPct * 100).toFixed(1)}%`);
      return;
    }

    case "TOGGLE_OFFERING": {
      const off = state.commercial.offerings.find((o) => o.id === p.offeringId);
      if (!off) {
        errors.push(`Offering ${p.offeringId} not found`);
        return;
      }
      off.active = p.active;
      effects.push(`${p.active ? "Activated" : "Paused"} offering ${off.name}`);
      return;
    }

    case "SET_MARKETING_BUDGET": {
      const ch = state.commercial.marketing.find((m) => m.id === p.channelId);
      if (!ch) {
        errors.push(`Marketing channel ${p.channelId} not found`);
        return;
      }
      ch.dailyBudget = Math.max(0, Math.round(p.dailyBudget));
      effects.push(
        `Set ${ch.name} daily budget to $${(ch.dailyBudget / 100).toFixed(0)}/day`,
      );
      return;
    }

    case "SET_CHANNEL_TERMS": {
      const ch = state.commercial.channels.find((c) => c.id === p.channelId);
      if (!ch) {
        errors.push(`Sales channel ${p.channelId} not found`);
        return;
      }
      ch.paymentTermsDays = clamp(Math.round(p.paymentTermsDays), 0, 180);
      effects.push(`Set ${ch.name} customer payment terms to Net ${ch.paymentTermsDays}`);
      return;
    }

    case "PLACE_PURCHASE_ORDER": {
      const res = placePurchaseOrder(state, rng, {
        supplierId: p.supplierId,
        itemId: p.itemId,
        warehouseId: p.warehouseId,
        laneId: p.laneId,
        qty: p.qty,
        auto: false,
      });
      if (!res.ok || !res.po) {
        errors.push(res.error ?? "Failed to place purchase order");
        return;
      }
      effects.push(
        `Placed PO ${res.po.id} for ${res.po.qty} units of ${p.itemId} (ETA day ${res.po.etaTick})`,
      );
      return;
    }

    case "SET_REORDER_POLICY": {
      const idx = state.supply.reorderPolicies.findIndex((x) => x.id === p.policy.id);
      if (idx >= 0) state.supply.reorderPolicies[idx] = p.policy;
      else state.supply.reorderPolicies.push(p.policy);
      effects.push(
        `Updated reorder policy ${p.policy.id} (${p.policy.mode}, ${p.policy.strategy.toUpperCase()})`,
      );
      return;
    }

    case "SET_PRODUCTION_POLICY": {
      const idx = state.operations.policies.findIndex(
        (x) => x.recipeId === p.policy.recipeId,
      );
      if (idx >= 0) state.operations.policies[idx] = p.policy;
      else state.operations.policies.push(p.policy);
      effects.push(
        `Set production policy for ${p.policy.recipeId} (${p.policy.mode}, target=${p.policy.targetStockUnits})`,
      );
      return;
    }

    case "SCHEDULE_PRODUCTION": {
      const recipe = state.catalog.recipes.find((r) => r.id === p.recipeId);
      if (!recipe) {
        errors.push(`Recipe ${p.recipeId} not found`);
        return;
      }
      scheduleProductionOrder(state, recipe, p.batches);
      effects.push(`Scheduled ${p.batches} batches of ${recipe.name}`);
      return;
    }

    case "SET_OVERTIME": {
      const wc = state.operations.workCenters.find((w) => w.id === p.workCenterId);
      if (!wc) {
        errors.push(`Work center ${p.workCenterId} not found`);
        return;
      }
      wc.overtimeHoursPerDay = clamp(p.hoursPerDay, 0, wc.maxOvertimeHoursPerDay);
      effects.push(
        `Set overtime at ${wc.name} to ${wc.overtimeHoursPerDay.toFixed(1)} hrs/day`,
      );
      return;
    }

    case "SET_SOURCING": {
      const wc = state.operations.workCenters.find((w) => w.id === p.workCenterId);
      if (!wc) {
        errors.push(`Work center ${p.workCenterId} not found`);
        return;
      }
      if (p.sourcing === "outsourced" && !wc.outsource) {
        errors.push(`Work center ${wc.name} has no configured contract manufacturer`);
        return;
      }
      wc.sourcing = p.sourcing;
      effects.push(`Switched ${wc.name} sourcing to ${p.sourcing}`);
      return;
    }

    case "CAPEX_UPGRADE": {
      const amt = Math.round(p.amount);
      const cash = debitBalance(state.finance.ledger, "cash");
      if (p.financing === "cash" && cash < amt) {
        errors.push(
          `Insufficient cash ($${(cash / 100).toFixed(0)}) for CapEx upgrade ($${(amt / 100).toFixed(0)})`,
        );
        return;
      }

      if (p.targetKind === "work_center") {
        const wc = state.operations.workCenters.find((w) => w.id === p.targetId);
        if (!wc) {
          errors.push(`Work center ${p.targetId} not found`);
          return;
        }
        if (p.upgrade === "capacity") {
          wc.machineHoursPerDay = Math.round(wc.machineHoursPerDay * 1.25);
        } else if (p.upgrade === "automation") {
          wc.machineHoursPerDay = Math.round(wc.machineHoursPerDay * 1.18);
          wc.variableCostPerHour = Math.max(100, Math.round(wc.variableCostPerHour * 0.88));
        } else if (p.upgrade === "maintenance_overhaul") {
          wc.condition = 1.0;
          wc.machineHoursPerDay = Math.round(wc.machineHoursPerDay * 1.12);
        }
        effects.push(`CapEx upgrade (${p.upgrade}) applied to work center ${wc.name}`);
      } else {
        const wh = state.warehouses.sites.find((w) => w.id === p.targetId);
        if (!wh) {
          errors.push(`Warehouse ${p.targetId} not found`);
          return;
        }
        if (p.upgrade === "automation") {
          wh.automationLevel = clamp(wh.automationLevel + 0.22, 0, 1);
          wh.pickPackUnitsPerDay = Math.round(wh.pickPackUnitsPerDay * 1.2);
          wh.receivingUnitsPerDay = Math.round(wh.receivingUnitsPerDay * 1.15);
        } else if (p.upgrade === "capacity") {
          for (const z of wh.zones) z.capacityM3 = Math.round(z.capacityM3 * 1.3);
        } else if (p.upgrade === "cold_zone") {
          const chilled = wh.zones.find((z) => z.handling === "chilled");
          if (chilled) chilled.capacityM3 = Math.round(chilled.capacityM3 * 1.35);
          else wh.zones.push({ handling: "chilled", capacityM3: 500 });
        }
        effects.push(`CapEx upgrade (${p.upgrade}) applied to warehouse ${wh.name}`);
      }

      // Book FixedAsset + GL entry (Cash or Equipment Loan)
      state.finance.fixedAssets.push({
        id: nextId(state, "fa"),
        name: `${p.upgrade} upgrade (${p.targetId})`,
        kind: p.upgrade === "automation" ? "automation" : "equipment",
        cost: amt,
        salvage: Math.round(amt * 0.1),
        usefulLifeDays: 1080,
        acquiredTick: tick,
        accumulatedDepreciation: 0,
        linked: { kind: p.targetKind, id: p.targetId },
      });

      if (p.financing === "cash") {
        postJournal(state, {
          memo: `CapEx acquisition (${p.upgrade}) paid in cash`,
          source: "action:capex_cash",
          cashFlow: "investing",
          lines: [
            { account: "ppe_gross", amount: amt },
            { account: "cash", amount: -amt },
          ],
        });
      } else {
        // Equipment loan (36 months amortization)
        state.finance.debts.push({
          id: nextId(state, "debt"),
          kind: "equipment",
          lender: "Equipment Finance Corp",
          limit: amt,
          principal: amt,
          spreadBps: 325,
          monthlyAmortization: Math.round(amt / 36),
          maturityTick: tick + 1080,
          covenants: [],
          status: "active",
          consecutiveBreaches: 0,
        });
        postJournal(state, {
          memo: `CapEx acquisition (${p.upgrade}) financed via equipment loan`,
          source: "action:capex_loan",
          lines: [
            { account: "ppe_gross", amount: amt },
            { account: "term_debt", amount: -amt },
          ],
        });
      }
      return;
    }

    case "LEASE_WAREHOUSE": {
      if (state.warehouses.sites.some((w) => w.id === p.warehouse.id)) {
        errors.push(`Warehouse ${p.warehouse.id} already exists`);
        return;
      }
      state.warehouses.sites.push(p.warehouse);
      effects.push(`Leased warehouse ${p.warehouse.name} in ${p.warehouse.region}`);
      return;
    }

    case "SET_CAPABILITY_INVESTMENT": {
      const cap = state.operations.capabilities.find((c) => c.id === p.capabilityId);
      if (!cap) {
        errors.push(`Capability ${p.capabilityId} not found`);
        return;
      }
      cap.dailyInvestment = Math.max(0, Math.round(p.dailyInvestment));
      effects.push(
        `Set ${cap.name} capability investment to $${(cap.dailyInvestment / 100).toFixed(0)}/day`,
      );
      return;
    }

    case "SET_CAPABILITY_OWNER": {
      const cap = state.operations.capabilities.find((c) => c.id === p.capabilityId);
      if (!cap) {
        errors.push(`Capability ${p.capabilityId} not found`);
        return;
      }
      cap.ownerRoleId = p.roleId;
      effects.push(`Assigned role ${p.roleId} as owner of capability ${cap.name}`);
      return;
    }

    case "HIRE": {
      const pos = state.org.positions.find((x) => x.roleId === p.roleId);
      if (!pos) {
        errors.push(`Role ${p.roleId} not found`);
        return;
      }
      const role = getRole(state, p.roleId);
      const totalRecruitFee = Math.round(role.recruitingCost * p.count);
      if (totalRecruitFee > 0) {
        payOrQueuePayable(state, {
          debitAccount: "opex_recruiting",
          amount: totalRecruitFee,
          memo: `Recruiting fee for ${p.count}x ${role.title}`,
          source: "action:hire",
          counterparty: "Talent Acquisition Partners",
          kind: "vendor",
          dueOffsetDays: 7,
          priority: 4,
        });
      }
      const leadDays = Math.max(1, Math.round(rng.sample(role.recruitingLeadDays)));
      pos.pendingHires.push({ count: p.count, readyTick: tick + leadDays });
      effects.push(
        `Initiated hiring of ${p.count}x ${role.title} (start day ${tick + leadDays})`,
      );
      return;
    }

    case "LAYOFF": {
      const pos = state.org.positions.find((x) => x.roleId === p.roleId);
      if (!pos) {
        errors.push(`Role ${p.roleId} not found`);
        return;
      }
      const role = getRole(state, p.roleId);
      const hc = roleHeadcount(pos);
      if (hc === 0) {
        errors.push(`Role ${role.title} has 0 active headcount`);
        return;
      }
      const removed = removeFromCohorts(pos, Math.min(hc, p.count));
      const weeklyPay = Math.round((role.annualSalary * (1 + role.benefitsLoad)) / 52);
      const severance = Math.round(removed * weeklyPay * role.severanceWeeks);
      if (severance > 0) {
        payOrQueuePayable(state, {
          debitAccount: "opex_payroll",
          amount: severance,
          memo: `Severance package for ${removed}x ${role.title}`,
          source: "action:layoff",
          counterparty: "Former Employees",
          kind: "other",
          dueOffsetDays: 0,
          priority: 1,
        });
      }
      pos.morale = clamp(pos.morale - 0.12, 0.05, 1);
      effects.push(
        `Laid off ${removed}x ${role.title} ($${(severance / 100).toFixed(0)} severance)`,
      );
      return;
    }

    case "SET_SALARY": {
      const role = state.org.roles.find((r) => r.id === p.roleId);
      if (!role) {
        errors.push(`Role ${p.roleId} not found`);
        return;
      }
      role.annualSalary = Math.round(p.annualSalary);
      effects.push(
        `Updated ${role.title} annual salary to $${(role.annualSalary / 100).toFixed(0)}`,
      );
      return;
    }

    case "ASSIGN_RACI": {
      const proc = state.org.processes.find((x) => x.id === p.processId);
      if (!proc) {
        errors.push(`Process ${p.processId} not found`);
        return;
      }
      if (p.accountableRoleId !== undefined) proc.accountableRoleId = p.accountableRoleId;
      if (p.responsibleRoleIds !== undefined) proc.responsibleRoleIds = p.responsibleRoleIds;
      effects.push(`Updated RACI ownership on process "${proc.name}"`);
      return;
    }

    case "DRAW_REVOLVER": {
      const debt = state.finance.debts.find(
        (d) => d.id === p.debtId && d.kind === "revolver",
      );
      if (!debt) {
        errors.push(`Revolver facility ${p.debtId} not found`);
        return;
      }
      if (debt.status !== "active") {
        errors.push(`Revolver ${debt.lender} is in status "${debt.status}" and cannot be drawn`);
        return;
      }
      const avail = Math.max(0, debt.limit - debt.principal);
      const draw = Math.min(avail, Math.round(p.amount));
      if (draw <= 0) {
        errors.push(`No available headroom on revolver ${debt.lender}`);
        return;
      }
      debt.principal += draw;
      postJournal(state, {
        memo: `Revolver draw from ${debt.lender}`,
        source: "action:revolver_draw",
        cashFlow: "financing",
        lines: [
          { account: "cash", amount: draw },
          { account: "revolver", amount: -draw },
        ],
      });
      effects.push(`Drew $${(draw / 100).toFixed(0)} from ${debt.lender} revolver`);
      return;
    }

    case "REPAY_DEBT": {
      const debt = state.finance.debts.find((d) => d.id === p.debtId);
      if (!debt || debt.principal <= 0) {
        errors.push(`Active debt facility ${p.debtId} not found`);
        return;
      }
      const cash = debitBalance(state.finance.ledger, "cash");
      const repay = Math.min(cash, debt.principal, Math.round(p.amount));
      if (repay <= 0) {
        errors.push(`Insufficient cash to repay debt ${debt.lender}`);
        return;
      }
      debt.principal -= repay;
      if (debt.principal === 0) debt.status = "repaid";
      const acc = debt.kind === "revolver" ? "revolver" : "term_debt";
      postJournal(state, {
        memo: `Debt repayment to ${debt.lender}`,
        source: "action:debt_repay",
        cashFlow: "financing",
        lines: [
          { account: acc, amount: repay },
          { account: "cash", amount: -repay },
        ],
      });
      effects.push(`Repaid $${(repay / 100).toFixed(0)} on ${debt.lender}`);
      return;
    }

    case "TAKE_LOAN": {
      const amt = Math.round(p.principal);
      state.finance.debts.push({
        id: nextId(state, "debt"),
        kind: p.kind,
        lender: p.lender,
        limit: amt,
        principal: amt,
        spreadBps: p.spreadBps,
        monthlyAmortization: Math.round(amt / p.termMonths),
        maturityTick: tick + p.termMonths * 30,
        covenants: p.covenants,
        status: "active",
        consecutiveBreaches: 0,
      });
      postJournal(state, {
        memo: `New ${p.kind} facility from ${p.lender}`,
        source: "action:take_loan",
        cashFlow: "financing",
        lines: [
          { account: "cash", amount: amt },
          { account: "term_debt", amount: -amt },
        ],
      });
      effects.push(`Closed $${(amt / 100).toFixed(0)} ${p.kind} with ${p.lender}`);
      return;
    }

    case "RAISE_EQUITY": {
      const amt = Math.round(p.amount);
      const preMoney = Math.max(100_00, Math.round(p.preMoneyValuation));
      const postMoney = preMoney + amt;
      const existingShares = state.finance.equity.sharesOutstanding;
      const newShares = Math.max(
        1,
        Math.round((existingShares * amt) / preMoney),
      );
      state.finance.equity.sharesOutstanding += newShares;
      state.finance.equity.capTable.push({
        holder: p.investor,
        shares: newShares,
        invested: amt,
        round: p.roundName,
      });
      state.finance.equity.rounds.push({
        tick,
        name: p.roundName,
        investor: p.investor,
        amount: amt,
        preMoney,
        postMoney,
        sharesIssued: newShares,
        boardSeat: p.boardSeat,
      });
      if (p.boardSeat) {
        state.finance.equity.boardPressure = clamp(
          state.finance.equity.boardPressure + 0.15,
          0,
          1,
        );
      }
      postJournal(state, {
        memo: `${p.roundName} equity financing from ${p.investor}`,
        source: "action:equity_raise",
        cashFlow: "financing",
        lines: [
          { account: "cash", amount: amt },
          { account: "paid_in_capital", amount: -amt },
        ],
      });
      effects.push(
        `Raised $${(amt / 100).toFixed(0)} in ${p.roundName} from ${p.investor} (${((newShares / state.finance.equity.sharesOutstanding) * 100).toFixed(1)}% dilution)`,
      );
      return;
    }

    case "FACTOR_RECEIVABLES": {
      if (state.finance.receivables.length === 0) {
        errors.push("No open Accounts Receivable to factor");
        return;
      }
      let totalFactored: number = 0;
      for (const ar of state.finance.receivables) {
        const take = Math.floor(ar.amount * p.fraction);
        if (take > 0) {
          ar.amount -= take;
          totalFactored += take;
        }
      }
      state.finance.receivables = state.finance.receivables.filter((r) => r.amount > 0);
      if (totalFactored <= 0) {
        errors.push("Factored amount rounded to zero");
        return;
      }
      const fee = Math.round(totalFactored * p.discountPct);
      const netCash = totalFactored - fee;
      postJournal(state, {
        memo: `Factored $${(totalFactored / 100).toFixed(0)} of AR at ${(p.discountPct * 100).toFixed(1)}% discount`,
        source: "action:factor_ar",
        cashFlow: "operating",
        lines: [
          { account: "cash", amount: netCash },
          ...(fee > 0 ? [{ account: "interest_expense" as const, amount: fee }] : []),
          { account: "accounts_receivable", amount: -totalFactored },
        ],
      });
      effects.push(
        `Factored $${(totalFactored / 100).toFixed(0)} of receivables for $${(netCash / 100).toFixed(0)} immediate cash`,
      );
      return;
    }

    case "RESOLVE_DECISION": {
      const dec = state.events.decisions.find((d) => d.id === p.decisionId);
      if (!dec || dec.status !== "pending") {
        errors.push(`Pending decision card ${p.decisionId} not found`);
        return;
      }
      const opt = dec.options.find((o) => o.id === p.optionId);
      if (!opt) {
        errors.push(`Decision option ${p.optionId} not found on ${dec.id}`);
        return;
      }
      dec.status = "resolved";
      dec.chosenOptionId = opt.id;
      for (const act of opt.actions) {
        applyPayload(state, rng, act, errors, effects);
      }
      const anyStillPending = state.events.decisions.some((d) => d.status === "pending");
      if (!anyStillPending && state.status === "paused_decision") {
        state.status = "running";
      }
      effects.push(`Resolved crisis decision "${dec.title}" -> ${opt.label}`);
      return;
    }

    case "COMPETITOR_SET_PRICE": {
      const comp = state.market.competitors.find((c) => c.id === p.competitorId);
      const coff = comp?.offerings.find((o) => o.segmentId === p.segmentId);
      if (!comp || !coff) {
        errors.push(`Competitor offering ${p.competitorId}/${p.segmentId} not found`);
        return;
      }
      coff.price = Math.round(p.price);
      comp.lastMoveTick = tick;
      effects.push(`${comp.name} set price in ${p.segmentId} to $${(coff.price / 100).toFixed(2)}`);
      return;
    }

    case "COMPETITOR_INVEST": {
      const comp = state.market.competitors.find((c) => c.id === p.competitorId);
      if (!comp) {
        errors.push(`Competitor ${p.competitorId} not found`);
        return;
      }
      comp.cash -= Math.round(p.amount);
      if (p.kind === "capacity") comp.capacityUnitsPerDay = Math.round(comp.capacityUnitsPerDay * 1.15);
      for (const coff of comp.offerings) {
        if (p.kind === "quality") coff.quality = clamp(coff.quality + 0.03, 0.1, 0.99);
        if (p.kind === "brand") coff.brand = clamp(coff.brand + 0.04, 0.1, 0.99);
      }
      comp.lastMoveTick = tick;
      effects.push(`${comp.name} invested $${(p.amount / 100).toFixed(0)} in ${p.kind}`);
      return;
    }

    case "NOOP": {
      effects.push(p.note ?? "No-op action executed");
      return;
    }
  }
}

/**
 * Drain and execute all queued `ActionEnvelope`s scheduled for `<= state.calendar.tick`.
 */
export function processActionQueue(state: WorldState, rng: SeededRng): ActionResult[] {
  const tick = state.calendar.tick;
  const due = state.actionQueue.filter(
    (a) => (a.executeAtTick ?? a.issuedAtTick) <= tick,
  );
  if (due.length === 0) return [];

  state.actionQueue = state.actionQueue.filter(
    (a) => (a.executeAtTick ?? a.issuedAtTick) > tick,
  );

  const results: ActionResult[] = [];
  for (const env of due) {
    results.push(executeActionEnvelope(state, rng, env));
  }
  return results;
}
