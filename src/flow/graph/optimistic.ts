/**
 * APEX Studio v3.2 — Speed 2 Optimistic Node Patching, Ghost Isolation & Subsystem Scoping
 * (`src/flow/graph/optimistic.ts`).
 *
 * Implements TSD v3.2 Sections 1.3 (Invariant A4), 2.5 (`set_root_scope`), 6.5 (#6), Override 4, and 8.1:
 * - `applyOptimisticPatch`: creates a local `OptimisticNodePatch` and ghost node (`definition: "named"`,
 *   `ghost: { patchId, status: "pending", requestedAt }`) in `< 50 ms` without an LLM call.
 * - `rollbackOptimisticPatch`: restores `EnterpriseGraph` to its `baseVersion` state in a single
 *   deterministic transition (supporting a stack of multiple open patches).
 * - Strict Ghost Isolation (Override 4 & Invariant 6): ghost nodes are excluded from cash, general
 *   ledger, KPI strip, break-even, and Monte Carlo (`0.00` impact on real `simulateGraph`).
 * - `runShadowPreviewWithDefaults`: computes an isolated shadow `SimulationRun` preview using
 *   conservative default physics for ghost nodes (`"arvaus, oletusarvoilla"`) without mutating
 *   or persisting anything into the real `EnterpriseGraph`.
 * - `setRootScope`: sets or clears `graph.scopeRoot` (`set_root_scope`) for Subsystem Scoping.
 */
import type {
  AsyncLLMHydration,
  AtomKind,
  EnterpriseGraph,
  EntityURI,
  GraphCommand,
  HierarchicalStreamEdge,
  NodeBand,
  OptimisticNodePatch,
  PhysicsModule,
  Port,
  UniversalEnterpriseNode,
} from "./types.ts";
import { deterministicHash } from "./compiler.ts";
import { applyGraphCommand, validateGraphCommand } from "./commands.ts";
import { simulateGraph, type SimulationRun } from "./simulate.ts";

export interface OptimisticDraftSpec {
  slug?: string;
  name: string;
  parentUri?: EntityURI;
  band?: NodeBand;
  apqcCategory?: number;
  atom?: AtomKind;
  connectFromUri?: EntityURI;
  connectToUri?: EntityURI;
  unitUri?: EntityURI;
  estimatedCapacityPerTick?: number;
  estimatedCycleTicks?: number;
  estimatedUnitPrice?: number;
  estimatedUnitCost?: number;
  estimatedFixedCostPerTick?: number;
}

export interface OptimisticApplyResult {
  graph: EnterpriseGraph;
  patch: OptimisticNodePatch;
  elapsedMs: number;
}

export interface OptimisticRollbackResult {
  graph: EnterpriseGraph;
  rolledBackPatch: OptimisticNodePatch | null;
  remainingPatches: OptimisticNodePatch[];
}

export interface ShadowPreviewResult {
  run: SimulationRun;
  label: string;
  disclaimer: string;
  isShadowPreview: true;
  ghostNodeUris: EntityURI[];
}

interface PatchStackEntry {
  patch: OptimisticNodePatch;
  draft: OptimisticDraftSpec;
  baseSnapshotJson: string;
}

/**
 * Per-graph optimistic patch stack keyed by `graph.id`.
 */
const PATCH_STACKS = new Map<string, PatchStackEntry[]>();

const sanitizeSlug = (raw: string): string =>
  raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "") || "draft_node";

function buildDefaultGhostPhysics(draft: OptimisticDraftSpec): PhysicsModule[] {
  const atom: AtomKind = draft.atom ?? "time_capacity";
  const cap = draft.estimatedCapacityPerTick ?? 12;
  const cyc = draft.estimatedCycleTicks ?? 1;
  const price = draft.estimatedUnitPrice ?? 100;
  const varCost = draft.estimatedUnitCost ?? 30;
  const fixCost = draft.estimatedFixedCostPerTick ?? 15;

  switch (atom) {
    case "physical_matter":
      return [
        {
          atom: "physical_matter",
          params: {
            capacityPerTick: { const: cap },
            cycleTicks: { const: cyc },
            firstPassYield: { const: 0.98 },
            unitPrice: { const: price },
            variableCost: { const: varCost },
            fixedCostPerTick: { const: fixCost },
            spoilageRate: { const: 0.01 },
          },
        },
      ];
    case "recurring_subscription":
      return [
        {
          atom: "recurring_subscription",
          params: {
            capacityPerTick: { const: cap },
            cycleTicks: { const: cyc },
            firstPassYield: { const: 1 },
            activeBase: { const: 25 },
            newPerTick: { const: 0.5 },
            churnPerTick: { const: 0.001 },
            pricePerTick: { const: price / 30 },
            costPerActivePerTick: { const: varCost / 30 },
            cacPerNew: { const: 20 },
            fixedCostPerTick: { const: fixCost },
          },
        },
      ];
    case "transactional_trade":
      return [
        {
          atom: "transactional_trade",
          params: {
            capacityPerTick: { const: cap },
            cycleTicks: { const: cyc },
            firstPassYield: { const: 1 },
            visitorsPerTick: { const: 20 },
            conversionRate: { const: 0.35 },
            averageTicket: { const: price },
            costPerSale: { const: varCost },
            fixedCostPerTick: { const: fixCost },
          },
        },
      ];
    case "credit_working_capital":
      return [
        {
          atom: "credit_working_capital",
          params: {
            paymentTermsDays: { const: 14 },
            badDebtRate: { const: 0 },
          },
        },
      ];
    case "time_capacity":
    default:
      return [
        {
          atom: "time_capacity",
          params: {
            capacityPerTick: { const: cap },
            cycleTicks: { const: cyc },
            firstPassYield: { const: 1 },
            unitPrice: { const: price },
            variableCost: { const: varCost },
            fixedCostPerTick: { const: fixCost },
          },
        },
      ];
  }
}

/**
 * Luonnostelee ja kytkee paikallisen `OptimisticNodePatch` ghost-solmun graafiin `< 50 ms` vasteajalla
 * (TSD 1.3 Invariantti A4 & 8.1).
 */
export function applyOptimisticPatch(
  graph: EnterpriseGraph,
  request: string,
  localDraft: OptimisticDraftSpec,
): OptimisticApplyResult {
  const t0 = performance.now();
  const baseSnapshotJson = JSON.stringify(graph);
  const nextGraph = JSON.parse(baseSnapshotJson) as EnterpriseGraph;

  const existingStack = PATCH_STACKS.get(graph.id) ?? [];
  const baseVersion = nextGraph.version + existingStack.length;
  const seq = existingStack.length + 1;
  const hash = deterministicHash(`${graph.id}:${seq}:${request}:${localDraft.name}`);
  const patchId = `patch_${hash}_${seq}`;
  const requestedAt = new Date().toISOString();

  const parentUri: EntityURI =
    localDraft.parentUri && nextGraph.nodes[localDraft.parentUri]
      ? localDraft.parentUri
      : nextGraph.scopeRoot && nextGraph.nodes[nextGraph.scopeRoot]
        ? nextGraph.scopeRoot
        : nextGraph.root;
  const parentNode = nextGraph.nodes[parentUri]!;
  const level = Math.min(5, parentNode.level + 1);
  const band: NodeBand = localDraft.band ?? "value_stream";
  const apqcCategory = localDraft.apqcCategory ?? (band === "value_stream" ? 3.0 : 8.0);
  const unitUri: EntityURI = localDraft.unitUri ?? "apex://unit/items";

  const rawSlug = sanitizeSlug(localDraft.slug ?? localDraft.name);
  let nodeUri: EntityURI = `apex://node/ghost_${rawSlug}`;
  if (nextGraph.nodes[nodeUri]) {
    nodeUri = `apex://node/ghost_${rawSlug}_${seq}`;
  }

  const ports: Port[] = [
    {
      id: "in_main",
      name: "Input",
      side: "I",
      unit: unitUri,
      ratio: { const: 1 },
    },
    {
      id: "ctrl_policy",
      name: "Control",
      side: "C",
      unit: unitUri,
      ratio: { const: 1 },
    },
    {
      id: "out_main",
      name: "Output",
      side: "O",
      unit: unitUri,
      ratio: { const: 1 },
    },
    {
      id: "mech_main",
      name: "Mechanism",
      side: "M",
      unit: "apex://unit/hours",
      ratio: { const: 1 },
    },
  ];

  const ghostNode: UniversalEnterpriseNode = {
    uri: nodeUri,
    name: localDraft.name,
    apqcCategory,
    level,
    band,
    tags: ["optimistic_draft"],
    parent: parentUri,
    children: [],
    definition: "named",
    ghost: {
      patchId,
      status: "pending",
      requestedAt,
    },
    ports,
    physics: buildDefaultGhostPhysics(localDraft),
    mechanisms: [],
    ledgerBindings: [],
    kpis: [],
  };

  nextGraph.nodes[nodeUri] = ghostNode;
  if (!parentNode.children.includes(nodeUri)) {
    parentNode.children.push(nodeUri);
  }

  const localCommands: GraphCommand[] = [{ type: "add_node", node: ghostNode }];

  // Kytke luonnosvirta (status: "stub"), jos ylä- tai alavirran solmu on määritelty tai olemassa
  const connectFrom =
    localDraft.connectFromUri && nextGraph.nodes[localDraft.connectFromUri]
      ? localDraft.connectFromUri
      : Object.values(nextGraph.nodes).find(
          (n) =>
            n.uri !== nodeUri &&
            n.parent === parentUri &&
            n.band === "value_stream" &&
            n.definition === "defined",
        )?.uri;

  if (connectFrom) {
    const fromNode = nextGraph.nodes[connectFrom]!;
    const fromPort = fromNode.ports.find((p) => p.side === "O")?.id ?? "out_main";
    const streamUri: EntityURI = `apex://stream/ghost_${rawSlug}_${seq}`;
    const draftStream: HierarchicalStreamEdge = {
      uri: streamUri,
      name: `${fromNode.name} → ${ghostNode.name}`,
      parent: null,
      children: [],
      from: { node: connectFrom, port: fromPort },
      to: { node: nodeUri, port: "in_main" },
      unit: unitUri,
      routing: { kind: "direct" },
      status: "stub",
      latencyTicks: { const: 1 },
      lossRate: { const: 0 },
      transferCostPerUnit: { const: 0 },
    };
    nextGraph.streams[streamUri] = draftStream;
    localCommands.push({ type: "connect_stream", stream: draftStream });
  }

  if (localDraft.connectToUri && nextGraph.nodes[localDraft.connectToUri]) {
    const toNode = nextGraph.nodes[localDraft.connectToUri]!;
    const toPort = toNode.ports.find((p) => p.side === "I")?.id ?? "in_main";
    const streamUri: EntityURI = `apex://stream/ghost_${rawSlug}_out_${seq}`;
    const draftStream: HierarchicalStreamEdge = {
      uri: streamUri,
      name: `${ghostNode.name} → ${toNode.name}`,
      parent: null,
      children: [],
      from: { node: nodeUri, port: "out_main" },
      to: { node: toNode.uri, port: toPort },
      unit: unitUri,
      routing: { kind: "direct" },
      status: "stub",
      latencyTicks: { const: 1 },
      lossRate: { const: 0 },
      transferCostPerUnit: { const: 0 },
    };
    nextGraph.streams[streamUri] = draftStream;
    localCommands.push({ type: "connect_stream", stream: draftStream });
  }

  const patch: OptimisticNodePatch = {
    patchId,
    request,
    localCommands,
    ghostNodes: [nodeUri],
    baseVersion,
    status: "pending",
  };

  PATCH_STACKS.set(graph.id, [
    ...existingStack,
    {
      patch,
      draft: localDraft,
      baseSnapshotJson,
    },
  ]);

  const elapsedMs = performance.now() - t0;
  return { graph: nextGraph, patch, elapsedMs };
}

/**
 * Palauttaa graafin avoimet `OptimisticNodePatch`-luonnokset.
 */
export function getPendingOptimisticPatches(graph: EnterpriseGraph): OptimisticNodePatch[] {
  const stack = PATCH_STACKS.get(graph.id) ?? [];
  const activeGhostPatchIds = new Set(
    Object.values(graph.nodes)
      .map((n) => n.ghost?.patchId)
      .filter((id): id is string => Boolean(id)),
  );
  return stack
    .filter((entry) => entry.patch.status === "pending" && activeGhostPatchIds.has(entry.patch.patchId))
    .map((entry) => entry.patch);
}

/**
 * Kumoa/palauta (`rollbackOptimisticPatch`) annetun `patchId`:n (tai viimeisimmän avoimen luonnoksen)
 * yhdellä deterministisellä tilasiirtymällä takaisin `baseVersion`-tilaan (TSD 1.3 A4 & 8.1).
 */
export function rollbackOptimisticPatch(
  graph: EnterpriseGraph,
  patchId?: string,
): OptimisticRollbackResult {
  const stack = PATCH_STACKS.get(graph.id) ?? [];
  if (stack.length > 0) {
    const targetIdx = patchId
      ? stack.findIndex((e) => e.patch.patchId === patchId)
      : stack.length - 1;

    if (targetIdx >= 0) {
      const targetEntry = stack[targetIdx]!;
      const rolledBackPatch: OptimisticNodePatch = {
        ...targetEntry.patch,
        status: "rolled_back",
      };

      // Palauta kohdetta edeltävä täydellinen tilannekuva
      let restoredGraph = JSON.parse(targetEntry.baseSnapshotJson) as EnterpriseGraph;
      const newerEntries = stack.slice(targetIdx + 1);
      const keptEntries = stack.slice(0, targetIdx);
      PATCH_STACKS.set(graph.id, keptEntries);

      // Jos pinossa oli uudempia luonnoksia ja kumottiin aiempi patchId, sovelletaan uudemmat luonnokset uudelleen
      for (const newer of newerEntries) {
        const reapplied = applyOptimisticPatch(restoredGraph, newer.patch.request, newer.draft);
        restoredGraph = reapplied.graph;
      }

      const finalStack = PATCH_STACKS.get(graph.id) ?? [];
      return {
        graph: restoredGraph,
        rolledBackPatch,
        remainingPatches: finalStack.map((e) => e.patch),
      };
    }
  }

  // Varapolku: poista ghost-solmut ja niihin kytketyt stub-virrat suoraan graafista
  const nextGraph = JSON.parse(JSON.stringify(graph)) as EnterpriseGraph;
  const removedUris = new Set<EntityURI>();
  for (const node of Object.values(nextGraph.nodes)) {
    if (node.ghost && (!patchId || node.ghost.patchId === patchId)) {
      removedUris.add(node.uri);
      delete nextGraph.nodes[node.uri];
    }
  }
  for (const node of Object.values(nextGraph.nodes)) {
    node.children = node.children.filter((c) => !removedUris.has(c));
  }
  for (const [sUri, stream] of Object.entries(nextGraph.streams)) {
    if (removedUris.has(stream.from.node) || removedUris.has(stream.to.node)) {
      delete nextGraph.streams[sUri];
    }
  }

  return {
    graph: nextGraph,
    rolledBackPatch: patchId
      ? {
          patchId,
          request: "",
          localCommands: [],
          ghostNodes: [...removedUris],
          baseVersion: nextGraph.version,
          status: "rolled_back",
        }
      : null,
    remainingPatches: getPendingOptimisticPatches(nextGraph),
  };
}

/**
 * Asettaa tai palauttaa graafin alipuun rajauksen (`set_root_scope`, TSD 2.5).
 * Kun `scopeRootUri` on `null` tai `graph.root`, näkymä palaa koko yrityksen juureen (`L0`).
 */
export function setRootScope(
  graph: EnterpriseGraph,
  scopeRootUri: EntityURI | null,
): EnterpriseGraph {
  const nextGraph = JSON.parse(JSON.stringify(graph)) as EnterpriseGraph;
  if (!scopeRootUri || scopeRootUri === nextGraph.root || !nextGraph.nodes[scopeRootUri]) {
    delete nextGraph.scopeRoot;
  } else {
    nextGraph.scopeRoot = scopeRootUri;
  }
  return nextGraph;
}

/**
 * Laskee eristetyn varjoajon (`ShadowPreviewResult`) oletusarvoilla (TSD 6.5 #6 & Override 4):
 * - EI koskaan muuta varsinaista `EnterpriseGraph`-rakennetta tai sen tallennettua tilaa.
 * - Aktivoi tilapäisessä varjokopiossa `ghost` / `named` -solmut oletusfysiikalla ja palauttaa
 *   erillisen `SimulationRun`-esikatselun merkinnällä `"arvaus, oletusarvoilla"`.
 */
export function runShadowPreviewWithDefaults(graph: EnterpriseGraph): ShadowPreviewResult {
  const shadowGraph = JSON.parse(JSON.stringify(graph)) as EnterpriseGraph;
  const ghostNodeUris: EntityURI[] = [];

  for (const node of Object.values(shadowGraph.nodes)) {
    if (node.ghost?.status === "pending" || node.definition === "named") {
      ghostNodeUris.push(node.uri);
      node.definition = "defined";
      delete node.ghost;
      if (!node.physics || node.physics.length === 0) {
        node.physics = buildDefaultGhostPhysics({ name: node.name });
      }
    }
  }

  for (const stream of Object.values(shadowGraph.streams)) {
    if (stream.status === "stub") {
      stream.status = "active";
    }
  }

  const run = simulateGraph(shadowGraph);
  return {
    run,
    label: "arvaus, oletusarvoilla",
    disclaimer:
      "Varjoajo oletusarvoilla — ei tallennettu malliin, kassaan, pääkirjaan eikä KPI-nauhaan.",
    isShadowPreview: true,
    ghostNodeUris,
  };
}

export interface OptimisticHydrationResult {
  graph: EnterpriseGraph;
  patch: OptimisticNodePatch | null;
  status: "hydrated" | "rolled_back";
  appliedCommands: GraphCommand[];
  preservedUserFactors: EntityURI[];
  error?: string;
}

/**
 * Hydratoi avoimen `OptimisticNodePatch`-luonnoksen asynkronisen LLM-vastauksen (`AsyncLLMHydration`)
 * validoiduilla `GraphCommand[]`-komennoilla (TSD 1.3 Invariantti A4 & 8.1):
 * - Muuttaa ghost-solmun tilasta `definition: "named"` -> `"defined"` ja `ghost.status: "hydrated"`.
 * - Käyttäjän muokkaussuoja: jos käyttäjä on odotuksen aikana muokannut mitä tahansa tekijää
 *   tai ghost-solmun parametria (`provenance.source === "user"`), saapuva LLM-hydraatio EI
 *   ylikirjoita käyttäjän arvoa!
 * - Jos komennoissa on yksikin epäkelpo komento tai hydraatio epäonnistuu/peruutetaan,
 *   suoritetaan automaattinen `rollbackOptimisticPatch` versioon `baseVersion` (säilyttäen käyttäjän
 *   muut odotuksen aikaiset `user`-muokkaukset).
 */
export function hydrateOptimisticPatch(
  graph: EnterpriseGraph,
  hydration: AsyncLLMHydration & { failed?: boolean; cancelled?: boolean; error?: string },
): OptimisticHydrationResult {
  const stack = PATCH_STACKS.get(graph.id) ?? [];
  const entryIdx = stack.findIndex((e) => e.patch.patchId === hydration.patchId);

  // Tarkista, mitkä tekijät käyttäjä on lukinnut (`provenance.source === "user"`) odotuksen aikana
  const userLockedFactors = new Map<EntityURI, { value: number; formula?: string; provenance?: typeof graph.factors[string]["provenance"] }>();
  for (const [fUri, factor] of Object.entries(graph.factors)) {
    if (factor.provenance?.source === "user") {
      userLockedFactors.set(fUri as EntityURI, {
        value: factor.value,
        formula: factor.formula,
        provenance: factor.provenance,
      });
    }
  }

  // Jos hydraatio on merkitty epäonnistuneeksi tai peruutetuksi, kumotaan luonnos heti
  if (hydration.failed || hydration.cancelled) {
    const rb = rollbackOptimisticPatch(graph, hydration.patchId);
    for (const [fUri, locked] of userLockedFactors.entries()) {
      if (rb.graph.factors[fUri]) {
        rb.graph.factors[fUri]!.value = locked.value;
        rb.graph.factors[fUri]!.provenance = locked.provenance ?? { source: "user" };
      }
    }
    return {
      graph: rb.graph,
      patch: rb.rolledBackPatch
        ? {
            ...rb.rolledBackPatch,
            status: hydration.cancelled ? "cancelled" : "failed",
          }
        : null,
      status: "rolled_back",
      appliedCommands: [],
      preservedUserFactors: [...userLockedFactors.keys()],
      error: hydration.error ?? "Hydration failed or cancelled",
    };
  }

  // Validoi kaikki saapuneet komennot ennen suorittamista (Two-Phase Commit)
  let curGraph = JSON.parse(JSON.stringify(graph)) as EnterpriseGraph;
  const validated: GraphCommand[] = [];
  const preservedUserFactors: EntityURI[] = [];

  for (const rawCmd of hydration.streamed ?? []) {
    const valid = validateGraphCommand(rawCmd, curGraph);
    if (!valid) {
      // Yksikin epäkelpo komento -> automaattinen rollback baseVersion-tilaan!
      const rb = rollbackOptimisticPatch(graph, hydration.patchId);
      for (const [fUri, locked] of userLockedFactors.entries()) {
        if (rb.graph.factors[fUri]) {
          rb.graph.factors[fUri]!.value = locked.value;
          rb.graph.factors[fUri]!.provenance = locked.provenance ?? { source: "user" };
        }
      }
      return {
        graph: rb.graph,
        patch: rb.rolledBackPatch ? { ...rb.rolledBackPatch, status: "failed" } : null,
        status: "rolled_back",
        appliedCommands: [],
        preservedUserFactors: [...userLockedFactors.keys()],
        error: "Invalid GraphCommand in hydration stream",
      };
    }

    if (
      (valid.type === "set_factor" || valid.type === "set_formula") &&
      userLockedFactors.has(valid.uri)
    ) {
      preservedUserFactors.push(valid.uri);
    }

    curGraph = applyGraphCommand(curGraph, valid, {
      provenance: { source: "coach", note: "AsyncLLMHydration" },
      respectUserLocks: true,
    });
    validated.push(valid);
  }

  // Päivitä ghost-solmut tilaan `definition: "defined"` ja `ghost.status: "hydrated"`
  const targetGhostUris = new Set<EntityURI>(
    entryIdx >= 0 ? stack[entryIdx]!.patch.ghostNodes : [],
  );
  for (const node of Object.values(curGraph.nodes)) {
    if (node.ghost?.patchId === hydration.patchId || targetGhostUris.has(node.uri)) {
      node.definition = "defined";
      node.ghost = {
        patchId: hydration.patchId,
        status: "hydrated",
        requestedAt: node.ghost?.requestedAt ?? new Date().toISOString(),
      };
    }
  }

  // Aktivoi hydratoidun solmun stub-virrat
  for (const stream of Object.values(curGraph.streams)) {
    const fromHydrated =
      curGraph.nodes[stream.from.node]?.ghost?.patchId === hydration.patchId ||
      targetGhostUris.has(stream.from.node);
    const toHydrated =
      curGraph.nodes[stream.to.node]?.ghost?.patchId === hydration.patchId ||
      targetGhostUris.has(stream.to.node);
    if ((fromHydrated || toHydrated) && stream.status === "stub") {
      stream.status = "active";
    }
  }

  let updatedPatch: OptimisticNodePatch | null = null;
  if (entryIdx >= 0) {
    updatedPatch = {
      ...stack[entryIdx]!.patch,
      status: "hydrated",
    };
    const nextStack = [...stack];
    nextStack.splice(entryIdx, 1);
    PATCH_STACKS.set(graph.id, nextStack);
  }

  return {
    graph: curGraph,
    patch: updatedPatch,
    status: "hydrated",
    appliedCommands: validated,
    preservedUserFactors,
  };
}

/**
 * Ei-blokkaava taustaorkestrointi (`orchestrateAsyncHydration`, TSD 1.3 A4 & 8.1):
 * Ajaa asynkronisen LLM-hydraatiotehtävän taustalla (esim. 5 s viiveellä) blokkaamatta
 * paikallisia `set_factor`-säätimiä, kunnioittaa käyttäjän odotuksen aikana tekemiä
 * `provenance: "user"` -muokkauksia ja suorittaa automaattisen rollbackin virheen tai
 * aikakatkaisun sattuessa.
 */
export async function orchestrateAsyncHydration(opts: {
  getGraph: () => EnterpriseGraph;
  setGraph: (next: EnterpriseGraph) => void;
  patchId: string;
  task: () => Promise<AsyncLLMHydration>;
  timeoutMs?: number;
  signal?: AbortSignal;
}): Promise<OptimisticHydrationResult> {
  const timeoutMs = opts.timeoutMs ?? 5000;

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    if (opts.signal?.aborted) {
      const res = hydrateOptimisticPatch(opts.getGraph(), {
        patchId: opts.patchId,
        streamed: [],
        cancelled: true,
        error: "Aborted before start",
      });
      opts.setGraph(res.graph);
      return res;
    }

    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("Hydration timeout")), timeoutMs);
    });

    const abortPromise = opts.signal
      ? new Promise<never>((_, reject) => {
          opts.signal!.addEventListener(
            "abort",
            () => reject(new Error("Hydration cancelled")),
            { once: true },
          );
        })
      : null;

    const hydration = await Promise.race(
      abortPromise ? [opts.task(), timeoutPromise, abortPromise] : [opts.task(), timeoutPromise],
    );

    const res = hydrateOptimisticPatch(opts.getGraph(), hydration);
    opts.setGraph(res.graph);
    return res;
  } catch (err) {
    const isCancel =
      opts.signal?.aborted || (err instanceof Error && /cancel|abort/i.test(err.message));
    const res = hydrateOptimisticPatch(opts.getGraph(), {
      patchId: opts.patchId,
      streamed: [],
      failed: !isCancel,
      cancelled: isCancel,
      error: err instanceof Error ? err.message : String(err),
    });
    opts.setGraph(res.graph);
    return res;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
