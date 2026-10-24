/**
 * APEX Studio v3.2 — 8-Step `UniversalGenesisSpec` & 6-Stage Deterministic Graph Compiler
 * (`src/flow/graph/compiler.ts`).
 *
 * Implements TSD v3.2 Sections 3.4, 4.1, 4.2, 4.4, 4.5, Invariant A1, Invariant A2, and P1/P9:
 * - Stage 0 (Maturity Gate):
 *   - `maturity: 0 | 1`: Runs only Stages 1–2 (Factor Registry + L0 Root) + builds `BusinessCapability`
 *     map & `analyzeGaps(graph)`. Creates zero process subnodes and does not start simulation.
 *   - `maturity: 2`: Runs Stages 1–5 (allows `named` / `unknown` nodes) + `analyzeGaps(graph)`.
 *   - `maturity: 3`: Runs all Stages 1–6, including calibration `simulateGraph` run, invariant check,
 *     and Day-1 bottleneck identification.
 * - Deterministic hashing: identical `UniversalGenesisSpec` inputs always produce identical
 *   `EnterpriseGraph` structures (Fast-Track === Architect Mode).
 * - L1 Density Guard (TSD 3.4): if L1 value-stream nodes exceed 8 (or enabling/governance > 6),
 *   excess nodes are grouped under a composite L1 node (children moved to L2) and reported in
 *   `groupingSuggestions`.
 */
import type { Provenance, ProvenanceSource } from "../kernel/types.ts";
import type {
  AtomKind,
  BusinessCapability,
  Capability,
  EnterpriseGraph,
  EntityURI,
  FactorNode,
  FactorRef,
  FlowNature,
  FlowUnit,
  HierarchicalStreamEdge,
  MechanismBinding,
  NodeDefinitionState,
  PhysicsModule,
  Port,
  SystemLayer,
  TemporalWave,
  TickResolution,
  UniversalEnterpriseNode,
  VentureMaturity,
} from "./types.ts";
import { createDefaultAccounts } from "./ledger.ts";
import { buildRegistry, validateGraph, type EntityRegistry, type ValidationResult } from "./registry.ts";
import { simulateGraph, type SimulationRun } from "./simulate.ts";
import {
  analyzeGaps,
  buildBusinessCapabilitiesFromTemplate,
  selectCapabilityTemplate,
  type GapAnalysisReport,
} from "./gaps.ts";

export type NumericOrFactorInput = number | FactorRef;

export interface GenesisUnitSpec {
  slug: string;
  name: string;
  nature: FlowNature;
  measure: string;
  decayPerTick?: NumericOrFactorInput;
}

export interface GenesisOfferingSpec {
  slug: string;
  name: string;
  atom: AtomKind;
  outputUnitSlug?: string;
  inputUnitSlug?: string;
  inputRatio?: NumericOrFactorInput;
  cycleTicks?: NumericOrFactorInput;
  firstPassYield?: NumericOrFactorInput;
  params: Record<string, NumericOrFactorInput>;
  substeps?: {
    slug: string;
    name: string;
    capacityPerTick?: NumericOrFactorInput;
    cycleTicks?: NumericOrFactorInput;
    firstPassYield?: NumericOrFactorInput;
    definition?: NodeDefinitionState;
  }[];
  definition?: NodeDefinitionState;
}

export interface GenesisChannelStageSpec {
  slug: string;
  name: string;
  conversionRate: NumericOrFactorInput;
  cycleTicks?: NumericOrFactorInput;
  costPerUnit?: NumericOrFactorInput;
  capacityPerTick?: NumericOrFactorInput;
  definition?: NodeDefinitionState;
}

export interface GenesisSupplierSpec {
  slug: string;
  name: string;
  unitSlug: string;
  leadTimeTicks: NumericOrFactorInput;
  unitCost: NumericOrFactorInput;
  batchSize?: NumericOrFactorInput;
  bufferMaxUnits?: NumericOrFactorInput;
  holdingCostPerUnit?: NumericOrFactorInput;
  reorderTrigger?: NumericOrFactorInput;
  reorderTarget?: NumericOrFactorInput;
  definition?: NodeDefinitionState;
}

export interface GenesisFixedCostSpec {
  slug: string;
  name: string;
  amountPerMonth: NumericOrFactorInput;
  category?: string;
}

export interface GenesisRoleSpec {
  slug: string;
  name: string;
  fte: NumericOrFactorInput;
  monthlyCostPerFte: NumericOrFactorInput;
  hoursPerFtePerTick?: NumericOrFactorInput;
  proficiency?: NumericOrFactorInput;
}

export interface GenesisSystemSpec {
  slug: string;
  name: string;
  layer: SystemLayer;
  fixedCostPerMonth: NumericOrFactorInput;
  capex?: NumericOrFactorInput;
  availability?: NumericOrFactorInput;
  throughputModifier?: NumericOrFactorInput;
  rolloutLeadTicks?: number;
  rolloutDipDepth?: NumericOrFactorInput;
  rolloutDipTicks?: number;
  critical?: boolean;
}

export interface GenesisAssetSpec {
  slug: string;
  name: string;
  capacityPerTick: NumericOrFactorInput;
  operatingCostPerMonth: NumericOrFactorInput;
  capex?: NumericOrFactorInput;
  usefulLifeTicks?: NumericOrFactorInput;
}

export interface GenesisBusinessCapabilitySpec {
  slug: string;
  name: string;
  status: "known" | "unclear" | "missing";
  rationale?: string;
  dependsOnSlugs?: string[];
  notes?: {
    kind: "cost" | "risk" | "obligation" | "question";
    text: string;
    amount?: NumericOrFactorInput;
  }[];
  canonicalRef?: string;
}

/**
 * 8-vaiheinen `UniversalGenesisSpec` (TSD 4.1).
 * Täysin toimiala-agnostinen: kääntyy deterministisesti `EnterpriseGraph`-rakenteeksi.
 */
export interface UniversalGenesisSpec {
  /** Vaihe 1: Ongelma ja tehtävä (L0-juuri, tavoite-KPI:t, kysynnän laukaisuehdot). */
  step1Mission: {
    name: string;
    mission?: string;
    targetMonthlyRevenue?: NumericOrFactorInput;
    targetMarginPct?: NumericOrFactorInput;
    demandTrigger?: string;
  };
  /** Vaihe 2: Ratkaisu ja reseptit (FlowUnit-ontologia, I->O-suhteet, sykli, saanto). */
  step2Recipes: {
    units?: GenesisUnitSpec[];
    offerings: GenesisOfferingSpec[];
  };
  /** Vaihe 3: Markkina ja aikadynamiikka (katto, jousto, aikafunktiot, ohjaussäännöt). */
  step3Market: {
    demandCapPerTick?: NumericOrFactorInput;
    priceElasticity?: NumericOrFactorInput;
    temporalWaves?: TemporalWave[];
    monthlyMultipliers?: number[];
    regulatoryControls?: string[];
  };
  /** Vaihe 4: Asiakkaat ja kanavat (hankinta- ja vastaanottoputket, jonotoleranssi, pysyvyys). */
  step4Channels: {
    stages?: GenesisChannelStageSpec[];
    queueToleranceTicks?: NumericOrFactorInput;
    retentionRate?: NumericOrFactorInput;
  };
  /** Vaihe 5: Hankinta (valinnainen: toimittajasolmut, täydennyssäännöt, viiveet, I-puskurit). */
  step5Sourcing?: {
    enabled: boolean;
    suppliers?: GenesisSupplierSpec[];
  };
  /** Vaihe 6: Liiketoimintamalli (maksuehdot, luottotappiot, kiinteät kulut, pääkirjakirjaukset). */
  step6BusinessModel: {
    customerTermsDays: NumericOrFactorInput;
    supplierTermsDays: NumericOrFactorInput;
    badDebtRate?: NumericOrFactorInput;
    fixedCosts: GenesisFixedCostSpec[];
  };
  /** Vaihe 7: Kyvykkyydet (roolit, järjestelmät SystemLayer-kerroksineen, kalusto ja BusinessCapability). */
  step7Capabilities: {
    roles: GenesisRoleSpec[];
    systems: GenesisSystemSpec[];
    assets?: GenesisAssetSpec[];
    businessCapabilities?: GenesisBusinessCapabilitySpec[];
    capabilityTemplateId?: string;
  };
  /** Vaihe 8: Topologia ja hallinta (kypsyystaso, alkukassa, horisontti, SLA-rajat, alkuperä). */
  step8Topology: {
    maturity: VentureMaturity;
    openingCash: NumericOrFactorInput;
    horizonTicks?: number;
    tickResolution?: TickResolution;
    payrollDayOfMonth?: number;
    maxSlaTicks?: NumericOrFactorInput;
    provenance?: ProvenanceSource;
  };
}

export interface GroupingSuggestion {
  band: "value_stream" | "enabling";
  groupNodeUri: EntityURI;
  groupedChildUris: EntityURI[];
  reason: string;
}

export interface GenesisCompilationResult {
  graph: EnterpriseGraph;
  registry: EntityRegistry;
  validation: ValidationResult;
  gapReport: GapAnalysisReport;
  simulationRun: SimulationRun | null;
  day1BottleneckUri: EntityURI | null;
  stagesExecuted: number[];
  groupingSuggestions: GroupingSuggestion[];
}

const sanitizeSlug = (raw: string): string =>
  raw
    .trim()
    .replace(/[^A-Za-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "") || "entity";

/**
 * Deterministinen FNV-1a 32-bit tiiviste vakaiden tunnisteiden luomiseen (TSD 4.2).
 */
export function deterministicHash(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

function resolveNumeric(val: NumericOrFactorInput | undefined, fallback = 0): number {
  if (val === undefined) return fallback;
  if (typeof val === "number") return Number.isFinite(val) ? val : fallback;
  if ("const" in val) return Number.isFinite(val.const) ? val.const : fallback;
  return fallback;
}

/**
 * 6-vaiheinen deterministinen kääntäjä (`compileGenesisSpec`, TSD 4.2):
 * Vaihe 0: Tasoportti (`maturity` 0–3)
 * Vaihe 1: Tekijärekisteri (`FactorNode` + `Provenance`)
 * Vaihe 2: L0-juuri + `BusinessCapability`-kartta
 * Vaihe 3: L1-arvovirta ja tukikaistat (sekä L1-tiheysvahti max 8 / max 6)
 * Vaihe 4: L2–Ln-purku (alivaiheet ja hylkyhaarat)
 * Vaihe 5: Virtojen kytkentä ja koostevirrat
 * Vaihe 6: Indeksi, validointi, kalibrointiajo ja päivän 1 pullonkaula
 */
export function compileGenesisSpec(spec: UniversalGenesisSpec): GenesisCompilationResult {
  const maturity: VentureMaturity = spec.step8Topology.maturity;
  const provSource: ProvenanceSource = spec.step8Topology.provenance ?? "genesis";
  const defaultProv: Provenance = { source: provSource };

  const specHash = deterministicHash(
    JSON.stringify({
      name: spec.step1Mission.name,
      offerings: spec.step2Recipes.offerings.map((o) => o.slug),
      maturity,
    }),
  );
  const graphId = `g_${specHash}`;

  const accounts = createDefaultAccounts();
  const units: Record<string, FlowUnit> = {
    "apex://unit/monetary": {
      uri: "apex://unit/monetary",
      name: "Monetary Value",
      nature: "monetary",
      measure: "EUR",
      decayPerTick: { const: 0 },
    },
    "apex://unit/hours": {
      uri: "apex://unit/hours",
      name: "Capacity Hours",
      nature: "capacity",
      measure: "h",
      decayPerTick: { const: 0 },
    },
    "apex://unit/items": {
      uri: "apex://unit/items",
      name: "Discrete Units",
      nature: "discrete",
      measure: "pcs",
      decayPerTick: { const: 0 },
    },
    "apex://unit/subscribers": {
      uri: "apex://unit/subscribers",
      name: "Active Accounts",
      nature: "agent",
      measure: "sub",
      decayPerTick: { const: 0 },
    },
    "apex://unit/transactions": {
      uri: "apex://unit/transactions",
      name: "Transactions",
      nature: "discrete",
      measure: "tx",
      decayPerTick: { const: 0 },
    },
  };

  for (const u of spec.step2Recipes.units ?? []) {
    const uUri: EntityURI = `apex://unit/${sanitizeSlug(u.slug)}`;
    units[uUri] = {
      uri: uUri,
      name: u.name,
      nature: u.nature,
      measure: u.measure,
      decayPerTick:
        typeof u.decayPerTick === "object" && u.decayPerTick !== null
          ? u.decayPerTick
          : { const: resolveNumeric(u.decayPerTick, 0) },
    };
  }

  const factors: Record<string, FactorNode> = {};
  const nodes: Record<string, UniversalEnterpriseNode> = {};
  const streams: Record<string, HierarchicalStreamEdge> = {};
  const capabilities: Record<string, Capability> = {};
  const stagesExecuted: number[] = [];
  const groupingSuggestions: GroupingSuggestion[] = [];

  const registerFactor = (
    slug: string,
    name: string,
    raw: NumericOrFactorInput | undefined,
    fallback: number,
    unit: string,
    alias?: string,
    extra?: { temporal?: TemporalWave[]; monthlyMultipliers?: number[] },
  ): FactorRef => {
    if (raw && typeof raw === "object" && "factor" in raw) {
      return raw;
    }
    const val = resolveNumeric(raw, fallback);
    const uri: EntityURI = `apex://factor/${sanitizeSlug(slug)}`;
    factors[uri] = {
      uri,
      name,
      alias,
      kind: "lever",
      value: val,
      unit,
      provenance: defaultProv,
      ...(extra?.temporal && extra.temporal.length > 0 ? { temporal: extra.temporal } : {}),
      ...(extra?.monthlyMultipliers && extra.monthlyMultipliers.length === 12
        ? { monthlyMultipliers: [...extra.monthlyMultipliers] }
        : {}),
    };
    return { factor: uri };
  };

  // =========================================================================
  // VAIHE 1: Tekijärekisteri (Factor Registry)
  // =========================================================================
  stagesExecuted.push(1);

  const customerTermsRef = registerFactor(
    "credit_customerTermsDays",
    "Customer Payment Terms",
    spec.step6BusinessModel.customerTermsDays,
    14,
    "d",
    "credit.customerTermsDays",
  );
  const supplierTermsRef = registerFactor(
    "credit_supplierTermsDays",
    "Supplier Payment Terms",
    spec.step6BusinessModel.supplierTermsDays,
    14,
    "d",
    "credit.supplierTermsDays",
  );
  const badDebtRef = registerFactor(
    "credit_badDebtRate",
    "Bad Debt Rate",
    spec.step6BusinessModel.badDebtRate,
    0,
    "ratio",
    "credit.badDebtRate",
  );

  if (spec.step3Market.demandCapPerTick !== undefined) {
    registerFactor(
      "market_demandCapPerTick",
      "Market Demand Cap Per Tick",
      spec.step3Market.demandCapPerTick,
      1000,
      "units/d",
      "market.demandCapPerTick",
    );
  }
  if (spec.step3Market.priceElasticity !== undefined) {
    registerFactor(
      "market_priceElasticity",
      "Price Elasticity",
      spec.step3Market.priceElasticity,
      -1.2,
      "ratio",
      "market.priceElasticity",
    );
  }

  // Rekisteröi Vaiheen 7 kyvykkyydet (roolit, järjestelmät, kalusto)
  const roleUris: EntityURI[] = [];
  for (const r of spec.step7Capabilities.roles) {
    const rSlug = sanitizeSlug(r.slug);
    const rUri: EntityURI = `apex://role/${rSlug}`;
    roleUris.push(rUri);
    const fteRef = registerFactor(`role_${rSlug}_fte`, `${r.name} FTE`, r.fte, 1, "fte", `role.${rSlug}.fte`);
    const costPerTickRef = registerFactor(
      `role_${rSlug}_costPerTick`,
      `${r.name} Cost Per Tick`,
      resolveNumeric(r.monthlyCostPerFte, 3600) / 30,
      120,
      "EUR/d",
      `role.${rSlug}.costPerTick`,
    );
    const hoursRef = registerFactor(
      `role_${rSlug}_hoursPerTick`,
      `${r.name} Hours Per Tick`,
      r.hoursPerFtePerTick,
      7.5,
      "h/d",
    );
    const profRef = registerFactor(
      `role_${rSlug}_proficiency`,
      `${r.name} Proficiency`,
      r.proficiency,
      0.9,
      "ratio",
    );
    capabilities[rUri] = {
      kind: "role",
      uri: rUri,
      name: r.name,
      orgUnit: "apex://unit-org/core",
      fte: fteRef,
      costPerFtePerTick: costPerTickRef,
      hoursPerFtePerTick: hoursRef,
      proficiency: profRef,
    };
  }

  const systemSpecsWithUris: { uri: EntityURI; spec: GenesisSystemSpec }[] = [];
  for (const s of spec.step7Capabilities.systems) {
    const sSlug = sanitizeSlug(s.slug);
    const sUri: EntityURI = `apex://system/${sSlug}`;
    systemSpecsWithUris.push({ uri: sUri, spec: s });
    const fixedPerTickRef = registerFactor(
      `sys_${sSlug}_fixedPerTick`,
      `${s.name} Fixed Cost Per Tick`,
      resolveNumeric(s.fixedCostPerMonth, 150) / 30,
      5,
      "EUR/d",
    );
    const availRef = registerFactor(
      `sys_${sSlug}_availability`,
      `${s.name} Availability`,
      s.availability,
      0.995,
      "ratio",
    );
    capabilities[sUri] = {
      kind: "system",
      uri: sUri,
      name: s.name,
      layer: s.layer,
      fixedCostPerTick: fixedPerTickRef,
      capex: { const: resolveNumeric(s.capex, 0) },
      availability: availRef,
    };
  }

  const assetUris: EntityURI[] = [];
  for (const a of spec.step7Capabilities.assets ?? []) {
    const aSlug = sanitizeSlug(a.slug);
    const aUri: EntityURI = `apex://asset/${aSlug}`;
    assetUris.push(aUri);
    const capRef = registerFactor(
      `asset_${aSlug}_capPerTick`,
      `${a.name} Capacity Per Tick`,
      a.capacityPerTick,
      500,
      "units/d",
    );
    const opCostRef = registerFactor(
      `asset_${aSlug}_opCostPerTick`,
      `${a.name} Operating Cost Per Tick`,
      resolveNumeric(a.operatingCostPerMonth, 300) / 30,
      10,
      "EUR/d",
    );
    capabilities[aUri] = {
      kind: "asset",
      uri: aUri,
      name: a.name,
      capacityPerTick: capRef,
      operatingCostPerTick: opCostRef,
      capex: { const: resolveNumeric(a.capex, 0) },
      usefulLifeTicks: { const: resolveNumeric(a.usefulLifeTicks, 1080) },
    };
  }

  // =========================================================================
  // VAIHE 2: L0-juurisolmu + Liiketoimintakyvykkyydet (`BusinessCapability`)
  // =========================================================================
  stagesExecuted.push(2);

  const rootUri: EntityURI = "apex://node/root";
  const tpl = selectCapabilityTemplate(spec.step7Capabilities.capabilityTemplateId);
  const businessCapabilities: Record<string, BusinessCapability> = buildBusinessCapabilitiesFromTemplate(
    tpl,
    provSource === "user" ? "user" : "genesis",
  );

  for (const bc of spec.step7Capabilities.businessCapabilities ?? []) {
    const bcUri: EntityURI = `apex://capability-biz/${sanitizeSlug(bc.slug)}`;
    businessCapabilities[bcUri] = {
      uri: bcUri,
      name: bc.name,
      status: bc.status,
      rationale: bc.rationale,
      dependsOn: (bc.dependsOnSlugs ?? []).map((s) => `apex://capability-biz/${sanitizeSlug(s)}` as EntityURI),
      notes: (bc.notes ?? []).map((n) => ({
        kind: n.kind,
        text: n.text,
        ...(n.amount !== undefined
          ? {
              amount:
                typeof n.amount === "object" && n.amount !== null
                  ? n.amount
                  : { const: resolveNumeric(n.amount, 0) },
            }
          : {}),
      })),
      canonicalRef: bc.canonicalRef,
      realizedBy: [],
      provenance: provSource === "user" ? "user" : "genesis",
    };
  }

  nodes[rootUri] = {
    uri: rootUri,
    name: spec.step1Mission.name || "Enterprise",
    level: 0,
    band: "value_stream",
    definition: maturity <= 1 ? "incomplete" as unknown as NodeDefinitionState : "defined",
    tags: ["root"],
    parent: null,
    children: [],
    ports: [],
    mechanisms: [],
    ledgerBindings: [],
    kpis: [],
  };
  // Korjataan L0-juuren definition kanoniseksi ("defined" kun lapsia tai taso 0, "named" jos tyhjä taso >= 1)
  nodes[rootUri]!.definition = "defined";

  const openingCash = resolveNumeric(spec.step8Topology.openingCash, 10000);
  const baseGraph: EnterpriseGraph = {
    version: 3,
    maturity,
    id: graphId,
    name: spec.step1Mission.name || "Enterprise",
    root: rootUri,
    tick: {
      resolution: spec.step8Topology.tickResolution ?? "day",
      horizon: spec.step8Topology.horizonTicks ?? 360,
      startCalendarMonth: 0,
      payrollDayOfMonth: spec.step8Topology.payrollDayOfMonth ?? 15,
    },
    currency: "EUR",
    nodes,
    streams,
    units,
    factors,
    capabilities,
    businessCapabilities,
    accounts,
    opening: {
      cash: openingCash,
      balances: {},
    },
    events: [],
  };

  // =========================================================================
  // VAIHE 0 (Tasoportti): Jos kypsyystaso on 0 tai 1, pysähdytään vaiheeseen 2!
  // =========================================================================
  if (maturity === 0 || maturity === 1) {
    if (maturity === 1) {
      // Tasolla 1 ei ole prosessisolmuja, joten L0-juuri merkitään "named"-konseptijuureksi
      nodes[rootUri]!.definition = "named";
    }
    const registry = buildRegistry(baseGraph);
    const validation = validateGraph(baseGraph, registry);
    const gapReport = analyzeGaps(baseGraph, tpl);
    return {
      graph: baseGraph,
      registry,
      validation,
      gapReport,
      simulationRun: null,
      day1BottleneckUri: null,
      stagesExecuted,
      groupingSuggestions,
    };
  }

  // =========================================================================
  // VAIHE 3: L1-arvovirta ja tukikaistat (sekä L1-tiheysvahti TSD 3.4)
  // =========================================================================
  stagesExecuted.push(3);

  const l1ValueUris: EntityURI[] = [];
  const l1EnablingUris: EntityURI[] = [];

  const defaultMechanisms = (): MechanismBinding[] => {
    const mechs: MechanismBinding[] = [];
    if (roleUris[0]) {
      mechs.push({
        capability: roleUris[0],
        capacityContribution: { const: 1_000_000 },
        critical: true,
        fallbackMultiplier: { const: 0.35 },
      });
    }
    for (const sysItem of systemSpecsWithUris) {
      const tpMod =
        sysItem.spec.throughputModifier !== undefined
          ? registerFactor(
              `sys_${sanitizeSlug(sysItem.spec.slug)}_tpMod`,
              `${sysItem.spec.name} Throughput Modifier`,
              sysItem.spec.throughputModifier,
              1,
              "ratio",
            )
          : undefined;
      mechs.push({
        capability: sysItem.uri,
        capacityContribution: { const: 1_000_000 },
        ...(tpMod ? { modifiers: { throughput: tpMod } } : {}),
        ...(sysItem.spec.rolloutLeadTicks !== undefined
          ? {
              rollout: {
                startTick: 0,
                leadTicks: sysItem.spec.rolloutLeadTicks,
                dipDepth: { const: resolveNumeric(sysItem.spec.rolloutDipDepth, 0.15) },
                dipTicks: sysItem.spec.rolloutDipTicks ?? 14,
              },
            }
          : {}),
        critical: sysItem.spec.critical ?? false,
        fallbackMultiplier: { const: 0.7 },
      });
    }
    if (assetUris[0]) {
      mechs.push({
        capability: assetUris[0],
        capacityContribution: { const: 1_000_000 },
        critical: false,
        fallbackMultiplier: { const: 0.8 },
      });
    }
    return mechs;
  };

  // 3a. Valinnaiset hankintasolmut (Vaihe 5)
  if (spec.step5Sourcing?.enabled) {
    for (const sup of spec.step5Sourcing.suppliers ?? []) {
      const sSlug = sanitizeSlug(sup.slug);
      const sUri: EntityURI = `apex://node/sourcing_${sSlug}`;
      l1ValueUris.push(sUri);
      const unitUri: EntityURI = `apex://unit/${sanitizeSlug(sup.unitSlug || "items")}`;
      if (!units[unitUri]) {
        units[unitUri] = {
          uri: unitUri,
          name: sup.unitSlug || "Items",
          nature: "discrete",
          measure: "pcs",
          decayPerTick: { const: 0 },
        };
      }
      const unitCostRef = registerFactor(
        `sup_${sSlug}_unitCost`,
        `${sup.name} Unit Cost`,
        sup.unitCost,
        10,
        "EUR/unit",
      );
      const leadRef = registerFactor(
        `sup_${sSlug}_leadTicks`,
        `${sup.name} Lead Time`,
        sup.leadTimeTicks,
        7,
        "d",
      );
      nodes[sUri] = {
        uri: sUri,
        name: sup.name,
        level: 1,
        band: "value_stream",
        definition: sup.definition ?? "defined",
        tags: ["sourcing"],
        parent: rootUri,
        children: [],
        ports: [
          {
            id: "out",
            name: "Supplied Input",
            side: "O",
            unit: unitUri,
            ratio: { const: 1 },
            role: "primary",
          },
        ],
        physics: [
          {
            atom: "physical_matter",
            params: {
              unitsPerMonth: { const: 300 },
              unitPrice: { const: 0 },
              unitCost: unitCostRef,
              spoilageRate: { const: 0 },
              stockCoverDays: leadRef,
              capacityUnitsPerMonth: { const: -1 },
            },
          },
        ],
        ...(sup.bufferMaxUnits !== undefined
          ? {
              buffer: {
                maxUnits: { const: resolveNumeric(sup.bufferMaxUnits, 500) },
                holdingCostPerUnit: { const: resolveNumeric(sup.holdingCostPerUnit, 0.05) },
              },
            }
          : {}),
        mechanisms: defaultMechanisms(),
        owner: roleUris[0],
        ledgerBindings: [],
        kpis: [],
      };
    }
  }

  // 3b. Asiakashankinta- ja vastaanottovaiheet (Vaihe 4)
  for (const ch of spec.step4Channels.stages ?? []) {
    const cSlug = sanitizeSlug(ch.slug);
    const cUri: EntityURI = `apex://node/channel_${cSlug}`;
    l1ValueUris.push(cUri);
    const convRef = registerFactor(
      `ch_${cSlug}_conv`,
      `${ch.name} Conversion`,
      ch.conversionRate,
      0.25,
      "ratio",
    );
    const costRef = registerFactor(
      `ch_${cSlug}_cost`,
      `${ch.name} Cost Per Unit`,
      ch.costPerUnit,
      2,
      "EUR",
    );
    const capRef = registerFactor(
      `ch_${cSlug}_cap`,
      `${ch.name} Capacity Per Tick`,
      ch.capacityPerTick,
      200,
      "tx/d",
    );
    nodes[cUri] = {
      uri: cUri,
      name: ch.name,
      level: 1,
      band: "value_stream",
      definition: ch.definition ?? "defined",
      tags: ["channel"],
      parent: rootUri,
      children: [],
      ports: [
        {
          id: "in",
          name: "Inbound Leads",
          side: "I",
          unit: "apex://unit/transactions",
          ratio: { const: 1 },
        },
        {
          id: "out",
          name: "Qualified Demand",
          side: "O",
          unit: "apex://unit/transactions",
          ratio: convRef,
          role: "primary",
        },
      ],
      physics: [
        {
          atom: "transactional_trade",
          params: {
            visitorsPerDay: capRef,
            conversionRate: convRef,
            averageTicket: { const: 0 },
            costPerSale: costRef,
            openDaysPerMonth: { const: 30 },
            capacityPerDay: capRef,
          },
        },
      ],
      mechanisms: defaultMechanisms(),
      owner: roleUris[0],
      ledgerBindings: [],
      kpis: [],
    };
  }

  // 3c. Ydintarjoomat / Arvonmuodostussolmut (Vaihe 2 & Vaihe 6)
  for (const off of spec.step2Recipes.offerings) {
    const oSlug = sanitizeSlug(off.slug);
    const oUri: EntityURI = `apex://node/${oSlug}`;
    l1ValueUris.push(oUri);

    const outUnitUri: EntityURI = `apex://unit/${sanitizeSlug(off.outputUnitSlug || "items")}`;
    const inUnitUri: EntityURI = `apex://unit/${sanitizeSlug(off.inputUnitSlug || "items")}`;
    if (!units[outUnitUri]) {
      units[outUnitUri] = {
        uri: outUnitUri,
        name: off.outputUnitSlug || "Output",
        nature: "discrete",
        measure: "pcs",
        decayPerTick: { const: 0 },
      };
    }

    const paramRefs: Record<string, FactorRef> = {};
    for (const [k, v] of Object.entries(off.params)) {
      const isDemandKey =
        k === "demandHoursPerMonth" ||
        k === "unitsPerMonth" ||
        k === "newPerMonth" ||
        k === "visitorsPerDay";
      paramRefs[k] = registerFactor(
        `${oSlug}_${k}`,
        `${off.name} · ${k}`,
        v,
        0,
        "unit",
        `${oSlug}.${k}`,
        isDemandKey
          ? {
              temporal: spec.step3Market.temporalWaves,
              monthlyMultipliers: spec.step3Market.monthlyMultipliers,
            }
          : undefined,
      );
    }

    const priceKey =
      off.atom === "time_capacity"
        ? "hourlyRate"
        : off.atom === "physical_matter"
          ? "unitPrice"
          : off.atom === "recurring_subscription"
            ? "pricePerMonth"
            : "averageTicket";
    const priceRef = paramRefs[priceKey] ?? { const: 100 };

    const revenueModule: PhysicsModule = {
      atom: off.atom,
      params: paramRefs,
    };
    const creditModule: PhysicsModule = {
      atom: "credit_working_capital",
      params: {
        customerTermsDays: customerTermsRef,
        supplierTermsDays: supplierTermsRef,
        badDebtRate: badDebtRef,
        unitPrice: priceRef,
      },
    };

    const bcUris = Object.keys(businessCapabilities) as EntityURI[];
    for (const bcUri of bcUris) {
      businessCapabilities[bcUri]!.realizedBy.push(oUri);
    }

    nodes[oUri] = {
      uri: oUri,
      name: off.name,
      level: 1,
      band: "value_stream",
      definition: off.definition ?? "defined",
      realizes: bcUris,
      tags: ["offering", off.atom],
      parent: rootUri,
      children: [],
      ports: [
        {
          id: "demand_in",
          name: "Demand Input",
          side: "I",
          unit: inUnitUri,
          ratio:
            typeof off.inputRatio === "object" && off.inputRatio !== null
              ? off.inputRatio
              : { const: resolveNumeric(off.inputRatio, 1) },
        },
        {
          id: "value_out",
          name: "Primary Output",
          side: "O",
          unit: outUnitUri,
          ratio: { const: 1 },
          role: "primary",
        },
        {
          id: "revenue_posting",
          name: "Revenue Posting",
          side: "O",
          unit: "apex://unit/monetary",
          ratio: priceRef,
          role: "posting",
        },
      ],
      physics: [revenueModule, creditModule],
      mechanisms: defaultMechanisms(),
      owner: roleUris[0],
      ledgerBindings: [],
      kpis: [],
    };
  }

  // 3d. Tukitoiminnot / Kiinteät kulut (Vaihe 6)
  for (const fc of spec.step6BusinessModel.fixedCosts) {
    const fSlug = sanitizeSlug(fc.slug);
    const fUri: EntityURI = `apex://node/enabling_${fSlug}`;
    l1EnablingUris.push(fUri);
    const dailyCostRef = registerFactor(
      `fc_${fSlug}_perTick`,
      `${fc.name} Per Tick`,
      resolveNumeric(fc.amountPerMonth, 300) / 30,
      10,
      "EUR/d",
      `fixed.${fSlug}`,
    );
    nodes[fUri] = {
      uri: fUri,
      name: fc.name,
      level: 1,
      band: "enabling",
      definition: "defined",
      tags: ["enabling", fc.category ?? "admin"],
      parent: rootUri,
      children: [],
      ports: [
        {
          id: "cost_posting",
          name: "Overhead Outflow",
          side: "O",
          unit: "apex://unit/monetary",
          ratio: { const: 1 },
          role: "posting",
        },
      ],
      physics: [
        {
          atom: "time_capacity",
          params: {
            capacityPerTick: { const: 0 },
            cycleTicks: { const: 1 },
            firstPassYield: { const: 1 },
            variableCost: { const: 0 },
            fixedCostPerTick: dailyCostRef,
          },
        },
      ],
      mechanisms: [],
      owner: roleUris[0],
      ledgerBindings: [],
      kpis: [],
    };
  }

  // 3e. L1-tiheysvahti (TSD 3.4): Ydinarvovirta max 8 laatikkoa, tukikaista max 6 laatikkoa
  const enforceBandLimit = (
    uris: EntityURI[],
    maxAllowed: number,
    band: "value_stream" | "enabling",
    groupSlug: string,
    groupName: string,
  ): EntityURI[] => {
    if (uris.length <= maxAllowed) return uris;
    const kept = uris.slice(0, maxAllowed - 1);
    const overflow = uris.slice(maxAllowed - 1);
    const groupUri: EntityURI = `apex://node/${groupSlug}`;

    for (const chUri of overflow) {
      const ch = nodes[chUri];
      if (ch) {
        ch.parent = groupUri;
        ch.level = 2;
      }
    }

    const firstOverflow = overflow[0]!;
    nodes[groupUri] = {
      uri: groupUri,
      name: groupName,
      level: 1,
      band,
      definition: "defined",
      tags: ["grouped_cluster"],
      parent: rootUri,
      children: overflow,
      ports: [
        {
          id: "cluster_out",
          name: "Cluster Output",
          side: "O",
          unit: "apex://unit/monetary",
          ratio: { const: 1 },
          role: "primary",
          delegatesTo: { node: firstOverflow, port: "value_out" },
        },
      ],
      mechanisms: [],
      owner: roleUris[0],
      ledgerBindings: [],
      kpis: [],
    };

    groupingSuggestions.push({
      band,
      groupNodeUri: groupUri,
      groupedChildUris: overflow,
      reason: `L1-${band}-kaistalla oli ${uris.length} solmua (suositusraja ${maxAllowed}). Ylimenevät ${overflow.length} solmua ryhmiteltiin emosolmun "${groupName}" alle (TSD 3.4).`,
    });

    return [...kept, groupUri];
  };

  const finalL1Value = enforceBandLimit(
    l1ValueUris,
    8,
    "value_stream",
    "value_stream_cluster",
    "Arvovirran aliryhmä (L1-kooste)",
  );
  const finalL1Enabling = enforceBandLimit(
    l1EnablingUris,
    6,
    "enabling",
    "enabling_support_cluster",
    "Tukitoimintojen aliryhmä (L1-kooste)",
  );

  // =========================================================================
  // VAIHE 4: L2–Ln-purku (Alivaiheet ja laatuportit)
  // =========================================================================
  stagesExecuted.push(4);

  for (const off of spec.step2Recipes.offerings) {
    if (!off.substeps || off.substeps.length === 0) continue;
    const oSlug = sanitizeSlug(off.slug);
    const parentUri: EntityURI = `apex://node/${oSlug}`;
    const parentNode = nodes[parentUri];
    if (!parentNode) continue;

    const basePhysics = parentNode.physics ?? [];
    const childUris: EntityURI[] = [];

    for (let i = 0; i < off.substeps.length; i++) {
      const sub = off.substeps[i]!;
      const subSlug = sanitizeSlug(sub.slug);
      const childUri: EntityURI = `apex://node/${oSlug}_${subSlug}`;
      childUris.push(childUri);
      const isLast = i === off.substeps.length - 1;

      nodes[childUri] = {
        uri: childUri,
        name: sub.name,
        level: parentNode.level + 1,
        band: "value_stream",
        definition: sub.definition ?? parentNode.definition ?? "defined",
        tags: ["substep"],
        parent: parentUri,
        children: [],
        ports: [
          {
            id: "in",
            name: "Step Input",
            side: "I",
            unit: "apex://unit/items",
            ratio: { const: 1 },
          },
          {
            id: "out",
            name: "Step Output",
            side: "O",
            unit: "apex://unit/items",
            ratio: { const: 1 },
            role: "primary",
          },
        ],
        physics: isLast
          ? basePhysics
          : [
              {
                atom: "time_capacity",
                params: {
                  capacityPerTick: { const: resolveNumeric(sub.capacityPerTick, 300) },
                  cycleTicks: { const: resolveNumeric(sub.cycleTicks, 1) },
                  firstPassYield: { const: resolveNumeric(sub.firstPassYield, 0.99) },
                  variableCost: { const: 0 },
                  fixedCostPerTick: { const: 0 },
                },
              },
            ],
        mechanisms: parentNode.mechanisms.map((m) => ({ ...m })),
        owner: parentNode.owner,
        ledgerBindings: [],
        kpis: [],
      };
    }

    parentNode.children = childUris;
    delete parentNode.physics;
  }

  // Päivitetään L0-juuren lapset
  const rootChildren = [...finalL1Value, ...finalL1Enabling];
  nodes[rootUri]!.children = rootChildren;
  if (rootChildren.length === 0) {
    nodes[rootUri]!.definition = "named";
  } else {
    const firstChild = rootChildren[0]!;
    nodes[rootUri]!.ports = [
      {
        id: "root_out",
        name: "Enterprise Output",
        side: "O",
        unit: "apex://unit/monetary",
        ratio: { const: 1 },
        role: "primary",
        delegatesTo: { node: firstChild, port: "value_out" },
      },
    ];
  }

  // =========================================================================
  // VAIHE 5: Virtojen kytkentä ja koostevirrat (Streams & Bundling)
  // =========================================================================
  stagesExecuted.push(5);

  for (let i = 1; i < finalL1Value.length; i++) {
    const fromUri = finalL1Value[i - 1]!;
    const toUri = finalL1Value[i]!;
    const fromNode = nodes[fromUri]!;
    const toNode = nodes[toUri]!;
    const outPort = fromNode.ports.find((p) => p.side === "O")?.id ?? "out";
    const inPort = toNode.ports.find((p) => p.side === "I")?.id ?? "in";
    const sUri: EntityURI = `apex://stream/l1_chain_${i}`;
    streams[sUri] = {
      uri: sUri,
      name: `${fromNode.name} → ${toNode.name}`,
      parent: null,
      children: [],
      from: { node: fromUri, port: outPort },
      to: { node: toUri, port: inPort },
      unit: "apex://unit/items",
      routing: { kind: "direct" },
      latencyTicks: { const: 0 },
      lossRate: { const: 0 },
      transferCost: { const: 0 },
    };
  }

  // Kytketään myös L2-alivaiheiden sisäiset virrat ja niputetaan ne emovirtaan
  for (const n of Object.values(nodes)) {
    if (n.children.length > 1 && n.uri !== rootUri) {
      const parentStreamUri: EntityURI = `apex://stream/bundle_${sanitizeSlug(n.uri.slice("apex://node/".length))}`;
      const childStreamUris: EntityURI[] = [];
      for (let i = 1; i < n.children.length; i++) {
        const prev = n.children[i - 1]!;
        const curr = n.children[i]!;
        const csUri: EntityURI = `${parentStreamUri}_s${i}` as EntityURI;
        childStreamUris.push(csUri);
        streams[csUri] = {
          uri: csUri,
          name: `${nodes[prev]?.name ?? prev} → ${nodes[curr]?.name ?? curr}`,
          parent: parentStreamUri,
          children: [],
          from: { node: prev, port: "out" },
          to: { node: curr, port: "in" },
          unit: "apex://unit/items",
          routing: { kind: "direct" },
          latencyTicks: { const: 0 },
          lossRate: { const: 0 },
          transferCost: { const: 0 },
        };
      }
      streams[parentStreamUri] = {
        uri: parentStreamUri,
        name: `${n.name} (Bundled Flow)`,
        parent: null,
        children: childStreamUris,
        from: { node: n.children[0]!, port: "out" },
        to: { node: n.children[n.children.length - 1]!, port: "in" },
        unit: "apex://unit/items",
        routing: { kind: "direct" },
        latencyTicks: { const: 0 },
        lossRate: { const: 0 },
        transferCost: { const: 0 },
      };
    }
  }

  // Jos kypsyystaso on 2, palautetaan graafi ja aukkoanalyysi ilman pakotettua kalibrointisimulaatiota
  if (maturity === 2) {
    const registry = buildRegistry(baseGraph);
    const validation = validateGraph(baseGraph, registry);
    const gapReport = analyzeGaps(baseGraph, tpl);
    return {
      graph: baseGraph,
      registry,
      validation,
      gapReport,
      simulationRun: null,
      day1BottleneckUri: null,
      stagesExecuted,
      groupingSuggestions,
    };
  }

  // =========================================================================
  // VAIHE 6: Indeksi, Rollup, Invarianttivalidointi ja Kalibrointiajo (Taso 3)
  // =========================================================================
  stagesExecuted.push(6);

  const registry = buildRegistry(baseGraph);
  const validation = validateGraph(baseGraph, registry);
  const gapReport = analyzeGaps(baseGraph, tpl);
  const simulationRun = simulateGraph(baseGraph, { registry });

  return {
    graph: baseGraph,
    registry,
    validation,
    gapReport,
    simulationRun,
    day1BottleneckUri: simulationRun.bottleneckNodeUri,
    stagesExecuted,
    groupingSuggestions,
  };
}
