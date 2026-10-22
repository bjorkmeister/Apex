/**
 * Universal Business State (TOM + Live Simulation State) & Timeline Branching.
 */
import { z } from "zod";
import { ActionEnvelope, ActionResult } from "./actions";
import { Item, Recipe } from "./catalog";
import {
  Channel,
  Contract,
  MarketingChannel,
  Offering,
  OfferingState,
  Opportunity,
  PendingReturn,
  SalesOrder,
} from "./commercial";
import { EventsState } from "./events";
import { FinanceState, Ledger } from "./finance";
import { DailyKpi, MonthlyReport, MonthToDate } from "./kpi";
import { Competitor, MacroState, Presence, Segment } from "./market";
import { Capability, ProductionOrder, ProductionPolicy, WorkCenter } from "./operations";
import { Department, Governance, PositionState, Process, Role } from "./org";
import { Id, Tick } from "./primitives";
import { FreightLane, PurchaseOrder, ReorderPolicy, Supplier, UsageStat } from "./supply";
import { InventoryLot, Warehouse } from "./warehouse";

/** Five canonical baseline industry archetypes anchoring the Business DNA Compiler. */
export const IndustryArchetype = z.enum([
  "ASSET_HEAVY_MANUFACTURING",
  "PERISHABLE_COLD_CHAIN",
  "HIGH_VELOCITY_D2C",
  "B2B_ENTERPRISE_SERVICES",
  "PLATFORM_RECURRING",
]);
export type IndustryArchetype = z.infer<typeof IndustryArchetype>;

/** Tiered Tick-Clock interrupt & macro-interval trigger kinds. */
export const TriggerKind = z.enum([
  "WEEKLY_WAR_ROOM",
  "MONTHLY_PNL_REVIEW",
  "CASH_RUNWAY_LOW",
  "INVENTORY_STOCKOUT",
  "COVENANT_BREACH",
  "COMPETITOR_PRICE_CUT",
  "DECISION_PENDING",
]);
export type TriggerKind = z.infer<typeof TriggerKind>;

export const TriggerAlert = z.object({
  kind: TriggerKind,
  tick: Tick,
  severity: z.enum(["info", "warning", "critical"]),
  pausesLoop: z.boolean(),
  message: z.string(),
  metrics: z.record(z.string(), z.number()).optional(),
});
export type TriggerAlert = z.infer<typeof TriggerAlert>;

export const EvolutionStageSpec = z.object({
  stage: z.number().int().min(1).max(4),
  title: z.string(),
  subtitle: z.string(),
  unlockCostEuros: z.number().min(0),
  demandMultiplier: z.number().min(1),
  newFacilityName: z.string(),
  newWorkCenterName: z.string(),
  newChannelName: z.string(),
  newSegmentName: z.string(),
  newRoleTitle: z.string(),
  gameTheoryNote: z.string(),
});
export type EvolutionStageSpec = z.infer<typeof EvolutionStageSpec>;

export const DomainUiConfig = z.object({
  /** Free-form industry/venture classification in user's language (no fixed 5-bucket jargon). */
  industryLabel: z.string(),
  /** Plain-language explanation of what drives this specific business's cash flow and operations. */
  physicsExplanation: z.string(),
  /** 6 custom column titles for the End-to-End Value Chain Canvas. */
  valueChainColumns: z.tuple([
    z.string(),
    z.string(),
    z.string(),
    z.string(),
    z.string(),
    z.string(),
  ]),
  /** Custom node card badges & metric labels for the Value Chain Canvas & Inspector. */
  nodeLabels: z.object({
    supplierTag: z.string(),
    inboundTag: z.string(),
    facilityTag: z.string(),
    facilitySubtitle: z.string(),
    facilityMetricLabel: z.string(),
    workCenterTag: z.string(),
    workCenterQueueLabel: z.string(),
    channelTag: z.string(),
    segmentTag: z.string(),
    addCapacityActionLabel: z.string(),
    orderSupplyActionLabel: z.string(),
  }),
  /** Custom Phase 1 Business Idea Canvas setup options tailored to this exact venture. */
  canvasConfig: z.object({
    roles: z.array(
      z.object({
        id: z.enum(["commercial", "product", "general_manager"]),
        title: z.string(),
        sub: z.string(),
      }),
    ),
    capabilities: z.array(
      z.object({
        key: z.enum(["production", "warehouse", "logistics"]),
        icon: z.string(),
        title: z.string(),
        sub: z.string(),
        inHouseLabel: z.string(),
        outsourceLabel: z.string(),
      }),
    ),
    economics: z.object({
      itemLabel: z.string(),
      itemSub: z.string(),
      priceLabel: z.string(),
      priceSub: z.string(),
      marginLabel: z.string(),
      marginSub: z.string(),
    }),
    ignitionText: z.string(),
  }),
  /** 4-Stage Evolutionary Scaling Roadmap (from single micro-venture to multinational group). */
  evolutionStages: z.array(EvolutionStageSpec).optional(),
});
export type DomainUiConfig = z.infer<typeof DomainUiConfig>;

export const StrategicPlayCard = z.object({
  id: z.string(),
  title: z.string(),
  category: z.enum(["pricing", "supply_chain", "growth", "capacity", "m_and_a"]),
  description: z.string(),
  costEuros: z.number().min(0),
  expectedImpactSummary: z.string(),
  competitorReaction: z.string(),
  assumptionPatches: z.array(
    z.object({
      key: z.string(),
      targetValue: z.number(),
      reason: z.string(),
    }),
  ),
  executed: z.boolean().optional(),
});
export type StrategicPlayCard = z.infer<typeof StrategicPlayCard>;

export const MarketIntelligenceReport = z.object({
  lastUpdatedTick: z.number().int(),
  researchQuery: z.string(),
  usedLiveLlm: z.boolean(),
  usedWebSearch: z.boolean(),
  providerLabel: z.string(),
  executiveSummary: z.string(),
  marketSizingNote: z.string(),
  benchmarks: z.array(
    z.object({
      assumptionKey: z.string(),
      label: z.string(),
      marketLow: z.number(),
      marketTypical: z.number(),
      marketHigh: z.number(),
      unit: z.string(),
      rationale: z.string(),
    }),
  ),
  webSources: z.array(
    z.object({
      title: z.string(),
      url: z.string(),
      snippet: z.string(),
    }),
  ),
  strategicPlays: z.array(StrategicPlayCard),
});
export type MarketIntelligenceReport = z.infer<typeof MarketIntelligenceReport>;

export const CompanyMeta = z.object({
  id: Id,
  name: z.string(),
  industry: z.string(),
  archetype: IndustryArchetype.optional(),
  tagline: z.string(),
  currency: z.string().default("USD"),
  prompt: z.string().optional(),
  initialCapitalEuros: z.number().optional(),
  commercialModelNotes: z.string().optional(),
  ventureStage: z.number().int().min(1).max(4).optional(),
  customizedAssumptions: z.array(z.string()).optional(),
  assumptionOrigins: z.record(z.string(), z.string()).optional(),
  marketIntelligence: MarketIntelligenceReport.optional(),
  domainUi: DomainUiConfig.optional(),
});
export type CompanyMeta = z.infer<typeof CompanyMeta>;

/** 30/360 banking calendar: 12 months × 30 days = 360 days/year. */
export const CalendarState = z.object({
  tick: Tick,
  dayOfMonth: z.number().int().min(1).max(30),
  monthOfYear: z.number().int().min(1).max(12),
  year: z.number().int().min(1),
  quarter: z.number().int().min(1).max(4),
  monthIndex: z.number().int().min(0),
});
export type CalendarState = z.infer<typeof CalendarState>;

export const WarehouseState = z.object({
  sites: z.array(Warehouse),
  lots: z.array(InventoryLot),
});
export type WarehouseState = z.infer<typeof WarehouseState>;

export const BOM = Recipe;
export type BOM = Recipe;

export const CapabilityMap = z.array(Capability);
export type CapabilityMap = z.infer<typeof CapabilityMap>;

export const FinancialLedger = Ledger;
export type FinancialLedger = Ledger;

export const WorldState = z.object({
  schemaVersion: z.literal(1),
  company: CompanyMeta,
  calendar: CalendarState,
  /** Mulberry32 internal uint32 state — guarantees 100% deterministic branching. */
  rngState: z.number().int(),
  status: z.enum(["running", "paused_decision", "bankrupt", "completed"]),
  bankruptcyReason: z.string().optional(),

  catalog: z.object({
    items: z.array(Item),
    recipes: z.array(Recipe),
  }),

  operations: z.object({
    capabilities: CapabilityMap,
    workCenters: z.array(WorkCenter),
    policies: z.array(ProductionPolicy),
    orders: z.array(ProductionOrder),
    /** Non-storable service capacity produced today, indexed by itemId. */
    serviceCapacityToday: z.record(z.string(), z.number()),
  }),

  supply: z.object({
    suppliers: z.array(Supplier),
    lanes: z.array(FreightLane),
    purchaseOrders: z.array(PurchaseOrder),
    reorderPolicies: z.array(ReorderPolicy),
    /** Keyed by `${warehouseId}:${itemId}` */
    usageStats: z.record(z.string(), UsageStat),
  }),

  warehouses: WarehouseState,

  org: z.object({
    departments: z.array(Department),
    roles: z.array(Role),
    positions: z.array(PositionState),
    processes: z.array(Process),
    governance: Governance,
  }),

  market: z.object({
    macro: MacroState,
    segments: z.array(Segment),
    presence: z.array(Presence),
    competitors: z.array(Competitor),
  }),

  commercial: z.object({
    channels: z.array(Channel),
    offerings: z.array(Offering),
    offeringStates: z.array(OfferingState),
    marketing: z.array(MarketingChannel),
    backlog: z.array(SalesOrder),
    pipeline: z.array(Opportunity),
    contracts: z.array(Contract),
    pendingReturns: z.array(PendingReturn),
  }),

  finance: FinanceState,
  events: EventsState,

  telemetry: z.object({
    daily: z.array(DailyKpi),
    monthly: z.array(MonthlyReport),
    mtd: MonthToDate,
  }),

  actionQueue: z.array(ActionEnvelope),
  actionHistory: z.array(ActionResult),
  nextSeq: z.number().int().min(1),
});
export type WorldState = z.infer<typeof WorldState>;

/** Canonical alias for the root SimulationState schema & type. */
export const SimulationState = WorldState;
export type SimulationState = WorldState;

/** Timeline branching ("Git for Business Cases") snapshot & branch metadata. */
export const TimelineBranch = z.object({
  id: Id,
  name: z.string(),
  parentBranchId: Id.optional(),
  forkTick: Tick,
  createdAt: z.string(),
  notes: z.string().optional(),
  head: WorldState,
  snapshots: z.record(z.string(), WorldState),
});
export type TimelineBranch = z.infer<typeof TimelineBranch>;

