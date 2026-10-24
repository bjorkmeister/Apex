/**
 * APEX Studio v3.2 — Deterministic `GraphCommand` Engine, Calibrated Mitosis (`decompose_node`),
 * Idempotency Guard & Undo/Redo Stack (`src/flow/graph/commands.ts`).
 *
 * Implements TSD v3.2 Sections 4.3, 8.1, and Checkpoint 5 (V5):
 * - Pure functional execution of all 16+ `GraphCommand` variants:
 *   `add_node`, `remove_node`, `decompose_node`, `promote_node`, `replicate_subgraph`,
 *   `connect_stream`, `split_stream`, `set_factor`, `set_formula`, `attach_capability`,
 *   `detach_capability`, `add_capability`, `add_event`, `set_owner`, `bind_ledger`,
 *   `set_root_scope`, and `set_maturity`.
 * - Calibrated Mitosis (`decompose_node`): preserves exact pre-decomposition capacity, revenue,
 *   variable cost, fixed cost, and cash flow (zero simulation jump) and enforces strict idempotency
 *   (calling `decompose_node` on an already-decomposed node or substep child never creates nested
 *   duplicate children).
 * - User Edit Lock (`respectUserLocks`): when `true` (e.g. during async LLM hydration), refuses to
 *   overwrite any `FactorNode` whose `provenance.source === "user"`.
 * - Full Undo/Redo history stack (`GraphHistoryStack`).
 */
import type { Provenance } from "../kernel/types.ts";
import type {
  Capability,
  EnterpriseGraph,
  EntityURI,
  FactorRef,
  GraphCommand,
  GraphEvent,
  HierarchicalStreamEdge,
  LedgerBinding,
  MechanismBinding,
  PhysicsModule,
  UniversalEnterpriseNode,
  VentureMaturity,
} from "./types.ts";
import { parseFormula } from "../model/formula.ts";

export interface ApplyGraphCommandOptions {
  provenance?: Provenance;
  /** Kun tosi (esim. AsyncLLMHydration), ei ylikirjoita käyttäjän (`provenance.source === "user"`) lukitsemia tekijöitä. */
  respectUserLocks?: boolean;
}

export interface GraphHistoryEntry {
  label: string;
  commands: GraphCommand[];
  provenance: Provenance;
  beforeJson: string;
  afterJson: string;
}

export interface GraphHistoryStack {
  current: EnterpriseGraph;
  undoStack: GraphHistoryEntry[];
  redoStack: GraphHistoryEntry[];
}

const isObj = (x: unknown): x is Record<string, unknown> =>
  typeof x === "object" && x !== null && !Array.isArray(x);

const isUri = (x: unknown): x is EntityURI =>
  typeof x === "string" && x.startsWith("apex://") && x.length > 7;

const isFiniteNum = (x: unknown): x is number =>
  typeof x === "number" && Number.isFinite(x);

function resolveFactorRef(graph: EnterpriseGraph, ref: FactorRef | undefined, fallback = 0): number {
  if (!ref) return fallback;
  if ("const" in ref) return ref.const;
  return graph.factors[ref.factor]?.value ?? fallback;
}

/**
 * Tarkistaa ja validoi tuntemattoman syötteen (esim. kielimallin JSON) `GraphCommand`-olioksi (P5: ei koskaan eval-koodia).
 */
export function validateGraphCommand(raw: unknown, graph: EnterpriseGraph): GraphCommand | null {
  if (!isObj(raw) || typeof raw.type !== "string") return null;

  switch (raw.type) {
    case "add_node": {
      const n = raw.node as UniversalEnterpriseNode | undefined;
      if (!isObj(n) || !isUri(n.uri) || typeof n.name !== "string" || !n.name.trim()) return null;
      return { type: "add_node", node: n };
    }
    case "remove_node": {
      if (!isUri(raw.uri) || raw.uri === graph.root || !graph.nodes[raw.uri]) return null;
      return { type: "remove_node", uri: raw.uri };
    }
    case "decompose_node": {
      if (!isUri(raw.uri) || !graph.nodes[raw.uri]) return null;
      const ch = Array.isArray(raw.children) ? (raw.children as UniversalEnterpriseNode[]) : [];
      return {
        type: "decompose_node",
        uri: raw.uri,
        children: ch,
        calibrated: raw.calibrated !== false,
      };
    }
    case "promote_node": {
      if (!isUri(raw.uri) || raw.uri === graph.root || !graph.nodes[raw.uri]) return null;
      const newParent = raw.newParent === null ? null : isUri(raw.newParent) ? raw.newParent : null;
      return { type: "promote_node", uri: raw.uri, newParent };
    }
    case "replicate_subgraph": {
      if (!isUri(raw.uri) || raw.uri === graph.root || !graph.nodes[raw.uri]) return null;
      const copies = isFiniteNum(raw.copies) ? Math.max(1, Math.min(20, Math.round(raw.copies))) : 1;
      return { type: "replicate_subgraph", uri: raw.uri, copies };
    }
    case "connect_stream": {
      const s = raw.stream as HierarchicalStreamEdge | undefined;
      if (!isObj(s) || !isUri(s.uri) || !isObj(s.from) || !isObj(s.to)) return null;
      if (!isUri(s.from.node) || !isUri(s.to.node)) return null;
      return { type: "connect_stream", stream: s };
    }
    case "split_stream": {
      if (!isUri(raw.uri) || !graph.streams[raw.uri] || !Array.isArray(raw.children)) return null;
      return {
        type: "split_stream",
        uri: raw.uri,
        children: raw.children as HierarchicalStreamEdge[],
      };
    }
    case "set_factor": {
      if (!isUri(raw.uri) || !isFiniteNum(raw.value)) return null;
      return {
        type: "set_factor",
        uri: raw.uri,
        value: raw.value,
        provenance: isObj(raw.provenance) ? (raw.provenance as unknown as Provenance) : undefined,
      };
    }
    case "set_formula": {
      if (!isUri(raw.uri) || typeof raw.formula !== "string" || !raw.formula.trim()) return null;
      try {
        // P5: jäsennetään turvallisella AST-jäsentimellä (ei koskaan eval/Function)
        parseFormula(raw.formula);
      } catch {
        return null;
      }
      return {
        type: "set_formula",
        uri: raw.uri,
        formula: raw.formula.trim(),
        provenance: isObj(raw.provenance) ? (raw.provenance as unknown as Provenance) : undefined,
      };
    }
    case "attach_capability": {
      if (!isUri(raw.node) || !graph.nodes[raw.node] || !isObj(raw.binding)) return null;
      const b = raw.binding as unknown as MechanismBinding;
      if (!isUri(b.capability)) return null;
      return { type: "attach_capability", node: raw.node, binding: b };
    }
    case "detach_capability": {
      if (!isUri(raw.node) || !graph.nodes[raw.node] || !isUri(raw.capability)) return null;
      return { type: "detach_capability", node: raw.node, capability: raw.capability };
    }
    case "add_capability": {
      const cap = raw.capability as Capability | undefined;
      if (!isObj(cap) || !isUri(cap.uri) || typeof cap.name !== "string") return null;
      return { type: "add_capability", capability: cap };
    }
    case "add_event": {
      const ev = raw.event as GraphEvent | undefined;
      if (!isObj(ev) || typeof ev.id !== "string" || typeof ev.title !== "string") return null;
      return { type: "add_event", event: ev };
    }
    case "set_owner": {
      if (!isUri(raw.node) || !graph.nodes[raw.node] || !isUri(raw.owner)) return null;
      return { type: "set_owner", node: raw.node, owner: raw.owner };
    }
    case "bind_ledger": {
      if (!isUri(raw.node) || !graph.nodes[raw.node] || !isObj(raw.binding)) return null;
      return {
        type: "bind_ledger",
        node: raw.node,
        binding: raw.binding as unknown as LedgerBinding,
      };
    }
    case "set_root_scope": {
      if (!isUri(raw.root) || !graph.nodes[raw.root]) return null;
      return { type: "set_root_scope", root: raw.root };
    }
    case "set_maturity": {
      const m = raw.maturity;
      if (m !== 0 && m !== 1 && m !== 2 && m !== 3) return null;
      return { type: "set_maturity", maturity: m as VentureMaturity };
    }
    default:
      return null;
  }
}

/**
 * Kalibroi `decompose_node`-operaation lapsisolmut niin, että koostesolmun kapasiteetti,
 * tuotto, muuttuvat kulut, kiinteät kulut ja läpimeno säilyvät täsmälleen ennallaan
 * (ei hyppäystä simulaation tuloksissa).
 *
 * Idempotenssisuoja: jos kohdesolmulla on jo lapsia (`parent.children.length > 0`) tai se on
 * jo valmiiksi pilkottu alisolmu (`substep:`), funktio ei tee mitään.
 */
export function applyCalibratedDecompose(
  graph: EnterpriseGraph,
  parentUri: EntityURI,
  explicitChildren: UniversalEnterpriseNode[] = [],
  calibrated = true,
): void {
  const parent = graph.nodes[parentUri];
  if (!parent) return;

  // KRIITTINEN IDEMPOTENSSISUOJA:
  // Jos solmu on jo purettu (sillä on lapsia) tai se on jo itse purettu alisolmu, ei luoda sisäkkäisiä lapsia!
  if (
    parent.children.length > 0 ||
    parent.tags.some((t) => t.startsWith("substep:")) ||
    parent.uri.endsWith("_intake") ||
    parent.uri.endsWith("_qualifier") ||
    parent.uri.endsWith("_execution") ||
    parent.uri.endsWith("_qa") ||
    parent.uri.endsWith("_handover")
  ) {
    return;
  }

  const basePhysics: PhysicsModule[] = parent.physics
    ? JSON.parse(JSON.stringify(parent.physics))
    : [];
  const primaryUnit = parent.ports.find((p) => p.side === "I")?.unit ?? "apex://unit/items";

  const templates =
    explicitChildren.length > 0
      ? explicitChildren
      : [
          { suffix: "intake", name: `${parent.name} · Intake` },
          { suffix: "qualifier", name: `${parent.name} · Qualification` },
          { suffix: "execution", name: `${parent.name} · Execution` },
          { suffix: "qa", name: `${parent.name} · Quality Assurance` },
          { suffix: "handover", name: `${parent.name} · Handover` },
        ].map((spec): UniversalEnterpriseNode => ({
          uri: `${parentUri}_${spec.suffix}` as EntityURI,
          name: spec.name,
          apqcCategory: parent.apqcCategory,
          level: Math.min(5, parent.level + 1),
          band: parent.band,
          tags: [...parent.tags, `substep:${spec.suffix}`],
          parent: parentUri,
          children: [],
          definition: parent.definition ?? "defined",
          ports: [
            {
              id: "in",
              name: "Input",
              side: "I",
              unit: primaryUnit,
              ratio: { const: 1 },
            },
            {
              id: "out",
              name: "Output",
              side: "O",
              unit: primaryUnit,
              ratio: { const: 1 },
              role: "primary",
            },
          ],
          physics: [],
          mechanisms: parent.mechanisms.map((m) => ({ ...m })),
          owner: parent.owner,
          ledgerBindings: [],
          kpis: [],
        }));

  const childUris: EntityURI[] = [];
  for (let i = 0; i < templates.length; i++) {
    const rawChild = JSON.parse(JSON.stringify(templates[i]!)) as UniversalEnterpriseNode;
    const isFirst = i === 0;
    rawChild.parent = parentUri;
    rawChild.level = Math.min(5, parent.level + 1);
    rawChild.children = [];
    if (!rawChild.tags.some((tg) => tg.startsWith("substep:"))) {
      rawChild.tags.push(`substep:${i + 1}`);
    }

    if (calibrated) {
      // Kalibrointi: ensimmäinen vaihe (0) kantaa emosolmun tarkan fysiikkamoduulin ja pääkirjakytkennän,
      // ja seuraavat vaiheet (1..k-1) ovat kitkattomia siirtovaiheita (varCost=0, fixedCost=0, FPY=1) ->
      // emosolmun rollup-läpimeno, liikevaihto, kulut ja kassa pysyvät 100 % muuttumattomina!
      if (isFirst) {
        rawChild.physics = basePhysics;
        rawChild.ledgerBindings = parent.ledgerBindings.map((lb) => ({ ...lb }));
        rawChild.mechanisms = parent.mechanisms.map((m) => ({ ...m }));
      } else {
        const parentCap = resolveFactorRef(graph, basePhysics[0]?.params.capacityPerTick, 1000);
        rawChild.physics = [
          {
            atom: "time_capacity",
            params: {
              capacityPerTick: { const: Math.max(1_000_000, parentCap * 10) },
              cycleTicks: { const: 0 },
              firstPassYield: { const: 1 },
              variableCost: { const: 0 },
              fixedCostPerTick: { const: 0 },
            },
          },
        ];
        rawChild.ledgerBindings = [];
        rawChild.mechanisms = [];
      }
    }

    graph.nodes[rawChild.uri] = rawChild;
    childUris.push(rawChild.uri);

    if (i > 0) {
      const prevUri = childUris[i - 1]!;
      const streamUri = `apex://stream/${parentUri.slice("apex://node/".length)}_sub_${i}` as EntityURI;
      graph.streams[streamUri] = {
        uri: streamUri,
        name: `${graph.nodes[prevUri]!.name} → ${rawChild.name}`,
        parent: null,
        children: [],
        from: { node: prevUri, port: "out" },
        to: { node: rawChild.uri, port: "in" },
        unit: primaryUnit,
        routing: { kind: "direct" },
        status: "active",
        latencyTicks: { const: 0 },
        lossRate: { const: 0 },
        transferCostPerUnit: { const: 0 },
      };
    }
  }

  parent.children = childUris;
}

/**
 * Suorittaa yksittäisen `GraphCommand`-komennon puhtaana funktiona `(graph, cmd) => EnterpriseGraph`.
 */
export function applyGraphCommand(
  graph: EnterpriseGraph,
  cmd: GraphCommand,
  opts: ApplyGraphCommandOptions = {},
): EnterpriseGraph {
  const next = JSON.parse(JSON.stringify(graph)) as EnterpriseGraph;
  const defaultProv: Provenance = opts.provenance ?? { source: "user" };

  switch (cmd.type) {
    case "add_node": {
      const node = JSON.parse(JSON.stringify(cmd.node)) as UniversalEnterpriseNode;
      node.tags = node.tags ?? [];
      node.children = node.children ?? [];
      node.ports = node.ports ?? [];
      node.mechanisms = node.mechanisms ?? [];
      node.ledgerBindings = node.ledgerBindings ?? [];
      node.kpis = node.kpis ?? [];
      const parentUri = node.parent && next.nodes[node.parent] ? node.parent : next.root;
      node.parent = parentUri;
      next.nodes[node.uri] = node;
      const parentNode = next.nodes[parentUri]!;
      if (!parentNode.children.includes(node.uri)) {
        parentNode.children.push(node.uri);
      }
      break;
    }

    case "remove_node": {
      if (cmd.uri === next.root || !next.nodes[cmd.uri]) break;
      const toRemove = new Set<EntityURI>();
      const collect = (u: EntityURI): void => {
        if (toRemove.has(u)) return;
        toRemove.add(u);
        const n = next.nodes[u];
        if (!n) return;
        for (const ch of n.children) collect(ch);
      };
      collect(cmd.uri);
      for (const u of toRemove) {
        delete next.nodes[u];
      }
      for (const n of Object.values(next.nodes)) {
        n.children = n.children.filter((c) => !toRemove.has(c));
      }
      for (const [sUri, s] of Object.entries(next.streams)) {
        if (toRemove.has(s.from.node) || toRemove.has(s.to.node)) {
          delete next.streams[sUri];
        }
      }
      if (next.scopeRoot && toRemove.has(next.scopeRoot)) {
        delete next.scopeRoot;
      }
      break;
    }

    case "decompose_node": {
      applyCalibratedDecompose(next, cmd.uri, cmd.children, cmd.calibrated !== false);
      break;
    }

    case "promote_node": {
      const target = next.nodes[cmd.uri];
      if (!target || cmd.uri === next.root) break;
      const oldParent = target.parent ? next.nodes[target.parent] : undefined;
      if (oldParent) {
        oldParent.children = oldParent.children.filter((c) => c !== cmd.uri);
      }
      const newParentUri = cmd.newParent && next.nodes[cmd.newParent] ? cmd.newParent : next.root;
      target.parent = newParentUri;
      const newParent = next.nodes[newParentUri]!;
      target.level = Math.min(5, newParent.level + 1);
      if (!newParent.children.includes(cmd.uri)) {
        newParent.children.push(cmd.uri);
      }
      break;
    }

    case "replicate_subgraph": {
      const source = next.nodes[cmd.uri];
      if (!source || cmd.uri === next.root) break;
      const parentUri = source.parent && next.nodes[source.parent] ? source.parent : next.root;
      const parent = next.nodes[parentUri]!;
      const count = Math.max(1, Math.min(20, cmd.copies));

      for (let idx = 1; idx <= count; idx++) {
        const suffix = `_rep_${idx}`;
        const uriMap = new Map<EntityURI, EntityURI>();
        const collectSubtree = (u: EntityURI): void => {
          const copyUri = `${u}${suffix}` as EntityURI;
          uriMap.set(u, copyUri);
          const n = next.nodes[u];
          if (!n) return;
          for (const ch of n.children) collectSubtree(ch);
        };
        collectSubtree(cmd.uri);

        for (const [origUri, copyUri] of uriMap.entries()) {
          const origNode = next.nodes[origUri]!;
          const copyNode = JSON.parse(JSON.stringify(origNode)) as UniversalEnterpriseNode;
          copyNode.uri = copyUri;
          copyNode.name = origUri === cmd.uri ? `${origNode.name} (#${idx + 1})` : origNode.name;
          copyNode.parent =
            origUri === cmd.uri
              ? parentUri
              : (uriMap.get(origNode.parent as EntityURI) ?? parentUri);
          copyNode.children = origNode.children.map((ch) => uriMap.get(ch) ?? ch);
          next.nodes[copyUri] = copyNode;
        }

        const topCopyUri = uriMap.get(cmd.uri)!;
        if (!parent.children.includes(topCopyUri)) {
          parent.children.push(topCopyUri);
        }
      }
      break;
    }

    case "connect_stream": {
      const stream = JSON.parse(JSON.stringify(cmd.stream)) as HierarchicalStreamEdge;
      stream.children = stream.children ?? [];
      stream.routing = stream.routing ?? { kind: "direct" };
      next.streams[stream.uri] = stream;
      break;
    }

    case "split_stream": {
      const parentStream = next.streams[cmd.uri];
      if (!parentStream) break;
      const childUris: EntityURI[] = [];
      for (const ch of cmd.children) {
        const copy = JSON.parse(JSON.stringify(ch)) as HierarchicalStreamEdge;
        copy.parent = cmd.uri;
        copy.children = copy.children ?? [];
        copy.routing = copy.routing ?? { kind: "direct" };
        next.streams[copy.uri] = copy;
        childUris.push(copy.uri);
      }
      parentStream.children = childUris;
      break;
    }

    case "set_factor": {
      const existing = next.factors[cmd.uri];
      // Käyttäjän muokkaussuoja (TSD 8.1): jos käyttäjä on jo muokannut tekijää (provenance.source === "user"),
      // taustalta saapuva LLM-hydraatio (respectUserLocks = true) ei saa ylikirjoittaa arvoa!
      if (
        opts.respectUserLocks &&
        existing?.provenance?.source === "user" &&
        (cmd.provenance?.source ?? defaultProv.source) !== "user"
      ) {
        break;
      }
      if (existing) {
        existing.value = cmd.value;
        existing.provenance = cmd.provenance ?? defaultProv;
      } else {
        next.factors[cmd.uri] = {
          uri: cmd.uri,
          name: cmd.uri.slice("apex://factor/".length),
          kind: "lever",
          value: cmd.value,
          unit: "scalar",
          provenance: cmd.provenance ?? defaultProv,
        };
      }
      break;
    }

    case "set_formula": {
      const existing = next.factors[cmd.uri];
      if (
        opts.respectUserLocks &&
        existing?.provenance?.source === "user" &&
        (cmd.provenance?.source ?? defaultProv.source) !== "user"
      ) {
        break;
      }
      if (existing) {
        existing.kind = "formula";
        existing.formula = cmd.formula;
        existing.provenance = cmd.provenance ?? defaultProv;
      } else {
        next.factors[cmd.uri] = {
          uri: cmd.uri,
          name: cmd.uri.slice("apex://factor/".length),
          kind: "formula",
          value: 0,
          formula: cmd.formula,
          unit: "scalar",
          provenance: cmd.provenance ?? defaultProv,
        };
      }
      break;
    }

    case "attach_capability": {
      const node = next.nodes[cmd.node];
      if (!node) break;
      const existingIdx = node.mechanisms.findIndex((m) => m.capability === cmd.binding.capability);
      if (existingIdx >= 0) {
        node.mechanisms[existingIdx] = JSON.parse(JSON.stringify(cmd.binding)) as MechanismBinding;
      } else {
        node.mechanisms.push(JSON.parse(JSON.stringify(cmd.binding)) as MechanismBinding);
      }
      break;
    }

    case "detach_capability": {
      const node = next.nodes[cmd.node];
      if (!node) break;
      node.mechanisms = node.mechanisms.filter((m) => m.capability !== cmd.capability);
      break;
    }

    case "add_capability": {
      next.capabilities[cmd.capability.uri] = JSON.parse(
        JSON.stringify(cmd.capability),
      ) as Capability;
      break;
    }

    case "add_event": {
      next.events.push(JSON.parse(JSON.stringify(cmd.event)) as GraphEvent);
      break;
    }

    case "set_owner": {
      const node = next.nodes[cmd.node];
      if (node) node.owner = cmd.owner;
      break;
    }

    case "bind_ledger": {
      const node = next.nodes[cmd.node];
      if (node) {
        node.ledgerBindings.push(JSON.parse(JSON.stringify(cmd.binding)) as LedgerBinding);
      }
      break;
    }

    case "set_root_scope": {
      if (cmd.root === next.root || !next.nodes[cmd.root]) {
        delete next.scopeRoot;
      } else {
        next.scopeRoot = cmd.root;
      }
      break;
    }

    case "set_maturity": {
      next.maturity = cmd.maturity;
      break;
    }
  }

  return next;
}

/**
 * Validoi ja suorittaa joukon `GraphCommand`-komentoja järjestyksessä.
 */
export function applyGraphCommands(
  graph: EnterpriseGraph,
  rawCommands: unknown[],
  opts: ApplyGraphCommandOptions = {},
): {
  graph: EnterpriseGraph;
  applied: GraphCommand[];
  rejected: number;
} {
  let cur = graph;
  const applied: GraphCommand[] = [];
  let rejected = 0;

  for (const raw of rawCommands) {
    const valid = validateGraphCommand(raw, cur);
    if (!valid) {
      rejected += 1;
      continue;
    }
    cur = applyGraphCommand(cur, valid, opts);
    applied.push(valid);
  }

  return { graph: cur, applied, rejected };
}

/**
 * Luo uuden Undo/Redo-komentohistorian (`GraphHistoryStack`).
 */
export function createGraphHistory(initialGraph: EnterpriseGraph): GraphHistoryStack {
  return {
    current: JSON.parse(JSON.stringify(initialGraph)) as EnterpriseGraph,
    undoStack: [],
    redoStack: [],
  };
}

/**
 * Suorittaa yhden tai useamman `GraphCommand`-komennon ja tallentaa palautuspisteen Undo-pinoon
 * (tyhjentäen Redo-pinon).
 */
export function executeWithHistory(
  history: GraphHistoryStack,
  cmdOrCmds: GraphCommand | GraphCommand[],
  opts: ApplyGraphCommandOptions & { label?: string } = {},
): GraphHistoryStack {
  const cmds = Array.isArray(cmdOrCmds) ? cmdOrCmds : [cmdOrCmds];
  if (cmds.length === 0) return history;

  const beforeJson = JSON.stringify(history.current);
  const { graph: nextGraph, applied } = applyGraphCommands(history.current, cmds, opts);
  const afterJson = JSON.stringify(nextGraph);

  if (beforeJson === afterJson || applied.length === 0) {
    return history;
  }

  const entry: GraphHistoryEntry = {
    label: opts.label ?? applied.map((c) => c.type).join(", "),
    commands: applied,
    provenance: opts.provenance ?? { source: "user" },
    beforeJson,
    afterJson,
  };

  return {
    current: nextGraph,
    undoStack: [...history.undoStack, entry],
    redoStack: [],
  };
}

/**
 * Kumoa (`Undo`) viimeisin `GraphCommand`-tapahtuma.
 */
export function undoGraphCommand(history: GraphHistoryStack): GraphHistoryStack {
  if (history.undoStack.length === 0) return history;
  const last = history.undoStack[history.undoStack.length - 1]!;
  return {
    current: JSON.parse(last.beforeJson) as EnterpriseGraph,
    undoStack: history.undoStack.slice(0, -1),
    redoStack: [...history.redoStack, last],
  };
}

/**
 * Tee uudelleen (`Redo`) viimeksi kumottu `GraphCommand`-tapahtuma.
 */
export function redoGraphCommand(history: GraphHistoryStack): GraphHistoryStack {
  if (history.redoStack.length === 0) return history;
  const nextEntry = history.redoStack[history.redoStack.length - 1]!;
  return {
    current: JSON.parse(nextEntry.afterJson) as EnterpriseGraph,
    undoStack: [...history.undoStack, nextEntry],
    redoStack: history.redoStack.slice(0, -1),
  };
}
