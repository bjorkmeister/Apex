/**
 * APEX Studio v3.2 — Universal Enterprise Meta-Graph type definitions (`src/flow/graph/types.ts`).
 *
 * Pure structural and mathematical types. Compatible with Node.js and browser
 * type-stripping (`stripTypeScriptTypes`): no enums, no namespaces, no runtime side effects,
 * and zero industry-specific terminology.
 */
import type {
  AtomMonthStats,
  DayPoint,
  MonthResult,
  Provenance,
  ProvenanceSource,
  SimulationResult,
} from "../kernel/types.ts";

export type { AtomMonthStats, DayPoint, MonthResult, Provenance, ProvenanceSource, SimulationResult };

/** Structural entity categories in the enterprise hyper-graph. */
export type EntityType =
  | "node"
  | "stream"
  | "unit"
  | "factor"
  | "role"
  | "system"
  | "asset"
  | "account"
  | "policy"
  | "kpi"
  | "unit-org"
  | "capability-biz";

/** Canonical cross-reference identifier: `apex://<type>/<id>`. */
export type EntityURI = `apex://${EntityType}/${string}`;

/** Physical or informational nature of a flowing unit. */
export type FlowNature =
  | "discrete"
  | "continuous"
  | "agent"
  | "signal"
  | "monetary"
  | "capacity";

/** Reference to a numeric value: either an inline constant or a FactorNode URI. */
export type FactorRef = { const: number } | { factor: EntityURI };

export interface FlowUnit {
  uri: EntityURI;
  name: string;
  nature: FlowNature;
  measure: string;
  /** Per-tick decay rate while waiting in a buffer or queue (0..1). */
  decayPerTick: FactorRef;
}

export interface TemporalWave {
  periodTicks: number;
  amplitude: number;
  phaseTicks: number;
}

export interface FactorNode {
  uri: EntityURI;
  name: string;
  alias?: string;
  kind: "constant" | "lever" | "formula" | "external_signal";
  value: number;
  unit: string;
  /** Safe formula expression evaluated by `src/flow/model/formula.ts`. */
  formula?: string;
  /** Periodic harmonic waves applied as a multiplier on the factor value. */
  temporal?: TemporalWave[];
  /** Optional 12-month calendar multipliers (index 0..11). */
  monthlyMultipliers?: number[];
  provenance?: Provenance;
}

/** IDEF0 four-sided port grammar: Input, Control, Output, Mechanism. */
export type PortSide = "I" | "C" | "O" | "M";

export type PortRole = "primary" | "reject" | "byproduct" | "posting";

export interface Port {
  id: string;
  name: string;
  side: PortSide;
  unit: EntityURI;
  /** Recipe conversion ratio: units of this port consumed/produced per node execution. */
  ratio: FactorRef;
  role?: PortRole;
  /** Delegation target on a child node when this composite node is decomposed. */
  delegatesTo?: { node: EntityURI; port: string };
}

/** Invariant A1: the five universal atomic physics modules inside a process node. */
export type AtomKind =
  | "time_capacity"
  | "physical_matter"
  | "recurring_subscription"
  | "transactional_trade"
  | "credit_working_capital";

/** Standardized output computed by each PhysicsModule before mechanism modifiers. */
export interface PhysicsOutput {
  capacityPerTick: number;
  cycleTicks: number;
  firstPassYield: number;
  variableCost: number;
  fixedCostPerTick: number;
  queueDecayPerTick?: number;
  cash?: { amount: number; delayTicks: number }[];
}

export interface PhysicsModule {
  atom: AtomKind;
  /** Named parameters referencing constants or FactorNodes. */
  params: Record<string, FactorRef>;
  batchSize?: FactorRef;
}

export interface MechanismModifiers {
  throughput?: FactorRef;
  cycleTime?: FactorRef;
  yield?: FactorRef;
  variableCost?: FactorRef;
}

export interface MechanismRollout {
  startTick: number;
  leadTicks: number;
  dipDepth: FactorRef;
  dipTicks: number;
}

export interface MechanismBinding {
  capability: EntityURI;
  capacityContribution?: FactorRef;
  modifiers?: MechanismModifiers;
  rollout?: MechanismRollout;
  critical: boolean;
  fallbackMultiplier?: FactorRef;
}

export interface LedgerBinding {
  event: "on_complete" | "on_reject" | "per_tick";
  debit: EntityURI;
  credit: EntityURI;
  amount: FactorRef;
}

export interface NodeReorderRule {
  trigger: FactorRef;
  target: FactorRef;
  source: EntityURI;
}

export interface NodeBuffer {
  maxUnits: FactorRef;
  holdingCostPerUnit: FactorRef;
  initialUnits?: FactorRef;
  initialUnitCost?: FactorRef;
  reorder?: NodeReorderRule;
}

export interface GhostState {
  patchId: string;
  status: "pending" | "hydrated" | "failed";
  requestedAt: number;
}

export type NodeBand = "value_stream" | "enabling" | "governance" | "external";

export type NodeDefinitionState = "defined" | "named" | "unknown";

export interface UniversalEnterpriseNode {
  uri: EntityURI;
  name: string;
  level: number;
  band: NodeBand;
  /** Maturity definition state (default "defined"). Simulator only executes "defined" nodes. */
  definition?: NodeDefinitionState;
  /** Optional BusinessCapability URIs realized by this process node. */
  realizes?: EntityURI[];
  tags: string[];
  canonicalRef?: string;
  parent: EntityURI | null;
  children: EntityURI[];
  ports: Port[];
  /** Leaf node physics modules (Invariant A1). Composite nodes compute rollups from children. */
  physics?: PhysicsModule[];
  buffer?: NodeBuffer;
  mechanisms: MechanismBinding[];
  /** Invariant A4: optimistic draft node state. */
  ghost?: GhostState;
  owner?: EntityURI;
  ledgerBindings: LedgerBinding[];
  kpis: EntityURI[];
}

export type StreamRouting =
  | { kind: "direct" }
  | { kind: "split"; share: FactorRef }
  | { kind: "condition"; when: string }
  | { kind: "overflow"; priority: number };

export interface HierarchicalStreamEdge {
  uri: EntityURI;
  name: string;
  parent: EntityURI | null;
  children: EntityURI[];
  from: { node: EntityURI; port: string };
  to: { node: EntityURI; port: string };
  unit: EntityURI;
  routing: StreamRouting;
  latencyTicks: FactorRef;
  lossRate: FactorRef;
  transferCost: FactorRef;
}

/** Structural application layer classification (never industry-specific labels). */
export type SystemLayer = "capture" | "workflow" | "record" | "intelligence" | "agent";

export type Capability =
  | {
      kind: "role";
      uri: EntityURI;
      name: string;
      orgUnit: EntityURI;
      fte: FactorRef;
      costPerFtePerTick: FactorRef;
      hoursPerFtePerTick: FactorRef;
      proficiency: FactorRef;
    }
  | {
      kind: "system";
      uri: EntityURI;
      name: string;
      layer: SystemLayer;
      fixedCostPerTick: FactorRef;
      capex: FactorRef;
      availability: FactorRef;
    }
  | {
      kind: "asset";
      uri: EntityURI;
      name: string;
      capacityPerTick: FactorRef;
      operatingCostPerTick: FactorRef;
      capex: FactorRef;
      usefulLifeTicks: FactorRef;
    };

export interface CapabilityNote {
  kind: "cost" | "risk" | "obligation" | "question";
  text: string;
  amount?: FactorRef;
}

export interface BusinessCapability {
  uri: EntityURI;
  name: string;
  status: "known" | "unclear" | "missing";
  rationale?: string;
  dependsOn: EntityURI[];
  notes: CapabilityNote[];
  canonicalRef?: string;
  realizedBy: EntityURI[];
  provenance: "user" | "genesis" | "template";
}

export type AccountType = "asset" | "liability" | "equity" | "revenue" | "expense";

export interface LedgerAccount {
  uri: EntityURI;
  code: string;
  name: string;
  type: AccountType;
}

export interface GraphEvent {
  id: string;
  title: string;
  libraryId?: string;
  startTick: number;
  durationTicks: number;
  target?: EntityURI;
  volumeChange?: number;
  priceChange?: number;
  variableCostChange?: number;
  fixedCostChange?: number;
  availabilityOverride?: number;
  oneOffCost?: number;
}

/** Venture maturity level: 0 Idea, 1 Concept, 2 Operating Model, 3 Operations. */
export type VentureMaturity = 0 | 1 | 2 | 3;

export interface EnterpriseGraph {
  version: 3;
  maturity?: VentureMaturity;
  id: string;
  name: string;
  root: EntityURI;
  scopeRoot?: EntityURI;
  tick: {
    resolution: "hour" | "day" | "week" | "month";
    horizon: number;
    startCalendarMonth?: number;
    payrollDayOfMonth?: number;
  };
  currency: string;
  nodes: Record<string, UniversalEnterpriseNode>;
  streams: Record<string, HierarchicalStreamEdge>;
  units: Record<string, FlowUnit>;
  factors: Record<string, FactorNode>;
  capabilities: Record<string, Capability>;
  businessCapabilities?: Record<string, BusinessCapability>;
  accounts: Record<string, LedgerAccount>;
  opening: {
    cash: number;
    balances: Record<string, number>;
  };
  events: GraphEvent[];
}

/** Validated mutation commands for EnterpriseGraph (TSD Section 8). */
export type GraphCommand =
  | { type: "add_node"; node: UniversalEnterpriseNode }
  | { type: "remove_node"; uri: EntityURI }
  | { type: "decompose_node"; uri: EntityURI; children: UniversalEnterpriseNode[]; calibrated?: boolean }
  | { type: "promote_node"; uri: EntityURI; newParent: EntityURI | null }
  | { type: "replicate_subgraph"; uri: EntityURI; copies: number }
  | { type: "connect_stream"; stream: HierarchicalStreamEdge }
  | { type: "split_stream"; uri: EntityURI; children: HierarchicalStreamEdge[] }
  | { type: "set_factor"; uri: EntityURI; value: number; provenance?: Provenance }
  | { type: "set_formula"; uri: EntityURI; formula: string; provenance?: Provenance }
  | { type: "attach_capability"; node: EntityURI; binding: MechanismBinding }
  | { type: "detach_capability"; node: EntityURI; capability: EntityURI }
  | { type: "add_capability"; capability: Capability }
  | { type: "add_event"; event: GraphEvent }
  | { type: "set_owner"; node: EntityURI; owner: EntityURI }
  | { type: "bind_ledger"; node: EntityURI; binding: LedgerBinding }
  | { type: "set_root_scope"; root: EntityURI }
  | { type: "set_maturity"; maturity: VentureMaturity };

/** Invariant A4: Optimistic UI node patch (<50 ms local creation, async hydration). */
export interface OptimisticNodePatch {
  patchId: string;
  request: string;
  localCommands: GraphCommand[];
  ghostNodes: EntityURI[];
  baseVersion: number;
  status: "pending" | "hydrated" | "failed" | "cancelled" | "rolled_back";
}

export interface AsyncLLMHydration {
  patchId: string;
  streamed: GraphCommand[];
}

/** Per-node state computed during a simulation tick (never persisted in EnterpriseGraph). */
export interface NodeTickState {
  uri: EntityURI;
  tick: number;
  computed: boolean;
  skipReason?: "undefined_node" | "ghost_pending" | "maturity_gated";
  upstreamStub?: boolean;
  demand: number;
  capacity: number;
  throughput: number;
  utilization: number;
  cycleTime: number;
  firstPassYield: number;
  primaryOutput: number;
  rejectOutput: number;
  wip: number;
  queueDecay: number;
  holdingCost: number;
  revenue: number;
  variableCost: number;
  fixedCost: number;
}

/** Per-stream state computed during a simulation tick (never persisted in EnterpriseGraph). */
export interface StreamTickState {
  uri: EntityURI;
  tick: number;
  status: "active" | "stub" | "inactive";
  stubReason?: string;
  sent: number;
  delivered: number;
  inTransit: number;
  loss: number;
  transferCost: number;
}

/** Per-unit conservation of mass balance on a tick: inflow === outflow + stockDelta + loss + decay. */
export interface UnitMassBalance {
  unit: EntityURI;
  tick: number;
  inflow: number;
  outflow: number;
  stockStart: number;
  stockEnd: number;
  stockDelta: number;
  loss: number;
  decay: number;
  residual: number;
}
