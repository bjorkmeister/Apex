/**
 * Deterministic Engine A — Strict 8-Step Micro-Tick Pipeline Resolver & Tiered Tick-Clock Monitor.
 *
 * Enforces the exact per-tick execution sequence:
 *  1. Inbound Logistics (`1_INBOUND_LOGISTICS`)
 *  2. Warehouse Storage & Spoilage (`2_WAREHOUSE_STORAGE_AND_SPOILAGE`)
 *  3. Production & Queuing (`3_PRODUCTION_AND_QUEUING`)
 *  4. Demand & Market Matching (`4_DEMAND_AND_MARKET_MATCHING`)
 *  5. Outbound Logistics & Invoicing (`5_OUTBOUND_LOGISTICS_AND_INVOICING`)
 *  6. Workforce & RACI (`6_WORKFORCE_AND_RACI`)
 *  7. Treasury & Three-Statement Reconciliation (`7_TREASURY_AND_RECONCILIATION`)
 *  8. Trigger Monitor (`8_TRIGGER_MONITOR`)
 *
 * Cognitive Engine B (LLM Agents) is never invoked inside the daily micro-tick loop;
 * instead, `runMicroTickLoop` runs synchronous in-memory micro-ticks and yields execution
 * to the Cognitive Orchestrator only on scheduled macro-intervals or state-driven interrupt triggers.
 */
import type {
  ActionResult,
  DailyKpi,
  FinancialStatements,
  MonthlyReport,
  SimulationState,
  TriggerAlert,
} from "../schema";
import { processActionQueue } from "./actions";
import { type DirectorOptions, runDirectorAndCompetitorsTick } from "./director";
import {
  recordDailyTelemetry,
  runFinanceAndTreasuryTick,
  runMonthEndClose,
} from "./finance";
import {
  buildBalanceSheet,
  buildFinancialStatements,
  buildIncomeStatement,
  verifyAccountingInvariants,
} from "./ledger";
import {
  runDemandAndMarketMatchingTick,
  runMacroTick,
  runOutboundLogisticsAndInvoicingTick,
} from "./market";
import { advanceCalendar } from "./modifiers";
import { runCapabilitiesTick, runOperationsTick } from "./operations";
import { runOrgTick } from "./org";
import { SeededRng } from "./rng";
import { runSupplyChainTick } from "./supply";
import { onHandQty, runWarehouseHoldingTick } from "./warehouse";

export const PIPELINE_STEPS = [
  "1_INBOUND_LOGISTICS",
  "2_WAREHOUSE_STORAGE_AND_SPOILAGE",
  "3_PRODUCTION_AND_QUEUING",
  "4_DEMAND_AND_MARKET_MATCHING",
  "5_OUTBOUND_LOGISTICS_AND_INVOICING",
  "6_WORKFORCE_AND_RACI",
  "7_TREASURY_AND_RECONCILIATION",
  "8_TRIGGER_MONITOR",
] as const;

export type PipelineStepName = (typeof PIPELINE_STEPS)[number];

export interface TickResolverOptions extends DirectorOptions {
  /** If true, throws immediately if any double-entry or sub-ledger invariant is violated. */
  strictInvariants?: boolean;
  /** If true, steps even when `status === "paused_decision"`, auto-selecting the default option. */
  forceStepWhenPaused?: boolean;
  /**
   * If true, scheduled macro-intervals (`WEEKLY_WAR_ROOM` every 7 days, `MONTHLY_PNL_REVIEW` every 30 days)
   * also trigger a Cognitive Orchestrator yield in `evaluateTriggerMonitor`.
   */
  pauseOnMacroIntervals?: boolean;
  /**
   * Optional callback invoked immediately as each of the 8 pipeline stages begins.
   * Useful for deterministic sequence auditing in unit tests.
   */
  onPipelineStep?: (step: PipelineStepName, state: SimulationState) => void;
}

export interface TickResolutionResult {
  tick: number;
  dailyKpi: DailyKpi;
  monthlyReport?: MonthlyReport;
  statements: FinancialStatements;
  actionResults: ActionResult[];
  invariantErrors: string[];
  triggers: TriggerAlert[];
  yieldToCognitiveOrchestrator: boolean;
  pipelineTrace: PipelineStepName[];
}

export interface MicroTickLoopResult {
  ticksExecuted: number;
  results: TickResolutionResult[];
  yielded: boolean;
  activeTriggers: TriggerAlert[];
}

/**
 * Execute 1 daily deterministic micro-tick (`dt = 1 day`) in strict 8-step order.
 */
export function resolveTick(
  state: SimulationState,
  opts: TickResolverOptions = {},
): TickResolutionResult {
  if (state.status === "bankrupt" || state.status === "completed") {
    const lastDaily =
      state.telemetry.daily[state.telemetry.daily.length - 1] ??
      recordDailyTelemetry(state, {
        prevNetRevenue: 0,
        prevCogs: 0,
        prevOpex: 0,
        prevNetIncome: 0,
        prevCash: 0,
        purchasesToday: 0,
        unitsDemanded: 0,
        unitsShipped: 0,
        unitsLost: 0,
      });
    const statements = buildFinancialStatements(state);
    const triggers: TriggerAlert[] =
      state.status === "bankrupt"
        ? [
            {
              kind: "BANKRUPTCY",
              tick: state.calendar.tick,
              severity: "critical",
              message: state.bankruptcyReason ?? "Company is bankrupt.",
            },
          ]
        : [];
    state.lastTriggers = triggers;
    return {
      tick: state.calendar.tick,
      dailyKpi: lastDaily,
      statements,
      actionResults: [],
      invariantErrors: verifyAccountingInvariants(state),
      triggers,
      yieldToCognitiveOrchestrator: triggers.length > 0,
      pipelineTrace: [],
    };
  }

  // Snapshot pre-tick cumulative nominal P&L balances and competitor offering prices
  const preIs = buildIncomeStatement(state.finance.ledger);
  const preBs = buildBalanceSheet(state.finance.ledger);
  const preCompetitorPrices = new Map<string, number>();
  for (const comp of state.market.competitors) {
    for (const off of comp.offerings) {
      preCompetitorPrices.set(`${comp.id}:${off.segmentId}`, off.price);
    }
  }

  // Advance 30/360 calendar & initialize deterministic PRNG from `state.rngState`
  advanceCalendar(state);
  const rng = new SeededRng(state.rngState);

  // Commit any queued Two-Phase Commit actions scheduled for this tick
  const actionResults = processActionQueue(state, rng);

  // Advance stochastic crisis modifiers & competitor AI posture
  runDirectorAndCompetitorsTick(state, rng, {
    autoResolveDecisions: opts.autoResolveDecisions || opts.forceStepWhenPaused,
    forceCrisisOnEvaluation: opts.forceCrisisOnEvaluation,
  });

  const pipelineTrace: PipelineStepName[] = [];
  const markStep = (step: PipelineStepName): void => {
    pipelineTrace.push(step);
    opts.onPipelineStep?.(step, state);
  };

  // ── STEP 1: Inbound Logistics ──────────────────────────────────────────────
  // Decrement transit lead-times; receive arriving supplier shipments at dock; trigger EOQ/JIT reorders.
  markStep("1_INBOUND_LOGISTICS");
  const { purchasesBookedToday } = runSupplyChainTick(state, rng);

  // ── STEP 2: Warehouse Storage & Spoilage ───────────────────────────────────
  // Apply cubic capacity constraints; accrue holding costs; execute spoilage/shrinkage depreciation curves.
  markStep("2_WAREHOUSE_STORAGE_AND_SPOILAGE");
  runWarehouseHoldingTick(state);

  // ── STEP 3: Production & Queuing ───────────────────────────────────────────
  // Pull BOM raw materials from inventory; enforce Little's Law (L = λW) capacity bottlenecks; compute machine wear & WIP progress.
  markStep("3_PRODUCTION_AND_QUEUING");
  runCapabilitiesTick(state);
  runOperationsTick(state, rng);

  // ── STEP 4: Demand & Market Matching ───────────────────────────────────────
  // Evaluate customer utility functions and price elasticity against offerings; generate order bookings.
  markStep("4_DEMAND_AND_MARKET_MATCHING");
  runMacroTick(state);
  const { unitsDemandedToday } = runDemandAndMarketMatchingTick(state, rng);

  // ── STEP 5: Outbound Logistics & Invoicing ─────────────────────────────────
  // Ship fulfilled orders; issue Accounts Receivable (A/R) invoices; debit finished inventory; log stockout churn.
  markStep("5_OUTBOUND_LOGISTICS_AND_INVOICING");
  const { unitsShippedToday, unitsLostToday } = runOutboundLogisticsAndInvoicingTick(
    state,
    rng,
  );

  // ── STEP 6: Workforce & RACI ───────────────────────────────────────────────
  // Accrue work hours; apply onboarding ramp factors (new hires at 30% efficiency); calculate overtime fatigue and attrition roll.
  markStep("6_WORKFORCE_AND_RACI");
  runOrgTick(state, rng);

  // ── STEP 7: Treasury & Three-Statement Reconciliation ──────────────────────
  // Collect matured A/R (DSO), pay matured A/P (DPO), deduct payroll/rent/utility OpEx,
  // accrue debt interest & evaluate loan covenants, and reconcile Cash, P&L, and Balance Sheet (Assets = Liabilities + Equity).
  markStep("7_TREASURY_AND_RECONCILIATION");
  runFinanceAndTreasuryTick(state, rng);

  // Persist PRNG state
  state.rngState = rng.state;

  const dailyKpi = recordDailyTelemetry(state, {
    prevNetRevenue: preIs.netRevenue,
    prevCogs: preIs.cogs.total,
    prevOpex: preIs.opex.total,
    prevNetIncome: preIs.netIncome,
    prevCash: preBs.assets.cash,
    purchasesToday: purchasesBookedToday,
    unitsDemanded: unitsDemandedToday,
    unitsShipped: unitsShippedToday,
    unitsLost: unitsLostToday,
  });

  let monthlyReport: MonthlyReport | undefined;
  if (state.calendar.dayOfMonth === 30) {
    monthlyReport = runMonthEndClose(state, dailyKpi);
  }

  const statements = monthlyReport
    ? monthlyReport.statements
    : buildFinancialStatements(state);

  const invariantErrors = verifyAccountingInvariants(state);
  if (opts.strictInvariants && invariantErrors.length > 0) {
    throw new Error(
      `Accounting invariant violation at tick ${state.calendar.tick}:\n${invariantErrors.join("\n")}`,
    );
  }

  // ── STEP 8: Trigger Monitor ────────────────────────────────────────────────
  // Check thresholds against trigger rules; if an alert condition is met, pause micro-tick loop & yield to Cognitive Orchestrator.
  markStep("8_TRIGGER_MONITOR");
  const triggers = evaluateTriggerMonitor(state, {
    dailyKpi,
    unitsLostToday,
    preCompetitorPrices,
    includeMacroIntervals: opts.pauseOnMacroIntervals ?? false,
  });
  state.lastTriggers = triggers;

  const yieldToCognitiveOrchestrator = triggers.some(
    (t) =>
      t.severity === "critical" ||
      t.severity === "warning" ||
      (opts.pauseOnMacroIntervals && t.severity === "macro"),
  );

  return {
    tick: state.calendar.tick,
    dailyKpi,
    monthlyReport,
    statements,
    actionResults,
    invariantErrors,
    triggers,
    yieldToCognitiveOrchestrator,
    pipelineTrace,
  };
}

/**
 * Evaluate Step 8 Trigger Monitor rules for the Tiered Tick-Clock Architecture.
 */
export function evaluateTriggerMonitor(
  state: SimulationState,
  ctx: {
    dailyKpi: DailyKpi;
    unitsLostToday: number;
    preCompetitorPrices: Map<string, number>;
    includeMacroIntervals: boolean;
  },
): TriggerAlert[] {
  const tick = state.calendar.tick;
  const triggers: TriggerAlert[] = [];

  // 1. Scheduled Macro-Intervals (Weekly War Room Briefing & Monthly P&L Review)
  if (ctx.includeMacroIntervals) {
    if (tick > 0 && tick % 7 === 0) {
      triggers.push({
        kind: "WEEKLY_WAR_ROOM",
        tick,
        severity: "macro",
        message: `Scheduled Weekly War Room Briefing at Day ${tick}.`,
        metricValue: tick,
        thresholdValue: 7,
      });
    }
    if (state.calendar.dayOfMonth === 30) {
      triggers.push({
        kind: "MONTHLY_PNL_REVIEW",
        tick,
        severity: "macro",
        message: `Scheduled Monthly P&L & Three-Statement Review for Month ${state.calendar.monthIndex}.`,
        metricValue: state.calendar.dayOfMonth,
        thresholdValue: 30,
      });
    }
  }

  // 2. State-Driven Interrupt: Cash runway < 30 days
  if (ctx.dailyKpi.runwayDays !== null && ctx.dailyKpi.runwayDays < 30) {
    triggers.push({
      kind: "CASH_RUNWAY_LOW",
      tick,
      severity: "critical",
      message: `Cash runway dropped to ${ctx.dailyKpi.runwayDays} days (< 30-day floor).`,
      metricValue: ctx.dailyKpi.runwayDays,
      thresholdValue: 30,
    });
  }

  // 3. State-Driven Interrupt: Inventory Stockout
  const stockedOutFinishedItem = state.catalog.items.find((it) => {
    if (it.kind !== "finished") return false;
    const onHand = onHandQty(state, it.id);
    const hasBacklog = state.commercial.backlog.some(
      (b) => b.itemId === it.id && b.qty > b.shippedQty,
    );
    return onHand <= 0 && hasBacklog;
  });

  if (ctx.unitsLostToday > 0 || stockedOutFinishedItem) {
    triggers.push({
      kind: "INVENTORY_STOCKOUT",
      tick,
      severity: "warning",
      message: stockedOutFinishedItem
        ? `Inventory stockout on ${stockedOutFinishedItem.name} with unfulfilled customer orders.`
        : `Lost ${ctx.unitsLostToday.toFixed(0)} demanded units due to stockout/expired backlog.`,
      metricValue: ctx.unitsLostToday,
      thresholdValue: 0,
    });
  }

  // 4. State-Driven Interrupt: Bank Covenant Breach
  const breachedDebt = state.finance.debts.find(
    (d) => d.status === "breach" || d.status === "default",
  );
  if (breachedDebt) {
    triggers.push({
      kind: "COVENANT_BREACH",
      tick,
      severity: "critical",
      message: `Loan covenant breach on ${breachedDebt.lender} (${breachedDebt.kind}, status: ${breachedDebt.status}).`,
      metricValue: breachedDebt.consecutiveBreaches,
      thresholdValue: 1,
    });
  }

  // 5. State-Driven Interrupt: Competitor Price Cut > 10%
  for (const comp of state.market.competitors) {
    for (const off of comp.offerings) {
      const prev = ctx.preCompetitorPrices.get(`${comp.id}:${off.segmentId}`);
      if (prev !== undefined && prev > 0) {
        const cutFraction = (prev - off.price) / prev;
        if (cutFraction > 0.1) {
          triggers.push({
            kind: "COMPETITOR_PRICE_CUT",
            tick,
            severity: "warning",
            message: `Competitor ${comp.name} slashed prices by ${(cutFraction * 100).toFixed(1)}% (> 10% threshold).`,
            metricValue: cutFraction,
            thresholdValue: 0.1,
          });
          break;
        }
      }
    }
  }

  // 6. Player-initiated / Director pending decision or Bankruptcy
  if (state.status === "paused_decision") {
    triggers.push({
      kind: "DECISION_PENDING",
      tick,
      severity: "critical",
      message: "Executive decision required before micro-tick loop can continue.",
    });
  }
  if (state.status === "bankrupt") {
    triggers.push({
      kind: "BANKRUPTCY",
      tick,
      severity: "critical",
      message: state.bankruptcyReason ?? "Insolvency triggered.",
    });
  }

  return triggers;
}

/**
 * Run up to `maxTicks` daily micro-ticks in memory, automatically pausing and yielding
 * to the Cognitive Orchestrator as soon as Step 8 (`8_TRIGGER_MONITOR`) raises an interrupt
 * (unless `ignoreInterrupts` is set).
 */
export function runMicroTickLoop(
  state: SimulationState,
  maxTicks: number,
  opts: TickResolverOptions & {
    /** If false (default), halts the loop immediately when `yieldToCognitiveOrchestrator` is true. */
    ignoreInterrupts?: boolean;
  } = {},
): MicroTickLoopResult {
  const results: TickResolutionResult[] = [];
  let yielded = false;
  let activeTriggers: TriggerAlert[] = [];

  for (let i = 0; i < maxTicks; i++) {
    if (state.status === "bankrupt" || state.status === "completed") break;
    if (
      state.status === "paused_decision" &&
      !opts.forceStepWhenPaused &&
      !opts.autoResolveDecisions
    ) {
      yielded = true;
      break;
    }

    const res = resolveTick(state, opts);
    results.push(res);

    if (!opts.ignoreInterrupts && res.yieldToCognitiveOrchestrator) {
      yielded = true;
      activeTriggers = res.triggers;
      break;
    }
  }

  return {
    ticksExecuted: results.length,
    results,
    yielded,
    activeTriggers,
  };
}
