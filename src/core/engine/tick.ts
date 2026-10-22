/**
 * Engine A — The Deterministic Tick Resolver, Timeline Branching ("Git for Business Strategy")
 * & Monte Carlo Branch Runner.
 *
 * Tick execution order (1 Tick = 1 Day):
 *  1. Advance 30/360 banking calendar & seeded PRNG (`SeededRng`).
 *  2. Execute due `ActionEnvelope` payloads from `actionQueue`.
 *  3. Run Macroeconomic cycle & inflation indices (`runMacroTick`).
 *  4. Run Director AI, active crisis modifiers, decision deadlines & Competitor CEO moves (`runDirectorAndCompetitorsTick`).
 *  5. Run Org Design, Workforce ramp/fatigue/attrition, RACI Governance & daily Payroll accrual (`runOrgTick`).
 *  6. Run Capability maturity dynamics & maintenance/investment (`runCapabilitiesTick`).
 *  7. Run Inbound Supply Chain, PO dock receiving & automated EOQ/JIT reorder policies (`runSupplyChainTick`).
 *  8. Run Operations, Production scheduling & Little's Law queuing physics (`runOperationsTick`).
 *  9. Run Warehouse holding physics: perishable expiration, shrinkage, rent, insurance & 3PL storage (`runWarehouseHoldingTick`).
 * 10. Run Market Demand (Multinomial Logit utility choice), Marketing Funnel, B2B Pipeline, Order Fulfillment & Returns (`runCommercialAndMarketTick`).
 * 11. Run Corporate Finance: depreciation, interest accrual, AR collection, bi-weekly payroll, AP settlement & insolvency checks (`runFinanceAndTreasuryTick`).
 * 12. Record Daily KPIs & Working Capital Conversion Cycle ($\text{CCC} = \text{DIO} + \text{DSO} - \text{DPO}$).
 * 13. On Day 30 of each month: run Corporate Tax, Debt Covenant checks, snapshot `MonthlyReport`, and close nominal P&L accounts into `retained_earnings`.
 */
import type {
  ActionEnvelope,
  ActionPayload,
  ActionResult,
  DailyKpi,
  MonthlyReport,
  TimelineBranch,
  TriggerAlert,
  WorldState,
} from "../schema";
import { executeActionEnvelope } from "./actions";
import type { DirectorOptions } from "./director";
import { debitBalance } from "./ledger";
import { nextId } from "./modifiers";
import { SeededRng } from "./rng";
import {
  type PipelineStepName,
  resolveTick,
  type TickResolverOptions,
} from "./tickResolver";

export interface StepTickOptions extends DirectorOptions, TickResolverOptions {
  /** If true, throws immediately if any double-entry or sub-ledger invariant is violated. */
  strictInvariants?: boolean;
  /** If true, steps even when `status === "paused_decision"`, auto-selecting the default option. */
  forceStepWhenPaused?: boolean;
}

export interface StepTickResult {
  tick: number;
  dailyKpi: DailyKpi;
  monthlyReport?: MonthlyReport;
  actionResults: ActionResult[];
  invariantErrors: string[];
  triggers: TriggerAlert[];
  yieldToCognitiveOrchestrator: boolean;
  pipelineTrace: PipelineStepName[];
}

/** Deep-clone a `WorldState` (pure JSON-compatible structure). */
export function cloneWorldState(state: WorldState): WorldState {
  return structuredClone(state);
}

/** Enqueue an action payload onto `state.actionQueue` (or execute immediately if `immediate = true`). */
export function dispatchAction(
  state: WorldState,
  payload: ActionPayload,
  opts: {
    issuedBy?: string;
    rationale?: string;
    immediate?: boolean;
  } = {},
): ActionResult | ActionEnvelope {
  const env: ActionEnvelope = {
    id: nextId(state, "act"),
    issuedBy: opts.issuedBy ?? "player",
    issuedAtTick: state.calendar.tick,
    executeAtTick: opts.immediate ? state.calendar.tick : state.calendar.tick + 1,
    rationale: opts.rationale,
    payload,
  };

  if (opts.immediate) {
    const rng = new SeededRng(state.rngState);
    const res = executeActionEnvelope(state, rng, env);
    state.rngState = rng.state;
    return res;
  }

  state.actionQueue.push(env);
  return env;
}

/**
 * Advance `state` in place by 1 simulation tick (1 day) using the strict 8-step `resolveTick` pipeline.
 */
export function stepTick(
  state: WorldState,
  opts: StepTickOptions = {},
): StepTickResult {
  const res = resolveTick(state, opts);
  return {
    tick: res.tick,
    dailyKpi: res.dailyKpi,
    monthlyReport: res.monthlyReport,
    actionResults: res.actionResults,
    invariantErrors: res.invariantErrors,
    triggers: res.triggers,
    yieldToCognitiveOrchestrator: res.yieldToCognitiveOrchestrator,
    pipelineTrace: res.pipelineTrace,
  };
}

/** Advance `state` by `days` ticks (stopping early on bankruptcy or unforced decision pause). */
export function runTicks(
  state: WorldState,
  days: number,
  opts: StepTickOptions = {},
): StepTickResult[] {
  const out: StepTickResult[] = [];
  for (let i = 0; i < days; i++) {
    if (state.status === "bankrupt" || state.status === "completed") break;
    if (state.status === "paused_decision" && !opts.autoResolveDecisions && !opts.forceStepWhenPaused) {
      break;
    }
    out.push(stepTick(state, opts));
  }
  return out;
}

// ── Timeline Branching ("Git for Business Cases") & Monte Carlo Comparator ──

export function createRootBranch(initialState: WorldState, name = "main"): TimelineBranch {
  const cloned = cloneWorldState(initialState);
  return {
    id: "branch_main",
    name,
    forkTick: cloned.calendar.tick,
    createdAt: new Date().toISOString(),
    head: cloned,
    snapshots: {
      [String(cloned.calendar.tick)]: cloneWorldState(cloned),
    },
  };
}

export function snapshotBranch(branch: TimelineBranch): void {
  branch.snapshots[String(branch.head.calendar.tick)] = cloneWorldState(branch.head);
}

/**
 * Fork a new `TimelineBranch` from `sourceBranch` at `atTick` (defaults to current `head`),
 * optionally applying an array of strategic `ActionPayload`s immediately on the new branch.
 */
export function forkTimelineBranch(
  sourceBranch: TimelineBranch,
  opts: {
    id?: string;
    name: string;
    atTick?: number;
    notes?: string;
    initialActions?: ActionPayload[];
  },
): TimelineBranch {
  const forkTick = opts.atTick ?? sourceBranch.head.calendar.tick;
  const snap =
    sourceBranch.snapshots[String(forkTick)] ?? sourceBranch.head;
  const head = cloneWorldState(snap);

  if (opts.initialActions) {
    for (const act of opts.initialActions) {
      dispatchAction(head, act, {
        issuedBy: `branch:${opts.name}`,
        rationale: opts.notes,
        immediate: true,
      });
    }
  }

  return {
    id: opts.id ?? `branch_${head.calendar.tick}_${Math.abs(head.rngState % 10000)}`,
    name: opts.name,
    parentBranchId: sourceBranch.id,
    forkTick: head.calendar.tick,
    createdAt: new Date().toISOString(),
    notes: opts.notes,
    head,
    snapshots: {
      [String(head.calendar.tick)]: cloneWorldState(head),
    },
  };
}

export interface MonteCarloSummary {
  runs: number;
  horizonDays: number;
  survivalRate: number;
  endingCashP10: number;
  endingCashP50: number;
  endingCashP90: number;
  cumulativeNetIncomeP50: number;
  endingMarketShareP50: number;
  avgMinCash: number;
}

/**
 * Run `runs` independent Monte Carlo trajectories (each seeded with a distinct deterministic offset)
 * from `baseState` over `horizonDays` to compare strategic branches side-by-side.
 */
export function runMonteCarloSimulation(
  baseState: WorldState,
  opts: {
    runs: number;
    horizonDays: number;
    branchActions?: ActionPayload[];
  },
): MonteCarloSummary {
  const endingCashes: number[] = [];
  const cumNetIncomes: number[] = [];
  const endingShares: number[] = [];
  let survived = 0;
  let sumMinCash = 0;

  for (let r = 0; r < opts.runs; r++) {
    const sim = cloneWorldState(baseState);
    // Perturb PRNG state deterministically per trajectory
    sim.rngState = (baseState.rngState + (r + 1) * 0x9e3779b9) | 0;

    if (opts.branchActions) {
      for (const act of opts.branchActions) {
        dispatchAction(sim, act, { issuedBy: "montecarlo", immediate: true });
      }
    }

    let minCash = debitBalance(sim.finance.ledger, "cash");
    for (let d = 0; d < opts.horizonDays; d++) {
      if (sim.status === "bankrupt") break;
      const res = stepTick(sim, { autoResolveDecisions: true });
      if (res.dailyKpi.cash < minCash) minCash = res.dailyKpi.cash;
    }

    if (sim.status !== "bankrupt") survived += 1;
    sumMinCash += minCash;

    const finalCash = debitBalance(sim.finance.ledger, "cash");
    endingCashes.push(finalCash);
    cumNetIncomes.push(sim.finance.ytdNetIncome);

    const lastKpi = sim.telemetry.daily[sim.telemetry.daily.length - 1];
    endingShares.push(lastKpi?.marketShare ?? 0);
  }

  endingCashes.sort((a, b) => a - b);
  cumNetIncomes.sort((a, b) => a - b);
  endingShares.sort((a, b) => a - b);

  const pickPct = (arr: number[], p: number) =>
    arr.length === 0 ? 0 : arr[Math.min(arr.length - 1, Math.floor(arr.length * p))];

  return {
    runs: opts.runs,
    horizonDays: opts.horizonDays,
    survivalRate: opts.runs > 0 ? survived / opts.runs : 0,
    endingCashP10: pickPct(endingCashes, 0.1),
    endingCashP50: pickPct(endingCashes, 0.5),
    endingCashP90: pickPct(endingCashes, 0.9),
    cumulativeNetIncomeP50: pickPct(cumNetIncomes, 0.5),
    endingMarketShareP50: pickPct(endingShares, 0.5),
    avgMinCash: opts.runs > 0 ? Math.round(sumMinCash / opts.runs) : 0,
  };
}
