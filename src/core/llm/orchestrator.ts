/**
 * Provider-Agnostic Cognitive Orchestrator for Engine B & Module 1.
 *
 * Connects the multi-provider LLM client to:
 *  - C-Suite War Room Briefings (COO, CFO, CRO, CHRO + Debate Transcript)
 *  - Two-Phase Commit action validation (`validateAction`)
 *  - Archetype-bounded Business DNA synthesis
 */
import type { WarRoomBriefing } from "../agents";
import { generateWarRoomBriefing } from "../agents";
import { ARCHETYPE_BASELINES, buildEvolutionStagesForNameAndIndustry } from "../compiler";
import { ASSUMPTION_KEYS, type AssumptionKey, applyAssumptionUpdate } from "../compiler/assumptions";
import { validateAction } from "../engine/actions";
import { buildBalanceSheet, buildIncomeStatement } from "../engine/ledger";
import { resolveOfferingPrice } from "../engine/market";
import { totalHeadcount } from "../engine/org";
import { unitBookCost } from "../engine/warehouse";
import {
  ActionPayload,
  type DomainUiConfig,
  type IndustryArchetype,
  type WorldState,
} from "../schema";
import { callLlmJson, getActiveLlmConfig, isLlmConfigured } from "./client";
import { buildDefaultMarketIntelligence } from "./market-research";
import { type LlmCallMetadata, type LlmConfig, PROVIDER_PRESETS } from "./types";

interface DnaSynthesisResponse {
  companyName?: string;
  industry?: string;
  tagline?: string;
  physicsExplanation?: string;
  archetype?: IndustryArchetype;
  isServiceBusiness?: boolean;
  rawItems?: Array<{ name: string; uom?: string; unitCostEuros?: number }>;
  finishedItemName?: string;
  finishedItemUom?: string;
  shelfLifeDays?: number | null;
  recipeName?: string;
  directOfferingName?: string;
  wholesaleOfferingName?: string;
  targetGrossMargin?: number;
  dailyDemand?: number;
  marketingBudgetEuros?: number;
  serviceHoursPerDay?: number;
  competitorAvgPriceEuros?: number;
  assumptionOrigins?: Partial<Record<AssumptionKey, string>>;
  capabilityNames?: string[];
  supplierNames?: string[];
  suppliers?: Array<{
    name: string;
    itemName?: string;
    unitCostEuros?: number;
    uom?: string;
    leadTimeDays?: number;
  }>;
  inboundLaneName?: string;
  facilityName?: string;
  dailyRentEuros?: number;
  handling?: "ambient" | "chilled" | "frozen";
  workCenterName?: string;
  channelNames?: string[];
  channels?: Array<{
    name: string;
    unitPriceEuros?: number;
    paymentTermsDays?: number;
  }>;
  marketSegmentNames?: string[];
  marketSegments?: Array<{
    name: string;
    wtpEuros?: number;
  }>;
  roles?: Array<{
    title: string;
    department?: string;
    annualSalaryEuros?: number;
  }>;
  competitors?: Array<{ name: string; persona: string }>;
  domainUi?: {
    valueChainColumns?: [string, string, string, string, string, string] | string[];
    nodeLabels?: Partial<DomainUiConfig["nodeLabels"]>;
    canvasConfig?: {
      roles?: Array<{
        id: "commercial" | "product" | "general_manager";
        title: string;
        sub: string;
      }>;
      capabilities?: Array<{
        key: "production" | "warehouse" | "logistics";
        icon: string;
        title: string;
        sub: string;
        inHouseLabel: string;
        outsourceLabel: string;
      }>;
      economics?: Partial<DomainUiConfig["canvasConfig"]["economics"]>;
      ignitionText?: string;
    };
  };
}

/**
 * Module 1 Live Multi-Provider LLM Generator for `compileBusinessPrompt`:
 * Synthesizes a 100% bespoke, domain-agnostic business ontology (value chain, unit economics,
 * team roles, capabilities, and UI terminology) for ANY user business prompt.
 */
export async function generateBusinessDnaPatchWithLlm(
  prompt: string,
  base: WorldState,
  configOverride?: LlmConfig,
): Promise<{ patch: Partial<WorldState>; meta: LlmCallMetadata }> {
  const cfg = configOverride ?? getActiveLlmConfig();

  if (!isLlmConfigured(cfg)) {
    return {
      patch: {},
      meta: {
        provider: cfg.provider,
        model: cfg.model || PROVIDER_PRESETS[cfg.provider].defaultModel,
        latencyMs: 0,
        live: false,
        error: `${PROVIDER_PRESETS[cfg.provider].name} key not configured`,
      },
    };
  }

  const systemInstruction = `You are the APEX Agnostic Business DNA Compiler (Zero-to-Ontology Architect).
Your mission is to translate ANY user business concept prompt into a realistic, domain-accurate, end-to-end business simulation model in the SAME LANGUAGE as the user's prompt (default to clear, practical Finnish / selkokieli).

CRITICAL RULES:
1. NEVER force the business into unrelated templates (e.g. never mention bakeries, hydroponics, pallets, or factories if the user is building a law firm, dog grooming salon, ice cream kiosk, flower shop, SaaS app, repair shop, etc.).
2. Determine if the business sells a service/expertise ("isServiceBusiness": true, zero physical inventory lots) or physical/consumable products ("isServiceBusiness": false).
3. Use realistic Euro prices, unit costs, rents, and salaries scaled to the actual business (e.g. a kiosk ice cream costs ~1.40 € and sells for ~4.50 €; a consulting day costs ~350 € and sells for ~1200 €; a haircut/grooming session sells for ~65 €).
4. Tailor all 6 valueChainColumns, nodeLabels, and canvasConfig (roles & make-vs-buy capabilities) specifically to THIS exact business in clear, practical vocational language (kauppaopistotason selkokieli, zero academic jargon).

Return ONLY valid JSON matching this schema:
{
  "companyName": "string (realistic brand name)",
  "industry": "string (exact niche, e.g. 'Koiratrimmaamo & Lemmikkipalvelut', 'Kesäinen Jäätelökioski', 'B2B Lakiasiaintoimisto')",
  "tagline": "string (1 concise sentence)",
  "physicsExplanation": "string (1-2 plain sentences explaining what drives revenue, costs, and bottlenecks in THIS specific business)",
  "archetype": "PERISHABLE_COLD_CHAIN" | "HIGH_VELOCITY_D2C" | "B2B_ENTERPRISE_SERVICES" | "PLATFORM_RECURRING" | "ASSET_HEAVY_MANUFACTURING",
  "isServiceBusiness": false,
  "suppliers": [
    { "name": "string (supplier/partner 1)", "itemName": "string (input/tool 1)", "unitCostEuros": 1.2, "uom": "string", "leadTimeDays": 2 },
    { "name": "string (supplier/partner 2)", "itemName": "string (input/tool 2)", "unitCostEuros": 0.4, "uom": "string", "leadTimeDays": 2 }
  ],
  "inboundLaneName": "string (how supplies/tools are delivered or provisioned)",
  "facilityName": "string (actual premises/workspace/system, e.g. 'Torikioski & pakastealtaat', 'Trimmaamo & pesupiste', 'Toimisto')",
  "dailyRentEuros": 45,
  "handling": "ambient" | "chilled" | "frozen",
  "workCenterName": "string (core value-creating work step)",
  "finishedItemName": "string (main product or service sold)",
  "finishedItemUom": "string (e.g. 'annos', 'käynti', 'päivä', 'kpl', 'kk')",
  "shelfLifeDays": null,
  "recipeName": "string (how 1 batch/service is prepared/delivered)",
  "channels": [
    { "name": "string (primary sales/billing channel)", "unitPriceEuros": 4.5, "paymentTermsDays": 0 },
    { "name": "string (secondary sales/billing channel)", "unitPriceEuros": 6.0, "paymentTermsDays": 0 }
  ],
  "marketSegments": [
    { "name": "string (customer group 1)", "wtpEuros": 5.0 },
    { "name": "string (customer group 2)", "wtpEuros": 6.5 }
  ],
  "roles": [
    { "title": "string (role 1)", "department": "string", "annualSalaryEuros": 34000 },
    { "title": "string (role 2)", "department": "string", "annualSalaryEuros": 26000 }
  ],
  "competitors": [
    { "name": "string", "persona": "quality_leader" },
    { "name": "string", "persona": "low_cost" },
    { "name": "string", "persona": "agile" }
  ],
  "dailyDemand": 120,
  "marketingBudgetEuros": 25,
  "serviceHoursPerDay": 8,
  "competitorAvgPriceEuros": 4.6
}`;

  const { data, meta } = await callLlmJson<DnaSynthesisResponse>({
    systemInstruction,
    userPrompt: `Synthesize complete business simulation model for user prompt: "${prompt}"`,
    temperature: 0.35,
    timeoutMs: 14_000,
    config: cfg,
    taskLabelFi: `Liikeidean & arvoketjun generointi (${prompt.slice(0, 38)}...)`,
  });

  if (!data) {
    return { patch: {}, meta };
  }

  const cloned: WorldState = structuredClone(base);
  const resolvedArchetype: IndustryArchetype =
    data.archetype && ARCHETYPE_BASELINES[data.archetype]
      ? data.archetype
      : cloned.company.archetype ?? "ASSET_HEAVY_MANUFACTURING";
  const spec = ARCHETYPE_BASELINES[resolvedArchetype];
  cloned.company.archetype = resolvedArchetype;

  if (data.companyName) cloned.company.name = String(data.companyName).slice(0, 60);
  if (data.industry) cloned.company.industry = String(data.industry).slice(0, 80);
  if (data.tagline) cloned.company.tagline = String(data.tagline).slice(0, 140);

  const isService =
    typeof data.isServiceBusiness === "boolean"
      ? data.isServiceBusiness
      : resolvedArchetype === "B2B_ENTERPRISE_SERVICES" ||
        resolvedArchetype === "PLATFORM_RECURRING";

  // 1. Suppliers & Raw Items
  const rawCatalogItems = cloned.catalog.items.filter(
    (i) => i.kind === "raw" || i.kind === "component",
  );
  if (Array.isArray(data.suppliers) && data.suppliers.length > 0) {
    data.suppliers.forEach((supSpec, idx) => {
      const sup = cloned.supply.suppliers[idx];
      const rawIt = rawCatalogItems[idx];
      if (sup && supSpec?.name) {
        sup.name = String(supSpec.name).slice(0, 60);
        if (typeof supSpec.leadTimeDays === "number" && supSpec.leadTimeDays >= 1) {
          sup.leadTimeDays = {
            kind: "fixed",
            value: Math.min(45, Math.max(1, Math.round(supSpec.leadTimeDays))),
          };
        }
        const costCents =
          typeof supSpec.unitCostEuros === "number" && supSpec.unitCostEuros > 0
            ? Math.max(20, Math.round(supSpec.unitCostEuros * 100))
            : rawIt?.standardCost ?? 500;
        if (sup.offers[0]) {
          sup.offers[0].unitPrice = costCents;
          sup.offers[0].moq =
            costCents <= 300 ? 100 : costCents <= 1500 ? 30 : costCents <= 5000 ? 15 : 5;
        }
        if (rawIt) {
          if (supSpec.itemName) rawIt.name = String(supSpec.itemName).slice(0, 60);
          if (supSpec.uom) rawIt.uom = String(supSpec.uom).slice(0, 16);
          rawIt.standardCost = costCents;
          rawIt.unitVolumeM3 = isService ? 0 : 0.04;
        }
      }
    });
  } else if (Array.isArray(data.rawItems)) {
    data.rawItems.forEach((ri, idx) => {
      if (rawCatalogItems[idx] && ri?.name) {
        rawCatalogItems[idx].name = String(ri.name).slice(0, 60);
        if (ri.uom) rawCatalogItems[idx].uom = String(ri.uom).slice(0, 16);
      }
    });
  }
  if (Array.isArray(data.supplierNames)) {
    data.supplierNames.forEach((sName, idx) => {
      if (cloned.supply.suppliers[idx] && sName) {
        cloned.supply.suppliers[idx].name = String(sName).slice(0, 60);
      }
    });
  }

  // 2. Inbound Lane & Facility
  if (data.inboundLaneName && cloned.supply.lanes[0]) {
    cloned.supply.lanes[0].name = String(data.inboundLaneName).slice(0, 70);
  }
  const handling =
    data.handling && ["ambient", "chilled", "frozen"].includes(data.handling)
      ? data.handling
      : cloned.warehouses.sites[0]?.zones[0]?.handling ?? "ambient";

  if (cloned.warehouses.sites[0]) {
    if (data.facilityName) {
      cloned.warehouses.sites[0].name = String(data.facilityName).slice(0, 60);
    }
    if (typeof data.dailyRentEuros === "number" && data.dailyRentEuros > 0) {
      cloned.warehouses.sites[0].rentPerDay = Math.max(
        10_00,
        Math.round(data.dailyRentEuros * 100),
      );
    }
    if (cloned.warehouses.sites[0].zones[0]) {
      cloned.warehouses.sites[0].zones[0].handling = handling;
    }
  }

  // 3. Work Center & Finished Item / Service
  if (data.workCenterName && cloned.operations.workCenters[0]) {
    cloned.operations.workCenters[0].name = String(data.workCenterName).slice(0, 70);
    if (cloned.operations.workCenters[0].outsource) {
      cloned.operations.workCenters[0].outsource.vendorName = `${cloned.company.name} Kumppaniverkosto`;
    }
  }

  const mainFinished = cloned.catalog.items.find(
    (i) => i.kind === "finished" || i.kind === "service",
  );
  const rawCostSum = rawCatalogItems.reduce((s, r) => s + r.standardCost, 0);
  if (mainFinished) {
    if (data.finishedItemName) {
      mainFinished.name = String(data.finishedItemName).slice(0, 60);
    }
    if (data.finishedItemUom) {
      mainFinished.uom = String(data.finishedItemUom).slice(0, 16);
    }
    mainFinished.kind = isService ? "service" : "finished";
    mainFinished.unitVolumeM3 = isService ? 0 : 0.06;
    mainFinished.handling = handling;
    mainFinished.shelfLifeDays =
      isService || data.shelfLifeDays === null
        ? undefined
        : typeof data.shelfLifeDays === "number" && data.shelfLifeDays > 0
          ? Math.round(data.shelfLifeDays)
          : mainFinished.shelfLifeDays;
    if (rawCostSum > 0) {
      mainFinished.standardCost = rawCostSum;
    }
  }

  if (cloned.catalog.recipes[0]) {
    if (data.recipeName) {
      cloned.catalog.recipes[0].name = String(data.recipeName).slice(0, 70);
    }
    cloned.catalog.recipes[0].inputs = isService
      ? []
      : rawCatalogItems.map((r) => ({ itemId: r.id, qty: 1 }));
  }

  // 4. Inventory Lots & Reorder Policies based on service vs physical
  if (isService) {
    cloned.warehouses.lots = [];
    cloned.supply.reorderPolicies = [];
    cloned.supply.usageStats = {};
  } else if (mainFinished) {
    const whId = cloned.warehouses.sites[0]?.id ?? "wh_0";
    cloned.warehouses.lots = [
      ...rawCatalogItems.map((r, idx) => ({
        id: `lot_raw_${idx + 1}`,
        itemId: r.id,
        warehouseId: whId,
        qty: 120,
        value: 120 * r.standardCost,
        receivedTick: 0,
      })),
      {
        id: "lot_finished_init",
        itemId: mainFinished.id,
        warehouseId: whId,
        qty: 30,
        value: 30 * mainFinished.standardCost,
        receivedTick: 0,
        expiryTick: mainFinished.shelfLifeDays ? mainFinished.shelfLifeDays : undefined,
      },
    ];
  }

  // 5. Channels & Offerings
  if (Array.isArray(data.channels) && data.channels.length > 0) {
    data.channels.forEach((chSpec, idx) => {
      const ch = cloned.commercial.channels[idx];
      const off = cloned.commercial.offerings[idx];
      const ost = cloned.commercial.offeringStates[idx];
      if (ch && chSpec?.name) {
        ch.name = String(chSpec.name).slice(0, 60);
        if (typeof chSpec.paymentTermsDays === "number" && chSpec.paymentTermsDays >= 0) {
          ch.paymentTermsDays = Math.min(60, Math.max(0, Math.round(chSpec.paymentTermsDays)));
        }
      }
      if (off && typeof chSpec?.unitPriceEuros === "number" && chSpec.unitPriceEuros > 0) {
        const priceCents = Math.max(150, Math.round(chSpec.unitPriceEuros * 100));
        if (off.pricing.kind === "value_based") {
          off.pricing.listPrice = priceCents;
        } else if (off.pricing.kind === "subscription") {
          off.pricing.monthlyPrice = priceCents;
        }
        if (ost) ost.lastPrice = priceCents;
      }
      if (off && mainFinished && ch) {
        off.name = `${mainFinished.name} (${ch.name})`;
      }
    });
  } else if (Array.isArray(data.channelNames)) {
    data.channelNames.forEach((cName, idx) => {
      if (cloned.commercial.channels[idx] && cName) {
        cloned.commercial.channels[idx].name = String(cName).slice(0, 60);
      }
    });
  }

  if (cloned.commercial.offerings[0] && data.directOfferingName) {
    cloned.commercial.offerings[0].name = String(data.directOfferingName).slice(0, 70);
  }
  if (cloned.commercial.offerings[1] && data.wholesaleOfferingName) {
    cloned.commercial.offerings[1].name = String(data.wholesaleOfferingName).slice(0, 70);
  }

  if (
    typeof data.targetGrossMargin === "number" &&
    Number.isFinite(data.targetGrossMargin)
  ) {
    const gm = Math.max(
      spec.grossMarginBand[0],
      Math.min(spec.grossMarginBand[1], data.targetGrossMargin),
    );
    const off0 = cloned.commercial.offerings[0];
    if (off0) {
      const unitCost = Math.max(100, unitBookCost(cloned, off0.itemId));
      const targetPrice = Math.max(200, Math.round(unitCost / (1 - gm)));
      if (off0.pricing.kind === "value_based") {
        off0.pricing.listPrice = targetPrice;
      } else if (off0.pricing.kind === "subscription") {
        off0.pricing.monthlyPrice = Math.round(
          targetPrice * Math.max(1, off0.pricing.unitsPerMonth),
        );
      }
    }
  }

  // 6. Market Segments & Competitors
  if (Array.isArray(data.marketSegments) && data.marketSegments.length > 0) {
    data.marketSegments.forEach((segSpec, idx) => {
      const seg = cloned.market.segments[idx];
      if (seg && segSpec?.name) {
        seg.name = String(segSpec.name).slice(0, 60);
        if (typeof segSpec.wtpEuros === "number" && segSpec.wtpEuros > 0) {
          seg.wtpMean = Math.max(200, Math.round(segSpec.wtpEuros * 100));
        }
      }
    });
  } else if (Array.isArray(data.marketSegmentNames)) {
    data.marketSegmentNames.forEach((segName, idx) => {
      if (cloned.market.segments[idx] && segName) {
        cloned.market.segments[idx].name = String(segName).slice(0, 60);
      }
    });
  }

  if (Array.isArray(data.competitors)) {
    data.competitors.forEach((comp, idx) => {
      if (cloned.market.competitors[idx] && comp?.name) {
        cloned.market.competitors[idx].name = String(comp.name).slice(0, 50);
        if (comp.persona) {
          cloned.market.competitors[idx].persona = String(comp.persona).slice(0, 120);
        }
      }
    });
  }

  // 7. Roles & Organization
  if (Array.isArray(data.roles) && data.roles.length > 0) {
    const validRoles = data.roles.filter((r) => r && r.title).slice(0, 4);
    if (validRoles.length > 0) {
      cloned.org.departments = validRoles.map((rSpec, idx) => ({
        id: `dept_${idx}`,
        name: String(rSpec.department || "Operatiivinen toiminta").slice(0, 50),
        headRoleId: `role_${idx}`,
      }));
      cloned.org.roles = validRoles.map((rSpec, idx) => {
        const salCents =
          typeof rSpec.annualSalaryEuros === "number" && rSpec.annualSalaryEuros > 5000
            ? Math.round(rSpec.annualSalaryEuros * 100)
            : 38_000_00;
        return {
          id: `role_${idx}`,
          title: String(rSpec.title).slice(0, 60),
          departmentId: `dept_${idx}`,
          tier: (idx === 0 ? "executive" : idx === 1 ? "specialist" : "frontline") as
            | "executive"
            | "management"
            | "specialist"
            | "frontline",
          reportsToRoleId: idx === 0 ? undefined : "role_0",
          annualSalary: salCents,
          marketSalary: salCents,
          benefitsLoad: 0.2,
          hoursPerDay: 8,
          isManager: idx === 0,
          idealSpan: idx === 0 ? 6 : 0,
          isDirectLabor: idx === 1,
          rampDays: 14,
          recruitingLeadDays: { kind: "fixed" as const, value: 7 },
          recruitingCost: Math.max(500_00, Math.round(salCents * 0.04)),
          severanceWeeks: 2,
          sales:
            idx === 0
              ? {
                  leadsPerDay: 0.5,
                  maxOpenOpportunities: 12,
                  segmentIds: cloned.market.segments.map((s) => s.id),
                }
              : undefined,
        };
      });
      cloned.org.positions = cloned.org.roles.map((r) => ({
        roleId: r.id,
        cohorts: [{ count: 1, hiredTick: 0 }],
        pendingHires: [],
        morale: 0.88,
        proficiency: 0.9,
        fatigue: 0.08,
        overtimeHoursPerPerson: 0,
        attritionYtd: 0,
        laborHoursAvailable: 8,
        laborHoursUsed: 0,
      }));
      const opRoleId = cloned.org.roles[1]?.id ?? cloned.org.roles[0].id;
      if (cloned.operations.workCenters[0]) {
        cloned.operations.workCenters[0].laborRoleId = opRoleId;
      }
      if (cloned.warehouses.sites[0]) {
        cloned.warehouses.sites[0].laborRoleId = opRoleId;
      }
      cloned.org.processes = [
        {
          id: "proc_core_ops",
          name: `${cloned.operations.workCenters[0]?.name || "Palvelutuotanto"} — Laatu & Toimitusvarmuus`,
          capabilityId: cloned.operations.capabilities[0]?.id,
          accountableRoleId: cloned.org.roles[0].id,
          responsibleRoleIds: [opRoleId],
          consultedRoleIds: [],
          informedRoleIds: [],
          criticality: 4,
          complianceCritical: true,
          fineCents: 2_500_00,
        },
        {
          id: "proc_commercial",
          name: `${cloned.commercial.channels[0]?.name || "Myynti"} — Asiakaspalvelu & Laskutus`,
          capabilityId: cloned.operations.capabilities[2]?.id ?? cloned.operations.capabilities[0]?.id,
          accountableRoleId: cloned.org.roles[0].id,
          responsibleRoleIds: [cloned.org.roles[0].id],
          consultedRoleIds: [],
          informedRoleIds: [],
          criticality: 3,
          complianceCritical: false,
          fineCents: 0,
        },
      ];
    }
  }

  // 8. Bespoke DomainUiConfig & Capabilities
  if (cloned.company.domainUi) {
    const ui = cloned.company.domainUi;
    ui.industryLabel = cloned.company.industry;
    if (data.physicsExplanation) {
      ui.physicsExplanation = String(data.physicsExplanation).slice(0, 320);
    }
    if (data.domainUi) {
      if (
        Array.isArray(data.domainUi.valueChainColumns) &&
        data.domainUi.valueChainColumns.length === 6
      ) {
        ui.valueChainColumns = [
          String(data.domainUi.valueChainColumns[0]).slice(0, 40),
          String(data.domainUi.valueChainColumns[1]).slice(0, 40),
          String(data.domainUi.valueChainColumns[2]).slice(0, 40),
          String(data.domainUi.valueChainColumns[3]).slice(0, 40),
          String(data.domainUi.valueChainColumns[4]).slice(0, 40),
          String(data.domainUi.valueChainColumns[5]).slice(0, 40),
        ];
      }
      if (data.domainUi.nodeLabels) {
        ui.nodeLabels = {
          ...ui.nodeLabels,
          ...Object.fromEntries(
            Object.entries(data.domainUi.nodeLabels)
              .filter(([_, v]) => typeof v === "string" && v.trim().length > 0)
              .map(([k, v]) => [k, String(v).slice(0, 50)]),
          ),
        };
      }
      if (data.domainUi.canvasConfig) {
        if (
          Array.isArray(data.domainUi.canvasConfig.roles) &&
          data.domainUi.canvasConfig.roles.length === 3
        ) {
          ui.canvasConfig.roles = data.domainUi.canvasConfig.roles.map((r, idx) => ({
            id: (["commercial", "product", "general_manager"][idx] ?? "commercial") as
              | "commercial"
              | "product"
              | "general_manager",
            title: String(r.title || ui.canvasConfig.roles[idx]?.title || "").slice(0, 70),
            sub: String(r.sub || ui.canvasConfig.roles[idx]?.sub || "").slice(0, 180),
          }));
        }
        if (
          Array.isArray(data.domainUi.canvasConfig.capabilities) &&
          data.domainUi.canvasConfig.capabilities.length === 3
        ) {
          ui.canvasConfig.capabilities = data.domainUi.canvasConfig.capabilities.map(
            (c, idx) => ({
              key: (["production", "warehouse", "logistics"][idx] ?? "production") as
                | "production"
                | "warehouse"
                | "logistics",
              icon: String(c.icon || "✨").slice(0, 8),
              title: String(c.title || "").slice(0, 65),
              sub: String(c.sub || "").slice(0, 200),
              inHouseLabel: String(c.inHouseLabel || "Oma toiminta").slice(0, 40),
              outsourceLabel: String(c.outsourceLabel || "Kumppani").slice(0, 40),
            }),
          );
          ui.canvasConfig.capabilities.forEach((cSpec, idx) => {
            if (cloned.operations.capabilities[idx]) {
              cloned.operations.capabilities[idx].name = cSpec.title;
              cloned.operations.capabilities[idx].description = cSpec.sub;
              cloned.operations.capabilities[idx].ownerRoleId =
                cloned.org.roles[idx % cloned.org.roles.length]?.id ?? "role_0";
            }
          });
        }
        if (data.domainUi.canvasConfig.economics) {
          ui.canvasConfig.economics = {
            ...ui.canvasConfig.economics,
            ...Object.fromEntries(
              Object.entries(data.domainUi.canvasConfig.economics)
                .filter(([_, v]) => typeof v === "string" && v.trim().length > 0)
                .map(([k, v]) => [k, String(v).slice(0, 65)]),
            ),
          };
        }
        if (data.domainUi.canvasConfig.ignitionText) {
          ui.canvasConfig.ignitionText = String(data.domainUi.canvasConfig.ignitionText).slice(
            0,
            320,
          );
        }
      }
    } else {
      const itemTitle = data.finishedItemName || (isService ? "Asiantuntijapalvelu" : "Päätuote");
      const facTitle = data.facilityName || (isService ? "Toimisto & Etätyöpiste" : "Toimipiste & Varasto");
      const supTitle = data.suppliers?.[0]?.name || (isService ? "Työkalut & Lisenssit" : "Päähankkijat");
      const wcTitle = data.workCenterName || (isService ? "Palvelutoimitus" : "Valmistusprosessi");
      const chanTitle = data.channels?.[0]?.name || "Myyntikanava";

      ui.valueChainColumns = isService
        ? ["1. Kumppanit", "2. Työkalut", "3. Työtila", "4. Toimitus", "5. Myynti", "6. Asiakkaat"]
        : ["1. Hankinta", "2. Logistiikka", "3. Toimipiste", "4. Tuotanto", "5. Myynti", "6. Asiakkaat"];

      ui.nodeLabels.supplierTag = supTitle.slice(0, 24);
      ui.nodeLabels.facilityTag = facTitle.slice(0, 24);
      ui.nodeLabels.workCenterTag = wcTitle.slice(0, 24);
      ui.nodeLabels.channelTag = chanTitle.slice(0, 24);
      ui.canvasConfig.economics.itemLabel = itemTitle.slice(0, 24);
      ui.canvasConfig.economics.itemSub = `${cloned.company.industry} — suorite/yksikkö`;
    }
  }

  if (Array.isArray(data.capabilityNames)) {
    data.capabilityNames.forEach((capName, idx) => {
      if (cloned.operations.capabilities[idx] && capName) {
        cloned.operations.capabilities[idx].name = String(capName).slice(0, 65);
      }
    });
  }

  cloned.company.ventureStage = 1;
  if (cloned.company.domainUi) {
    cloned.company.domainUi.evolutionStages = buildEvolutionStagesForNameAndIndustry(
      cloned.company.name,
      cloned.company.industry,
      cloned.warehouses.sites[0]?.name ?? "Toimipiste",
      cloned.operations.workCenters[0]?.name ?? "Valmistus & Palvelu",
      cloned.commercial.channels[0]?.name ?? "Myyntikanava",
    );
  }

  // Apply remaining quantitative assumption variables & LLM assumption origins
  if (!cloned.company.assumptionOrigins) {
    cloned.company.assumptionOrigins = {};
  }
  if (data.assumptionOrigins) {
    for (const k of ASSUMPTION_KEYS) {
      const txt = data.assumptionOrigins[k];
      if (typeof txt === "string" && txt.trim().length > 0) {
        cloned.company.assumptionOrigins[k] = txt.trim();
      }
    }
  }
  for (const k of ASSUMPTION_KEYS) {
    if (!cloned.company.assumptionOrigins[k]) {
      cloned.company.assumptionOrigins[k] = `Toimialan (${cloned.company.industry}) markkinadataan ja liiketoimintamalliin pohjautuva arvio yritykselle ${cloned.company.name}.`;
    }
  }
  if (typeof data.dailyDemand === "number" && data.dailyDemand > 0) {
    applyAssumptionUpdate(cloned, "daily_demand", data.dailyDemand, {
      markCustomized: false,
      silent: true,
    });
  }
  if (typeof data.marketingBudgetEuros === "number" && data.marketingBudgetEuros >= 0) {
    applyAssumptionUpdate(cloned, "marketing_budget", data.marketingBudgetEuros, {
      markCustomized: false,
      silent: true,
    });
  }
  if (typeof data.serviceHoursPerDay === "number" && data.serviceHoursPerDay >= 1) {
    applyAssumptionUpdate(cloned, "service_capacity", data.serviceHoursPerDay, {
      markCustomized: false,
      silent: true,
    });
  }
  if (typeof data.competitorAvgPriceEuros === "number" && data.competitorAvgPriceEuros > 0) {
    applyAssumptionUpdate(cloned, "competitor_price", data.competitorAvgPriceEuros, {
      markCustomized: false,
      silent: true,
    });
  }

  const defaultIntel = buildDefaultMarketIntelligence(cloned);
  cloned.company.marketIntelligence = {
    ...defaultIntel,
    usedLiveLlm: true,
    providerLabel: `${meta.provider.toUpperCase()} (${meta.model})`,
    executiveSummary: data.physicsExplanation
      ? `${data.physicsExplanation} ${defaultIntel.executiveSummary}`
      : defaultIntel.executiveSummary,
  };

  // Update debt & fixed asset names to match synthesized company
  if (cloned.finance.debts[0]) {
    cloned.finance.debts[0].lender = `${cloned.company.name} — Yritysluotto & Kassalimiitti`;
  }
  if (cloned.finance.debts[1]) {
    cloned.finance.debts[1].lender = `${cloned.company.name} — Kalusto- & Investointilaina`;
  }
  if (cloned.finance.fixedAssets[0]) {
    cloned.finance.fixedAssets[0].name = `${cloned.warehouses.sites[0]?.name || cloned.company.name} — Kalusto & Laitteisto`;
  }

  return { patch: cloned, meta };
}

/**
 * Engine B Multi-Provider C-Suite War Room Briefing:
 *  - Works with Gemini, OpenAI, Anthropic, or Deterministic engine.
 *  - Builds telemetry snapshot from Engine A (`WorldState`).
 *  - Validates every proposed `ActionPayload` via `validateAction(state, action)` (Two-Phase Commit Phase 1).
 */
export async function generateWarRoomBriefingWithLlm(
  state: WorldState,
  configOverride?: LlmConfig,
): Promise<{ briefing: WarRoomBriefing; meta: LlmCallMetadata }> {
  const cfg = configOverride ?? getActiveLlmConfig();
  const fallback = generateWarRoomBriefing(state);

  if (!isLlmConfigured(cfg)) {
    return {
      briefing: fallback,
      meta: {
        provider: cfg.provider,
        model: cfg.model || PROVIDER_PRESETS[cfg.provider].defaultModel,
        latencyMs: 0,
        live: false,
        error: `${PROVIDER_PRESETS[cfg.provider].name} key not configured`,
      },
    };
  }

  const bs = buildBalanceSheet(state.finance.ledger);
  const is = buildIncomeStatement(state.finance.ledger);
  const lastKpi = state.telemetry.daily[state.telemetry.daily.length - 1];
  const wc0 = state.operations.workCenters[0];
  const wh0 = state.warehouses.sites[0];
  const off0 = state.commercial.offerings[0];
  const off0Price = off0 ? resolveOfferingPrice(state, off0).netUnitPrice : 50_00;

  const stateDigest = {
    company: {
      name: state.company.name,
      industry: state.company.industry,
      archetype: state.company.archetype,
      day: state.calendar.tick,
    },
    financialsDollars: {
      cash: Math.round(bs.assets.cash / 100),
      accountsReceivable: Math.round(bs.assets.accountsReceivable / 100),
      accountsPayable: Math.round(bs.liabilities.accountsPayable / 100),
      mtdNetRevenue: Math.round(is.netRevenue / 100),
      mtdGrossProfit: Math.round(is.grossProfit / 100),
      mtdEbitda: Math.round(is.ebitda / 100),
      runwayDays: lastKpi?.runwayDays ?? "cash-positive",
      cccDays: Number((lastKpi?.ccc ?? 0).toFixed(1)),
      dsoDays: Number((lastKpi?.dso ?? 0).toFixed(1)),
      dioDays: Number((lastKpi?.dio ?? 0).toFixed(1)),
      dpoDays: Number((lastKpi?.dpo ?? 0).toFixed(1)),
    },
    operations: {
      workCenterId: wc0?.id,
      workCenterName: wc0?.name,
      utilizationPct: Number(((wc0?.telemetry.utilization ?? 0) * 100).toFixed(1)),
      littlesLawQueueL: Number((wc0?.telemetry.littlesL ?? 0).toFixed(2)),
      avgWaitDaysW: Number((wc0?.telemetry.avgWaitDays ?? 1).toFixed(2)),
      conditionPct: Number(((wc0?.condition ?? 1) * 100).toFixed(1)),
      warehouseId: wh0?.id,
      warehouseUtilizationPct: Number(((wh0?.telemetry.utilization ?? 0) * 100).toFixed(1)),
      fillRatePct: Number(((lastKpi?.fillRate ?? 1) * 100).toFixed(1)),
    },
    organization: {
      headcount: totalHeadcount(state),
      governanceDriftPct: Number((state.org.governance.drift * 100).toFixed(1)),
      roles: state.org.roles.map((r) => ({ id: r.id, title: r.title })),
    },
    validIds: {
      offeringId: off0?.id,
      currentOfferingPriceCents: off0Price,
      marketingChannelId: state.commercial.marketing[0]?.id,
      salesChannelId: state.commercial.channels[0]?.id,
      workCenterId: wc0?.id,
      warehouseId: wh0?.id,
      capabilityId: state.operations.capabilities[0]?.id,
      supplierId: state.supply.suppliers[0]?.id,
      rawItemId: state.catalog.items[0]?.id,
      laneId: state.supply.lanes[0]?.id,
    },
    activeTriggers: state.lastTriggers ?? [],
  };

  const systemInstruction = `You are Engine B — the Multi-Agent Advisory & Management Team for "${state.company.name}" (${state.company.industry}).
Write all responses in clear, practical Finnish (selkokieli, understandable to any practical business owner, avoiding academic jargon like Little's Law or stochastic processes).
Simulate 4 advisors debating concrete next steps for this exact business:
- "coo" (Operatiivinen vastaava — tuotanto, toimitus, tilat & hankinnat)
- "cfo" (Talous & Kassa — kassavirta, maksuajat, kannattavuus)
- "cro" (Myynti & Asiakkaat — hinnoittelu, myyntikanavat, kysyntä)
- "chro" (Tiimi & Henkilöstö — työkuorma, palkkaus, jaksaminen)

Inspect the provided telemetry snapshot and return ONLY valid JSON with:
{
  "executiveSummary": "string (concise 1-2 sentence practical Finnish summary of Day, Cash in €, workload, and current priorities for ${state.company.name})",
  "proposals": [
    {
      "agentRole": "coo" | "cfo" | "cro" | "chro",
      "priority": "low" | "medium" | "high" | "critical",
      "headline": "string (clear Finnish action headline)",
      "diagnosis": "string (practical Finnish explanation referencing ${state.company.name}'s actual products/channels/workCenters)",
      "tradeOffWarning": "string (what to watch out for in Finnish)",
      "kpiFocus": "string (key metric in Finnish)"
    }
  ],
  "debateTranscript": [
    {
      "speaker": "cro" | "coo" | "cfo" | "chro",
      "targetRole": "cro" | "coo" | "cfo" | "chro",
      "stance": "propose" | "object" | "support" | "synthesize",
      "message": "string (natural Finnish dialogue about this specific business)"
    }
  ]
}`;

  const { data, meta } = await callLlmJson<{
    executiveSummary?: string;
    proposals?: Array<{
      agentRole?: "coo" | "cfo" | "cro" | "chro";
      priority?: "low" | "medium" | "high" | "critical";
      headline?: string;
      diagnosis?: string;
      tradeOffWarning?: string;
      kpiFocus?: string;
      actions?: unknown[];
    }>;
    debateTranscript?: Array<{
      speaker?: "coo" | "cfo" | "cro" | "chro";
      targetRole?: "coo" | "cfo" | "cro" | "chro";
      stance?: "propose" | "object" | "support" | "synthesize";
      message?: string;
    }>;
  }>({
    systemInstruction,
    userPrompt: JSON.stringify(stateDigest),
    temperature: 0.35,
    config: cfg,
    taskLabelFi: `Tilannekuva & toimenpide-ehdotukset (${state.company.name}, Päivä ${state.calendar.tick})`,
  });

  if (!data) {
    return { briefing: fallback, meta };
  }

  // Merge LLM's C-Suite reasoning with Two-Phase Commit validated actions
  const mergedProposals = fallback.proposals.map((fbProp) => {
    const llmProp = data.proposals?.find((p) => p.agentRole === fbProp.agentRole);
    if (!llmProp) return fbProp;

    const validatedActions: ActionPayload[] = [];
    if (Array.isArray(llmProp.actions)) {
      for (const rawAct of llmProp.actions) {
        const parsedAct = ActionPayload.safeParse(rawAct);
        if (parsedAct.success) {
          const v = validateAction(state, parsedAct.data);
          if (v.valid) {
            validatedActions.push(parsedAct.data);
          }
        }
      }
    }

    return {
      ...fbProp,
      priority:
        llmProp.priority && ["low", "medium", "high", "critical"].includes(llmProp.priority)
          ? llmProp.priority
          : fbProp.priority,
      headline: llmProp.headline ? String(llmProp.headline).slice(0, 140) : fbProp.headline,
      diagnosis: llmProp.diagnosis
        ? String(llmProp.diagnosis).slice(0, 320)
        : fbProp.diagnosis,
      tradeOffWarning: llmProp.tradeOffWarning
        ? String(llmProp.tradeOffWarning).slice(0, 260)
        : fbProp.tradeOffWarning,
      kpiFocus: llmProp.kpiFocus ? String(llmProp.kpiFocus).slice(0, 100) : fbProp.kpiFocus,
      actions: validatedActions.length > 0 ? validatedActions : fbProp.actions,
    };
  });

  const titleByRole: Record<"coo" | "cfo" | "cro" | "chro", string> = {
    coo: "COO • Operatiivinen toiminta & Toimitusketju",
    cfo: "CFO • Talous, Kassa & Kannattavuus",
    cro: "CRO • Myynti, Hinnoittelu & Asiakkaat",
    chro: "CHRO • Tiimi, Työkuorma & Osaaminen",
  };

  const mergedDebate =
    Array.isArray(data.debateTranscript) && data.debateTranscript.length >= 2
      ? data.debateTranscript
          .filter(
            (t): t is NonNullable<typeof t> & { speaker: "coo" | "cfo" | "cro" | "chro" } =>
              Boolean(
                t &&
                  t.speaker &&
                  ["coo", "cfo", "cro", "chro"].includes(t.speaker) &&
                  t.message,
              ),
          )
          .slice(0, 6)
          .map((t) => ({
            speaker: t.speaker,
            speakerTitle: titleByRole[t.speaker],
            targetRole:
              t.targetRole && ["coo", "cfo", "cro", "chro"].includes(t.targetRole)
                ? t.targetRole
                : undefined,
            stance:
              t.stance && ["propose", "object", "support", "synthesize"].includes(t.stance)
                ? t.stance
                : ("synthesize" as const),
            message: String(t.message).slice(0, 340),
          }))
      : fallback.debateTranscript;

  const providerLabel = PROVIDER_PRESETS[cfg.provider].name.toUpperCase();

  return {
    briefing: {
      tick: state.calendar.tick,
      executiveSummary: data.executiveSummary
        ? `[${providerLabel} LIVE] ${String(data.executiveSummary).slice(0, 300)}`
        : fallback.executiveSummary,
      proposals: mergedProposals,
      debateTranscript: mergedDebate.length > 0 ? mergedDebate : fallback.debateTranscript,
    },
    meta,
  };
}
