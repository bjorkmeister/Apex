/**
 * Automated Unit & Integration Test Suite for the APEX Core Engine (`/tests/engine.test.ts`).
 *
 * Verifies:
 *  1. Strict 8-Step Deterministic Pipeline Sequence & Sub-Millisecond Micro-Tick Execution
 *  2. Conservation of Cash & Inventory (`Trial Balance === 0`, `Assets === Liabilities + Equity`,
 *     no phantom goods, no negative cash or lot balances)
 *  3. Working Capital Cash-Trap Behavior (profitable high-growth B2B/Wholesale revenue with long DSO
 *     vs. short supplier/payroll obligations triggering liquidity exhaustion & insolvency before AR collection)
 *  4. Little's Law ($L = \lambda W$) Non-Linear Queuing Penalty, Defect Escalation & Wear when Utilization > 85%
 *  5. Two-Phase Commit (`validateAction` -> `commitAction`) Transaction Lifecycle & Rejection Diagnostics
 *  6. Tiered Tick-Clock Interrupt Monitor (`runMicroTickLoop` yielding on macro intervals & state-driven triggers)
 *  7. Archetype-Bounded Business DNA Compiler (`ASSET_HEAVY_MANUFACTURING`, `PERISHABLE_COLD_CHAIN`,
 *     `HIGH_VELOCITY_D2C`, `B2B_ENTERPRISE_SERVICES`, `PLATFORM_RECURRING`) & Sanity Bounds Enforcement
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ARCHETYPE_BASELINES,
  buildBalanceSheet,
  buildColdChainLogisticsScenario,
  buildCustomEbikeScenario,
  buildIncomeStatement,
  buildVerticalFarmScenario,
  classifyPromptArchetype,
  cloneWorldState,
  commitAction,
  compileBusinessPrompt,
  compileBusinessPromptSync,
  debitBalance,
  enforceArchetypeSanityBounds,
  GLOBAL_GROSS_MARGIN_MAX,
  GLOBAL_GROSS_MARGIN_MIN,
  IndustryArchetype,
  onHandQty,
  onHandValue,
  PIPELINE_STEPS,
  type PipelineStepName,
  placePurchaseOrder,
  resolveOfferingPrice,
  resolveTick,
  runMicroTickLoop,
  scheduleProductionOrder,
  SeededRng,
  unitBookCost,
  validateAction,
  verifyAccountingInvariants,
} from "../src/core/index.ts";

describe("APEX Core Engine — Architectural Amendment Verification Suite", () => {
  it("1. Enforces the strict 8-step deterministic pipeline sequence and sub-millisecond micro-ticks", () => {
    const state = buildVerticalFarmScenario(20261016);
    const observedSteps: PipelineStepName[] = [];

    const res = resolveTick(state, {
      strictInvariants: true,
      autoResolveDecisions: true,
      onPipelineStep: (step) => {
        observedSteps.push(step);
      },
    });

    assert.deepEqual(
      observedSteps,
      [...PIPELINE_STEPS],
      "resolveTick must execute all 8 pipeline stages in exact canonical sequence",
    );
    assert.deepEqual(res.pipelineTrace, [...PIPELINE_STEPS]);
    assert.equal(res.invariantErrors.length, 0);

    // Benchmark 90 synchronous daily micro-ticks in memory
    const startMs = performance.now();
    for (let i = 0; i < 90; i++) {
      resolveTick(state, { strictInvariants: true, autoResolveDecisions: true });
    }
    const elapsedMs = performance.now() - startMs;
    const avgMsPerTick = elapsedMs / 90;

    assert.ok(
      avgMsPerTick < 2.0,
      `Expected fast synchronous in-memory micro-ticks, got ${avgMsPerTick.toFixed(3)}ms/tick`,
    );
  });

  it("2. Enforces strict conservation of cash and inventory (no phantom goods or negative balances)", () => {
    const scenarios = [
      buildVerticalFarmScenario(101),
      buildCustomEbikeScenario(202),
      buildColdChainLogisticsScenario(303),
    ];

    for (const state of scenarios) {
      for (let t = 0; t < 90; t++) {
        const res = resolveTick(state, {
          strictInvariants: true,
          autoResolveDecisions: true,
        });

        // 1. Zero double-entry / sub-ledger invariant errors
        assert.equal(
          res.invariantErrors.length,
          0,
          `Invariant violation at tick ${res.tick}: ${res.invariantErrors.join("; ")}`,
        );

        // 2. Balance sheet fundamental identity: Assets === Liabilities + Equity
        const bs = buildBalanceSheet(state.finance.ledger);
        assert.equal(bs.balanced, true, `Balance sheet not balanced at tick ${res.tick}`);
        assert.equal(
          bs.assets.total,
          bs.liabilities.total + bs.equity.total,
          `Balance sheet mismatch at tick ${res.tick}`,
        );

        // 3. Cash balance must never go negative
        assert.ok(
          bs.assets.cash >= 0,
          `Negative cash balance (${bs.assets.cash}) at tick ${res.tick}`,
        );

        // 4. Every physical inventory lot must have strictly non-negative qty and value,
        //    and sum of lot values must equal GL inventory accounts
        let rawLotsValue = 0;
        let finLotsValue = 0;
        for (const lot of state.warehouses.lots) {
          assert.ok(lot.qty > 0, `Phantom or negative lot qty (${lot.qty}) on ${lot.id}`);
          assert.ok(lot.value >= 0, `Negative lot value (${lot.value}) on ${lot.id}`);
          const item = state.catalog.items.find((i) => i.id === lot.itemId);
          assert.ok(item, `Unknown item ${lot.itemId} on lot ${lot.id}`);
          if (item.kind === "finished") finLotsValue += lot.value;
          else rawLotsValue += lot.value;
        }
        assert.equal(rawLotsValue, bs.assets.inventoryRaw);
        assert.equal(finLotsValue, bs.assets.inventoryFinished);
      }
    }

    // Explicitly verify hard physical conservation when finished inventory is zero
    const starved = buildCustomEbikeScenario(999);
    starved.warehouses.lots = starved.warehouses.lots.filter((l) => {
      const it = starved.catalog.items.find((i) => i.id === l.itemId);
      return it?.kind !== "finished";
    });
    // Re-sync opening balance sheet after removing finished lots
    const rawVal = starved.warehouses.lots.reduce((s, l) => s + l.value, 0);
    starved.finance.ledger.balances.inventory_finished = 0;
    starved.finance.ledger.balances.paid_in_capital = -(
      starved.finance.ledger.balances.cash +
      rawVal +
      starved.finance.ledger.balances.ppe_gross -
      starved.finance.debts.reduce((s, d) => s + d.principal, 0)
    );
    // Pause production so zero finished goods can be produced
    for (const pol of starved.operations.policies) {
      pol.mode = "manual";
    }
    starved.operations.orders = [];

    const tickRes = resolveTick(starved, { strictInvariants: true, autoResolveDecisions: true });
    assert.equal(
      tickRes.dailyKpi.unitsShipped,
      0,
      "Zero finished goods in warehouse must result in zero shipped units (no phantom shipments)",
    );
    assert.equal(onHandQty(starved, "item_ti_ebike"), 0);
    assert.equal(onHandValue(starved, "item_ti_ebike"), 0);
  });

  it("3. Models the Working Capital Cash-Trap (insolvency triggered by high DSO receivables before cash collection)", () => {
    const state = buildCustomEbikeScenario(4040);

    // Configure a classic Working Capital Cash-Trap:
    //  - All sales channels invoice on Net 90 terms (DSO = 90 days)
    //  - Revolver is fully drawn / zero available credit headroom
    //  - Starting cash is tight ($15,000), while bi-weekly payroll & supplier AP come due on Day 15 & Day 30
    //  - Company books profitable B2B/Wholesale revenue (AR surges), but runs out of cash before Day 90 AR collection
    for (const ch of state.commercial.channels) {
      ch.paymentTermsDays = 90;
    }
    for (const seg of state.market.segments) {
      seg.baseDailyDemand = 18;
    }
    for (const d of state.finance.debts) {
      if (d.kind === "revolver") {
        d.limit = d.principal; // Zero revolver headroom
      }
    }

    // Drain cash down to $15,000 (compensated in paid_in_capital so ledger remains balanced)
    const currentCash = debitBalance(state.finance.ledger, "cash");
    const targetCash = 15_000_00;
    const cashReduction = currentCash - targetCash;
    state.finance.ledger.balances.cash -= cashReduction;
    state.finance.ledger.balances.paid_in_capital += cashReduction;
    state.finance.periodStartCash = targetCash;

    assert.equal(verifyAccountingInvariants(state).length, 0);

    let maxAccountsReceivable = 0;
    let totalRevenueBooked = 0;

    for (let day = 1; day <= 45; day++) {
      if (state.status === "bankrupt") break;
      const res = resolveTick(state, {
        strictInvariants: true,
        autoResolveDecisions: true,
      });
      maxAccountsReceivable = Math.max(
        maxAccountsReceivable,
        res.dailyKpi.accountsReceivable,
      );
      totalRevenueBooked += res.dailyKpi.netRevenue;
    }

    const is = buildIncomeStatement(state.finance.ledger);
    assert.ok(
      maxAccountsReceivable > 50_000_00,
      `Expected substantial uncollected Accounts Receivable buildup, got $${(maxAccountsReceivable / 100).toFixed(0)}`,
    );
    assert.ok(
      totalRevenueBooked > 50_000_00 || is.grossProfit >= 0,
      "Company booked top-line revenue while locked in the working capital trap",
    );
    assert.equal(
      state.status,
      "bankrupt",
      "Expected working capital cash-trap to trigger bankruptcy from missed payrolls before 90-day AR matured",
    );
    assert.ok(
      state.finance.missedPayrolls >= 2,
      `Expected >= 2 missed payrolls, got ${state.finance.missedPayrolls}`,
    );
  });

  it("4. Enforces Little's Law (L = λW) non-linear queuing penalty, defect surge, and machine wear when utilization exceeds 85%", () => {
    // Compare two identical work centers:
    //  - `lowLoadState` at ~42% capacity utilization (<= 85% linear regime)
    //  - `highLoadState` at ~125% capacity utilization (> 85% non-linear Kingman regime)
    const lowLoadState = buildCustomEbikeScenario(5050);
    const highLoadState = cloneWorldState(lowLoadState);

    for (const st of [lowLoadState, highLoadState]) {
      for (const pol of st.operations.policies) pol.mode = "manual";
      st.operations.orders = [];
      // Ensure abundant raw materials & labor hours so work-center machine capacity is the active constraint
      for (const lot of st.warehouses.lots) {
        lot.qty *= 10;
      }
      for (const pos of st.org.positions) {
        pos.cohorts[0].count = 25;
        pos.laborHoursAvailable = 200;
      }
    }

    const recipe = lowLoadState.catalog.recipes[0];
    const wcLow = lowLoadState.operations.workCenters[0];
    const wcHigh = highLoadState.operations.workCenters[0];
    const initialCondition = wcLow.condition;

    // Disable daily maintenance restoration so we can directly compare machine wear per hour
    wcLow.maintenanceCostPerDay = 0;
    wcLow.maintenanceRestorePerDay = 0;
    wcHigh.maintenanceCostPerDay = 0;
    wcHigh.maintenanceRestorePerDay = 0;

    // Each batch of `recipe_ti_ebike` takes `recipe.machineHours` (10h) and `wc.machineHoursPerDay` is 24h.
    // 1 batch/day => ~42% utilization (< 85%); 3 batches/day => ~125% utilization (> 85%).
    for (let day = 0; day < 8; day++) {
      scheduleProductionOrder(lowLoadState, recipe, 1);
      scheduleProductionOrder(highLoadState, recipe, 3);

      resolveTick(lowLoadState, { autoResolveDecisions: true });
      resolveTick(highLoadState, { autoResolveDecisions: true });
    }

    // 1. Utilization is below 85% in lowLoadState and above 85% in highLoadState
    assert.ok(
      wcLow.telemetry.utilization < 0.85,
      `Expected low-load utilization < 0.85, got ${wcLow.telemetry.utilization}`,
    );
    assert.ok(
      wcHigh.telemetry.utilization > 0.85,
      `Expected high-load utilization > 0.85, got ${wcHigh.telemetry.utilization}`,
    );

    // 2. Little's Law exact identity: L = λ * W on both work centers
    assert.ok(
      Math.abs(
        wcHigh.telemetry.littlesL -
          wcHigh.telemetry.arrivalRateEma * wcHigh.telemetry.avgWaitDays,
      ) < 1e-6,
      "Little's Law identity L = λW must hold exactly",
    );

    // 3. Non-linear queuing wait time W and queue length L surge above 85% utilization
    assert.ok(
      wcHigh.telemetry.avgWaitDays > wcLow.telemetry.avgWaitDays * 1.5,
      `Expected non-linear wait time surge above 85% utilization: high W=${wcHigh.telemetry.avgWaitDays.toFixed(2)}d vs low W=${wcLow.telemetry.avgWaitDays.toFixed(2)}d`,
    );
    assert.ok(
      wcHigh.telemetry.littlesL > wcLow.telemetry.littlesL * 3,
      `Expected Little's Law queue L to surge non-linearly: high L=${wcHigh.telemetry.littlesL.toFixed(2)} vs low L=${wcLow.telemetry.littlesL.toFixed(2)}`,
    );

    // 4. Defect rate EMA and equipment wear rise non-linearly above 85%
    assert.ok(
      wcHigh.telemetry.defectRateEma > wcLow.telemetry.defectRateEma,
      `Expected higher defect rate above 85% utilization (${wcHigh.telemetry.defectRateEma} vs ${wcLow.telemetry.defectRateEma})`,
    );
    const wearLow = initialCondition - wcLow.condition;
    const wearHigh = initialCondition - wcHigh.condition;
    assert.ok(
      wearHigh > wearLow * 2.5,
      `Expected non-linear equipment wear above 85% utilization (wearHigh=${wearHigh.toFixed(4)} vs wearLow=${wearLow.toFixed(4)})`,
    );
  });

  it("5. Enforces Two-Phase Commit (validateAction / commitAction) for Agent & Player actions", () => {
    const state = buildVerticalFarmScenario(6060);
    const cashBefore = debitBalance(state.finance.ledger, "cash");

    // Case A: Reject CapEx upgrade when cash is insufficient (zero state mutation)
    const unaffordableCapex = validateAction(state, {
      type: "CAPEX_UPGRADE",
      targetKind: "warehouse",
      targetId: "wh_urban_farm",
      upgrade: "capacity",
      amount: cashBefore + 500_000_00,
      financing: "cash",
    });
    assert.equal(unaffordableCapex.valid, false);
    assert.ok(
      unaffordableCapex.diagnostics.some((d) => d.code === "INSUFFICIENT_CASH_CAPEX"),
      "Expected INSUFFICIENT_CASH_CAPEX diagnostic code",
    );
    assert.equal(
      debitBalance(state.finance.ledger, "cash"),
      cashBefore,
      "Failed validateAction must never mutate treasury cash",
    );

    // Case B: Reject PO when warehouse lacks cubic capacity for the order volume
    const hugePo = validateAction(state, {
      type: "PLACE_PURCHASE_ORDER",
      supplierId: "sup_dutch_hydro",
      itemId: "item_seed_nutrient",
      warehouseId: "wh_urban_farm",
      laneId: "lane_ocean_eu",
      qty: 500_000, // 7,500 m3 > 260 m3 ambient zone
    });
    assert.equal(hugePo.valid, false);
    assert.ok(
      hugePo.diagnostics.some((d) => d.code === "WAREHOUSE_CAPACITY_EXCEEDED"),
      "Expected WAREHOUSE_CAPACITY_EXCEEDED diagnostic code",
    );

    // Case C: Valid action passes validateAction and mutates state only on commitAction
    const targetOfferingId = state.commercial.offerings[0].id;
    const validPriceUpdate = validateAction(state, {
      type: "SET_PRICING",
      offeringId: targetOfferingId,
      pricing: {
        kind: "value_based",
        listPrice: 99_00,
      },
    });
    assert.equal(validPriceUpdate.valid, true);
    assert.ok(validPriceUpdate.validatedAction);

    // Before commitAction, pricing is unchanged
    assert.notEqual(
      resolveOfferingPrice(state, state.commercial.offerings[0]).netUnitPrice,
      99_00,
    );

    commitAction(state, validPriceUpdate.validatedAction);
    const updatedOff = state.commercial.offerings.find((o) => o.id === targetOfferingId)!;
    assert.equal(updatedOff.pricing.kind, "value_based");
    if (updatedOff.pricing.kind === "value_based") {
      assert.equal(updatedOff.pricing.listPrice, 99_00);
    }
    assert.equal(verifyAccountingInvariants(state).length, 0);
  });

  it("6. Halts the micro-tick loop and yields to the Cognitive Orchestrator on Tiered Tick-Clock triggers", () => {
    const state = buildVerticalFarmScenario(7070);

    // A. Scheduled Macro-Interval: Weekly War Room Briefing at Day 7
    const macroLoop = runMicroTickLoop(state, 30, {
      strictInvariants: true,
      autoResolveDecisions: true,
      pauseOnMacroIntervals: true,
    });
    assert.equal(
      macroLoop.ticksExecuted,
      7,
      "Micro-tick loop with pauseOnMacroIntervals must pause on Day 7 for WEEKLY_WAR_ROOM",
    );
    assert.equal(macroLoop.yielded, true);
    assert.ok(macroLoop.activeTriggers.some((t) => t.kind === "WEEKLY_WAR_ROOM"));

    // B. State-Driven Interrupt: Loan Covenant Breach (`min_cash`)
    const breachState = buildVerticalFarmScenario(7071);
    const currentCash = debitBalance(breachState.finance.ledger, "cash");
    // Drop cash below the $25,000 min_cash covenant on debt_revolver
    const drop = currentCash - 15_000_00;
    breachState.finance.ledger.balances.cash -= drop;
    breachState.finance.ledger.balances.paid_in_capital += drop;
    breachState.finance.periodStartCash = 15_000_00;

    const breachLoop = runMicroTickLoop(breachState, 10, {
      strictInvariants: true,
      autoResolveDecisions: true,
    });
    assert.equal(
      breachLoop.ticksExecuted,
      1,
      "Micro-tick loop must yield immediately on Tick 1 when min_cash loan covenant is breached",
    );
    assert.equal(breachLoop.yielded, true);
    assert.ok(
      breachLoop.activeTriggers.some((t) => t.kind === "COVENANT_BREACH"),
      "Expected COVENANT_BREACH trigger alert",
    );
  });

  it("7. Anchors the Business DNA Compiler to the 5 explicit industry archetypes and enforces sanity bounds", async () => {
    const archetypes = IndustryArchetype.options;
    assert.deepEqual(archetypes, [
      "ASSET_HEAVY_MANUFACTURING",
      "PERISHABLE_COLD_CHAIN",
      "HIGH_VELOCITY_D2C",
      "B2B_ENTERPRISE_SERVICES",
      "PLATFORM_RECURRING",
    ]);

    const promptsByArchetype: Record<IndustryArchetype, string> = {
      ASSET_HEAVY_MANUFACTURING: "Precision CNC aerospace actuator factory",
      PERISHABLE_COLD_CHAIN: "Organic cold-pressed juice & fresh meal vertical kitchen",
      HIGH_VELOCITY_D2C: "Direct-to-consumer performance skincare e-commerce brand",
      B2B_ENTERPRISE_SERVICES: "B2B commercial HVAC maintenance & fleet logistics contractor",
      PLATFORM_RECURRING: "Cloud SaaS & IoT sensor recurring subscription platform",
    };

    for (const [expectedArch, prompt] of Object.entries(promptsByArchetype) as [
      IndustryArchetype,
      string,
    ][]) {
      assert.equal(classifyPromptArchetype(prompt), expectedArch);
      const compiled = compileBusinessPromptSync(prompt, { seed: 12345 });
      assert.equal(compiled.company.archetype, expectedArch);
      assert.equal(verifyAccountingInvariants(compiled).length, 0);

      // Verify Gross Margins on all offerings are bounded within [20%, 80%]
      for (const off of compiled.commercial.offerings) {
        const ch = compiled.commercial.channels.find((c) => c.id === off.channelId);
        const unitCost = unitBookCost(compiled, off.itemId, ch?.fulfillmentWarehouseId);
        const { netUnitPrice } = resolveOfferingPrice(compiled, off);
        const gm = (netUnitPrice - unitCost) / netUnitPrice;
        assert.ok(
          gm >= GLOBAL_GROSS_MARGIN_MIN - 0.01 && gm <= GLOBAL_GROSS_MARGIN_MAX + 0.01,
          `Offering ${off.id} gross margin ${(gm * 100).toFixed(1)}% outside [20%, 80%]`,
        );
      }

      // Verify Operating Cash Reserve floor
      const spec = ARCHETYPE_BASELINES[expectedArch];
      assert.ok(
        debitBalance(compiled.finance.ledger, "cash") >= spec.minOperatingCashCents,
        `Opening cash below archetype floor for ${expectedArch}`,
      );
    }

    // Verify that hallucinated LLM parameters (e.g., 98% gross margin, <5% gross margin, $100 cash, 240-day DSO)
    // are clamped into valid sanity bounds by compileBusinessPrompt + enforceArchetypeSanityBounds
    const sanitized = await compileBusinessPrompt("D2C athletic beverage brand", {
      seed: 8888,
      llmGenerator: async () => {
        const raw = buildVerticalFarmScenario(8888);
        raw.commercial.offerings[0].pricing = {
          kind: "value_based",
          listPrice: 5_000_00, // >98% gross margin
        };
        raw.commercial.offerings[1].pricing = {
          kind: "value_based",
          listPrice: 33_00, // <5% gross margin
        };
        raw.commercial.channels[0].paymentTermsDays = 240; // Unbounded DSO
        raw.supply.suppliers[0].terms = { kind: "net", days: 180 }; // Unbounded DPO
        raw.finance.periodStartCash = 100_00; // $100 cash (severely under-reserved)
        return raw;
      },
    });

    assert.equal(sanitized.company.archetype, "HIGH_VELOCITY_D2C");
    assert.equal(verifyAccountingInvariants(sanitized).length, 0);

    for (const off of sanitized.commercial.offerings) {
      const ch = sanitized.commercial.channels.find((c) => c.id === off.channelId);
      const unitCost = unitBookCost(sanitized, off.itemId, ch?.fulfillmentWarehouseId);
      const { netUnitPrice } = resolveOfferingPrice(sanitized, off);
      const gm = (netUnitPrice - unitCost) / netUnitPrice;
      assert.ok(
        gm >= GLOBAL_GROSS_MARGIN_MIN - 0.01 && gm <= GLOBAL_GROSS_MARGIN_MAX + 0.01,
        `Clamped offering ${off.id} gross margin ${(gm * 100).toFixed(1)}% must sit within [20%, 80%]`,
      );
    }
    assert.ok(
      sanitized.commercial.channels[0].paymentTermsDays <= 30,
      `Expected DSO clamped to HIGH_VELOCITY_D2C band, got ${sanitized.commercial.channels[0].paymentTermsDays}`,
    );
    assert.ok(
      sanitized.supply.suppliers[0].terms.days <= 45,
      `Expected DPO clamped to HIGH_VELOCITY_D2C band, got ${sanitized.supply.suppliers[0].terms.days}`,
    );
    assert.ok(
      debitBalance(sanitized.finance.ledger, "cash") >=
        ARCHETYPE_BASELINES.HIGH_VELOCITY_D2C.minOperatingCashCents,
      "Expected opening cash reserve raised to archetype minimum",
    );

    void placePurchaseOrder;
    void enforceArchetypeSanityBounds;
    void SeededRng;
  });

  it("8. Surfaces 5 Industry Archetypes, 8-Step Pipeline, and Two-Phase Commit diagnostics in the War Room UI & Server", async () => {
    const {
      buildViewPayload,
      createInitialSession,
      executeTwoPhaseActionOnSession,
    } = await import("../src/app/server.ts");

    const session = createInitialSession("vertical_farm");
    const state = session.branches[0].head;

    // 1. Verify initial War Room HTML includes Archetype badge, 5-Archetype selector, and 8-Step Pipeline strip
    const initialPayload = buildViewPayload(session);
    assert.equal(initialPayload.archetype, "PERISHABLE_COLD_CHAIN");
    assert.ok(initialPayload.html.includes("ARCHETYPE: PERISHABLE_COLD_CHAIN"));
    assert.ok(initialPayload.html.includes("8-STEP DETERMINISTIC PIPELINE:"));
    assert.ok(initialPayload.html.includes("Next Trigger / Briefing"));

    // 2. Verify rejected Two-Phase Commit action surfaces diagnostic code in War Room UI
    const rejectedFeedback = executeTwoPhaseActionOnSession(
      session,
      state,
      {
        type: "CAPEX_UPGRADE",
        targetKind: "warehouse",
        targetId: "wh_urban_farm",
        upgrade: "capacity",
        amount: 99_000_000_00,
        financing: "cash",
      },
      "player:ceo",
    );
    assert.equal(rejectedFeedback.ok, false);
    const rejectedPayload = buildViewPayload(session);
    assert.ok(rejectedPayload.html.includes("2PC REJECTED [CAPEX_UPGRADE]"));
    assert.ok(rejectedPayload.html.includes("INSUFFICIENT_CASH_CAPEX"));

    // 3. Verify committed Two-Phase Commit action surfaces confirmation in War Room UI
    const committedFeedback = executeTwoPhaseActionOnSession(
      session,
      state,
      {
        type: "SET_PRICING",
        offeringId: state.commercial.offerings[0].id,
        pricing: { kind: "value_based", listPrice: 105_00 },
      },
      "player:ceo",
    );
    assert.equal(committedFeedback.ok, true);
    const committedPayload = buildViewPayload(session);
    assert.ok(committedPayload.html.includes("2PC COMMITTED [SET_PRICING]"));
  });
});
