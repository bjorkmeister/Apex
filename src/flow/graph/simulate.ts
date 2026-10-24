/**
 * APEX Studio v3.2 — Universal Enterprise Graph Simulator (`src/flow/graph/simulate.ts`).
 *
 * Implements TSD Section 5 & 6 and Execution Guide Section 4.2:
 * - Factor dependency resolution, safe formula evaluation, and periodic temporal waves.
 * - PhysicsModule evaluation delegating to `src/flow/kernel/atoms.ts` pure functions.
 * - Override 3: strict separation of operational `cycleTicks` and working-capital `cash[].delayTicks`.
 * - MechanismBinding capacity limits (roles, assets), IT modifiers, rollout dips, and critical availability.
 * - 6-stage discrete tick cycle with stream latency queues, transit loss, buffers, decay, and reorder rules.
 * - Override 4: skips `"named"`, `"unknown"`, and pending `"ghost"` nodes and marks downstream edges `"stub"`.
 * - Bottom-up composite node rollups (flow-weighted bottleneck, Little's Law) and composite stream bundling.
 * - Full double-entry accounting on `GraphLedger` and verification of all 6 TSD 6.5 invariants.
 */
import type {
  AtomMonthStats,
  DayPoint,
  MonthResult,
  PhysicalMatterAtom,
  RecurringSubAtom,
  SimulationResult,
  TimeCapacityAtom,
  TransactionalTradeAtom,
} from "../kernel/types.ts";
import { DAYS_PER_MONTH } from "../kernel/types.ts";
import {
  physicalEffectiveUnitCost,
  physicalOpeningInventory,
  timeCapacityHours,
  timePayrollPerMonth,
  tradeDemandPerMonth,
} from "../kernel/atoms.ts";
import { combineStress, type StressInput } from "../kernel/stress.ts";
import { evaluate, parseFormula, type Node as FormulaAst } from "../model/formula.ts";
import type {
  EnterpriseGraph,
  EntityURI,
  FactorRef,
  NodeTickState,
  PhysicsModule,
  PhysicsOutput,
  StreamTickState,
  UniversalEnterpriseNode,
  UnitMassBalance,
} from "./types.ts";
import { buildRegistry, type EntityRegistry } from "./registry.ts";
import {
  buildFinancialStatements,
  createEmptyLedger,
  debitBalance,
  postJournal,
  verifyLedgerInvariants,
  type FinancialStatements,
  type GraphLedger,
} from "./ledger.ts";

const clampDay = (d: number): number => Math.min(DAYS_PER_MONTH, Math.max(1, Math.round(d || 1)));
const nonNeg = (n: number): number => (Number.isFinite(n) && n > 0 ? n : 0);
const clamp01 = (n: number): number => Math.min(1, Math.max(0, Number.isFinite(n) ? n : 0));

class CashSchedule {
  private readonly amounts: number[] = [];
  add(day: number, amount: number): void {
    if (amount === 0) return;
    this.amounts[day] = (this.amounts[day] ?? 0) + amount;
  }
  take(day: number): number {
    const v = this.amounts[day] ?? 0;
    this.amounts[day] = 0;
    return v;
  }
}

export interface GraphSimulateOptions {
  horizonTicks?: number;
  horizonMonths?: number;
  registry?: EntityRegistry;
  /** Optional deterministic seed for stochastic extensions. */
  seed?: number;
}

export interface SimulationRun extends SimulationResult {
  maturityGated: boolean;
  ledger: GraphLedger;
  statements: FinancialStatements;
  monthlyStatements: FinancialStatements[];
  nodeStates: Record<string, NodeTickState>;
  streamStates: Record<string, StreamTickState>;
  unitMassBalances: Record<string, UnitMassBalance>;
  bottleneckNodeUri: EntityURI | null;
  bottleneckRatio: number | null;
  skippedNodes: { uri: EntityURI; reason: "undefined_node" | "ghost_pending" | "maturity_gated" }[];
  stubStreams: { uri: EntityURI; from: EntityURI; to: EntityURI; reason: string }[];
  upstreamWaitingNodes: { uri: EntityURI; message: string }[];
  invariantErrors: string[];
}

export type FactorResolver = (ref: FactorRef | undefined, fallback?: number) => number;

/**
 * Evaluate a single `PhysicsModule` into a standardized `PhysicsOutput`.
 * Calls `src/flow/kernel/atoms.ts` pure calculation functions for all atom parameters.
 * Enforces Override 3: `credit_working_capital` never adds to `cycleTicks` or restricts `capacityPerTick`.
 */
export function evaluatePhysicsModule(
  mod: PhysicsModule,
  resolve: FactorResolver,
  stress: StressInput = {},
): PhysicsOutput {
  const p = mod.params;
  const vScale = 1 + (stress.volumeChange ?? 0);
  const pScale = 1 + (stress.priceChange ?? 0);
  const cScale = 1 + (stress.variableCostChange ?? 0);
  const fScale = 1 + (stress.fixedCostChange ?? 0);

  switch (mod.atom) {
    case "time_capacity": {
      if ("people" in p || "hoursPerWeek" in p || "hourlyRate" in p) {
        const atom: TimeCapacityAtom = {
          id: "mod",
          kind: "TIME_CAPACITY",
          label: "mod",
          enabled: true,
          people: resolve(p.people, 1),
          hoursPerWeek: resolve(p.hoursPerWeek, 37.5),
          utilization: resolve(p.utilization, 0.6),
          hourlyRate: resolve(p.hourlyRate, 0) * pScale,
          demandHoursPerMonth: resolve(p.demandHoursPerMonth, -1) < 0 ? null : resolve(p.demandHoursPerMonth, 0) * vScale,
          salaryPerPersonMonth: resolve(p.salaryPerPersonMonth, 0) * fScale,
          sideCostRate: resolve(p.sideCostRate, 0),
          variableCostPerHour: resolve(p.variableCostPerHour, 0) * cScale,
        };
        const capMonth = timeCapacityHours(atom);
        const payrollMonth = timePayrollPerMonth(atom);
        return {
          capacityPerTick: capMonth / DAYS_PER_MONTH,
          cycleTicks: resolve(p.cycleTicks, 1),
          firstPassYield: clamp01(resolve(p.firstPassYield, 1)),
          variableCost: nonNeg(atom.variableCostPerHour),
          fixedCostPerTick: payrollMonth / DAYS_PER_MONTH,
          queueDecayPerTick: clamp01(resolve(p.queueDecayPerTick, 0)),
        };
      }
      return {
        capacityPerTick: nonNeg(resolve(p.capacityPerTick, 100)),
        cycleTicks: nonNeg(resolve(p.cycleTicks, 1)),
        firstPassYield: clamp01(resolve(p.firstPassYield, 1)),
        variableCost: nonNeg(resolve(p.variableCost, 0) * cScale),
        fixedCostPerTick: nonNeg(resolve(p.fixedCostPerTick, 0) * fScale),
        queueDecayPerTick: clamp01(resolve(p.queueDecayPerTick, 0)),
      };
    }

    case "physical_matter": {
      if ("unitsPerMonth" in p || "unitCost" in p || "spoilageRate" in p) {
        const atom: PhysicalMatterAtom = {
          id: "mod",
          kind: "PHYSICAL_MATTER",
          label: "mod",
          enabled: true,
          unitsPerMonth: Math.max(0, resolve(p.unitsPerMonth, 0) * vScale),
          unitPrice: resolve(p.unitPrice, 0) * pScale,
          unitCost: resolve(p.unitCost, 0) * cScale,
          spoilageRate: clamp01(resolve(p.spoilageRate, 0)),
          stockCoverDays: nonNeg(resolve(p.stockCoverDays, 0)),
          capacityUnitsPerMonth:
            resolve(p.capacityUnitsPerMonth, -1) < 0 ? null : nonNeg(resolve(p.capacityUnitsPerMonth, 0)),
        };
        const effCost = physicalEffectiveUnitCost(atom);
        const capPerTick =
          atom.capacityUnitsPerMonth === null
            ? atom.unitsPerMonth / DAYS_PER_MONTH
            : atom.capacityUnitsPerMonth / DAYS_PER_MONTH;
        return {
          capacityPerTick: capPerTick,
          cycleTicks: nonNeg(resolve(p.cycleTicks, 1)),
          firstPassYield: clamp01(1 - Math.min(0.95, atom.spoilageRate)),
          variableCost: effCost,
          fixedCostPerTick: nonNeg(resolve(p.fixedCostPerTick, 0) * fScale),
          queueDecayPerTick: clamp01(resolve(p.queueDecayPerTick, 0)),
        };
      }
      return {
        capacityPerTick: nonNeg(resolve(p.capacityPerTick, 100)),
        cycleTicks: nonNeg(resolve(p.cycleTicks, 1)),
        firstPassYield: clamp01(resolve(p.firstPassYield, 1)),
        variableCost: nonNeg(resolve(p.variableCost, 0) * cScale),
        fixedCostPerTick: nonNeg(resolve(p.fixedCostPerTick, 0) * fScale),
        queueDecayPerTick: clamp01(resolve(p.queueDecayPerTick, 0)),
      };
    }

    case "recurring_subscription": {
      const price = nonNeg(resolve(p.pricePerMonth, 0) * pScale);
      const varCost = nonNeg(resolve(p.costPerSubscriberMonth, 0) * cScale);
      const cap = resolve(p.capacityPerTick, -1);
      return {
        capacityPerTick: cap < 0 ? Number.POSITIVE_INFINITY : nonNeg(cap),
        cycleTicks: nonNeg(resolve(p.cycleTicks, 1)),
        firstPassYield: clamp01(resolve(p.firstPassYield, 1)),
        variableCost: varCost,
        fixedCostPerTick: nonNeg(resolve(p.fixedCostPerTick, 0) * fScale),
        cash: [{ amount: price, delayTicks: 0 }],
      };
    }

    case "transactional_trade": {
      if ("visitorsPerDay" in p || "conversionRate" in p || "averageTicket" in p) {
        const atom: TransactionalTradeAtom = {
          id: "mod",
          kind: "TRANSACTIONAL_TRADE",
          label: "mod",
          enabled: true,
          visitorsPerDay: Math.max(0, resolve(p.visitorsPerDay, 0) * vScale),
          conversionRate: clamp01(resolve(p.conversionRate, 1)),
          averageTicket: resolve(p.averageTicket, 0) * pScale,
          costPerSale: resolve(p.costPerSale, 0) * cScale,
          openDaysPerMonth: nonNeg(resolve(p.openDaysPerMonth, DAYS_PER_MONTH)),
          capacityPerDay: resolve(p.capacityPerDay, -1) < 0 ? null : nonNeg(resolve(p.capacityPerDay, 0)),
        };
        const demandMonth = tradeDemandPerMonth(atom);
        const capMonth =
          atom.capacityPerDay === null ? demandMonth : nonNeg(atom.capacityPerDay) * nonNeg(atom.openDaysPerMonth);
        return {
          capacityPerTick: capMonth / DAYS_PER_MONTH,
          cycleTicks: nonNeg(resolve(p.cycleTicks, 1)),
          firstPassYield: clamp01(resolve(p.firstPassYield, 1)),
          variableCost: nonNeg(atom.costPerSale),
          fixedCostPerTick: nonNeg(resolve(p.fixedCostPerTick, 0) * fScale),
        };
      }
      return {
        capacityPerTick: nonNeg(resolve(p.capacityPerTick, 100)),
        cycleTicks: nonNeg(resolve(p.cycleTicks, 1)),
        firstPassYield: clamp01(resolve(p.firstPassYield, 1)),
        variableCost: nonNeg(resolve(p.variableCost, 0) * cScale),
        fixedCostPerTick: nonNeg(resolve(p.fixedCostPerTick, 0) * fScale),
      };
    }

    case "credit_working_capital": {
      // Override 3: Working capital payment delay affects ONLY cash[].delayTicks, never cycleTicks or capacityPerTick.
      const custDelay = Math.max(0, Math.round(resolve(p.customerTermsDays, 0)));
      const fixedMonth = nonNeg(resolve(p.fixedCostPerMonth, 0) * fScale);
      const fixedTick = nonNeg(resolve(p.fixedCostPerTick, 0) * fScale) + fixedMonth / DAYS_PER_MONTH;
      return {
        capacityPerTick: Number.POSITIVE_INFINITY,
        cycleTicks: 0,
        firstPassYield: 1,
        variableCost: 0,
        fixedCostPerTick: fixedTick,
        cash: [{ amount: 0, delayTicks: custDelay }],
      };
    }
  }
}

/**
 * Combine multiple `PhysicsOutput` results on a leaf node according to TSD 6.3 & Execution Guide 4.2.2:
 * - capacityPerTick = min_m(module_m.capacityPerTick)
 * - cycleTicks = sum_m(module_m.cycleTicks)
 * - firstPassYield = prod_m(module_m.firstPassYield)
 * - variableCost = sum_m(module_m.variableCost)
 * - fixedCostPerTick = sum_m(module_m.fixedCostPerTick)
 * - cash = concatenated cash entries
 */
export function combinePhysicsOutputs(outputs: PhysicsOutput[]): PhysicsOutput {
  if (outputs.length === 0) {
    return {
      capacityPerTick: 0,
      cycleTicks: 0,
      firstPassYield: 1,
      variableCost: 0,
      fixedCostPerTick: 0,
      queueDecayPerTick: 0,
      cash: [],
    };
  }
  let capacityPerTick = Number.POSITIVE_INFINITY;
  let cycleTicks = 0;
  let firstPassYield = 1;
  let variableCost = 0;
  let fixedCostPerTick = 0;
  let queueDecayPerTick = 0;
  const cash: { amount: number; delayTicks: number }[] = [];

  for (const o of outputs) {
    if (o.capacityPerTick < capacityPerTick) capacityPerTick = o.capacityPerTick;
    cycleTicks += o.cycleTicks;
    firstPassYield *= o.firstPassYield;
    variableCost += o.variableCost;
    fixedCostPerTick += o.fixedCostPerTick;
    if ((o.queueDecayPerTick ?? 0) > queueDecayPerTick) {
      queueDecayPerTick = o.queueDecayPerTick!;
    }
    if (o.cash) {
      for (const c of o.cash) cash.push(c);
    }
  }

  return {
    capacityPerTick: capacityPerTick === Number.POSITIVE_INFINITY ? 0 : capacityPerTick,
    cycleTicks,
    firstPassYield: clamp01(firstPassYield),
    variableCost,
    fixedCostPerTick,
    queueDecayPerTick,
    cash,
  };
}

interface MechanismEvaluation {
  roleCapLimit: number;
  assetCapLimit: number;
  throughputMultiplier: number;
  cycleTimeMultiplier: number;
  yieldMultiplier: number;
  variableCostMultiplier: number;
  rolloutFactor: number;
  availabilityFactor: number;
}

const IDENTITY_MECH: MechanismEvaluation = {
  roleCapLimit: Number.POSITIVE_INFINITY,
  assetCapLimit: Number.POSITIVE_INFINITY,
  throughputMultiplier: 1,
  cycleTimeMultiplier: 1,
  yieldMultiplier: 1,
  variableCostMultiplier: 1,
  rolloutFactor: 1,
  availabilityFactor: 1,
};

function evaluateNodeMechanisms(
  node: UniversalEnterpriseNode,
  graph: EnterpriseGraph,
  tick: number,
  resolve: FactorResolver,
  availabilityOverrides: Map<EntityURI, number>,
): MechanismEvaluation {
  if (node.mechanisms.length === 0) return IDENTITY_MECH;
  let roleCapLimit = Number.POSITIVE_INFINITY;
  let assetCapLimit = Number.POSITIVE_INFINITY;
  let throughputMultiplier = 1;
  let cycleTimeMultiplier = 1;
  let yieldMultiplier = 1;
  let variableCostMultiplier = 1;
  let rolloutFactor = 1;
  let availabilityFactor = 1;

  for (const mb of node.mechanisms) {
    const cap = graph.capabilities[mb.capability];
    let avail = 1;
    if (cap && cap.kind === "system") {
      avail = clamp01(resolve(cap.availability, 1));
    }
    if (availabilityOverrides.has(mb.capability)) {
      avail = clamp01(availabilityOverrides.get(mb.capability)!);
    }

    if (avail <= 0) {
      if (mb.critical) {
        const fallback = clamp01(resolve(mb.fallbackMultiplier, 0));
        availabilityFactor = Math.min(availabilityFactor, fallback);
      }
      continue;
    }

    let isLive = true;
    if (mb.rollout) {
      const leadEnd = mb.rollout.startTick + mb.rollout.leadTicks;
      const dipEnd = leadEnd + mb.rollout.dipTicks;
      if (tick < leadEnd) {
        isLive = false;
      } else if (tick < dipEnd) {
        const dip = clamp01(resolve(mb.rollout.dipDepth, 0));
        rolloutFactor *= 1 - dip;
      }
    }

    if (cap?.kind === "role") {
      const contrib = mb.capacityContribution
        ? nonNeg(resolve(mb.capacityContribution, 0))
        : nonNeg(resolve(cap.fte, 1)) *
          nonNeg(resolve(cap.hoursPerFtePerTick, 8)) *
          clamp01(resolve(cap.proficiency, 1));
      roleCapLimit = Math.min(roleCapLimit, contrib);
    } else if (cap?.kind === "asset") {
      const contrib = mb.capacityContribution
        ? nonNeg(resolve(mb.capacityContribution, 0))
        : nonNeg(resolve(cap.capacityPerTick, Number.POSITIVE_INFINITY));
      assetCapLimit = Math.min(assetCapLimit, contrib);
    }

    if (isLive && mb.modifiers) {
      if (mb.modifiers.throughput) throughputMultiplier *= nonNeg(resolve(mb.modifiers.throughput, 1));
      if (mb.modifiers.cycleTime) cycleTimeMultiplier *= nonNeg(resolve(mb.modifiers.cycleTime, 1));
      if (mb.modifiers.yield) yieldMultiplier *= nonNeg(resolve(mb.modifiers.yield, 1));
      if (mb.modifiers.variableCost) variableCostMultiplier *= nonNeg(resolve(mb.modifiers.variableCost, 1));
    }
  }

  return {
    roleCapLimit,
    assetCapLimit,
    throughputMultiplier,
    cycleTimeMultiplier,
    yieldMultiplier,
    variableCostMultiplier,
    rolloutFactor,
    availabilityFactor,
  };
}

function isNodeExecutable(node: UniversalEnterpriseNode): {
  ok: boolean;
  reason?: "undefined_node" | "ghost_pending";
} {
  if (node.ghost?.status === "pending") {
    return { ok: false, reason: "ghost_pending" };
  }
  const def = node.definition ?? "defined";
  if (def !== "defined") {
    return { ok: false, reason: "undefined_node" };
  }
  return { ok: true };
}

function extractAtomId(node: UniversalEnterpriseNode): string {
  for (const tag of node.tags) {
    if (tag.startsWith("atomId:")) return tag.slice("atomId:".length);
  }
  const idx = node.uri.lastIndexOf("/");
  return idx >= 0 ? node.uri.slice(idx + 1) : node.uri;
}

/** Run the deterministic discrete-tick simulation on an `EnterpriseGraph`. */
export function simulateGraph(
  graph: EnterpriseGraph,
  options: GraphSimulateOptions = {},
): SimulationRun {
  const registry = options.registry ?? buildRegistry(graph);
  const maturity = graph.maturity ?? 3;
  const openingCash = Number.isFinite(graph.opening.cash) ? graph.opening.cash : 0;
  const ledger = createEmptyLedger(graph.accounts, openingCash, graph.opening.balances);

  // Override 4 & P9: Maturity 0 and 1 are capability-design stages without operational simulation.
  if (maturity === 0 || maturity === 1) {
    const skippedNodes = Object.values(graph.nodes).map((n) => ({
      uri: n.uri,
      reason: "maturity_gated" as const,
    }));
    const nodeStates: Record<string, NodeTickState> = {};
    for (const n of Object.values(graph.nodes)) {
      nodeStates[n.uri] = {
        uri: n.uri,
        tick: 0,
        computed: false,
        skipReason: "maturity_gated",
        demand: 0,
        capacity: 0,
        throughput: 0,
        utilization: 0,
        cycleTime: 0,
        firstPassYield: 1,
        primaryOutput: 0,
        rejectOutput: 0,
        wip: 0,
        queueDecay: 0,
        holdingCost: 0,
        revenue: 0,
        variableCost: 0,
        fixedCost: 0,
      };
    }
    const statements = buildFinancialStatements(ledger, graph.accounts);
    return {
      maturityGated: true,
      horizonDays: 0,
      days: [],
      months: [],
      openingCash,
      endCash: openingCash,
      minCash: openingCash,
      minCashDay: 0,
      cashOutDay: openingCash < 0 ? 0 : null,
      totals: { revenue: 0, variableCosts: 0, fixedCosts: 0, operatingProfit: 0 },
      reconciliationError: 0,
      ledger,
      statements,
      monthlyStatements: [],
      nodeStates,
      streamStates: {},
      unitMassBalances: {},
      bottleneckNodeUri: null,
      bottleneckRatio: null,
      skippedNodes,
      stubStreams: [],
      upstreamWaitingNodes: [],
      invariantErrors: [],
    };
  }

  const horizonTicks =
    options.horizonTicks ??
    (options.horizonMonths ? Math.max(1, Math.round(options.horizonMonths)) * DAYS_PER_MONTH : Math.max(1, Math.round(graph.tick.horizon || 360)));
  const startCalendarMonth = Math.round(graph.tick.startCalendarMonth ?? 0);
  const payrollDay = clampDay(graph.tick.payrollDayOfMonth ?? 15);

  // Pre-parse factor formulas once before the tick loop.
  const parsedFormulas = new Map<EntityURI, FormulaAst>();
  let hasTemporalFactors = false;
  for (const f of Object.values(graph.factors)) {
    if (f.formula) {
      try {
        parsedFormulas.set(f.uri, parseFormula(f.formula));
      } catch {
        // Invalid formulas fall back to f.value and are caught by validateGraph.
      }
    }
    if ((f.temporal && f.temporal.length > 0) || (f.monthlyMultipliers && f.monthlyMultipliers.length === 12)) {
      hasTemporalFactors = true;
    }
  }

  const factorValues = new Map<EntityURI, number>();
  const formulaScope: Record<string, number> = {};

  const evaluateFactorsForTick = (tick: number, calendarMonth: number): void => {
    for (const uri of registry.factorOrder) {
      const f = graph.factors[uri];
      if (!f) continue;
      let val = Number.isFinite(f.value) ? f.value : 0;
      const ast = parsedFormulas.get(uri);
      if (ast) {
        try {
          const computed = evaluate(ast, formulaScope);
          if (Number.isFinite(computed)) val = computed;
        } catch {
          // Keep fallback value.
        }
      }
      if (f.temporal && f.temporal.length > 0) {
        let waveSum = 0;
        for (const w of f.temporal) {
          if (w.periodTicks > 0) {
            waveSum += w.amplitude * Math.sin((2 * Math.PI * (tick - w.phaseTicks)) / w.periodTicks);
          }
        }
        val *= Math.max(0, 1 + waveSum);
      }
      if (f.monthlyMultipliers && f.monthlyMultipliers.length === 12) {
        const mMult = f.monthlyMultipliers[calendarMonth];
        if (typeof mMult === "number" && Number.isFinite(mMult)) {
          val *= Math.max(0, mMult);
        }
      }
      factorValues.set(uri, val);
      formulaScope[uri] = val;
    }
    for (const [alias, targetUri] of registry.factorAliases.entries()) {
      const v = factorValues.get(targetUri);
      if (v !== undefined) formulaScope[alias] = v;
    }
  };

  evaluateFactorsForTick(0, ((startCalendarMonth % 12) + 12) % 12);

  const resolveFactor: FactorResolver = (ref, fallback = 0) => {
    if (!ref) return fallback;
    if ("const" in ref) return Number.isFinite(ref.const) ? ref.const : fallback;
    const v = factorValues.get(ref.factor);
    if (v !== undefined) return v;
    const f = graph.factors[ref.factor];
    return f && Number.isFinite(f.value) ? f.value : fallback;
  };

  // Identify skipped nodes & stub streams (Override 4).
  const skippedNodes: { uri: EntityURI; reason: "undefined_node" | "ghost_pending" | "maturity_gated" }[] = [];
  const executableNodeSet = new Set<EntityURI>();
  for (const n of Object.values(graph.nodes)) {
    const check = isNodeExecutable(n);
    if (check.ok) {
      executableNodeSet.add(n.uri);
    } else {
      skippedNodes.push({ uri: n.uri, reason: check.reason! });
    }
  }

  const stubStreams: { uri: EntityURI; from: EntityURI; to: EntityURI; reason: string }[] = [];
  const stubStreamSet = new Set<EntityURI>();
  const upstreamWaitingMap = new Map<EntityURI, string>();
  const leafStreams = Object.values(graph.streams).filter((s) => s.children.length === 0);

  for (const s of leafStreams) {
    const fromExec = executableNodeSet.has(s.from.node);
    const toExec = executableNodeSet.has(s.to.node);
    if (!fromExec && toExec) {
      stubStreamSet.add(s.uri);
      const reason = "not_computed_upstream_undefined";
      stubStreams.push({ uri: s.uri, from: s.from.node, to: s.to.node, reason });
      upstreamWaitingMap.set(s.to.node, "Not computed: waiting for upstream node definition");
    }
  }

  // Classify leaf nodes and build fast lookup structures.
  const leafIncomingStreams = new Map<EntityURI, EntityURI[]>();
  const leafOutgoingStreams = new Map<EntityURI, EntityURI[]>();
  for (const u of registry.leafNodeOrder) {
    leafIncomingStreams.set(u, []);
    leafOutgoingStreams.set(u, []);
  }
  for (const s of leafStreams) {
    if (leafIncomingStreams.has(s.to.node)) leafIncomingStreams.get(s.to.node)!.push(s.uri);
    if (leafOutgoingStreams.has(s.from.node)) leafOutgoingStreams.get(s.from.node)!.push(s.uri);
  }

  // Buffer & stream transit state
  const portBuffers = new Map<string, number>(); // key: `${nodeUri}:${portId}`
  const nodeBuffers = new Map<EntityURI, number>();
  const streamQueues = new Map<EntityURI, { releaseTick: number; amount: number }[]>();
  for (const s of leafStreams) streamQueues.set(s.uri, []);

  // Initialize node buffers if `initialUnits` is set
  for (const u of registry.leafNodeOrder) {
    const n = graph.nodes[u];
    if (n?.buffer?.initialUnits) {
      const init = nonNeg(resolveFactor(n.buffer.initialUnits, 0));
      nodeBuffers.set(u, init);
      const firstIn = n.ports.find((p) => p.side === "I");
      if (firstIn) portBuffers.set(`${u}:${firstIn.id}`, init);
    } else {
      nodeBuffers.set(u, 0);
    }
  }

  // Mass balance tracking per FlowUnit
  const unitBalances = new Map<
    EntityURI,
    { inflow: number; outflow: number; stockStart: number; stockEnd: number; loss: number; decay: number }
  >();
  for (const u of Object.values(graph.units)) {
    unitBalances.set(u.uri, {
      inflow: 0,
      outflow: 0,
      stockStart: 0,
      stockEnd: 0,
      loss: 0,
      decay: 0,
    });
  }

  // Financial & cash schedules
  const receipts = new CashSchedule();
  const payments = new CashSchedule();
  let cash = openingCash;
  let receivables = 0;
  let payables = 0;
  let inventory = 0;

  const days: DayPoint[] = [];
  const monthResults: MonthResult[] = [];
  const monthlyStatements: FinancialStatements[] = [];

  let mRevenue = 0;
  let mVariable = 0;
  let mFixed = 0;
  let mByAtom: Record<string, AtomMonthStats> = {};
  const totals = { revenue: 0, variableCosts: 0, fixedCosts: 0, operatingProfit: 0 };

  const subscribers = new Map<EntityURI, number>();

  // Tick-level consolidated ledger accumulators (flushed once per tick to guarantee <16ms on 300+ nodes and zero IEEE-754 drift)
  let tickRevProduct = 0;
  let tickRevService = 0;
  let tickRevSub = 0;
  let tickCogsProductAp = 0;
  let tickCogsLaborAp = 0;
  let tickCogsProductCash = 0;
  let tickCogsFreightCash = 0;
  let tickOpexOtherCash = 0;
  let tickOpexPayrollCash = 0;
  let tickOpexWarehousingCash = 0;

  const flushTickJournal = (day: number): void => {
    const arTotal = tickRevProduct + tickRevService + tickRevSub;
    if (arTotal > 0) {
      receivables += arTotal;
      const lines: { account: string; amount: number }[] = [
        { account: "accounts_receivable", amount: arTotal },
      ];
      if (tickRevProduct > 0) lines.push({ account: "revenue_product", amount: -tickRevProduct });
      if (tickRevService > 0) lines.push({ account: "revenue_service", amount: -tickRevService });
      if (tickRevSub > 0) lines.push({ account: "revenue_subscription", amount: -tickRevSub });
      postJournal(
        ledger,
        {
          tick: day,
          memo: `Tick ${day} revenue recognition`,
          source: "tick:revenue",
          lines,
        },
        graph.accounts,
      );
      tickRevProduct = 0;
      tickRevService = 0;
      tickRevSub = 0;
    }

    const apTotal = tickCogsProductAp + tickCogsLaborAp;
    if (apTotal > 0) {
      payables += apTotal;
      const lines: { account: string; amount: number }[] = [];
      if (tickCogsProductAp > 0) lines.push({ account: "cogs_product", amount: tickCogsProductAp });
      if (tickCogsLaborAp > 0) lines.push({ account: "cogs_direct_labor", amount: tickCogsLaborAp });
      lines.push({ account: "accounts_payable", amount: -apTotal });
      postJournal(
        ledger,
        {
          tick: day,
          memo: `Tick ${day} credit purchases`,
          source: "tick:ap",
          lines,
        },
        graph.accounts,
      );
      tickCogsProductAp = 0;
      tickCogsLaborAp = 0;
    }

    const cashExpenseTotal =
      tickCogsProductCash +
      tickCogsFreightCash +
      tickOpexOtherCash +
      tickOpexPayrollCash +
      tickOpexWarehousingCash;
    if (cashExpenseTotal > 0) {
      cash -= cashExpenseTotal;
      const lines: { account: string; amount: number }[] = [];
      if (tickCogsProductCash > 0) lines.push({ account: "cogs_product", amount: tickCogsProductCash });
      if (tickCogsFreightCash > 0) lines.push({ account: "cogs_freight_out", amount: tickCogsFreightCash });
      if (tickOpexOtherCash > 0) lines.push({ account: "opex_other", amount: tickOpexOtherCash });
      if (tickOpexPayrollCash > 0) lines.push({ account: "opex_payroll", amount: tickOpexPayrollCash });
      if (tickOpexWarehousingCash > 0) lines.push({ account: "opex_warehousing", amount: tickOpexWarehousingCash });
      lines.push({ account: "cash", amount: -cashExpenseTotal });
      postJournal(
        ledger,
        {
          tick: day,
          memo: `Tick ${day} operating cash expenses`,
          source: "tick:opex_cash",
          cashFlow: "operating",
          lines,
        },
        graph.accounts,
      );
      tickCogsProductCash = 0;
      tickCogsFreightCash = 0;
      tickOpexOtherCash = 0;
      tickOpexPayrollCash = 0;
      tickOpexWarehousingCash = 0;
    }
  };

  // Helper functions that simultaneously update scalar state and accumulate balanced double-entry journals.
  const bookSaleOnCredit = (
    _nodeUri: EntityURI,
    atomKey: string,
    day: number,
    amount: number,
    customerTerms: number,
    revenueAccount: string,
  ): void => {
    if (amount <= 0) return;
    receipts.add(day + customerTerms, amount);
    mRevenue += amount;
    if (mByAtom[atomKey]) mByAtom[atomKey].revenue += amount;
    if (revenueAccount === "revenue_service") tickRevService += amount;
    else if (revenueAccount === "revenue_subscription") tickRevSub += amount;
    else tickRevProduct += amount;
  };

  const bookPurchaseOnCredit = (
    sourceUri: string,
    day: number,
    amount: number,
    supplierTerms: number,
    debitAccount: string,
  ): void => {
    if (amount <= 0) return;
    payments.add(day + supplierTerms, amount);
    if (debitAccount === "cogs_product") {
      tickCogsProductAp += amount;
    } else if (debitAccount === "cogs_direct_labor") {
      tickCogsLaborAp += amount;
    } else {
      payables += amount;
      postJournal(
        ledger,
        {
          tick: day,
          memo: `Credit purchase ${sourceUri}`,
          source: sourceUri,
          lines: [
            { account: debitAccount, amount },
            { account: "accounts_payable", amount: -amount },
          ],
        },
        graph.accounts,
      );
    }
  };

  const bookVariableCostOnCredit = (
    nodeUri: EntityURI,
    atomKey: string,
    day: number,
    amount: number,
    supplierTerms: number,
    cogsAccount = "cogs_product",
  ): void => {
    if (amount <= 0) return;
    bookPurchaseOnCredit(nodeUri, day, amount, supplierTerms, cogsAccount);
    mVariable += amount;
    if (mByAtom[atomKey]) mByAtom[atomKey].variableCosts += amount;
  };

  const bookVariableCostImmediate = (
    _nodeUri: EntityURI,
    atomKey: string,
    _day: number,
    amount: number,
    cogsAccount = "cogs_product",
  ): void => {
    if (amount <= 0) return;
    mVariable += amount;
    if (mByAtom[atomKey]) mByAtom[atomKey].variableCosts += amount;
    if (cogsAccount === "cogs_freight_out") tickCogsFreightCash += amount;
    else tickCogsProductCash += amount;
  };

  const bookFixedCostImmediate = (
    _sourceUri: string,
    _day: number,
    amount: number,
    opexAccount = "opex_other",
  ): void => {
    if (amount <= 0) return;
    mFixed += amount;
    if (opexAccount === "opex_payroll") tickOpexPayrollCash += amount;
    else if (opexAccount === "opex_warehousing") tickOpexWarehousingCash += amount;
    else tickOpexOtherCash += amount;
  };

  // Helper to resolve customer & supplier payment terms for a leaf node
  const resolveNodeTerms = (node: UniversalEnterpriseNode): { custTerms: number; suppTerms: number } => {
    let custTerms = 0;
    let suppTerms = Math.max(0, Math.round(resolveFactor(
      graph.factors["apex://factor/credit_supplierTermsDays"]
        ? { factor: "apex://factor/credit_supplierTermsDays" }
        : undefined,
      0,
    )));
    for (const m of node.physics ?? []) {
      if (m.atom === "credit_working_capital") {
        if (m.params.customerTermsDays) {
          custTerms = Math.max(0, Math.round(resolveFactor(m.params.customerTermsDays, custTerms)));
        }
        if (m.params.supplierTermsDays) {
          suppTerms = Math.max(0, Math.round(resolveFactor(m.params.supplierTermsDays, suppTerms)));
        }
      }
    }
    return { custTerms, suppTerms };
  };

  // Day 0: Physical opening inventory for any defined leaf node with a `physical_matter` module and `stockCoverDays > 0`
  for (const u of registry.leafNodeOrder) {
    if (!executableNodeSet.has(u)) continue;
    const node = graph.nodes[u]!;
    const { suppTerms } = resolveNodeTerms(node);
    for (const m of node.physics ?? []) {
      if (m.atom === "physical_matter" && "stockCoverDays" in m.params) {
        const atom: PhysicalMatterAtom = {
          id: u,
          kind: "PHYSICAL_MATTER",
          label: node.name,
          enabled: true,
          unitsPerMonth: nonNeg(resolveFactor(m.params.unitsPerMonth, 0)),
          unitPrice: nonNeg(resolveFactor(m.params.unitPrice, 0)),
          unitCost: nonNeg(resolveFactor(m.params.unitCost, 0)),
          spoilageRate: clamp01(resolveFactor(m.params.spoilageRate, 0)),
          stockCoverDays: nonNeg(resolveFactor(m.params.stockCoverDays, 0)),
          capacityUnitsPerMonth:
            resolveFactor(m.params.capacityUnitsPerMonth, -1) < 0
              ? null
              : nonNeg(resolveFactor(m.params.capacityUnitsPerMonth, 0)),
        };
        const stock = physicalOpeningInventory(atom);
        if (stock > 0) {
          inventory += stock;
          bookPurchaseOnCredit(u, 0, stock, suppTerms, "inventory_raw");
        }
      }
    }
  }

  // Record initial stockStart for each FlowUnit
  for (const u of registry.leafNodeOrder) {
    const n = graph.nodes[u]!;
    const inPort = n.ports.find((p) => p.side === "I");
    if (inPort && unitBalances.has(inPort.unit)) {
      unitBalances.get(inPort.unit)!.stockStart += nodeBuffers.get(u) ?? 0;
      unitBalances.get(inPort.unit)!.stockEnd += nodeBuffers.get(u) ?? 0;
    }
  }

  let minCash = cash;
  let minCashDay = 0;
  let cashOutDay: number | null = null;

  // Per-node and per-stream accumulators for the latest tick / rollup
  const nodeStates: Record<string, NodeTickState> = {};
  const streamStates: Record<string, StreamTickState> = {};
  for (const n of Object.values(graph.nodes)) {
    const exec = isNodeExecutable(n);
    nodeStates[n.uri] = {
      uri: n.uri,
      tick: 0,
      computed: exec.ok,
      skipReason: exec.reason,
      upstreamStub: upstreamWaitingMap.has(n.uri),
      demand: 0,
      capacity: 0,
      throughput: 0,
      utilization: 0,
      cycleTime: 0,
      firstPassYield: 1,
      primaryOutput: 0,
      rejectOutput: 0,
      wip: 0,
      queueDecay: 0,
      holdingCost: 0,
      revenue: 0,
      variableCost: 0,
      fixedCost: 0,
    };
  }
  for (const s of Object.values(graph.streams)) {
    const isStub = stubStreamSet.has(s.uri);
    streamStates[s.uri] = {
      uri: s.uri,
      tick: 0,
      status: isStub ? "stub" : "active",
      stubReason: isStub ? "not_computed_upstream_undefined" : undefined,
      sent: 0,
      delivered: 0,
      inTransit: 0,
      loss: 0,
      transferCost: 0,
    };
  }

  // Monthly cache of evaluated atom economics when a month starts
  interface UnitBalanceAcc {
    inflow: number;
    outflow: number;
    stockStart: number;
    stockEnd: number;
    loss: number;
    decay: number;
  }

  interface LeafMonthPlan {
    node: UniversalEnterpriseNode;
    st: NodeTickState;
    atomKey: string;
    atomStats: AtomMonthStats | undefined;
    ub: UnitBalanceAcc | undefined;
    custTerms: number;
    suppTerms: number;
    mode: "atom_time" | "atom_physical" | "atom_sub" | "atom_trade" | "fixed_only" | "process";
    monthlyDemand: number;
    monthlyCapacity: number | null;
    monthlyVolume: number;
    perDay: number;
    revPerDay: number;
    vcPerDay: number;
    spoilLossPerDay: number;
    inflowPerDay: number;
    unitPrice: number;
    unitVariableCost: number;
    monthlyPayroll: number;
    spoilageRate: number;
    fixedSchedules: { dayOfMonth: number; amount: number }[];
  }

  const atomKeyByUri = new Map<EntityURI, string>();
  for (const u of registry.leafNodeOrder) {
    const n = graph.nodes[u];
    if (n) atomKeyByUri.set(u, extractAtomId(n));
  }

  let monthPlans: LeafMonthPlan[] = [];
  let timePlans: LeafMonthPlan[] = [];
  let processPlans: LeafMonthPlan[] = [];
  let monthRevByTerms: { terms: number; amount: number }[] = [];
  let monthVcByTerms: { terms: number; amount: number }[] = [];
  let monthDailyProductRev = 0;
  let monthDailyProductVc = 0;
  const monthFixedByDom = new Float64Array(DAYS_PER_MONTH + 1);
  let monthTotalPayroll = 0;
  let monthMeta = { calendarMonth: 0, seasonFactor: 1, activeEvents: [] as string[] };
  let activeTickStress: StressInput = {};
  const availabilityOverrides = new Map<EntityURI, number>();

  const startMonth = (month: number, day: number): void => {
    const daysInThisMonth = Math.min(DAYS_PER_MONTH, horizonTicks - day);
    const lastTickOfMonth = day + daysInThisMonth - 1;
    mRevenue = 0;
    mVariable = 0;
    mFixed = 0;
    mByAtom = {};
    for (const u of registry.leafNodeOrder) {
      if (!executableNodeSet.has(u)) continue;
      const n = graph.nodes[u]!;
      if (n.band === "value_stream") {
        const ak = atomKeyByUri.get(u)!;
        mByAtom[ak] = { revenue: 0, variableCosts: 0, volume: 0 };
      }
    }

    const calendarMonth = (((startCalendarMonth + month) % 12) + 12) % 12;
    if (hasTemporalFactors || parsedFormulas.size > 0) {
      evaluateFactorsForTick(day, calendarMonth);
    }

    const seasFactorNode = graph.factors["apex://factor/global_seasonality"];
    const seasonFactor =
      seasFactorNode?.monthlyMultipliers && seasFactorNode.monthlyMultipliers.length === 12
        ? Math.max(0, seasFactorNode.monthlyMultipliers[calendarMonth] ?? 1)
        : 1;

    let stress: StressInput = { volumeChange: seasonFactor - 1 };
    const activeEventTitles: string[] = [];
    let oneOffCost = 0;
    availabilityOverrides.clear();

    for (const e of graph.events) {
      if (day >= e.startTick && day < e.startTick + e.durationTicks) {
        activeEventTitles.push(e.title);
        if (e.target && e.availabilityOverride !== undefined) {
          availabilityOverrides.set(e.target, e.availabilityOverride);
        }
        if (!e.target) {
          stress = combineStress(stress, {
            volumeChange: Math.max(-1, e.volumeChange ?? 0),
            priceChange: Math.max(-0.95, e.priceChange ?? 0),
            variableCostChange: Math.max(-0.95, e.variableCostChange ?? 0),
            fixedCostChange: Math.max(-0.95, e.fixedCostChange ?? 0),
          });
        }
        if (day === e.startTick && (e.oneOffCost ?? 0) > 0) {
          oneOffCost += Math.max(0, e.oneOffCost!);
        }
      }
    }

    activeTickStress = stress;
    monthMeta = { calendarMonth, seasonFactor, activeEvents: activeEventTitles };

    if (oneOffCost > 0) {
      bookFixedCostImmediate("event:one_off", day, oneOffCost, "opex_other");
    }

    // Build month plans for executable leaf nodes
    monthPlans = [];
    timePlans = [];
    processPlans = [];
    monthHasProcessNodes = false;
    monthDailyProductRev = 0;
    monthDailyProductVc = 0;
    monthFixedByDom.fill(0);
    monthTotalPayroll = 0;
    const revTermsMap = new Map<number, number>();
    const vcTermsMap = new Map<number, number>();

    const vScale = 1 + (stress.volumeChange ?? 0);
    const pScale = 1 + (stress.priceChange ?? 0);
    const cScale = 1 + (stress.variableCostChange ?? 0);
    const fScale = 1 + (stress.fixedCostChange ?? 0);

    for (const u of registry.leafNodeOrder) {
      if (!executableNodeSet.has(u)) continue;
      const node = graph.nodes[u]!;
      const st = nodeStates[u]!;
      st.tick = lastTickOfMonth;
      const atomKey = atomKeyByUri.get(u)!;
      const atomStats = mByAtom[atomKey];
      const { custTerms, suppTerms } = resolveNodeTerms(node);
      const hasIncoming = (leafIncomingStreams.get(u)?.length ?? 0) > 0;
      const mech = evaluateNodeMechanisms(node, graph, day, resolveFactor, availabilityOverrides);
      const capMultiplier = mech.throughputMultiplier * mech.rolloutFactor * mech.availabilityFactor;

      const fixedSchedules: { dayOfMonth: number; amount: number }[] = [];
      for (const m of node.physics ?? []) {
        if (m.atom === "credit_working_capital" && "fixedCostPerMonth" in m.params) {
          const amt = nonNeg(resolveFactor(m.params.fixedCostPerMonth, 0) * fScale);
          const dom = clampDay(resolveFactor(m.params.dayOfMonth, 1));
          if (amt > 0) {
            fixedSchedules.push({ dayOfMonth: dom, amount: amt });
            monthFixedByDom[dom] += amt;
            if (dom <= daysInThisMonth) st.fixedCost += amt;
          }
        }
      }

      const primaryMod = (node.physics ?? []).find((m) => m.atom !== "credit_working_capital");
      if (!primaryMod) {
        continue;
      }

      if (!hasIncoming && primaryMod.atom === "time_capacity" && ("people" in primaryMod.params || "hourlyRate" in primaryMod.params)) {
        const p = primaryMod.params;
        const baseAtom: TimeCapacityAtom = {
          id: atomKey,
          kind: "TIME_CAPACITY",
          label: node.name,
          enabled: true,
          people: resolveFactor(p.people, 1),
          hoursPerWeek: resolveFactor(p.hoursPerWeek, 37.5),
          utilization: resolveFactor(p.utilization, 0.6),
          hourlyRate: resolveFactor(p.hourlyRate, 0) * pScale,
          demandHoursPerMonth: resolveFactor(p.demandHoursPerMonth, -1) < 0 ? null : resolveFactor(p.demandHoursPerMonth, 0),
          salaryPerPersonMonth: resolveFactor(p.salaryPerPersonMonth, 0) * fScale,
          sideCostRate: resolveFactor(p.sideCostRate, 0),
          variableCostPerHour: resolveFactor(p.variableCostPerHour, 0) * cScale * mech.variableCostMultiplier,
        };
        const baseCap = timeCapacityHours(baseAtom);
        const cap = Math.min(baseCap, mech.roleCapLimit * DAYS_PER_MONTH, mech.assetCapLimit * DAYS_PER_MONTH) * capMultiplier;
        const demand =
          baseAtom.demandHoursPerMonth === null
            ? stress.volumeChange
              ? baseCap * vScale
              : cap
            : Math.max(0, baseAtom.demandHoursPerMonth * vScale);
        const volume = Math.min(cap, demand);
        const payroll = timePayrollPerMonth(baseAtom);
        if (payroll > 0) {
          monthTotalPayroll += payroll;
          if (payrollDay <= daysInThisMonth) st.fixedCost += payroll;
        }
        const uPrice = nonNeg(baseAtom.hourlyRate);
        const uVar = nonNeg(baseAtom.variableCostPerHour);
        const plan: LeafMonthPlan = {
          node,
          st,
          atomKey,
          atomStats,
          ub: unitBalances.get("apex://unit/hours"),
          custTerms,
          suppTerms,
          mode: "atom_time",
          monthlyDemand: demand,
          monthlyCapacity: cap,
          monthlyVolume: volume,
          perDay: volume / DAYS_PER_MONTH,
          revPerDay: 0,
          vcPerDay: 0,
          spoilLossPerDay: 0,
          inflowPerDay: 0,
          unitPrice: uPrice,
          unitVariableCost: uVar,
          monthlyPayroll: payroll,
          spoilageRate: 0,
          fixedSchedules,
        };
        timePlans.push(plan);
        continue;
      }

      if (!hasIncoming && primaryMod.atom === "physical_matter" && ("unitsPerMonth" in primaryMod.params || "unitPrice" in primaryMod.params)) {
        const p = primaryMod.params;
        const rawCap = resolveFactor(p.capacityUnitsPerMonth, -1);
        const atom: PhysicalMatterAtom = {
          id: atomKey,
          kind: "PHYSICAL_MATTER",
          label: node.name,
          enabled: true,
          unitsPerMonth: Math.max(0, resolveFactor(p.unitsPerMonth, 0) * vScale),
          unitPrice: resolveFactor(p.unitPrice, 0) * pScale,
          unitCost: resolveFactor(p.unitCost, 0) * cScale * mech.variableCostMultiplier,
          spoilageRate: clamp01(resolveFactor(p.spoilageRate, 0)),
          stockCoverDays: nonNeg(resolveFactor(p.stockCoverDays, 0)),
          capacityUnitsPerMonth: rawCap < 0 ? null : nonNeg(rawCap) * capMultiplier,
        };
        const demand = nonNeg(atom.unitsPerMonth);
        const cap = atom.capacityUnitsPerMonth;
        const volume = cap === null ? demand : Math.min(cap, demand);
        const effVar = physicalEffectiveUnitCost(atom);
        const uPrice = nonNeg(atom.unitPrice);
        const perDay = volume / DAYS_PER_MONTH;
        const revPerDay = perDay * uPrice;
        const vcPerDay = perDay * effVar;
        const spoilLossPerDay =
          atom.spoilageRate > 0 ? perDay * (1 / (1 - Math.min(0.95, atom.spoilageRate)) - 1) : 0;
        const capDay = cap === null ? perDay : cap / DAYS_PER_MONTH;
        const demDay = demand / DAYS_PER_MONTH;
        st.demand = demDay;
        st.capacity = capDay;
        st.throughput = perDay;
        st.utilization = capDay > 0 ? perDay / capDay : 0;
        st.cycleTime = 1;
        st.firstPassYield = 1 - atom.spoilageRate;

        const mVol = perDay * daysInThisMonth;
        const mRevNode = revPerDay * daysInThisMonth;
        const mVcNode = vcPerDay * daysInThisMonth;
        st.primaryOutput += mVol;
        st.revenue += mRevNode;
        st.variableCost += mVcNode;
        if (atomStats) {
          atomStats.volume += mVol;
          atomStats.revenue += mRevNode;
          atomStats.variableCosts += mVcNode;
        }
        const ub = unitBalances.get("apex://unit/items");
        if (ub) {
          const mLoss = spoilLossPerDay * daysInThisMonth;
          ub.inflow += mVol + mLoss;
          ub.outflow += mVol;
          ub.loss += mLoss;
        }
        if (revPerDay > 0) {
          monthDailyProductRev += revPerDay;
          revTermsMap.set(custTerms, (revTermsMap.get(custTerms) ?? 0) + revPerDay);
        }
        if (vcPerDay > 0) {
          monthDailyProductVc += vcPerDay;
          vcTermsMap.set(suppTerms, (vcTermsMap.get(suppTerms) ?? 0) + vcPerDay);
        }
        continue;
      }

      if (!hasIncoming && primaryMod.atom === "recurring_subscription") {
        const p = primaryMod.params;
        const baseStarting = nonNeg(resolveFactor(p.startingSubscribers, 0));
        const add = Math.max(0, nonNeg(resolveFactor(p.newPerMonth, 0)) * vScale);
        const churn = clamp01(resolveFactor(p.churnRateMonthly, 0));
        const prev = subscribers.get(u);
        const subs = prev === undefined ? baseStarting + add : prev * (1 - churn) + add;
        subscribers.set(u, subs);

        const price = nonNeg(resolveFactor(p.pricePerMonth, 0) * pScale);
        const costPerSub = nonNeg(resolveFactor(p.costPerSubscriberMonth, 0) * cScale * mech.variableCostMultiplier);
        const cacPerNew = nonNeg(resolveFactor(p.cacPerNew, 0));

        if (atomStats) atomStats.volume = subs;
        bookSaleOnCredit(u, atomKey, day, subs * price, custTerms, "revenue_subscription");
        bookVariableCostOnCredit(u, atomKey, day, subs * costPerSub, suppTerms, "cogs_product");
        const cac = add * cacPerNew;
        if (cac > 0) {
          bookVariableCostImmediate(u, atomKey, day, cac, "cogs_product");
        }

        const subUnitUri: EntityURI = "apex://unit/subscribers";
        if (unitBalances.has(subUnitUri)) {
          const ub = unitBalances.get(subUnitUri)!;
          const churned = prev === undefined ? 0 : prev * churn;
          if (prev === undefined) {
            ub.inflow += baseStarting + add;
          } else {
            ub.inflow += add;
            ub.decay += churned;
          }
          ub.stockEnd = subs;
        }

        st.tick = day;
        st.demand = subs;
        st.capacity = subs;
        st.throughput = subs;
        st.utilization = 1;
        st.cycleTime = 1;
        st.firstPassYield = 1;
        st.primaryOutput = subs;
        st.revenue += subs * price;
        st.variableCost += subs * costPerSub + cac;
        continue;
      }

      if (!hasIncoming && primaryMod.atom === "transactional_trade" && ("visitorsPerDay" in primaryMod.params || "averageTicket" in primaryMod.params)) {
        const p = primaryMod.params;
        const rawCap = resolveFactor(p.capacityPerDay, -1);
        const atom: TransactionalTradeAtom = {
          id: atomKey,
          kind: "TRANSACTIONAL_TRADE",
          label: node.name,
          enabled: true,
          visitorsPerDay: Math.max(0, resolveFactor(p.visitorsPerDay, 0) * vScale),
          conversionRate: clamp01(resolveFactor(p.conversionRate, 1)),
          averageTicket: resolveFactor(p.averageTicket, 0) * pScale,
          costPerSale: resolveFactor(p.costPerSale, 0) * cScale * mech.variableCostMultiplier,
          openDaysPerMonth: nonNeg(resolveFactor(p.openDaysPerMonth, DAYS_PER_MONTH)),
          capacityPerDay: rawCap < 0 ? null : nonNeg(rawCap) * capMultiplier,
        };
        const demand = tradeDemandPerMonth(atom);
        const cap = atom.capacityPerDay === null ? null : nonNeg(atom.capacityPerDay) * nonNeg(atom.openDaysPerMonth);
        const volume = cap === null ? demand : Math.min(cap, demand);
        const uPrice = nonNeg(atom.averageTicket);
        const uVar = nonNeg(atom.costPerSale);
        const perDay = volume / DAYS_PER_MONTH;
        const revPerDay = perDay * uPrice;
        const vcPerDay = perDay * uVar;
        const capDay = cap === null ? perDay : cap / DAYS_PER_MONTH;
        const demDay = demand / DAYS_PER_MONTH;
        st.demand = demDay;
        st.capacity = capDay;
        st.throughput = perDay;
        st.utilization = capDay > 0 ? perDay / capDay : 0;
        st.cycleTime = 1;
        st.firstPassYield = 1;

        const mVol = perDay * daysInThisMonth;
        const mRevNode = revPerDay * daysInThisMonth;
        const mVcNode = vcPerDay * daysInThisMonth;
        st.primaryOutput += mVol;
        st.revenue += mRevNode;
        st.variableCost += mVcNode;
        if (atomStats) {
          atomStats.volume += mVol;
          atomStats.revenue += mRevNode;
          atomStats.variableCosts += mVcNode;
        }
        const ub = unitBalances.get("apex://unit/transactions");
        if (ub) {
          ub.inflow += mVol;
          ub.outflow += mVol;
        }
        if (revPerDay > 0) {
          monthDailyProductRev += revPerDay;
          revTermsMap.set(custTerms, (revTermsMap.get(custTerms) ?? 0) + revPerDay);
        }
        if (vcPerDay > 0) {
          monthDailyProductVc += vcPerDay;
          vcTermsMap.set(suppTerms, (vcTermsMap.get(suppTerms) ?? 0) + vcPerDay);
        }
        continue;
      }

      monthHasProcessNodes = true;
      const procPlan: LeafMonthPlan = {
        node,
        st,
        atomKey,
        atomStats,
        ub: undefined,
        custTerms,
        suppTerms,
        mode: "process",
        monthlyDemand: 0,
        monthlyCapacity: null,
        monthlyVolume: 0,
        perDay: 0,
        revPerDay: 0,
        vcPerDay: 0,
        spoilLossPerDay: 0,
        inflowPerDay: 0,
        unitPrice: nonNeg(resolveFactor(primaryMod.params.unitPrice, 0) * pScale),
        unitVariableCost: 0,
        monthlyPayroll: 0,
        spoilageRate: 0,
        fixedSchedules,
      };
      monthPlans.push(procPlan);
      processPlans.push(procPlan);
    }

    monthRevByTerms = [];
    for (const [terms, amount] of revTermsMap.entries()) {
      monthRevByTerms.push({ terms, amount });
    }
    monthVcByTerms = [];
    for (const [terms, amount] of vcTermsMap.entries()) {
      monthVcByTerms.push({ terms, amount });
    }
  };

  let monthHasProcessNodes = false;
  const hasProcessNodesOrStreams = (): boolean =>
    leafStreams.length > 0 || monthHasProcessNodes;

  // Main discrete-tick simulation loop
  for (let d = 0; d < horizonTicks; d += 1) {
    const dom = (d % DAYS_PER_MONTH) + 1;
    const month = Math.floor(d / DAYS_PER_MONTH);

    if (dom === 1) {
      startMonth(month, d);
    } else if (hasTemporalFactors) {
      evaluateFactorsForTick(d, monthMeta.calendarMonth);
    }

    // Daily aggregated product/trade revenue and variable cost accruals
    if (monthDailyProductRev > 0) {
      mRevenue += monthDailyProductRev;
      tickRevProduct += monthDailyProductRev;
      for (let i = 0; i < monthRevByTerms.length; i += 1) {
        const entry = monthRevByTerms[i];
        receipts.add(d + entry.terms, entry.amount);
      }
    }
    if (monthDailyProductVc > 0) {
      mVariable += monthDailyProductVc;
      tickCogsProductAp += monthDailyProductVc;
      for (let i = 0; i < monthVcByTerms.length; i += 1) {
        const entry = monthVcByTerms[i];
        payments.add(d + entry.terms, entry.amount);
      }
    }

    // Scheduled fixed costs for this day of month
    const domFixed = monthFixedByDom[dom];
    if (domFixed > 0) {
      mFixed += domFixed;
      tickOpexOtherCash += domFixed;
    }

    // Time-capacity payroll on payrollDay
    if (dom === payrollDay && monthTotalPayroll > 0) {
      mFixed += monthTotalPayroll;
      tickOpexPayrollCash += monthTotalPayroll;
    }

    // Time-capacity billing at month end
    if (dom === DAYS_PER_MONTH && timePlans.length > 0) {
      for (let i = 0; i < timePlans.length; i += 1) {
        const plan = timePlans[i];
        const u = plan.node.uri;
        const st = plan.st;
        st.tick = d;
        if (plan.atomStats) plan.atomStats.volume = plan.monthlyVolume;
        const rev = plan.monthlyVolume * plan.unitPrice;
        const vc = plan.monthlyVolume * plan.unitVariableCost;
        bookSaleOnCredit(u, plan.atomKey, d, rev, plan.custTerms, "revenue_service");
        bookVariableCostOnCredit(u, plan.atomKey, d, vc, plan.suppTerms, "cogs_direct_labor");

        const capDay = (plan.monthlyCapacity ?? plan.monthlyVolume) / DAYS_PER_MONTH;
        const demDay = plan.monthlyDemand / DAYS_PER_MONTH;
        const volDay = plan.perDay;
        st.demand = demDay;
        st.capacity = capDay;
        st.throughput = volDay;
        st.utilization = capDay > 0 ? volDay / capDay : 0;
        st.cycleTime = 1;
        st.firstPassYield = 1;
        st.primaryOutput += plan.monthlyVolume;
        st.revenue += rev;
        st.variableCost += vc;

        if (plan.ub) {
          plan.ub.inflow += plan.monthlyVolume;
          plan.ub.outflow += plan.monthlyVolume;
        }
      }
    }

    // General process nodes & stream pipeline steps (Steps 2-5 of TSD 6.1) when graph has streams or general process nodes
    if (hasProcessNodesOrStreams()) {
      // Step 3: Release matured batches from stream delay queues (for streams with latencyTicks > 0 or feedbackStreams)
      for (const s of leafStreams) {
        if (stubStreamSet.has(s.uri)) continue;
        const queue = streamQueues.get(s.uri)!;
        if (queue.length === 0) continue;
        const lossRate = clamp01(resolveFactor(s.lossRate, 0));
        const transferCostRate = nonNeg(resolveFactor(s.transferCost, 0));
        let maturedTotal = 0;
        const remaining: { releaseTick: number; amount: number }[] = [];
        for (const item of queue) {
          if (item.releaseTick <= d) maturedTotal += item.amount;
          else remaining.push(item);
        }
        if (maturedTotal > 0) {
          streamQueues.set(s.uri, remaining);
          const loss = maturedTotal * lossRate;
          const delivered = maturedTotal - loss;
          const targetKey = `${s.to.node}:${s.to.port}`;
          portBuffers.set(targetKey, (portBuffers.get(targetKey) ?? 0) + delivered);
          nodeBuffers.set(s.to.node, (nodeBuffers.get(s.to.node) ?? 0) + delivered);

          const sst = streamStates[s.uri]!;
          sst.tick = d;
          sst.delivered += delivered;
          sst.loss += loss;

          const unitObj = graph.units[s.unit];
          if (unitObj && unitObj.nature !== "signal" && unitBalances.has(s.unit)) {
            unitBalances.get(s.unit)!.loss += loss;
          }

          if (transferCostRate > 0) {
            const tCost = maturedTotal * transferCostRate;
            sst.transferCost += tCost;
            bookVariableCostImmediate(s.from.node, extractAtomId(graph.nodes[s.from.node]!), d, tCost, "cogs_freight_out");
          }
        }
      }

      // Step 4: Execute general process leaf nodes in topological order
      for (let i = 0; i < monthPlans.length; i += 1) {
        const plan = monthPlans[i];
        if (plan.mode !== "process") continue;
        const node = plan.node;
        const u = node.uri;
        const st = nodeStates[u]!;
        st.tick = d;

        if (upstreamWaitingMap.has(u)) {
          st.upstreamStub = true;
          continue;
        }

        const modOutputs = (node.physics ?? []).map((m) =>
          evaluatePhysicsModule(m, resolveFactor, activeTickStress),
        );
        const combined = combinePhysicsOutputs(modOutputs);
        const mech = evaluateNodeMechanisms(node, graph, d, resolveFactor, availabilityOverrides);

        const effectiveCap =
          Math.min(combined.capacityPerTick, mech.roleCapLimit, mech.assetCapLimit) *
          mech.throughputMultiplier *
          mech.rolloutFactor *
          mech.availabilityFactor;
        const effectiveCycle = Math.max(0, combined.cycleTicks * mech.cycleTimeMultiplier);
        const effectiveYield = clamp01(combined.firstPassYield * mech.yieldMultiplier);
        const effectiveVarCost = Math.max(0, combined.variableCost * mech.variableCostMultiplier);
        const effectiveFixCost = Math.max(0, combined.fixedCostPerTick);

        const incomingUris = (leafIncomingStreams.get(u) ?? []).filter((su) => !stubStreamSet.has(su));
        const inPorts = node.ports.filter((p) => p.side === "I");
        const outPorts = node.ports.filter((p) => p.side === "O");

        let demand = effectiveCap;
        const primaryMod = (node.physics ?? []).find((m) => m.atom !== "credit_working_capital");
        if (primaryMod && "demandPerTick" in primaryMod.params) {
          demand = nonNeg(resolveFactor(primaryMod.params.demandPerTick, effectiveCap)) * (1 + (activeTickStress.volumeChange ?? 0));
        }

        let maxExec = effectiveCap;
        if (incomingUris.length > 0 && inPorts.length > 0) {
          let inputLimit = Number.POSITIVE_INFINITY;
          for (const p of inPorts) {
            const hasStreamOnPort = incomingUris.some((su) => graph.streams[su]?.to.port === p.id);
            if (!hasStreamOnPort) continue;
            const avail = portBuffers.get(`${u}:${p.id}`) ?? 0;
            const ratio = Math.max(1e-9, nonNeg(resolveFactor(p.ratio, 1)));
            inputLimit = Math.min(inputLimit, avail / ratio);
          }
          if (inputLimit !== Number.POSITIVE_INFINITY) {
            demand = inputLimit;
            maxExec = Math.min(maxExec, inputLimit);
          }
        } else {
          maxExec = Math.min(effectiveCap, demand);
        }

        // Check downstream buffer capacity limits
        const outgoingUris = leafOutgoingStreams.get(u) ?? [];
        for (const su of outgoingUris) {
          const s = graph.streams[su]!;
          const targetNode = graph.nodes[s.to.node];
          if (targetNode?.buffer?.maxUnits) {
            const maxBuf = nonNeg(resolveFactor(targetNode.buffer.maxUnits, Number.POSITIVE_INFINITY));
            const curBuf = nodeBuffers.get(targetNode.uri) ?? 0;
            const freeSpace = Math.max(0, maxBuf - curBuf);
            const fromPort = node.ports.find((p) => p.id === s.from.port);
            const outRatio = Math.max(1e-9, nonNeg(resolveFactor(fromPort?.ratio, 1)));
            maxExec = Math.min(maxExec, freeSpace / outRatio);
          }
        }

        const executions = Math.max(0, maxExec);

        // Consume inputs
        const primaryOutPort = outPorts.find((p) => (p.role ?? "primary") === "primary") ?? outPorts[0];
        const primaryUnitUri = primaryOutPort?.unit ?? inPorts[0]?.unit ?? ("apex://unit/items" as EntityURI);

        if (incomingUris.length > 0 && inPorts.length > 0) {
          for (const p of inPorts) {
            const hasStreamOnPort = incomingUris.some((su) => graph.streams[su]?.to.port === p.id);
            if (!hasStreamOnPort) continue;
            const ratio = Math.max(1e-9, nonNeg(resolveFactor(p.ratio, 1)));
            const consumed = executions * ratio;
            const key = `${u}:${p.id}`;
            portBuffers.set(key, Math.max(0, (portBuffers.get(key) ?? 0) - consumed));
            nodeBuffers.set(u, Math.max(0, (nodeBuffers.get(u) ?? 0) - consumed));
            // If input port unit differs from primary output unit (recipe transformation), close input unit mass balance
            if (p.unit !== primaryUnitUri && unitBalances.has(p.unit)) {
              const uObj = graph.units[p.unit];
              if (uObj && uObj.nature !== "signal") {
                unitBalances.get(p.unit)!.outflow += consumed;
              }
            }
          }
        } else {
          // Entry/standalone process node: external units enter
          const outRatio = Math.max(1e-9, nonNeg(resolveFactor(primaryOutPort?.ratio, 1)));
          const entered = executions * outRatio;
          const uObj = graph.units[primaryUnitUri];
          if (uObj && uObj.nature !== "signal" && unitBalances.has(primaryUnitUri)) {
            unitBalances.get(primaryUnitUri)!.inflow += entered;
          }
        }

        // If recipe transformed from a different input unit, record created primary units as inflow of primaryUnitUri
        if (
          incomingUris.length > 0 &&
          inPorts.length > 0 &&
          inPorts.every((p) => p.unit !== primaryUnitUri) &&
          unitBalances.has(primaryUnitUri)
        ) {
          const outRatio = Math.max(1e-9, nonNeg(resolveFactor(primaryOutPort?.ratio, 1)));
          const uObj = graph.units[primaryUnitUri];
          if (uObj && uObj.nature !== "signal") {
            unitBalances.get(primaryUnitUri)!.inflow += executions * outRatio;
          }
        }

        // Produce outputs & route to outgoing streams
        const outRatio = Math.max(1e-9, nonNeg(resolveFactor(primaryOutPort?.ratio, 1)));
        const totalOut = executions * outRatio;
        const primaryOut = totalOut * effectiveYield;
        const rejectOut = totalOut * (1 - effectiveYield);

        const sendAlongStream = (sUri: EntityURI, amount: number): void => {
          if (amount <= 0 || stubStreamSet.has(sUri)) return;
          const s = graph.streams[sUri]!;
          const sst = streamStates[sUri]!;
          sst.tick = d;
          sst.sent += amount;

          const rawLat = Math.max(0, Math.round(resolveFactor(s.latencyTicks, 0)));
          const isFeedback = registry.feedbackStreams.has(sUri);
          const lat = isFeedback ? Math.max(1, rawLat) : rawLat;

          if (lat === 0) {
            const lossRate = clamp01(resolveFactor(s.lossRate, 0));
            const transferCostRate = nonNeg(resolveFactor(s.transferCost, 0));
            const loss = amount * lossRate;
            const delivered = amount - loss;
            const targetKey = `${s.to.node}:${s.to.port}`;
            portBuffers.set(targetKey, (portBuffers.get(targetKey) ?? 0) + delivered);
            nodeBuffers.set(s.to.node, (nodeBuffers.get(s.to.node) ?? 0) + delivered);
            sst.delivered += delivered;
            sst.loss += loss;

            const uObj = graph.units[s.unit];
            if (uObj && uObj.nature !== "signal" && unitBalances.has(s.unit)) {
              unitBalances.get(s.unit)!.loss += loss;
            }
            if (transferCostRate > 0) {
              const tCost = amount * transferCostRate;
              sst.transferCost += tCost;
              bookVariableCostImmediate(u, plan.atomKey, d, tCost, "cogs_freight_out");
            }
          } else {
            streamQueues.get(sUri)!.push({ releaseTick: d + lat, amount });
          }
        };

        const primaryStreams = outgoingUris.filter((su) => {
          const s = graph.streams[su]!;
          const p = node.ports.find((pt) => pt.id === s.from.port);
          return (p?.role ?? "primary") === "primary";
        });
        const rejectStreams = outgoingUris.filter((su) => {
          const s = graph.streams[su]!;
          const p = node.ports.find((pt) => pt.id === s.from.port);
          return p?.role === "reject";
        });

        if (primaryStreams.length > 0) {
          let totalShare = 0;
          const shares = primaryStreams.map((su) => {
            const s = graph.streams[su]!;
            const sh = s.routing.kind === "split" ? nonNeg(resolveFactor(s.routing.share, 1)) : 1;
            totalShare += sh;
            return sh;
          });
          for (let k = 0; k < primaryStreams.length; k += 1) {
            const weight = totalShare > 0 ? shares[k] / totalShare : 1 / primaryStreams.length;
            sendAlongStream(primaryStreams[k], primaryOut * weight);
          }
        } else {
          const uObj = graph.units[primaryUnitUri];
          if (uObj && uObj.nature !== "signal" && unitBalances.has(primaryUnitUri)) {
            unitBalances.get(primaryUnitUri)!.outflow += primaryOut;
          }
        }

        if (rejectStreams.length > 0) {
          const perRej = rejectOut / rejectStreams.length;
          for (const rUri of rejectStreams) sendAlongStream(rUri, perRej);
        } else if (rejectOut > 0) {
          const uObj = graph.units[primaryUnitUri];
          if (uObj && uObj.nature !== "signal" && unitBalances.has(primaryUnitUri)) {
            unitBalances.get(primaryUnitUri)!.loss += rejectOut;
          }
        }

        // Costs, revenue & custom ledgerBindings
        const vc = executions * effectiveVarCost;
        const fc = effectiveFixCost;
        const rev = primaryOut * plan.unitPrice;

        if (rev > 0) bookSaleOnCredit(u, plan.atomKey, d, rev, plan.custTerms, "revenue_product");
        if (vc > 0) bookVariableCostOnCredit(u, plan.atomKey, d, vc, plan.suppTerms, "cogs_product");
        if (fc > 0) bookFixedCostImmediate(u, d, fc, "opex_other");
        if (mByAtom[plan.atomKey]) mByAtom[plan.atomKey].volume += primaryOut;

        for (const lb of node.ledgerBindings) {
          const unitAmt = nonNeg(resolveFactor(lb.amount, 0));
          const mult =
            lb.event === "on_complete" ? primaryOut : lb.event === "on_reject" ? rejectOut : 1;
          const totalAmt = unitAmt * mult;
          if (totalAmt > 0) {
            postJournal(
              ledger,
              {
                tick: d,
                memo: `Binding ${lb.event} on ${u}`,
                source: u,
                lines: [
                  { account: lb.debit, amount: totalAmt },
                  { account: lb.credit, amount: -totalAmt },
                ],
              },
              graph.accounts,
            );
          }
        }

        // Step 5: Buffer decay, holding cost, and reorder rule
        let decayAmount = 0;
        let holdCost = 0;
        const curStock = nodeBuffers.get(u) ?? 0;
        const inUnitUri = inPorts[0]?.unit ?? primaryUnitUri;
        const unitDecay = graph.units[inUnitUri]
          ? clamp01(resolveFactor(graph.units[inUnitUri].decayPerTick, 0))
          : 0;
        const decayRate = Math.max(unitDecay, combined.queueDecayPerTick ?? 0);

        if (curStock > 0 && decayRate > 0) {
          decayAmount = curStock * decayRate;
          const newStock = Math.max(0, curStock - decayAmount);
          nodeBuffers.set(u, newStock);
          if (inPorts[0]) {
            const pk = `${u}:${inPorts[0].id}`;
            portBuffers.set(pk, Math.max(0, (portBuffers.get(pk) ?? 0) - decayAmount));
          }
          const uObj = graph.units[inUnitUri];
          if (uObj && uObj.nature !== "signal" && unitBalances.has(inUnitUri)) {
            unitBalances.get(inUnitUri)!.decay += decayAmount;
          }
        }

        const afterDecayStock = nodeBuffers.get(u) ?? 0;
        if (afterDecayStock > 0 && node.buffer?.holdingCostPerUnit) {
          const hRate = nonNeg(resolveFactor(node.buffer.holdingCostPerUnit, 0));
          holdCost = afterDecayStock * hRate;
          if (holdCost > 0) {
            bookFixedCostImmediate(u, d, holdCost, "opex_warehousing");
          }
        }

        if (node.buffer?.reorder) {
          const trigger = nonNeg(resolveFactor(node.buffer.reorder.trigger, 0));
          const target = nonNeg(resolveFactor(node.buffer.reorder.target, 0));
          const cur = nodeBuffers.get(u) ?? 0;
          if (cur <= trigger && target > cur) {
            const orderQty = target - cur;
            nodeBuffers.set(u, cur + orderQty);
            if (inPorts[0]) {
              const pk = `${u}:${inPorts[0].id}`;
              portBuffers.set(pk, (portBuffers.get(pk) ?? 0) + orderQty);
            }
            const uObj = graph.units[inUnitUri];
            if (uObj && uObj.nature !== "signal" && unitBalances.has(inUnitUri)) {
              unitBalances.get(inUnitUri)!.inflow += orderQty;
            }
          }
        }

        st.demand = demand;
        st.capacity = effectiveCap;
        st.throughput = primaryOut;
        st.utilization = effectiveCap > 0 ? executions / effectiveCap : 0;
        st.cycleTime = effectiveCycle;
        st.firstPassYield = effectiveYield;
        st.primaryOutput += primaryOut;
        st.rejectOutput += rejectOut;
        st.wip = nodeBuffers.get(u) ?? 0;
        st.queueDecay += decayAmount;
        st.holdingCost += holdCost;
        st.revenue += rev;
        st.variableCost += vc;
        st.fixedCost += fc + holdCost;
      }
    }

    // Flush consolidated operational accruals and cash expenses for tick d
    flushTickJournal(d);

    // Settle matured customer receipts and supplier payments
    const inflow = receipts.take(d);
    if (inflow > 0) {
      cash += inflow;
      receivables -= inflow;
      postJournal(
        ledger,
        {
          tick: d,
          memo: "Customer receipt settlement",
          source: "settlement:ar",
          cashFlow: "operating",
          lines: [
            { account: "cash", amount: inflow },
            { account: "accounts_receivable", amount: -inflow },
          ],
        },
        graph.accounts,
      );
    }

    const outflow = payments.take(d);
    if (outflow > 0) {
      cash -= outflow;
      payables -= outflow;
      postJournal(
        ledger,
        {
          tick: d,
          memo: "Supplier payment settlement",
          source: "settlement:ap",
          cashFlow: "operating",
          lines: [
            { account: "accounts_payable", amount: outflow },
            { account: "cash", amount: -outflow },
          ],
        },
        graph.accounts,
      );
    }

    days.push({ day: d, cash, receivables, payables, inventory });
    if (cash < minCash) {
      minCash = cash;
      minCashDay = d;
    }
    if (cashOutDay === null && cash < 0) cashOutDay = d;

    if (dom === DAYS_PER_MONTH) {
      const grossMargin = mRevenue - mVariable;
      const operatingProfit = grossMargin - mFixed;
      monthResults.push({
        month,
        calendarMonth: monthMeta.calendarMonth,
        seasonFactor: monthMeta.seasonFactor,
        activeEvents: monthMeta.activeEvents,
        revenue: mRevenue,
        variableCosts: mVariable,
        grossMargin,
        fixedCosts: mFixed,
        operatingProfit,
        endCash: cash,
        endReceivables: receivables,
        endPayables: payables,
        inventory,
        byAtom: mByAtom,
      });
      totals.revenue += mRevenue;
      totals.variableCosts += mVariable;
      totals.fixedCosts += mFixed;
      totals.operatingProfit += operatingProfit;
      monthlyStatements.push(buildFinancialStatements(ledger, graph.accounts));
    }
  }

  // Update inTransit on leaf streams and compute composite stream rollups
  for (const s of leafStreams) {
    const queue = streamQueues.get(s.uri) ?? [];
    const inTransit = queue.reduce((sum, item) => sum + item.amount, 0);
    streamStates[s.uri]!.inTransit = inTransit;
  }

  // Update stockEnd for units with buffers or in-transit streams
  for (const [unitUri, ub] of unitBalances.entries()) {
    if (unitUri === "apex://unit/subscribers") continue;
    let endStock = 0;
    for (const u of registry.leafNodeOrder) {
      const n = graph.nodes[u]!;
      const inPort = n.ports.find((p) => p.side === "I");
      if (inPort && inPort.unit === unitUri) {
        endStock += nodeBuffers.get(u) ?? 0;
      }
    }
    for (const s of leafStreams) {
      if (s.unit === unitUri) {
        endStock += streamStates[s.uri]!.inTransit;
      }
    }
    ub.stockEnd = endStock;
  }

  // Composite stream bundling (sum of leaf children streams)
  for (const s of Object.values(graph.streams)) {
    if (s.children.length === 0) continue;
    const collectLeafChildren = (uri: EntityURI): EntityURI[] => {
      const st = graph.streams[uri];
      if (!st) return [];
      if (st.children.length === 0) return [uri];
      return st.children.flatMap(collectLeafChildren);
    };
    const leaves = collectLeafChildren(s.uri);
    const cst = streamStates[s.uri]!;
    cst.sent = leaves.reduce((acc, lu) => acc + (streamStates[lu]?.sent ?? 0), 0);
    cst.delivered = leaves.reduce((acc, lu) => acc + (streamStates[lu]?.delivered ?? 0), 0);
    cst.inTransit = leaves.reduce((acc, lu) => acc + (streamStates[lu]?.inTransit ?? 0), 0);
    cst.loss = leaves.reduce((acc, lu) => acc + (streamStates[lu]?.loss ?? 0), 0);
    cst.transferCost = leaves.reduce((acc, lu) => acc + (streamStates[lu]?.transferCost ?? 0), 0);
    if (leaves.some((lu) => streamStates[lu]?.status === "stub")) {
      cst.status = "stub";
      cst.stubReason = "not_computed_upstream_undefined";
    }
  }

  // Step 6: Bottom-up composite node rollups (TSD 6.2)
  for (const uri of registry.rollupNodeOrder) {
    const node = graph.nodes[uri];
    if (!node || node.children.length === 0) continue;
    const st = nodeStates[uri]!;
    const activeChildren = node.children
      .filter((cu) => executableNodeSet.has(cu) && nodeStates[cu]?.computed)
      .map((cu) => nodeStates[cu]!);

    const childSet = new Set(node.children);
    // Internal streams between direct children of this composite node
    let internalInTransit = 0;
    let hasInternalSerialEdges = false;
    const childrenWithOutgoingOutsideSubtree: NodeTickState[] = [];

    for (const chUri of node.children) {
      if (!executableNodeSet.has(chUri)) continue;
      const outEdges = leafOutgoingStreams.get(chUri) ?? [];
      const sendsToSibling = outEdges.some((su) => childSet.has(graph.streams[su]!.to.node));
      if (sendsToSibling) {
        hasInternalSerialEdges = true;
        for (const su of outEdges) {
          if (childSet.has(graph.streams[su]!.to.node)) {
            internalInTransit += streamStates[su]?.inTransit ?? 0;
          }
        }
      } else {
        childrenWithOutgoingOutsideSubtree.push(nodeStates[chUri]!);
      }
    }

    st.revenue = activeChildren.reduce((s, c) => s + c.revenue, 0);
    st.variableCost = activeChildren.reduce((s, c) => s + c.variableCost, 0);
    st.fixedCost = activeChildren.reduce((s, c) => s + c.fixedCost, 0);
    st.primaryOutput = activeChildren.reduce((s, c) => s + c.primaryOutput, 0);
    st.rejectOutput = activeChildren.reduce((s, c) => s + c.rejectOutput, 0);
    st.queueDecay = activeChildren.reduce((s, c) => s + c.queueDecay, 0);
    st.holdingCost = activeChildren.reduce((s, c) => s + c.holdingCost, 0);
    st.wip = activeChildren.reduce((s, c) => s + c.wip, 0) + internalInTransit;

    // Throughput = output port flow leaving the composite node
    const exitChildren =
      childrenWithOutgoingOutsideSubtree.length > 0 ? childrenWithOutgoingOutsideSubtree : activeChildren;
    st.throughput = exitChildren.reduce((s, c) => s + c.throughput, 0);
    st.demand = activeChildren.reduce((s, c) => (hasInternalSerialEdges ? Math.max(s, c.demand) : s + c.demand), 0);

    // Flow-weighted bottleneck capacity (TSD 6.2): reduces to min(K_i) in serial chains and sum(K_i) in balanced parallel branches
    const maxUtil = activeChildren.reduce((m, c) => Math.max(m, c.utilization), 0);
    if (maxUtil > 0 && st.throughput > 0) {
      st.capacity = st.throughput / maxUtil;
      st.utilization = maxUtil;
    } else if (hasInternalSerialEdges) {
      const posCaps = activeChildren.filter((c) => c.capacity > 0).map((c) => c.capacity);
      st.capacity = posCaps.length > 0 ? Math.min(...posCaps) : 0;
      st.utilization = 0;
    } else {
      st.capacity = activeChildren.reduce((s, c) => s + c.capacity, 0);
      st.utilization = 0;
    }

    // Little's Law at composite level: avg WIP / throughput (fallback to sum/weighted cycle time when WIP === 0)
    if (st.wip > 0 && st.throughput > 0) {
      st.cycleTime = st.wip / st.throughput;
    } else if (hasInternalSerialEdges) {
      st.cycleTime = activeChildren.reduce((s, c) => s + c.cycleTime, 0);
    } else {
      st.cycleTime =
        activeChildren.length > 0
          ? activeChildren.reduce((s, c) => Math.max(s, c.cycleTime), 0)
          : 0;
    }
  }

  // Theory of Constraints: identify bottleneck leaf node (highest demand / capacity)
  let bottleneckNodeUri: EntityURI | null = null;
  let bottleneckRatio: number | null = null;
  for (const u of registry.leafNodeOrder) {
    if (!executableNodeSet.has(u)) continue;
    const n = graph.nodes[u]!;
    if (n.band !== "value_stream") continue;
    const st = nodeStates[u]!;
    if (st.capacity > 0) {
      const ratio = st.demand / st.capacity;
      if (bottleneckRatio === null || ratio > bottleneckRatio) {
        bottleneckRatio = ratio;
        bottleneckNodeUri = u;
      }
    }
  }

  // Build UnitMassBalance summary and check TSD 6.5 invariants
  const unitMassBalances: Record<string, UnitMassBalance> = {};
  const invariantErrors: string[] = [];

  // Invariant 1: Ledger debits === credits & balance sheet balance
  invariantErrors.push(...verifyLedgerInvariants(ledger, graph.accounts));

  // Invariant 2: Cash change === sum of cash flows === ledger cash account change
  const ledgerEndCash = debitBalance(ledger, "cash");
  if (Math.abs(cash - ledgerEndCash) > 1e-6) {
    invariantErrors.push(`Cash / Ledger cash mismatch: simCash=${cash} vs ledgerCash=${ledgerEndCash}`);
  }

  // Invariant 3: Conservation of mass for every FlowUnit with nature !== "signal"
  for (const [unitUri, ub] of unitBalances.entries()) {
    const unitDef = graph.units[unitUri];
    const stockDelta = ub.stockEnd - ub.stockStart;
    const residual = ub.inflow - (ub.outflow + stockDelta + ub.loss + ub.decay);
    unitMassBalances[unitUri] = {
      unit: unitUri,
      tick: horizonTicks - 1,
      inflow: ub.inflow,
      outflow: ub.outflow,
      stockStart: ub.stockStart,
      stockEnd: ub.stockEnd,
      stockDelta,
      loss: ub.loss,
      decay: ub.decay,
      residual,
    };
    if (unitDef && unitDef.nature !== "signal" && Math.abs(residual) > 1e-6) {
      invariantErrors.push(`Mass balance violation on ${unitUri}: residual=${residual}`);
    }
  }

  // Invariant 4: Composite node rollups match children sums within 1e-6
  for (const uri of registry.rollupNodeOrder) {
    const node = graph.nodes[uri];
    if (!node || node.children.length === 0) continue;
    const st = nodeStates[uri]!;
    const activeChildren = node.children
      .filter((cu) => executableNodeSet.has(cu) && nodeStates[cu]?.computed)
      .map((cu) => nodeStates[cu]!);
    const revSum = activeChildren.reduce((s, c) => s + c.revenue, 0);
    const varSum = activeChildren.reduce((s, c) => s + c.variableCost, 0);
    const fixSum = activeChildren.reduce((s, c) => s + c.fixedCost, 0);
    if (Math.abs(st.revenue - revSum) > 1e-6) {
      invariantErrors.push(`Rollup revenue mismatch on ${uri}: ${st.revenue} vs ${revSum}`);
    }
    if (Math.abs(st.variableCost - varSum) > 1e-6) {
      invariantErrors.push(`Rollup variableCost mismatch on ${uri}: ${st.variableCost} vs ${varSum}`);
    }
    if (Math.abs(st.fixedCost - fixSum) > 1e-6) {
      invariantErrors.push(`Rollup fixedCost mismatch on ${uri}: ${st.fixedCost} vs ${fixSum}`);
    }
  }

  // Invariant 6: Incomplete ("named" / "unknown") and pending "ghost" nodes must have 0 computed output/cost/revenue
  for (const skipped of skippedNodes) {
    const st = nodeStates[skipped.uri];
    if (st && (st.revenue !== 0 || st.variableCost !== 0 || st.fixedCost !== 0 || st.throughput !== 0)) {
      invariantErrors.push(`Skipped node ${skipped.uri} (${skipped.reason}) produced non-zero values`);
    }
  }

  const reconciliationError =
    cash - openingCash - (totals.operatingProfit - receivables + payables - inventory);

  const statements = buildFinancialStatements(ledger, graph.accounts);
  const upstreamWaitingNodes = [...upstreamWaitingMap.entries()].map(([uri, message]) => ({
    uri,
    message,
  }));

  return {
    maturityGated: false,
    horizonDays: horizonTicks,
    days,
    months: monthResults,
    openingCash,
    endCash: cash,
    minCash,
    minCashDay,
    cashOutDay,
    totals,
    reconciliationError,
    ledger,
    statements,
    monthlyStatements,
    nodeStates,
    streamStates,
    unitMassBalances,
    bottleneckNodeUri,
    bottleneckRatio,
    skippedNodes,
    stubStreams,
    upstreamWaitingNodes,
    invariantErrors,
  };
}
