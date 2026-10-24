/**
 * APEX Studio v3.2 — Derived Entity Registry, Reverse Index & Graph Validator (`src/flow/graph/registry.ts`).
 *
 * Implements Override 5 (TSD 3.2 & 3.6):
 * - Reverse references (`usedBy`), topological orders, and alias bindings are never stored in
 *   `EnterpriseGraph`, preventing state drift during branching and undo/redo.
 * - `buildRegistry(graph)` derives all indices deterministically from `EnterpriseGraph`.
 * - `validateGraph(graph)` enforces structural, referential, unit, and A1/P9 invariants.
 */
import type {
  BusinessCapability,
  Capability,
  EnterpriseGraph,
  EntityURI,
  FactorNode,
  FactorRef,
  FlowUnit,
  HierarchicalStreamEdge,
  LedgerAccount,
  UniversalEnterpriseNode,
} from "./types.ts";
import { parseFormula, variablesOf } from "../model/formula.ts";

export type RegistryEntity =
  | { kind: "node"; entity: UniversalEnterpriseNode }
  | { kind: "stream"; entity: HierarchicalStreamEdge }
  | { kind: "unit"; entity: FlowUnit }
  | { kind: "factor"; entity: FactorNode }
  | { kind: "capability"; entity: Capability }
  | { kind: "business_capability"; entity: BusinessCapability }
  | { kind: "account"; entity: LedgerAccount };

export interface EntityRegistry {
  entities: Map<EntityURI, RegistryEntity>;
  /** Derived reverse index: target URI -> set of entity URIs that reference it. */
  usedBy: Map<EntityURI, Set<EntityURI>>;
  /** Forward dependency index: source URI -> set of entity URIs it references. */
  uses: Map<EntityURI, Set<EntityURI>>;
  /** Alias string -> FactorNode URI for formula evaluation. */
  factorAliases: Map<string, EntityURI>;
  /** Topological evaluation order of FactorNode URIs. */
  factorOrder: EntityURI[];
  /** Topological execution order of leaf process node URIs. */
  leafNodeOrder: EntityURI[];
  /** Bottom-up hierarchical order of all process node URIs (children before parents). */
  rollupNodeOrder: EntityURI[];
  /** Leaf stream URIs that form a cycle and therefore receive a 1-tick feedback delay. */
  feedbackStreams: Set<EntityURI>;
  /** Detected cycles in node hierarchy, stream hierarchy, or factor formulas. */
  cycles: {
    nodeHierarchy: EntityURI[][];
    streamHierarchy: EntityURI[][];
    factorFormulas: EntityURI[][];
  };
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  registry: EntityRegistry;
}

function stripUriPrefix(uri: string): string {
  const idx = uri.indexOf("://");
  if (idx < 0) return uri;
  const rest = uri.slice(idx + 3);
  const slash = rest.indexOf("/");
  return slash < 0 ? rest : rest.slice(slash + 1);
}

/** Build the deterministic `EntityRegistry` from an `EnterpriseGraph`. */
export function buildRegistry(graph: EnterpriseGraph): EntityRegistry {
  const entities = new Map<EntityURI, RegistryEntity>();
  const usedBy = new Map<EntityURI, Set<EntityURI>>();
  const uses = new Map<EntityURI, Set<EntityURI>>();
  const factorAliases = new Map<string, EntityURI>();

  const registerEntity = (uri: EntityURI, item: RegistryEntity): void => {
    entities.set(uri, item);
    if (!usedBy.has(uri)) usedBy.set(uri, new Set());
    if (!uses.has(uri)) uses.set(uri, new Set());
  };

  for (const u of Object.values(graph.units)) registerEntity(u.uri, { kind: "unit", entity: u });
  for (const f of Object.values(graph.factors)) {
    registerEntity(f.uri, { kind: "factor", entity: f });
    const shortId = stripUriPrefix(f.uri);
    factorAliases.set(f.uri, f.uri);
    factorAliases.set(shortId, f.uri);
    factorAliases.set(shortId.replace(/[^A-Za-z0-9_.]/g, "_"), f.uri);
    if (f.alias) {
      factorAliases.set(f.alias, f.uri);
    }
    if (/^[A-Za-z_][A-Za-z0-9_.]*$/.test(f.name) && !factorAliases.has(f.name)) {
      factorAliases.set(f.name, f.uri);
    }
  }
  for (const c of Object.values(graph.capabilities)) {
    registerEntity(c.uri, { kind: "capability", entity: c });
  }
  for (const bc of Object.values(graph.businessCapabilities ?? {})) {
    registerEntity(bc.uri, { kind: "business_capability", entity: bc });
  }
  for (const acc of Object.values(graph.accounts)) {
    registerEntity(acc.uri, { kind: "account", entity: acc });
  }
  for (const n of Object.values(graph.nodes)) registerEntity(n.uri, { kind: "node", entity: n });
  for (const s of Object.values(graph.streams)) registerEntity(s.uri, { kind: "stream", entity: s });

  const addRef = (from: EntityURI, to: EntityURI | null | undefined): void => {
    if (!to) return;
    if (!uses.has(from)) uses.set(from, new Set());
    uses.get(from)!.add(to);
    if (!usedBy.has(to)) usedBy.set(to, new Set());
    usedBy.get(to)!.add(from);
  };

  const addFactorRef = (from: EntityURI, ref: FactorRef | undefined): void => {
    if (ref && "factor" in ref) {
      addRef(from, ref.factor);
    }
  };

  // 1. Units
  for (const u of Object.values(graph.units)) {
    addFactorRef(u.uri, u.decayPerTick);
  }

  // 2. Factors & formula dependencies
  const factorDeps = new Map<EntityURI, Set<EntityURI>>();
  for (const f of Object.values(graph.factors)) {
    const deps = new Set<EntityURI>();
    factorDeps.set(f.uri, deps);
    if (f.formula) {
      try {
        const ast = parseFormula(f.formula);
        for (const varName of variablesOf(ast)) {
          const target = factorAliases.get(varName);
          if (target) {
            addRef(f.uri, target);
            deps.add(target);
          } else {
            const syntheticUri = `apex://factor/${varName}` as EntityURI;
            addRef(f.uri, syntheticUri);
          }
        }
      } catch {
        // Formula syntax errors are reported by validateGraph.
      }
    }
  }

  // 3. Capabilities
  for (const c of Object.values(graph.capabilities)) {
    if (c.kind === "role") {
      addRef(c.uri, c.orgUnit);
      addFactorRef(c.uri, c.fte);
      addFactorRef(c.uri, c.costPerFtePerTick);
      addFactorRef(c.uri, c.hoursPerFtePerTick);
      addFactorRef(c.uri, c.proficiency);
    } else if (c.kind === "system") {
      addFactorRef(c.uri, c.fixedCostPerTick);
      addFactorRef(c.uri, c.capex);
      addFactorRef(c.uri, c.availability);
    } else {
      addFactorRef(c.uri, c.capacityPerTick);
      addFactorRef(c.uri, c.operatingCostPerTick);
      addFactorRef(c.uri, c.capex);
      addFactorRef(c.uri, c.usefulLifeTicks);
    }
  }

  // 4. BusinessCapabilities
  for (const bc of Object.values(graph.businessCapabilities ?? {})) {
    for (const dep of bc.dependsOn) addRef(bc.uri, dep);
    for (const rel of bc.realizedBy) addRef(bc.uri, rel);
    for (const note of bc.notes) addFactorRef(bc.uri, note.amount);
  }

  // 5. Nodes
  for (const n of Object.values(graph.nodes)) {
    addRef(n.uri, n.parent);
    for (const ch of n.children) addRef(n.uri, ch);
    for (const r of n.realizes ?? []) addRef(n.uri, r);
    addRef(n.uri, n.owner);
    for (const k of n.kpis) addRef(n.uri, k);

    for (const p of n.ports) {
      addRef(n.uri, p.unit);
      addFactorRef(n.uri, p.ratio);
      if (p.delegatesTo) addRef(n.uri, p.delegatesTo.node);
    }

    for (const m of n.physics ?? []) {
      for (const ref of Object.values(m.params)) addFactorRef(n.uri, ref);
      addFactorRef(n.uri, m.batchSize);
    }

    if (n.buffer) {
      addFactorRef(n.uri, n.buffer.maxUnits);
      addFactorRef(n.uri, n.buffer.holdingCostPerUnit);
      addFactorRef(n.uri, n.buffer.initialUnits);
      addFactorRef(n.uri, n.buffer.initialUnitCost);
      if (n.buffer.reorder) {
        addFactorRef(n.uri, n.buffer.reorder.trigger);
        addFactorRef(n.uri, n.buffer.reorder.target);
        addRef(n.uri, n.buffer.reorder.source);
      }
    }

    for (const mb of n.mechanisms) {
      addRef(n.uri, mb.capability);
      addFactorRef(n.uri, mb.capacityContribution);
      if (mb.modifiers) {
        addFactorRef(n.uri, mb.modifiers.throughput);
        addFactorRef(n.uri, mb.modifiers.cycleTime);
        addFactorRef(n.uri, mb.modifiers.yield);
        addFactorRef(n.uri, mb.modifiers.variableCost);
      }
      if (mb.rollout) {
        addFactorRef(n.uri, mb.rollout.dipDepth);
      }
      addFactorRef(n.uri, mb.fallbackMultiplier);
    }

    for (const lb of n.ledgerBindings) {
      addRef(n.uri, lb.debit);
      addRef(n.uri, lb.credit);
      addFactorRef(n.uri, lb.amount);
    }
  }

  // 6. Streams
  for (const s of Object.values(graph.streams)) {
    addRef(s.uri, s.parent);
    for (const ch of s.children) addRef(s.uri, ch);
    addRef(s.uri, s.from.node);
    addRef(s.uri, s.to.node);
    addRef(s.uri, s.unit);
    addFactorRef(s.uri, s.latencyTicks);
    addFactorRef(s.uri, s.lossRate);
    addFactorRef(s.uri, s.transferCost);
    if (s.routing.kind === "split") addFactorRef(s.uri, s.routing.share);
  }

  // Topological sort of FactorNodes
  const { order: factorOrder, cycles: factorFormulas } = topoSort(
    Object.values(graph.factors).map((f) => f.uri),
    (u) => [...(factorDeps.get(u) ?? [])],
  );

  // Hierarchical bottom-up order of process nodes (children before parents)
  const { order: rollupNodeOrder, cycles: nodeHierarchy } = topoSort(
    Object.values(graph.nodes).map((n) => n.uri),
    (u) => graph.nodes[u]?.children.filter((c) => Boolean(graph.nodes[c])) ?? [],
  );

  // Stream hierarchy check
  const { cycles: streamHierarchy } = topoSort(
    Object.values(graph.streams).map((s) => s.uri),
    (u) => graph.streams[u]?.children.filter((c) => Boolean(graph.streams[c])) ?? [],
  );

  // Topological order of leaf nodes based on leaf streams (breaking feedback cycles deterministically)
  const leafUris = Object.values(graph.nodes)
    .filter((n) => n.children.length === 0)
    .map((n) => n.uri);
  const leafSet = new Set<EntityURI>(leafUris);
  const feedbackStreams = new Set<EntityURI>();

  // Build adjacency of leaf nodes from leaf streams
  const leafIncoming = new Map<EntityURI, { from: EntityURI; stream: EntityURI }[]>();
  for (const u of leafUris) leafIncoming.set(u, []);
  for (const s of Object.values(graph.streams)) {
    if (s.children.length > 0) continue;
    if (leafSet.has(s.from.node) && leafSet.has(s.to.node)) {
      if (s.from.node === s.to.node) {
        feedbackStreams.add(s.uri);
        continue;
      }
      leafIncoming.get(s.to.node)!.push({ from: s.from.node, stream: s.uri });
    }
  }

  const leafNodeOrder = computeLeafTopologicalOrder(leafUris, leafIncoming, feedbackStreams);

  return {
    entities,
    usedBy,
    uses,
    factorAliases,
    factorOrder,
    leafNodeOrder,
    rollupNodeOrder,
    feedbackStreams,
    cycles: {
      nodeHierarchy,
      streamHierarchy,
      factorFormulas,
    },
  };
}

function topoSort(
  items: EntityURI[],
  getPrerequisites: (uri: EntityURI) => EntityURI[],
): { order: EntityURI[]; cycles: EntityURI[][] } {
  const state = new Map<EntityURI, 0 | 1 | 2>();
  for (const u of items) state.set(u, 0);
  const order: EntityURI[] = [];
  const cycles: EntityURI[][] = [];
  const stack: EntityURI[] = [];

  const visit = (u: EntityURI): void => {
    const st = state.get(u);
    if (st === 2) return;
    if (st === 1) {
      const idx = stack.indexOf(u);
      cycles.push(idx >= 0 ? stack.slice(idx) : [u]);
      return;
    }
    state.set(u, 1);
    stack.push(u);
    for (const pre of getPrerequisites(u)) {
      if (state.has(pre)) visit(pre);
    }
    stack.pop();
    state.set(u, 2);
    order.push(u);
  };

  for (const u of items) {
    if (state.get(u) === 0) visit(u);
  }
  return { order, cycles };
}

function computeLeafTopologicalOrder(
  leafUris: EntityURI[],
  leafIncoming: Map<EntityURI, { from: EntityURI; stream: EntityURI }[]>,
  feedbackStreams: Set<EntityURI>,
): EntityURI[] {
  const state = new Map<EntityURI, 0 | 1 | 2>();
  for (const u of leafUris) state.set(u, 0);
  const order: EntityURI[] = [];

  const visit = (u: EntityURI): void => {
    const st = state.get(u);
    if (st === 2) return;
    state.set(u, 1);
    for (const edge of leafIncoming.get(u) ?? []) {
      const fromState = state.get(edge.from);
      if (fromState === 1) {
        // Back-edge in DFS: mark stream as a 1-tick feedback stream.
        feedbackStreams.add(edge.stream);
        continue;
      }
      if (fromState === 0) visit(edge.from);
    }
    state.set(u, 2);
    order.push(u);
  };

  for (const u of leafUris) {
    if (state.get(u) === 0) visit(u);
  }
  return order;
}

const OPTIONAL_EXTERNAL_URI_PREFIXES = ["apex://unit-org/", "apex://kpi/", "apex://policy/"];

/** Validate all structural, referential, unit, formula, and A1/P9 invariants on an `EnterpriseGraph`. */
export function validateGraph(graph: EnterpriseGraph): ValidationResult {
  const errors: string[] = [];
  const registry = buildRegistry(graph);
  const maturity = graph.maturity ?? 3;

  if (graph.version !== 3) {
    errors.push(`Unsupported graph version: ${String(graph.version)}`);
  }

  if (!graph.nodes[graph.root]) {
    errors.push(`Root node ${graph.root} does not exist in graph.nodes`);
  }

  if (graph.scopeRoot && !graph.nodes[graph.scopeRoot]) {
    errors.push(`Scope root node ${graph.scopeRoot} does not exist in graph.nodes`);
  }

  // 1. Cycle checks
  for (const cyc of registry.cycles.nodeHierarchy) {
    errors.push(`Cycle detected in node hierarchy: ${cyc.join(" -> ")}`);
  }
  for (const cyc of registry.cycles.streamHierarchy) {
    errors.push(`Cycle detected in stream hierarchy: ${cyc.join(" -> ")}`);
  }
  for (const cyc of registry.cycles.factorFormulas) {
    errors.push(`Cycle detected in factor formulas: ${cyc.join(" -> ")}`);
  }

  // 2. Parent-child bidirectional consistency on nodes
  for (const n of Object.values(graph.nodes)) {
    if (n.parent !== null) {
      const p = graph.nodes[n.parent];
      if (!p) {
        errors.push(`Node ${n.uri} references missing parent ${n.parent}`);
      } else if (!p.children.includes(n.uri)) {
        errors.push(`Parent node ${p.uri} is missing child ${n.uri} in children list`);
      }
    }
    for (const ch of n.children) {
      const c = graph.nodes[ch];
      if (!c) {
        errors.push(`Node ${n.uri} references missing child ${ch}`);
      } else if (c.parent !== n.uri) {
        errors.push(`Child node ${ch} has parent=${String(c.parent)}, expected ${n.uri}`);
      }
    }
  }

  // 3. Formula syntax validation
  for (const f of Object.values(graph.factors)) {
    if (f.kind === "formula" || f.formula) {
      if (!f.formula) {
        errors.push(`Factor ${f.uri} has kind="formula" but no formula expression`);
      } else {
        try {
          parseFormula(f.formula);
        } catch (err) {
          errors.push(`Factor ${f.uri} has invalid formula "${f.formula}": ${(err as Error).message}`);
        }
      }
    }
  }

  // 4. Referential integrity across registry.uses
  for (const [fromUri, targets] of registry.uses.entries()) {
    for (const targetUri of targets) {
      if (registry.entities.has(targetUri)) continue;
      if (OPTIONAL_EXTERNAL_URI_PREFIXES.some((p) => targetUri.startsWith(p))) continue;
      errors.push(`Entity ${fromUri} references missing URI ${targetUri}`);
    }
  }

  // 5. Stream endpoint port & unit compatibility
  for (const s of Object.values(graph.streams)) {
    const fromNode = graph.nodes[s.from.node];
    const toNode = graph.nodes[s.to.node];
    if (!fromNode) {
      errors.push(`Stream ${s.uri} references missing source node ${s.from.node}`);
      continue;
    }
    if (!toNode) {
      errors.push(`Stream ${s.uri} references missing target node ${s.to.node}`);
      continue;
    }
    const fromPort = fromNode.ports.find((p) => p.id === s.from.port);
    const toPort = toNode.ports.find((p) => p.id === s.to.port);
    if (!fromPort) {
      errors.push(`Stream ${s.uri} references missing port "${s.from.port}" on ${fromNode.uri}`);
    } else if (fromPort.unit !== s.unit) {
      errors.push(
        `Stream ${s.uri} unit (${s.unit}) does not match source port ${fromNode.uri}:${fromPort.id} unit (${fromPort.unit})`,
      );
    }
    if (!toPort) {
      errors.push(`Stream ${s.uri} references missing port "${s.to.port}" on ${toNode.uri}`);
    } else if (toPort.unit !== s.unit) {
      errors.push(
        `Stream ${s.uri} unit (${s.unit}) does not match target port ${toNode.uri}:${toPort.id} unit (${toPort.unit})`,
      );
    }
  }

  // 6. Maturity & Invariant A1 checks
  if (maturity === 0) {
    const processNodes = Object.values(graph.nodes).filter((n) => n.uri !== graph.root);
    if (processNodes.length > 0) {
      errors.push(`Maturity 0 graph must not contain process nodes beyond L0 root (found ${processNodes.length})`);
    }
  } else if (maturity >= 2) {
    for (const n of Object.values(graph.nodes)) {
      const def = n.definition ?? "defined";
      const isPendingGhost = n.ghost?.status === "pending";
      if (n.children.length === 0 && def === "defined" && !isPendingGhost) {
        if (!Array.isArray(n.physics) || n.physics.length === 0) {
          errors.push(`Defined leaf node ${n.uri} must have at least one PhysicsModule (Invariant A1)`);
        }
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    registry,
  };
}
