/**
 * APEX Studio v3.2 — Tarkistuspiste 1 (V2.A & V2.B) testit (`tests/flow-graph.test.ts`).
 *
 * Kattaa:
 * - Golden-testit: 4 esimerkkimallia + sesonki/kriisi vanhalla ytimellä vs. uudella graafimoottorilla (ero <= 0,5 %)
 * - Invariantit 1–6 (TSD 6.5): Pääkirja (Debet === Kredit), Kassa, Massatase, Koosteet (Rollup), Determinismi, Keskeneräisyys/Ghost
 * - Kanoniset yliajot 1, 3, 4 ja 5 (PhysicsModule-yhdistäminen, cycleTicks vs. maksuaika, stub-virrat, johdettu EntityRegistry)
 * - Mekanismit (roolit, resurssit, IT-kertoimet, käyttöönottonotkahdus, kriittinen katko), kaavat ja jaksolliset aallot
 * - Nopeus 1 -suorituskykybudjetti: 300 lehtisolmua x 360 tickiä < 16 ms (Invariantti A4)
 * - P1 Toimiala-agnostisuustesti ja Type-Stripping -yhteensopivuustesti
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import * as nodeModule from "node:module";
import { createPreset, emptyMolecule, simulate, type PresetId } from "../src/flow/kernel/index.ts";
import { CRISIS_LIBRARY, SEASON_PROFILES, eventFromCard } from "../src/flow/model/seasons.ts";
import { buildView } from "../src/flow/model/view.ts";
import {
  defaultMaturityForPersona,
  maturityHeadlines,
  personaDef,
  type InspectorTabId,
} from "../src/flow/model/personas.ts";
import { FLOW_CSS } from "../src/flow/server/page.ts";
import {
  computeBundledStreams,
  computeSpotlightView,
  computeSubsystemScope,
  projectGraphThroughXRayLens,
  renderCapabilityMapSvg,
  renderIcomProcessOverlayHtml,
  shouldShowMechanismPills,
  zoomLevelForPercent,
} from "../src/flow/client/canvas.ts";
import {
  buildStudioGraphState,
  renderInspectorZone,
  renderNavigatorZone,
  renderTimelineBranchZone,
  searchEntities,
} from "../src/flow/client/inspector.ts";
import { withLocale } from "../src/flow/i18n/index.ts";
import {
  analyzeGaps,
  applyCapabilityTemplate,
  applyOptimisticPatch,
  buildBalanceSheet,
  buildBusinessCapabilitiesFromTemplate,
  buildCashFlowStatement,
  buildFinancialStatements,
  buildIncomeStatement,
  buildRegistry,
  CAPABILITY_TEMPLATES,
  closeNominalAccounts,
  combinePhysicsOutputs,
  compileGenesisSpec,
  createDefaultAccounts,
  createEmptyLedger,
  deterministicHash,
  evaluatePhysicsModule,
  getPendingOptimisticPatches,
  migrateMoleculeToGraph,
  postJournal,
  rollbackOptimisticPatch,
  runShadowPreviewWithDefaults,
  setRootScope,
  simulateGraph,
  validateGraph,
  verifyLedgerInvariants,
  type EnterpriseGraph,
  type EntityURI,
  type UniversalEnterpriseNode,
  type UniversalGenesisSpec,
} from "../src/flow/graph/index.ts";
import {
  createOptimisticDraftFromIntent,
  parseGraphIntent,
} from "../src/flow/model/intent.ts";
import {
  CAPABILITY_TEMPLATE_LIST,
  EXPERT_SERVICE_CAPABILITY_TEMPLATE,
  PHYSICAL_PRODUCT_CAPABILITY_TEMPLATE,
  RECURRING_DIGITAL_CAPABILITY_TEMPLATE,
} from "../src/flow/graph/capabilities/index.ts";
import {
  compileArchitectSpec,
  compileFastTrack,
  ideaToGenesisSpec,
  moleculeToGenesisSpec,
  statementToGenesisSpec,
} from "../src/flow/model/genesis.ts";
import {
  buildGraphLaunchpadView,
  checklistView,
  emptyChecklist,
  resolveGraphBindings,
  toggleGraphLaunchpadItem,
} from "../src/flow/model/launchpad.ts";
import { renderLaunchpad } from "../src/flow/client/launchpad.ts";

const relError = (a: number, b: number): number => {
  const diff = Math.abs(a - b);
  if (diff <= 1e-6) return 0;
  const denom = Math.max(Math.abs(a), Math.abs(b), 1);
  return diff / denom;
};

const assertWithinHalfPercent = (actual: number, expected: number, label: string): void => {
  const err = relError(actual, expected);
  assert.ok(
    err <= 0.005,
    `${label}: ero ${(err * 100).toFixed(4)} % ylittää 0,5 % rajan (saatiin ${actual}, odotettiin ${expected})`,
  );
};

describe("Tarkistuspiste 1 — Golden-testit (vanha ydin vs. v3.2 graafimoottori)", () => {
  const presets: PresetId[] = ["it_consultant", "food_kiosk", "saas_hybrid", "webshop"];

  for (const presetId of presets) {
    it(`1. Golden-vertailu (${presetId}): kuukausitulos, kassa, tase ja kassan loppumispäivä täsmäävät <= 0,5 %`, () => {
      const mol = createPreset(presetId);
      const legacy = simulate(mol);
      const graph = migrateMoleculeToGraph(mol);

      const validation = validateGraph(graph);
      assert.equal(validation.valid, true, `Graafin validointi epäonnistui: ${validation.errors.join("; ")}`);

      const run = simulateGraph(graph, { registry: validation.registry });
      assert.deepEqual(run.invariantErrors, [], `Invarianttivirheitä: ${run.invariantErrors.join("; ")}`);

      assert.equal(run.months.length, legacy.months.length);
      assert.equal(run.days.length, legacy.days.length);
      assertWithinHalfPercent(run.openingCash, legacy.openingCash, `${presetId}.openingCash`);
      assertWithinHalfPercent(run.endCash, legacy.endCash, `${presetId}.endCash`);
      assertWithinHalfPercent(run.minCash, legacy.minCash, `${presetId}.minCash`);
      assert.equal(run.cashOutDay, legacy.cashOutDay, `${presetId}.cashOutDay`);
      assertWithinHalfPercent(run.totals.revenue, legacy.totals.revenue, `${presetId}.totals.revenue`);
      assertWithinHalfPercent(
        run.totals.variableCosts,
        legacy.totals.variableCosts,
        `${presetId}.totals.variableCosts`,
      );
      assertWithinHalfPercent(run.totals.fixedCosts, legacy.totals.fixedCosts, `${presetId}.totals.fixedCosts`);
      assertWithinHalfPercent(
        run.totals.operatingProfit,
        legacy.totals.operatingProfit,
        `${presetId}.totals.operatingProfit`,
      );
      assert.ok(Math.abs(run.reconciliationError) <= 1e-6, `${presetId}.reconciliationError != 0`);

      for (let m = 0; m < legacy.months.length; m += 1) {
        const gm = run.months[m];
        const lm = legacy.months[m];
        assertWithinHalfPercent(gm.revenue, lm.revenue, `${presetId} kk ${m + 1} revenue`);
        assertWithinHalfPercent(gm.variableCosts, lm.variableCosts, `${presetId} kk ${m + 1} variableCosts`);
        assertWithinHalfPercent(gm.fixedCosts, lm.fixedCosts, `${presetId} kk ${m + 1} fixedCosts`);
        assertWithinHalfPercent(gm.operatingProfit, lm.operatingProfit, `${presetId} kk ${m + 1} operatingProfit`);
        assertWithinHalfPercent(gm.endCash, lm.endCash, `${presetId} kk ${m + 1} endCash`);
        assertWithinHalfPercent(gm.endReceivables, lm.endReceivables, `${presetId} kk ${m + 1} endReceivables`);
        assertWithinHalfPercent(gm.endPayables, lm.endPayables, `${presetId} kk ${m + 1} endPayables`);
        assertWithinHalfPercent(gm.inventory, lm.inventory, `${presetId} kk ${m + 1} inventory`);
        assert.equal(
          run.monthlyStatements[m].balanceSheet.balanced,
          true,
          `${presetId} kk ${m + 1} tase ei täsmää`,
        );
        assert.equal(
          run.monthlyStatements[m].cashFlow.reconciles,
          true,
          `${presetId} kk ${m + 1} kassavirta ei täsmää`,
        );
      }
    });
  }

  it("2. Golden-vertailu sesonkivaihtelulla ja kriisitapahtumilla", () => {
    const base = createPreset("saas_hybrid");
    const crisis = eventFromCard(CRISIS_LIBRARY[0], 2);
    const mol = {
      ...base,
      seasonality: [...SEASON_PROFILES.summer.factors],
      startMonth: 1,
      events: [crisis],
    };
    const legacy = simulate(mol);
    const graph = migrateMoleculeToGraph(mol);
    const run = simulateGraph(graph);

    assert.deepEqual(run.invariantErrors, []);
    assertWithinHalfPercent(run.endCash, legacy.endCash, "seasonal+crisis endCash");
    assertWithinHalfPercent(run.totals.operatingProfit, legacy.totals.operatingProfit, "seasonal+crisis profit");
    for (let m = 0; m < legacy.months.length; m += 1) {
      assertWithinHalfPercent(run.months[m].operatingProfit, legacy.months[m].operatingProfit, `kk ${m}`);
      assertWithinHalfPercent(run.months[m].endCash, legacy.months[m].endCash, `kk ${m} cash`);
    }
  });
});

describe("Tarkistuspiste 1 — Invariantti A1, Yliajo 3 & Pääkirja (ledger.ts)", () => {
  it("3. A1-testi: kaikki solmut ovat UniversalEnterpriseNode-tyyppiä ja jokaisella defined-lehdellä on >= 1 PhysicsModule", () => {
    for (const id of ["it_consultant", "food_kiosk", "saas_hybrid", "webshop"] as const) {
      const g = migrateMoleculeToGraph(createPreset(id));
      const nodes = Object.values(g.nodes);
      assert.ok(nodes.length >= 2);
      for (const n of nodes) {
        assert.ok(n.uri.startsWith("apex://node/"));
        assert.ok(Array.isArray(n.ports));
        assert.ok(Array.isArray(n.mechanisms));
        if (n.children.length === 0 && (n.definition ?? "defined") === "defined") {
          assert.ok(Array.isArray(n.physics) && n.physics.length >= 1, `Lehtisolmulta ${n.uri} puuttuu physics`);
        }
      }
    }
    // Myös tyhjä molekyyli tuottaa kelvollisen graafin
    const emptyG = migrateMoleculeToGraph(emptyMolecule());
    assert.equal(validateGraph(emptyG).valid, true);
  });

  it("4. Yliajo 3: maksuaika (credit_working_capital) ei kasvata operatiivista cycleTicks-aikaa eikä rajoita kapasiteettia", () => {
    const resolve = (ref: { const: number } | { factor: EntityURI } | undefined, fb = 0) =>
      ref && "const" in ref ? ref.const : fb;

    const timeOut = evaluatePhysicsModule(
      {
        atom: "time_capacity",
        params: {
          capacityPerTick: { const: 40 },
          cycleTicks: { const: 3 },
          firstPassYield: { const: 0.95 },
          variableCost: { const: 10 },
          fixedCostPerTick: { const: 50 },
        },
      },
      resolve,
    );
    const creditOut = evaluatePhysicsModule(
      {
        atom: "credit_working_capital",
        params: {
          customerTermsDays: { const: 45 },
          supplierTermsDays: { const: 30 },
          fixedCostPerMonth: { const: 300 },
        },
      },
      resolve,
    );

    assert.equal(creditOut.cycleTicks, 0, "credit_working_capital cycleTicks täytyy olla 0");
    assert.equal(creditOut.capacityPerTick, Number.POSITIVE_INFINITY);
    assert.equal(creditOut.cash?.[0]?.delayTicks, 45);

    const combined = combinePhysicsOutputs([timeOut, creditOut]);
    assert.equal(combined.capacityPerTick, 40);
    assert.equal(combined.cycleTicks, 3, "yhdistetty cycleTicks säilyy 3 päivänä (ei 48)");
    assert.equal(combined.firstPassYield, 0.95);
    assert.equal(combined.variableCost, 10);
    assert.equal(combined.fixedCostPerTick, 60);
    assert.equal(combined.cash?.[0]?.delayTicks, 45);
  });

  it("5. Pääkirja (ledger.ts): Debet === Kredit, epätasapainoinen kirjaus hylätään ja tilinpäätös täsmää", () => {
    const accounts = createDefaultAccounts();
    const ledger = createEmptyLedger(accounts, 10000, { inventory_raw: 2000 });
    assert.deepEqual(verifyLedgerInvariants(ledger, accounts), []);

    assert.throws(
      () =>
        postJournal(ledger, {
          tick: 1,
          memo: "Virheellinen kirjaus",
          source: "test",
          lines: [
            { account: "cash", amount: 500 },
            { account: "revenue_product", amount: -400 },
          ],
        }),
      /Unbalanced journal entry/,
    );

    postJournal(
      ledger,
      {
        tick: 1,
        memo: "Myynti",
        source: "test",
        lines: [
          { account: "apex://account/accounts_receivable", amount: 1500 },
          { account: "apex://account/revenue_product", amount: -1500 },
        ],
      },
      accounts,
    );
    postJournal(
      ledger,
      {
        tick: 2,
        memo: "Kulu",
        source: "test",
        cashFlow: "operating",
        lines: [
          { account: "cogs_product", amount: 600 },
          { account: "cash", amount: -600 },
        ],
      },
      accounts,
    );

    const is = buildIncomeStatement(ledger, accounts);
    assert.equal(is.netRevenue, 1500);
    assert.equal(is.cogs.total, 600);
    assert.equal(is.netIncome, 900);

    const bs = buildBalanceSheet(ledger, accounts);
    assert.equal(bs.balanced, true);
    assert.equal(bs.assets.total, 10000 - 600 + 1500 + 2000);
    assert.equal(bs.equity.total, 12000 + 900);

    const cf = buildCashFlowStatement(ledger);
    assert.equal(cf.reconciles, true);
    assert.equal(cf.endCash, 9400);

    closeNominalAccounts(ledger, 30, 0, accounts);
    const fsAfterClose = buildFinancialStatements(ledger, accounts);
    assert.equal(fsAfterClose.incomeStatement.netIncome, 0, "tulostilit nollattu tilinpäätöksessä");
    assert.equal(fsAfterClose.balanceSheet.balanced, true);
    assert.equal(fsAfterClose.balanceSheet.equity.retainedEarnings, 900);
  });
});

describe("Tarkistuspiste 1 — Monitasoinen prosessigraafi, Mekanismit, Massatase, Rollup & Keskeneräisyys", () => {
  function buildMultiStageGraph(): EnterpriseGraph {
    const accounts = createDefaultAccounts();
    const rootUri: EntityURI = "apex://node/root";
    const groupUri: EntityURI = "apex://node/fulfillment_group";
    const stage1Uri: EntityURI = "apex://node/stage_intake";
    const stage2Uri: EntityURI = "apex://node/stage_delivery";
    const ghostUri: EntityURI = "apex://node/stage_draft_ghost";
    const namedUri: EntityURI = "apex://node/stage_named_future";
    const downstreamOfNamedUri: EntityURI = "apex://node/stage_waiting";
    const unitUri: EntityURI = "apex://unit/work_orders";

    const nodes: Record<string, UniversalEnterpriseNode> = {
      [rootUri]: {
        uri: rootUri,
        name: "Enterprise Root",
        level: 0,
        band: "value_stream",
        definition: "defined",
        tags: [],
        parent: null,
        children: [groupUri, ghostUri, namedUri, downstreamOfNamedUri],
        ports: [],
        mechanisms: [],
        ledgerBindings: [],
        kpis: [],
      },
      [groupUri]: {
        uri: groupUri,
        name: "Core Value Group",
        level: 1,
        band: "value_stream",
        definition: "defined",
        tags: [],
        parent: rootUri,
        children: [stage1Uri, stage2Uri],
        ports: [],
        mechanisms: [],
        ledgerBindings: [],
        kpis: [],
      },
      [stage1Uri]: {
        uri: stage1Uri,
        name: "Stage 1 Intake",
        level: 2,
        band: "value_stream",
        definition: "defined",
        tags: [],
        parent: groupUri,
        children: [],
        ports: [
          { id: "in", name: "In", side: "I", unit: unitUri, ratio: { const: 1 } },
          { id: "out", name: "Out", side: "O", unit: unitUri, ratio: { const: 1 }, role: "primary" },
        ],
        physics: [
          {
            atom: "time_capacity",
            params: {
              capacityPerTick: { factor: "apex://factor/stage1_cap" },
              demandPerTick: { const: 50 },
              cycleTicks: { const: 2 },
              firstPassYield: { const: 0.9 },
              variableCost: { const: 4 },
              fixedCostPerTick: { const: 10 },
            },
          },
        ],
        mechanisms: [
          {
            capability: "apex://role/operator",
            critical: true,
            fallbackMultiplier: { const: 0 },
          },
          {
            capability: "apex://system/workflow_engine",
            modifiers: { throughput: { const: 1.2 }, variableCost: { const: 0.9 } },
            rollout: { startTick: 0, leadTicks: 2, dipDepth: { const: 0.25 }, dipTicks: 3 },
            critical: true,
            fallbackMultiplier: { const: 0.2 },
          },
        ],
        ledgerBindings: [],
        kpis: [],
      },
      [stage2Uri]: {
        uri: stage2Uri,
        name: "Stage 2 Fulfillment",
        level: 2,
        band: "value_stream",
        definition: "defined",
        tags: [],
        parent: groupUri,
        children: [],
        ports: [
          { id: "in", name: "In", side: "I", unit: unitUri, ratio: { const: 1 } },
          { id: "out", name: "Out", side: "O", unit: unitUri, ratio: { const: 1 }, role: "primary" },
        ],
        physics: [
          {
            atom: "time_capacity",
            params: {
              capacityPerTick: { const: 30 },
              cycleTicks: { const: 3 },
              firstPassYield: { const: 0.95 },
              variableCost: { const: 6 },
              fixedCostPerTick: { const: 15 },
              unitPrice: { const: 40 },
            },
          },
          {
            atom: "credit_working_capital",
            params: {
              customerTermsDays: { const: 5 },
              supplierTermsDays: { const: 3 },
            },
          },
        ],
        buffer: {
          maxUnits: { const: 500 },
          holdingCostPerUnit: { const: 0.5 },
          initialUnits: { const: 20 },
          reorder: {
            trigger: { const: 5 },
            target: { const: 25 },
            source: stage1Uri,
          },
        },
        mechanisms: [],
        ledgerBindings: [],
        kpis: [],
      },
      [ghostUri]: {
        uri: ghostUri,
        name: "Draft Ghost Node",
        level: 1,
        band: "value_stream",
        definition: "named",
        ghost: { patchId: "patch-1", status: "pending", requestedAt: 1000 },
        tags: [],
        parent: rootUri,
        children: [],
        ports: [{ id: "out", name: "Out", side: "O", unit: unitUri, ratio: { const: 1 } }],
        physics: [
          {
            atom: "time_capacity",
            params: {
              capacityPerTick: { const: 999 },
              unitPrice: { const: 999 },
              fixedCostPerTick: { const: 999 },
            },
          },
        ],
        mechanisms: [],
        ledgerBindings: [],
        kpis: [],
      },
      [namedUri]: {
        uri: namedUri,
        name: "Unconfigured Upstream Node",
        level: 1,
        band: "value_stream",
        definition: "named",
        tags: [],
        parent: rootUri,
        children: [],
        ports: [{ id: "out", name: "Out", side: "O", unit: unitUri, ratio: { const: 1 } }],
        mechanisms: [],
        ledgerBindings: [],
        kpis: [],
      },
      [downstreamOfNamedUri]: {
        uri: downstreamOfNamedUri,
        name: "Downstream Waiting Node",
        level: 1,
        band: "value_stream",
        definition: "defined",
        tags: [],
        parent: rootUri,
        children: [],
        ports: [
          { id: "in", name: "In", side: "I", unit: unitUri, ratio: { const: 1 } },
          { id: "out", name: "Out", side: "O", unit: unitUri, ratio: { const: 1 } },
        ],
        physics: [
          {
            atom: "time_capacity",
            params: {
              capacityPerTick: { const: 50 },
              unitPrice: { const: 100 },
              fixedCostPerTick: { const: 25 },
            },
          },
        ],
        mechanisms: [],
        ledgerBindings: [],
        kpis: [],
      },
    };

    return {
      version: 3,
      maturity: 3,
      id: "multi-stage",
      name: "Multi-Stage Process Graph",
      root: rootUri,
      tick: { resolution: "day", horizon: 30, startCalendarMonth: 0, payrollDayOfMonth: 15 },
      currency: "EUR",
      nodes,
      streams: {
        "apex://stream/s1_to_s2": {
          uri: "apex://stream/s1_to_s2",
          name: "Intake to Delivery",
          parent: "apex://stream/composite_bundle",
          children: [],
          from: { node: stage1Uri, port: "out" },
          to: { node: stage2Uri, port: "in" },
          unit: unitUri,
          routing: { kind: "direct" },
          latencyTicks: { const: 2 },
          lossRate: { const: 0.05 },
          transferCost: { const: 1 },
        },
        "apex://stream/composite_bundle": {
          uri: "apex://stream/composite_bundle",
          name: "Bundled Value Stream",
          parent: null,
          children: ["apex://stream/s1_to_s2"],
          from: { node: stage1Uri, port: "out" },
          to: { node: stage2Uri, port: "in" },
          unit: unitUri,
          routing: { kind: "direct" },
          latencyTicks: { const: 0 },
          lossRate: { const: 0 },
          transferCost: { const: 0 },
        },
        "apex://stream/named_to_waiting": {
          uri: "apex://stream/named_to_waiting",
          name: "Undefined Upstream Link",
          parent: null,
          children: [],
          from: { node: namedUri, port: "out" },
          to: { node: downstreamOfNamedUri, port: "in" },
          unit: unitUri,
          routing: { kind: "direct" },
          latencyTicks: { const: 0 },
          lossRate: { const: 0 },
          transferCost: { const: 0 },
        },
      },
      units: {
        [unitUri]: {
          uri: unitUri,
          name: "Work Orders",
          nature: "discrete",
          measure: "ord",
          decayPerTick: { const: 0.02 },
        },
        "apex://unit/monetary": {
          uri: "apex://unit/monetary",
          name: "Currency",
          nature: "monetary",
          measure: "EUR",
          decayPerTick: { const: 0 },
        },
      },
      factors: {
        "apex://factor/base_cap": {
          uri: "apex://factor/base_cap",
          name: "Base Capacity",
          alias: "base_cap",
          kind: "lever",
          value: 20,
          unit: "ord/d",
        },
        "apex://factor/stage1_cap": {
          uri: "apex://factor/stage1_cap",
          name: "Stage 1 Formula Capacity",
          alias: "stage1_cap",
          kind: "formula",
          value: 40,
          unit: "ord/d",
          formula: "base_cap * 2",
          temporal: [{ periodTicks: 10, amplitude: 0.1, phaseTicks: 0 }],
        },
      },
      capabilities: {
        "apex://role/operator": {
          kind: "role",
          uri: "apex://role/operator",
          name: "Process Specialist",
          orgUnit: "apex://unit-org/ops",
          fte: { const: 6 },
          costPerFtePerTick: { const: 100 },
          hoursPerFtePerTick: { const: 8 },
          proficiency: { const: 1 },
        },
        "apex://system/workflow_engine": {
          kind: "system",
          uri: "apex://system/workflow_engine",
          name: "Workflow Automation",
          layer: "workflow",
          fixedCostPerTick: { const: 20 },
          capex: { const: 1000 },
          availability: { const: 1 },
        },
      },
      accounts,
      opening: { cash: 25000, balances: {} },
      events: [
        {
          id: "sys-outage",
          title: "Temporary System Outage",
          startTick: 10,
          durationTicks: 2,
          target: "apex://system/workflow_engine",
          availabilityOverride: 0,
        },
      ],
    };
  }

  it("6. Invariantit 1–6, massatase, koostevirrat, rollupit, keskeneräiset/ghost-solmut ja stub-virrat", () => {
    const graph = buildMultiStageGraph();
    const val = validateGraph(graph);
    assert.equal(val.valid, true, `Validointivirheitä: ${val.errors.join("; ")}`);

    // Käänteisindeksi (usedBy) löytää riippuvuudet
    assert.ok(val.registry.usedBy.get("apex://factor/base_cap")?.has("apex://factor/stage1_cap"));
    assert.ok(val.registry.usedBy.get("apex://role/operator")?.has("apex://node/stage_intake"));

    const run = simulateGraph(graph, { registry: val.registry });
    assert.deepEqual(run.invariantErrors, [], `Invarianttivirheitä: ${run.invariantErrors.join("; ")}`);

    // Massatase (Invariantti 3): residual === 0
    const mb = run.unitMassBalances["apex://unit/work_orders"];
    assert.ok(mb);
    assert.ok(mb.inflow > 0);
    assert.ok(mb.outflow > 0);
    assert.ok(mb.loss > 0);
    assert.ok(mb.decay > 0);
    assert.ok(Math.abs(mb.residual) <= 1e-6, `Massatase ei täsmää: residual=${mb.residual}`);

    // Koostevirran niputus: composite_bundle === s1_to_s2
    const leafStream = run.streamStates["apex://stream/s1_to_s2"];
    const compStream = run.streamStates["apex://stream/composite_bundle"];
    assert.ok(leafStream.sent > 0);
    assert.equal(compStream.sent, leafStream.sent);
    assert.equal(compStream.delivered, leafStream.delivered);
    assert.equal(compStream.loss, leafStream.loss);

    // Keskeneräisten ja Ghost-solmujen käsittely (Override 4 & Invariantti 6)
    const ghostState = run.nodeStates["apex://node/stage_draft_ghost"];
    assert.equal(ghostState.computed, false);
    assert.equal(ghostState.skipReason, "ghost_pending");
    assert.equal(ghostState.revenue, 0);
    assert.equal(ghostState.fixedCost, 0);

    const namedState = run.nodeStates["apex://node/stage_named_future"];
    assert.equal(namedState.computed, false);
    assert.equal(namedState.skipReason, "undefined_node");

    const stubEdge = run.streamStates["apex://stream/named_to_waiting"];
    assert.equal(stubEdge.status, "stub");
    assert.equal(stubEdge.stubReason, "not_computed_upstream_undefined");
    assert.ok(run.stubStreams.some((s) => s.uri === "apex://stream/named_to_waiting"));

    const waitingState = run.nodeStates["apex://node/stage_waiting"];
    assert.equal(waitingState.upstreamStub, true);
    assert.equal(waitingState.revenue, 0, "stub-syötettä odottava solmu ei laske harhaanjohtavaa nollakysyntää/kuluja");
    assert.ok(run.upstreamWaitingNodes.some((w) => w.uri === "apex://node/stage_waiting"));

    // Koostesolmun rollup (Invariantti 4)
    const groupState = run.nodeStates["apex://node/fulfillment_group"];
    const s1 = run.nodeStates["apex://node/stage_intake"];
    const s2 = run.nodeStates["apex://node/stage_delivery"];
    assert.ok(Math.abs(groupState.revenue - (s1.revenue + s2.revenue)) <= 1e-6);
    assert.ok(Math.abs(groupState.variableCost - (s1.variableCost + s2.variableCost)) <= 1e-6);
    assert.ok(Math.abs(groupState.fixedCost - (s1.fixedCost + s2.fixedCost)) <= 1e-6);

    // Determinismi (Invariantti 5)
    const run2 = simulateGraph(graph);
    assert.equal(run.endCash, run2.endCash);
    assert.deepEqual(run.months, run2.months);
  });

  it("7. Kypsyystasot 0 ja 1 (P9): taso 0 estää prosessisolmut ja ohittaa simulaation", () => {
    const base = migrateMoleculeToGraph(createPreset("it_consultant"));
    const invalidLevel0: EnterpriseGraph = { ...base, maturity: 0 };
    assert.equal(
      validateGraph(invalidLevel0).valid,
      false,
      "Taso 0 -mallissa ei saa olla prosessisolmuja L0-juuren lisäksi",
    );

    const validLevel0: EnterpriseGraph = {
      ...base,
      maturity: 0,
      nodes: {
        [base.root]: {
          ...base.nodes[base.root],
          children: [],
          ports: [],
        },
      },
      streams: {},
      businessCapabilities: {
        "apex://capability-biz/product_dev": {
          uri: "apex://capability-biz/product_dev",
          name: "Product Development",
          status: "unclear",
          dependsOn: [],
          notes: [{ kind: "question", text: "Safety assessment required" }],
          realizedBy: [],
          provenance: "user",
        },
      },
    };
    assert.equal(validateGraph(validLevel0).valid, true);
    const run0 = simulateGraph(validLevel0);
    assert.equal(run0.maturityGated, true);
    assert.equal(run0.months.length, 0);
    assert.equal(run0.endCash, validLevel0.opening.cash);
  });
});

describe("Tarkistuspiste 1 — Suorituskykybudjetti (A4), Toimiala-agnostisuus (P1) & Type-Stripping", () => {
  it("8. A4 Nopeus 1 -testi: 300 lehtisolmua x 360 tickiä suoriutuu < 16 ms", () => {
    const accounts = createDefaultAccounts();
    const rootUri: EntityURI = "apex://node/root";
    const nodes: Record<string, UniversalEnterpriseNode> = {};
    const children: EntityURI[] = [];

    for (let i = 0; i < 300; i += 1) {
      const u: EntityURI = `apex://node/leaf_${i}`;
      children.push(u);
      nodes[u] = {
        uri: u,
        name: `Process Unit ${i}`,
        level: 1,
        band: "value_stream",
        definition: "defined",
        tags: [],
        parent: rootUri,
        children: [],
        ports: [
          { id: "in", name: "In", side: "I", unit: "apex://unit/items", ratio: { const: 1 } },
          { id: "out", name: "Out", side: "O", unit: "apex://unit/items", ratio: { const: 1 }, role: "primary" },
        ],
        physics: [
          {
            atom: "physical_matter",
            params: {
              unitsPerMonth: { const: 120 },
              unitPrice: { const: 25 },
              unitCost: { const: 10 },
              spoilageRate: { const: 0.02 },
              stockCoverDays: { const: 0 },
              capacityUnitsPerMonth: { const: 150 },
            },
          },
          {
            atom: "credit_working_capital",
            params: {
              customerTermsDays: { const: 14 },
              supplierTermsDays: { const: 14 },
            },
          },
        ],
        mechanisms: [],
        ledgerBindings: [],
        kpis: [],
      };
    }

    nodes[rootUri] = {
      uri: rootUri,
      name: "Large Enterprise",
      level: 0,
      band: "value_stream",
      definition: "defined",
      tags: [],
      parent: null,
      children,
      ports: [],
      mechanisms: [],
      ledgerBindings: [],
      kpis: [],
    };

    const largeGraph: EnterpriseGraph = {
      version: 3,
      maturity: 3,
      id: "perf-300",
      name: "300 Leaf Benchmark",
      root: rootUri,
      tick: { resolution: "day", horizon: 360, startCalendarMonth: 0, payrollDayOfMonth: 15 },
      currency: "EUR",
      nodes,
      streams: {},
      units: {
        "apex://unit/items": {
          uri: "apex://unit/items",
          name: "Units",
          nature: "discrete",
          measure: "pcs",
          decayPerTick: { const: 0 },
        },
        "apex://unit/monetary": {
          uri: "apex://unit/monetary",
          name: "Currency",
          nature: "monetary",
          measure: "EUR",
          decayPerTick: { const: 0 },
        },
      },
      factors: {},
      capabilities: {},
      accounts,
      opening: { cash: 100000, balances: {} },
      events: [],
    };

    const registry = buildRegistry(largeGraph);
    // Warmup JIT
    simulateGraph(largeGraph, { registry });

    const t0 = performance.now();
    const run = simulateGraph(largeGraph, { registry });
    const elapsedMs = performance.now() - t0;

    assert.equal(run.days.length, 360);
    assert.deepEqual(run.invariantErrors, []);
    assert.ok(
      elapsedMs < 16,
      `300 lehtisolmua x 360 tickiä kesti ${elapsedMs.toFixed(2)} ms (budjetti < 16 ms)`,
    );
  });

  it("9. P1 Toimiala-agnostisuustesti & Type-Stripping: src/flow/graph/ ei sisällä toimialasanoja eikä enumeja", () => {
    const graphDir = path.resolve("src/flow/graph");
    const files = fs.readdirSync(graphDir).filter((f) => f.endsWith(".ts"));
    assert.ok(files.length >= 5);

    const forbiddenWords = [
      "restaurant",
      "nakkikioski",
      "saas",
      "consulting",
      "factory",
      "pos",
      "crm",
      "erp",
      "summer_peak",
      "food_kiosk",
      "it_consultant",
      "saas_hybrid",
      "webshop",
    ];
    const forbiddenRe = new RegExp(`\\b(${forbiddenWords.join("|")})\\b`, "i");
    const strip = (
      nodeModule as unknown as {
        stripTypeScriptTypes?: (code: string, opts?: { mode?: "strip" }) => string;
      }
    ).stripTypeScriptTypes;
    assert.ok(strip, "Node stripTypeScriptTypes vaaditaan");

    for (const file of files) {
      const fullPath = path.join(graphDir, file);
      const src = fs.readFileSync(fullPath, "utf-8");

      const match = forbiddenRe.exec(src);
      assert.equal(
        match,
        null,
        `Tiedostossa src/flow/graph/${file} on kielletty toimialasana: "${match?.[0]}"`,
      );

      assert.equal(
        /\b(?:enum|namespace)\b/.test(src),
        false,
        `Tiedostossa src/flow/graph/${file} on kielletty enum tai namespace`,
      );

      const js = strip!(src, { mode: "strip" });
      assert.ok(js.length > 0, `src/flow/graph/${file} ei kääntynyt stripTypeScriptTypes-funktiolla`);
    }
  });
});

describe("Tarkistuspiste 2 (Checkpoint V1) — Unified Studio Shell, Classic-telemetria, 4 X-Ray-linssiä, Kypsyystasot 0–3 & Spotlight (Invariantti A3)", () => {
  it("10. Väri- ja typografiatokenit (TSD 2.2): FLOW_CSS sisältää tumman instituutioteeman, tilatokenit, ArchiMate-domain-tokenit ja tabular-nums", () => {
    const requiredTokens = [
      "--bg-deep:#060b16",
      "--bg-panel:#0c1426",
      "--bg-card:#111c33",
      "--bg-hover:#172544",
      "--border:#1e2d4a",
      "--border-bright:#38bdf8",
      "--text-main:#f1f5f9",
      "--text-muted:#94a3b8",
      "--text-dim:#64748b",
      "--font-sans:",
      "--font-mono:",
      "--st-healthy:#10b981",
      "--st-warning:#f59e0b",
      "--st-critical:#ef4444",
      "--dom-demand:#38bdf8",
      "--dom-value:#60a5fa",
      "--dom-enabling:#818cf8",
      "--dom-application:#a78bfa",
      "--dom-finance:#34d399",
      "--dom-people:#f472b6",
      "font-variant-numeric:tabular-nums",
    ];
    for (const token of requiredTokens) {
      assert.ok(FLOW_CSS.includes(token), `FLOW_CSS puuttuu token: ${token}`);
    }
  });

  it("11. Persoonien oletuskypsyystasot, Kypsyystasot 0–1 (BusinessCapability-kartta + vaje-KPI:t) ja Kypsyystasot 2–3", () => {
    assert.equal(defaultMaturityForPersona("founder", true), 0);
    assert.equal(defaultMaturityForPersona("student", true), 3);
    assert.equal(defaultMaturityForPersona("student", false), 0);
    assert.equal(defaultMaturityForPersona("owner", true), 3);
    assert.equal(defaultMaturityForPersona("director", true), 3);
    assert.equal(defaultMaturityForPersona("ceo", true), 3);
    assert.equal(defaultMaturityForPersona("advisor", true), 3);
    assert.equal(defaultMaturityForPersona("investor", true), 3);

    const mol = createPreset("it_consultant");
    const st0 = buildStudioGraphState(mol, 0);
    assert.equal(st0.graph.maturity, 0);
    assert.equal(st0.run.maturityGated, true);
    assert.equal(validateGraph(st0.graph).valid, true);

    const hl0 = maturityHeadlines(st0.graph, st0.run);
    assert.equal(hl0.length, 3);
    assert.ok(hl0[0]!.label.includes("Kyvykkyysvajeet"));

    const capMapHtml = renderCapabilityMapSvg(st0.graph);
    assert.ok(capMapHtml.includes("BusinessCapability Map"));
    assert.ok(capMapHtml.includes("cap-card-known"));
    assert.ok(capMapHtml.includes("cap-card-unclear"));
    assert.ok(capMapHtml.includes("cap-card-missing"));

    // Taso 1 näyttää kyvykkyyskartan myös renderIcomProcessOverlayHtml-kutsussa
    const overlay1 = renderIcomProcessOverlayHtml(st0.graph, st0.run, {
      zoomPct: 45,
      xrayLens: "ops",
      selectedUri: "apex://capability-biz/customer_demand_validation",
      spotlightParentUri: null,
    });
    assert.ok(overlay1.includes("capability-map-stage"));
  });

  it("12. Semanttinen zoom, Spotlight-eristys (3–7 alisolmua, +N muuta, muiden osastojen lapset pois DOM:sta) ja Natural Capability Zoom (Invariantti A3)", () => {
    assert.equal(zoomLevelForPercent(15), 0);
    assert.equal(zoomLevelForPercent(45), 1);
    assert.equal(zoomLevelForPercent(80), 2);

    // Natural Capability Zoom: M-portin pillerit piilossa L0–L1 oletuslinsseissä, näkyvissä L2+ tai it/org-linssissä
    assert.equal(shouldShowMechanismPills(0, "ops"), false);
    assert.equal(shouldShowMechanismPills(1, "ops"), false);
    assert.equal(shouldShowMechanismPills(1, "financial"), false);
    assert.equal(shouldShowMechanismPills(2, "ops"), true);
    assert.equal(shouldShowMechanismPills(1, "it"), true);
    assert.equal(shouldShowMechanismPills(1, "org"), true);

    const mol = createPreset("saas_hybrid");
    const firstAtomNodeUri = `apex://node/${mol.atoms[0]!.id}` as const;
    const secondAtomNodeUri = `apex://node/${mol.atoms[1]!.id}` as const;

    // Pilkotaan molemmat L1-osastot L2-lapsiksi, jotta voimme varmistaa, että vain Spotlight-solmun lapset päätyvät DOM:iin
    const st = buildStudioGraphState(mol, 3, [firstAtomNodeUri, secondAtomNodeUri]);
    const baselineCash = st.run.endCash;
    const baselineProfit = st.run.totals.operatingProfit;

    // L1 ops-linssi: M-portin pillereitä EI renderöidä DOM:iin
    const l1OpsHtml = renderIcomProcessOverlayHtml(st.graph, st.run, {
      zoomPct: 45,
      xrayLens: "ops",
      selectedUri: firstAtomNodeUri,
      spotlightParentUri: null,
    });
    assert.equal(l1OpsHtml.includes("data-mech-strip"), false);

    // L1 it-linssi: M-portin pillerit renderöidään
    const l1ItHtml = renderIcomProcessOverlayHtml(st.graph, st.run, {
      zoomPct: 45,
      xrayLens: "it",
      selectedUri: firstAtomNodeUri,
      spotlightParentUri: null,
    });
    assert.equal(l1ItHtml.includes("data-mech-strip"), true);

    // Spotlight avattuna firstAtomNodeUri:lle
    const sp = computeSpotlightView(st.graph, st.run, firstAtomNodeUri);
    assert.equal(sp.active, true);
    assert.ok(sp.visibleChildren.length >= 3 && sp.visibleChildren.length <= 7);

    // Toisen osaston (secondAtomNodeUri) sisäisiä L2-lapsia EI saa olla renderedDomNodeUris-joukossa eikä HTML:ssä!
    const siblingChildren = st.graph.nodes[secondAtomNodeUri]!.children;
    assert.ok(siblingChildren.length > 0);
    for (const sibChildUri of siblingChildren) {
      assert.equal(
        sp.renderedDomNodeUris.has(sibChildUri),
        false,
        `Toisen osaston lapsisolmu ${sibChildUri} vuoti Spotlight-DOM-joukkoon`,
      );
    }

    const spotlightHtml = renderIcomProcessOverlayHtml(st.graph, st.run, {
      zoomPct: 80,
      xrayLens: "ops",
      selectedUri: firstAtomNodeUri,
      spotlightParentUri: firstAtomNodeUri,
    });
    assert.ok(spotlightHtml.includes("spotlight-mode"));
    assert.ok(spotlightHtml.includes("opacity:0.15;pointer-events:none"));
    assert.equal(spotlightHtml.includes("data-mech-strip"), true);
    for (const sibChildUri of siblingChildren) {
      assert.equal(
        spotlightHtml.includes(`data-node-uri="${sibChildUri}"`),
        false,
        `Toisen osaston lapsisolmu ${sibChildUri} renderöityi DOM:iin Spotlight-tilassa`,
      );
    }

    // Yli 7 lapsisolmun ryhmittely "+N muuta" -solmuksi
    const parentNode = st.graph.nodes[firstAtomNodeUri]!;
    for (let extra = 1; extra <= 4; extra++) {
      const extraUri = `${firstAtomNodeUri}_extra_${extra}` as const;
      st.graph.nodes[extraUri] = {
        ...st.graph.nodes[parentNode.children[0]!]!,
        uri: extraUri,
        name: `Extra Step ${extra}`,
      };
      parentNode.children.push(extraUri);
    }
    assert.equal(parentNode.children.length, 9);
    const spOverflow = computeSpotlightView(st.graph, st.run, firstAtomNodeUri);
    assert.equal(spOverflow.visibleChildren.length, 7);
    const lastItem = spOverflow.visibleChildren[6]!;
    assert.equal(lastItem.isOverflowGroup, true);
    assert.equal(lastItem.overflowCount, 3);
    assert.ok(lastItem.name.includes("+3"));

    // Spotlight ei muuta simulaation tuloksia
    assert.equal(st.run.endCash, baselineCash);
    assert.equal(st.run.totals.operatingProfit, baselineProfit);

    // Stream bundling toimii näkyvien solmujen välillä
    const bundles = computeBundledStreams(st.graph, st.run, sp.renderedDomNodeUris, "financial");
    assert.ok(bundles.length > 0);
  });

  it("13. 5-vyöhykkeinen kuori (Zones 1, 2, 4, 5): globaali apex://-haku, 6-välilehtinen Inspector, Classic 3-statement & RACI ja Git-aikajana (FI & EN)", () => {
    const mol = createPreset("it_consultant");
    const view = buildView(mol);
    const st = buildStudioGraphState(mol, 3);
    const selectedUri = `apex://node/${mol.atoms[0]!.id}` as const;

    // Zone 1 · Globaali haku
    const roleHits = searchEntities(st.graph, st.registry, "apex://role/");
    assert.ok(roleHits.length >= 2);
    const accountHits = searchEntities(st.graph, st.registry, "apex://account/cash");
    assert.ok(accountHits.length >= 1);

    // Zone 2 · Navigaattori
    const navHtml = renderNavigatorZone(st, {
      selectedUri,
      spotlightParentUri: null,
      collapsed: false,
    });
    assert.ok(navHtml.includes("Zone 2"));
    assert.ok(navHtml.includes("apex://role/core_delivery_team"));
    assert.ok(navHtml.includes("apex://system/core_workflow_platform"));

    // Zone 4 · Kaikki 6 välilehteä (physics, finance, org, it, links, provenance) + Opi-laatikot
    const tabs: InspectorTabId[] = ["physics", "finance", "org", "it", "links", "provenance"];
    for (const tab of tabs) {
      const html = renderInspectorZone(st, view, {
        selectedUri,
        selectedNodeId: "demand",
        activeTab: tab,
        persona: "student",
        lens: "all",
        teach: true,
      });
      assert.ok(html.length > 200, `Inspector-välilehti ${tab} on tyhjä`);
      if (tab === "physics") {
        assert.ok(html.includes("L = λ · W"));
        assert.ok(html.includes("Opi:"));
      }
      if (tab === "finance") {
        assert.ok(html.includes("Income Statement"));
        assert.ok(html.includes("Balance Sheet"));
        assert.ok(html.includes("CCC"));
      }
      if (tab === "org") {
        assert.ok(html.includes("RACI"));
        assert.ok(html.includes("FTE"));
      }
      if (tab === "it") {
        assert.ok(html.includes("SLA"));
      }
      if (tab === "links") {
        assert.ok(html.includes("EntityRegistry.usedBy"));
        assert.ok(html.includes('data-action="focus-entity"'));
      }
      if (tab === "provenance") {
        assert.ok(html.includes("Provenance Audit"));
      }
    }

    // Persoonakohtainen välilehtijärjestys (Investor: finance ensin)
    assert.equal(personaDef("investor").inspectorTabs[0], "finance");

    // Zone 5 · Aikajana ja Git-skenaariohaarat (myös englanniksi)
    const tlFi = renderTimelineBranchZone(st, view, {
      hoverDay: 30,
      scenarios: [],
      compareScenarioId: null,
    });
    assert.ok(tlFi.includes("Nykyhetki (HEAD)"));
    assert.ok(tlFi.includes("P10"));
    assert.ok(tlFi.includes("P50"));
    assert.ok(tlFi.includes("P90"));

    const tlEn = withLocale("en", () =>
      renderTimelineBranchZone(st, view, {
        hoverDay: 30,
        scenarios: [],
        compareScenarioId: null,
      }),
    );
    assert.ok(tlEn.includes("Current State (HEAD)"));
  });

  it("14. P1 & P9: Agnostinen Tabula Rasa -aloitus (emptyMolecule), valinnainen esimerkkivalikko ja suora kyvykkyys-/ICOM-muokkaus", () => {
    const blank = emptyMolecule("Uusi organisaatio");
    const st0 = buildStudioGraphState(blank, 0);
    assert.equal(validateGraph(st0.graph, st0.registry).errors.length, 0);
    assert.equal(Object.keys(st0.graph.nodes).length, 1);

    const st3 = buildStudioGraphState(blank, 3, [], {
      customBizCaps: [
        {
          uri: "apex://capability-biz/custom_rnd_lab",
          name: "Tuotekehitys- ja formulointikyvykkyys",
          status: "missing",
          rationale: "Käyttäjän lisäämä liiketoimintakyvykkyys",
          dependsOn: [],
          notes: [],
          canonicalRef: "CUSTOM",
          realizedBy: [],
          provenance: "user",
        },
      ],
      bizCapStatuses: {
        "apex://capability-biz/customer_demand_validation": "known",
      },
      customPorts: {
        "apex://node/root": [
          {
            id: "custom_c_1",
            name: "Laatustandardi ISO-9001",
            side: "C",
            unit: "apex://unit/items",
            ratio: { const: 1 },
          },
        ],
      },
    });
    assert.equal(validateGraph(st3.graph, st3.registry).errors.length, 0);
    assert.equal(
      st3.graph.businessCapabilities?.["apex://capability-biz/customer_demand_validation"]?.status,
      "known",
    );
    assert.ok(st3.graph.businessCapabilities?.["apex://capability-biz/custom_rnd_lab"]);
    assert.ok(st3.graph.nodes["apex://node/root"]?.ports.some((p) => p.name === "Laatustandardi ISO-9001"));

    const canvas3 = renderIcomProcessOverlayHtml(st3.graph, st3.run, {
      zoomPct: 45,
      xrayLens: "ops",
      selectedUri: "apex://node/root",
      spotlightParentUri: null,
    });
    assert.ok(canvas3.includes("Tabula Rasa"));
    assert.ok(canvas3.includes('data-action="add-atom"'));

    const appSrc = fs.readFileSync(path.resolve("src/flow/client/app.ts"), "utf8");
    assert.ok(appSrc.includes('data-action="start-blank"'));
    assert.ok(appSrc.includes("Lataa esimerkkidata"));
  });
});

describe("Tarkistuspiste 3 (Checkpoint V3) — 8-vaiheinen UniversalGenesisSpec, 6-portainen kääntäjä, Aukkoanalyysi (gaps.ts) & Elävä Launchpad (Invariantti A2)", () => {
  it("15. P9 & Kääntäjän Vaihe 0 (Kypsyysportti) sekä 3 puhdasta kyvykkyyspohjaa (gaps.ts & capabilities/)", () => {
    // Varmista että kaikki 3 kyvykkyyspohjaa sisältävät source, updatedAt ja disclaimer ("ei oikeudellista")
    assert.equal(CAPABILITY_TEMPLATE_LIST.length, 3);
    for (const tpl of CAPABILITY_TEMPLATE_LIST) {
      assert.ok(tpl.source.length > 5);
      assert.match(tpl.updatedAt, /^\d{4}-\d{2}-\d{2}$/);
      assert.ok(tpl.disclaimer.toLowerCase().includes("ei oikeudellista"));
      assert.ok(tpl.items.length >= 5);
    }

    // Taso 0 (Idea): Kääntäjä ajaa VAIN vaiheet 1 ja 2 -> ei luo L1+ prosessisolmuja eikä aja simulaatiota
    const spec0 = ideaToGenesisSpec("Luonnonkosmetiikkabrändi ja ihonhoitosarja", 0);
    const out0 = compileGenesisSpec(spec0);
    assert.deepEqual(out0.stagesExecuted, [1, 2]);
    assert.equal(Object.keys(out0.graph.nodes).length, 1); // Vain L0 root
    assert.equal(out0.simulationRun, null);
    assert.equal(out0.day1BottleneckUri, null);
    assert.equal(out0.gapReport.templateId, "physical_product_brand");
    assert.ok(out0.gapReport.missingCount + out0.gapReport.unclearCount > 0);
    assert.ok(out0.gapReport.totalEstimatedMonthlyCost > 0);
    assert.ok(out0.gapReport.gaps.some((g) => g.openQuestions.length > 0));

    // Taso 1 (Konsepti): Kääntäjä ajaa VAIN vaiheet 1 ja 2, vaihtaa saumattomasti eri kyvykkyyspohjiin ilman koodimuutoksia
    const spec1 = ideaToGenesisSpec("B2B digitaalinen alusta ja kuukausitilauspalvelu 49 €/kk", 1);
    const out1 = compileGenesisSpec(spec1);
    assert.deepEqual(out1.stagesExecuted, [1, 2]);
    assert.equal(out1.gapReport.templateId, "recurring_digital_service");

    const switchedGraph = applyCapabilityTemplate(out1.graph, EXPERT_SERVICE_CAPABILITY_TEMPLATE);
    const switchedReport = analyzeGaps(switchedGraph, EXPERT_SERVICE_CAPABILITY_TEMPLATE);
    assert.equal(switchedReport.templateId, "expert_knowledge_service");
    assert.ok(switchedReport.gaps.length >= 1);

    // Override 4: Katkenneiden stub-virtojen (named/unknown ylävirta -> defined alavirta) tunnistus aukkoanalyysissa
    const spec2 = ideaToGenesisSpec("Tilausvalmistus ja jakelu 80 €/kpl", 2);
    spec2.step2Recipes.offerings[0]!.definition = "defined";
    spec2.step5Sourcing = {
      enabled: true,
      suppliers: [
        {
          slug: "raw_supplier",
          name: "Raaka-ainetoimittaja",
          unitSlug: "items",
          leadTimeTicks: 7,
          unitCost: 20,
          definition: "named",
        },
      ],
    };
    const out2 = compileGenesisSpec(spec2);
    assert.deepEqual(out2.stagesExecuted, [1, 2, 3, 4, 5]);
    assert.equal(out2.simulationRun, null);
    assert.ok(out2.gapReport.stubWarnings.length >= 1);
    assert.ok(out2.gapReport.undefinedNodes.some((u) => u.definition === "named"));
  });

  it("16. Kääntäjän Vaihe 3 (L1-tiheysvahti max 8 arvovirtasolmua) ja 100 % determinismi (sama syöte -> identtinen graafi)", () => {
    const baseSpec = ideaToGenesisSpec("Monituoteyritys ja palvelukeskus", 3);
    // Lisätään 10 arvovirtatuotetta -> L1-tiheysvahdin (TSD 3.4) tulee ryhmitellä ylimenevät L1-klusterisolmun alle
    baseSpec.step2Recipes.offerings = Array.from({ length: 10 }, (_, idx) => ({
      slug: `off_${idx + 1}`,
      name: `Tuotelinja ${idx + 1}`,
      atom: idx % 2 === 0 ? ("physical_matter" as const) : ("transactional_trade" as const),
      outputUnitSlug: "items",
      inputUnitSlug: "items",
      params: {
        unitsPerMonth: 250,
        unitPrice: 120 + idx * 10,
        unitCost: 45 + idx * 4,
        spoilageRate: 0.01,
        stockCoverDays: 10,
        visitorsPerDay: 20,
        conversionRate: 0.4,
        averageTicket: 120 + idx * 10,
        costPerSale: 45 + idx * 4,
        openDaysPerMonth: 25,
      },
      definition: "defined" as const,
    }));

    const compiledA = compileGenesisSpec(baseSpec);
    const compiledB = compileGenesisSpec(baseSpec);

    // Vaihe 3 L1-tiheysvahti: L0-juuren suorien L1 value-stream -lapsien määrä <= 8
    const rootChildren = compiledA.graph.nodes["apex://node/root"]!.children.map(
      (uri) => compiledA.graph.nodes[uri]!,
    );
    const l1ValueStreamChildren = rootChildren.filter((n) => n.apqcCategory <= 6.0);
    assert.ok(
      l1ValueStreamChildren.length <= 8,
      `L1 value-stream lapsia oli ${l1ValueStreamChildren.length}, maksimi on 8`,
    );
    assert.ok(compiledA.groupingSuggestions.length >= 1);

    // 100 % determinismi: kaksi käännöstä samasta UniversalGenesisSpec-syötteestä tuottavat identtisen graafin ja simulaation
    assert.equal(
      deterministicHash(JSON.stringify(baseSpec)),
      deterministicHash(JSON.stringify(structuredClone(baseSpec))),
    );
    assert.deepEqual(compiledA.graph, compiledB.graph);
    assert.equal(compiledA.simulationRun?.finalCash, compiledB.simulationRun?.finalCash);
    assert.deepEqual(compiledA.stagesExecuted, [1, 2, 3, 4, 5, 6]);
  });

  it("17. Invariantti A2: Fast-Track === Architect Mode, tiliotteen provenance ('import' vs 'genesis') sekä kumottava < 16 ms Launchpad-kytkentä", () => {
    // 1. Fast-Track ja Architect Mode käyttävät täsmälleen samaa 6-portaista kääntäjää -> identtinen graafi
    const ideaText = "Ohjelmistokonsultointi ja pilviarkkitehtuurit 145 €/h";
    const fastTrackOut = compileFastTrack({
      idea: ideaText,
      name: "Arkkitehti Oy",
      maturity: 3,
    });
    const architectOut = compileArchitectSpec(fastTrackOut.spec);
    assert.deepEqual(fastTrackOut.graph, architectOut.graph);
    assert.equal(fastTrackOut.simulationRun?.finalCash, architectOut.simulationRun?.finalCash);

    // 2. Provenance-erottelu: tiliotteesta tuotu = 'import', ideasta generoitu = 'genesis'
    const statementOut = compileFastTrack({
      statement: {
        rowCount: 18,
        monthsDetected: 3,
        avgMonthlyIncome: 18000,
        lastBalance: 25000,
        recurring: [
          {
            label: "Toimistovuokra",
            monthlyAmount: 1400,
            occurrences: 3,
            category: "rent",
            selected: true,
          },
        ],
        ignoredSummary: { taxes: 0, oneOffs: 0, transfers: 0 },
      },
      name: "Tiliote Oy",
      maturity: 3,
    });
    assert.equal(statementOut.spec.step8Topology.provenance, "import");
    assert.equal(fastTrackOut.spec.step8Topology.provenance, "genesis");
    const factorImport = statementOut.graph.factors["apex://factor/credit_customerTermsDays"]!;
    const factorGenesis = fastTrackOut.graph.factors["apex://factor/credit_customerTermsDays"]!;
    assert.equal(factorImport.provenance.source, "import");
    assert.equal(factorGenesis.provenance.source, "genesis");

    // 3. Elävä Launchpad (Invariantti A2): jokainen tehtävä on eksplisiittinen C/M-portti-, kerroin- tai viivekytkentä (< 16 ms) ja kumottavissa
    const mol = createPreset("it_consultant");
    const initialGraph = migrateMoleculeToGraph(mol);
    const bindings = resolveGraphBindings(initialGraph);
    assert.ok(Object.keys(bindings).length >= 6);

    let currentGraph = structuredClone(initialGraph);
    let currentChecklist = emptyChecklist();

    const itemsToToggle = ["company-form", "yel", "accounting", "insurance", "terms", "workflow-tool"];
    for (const itemId of itemsToToggle) {
      const t0 = performance.now();
      const checked = toggleGraphLaunchpadItem(currentGraph, currentChecklist, itemId, true);
      const elapsedMs = performance.now() - t0;
      assert.ok(elapsedMs < 16, `Launchpad-kytkentä ${itemId} kesti ${elapsedMs.toFixed(2)} ms (>= 16 ms)`);
      assert.equal(checked.checklist.items[itemId]?.checked, true);
      assert.notDeepEqual(checked.graph, currentGraph, `Launchpad-kytkentä ${itemId} ei muuttanut graafia`);
      currentGraph = checked.graph;
      currentChecklist = checked.checklist;
    }

    // Varmista että kytkennät loivat oikeat C/M-portit ja kertoimet graafiin
    assert.equal(currentGraph.opening.cash, initialGraph.opening.cash - 75);
    assert.ok(currentGraph.factors["apex://factor/lp_yel_daily"]);
    assert.ok(currentGraph.factors["apex://factor/lp_accounting_daily"]);
    assert.ok(currentGraph.factors["apex://factor/lp_insurance_daily"]);
    assert.ok(
      currentGraph.nodes["apex://node/root"]!.ports.some((p) => p.id === "lp_ctrl_company_form" && p.side === "C"),
    );

    // Kumoa kaikki ruksit käänteisessä järjestyksessä -> graafin on palauduttava 100 % alkuperäiseen tilaan
    for (const itemId of [...itemsToToggle].reverse()) {
      const unchecked = toggleGraphLaunchpadItem(currentGraph, currentChecklist, itemId, false);
      assert.equal(unchecked.checklist.items[itemId]?.checked, false);
      currentGraph = unchecked.graph;
      currentChecklist = unchecked.checklist;
    }
    assert.deepEqual(currentGraph, initialGraph);

    // Varmista että Launchpad-näkymä ja HTML-piirto toimivat sekä kypsyystasoilla 0–1 että 2–3
    const lpView0 = buildGraphLaunchpadView(out0_for_lp(), emptyChecklist());
    assert.equal(lpView0.mode, "gap_driven");
    const lpHtml = renderLaunchpad(
      checklistView(mol, buildView(mol), emptyChecklist()),
      {
        graphLp: lpView0,
        architectSpec: fastTrackOut.spec,
      },
    );
    assert.ok(lpHtml.includes("Architect Mode"));
    assert.ok(lpHtml.includes('data-action="architect-compile"'));
  });
});

function out0_for_lp(): EnterpriseGraph {
  return compileGenesisSpec(ideaToGenesisSpec("Uusi kosmetiikkasarja", 0)).graph;
}

describe("Tarkistuspiste 4 (Checkpoint V4) — 4 X-Ray-linssiä, Subsystem Scoping (set_root_scope) & Nopeus 2 Optimistinen Ghost-solmu (Invariantti A4)", () => {
  it("18. 4 X-Ray-linssiä (ops, financial, it, org) projektoivat saman graafin ilman datan muuttumista + Taso 1 IT-järjestelmätarpeet", () => {
    const mol = createPreset("webshop");
    const st = buildStudioGraphState(mol, 3);
    const valNode = Object.values(st.graph.nodes).find((n) => n.level === 1 && n.band === "value_stream")!;
    const enNode = Object.values(st.graph.nodes).find((n) => n.level === 1 && n.band !== "value_stream")!;

    // Tee kopio varmistaaksemme ettei mikään linssiprojektio muuta graafia tai simulaatiota
    const graphSnapshotBefore = structuredClone(st.graph);
    const runSnapshotBefore = structuredClone(st.run);

    const opsProj = projectGraphThroughXRayLens(st.graph, st.run, "ops");
    const finProj = projectGraphThroughXRayLens(st.graph, st.run, "financial");
    const itProj = projectGraphThroughXRayLens(st.graph, st.run, "it");
    const orgProj = projectGraphThroughXRayLens(st.graph, st.run, "org");

    assert.deepEqual(st.graph, graphSnapshotBefore);
    assert.deepEqual(st.run, runSnapshotBefore);

    // 1. Ops Flow: käyttöaste, jonot ja virran paksuus yksikköä/tick
    assert.equal(opsProj.lens, "ops");
    assert.ok(opsProj.nodes[valNode.uri]!.utilization >= 0);
    assert.ok(opsProj.nodes[valNode.uri]!.colorToken.startsWith("var(--st-"));

    // 2. Financial Margin (Sankey): kate-% ja katevuodon lähteet
    assert.equal(finProj.lens, "financial");
    assert.ok(finProj.nodes[valNode.uri]!.revenuePerTick > 0);
    assert.ok(finProj.nodes[valNode.uri]!.erosionSources.length >= 1);

    // 3. IT & Data: integroitu vs. taulukko vs. manuaalinen (katkoviiva)
    assert.equal(itProj.lens, "it");
    assert.equal(itProj.nodes[valNode.uri]!.automationLevel, "integrated");
    assert.equal(itProj.nodes[enNode.uri]!.automationLevel, "spreadsheet");

    const manualGraph = structuredClone(st.graph);
    manualGraph.nodes[valNode.uri]!.mechanisms = [];
    delete manualGraph.nodes[valNode.uri]!.owner;
    const manualItProj = projectGraphThroughXRayLens(manualGraph, st.run, "it");
    assert.equal(manualItProj.nodes[valNode.uri]!.automationLevel, "manual");
    assert.equal(manualItProj.nodes[valNode.uri]!.borderStyle, "dashed");
    assert.equal(manualItProj.nodes[valNode.uri]!.colorToken, "var(--st-critical)");

    // 4. Org & Accountability: RACI-aukko kun owner puuttuu + yksikköluovutukset
    const manualOrgProj = projectGraphThroughXRayLens(manualGraph, st.run, "org");
    assert.equal(manualOrgProj.nodes[valNode.uri]!.raciGap, true);
    assert.equal(manualOrgProj.nodes[valNode.uri]!.colorToken, "var(--st-critical)");
    assert.ok(orgProj.nodes[valNode.uri]!.ownerUri !== null);

    // 5. Taso 1 (Konsepti) + IT-linssi näyttää suunnitellut järjestelmätarpeet ilman prosessivirtoja
    const st1 = buildStudioGraphState(mol, 1);
    const html1It = renderIcomProcessOverlayHtml(st1.graph, st1.run, {
      zoomPct: 45,
      xrayLens: "it",
      selectedUri: st1.graph.root,
      spotlightParentUri: null,
    });
    assert.ok(html1It.includes("Suunnitellut järjestelmätarpeet (Taso 1 · ilman prosessivirtoja)"));
  });

  it("19. Subsystem Scoping (set_root_scope): alipuun rajaus, ulkoiset ICOM-rajapintaportit, rajatut KPI:t ja palautus yrityksen juureen (L0)", () => {
    const mol = createPreset("it_consultant");
    const firstValUri = Object.values(migrateMoleculeToGraph(mol).nodes).find(
      (n) => n.level === 1 && n.band === "value_stream",
    )!.uri;

    // Pilkotaan L1-solmu L2-alivaiheiksi ja rajataan näkymän juureksi (scopeRootUri)
    const stScoped = buildStudioGraphState(mol, 3, [firstValUri], {
      scopeRootUri: firstValUri,
    });
    assert.equal(stScoped.graph.scopeRoot, firstValUri);

    const scopeView = computeSubsystemScope(stScoped.graph, stScoped.run);
    assert.equal(scopeView.isScoped, true);
    assert.equal(scopeView.scopeRootUri, firstValUri);
    // Alipuussa on valittu L1-solmu + sen 5 L2-alivaihetta = 6 solmua (muut L1-solmut on rajattu ulos)
    assert.equal(scopeView.scopedNodeUris.size, 6);
    assert.ok(!scopeView.scopedNodeUris.has(stScoped.graph.root));
    assert.ok(scopeView.externalBoundaryPorts.some((p) => p.side === "I"));
    assert.ok(scopeView.externalBoundaryPorts.some((p) => p.side === "O"));
    assert.ok(scopeView.externalBoundaryPorts.some((p) => p.side === "C"));
    assert.ok(scopeView.externalBoundaryPorts.some((p) => p.side === "M"));
    assert.equal(scopeView.breadcrumb[0]!.uri, stScoped.graph.root);
    assert.equal(scopeView.breadcrumb[scopeView.breadcrumb.length - 1]!.uri, firstValUri);

    // Kanvaasin HTML näyttää Subsystem Scope -palkin, ulkoiset ICOM-rajapintaportit ja paluupainikkeen
    const scopedHtml = renderIcomProcessOverlayHtml(stScoped.graph, stScoped.run, {
      zoomPct: 45,
      xrayLens: "ops",
      selectedUri: firstValUri,
      spotlightParentUri: null,
      scopeRootUri: firstValUri,
    });
    assert.ok(scopedHtml.includes("Alipuun rajaus (Subsystem Scope"));
    assert.ok(scopedHtml.includes("Palaa koko yrityksen juureen (L0)"));

    // Palautus koko yrityksen juureen (setRootScope -> null)
    const unscopedGraph = setRootScope(stScoped.graph, null);
    assert.equal(unscopedGraph.scopeRoot, undefined);
    const unscopeView = computeSubsystemScope(unscopedGraph, stScoped.run);
    assert.equal(unscopeView.isScoped, false);
    assert.equal(unscopeView.scopeRootUri, unscopedGraph.root);
  });

  it("20. Invariantti A4 (Nopeus 2): intent.ts + optimistic.ts luo ghost-solmun < 50 ms, 0,00 € vaikutus kassaan/pääkirjaan, varjoajo ja yhdellä siirtymällä palautuva rollback", () => {
    const mol = createPreset("it_consultant");
    const baseState = buildStudioGraphState(mol, 3);
    const baseGraph = structuredClone(baseState.graph);
    const baseRun = baseState.run;

    // 1. Ensimmäinen luonnollisen kielen pyyntö -> ghost-solmu < 50 ms ilman kielimallikutsua
    const t0 = performance.now();
    const firstDraft = createOptimisticDraftFromIntent(
      "Lisää uusi yritysasiakkaiden koulutuspalvelu 180 €",
      baseGraph,
    );
    const elapsed1 = performance.now() - t0;
    assert.ok(elapsed1 < 50, `Ghost-solmun luonti kesti ${elapsed1.toFixed(2)} ms (budjetti < 50 ms)`);
    assert.equal(firstDraft.patch.status, "pending");
    assert.equal(firstDraft.patch.ghostNodes.length, 1);

    const ghostUri1 = firstDraft.patch.ghostNodes[0]!;
    const ghostNode1 = firstDraft.graph.nodes[ghostUri1]!;
    assert.equal(ghostNode1.definition, "named");
    assert.equal(ghostNode1.ghost?.status, "pending");
    assert.equal(ghostNode1.ghost?.patchId, firstDraft.patch.patchId);

    // 2. Toinen avoin pyyntö pinoon (stack support)
    const secondDraft = applyOptimisticPatch(firstDraft.graph, "Lisää digitaalinen tilauskanava", {
      name: "Digitaalinen tilauskanava",
      atom: "recurring_subscription",
    });
    assert.equal(getPendingOptimisticPatches(secondDraft.graph).length, 2);

    // 3. Ehdoton eristyssääntö (Kanoninen yliajo 4 & Invariantti 6):
    // Ghost-solmujen vaikutus oikeaan simulaatioon, kassaan, liikevaihtoon ja pääkirjaan on TÄSMÄLLEEN 0,00 €
    const runWithGhosts = simulateGraph(secondDraft.graph);
    assert.equal(runWithGhosts.finalCash, baseRun.finalCash);
    assert.equal(runWithGhosts.totalNetRevenue, baseRun.totalNetRevenue);
    assert.equal(runWithGhosts.totalOperatingProfit, baseRun.totalOperatingProfit);
    assert.equal(
      runWithGhosts.statements.balanceSheet.totalAssets,
      baseRun.statements.balanceSheet.totalAssets,
    );
    assert.equal(runWithGhosts.nodeStates[ghostUri1]?.computed, false);
    assert.equal(runWithGhosts.nodeStates[ghostUri1]?.skipReason, "ghost_pending");

    // Kanvaasin HTML piirtää ghost-solmun katkoviivalla, merkinnällä "luonnos, odottaa tarkennusta" ja "0,00 €"
    const ghostCanvasHtml = renderIcomProcessOverlayHtml(secondDraft.graph, runWithGhosts, {
      zoomPct: 45,
      xrayLens: "ops",
      selectedUri: ghostUri1,
      spotlightParentUri: null,
    });
    assert.ok(ghostCanvasHtml.includes("icom-ghost-card"));
    assert.ok(ghostCanvasHtml.includes("luonnos, odottaa tarkennusta"));
    assert.ok(ghostCanvasHtml.includes("0,00 €"));
    assert.ok(ghostCanvasHtml.includes('data-visual-only="true"'));

    // 4. Varjoajo oletusarvoilla (runShadowPreviewWithDefaults): laskee esikatselun tallentamatta malliin
    const graphBeforeShadow = structuredClone(secondDraft.graph);
    const shadow = runShadowPreviewWithDefaults(secondDraft.graph);
    assert.equal(shadow.isShadowPreview, true);
    assert.equal(shadow.label, "arvaus, oletusarvoilla");
    assert.ok(shadow.ghostNodeUris.includes(ghostUri1));
    assert.equal(shadow.run.nodeStates[ghostUri1]?.computed, true);
    assert.deepEqual(secondDraft.graph, graphBeforeShadow); // Ei tallentunut malliin!

    // 5. Rollback: kumotaan molemmat luonnokset -> graafi palautuu 100 % identtiseksi baseGraph-tilan kanssa
    const rb2 = rollbackOptimisticPatch(secondDraft.graph, secondDraft.patch.patchId);
    assert.equal(rb2.rolledBackPatch?.status, "rolled_back");
    assert.equal(rb2.remainingPatches.length, 1);
    assert.deepEqual(rb2.graph, firstDraft.graph);

    const rb1 = rollbackOptimisticPatch(rb2.graph, firstDraft.patch.patchId);
    assert.equal(rb1.rolledBackPatch?.status, "rolled_back");
    assert.equal(rb1.remainingPatches.length, 0);
    assert.deepEqual(rb1.graph, baseGraph);
  });
});
