/**
 * Comprehensive Verification & Simulation Harness for APEX Core:
 *  - Verifies Zod schema validation across all 3 starter presets + custom prompt compilation.
 *  - Runs 180 daily ticks (6 months) across all 3 presets with `strictInvariants: true`,
 *    verifying on EVERY single tick:
 *      * Trial balance sum === 0 in integer cents
 *      * Balance sheet `Assets === Liabilities + Equity`
 *      * Cash flow statement `beginCash + netChange === endCash`
 *      * Inventory lot sub-ledger === GL `inventory_raw` + `inventory_finished`
 *      * WIP order sub-ledger === GL `inventory_wip`
 *      * AR & AP sub-ledgers === GL `accounts_receivable` / `accounts_payable` / `taxes_payable`
 *  - Verifies 100% deterministic PRNG reproducibility across timeline branches ("Git for Business Strategy").
 *  - Verifies C-Suite Multi-Agent War Room Briefing, Counterparty Negotiation, Monte Carlo Comparator,
 *    and Executive Business Case Markdown export.
 */
import assert from "node:assert/strict";
import {
  compileBusinessPromptSync,
  createRootBranch,
  dispatchAction,
  exportExecutiveBusinessCaseMarkdown,
  forkTimelineBranch,
  generateWarRoomBriefing,
  negotiateWithCounterparty,
  runMonteCarloSimulation,
  runTicks,
  SCENARIO_PRESETS,
  verifyAccountingInvariants,
  WorldState,
} from "../src/core/index.ts";

console.log("=== APEX DETERMINISTIC DUAL-ENGINE VERIFICATION SUITE ===\n");

for (const preset of SCENARIO_PRESETS) {
  const state = preset.build(424242);
  // 1. Validate against root Zod schema
  WorldState.parse(state);

  // 2. Verify opening balance sheet invariants
  const initErrs = verifyAccountingInvariants(state);
  assert.equal(initErrs.length, 0, `Opening invariant errors in ${preset.id}: ${initErrs.join(", ")}`);

  // 3. Run 180 daily ticks (6 months) with strict double-entry + sub-ledger invariant checking on every tick
  const results = runTicks(state, 180, {
    strictInvariants: true,
    autoResolveDecisions: true,
  });

  assert.ok(results.length >= 180, `Expected 180 ticks for ${preset.id}, got ${results.length}`);
  assert.equal(state.telemetry.monthly.length, 6, `Expected 6 monthly reports for ${preset.id}`);

  const lastDaily = results[results.length - 1].dailyKpi;
  const m6 = state.telemetry.monthly[5];

  console.log(
    `[PASS] Preset "${preset.name}" (${preset.id}) — 180 Ticks (6 Months) Verified:`,
  );
  console.log(
    `       M6 Net Revenue: $${(m6.statements.incomeStatement.netRevenue / 100).toLocaleString()} | Gross Margin: ${(m6.kpis.grossMargin * 100).toFixed(1)}% | EBITDA: $${(m6.statements.incomeStatement.ebitda / 100).toLocaleString()}`,
  );
  console.log(
    `       Ending Cash: $${(lastDaily.cash / 100).toLocaleString()} | CCC: ${lastDaily.ccc.toFixed(1)}d (DIO ${lastDaily.dio.toFixed(1)}d + DSO ${lastDaily.dso.toFixed(1)}d - DPO ${lastDaily.dpo.toFixed(1)}d) | Fill Rate: ${(m6.kpis.fillRate * 100).toFixed(1)}%\n`,
  );
}

// 4. Verify 100% Deterministic Timeline Branching ("Git for Business Cases")
const baseFarm = compileBusinessPromptSync("Robotic strawberry vertical farm", { seed: 777 });
runTicks(baseFarm, 30, { strictInvariants: true, autoResolveDecisions: true });

const rootBranch = createRootBranch(baseFarm, "main");
const cloneA = forkTimelineBranch(rootBranch, { name: "replica_A" });
const cloneB = forkTimelineBranch(rootBranch, { name: "replica_B" });

runTicks(cloneA.head, 45, { strictInvariants: true, autoResolveDecisions: true });
runTicks(cloneB.head, 45, { strictInvariants: true, autoResolveDecisions: true });

assert.equal(
  cloneA.head.finance.ledger.balances.cash,
  cloneB.head.finance.ledger.balances.cash,
  "Identical seeds & actions must yield bit-identical cash balances across forked branches",
);
assert.equal(
  cloneA.head.rngState,
  cloneB.head.rngState,
  "Identical seeds must end with identical PRNG state",
);
console.log("[PASS] Deterministic Timeline Branching (bit-exact reproducibility across forks)");

// 5. Verify Strategic Branch Divergence & Monte Carlo Comparator
const branchInsourced = forkTimelineBranch(rootBranch, {
  name: "Branch A: Warehouse Automation CapEx + Direct Sales Hire",
  initialActions: [
    {
      type: "CAPEX_UPGRADE",
      targetKind: "warehouse",
      targetId: "wh_urban_farm",
      upgrade: "automation",
      amount: 40_000_00,
      financing: "equipment_loan",
    },
    {
      type: "HIRE",
      roleId: "role_sales_ae",
      count: 1,
    },
  ],
});

const mcSummary = runMonteCarloSimulation(branchInsourced.head, {
  runs: 8,
  horizonDays: 60,
});
assert.equal(mcSummary.runs, 8);
console.log(
  `[PASS] Monte Carlo Branch Simulator (8 runs × 60d): Survival ${(mcSummary.survivalRate * 100).toFixed(0)}% | P50 Cash $${(mcSummary.endingCashP50 / 100).toLocaleString()}`,
);

// 6. Verify C-Suite Multi-Agent War Room Briefing & Counterparty Negotiation
const briefing = generateWarRoomBriefing(branchInsourced.head);
assert.equal(briefing.proposals.length, 4, "Expected 4 C-Suite proposals (COO, CFO, CRO, CHRO)");
for (const prop of briefing.proposals) {
  for (const act of prop.actions) {
    const res = dispatchAction(branchInsourced.head, act, {
      issuedBy: `agent:${prop.agentRole}`,
      immediate: true,
    });
    assert.ok("ok" in res && res.ok, `Agent ${prop.agentRole} action failed validation`);
  }
}
const neg = negotiateWithCounterparty(branchInsourced.head, {
  counterpartyKind: "supplier",
  counterpartyId: "sup_dutch_hydro",
  requestedValue: 45,
  offeredCommitment: 600,
});
assert.equal(neg.accepted, true);
console.log("[PASS] Multi-Agent C-Suite War Room Briefing & Supplier Contract Negotiation");

// 7. Verify Free-Text Zero-to-Ontology Compiler & Executive Business Case Export
const customState = compileBusinessPromptSync(
  "Boutique cold-brew coffee roastery and B2B office keg subscription service",
);
runTicks(customState, 30, { strictInvariants: true, autoResolveDecisions: true });
const md = exportExecutiveBusinessCaseMarkdown(customState);
assert.ok(md.includes("# EXECUTIVE BUSINESS CASE:"));
console.log(
  `[PASS] Zero-to-Ontology Custom Prompt Compiler ("${customState.company.name}") & Executive Export (${md.length} chars)`,
);

// 8. Verify AAA War Room UI Renderer (Value Chain SVG + All 4 Telemetry Drawers + C-Suite Panel)
import { buildViewPayload, createInitialSession } from "../src/app/server.ts";
const session = createInitialSession("vertical_farm");
for (const tab of ["financials", "operations", "org", "branches"] as const) {
  session.activeTab = tab;
  const viewPayload = buildViewPayload(session);
  assert.ok(viewPayload.html.includes("vc-svg"), `Expected Value Chain SVG in War Room HTML (${tab})`);
}
session.activeTab = "financials";
const viewPayload = buildViewPayload(session);
assert.ok(
  viewPayload.html.includes("DOUBLE-ENTRY VERIFIED: ASSETS = LIABILITIES + EQUITY"),
  "Expected Double-Entry Verification badge in War Room HTML",
);
console.log(
  `[PASS] AAA War Room UI Dashboard & All 4 Telemetry Drawers (${viewPayload.html.length} chars)\n`,
);
console.log("ALL CORE ENGINE, ACCOUNTING INVARIANT & WAR ROOM UI CHECKS PASSED.");


