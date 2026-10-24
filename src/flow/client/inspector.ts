/**
 * APEX Studio v3.2 — Unified Shell Zones (Navigator, 6-Tab Inspector, Classic Telemetry & Timeline Branch Bar)
 * (`src/flow/client/inspector.ts`).
 *
 * Implements TSD v3.2 Sections 2.1, 2.3, 2.4, 2.5, 4.4 and Checkpoint 2 (V1):
 * - Enriches migrated `EnterpriseGraph` with universal `BusinessCapability`, `RoleCapability`,
 *   `SystemCapability`, and `AssetCapability` entities.
 * - Provides global `apex://` entity search across `EntityRegistry`.
 * - Renders Zone 2 (Hierarchy Navigator + Categorized Entity Library).
 * - Renders Zone 4 (6-Tab Inspector with ported Classic Financial, Buffer/Ops, and Org/RACI telemetry).
 * - Renders Zone 5 (Git-style Scenario Branch Bar, Monte Carlo P10/P50/P90 strip, Crisis Event cards, and Cash Timeline).
 */
import type { Molecule, ProvenanceSource } from "../kernel/types.ts";
import type {
  BusinessCapability,
  Capability,
  EnterpriseGraph,
  EntityURI,
  FactorNode,
  FactorRef,
  Port,
  UniversalEnterpriseNode,
  VentureMaturity,
} from "../graph/types.ts";
import { migrateMoleculeToGraph } from "../graph/migrate.ts";
import { buildRegistry, type EntityRegistry } from "../graph/registry.ts";
import { simulateGraph, type SimulationRun } from "../graph/simulate.ts";
import { buildBusinessCapabilitiesFromTemplate, selectCapabilityTemplate } from "../graph/gaps.ts";
import {
  applyOptimisticPatch,
  setRootScope,
  type OptimisticDraftSpec,
} from "../graph/optimistic.ts";
import type { FlowView, NodeId } from "../model/view.ts";
import { leversFor, type Lever } from "../model/levers.ts";
import { atomPriceTolerance, hireBreakEven } from "../kernel/sensitivity.ts";
import { CRISIS_LIBRARY } from "../model/seasons.ts";
import { SOURCE_LABELS } from "../model/provenance.ts";
import { esc, eur, int, money, num, pct, signedEur } from "../model/format.ts";
import {
  INSPECTOR_TAB_LABELS,
  personaDef,
  type InspectorTabId,
  type LensId,
  type PersonaId,
} from "../model/personas.ts";
import { t } from "../i18n/index.ts";
import { renderTimeline } from "./canvas.ts";
import { scenarioMetrics, type Scenario } from "../model/scenarios.ts";

export interface StudioGraphOverrides {
  customBizCaps?: BusinessCapability[];
  bizCapStatuses?: Record<string, "known" | "unclear" | "missing">;
  customPorts?: Record<string, Port[]>;
  templateId?: string;
  scopeRootUri?: EntityURI | null;
  optimisticDrafts?: { request: string; draft: OptimisticDraftSpec }[];
}

export interface StudioGraphState {
  graph: EnterpriseGraph;
  registry: EntityRegistry;
  run: SimulationRun;
}

export interface SearchHit {
  uri: EntityURI;
  kind: string;
  title: string;
  subtitle: string;
}

function resolveRefValue(graph: EnterpriseGraph, ref: FactorRef | undefined, fallback = 0): number {
  if (!ref) return fallback;
  if ("const" in ref) return ref.const;
  return graph.factors[ref.factor]?.value ?? fallback;
}

function formatLeverVal(l: Pick<Lever, "format" | "step">, v: number): string {
  switch (l.format) {
    case "eur":
      return eur(v);
    case "pct":
      return pct(v, l.step < 0.01 ? 1 : 0);
    case "int":
      return int(v);
    case "days":
      return t("{n} pv", { n: int(v) });
    default:
      return num(v);
  }
}

/**
 * Muuntaa `Molecule`-mallin `EnterpriseGraph`-rakenteeksi, rikastaa sen oletuskyvykkyyksillä
 * (`BusinessCapability`, `RoleCapability`, `SystemCapability`, `AssetCapability`) ja ajaa
 * graafisimulaattorin.
 */
export function buildStudioGraphState(
  molecule: Molecule,
  maturity: VentureMaturity = 3,
  decomposedParentUris: Iterable<EntityURI> = [],
  overrides: StudioGraphOverrides = {},
): StudioGraphState {
  const graph = migrateMoleculeToGraph(molecule);
  graph.maturity = maturity;

  // 1. Lisää universaalit rooli-, järjestelmä- ja kalustokyvykkyydet
  const valueNodes = Object.values(graph.nodes).filter((n) => n.level === 1 && n.band === "value_stream");
  const enablingNodes = Object.values(graph.nodes).filter((n) => n.level === 1 && n.band === "enabling");

  const totalPeople = molecule.atoms.reduce((sum, a) => {
    if (!a.enabled) return sum;
    return sum + (a.kind === "TIME_CAPACITY" ? a.people : 1);
  }, 0);
  const fteCount = Math.max(1, totalPeople);
  const timeAtom = molecule.atoms.find((a) => a.kind === "TIME_CAPACITY");
  const avgMonthlySalary =
    timeAtom && timeAtom.kind === "TIME_CAPACITY" ? timeAtom.salaryPerPersonMonth : 3600;

  const fteFactorUri: EntityURI = "apex://factor/cap_core_team_fte";
  graph.factors[fteFactorUri] = {
    uri: fteFactorUri,
    name: t("Ydintiimin henkilöstömitoitus"),
    alias: "team.fte",
    kind: "lever",
    value: fteCount,
    unit: "fte",
  };

  const roleOpsUri: EntityURI = "apex://role/core_delivery_team";
  const roleSalesUri: EntityURI = "apex://role/demand_and_customer_lead";
  const sysWorkflowUri: EntityURI = "apex://system/core_workflow_platform";
  const sysRecordUri: EntityURI = "apex://system/financial_ledger_system";
  const assetBufferUri: EntityURI = "apex://asset/fulfillment_capacity_pool";

  const capabilities: Record<string, Capability> = {
    [roleOpsUri]: {
      kind: "role",
      uri: roleOpsUri,
      name: t("Tuotanto- ja toimitustiimi"),
      orgUnit: "apex://unit-org/operations",
      fte: { factor: fteFactorUri },
      costPerFtePerTick: { const: Math.round((avgMonthlySalary * 1.3) / 30) },
      hoursPerFtePerTick: { const: 7.5 },
      proficiency: { const: 0.92 },
    },
    [roleSalesUri]: {
      kind: "role",
      uri: roleSalesUri,
      name: t("Asiakkuus- ja myyntivastuu"),
      orgUnit: "apex://unit-org/commercial",
      fte: { const: Math.max(1, Math.round(fteCount * 0.35)) },
      costPerFtePerTick: { const: Math.round((avgMonthlySalary * 1.25) / 30) },
      hoursPerFtePerTick: { const: 7.5 },
      proficiency: { const: 0.88 },
    },
    [sysWorkflowUri]: {
      kind: "system",
      uri: sysWorkflowUri,
      name: t("Toiminnanohjaus ja työnkulku"),
      layer: "workflow",
      fixedCostPerTick: { const: 12 },
      capex: { const: 0 },
      availability: { const: 0.995 },
    },
    [sysRecordUri]: {
      kind: "system",
      uri: sysRecordUri,
      name: t("Laskutus- ja talousjärjestelmä"),
      layer: "record",
      fixedCostPerTick: { const: 6 },
      capex: { const: 0 },
      availability: { const: 0.999 },
    },
    [assetBufferUri]: {
      kind: "asset",
      uri: assetBufferUri,
      name: t("Toimitus- ja palvelukapasiteetti"),
      capacityPerTick: { const: 1_000_000 },
      operatingCostPerTick: { const: 15 },
      capex: { const: 5000 },
      usefulLifeTicks: { const: 1080 },
    },
  };
  graph.capabilities = capabilities;

  for (let i = 0; i < valueNodes.length; i++) {
    const vn = valueNodes[i]!;
    vn.owner = i === 0 ? roleOpsUri : roleSalesUri;
    const mPortRole: Port = {
      id: "mech_role",
      name: t("Henkilöstöresurssi"),
      side: "M",
      unit: "apex://unit/hours",
      ratio: { const: 1 },
    };
    const mPortSys: Port = {
      id: "mech_sys",
      name: t("Järjestelmätuki"),
      side: "M",
      unit: "apex://unit/hours",
      ratio: { const: 1 },
    };
    const cPortPolicy: Port = {
      id: "ctrl_policy",
      name: t("Laatu- ja katetavoite"),
      side: "C",
      unit: "apex://unit/monetary",
      ratio: { const: 1 },
    };
    vn.ports.push(mPortRole, mPortSys, cPortPolicy);
    vn.mechanisms = [
      {
        capability: roleOpsUri,
        capacityContribution: { const: 1_000_000 },
        critical: true,
        fallbackMultiplier: { const: 0.35 },
      },
      {
        capability: sysWorkflowUri,
        capacityContribution: { const: 1_000_000 },
        critical: false,
        fallbackMultiplier: { const: 0.75 },
      },
      {
        capability: assetBufferUri,
        capacityContribution: { const: 1_000_000 },
        critical: false,
        fallbackMultiplier: { const: 0.8 },
      },
    ];
  }

  for (const en of enablingNodes) {
    en.owner = roleSalesUri;
    en.ports.push({
      id: "mech_ledger",
      name: t("Talousautomaatio"),
      side: "M",
      unit: "apex://unit/monetary",
      ratio: { const: 1 },
    });
    en.mechanisms = [
      {
        capability: sysRecordUri,
        capacityContribution: { const: 1_000_000 },
        critical: true,
        fallbackMultiplier: { const: 0.5 },
      },
      {
        capability: roleSalesUri,
        capacityContribution: { const: 1_000_000 },
        critical: false,
        fallbackMultiplier: { const: 0.8 },
      },
    ];
  }

  // 2. Lisää liiketoimintakyvykkyydet (`BusinessCapability`) kypsyystasoja 0–3 varten (TSD 4.4)
  const firstValueUri = valueNodes[0]?.uri;
  const firstEnablingUri = enablingNodes[0]?.uri;

  const bcDemandUri: EntityURI = "apex://capability-biz/customer_demand_validation";
  const bcOfferingUri: EntityURI = "apex://capability-biz/value_proposition_and_pricing";
  const bcSourcingUri: EntityURI = "apex://capability-biz/sourcing_and_partner_network";
  const bcFulfillmentUri: EntityURI = "apex://capability-biz/service_and_product_delivery";
  const bcComplianceUri: EntityURI = "apex://capability-biz/regulatory_and_contracts";
  const bcCashControlUri: EntityURI = "apex://capability-biz/working_capital_and_billing";

  const businessCapabilities: Record<string, BusinessCapability> = {
    [bcDemandUri]: {
      uri: bcDemandUri,
      name: t("Asiakasymmärrys ja kysynnän hankinta"),
      status: valueNodes.length > 0 ? "known" : "unclear",
      rationale: t("Miten asiakkaat löytävät yrityksen ja miksi he ostavat toistuvasti"),
      dependsOn: [bcOfferingUri],
      notes: [
        {
          kind: "cost",
          text: t("Asiakashankinnan ja markkinoinnin kuukausibudjetti"),
          amount: { const: 650 },
        },
        {
          kind: "question",
          text: t("Mikä on realistinen konversioaste ensimmäisen 90 päivän aikana?"),
        },
      ],
      canonicalRef: "APQC-3.0",
      realizedBy: firstValueUri && maturity > 0 ? [firstValueUri] : [],
      provenance: "template",
    },
    [bcOfferingUri]: {
      uri: bcOfferingUri,
      name: t("Tuote- tai palvelulupaus ja hinnoittelu"),
      status: "known",
      rationale: t("Ydinratkaisu, yksikköhinta ja myyntikatteen rakenne"),
      dependsOn: [],
      notes: [
        {
          kind: "cost",
          text: t("Tuotekehityksen, näytteiden ja validoinnin peruskulut"),
          amount: { const: 400 },
        },
      ],
      canonicalRef: "APQC-2.0",
      realizedBy: firstValueUri && maturity > 0 ? [firstValueUri] : [],
      provenance: "template",
    },
    [bcSourcingUri]: {
      uri: bcSourcingUri,
      name: t("Toimittaja-, alihankinta- ja materiaaliketju"),
      status: maturity <= 1 ? "unclear" : "known",
      rationale: t("Mistä raaka-aineet, komponentit tai alihankintakapasiteetti hankitaan"),
      dependsOn: [bcOfferingUri],
      notes: [
        {
          kind: "risk",
          text: t("Yhden toimittajan riippuvuus ja toimitusajan vaihtelu"),
        },
        {
          kind: "cost",
          text: t("Alkuvaraston tai työvälineiden sitoma pääoma"),
        },
      ],
      canonicalRef: "APQC-4.1",
      realizedBy: firstValueUri && maturity > 0 ? [firstValueUri] : [],
      provenance: "template",
    },
    [bcFulfillmentUri]: {
      uri: bcFulfillmentUri,
      name: t("Toimituskyky ja laadunvarmistus"),
      status: valueNodes.length > 0 ? "known" : "missing",
      rationale: t("Varsinainen asiakastoimitus, kapasiteettirajat ja läpimenoaika"),
      dependsOn: [bcSourcingUri, bcDemandUri],
      notes: [
        {
          kind: "obligation",
          text: t("Toimitusvarmuus ja reklamaatioiden käsittelymalli"),
        },
      ],
      canonicalRef: "APQC-4.3 / 5.0",
      realizedBy: maturity > 0 ? valueNodes.map((n) => n.uri) : [],
      provenance: "template",
    },
    [bcComplianceUri]: {
      uri: bcComplianceUri,
      name: t("Lupa-, sopimus- ja vastuuvelvoitteet"),
      status: maturity < 2 ? "missing" : "unclear",
      rationale: t("Toimialakohtaiset luvat, vakuutukset, tuoteturvallisuus ja sopimusehdot"),
      dependsOn: [bcOfferingUri],
      notes: [
        {
          kind: "obligation",
          text: t("Vastuuvakuutus, viranomaisrekisteröinnit ja toimitusehdot"),
        },
        {
          kind: "cost",
          text: t("Vakuutukset ja lakisääteiset maksut"),
          amount: { const: 220 },
        },
        {
          kind: "question",
          text: t("Vaatiiko toiminta erillisen viranomaisluvan tai sertifioinnin ennen myynnin aloitusta?"),
        },
      ],
      canonicalRef: "APQC-11.0",
      realizedBy: firstEnablingUri && maturity > 0 ? [firstEnablingUri] : [],
      provenance: "template",
    },
    [bcCashControlUri]: {
      uri: bcCashControlUri,
      name: t("Laskutus, maksuehdot ja käyttöpääoman hallinta"),
      status: molecule.credit.customerTermsDays > 30 ? "unclear" : "known",
      rationale: t("Miten myyntisaamiset kotiutetaan ennen kuin ostovelat ja palkat erääntyvät"),
      dependsOn: [bcFulfillmentUri],
      notes: [
        {
          kind: "risk",
          text: t("Pitkä maksuaika sitoo kassaa ennen asiakasmaksun saapumista"),
        },
        {
          kind: "cost",
          text: t("Taloushallinnon ja maksuliikenteen peruskulut"),
          amount: { const: 280 },
        },
      ],
      canonicalRef: "APQC-9.0",
      realizedBy: firstEnablingUri && maturity > 0 ? [firstEnablingUri] : [],
      provenance: "template",
    },
  };
  if (overrides.templateId) {
    const tplCaps = buildBusinessCapabilitiesFromTemplate(selectCapabilityTemplate(overrides.templateId));
    for (const [u, bc] of Object.entries(tplCaps)) {
      businessCapabilities[u] = bc;
    }
  }
  for (const customBc of overrides.customBizCaps ?? []) {
    businessCapabilities[customBc.uri] = customBc;
  }
  for (const [bcUri, st] of Object.entries(overrides.bizCapStatuses ?? {})) {
    const existing = businessCapabilities[bcUri];
    if (existing) existing.status = st;
  }
  graph.businessCapabilities = businessCapabilities;

  for (const vn of valueNodes) {
    vn.realizes = [bcDemandUri, bcOfferingUri, bcFulfillmentUri];
  }
  for (const en of enablingNodes) {
    en.realizes = [bcComplianceUri, bcCashControlUri];
  }

  // Kypsyystaso 0 (Idea): vain L0-juurisolmu + BusinessCapability-kartta (P9 & validateGraph)
  if (maturity === 0) {
    const rootNode = graph.nodes[graph.root]!;
    graph.nodes = {
      [graph.root]: {
        ...rootNode,
        children: [],
        ports: [],
      },
    };
    graph.streams = {};
  } else {
    for (const parentUri of decomposedParentUris) {
      decomposeNodeIntoSubsteps(graph, parentUri);
    }
    for (const [nodeUri, ports] of Object.entries(overrides.customPorts ?? {})) {
      const targetNode = graph.nodes[nodeUri];
      if (targetNode) {
        targetNode.ports = [...targetNode.ports, ...ports];
      }
    }
  }

  let finalGraph = overrides.scopeRootUri ? setRootScope(graph, overrides.scopeRootUri) : graph;
  for (const item of overrides.optimisticDrafts ?? []) {
    finalGraph = applyOptimisticPatch(finalGraph, item.request, item.draft).graph;
  }

  const registry = buildRegistry(finalGraph);
  const run = simulateGraph(finalGraph, { registry });
  return { graph: finalGraph, registry, run };
}

/**
 * Pilkkoo valitun L1-solmun L2-alivaiheiksi Spotlight- ja Stream Bundling -tarkastelua varten.
 * Kalibroitu mitoosi & idempotenssisuoja:
 * - Ei koskaan pilko jo pilkottua solmua (`children.length > 0`) eikä pilkotun solmun alisolmua (`substep:`).
 * - Säilyttää koostesolmun kokonaiskapasiteetin, liikevaihdon, kulut ja kassavirran täsmälleen ennallaan.
 */
export function decomposeNodeIntoSubsteps(graph: EnterpriseGraph, parentUri: EntityURI): void {
  const parent = graph.nodes[parentUri];
  if (
    !parent ||
    parent.children.length > 0 ||
    parent.level >= 2 ||
    parent.tags.some((tg) => tg.startsWith("substep:"))
  ) {
    return;
  }

  const basePhysics = parent.physics ?? [];
  const stepSpecs = [
    { suffix: "intake", name: t("Vastaanotto ja valmistelu") },
    { suffix: "qualifier", name: t("Kapasiteetin varaus ja aloitus") },
    { suffix: "execution", name: t("Ydinsuoritus ja jalostus") },
    { suffix: "qa", name: t("Laadunvarmistus ja tarkastus") },
    { suffix: "handover", name: t("Toimitus ja laskutusvalmius") },
  ];

  const primaryUnit = parent.ports.find((p) => p.side === "I")?.unit ?? "apex://unit/items";
  const childUris: EntityURI[] = [];

  for (let i = 0; i < stepSpecs.length; i++) {
    const spec = stepSpecs[i]!;
    const childUri = `${parentUri}_${spec.suffix}` as EntityURI;
    childUris.push(childUri);

    const isFirst = i === 0;
    const childNode: UniversalEnterpriseNode = {
      uri: childUri,
      name: `${parent.name} · ${spec.name}`,
      apqcCategory: parent.apqcCategory,
      level: parent.level + 1,
      band: parent.band,
      definition: parent.definition ?? "defined",
      tags: [...parent.tags, `substep:${spec.suffix}`],
      parent: parentUri,
      children: [],
      ports: [
        {
          id: "in",
          name: t("Sisääntulo"),
          side: "I",
          unit: primaryUnit,
          ratio: { const: 1 },
        },
        {
          id: "out",
          name: t("Valmis suorite"),
          side: "O",
          unit: primaryUnit,
          ratio: { const: 1 },
          role: "primary",
        },
      ],
      physics: isFirst
        ? basePhysics
        : [
            {
              atom: "time_capacity",
              params: {
                capacityPerTick: { const: 1_000_000 },
                cycleTicks: { const: 0 },
                firstPassYield: { const: 1 },
                variableCost: { const: 0 },
                fixedCostPerTick: { const: 0 },
              },
            },
          ],
      mechanisms: isFirst ? parent.mechanisms.map((m) => ({ ...m })) : [],
      owner: parent.owner,
      ledgerBindings: isFirst ? parent.ledgerBindings.map((lb) => ({ ...lb })) : [],
      kpis: [],
    };
    graph.nodes[childUri] = childNode;

    if (i > 0) {
      const prevUri = childUris[i - 1]!;
      const streamUri = `apex://stream/${parentUri.slice("apex://node/".length)}_s${i}` as EntityURI;
      graph.streams[streamUri] = {
        uri: streamUri,
        name: `${stepSpecs[i - 1]!.name} → ${spec.name}`,
        parent: null,
        children: [],
        from: { node: prevUri, port: "out" },
        to: { node: childUri, port: "in" },
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
 * Globaali `apex://`-hakukone (Zone 1 Command Bar):
 * Hakee solmut, kertoimet (`FactorNode`), roolit, järjestelmät, kaluston, tilit ja liiketoimintakyvykkyydet.
 */
export function searchEntities(
  _graph: EnterpriseGraph,
  registry: EntityRegistry,
  rawQuery: string,
): SearchHit[] {
  const q = rawQuery.trim().toLowerCase();
  const hits: SearchHit[] = [];

  for (const [uri, entry] of registry.entities.entries()) {
    let title = "";
    let subtitle = uri;
    let kindLabel = "";

    switch (entry.kind) {
      case "node":
        title = entry.entity.name;
        kindLabel = `${t("Solmu")} L${entry.entity.level}`;
        break;
      case "factor":
        title = entry.entity.name;
        subtitle = entry.entity.alias ? `${entry.entity.alias} · ${uri}` : uri;
        kindLabel = t("Kerroin");
        break;
      case "capability":
        title = entry.entity.name;
        kindLabel =
          entry.entity.kind === "role"
            ? t("Rooli")
            : entry.entity.kind === "system"
              ? t("IT-järjestelmä")
              : t("Kalusto");
        break;
      case "business_capability":
        title = entry.entity.name;
        kindLabel = t("Kyvykkyys");
        break;
      case "account":
        title = `${entry.entity.code} ${entry.entity.name}`;
        kindLabel = t("Pääkirjatili");
        break;
      case "stream":
        title = entry.entity.name;
        kindLabel = t("Virta");
        break;
      case "unit":
        title = entry.entity.name;
        kindLabel = t("Virtausyksikkö");
        break;
    }

    if (
      !q ||
      uri.toLowerCase().includes(q) ||
      title.toLowerCase().includes(q) ||
      subtitle.toLowerCase().includes(q) ||
      kindLabel.toLowerCase().includes(q)
    ) {
      hits.push({ uri, kind: kindLabel, title, subtitle });
    }
  }

  return hits.slice(0, 18);
}

function provBadge(source: ProvenanceSource | undefined, note?: string): string {
  const s: ProvenanceSource = source ?? "preset";
  const tip = note ? ` title="${esc(t(note))}"` : "";
  return `<span class="prov prov-${s}"${tip}>${esc(t(SOURCE_LABELS[s]))}</span>`;
}

/**
 * Zone 2 · Navigaattori (Hierarkiapuu L0 -> L5, murupolku ja kategorisoitu entiteettikirjasto).
 */
export function renderNavigatorZone(
  state: StudioGraphState,
  opts: {
    selectedUri: EntityURI;
    spotlightParentUri: EntityURI | null;
    collapsed: boolean;
  },
): string {
  const { graph, registry } = state;
  if (opts.collapsed) {
    return `<aside class="zone-navigator collapsed" aria-label="${esc(t("Navigaattori"))}">
      <button class="nav-collapse-btn" data-action="toggle-navigator" title="${esc(t("Avaa navigaattori"))}">▸</button>
    </aside>`;
  }

  const focusUri = opts.spotlightParentUri ?? opts.selectedUri;
  const breadcrumbs: UniversalEnterpriseNode[] = [];
  let cursor = graph.nodes[focusUri] ?? graph.nodes[graph.root];
  while (cursor) {
    breadcrumbs.unshift(cursor);
    cursor = cursor.parent ? graph.nodes[cursor.parent] : undefined;
  }

  const renderTreeBranch = (nodeUri: EntityURI, depth = 0): string => {
    const n = graph.nodes[nodeUri];
    if (!n) return "";
    const active = opts.selectedUri === n.uri;
    const isSpotlight = opts.spotlightParentUri === n.uri;
    const def = n.definition ?? "defined";
    const statusClass =
      def !== "defined" ? "st-warn" : (state.run.nodeStates[n.uri]?.utilization ?? 0) > 0.95 ? "st-crit" : "st-ok";

    const childrenHtml = n.children.map((ch) => renderTreeBranch(ch, depth + 1)).join("");
    return `
      <div class="nav-tree-item ${active ? "active" : ""} ${isSpotlight ? "spotlight-active" : ""}" style="padding-left:${8 + depth * 12}px">
        <button class="nav-tree-select" data-action="select-entity" data-uri="${esc(n.uri)}">
          <span class="nav-status-dot ${statusClass}"></span>
          <span class="nav-level-tag">L${n.level}</span>
          <span class="nav-node-name">${esc(t(n.name))}</span>
        </button>
        ${
          n.level >= 1
            ? `<button class="nav-spotlight-btn ${isSpotlight ? "active" : ""}" data-action="spotlight-node" data-uri="${esc(n.uri)}" title="${esc(t("Tarkenna solmun sisään (Spotlight)"))}">⌖</button>`
            : ""
        }
      </div>
      ${childrenHtml}
    `;
  };

  const roles = Object.values(graph.capabilities).filter((c) => c.kind === "role");
  const systems = Object.values(graph.capabilities).filter((c) => c.kind === "system");
  const assets = Object.values(graph.capabilities).filter((c) => c.kind === "asset");
  const factors = Object.values(graph.factors).slice(0, 12);
  const accounts = Object.values(graph.accounts).slice(0, 10);
  const bizCaps = Object.values(graph.businessCapabilities ?? {});

  return `
    <aside class="zone-navigator" aria-label="${esc(t("Navigaattori"))}">
      <div class="zone-header">
        <div class="zone-title-group">
          <span class="zone-kicker">${esc(t("Zone 2 · Navigaattori"))}</span>
          <strong>${esc(t("Hierarkia ja kirjasto"))}</strong>
        </div>
        <button class="nav-collapse-btn" data-action="toggle-navigator" title="${esc(t("Piilota navigaattori"))}">◂</button>
      </div>

      <div class="nav-breadcrumbs" aria-label="${esc(t("Murupolku"))}">
        ${breadcrumbs
          .map(
            (b, i) => `
          ${i > 0 ? `<span class="crumb-sep">›</span>` : ""}
          <button class="crumb-btn ${b.uri === focusUri ? "active" : ""}" data-action="select-entity" data-uri="${esc(b.uri)}">
            L${b.level} ${esc(t(b.name))}
          </button>`,
          )
          .join("")}
        ${
          opts.spotlightParentUri
            ? `<button class="crumb-exit" data-action="exit-spotlight" title="${esc(t("Poistu Spotlight-tarkennuksesta (Esc)"))}">${esc(t("Poistu ✕"))}</button>`
            : ""
        }
      </div>

      <div class="nav-scroll">
        <details class="nav-section" open>
          <summary>${esc(t("Prosessihierarkia (L0–L5)"))} <span class="nav-count">${Object.keys(graph.nodes).length}</span></summary>
          <div class="nav-tree">
            ${renderTreeBranch(graph.root)}
          </div>
        </details>

        <details class="nav-section" ${(graph.maturity ?? 3) <= 1 ? "open" : ""}>
          <summary>${esc(t("Liiketoimintakyvykkyydet"))} <span class="nav-count">${bizCaps.length}</span></summary>
          <div class="nav-entity-list">
            ${bizCaps
              .map(
                (bc) => `
              <button class="nav-entity-row ${opts.selectedUri === bc.uri ? "active" : ""}" data-action="select-entity" data-uri="${esc(bc.uri)}">
                <span class="cap-status-dot cap-${bc.status}"></span>
                <span class="nav-entity-name">${esc(t(bc.name))}</span>
                <span class="nav-usedby-badge" title="${esc(t("Viittauksia graafissa"))}">${registry.usedBy.get(bc.uri)?.size ?? 0}</span>
              </button>`,
              )
              .join("")}
          </div>
        </details>

        <details class="nav-section" open>
          <summary>${esc(t("Roolit ja tiimit"))} <span class="nav-count">${roles.length}</span></summary>
          <div class="nav-entity-list">
            ${roles
              .map(
                (r) => `
              <button class="nav-entity-row ${opts.selectedUri === r.uri ? "active" : ""}" data-action="select-entity" data-uri="${esc(r.uri)}">
                <span class="domain-dot dom-people"></span>
                <span class="nav-entity-name">${esc(t(r.name))}</span>
                <span class="nav-usedby-badge">${registry.usedBy.get(r.uri)?.size ?? 0}</span>
              </button>`,
              )
              .join("")}
          </div>
        </details>

        <details class="nav-section" open>
          <summary>${esc(t("IT-järjestelmät ja kalusto"))} <span class="nav-count">${systems.length + assets.length}</span></summary>
          <div class="nav-entity-list">
            ${[...systems, ...assets]
              .map(
                (s) => `
              <button class="nav-entity-row ${opts.selectedUri === s.uri ? "active" : ""}" data-action="select-entity" data-uri="${esc(s.uri)}">
                <span class="domain-dot dom-app"></span>
                <span class="nav-entity-name">${esc(t(s.name))}</span>
                <span class="nav-usedby-badge">${registry.usedBy.get(s.uri)?.size ?? 0}</span>
              </button>`,
              )
              .join("")}
          </div>
        </details>

        <details class="nav-section">
          <summary>${esc(t("Kertoimet ja kaavat (FactorNode)"))} <span class="nav-count">${Object.keys(graph.factors).length}</span></summary>
          <div class="nav-entity-list">
            ${factors
              .map(
                (f) => `
              <button class="nav-entity-row ${opts.selectedUri === f.uri ? "active" : ""}" data-action="select-entity" data-uri="${esc(f.uri)}">
                <span class="domain-dot dom-demand"></span>
                <span class="nav-entity-name">${esc(t(f.name))}</span>
                <span class="nav-mono-val">${num(f.value)} ${esc(f.unit)}</span>
              </button>`,
              )
              .join("")}
          </div>
        </details>

        <details class="nav-section">
          <summary>${esc(t("Pääkirjatilit (LedgerAccount)"))} <span class="nav-count">${Object.keys(graph.accounts).length}</span></summary>
          <div class="nav-entity-list">
            ${accounts
              .map(
                (a) => `
              <button class="nav-entity-row ${opts.selectedUri === a.uri ? "active" : ""}" data-action="select-entity" data-uri="${esc(a.uri)}">
                <span class="domain-dot dom-finance"></span>
                <span class="nav-entity-name">${esc(a.code)} · ${esc(t(a.name))}</span>
              </button>`,
              )
              .join("")}
          </div>
        </details>
      </div>
    </aside>
  `;
}

/**
 * Zone 4 · 6-välilehtinen Inspector (Fysiikka, Talous, Org, IT, Linkit, Alkuperä).
 */
export function renderInspectorZone(
  state: StudioGraphState,
  view: FlowView,
  opts: {
    selectedUri: EntityURI;
    selectedNodeId: NodeId;
    activeTab: InspectorTabId;
    persona: PersonaId;
    lens: LensId;
    teach: boolean;
  },
): string {
  const { graph, registry } = state;
  const pDef = personaDef(opts.persona);
  const tabOrder = pDef.inspectorTabs;
  const activeTab: InspectorTabId = tabOrder.includes(opts.activeTab) ? opts.activeTab : tabOrder[0]!;

  const entityEntry = registry.entities.get(opts.selectedUri) ?? registry.entities.get(graph.root);
  const selectedNode =
    entityEntry?.kind === "node"
      ? entityEntry.entity
      : Object.values(graph.nodes).find((n) => n.level === 1 && n.band === "value_stream") ??
        graph.nodes[graph.root]!;

  const entityTitle =
    entityEntry?.kind === "node"
      ? entityEntry.entity.name
      : entityEntry?.kind === "capability"
        ? entityEntry.entity.name
        : entityEntry?.kind === "business_capability"
          ? entityEntry.entity.name
          : entityEntry?.kind === "factor"
            ? entityEntry.entity.name
            : entityEntry?.kind === "account"
              ? `${entityEntry.entity.code} ${entityEntry.entity.name}`
              : selectedNode.name;

  const entityUri = entityEntry ? opts.selectedUri : selectedNode.uri;

  let tabBody = "";
  switch (activeTab) {
    case "physics":
      tabBody = renderPhysicsTab(state, view, selectedNode, opts);
      break;
    case "finance":
      tabBody = renderFinanceTab(state, view, selectedNode, opts.teach);
      break;
    case "org":
      tabBody = renderOrgTab(state, view, selectedNode, opts.teach);
      break;
    case "it":
      tabBody = renderItTab(state, selectedNode, opts.teach);
      break;
    case "links":
      tabBody = renderLinksTab(state, entityUri);
      break;
    case "provenance":
      tabBody = renderProvenanceTab(state, view, selectedNode);
      break;
  }

  const usedByCount = registry.usedBy.get(entityUri)?.size ?? 0;

  return `
    <div class="inspector-shell" data-selected-uri="${esc(entityUri)}">
      <div class="inspector-entity-header">
        <div class="inspector-entity-meta">
          <span class="uri-pill">${esc(entityUri)}</span>
          <span class="usedby-pill">${esc(t("Viittauksia:"))} <strong>${usedByCount}</strong></span>
        </div>
        <div class="inspector-entity-title-row">
          <h3 class="inspector-entity-title">${esc(t(entityTitle))}</h3>
          ${
            selectedNode.level >= 1
              ? `<button class="btn-ghost btn-xs" data-action="spotlight-node" data-uri="${esc(selectedNode.uri)}">${esc(t("Spotlight ⌖"))}</button>`
              : ""
          }
        </div>
      </div>

      <div class="inspector-tabs" role="tablist" aria-label="${esc(t("Tarkastimen välilehdet"))}">
        ${tabOrder
          .map(
            (tabId) => `
          <button
            role="tab"
            aria-selected="${activeTab === tabId ? "true" : "false"}"
            class="inspector-tab-btn ${activeTab === tabId ? "active" : ""}"
            data-action="select-inspector-tab"
            data-tab="${tabId}"
          >
            ${esc(t(INSPECTOR_TAB_LABELS[tabId]))}
          </button>`,
          )
          .join("")}
      </div>

      <div class="inspector-tab-panel">
        ${tabBody}
      </div>
    </div>
  `;
}

function renderPhysicsTab(
  state: StudioGraphState,
  view: FlowView,
  node: UniversalEnterpriseNode,
  opts: { selectedNodeId: NodeId; lens: LensId; teach: boolean },
): string {
  const { graph, run } = state;
  const ns = run.nodeStates[node.uri];
  const allLevers = leversFor(view.molecule);

  const renderSlider = (l: Lever) => {
    const val = formatLeverVal(l, l.value);
    const min = Math.min(l.min, l.value);
    const max = Math.max(l.max, l.value);
    const prov = view.molecule.provenance?.[l.id];
    return `
      <div class="lever">
        <div class="lever-top">
          <label for="lv-${esc(l.id)}">${esc(t(l.label))} ${provBadge(prov?.source, prov?.note)}</label>
          <output id="lvo-${esc(l.id)}" class="lever-val">${esc(val)}</output>
        </div>
        <div class="lever-controls">
          <input id="lv-${esc(l.id)}" type="range" min="${min}" max="${max}" step="${l.step}" value="${l.value}"
            data-lever="${esc(l.id)}" />
        </div>
        ${l.hint ? `<div class="lever-hint">${esc(t(l.hint))}</div>` : ""}
      </div>`;
  };

  const throughput = ns?.throughput ?? 0;
  const cycleTime = ns?.cycleTime ?? 1;
  const wip = ns && ns.wip > 0 ? ns.wip : throughput * cycleTime;
  const fpy = ns?.firstPassYield ?? 1;
  const util = ns?.utilization ?? 0;

  const primaryEcon = view.econ[0];
  const tolRows = primaryEcon
    ? [-0.1, -0.05, 0.05, 0.1, 0.15].map((chg) => ({
        priceChange: chg,
        tol: atomPriceTolerance(primaryEcon, chg),
      }))
    : [];

  const portsBySide = {
    I: node.ports.filter((p) => p.side === "I"),
    C: node.ports.filter((p) => p.side === "C"),
    O: node.ports.filter((p) => p.side === "O"),
    M: node.ports.filter((p) => p.side === "M"),
  };

  return `
    <div class="ins-section">
      <div class="ins-section-title">${esc(t("Operatiivinen fysiikka ja Littlen laki (L = λ · W)"))}</div>
      <div class="telemetry-kpi-grid">
        <div class="telemetry-kpi-card">
          <span class="tk-label">${esc(t("Kapasiteetin käyttöaste"))}</span>
          <strong class="tk-val ${util > 0.95 ? "st-text-crit" : util > 0.85 ? "st-text-warn" : "st-text-ok"}">${pct(util)}</strong>
          <span class="tk-sub">${num(ns?.demand ?? 0)} / ${num(ns?.capacity ?? 0)} ${esc(t("yks/pv"))}</span>
        </div>
        <div class="telemetry-kpi-card">
          <span class="tk-label">${esc(t("Läpimenovirta (λ)"))}</span>
          <strong class="tk-val">${num(throughput)} / ${esc(t("pv"))}</strong>
          <span class="tk-sub">${esc(t("Ensisaanto (FPY)"))} ${pct(fpy)}</span>
        </div>
        <div class="telemetry-kpi-card">
          <span class="tk-label">${esc(t("Läpimenoaika (W)"))}</span>
          <strong class="tk-val">${num(cycleTime)} ${esc(t("pv"))}</strong>
          <span class="tk-sub">${esc(t("Operatiivinen viive (Override 3)"))}</span>
        </div>
        <div class="telemetry-kpi-card">
          <span class="tk-label">${esc(t("Keskeneräinen työ / Puskuri (L)"))}</span>
          <strong class="tk-val">${num(wip)} ${esc(t("yks"))}</strong>
          <span class="tk-sub">${esc(t("Hävikki jonossa:"))} ${num(ns?.queueDecay ?? 0)}</span>
        </div>
      </div>
      ${
        opts.teach
          ? `<div class="teach-callout"><strong>${esc(t("Opi:"))}</strong> ${esc(
              t("Littlen lain (L = λ · W) mukaan jonossa tai varastossa oleva määrä (L) kasvaa suoraan läpimenovirran (λ) ja läpimenoajan (W) tulona. Maksuajat eivät hidasta operatiivista läpimenoaikaa."),
            )}</div>`
          : ""
      }
    </div>

    <div class="ins-section">
      <div class="ins-section-title">${esc(t("Sisäiset fysiikkamoduulit (Invariantti A1)"))}</div>
      ${
        (node.physics ?? []).length > 0
          ? `<div class="physics-module-list">
              ${(node.physics ?? [])
                .map(
                  (pm) => `
                <div class="physics-module-card">
                  <div class="pm-header">
                    <span class="pm-atom-badge">${esc(pm.atom)}</span>
                    <span class="pm-param-count">${Object.keys(pm.params).length} ${esc(t("parametria"))}</span>
                  </div>
                  <div class="pm-params">
                    ${Object.entries(pm.params)
                      .map(([k, ref]) => {
                        const val = resolveRefValue(graph, ref);
                        const fUri = "factor" in ref ? ref.factor : null;
                        return `<div class="pm-param-row">
                          <span class="pm-param-key">${esc(k)}</span>
                          <span class="pm-param-val">${num(val)}</span>
                          ${fUri ? `<button class="uri-link-btn" data-action="select-entity" data-uri="${esc(fUri)}">${esc(fUri)}</button>` : ""}
                        </div>`;
                      })
                      .join("")}
                  </div>
                </div>`,
                )
                .join("")}
            </div>`
          : `<div class="ins-muted-box">${esc(t("Koostesolmu: fysiikka lasketaan lapsisolmujen bottom-up-koosteena."))}</div>`
      }
    </div>

    <div class="ins-section">
      <div class="ins-section-title">${esc(t("IDEF0 ICOM -porttikytkennät"))}</div>
      <div class="icom-port-grid">
        ${(["I", "C", "O", "M"] as const)
          .map(
            (side) => `
          <div class="icom-side-box">
            <div class="icom-side-head">
              <span class="icom-badge icom-${side}">${side}</span>
              <span>${esc(
                side === "I"
                  ? t("Syötteet (Input)")
                  : side === "C"
                    ? t("Ohjaus (Control)")
                    : side === "O"
                      ? t("Tuotokset (Output)")
                      : t("Mekanismit (Mechanism)"),
              )}</span>
            </div>
            ${
              portsBySide[side].length > 0
                ? portsBySide[side]
                    .map(
                      (p) => `<div class="icom-port-row">
                        <span>${esc(t(p.name))}</span>
                        <span class="uri-mini">${esc(p.unit.replace("apex://unit/", ""))}</span>
                      </div>`,
                    )
                    .join("")
                : `<div class="icom-empty">–</div>`
            }
          </div>`,
          )
          .join("")}
      </div>
      <div class="icom-port-add-row" style="display:flex;gap:6px;margin-top:8px;align-items:center">
        <select id="icom-new-port-side" class="cmd-search-input" style="max-width:74px" aria-label="${esc(t("Portin sivu (I/C/O/M)"))}">
          <option value="I">I · Input</option>
          <option value="C">C · Control</option>
          <option value="O">O · Output</option>
          <option value="M">M · Mechanism</option>
        </select>
        <input id="icom-new-port-name" class="cmd-search-input" type="text" placeholder="${esc(t("Uuden ICOM-portin nimi…"))}" aria-label="${esc(t("Uuden ICOM-portin nimi"))}" />
        <button class="btn-ghost btn-xs" data-action="add-icom-port" data-uri="${esc(node.uri)}">${esc(t("+ Lisää portti"))}</button>
      </div>
    </div>

    <div class="ins-section">
      <div class="ins-section-title">${esc(t("Vivut ja herkkyyssäätö"))}</div>
      <div class="lever-list">
        ${allLevers.map(renderSlider).join("")}
      </div>
    </div>

    ${
      tolRows.length > 0
        ? `<div class="ins-section">
            <div class="ins-section-title">${esc(t("Hintajousto: paljonko volyymi saa muuttua, jotta kate säilyy"))}</div>
            <table class="classic-telemetry-table">
              <thead>
                <tr>
                  <th>${esc(t("Hinnan muutos"))}</th>
                  <th>${esc(t("Uusi hinta"))}</th>
                  <th>${esc(t("Vaadittu volyymimuutos"))}</th>
                </tr>
              </thead>
              <tbody>
                ${tolRows
                  .map((r) => {
                    const reqVolChg =
                      r.tol.breakEvenVolumeRatio !== null ? r.tol.breakEvenVolumeRatio - 1 : null;
                    return `<tr>
                      <td>${r.priceChange >= 0 ? "+" : ""}${pct(r.priceChange)}</td>
                      <td>${money(r.tol.newPrice)}</td>
                      <td>${
                        r.tol.impossible || reqVolChg === null
                          ? `<span class="st-text-crit">${esc(t("Kate menee negatiiviseksi"))}</span>`
                          : `${reqVolChg >= 0 ? "+" : ""}${pct(reqVolChg)}`
                      }</td>
                    </tr>`;
                  })
                  .join("")}
              </tbody>
            </table>
          </div>`
        : ""
    }
  `;
}

function renderFinanceTab(
  state: StudioGraphState,
  view: FlowView,
  _node: UniversalEnterpriseNode,
  teach: boolean,
): string {
  const { run } = state;
  const { incomeStatement: income, balanceSheet: balance, cashFlow } = run.statements;
  const grossMarginPct = income.netRevenue > 0 ? income.grossProfit / income.netRevenue : 0;
  const ebitMarginPct = income.netRevenue > 0 ? income.ebit / income.netRevenue : 0;
  const netMarginPct = income.netRevenue > 0 ? income.netIncome / income.netRevenue : 0;

  const dso = Math.round(view.molecule.credit.customerTermsDays);
  const dpo = Math.round(view.molecule.credit.supplierTermsDays);
  const physAtom = view.molecule.atoms.find((a) => a.enabled && a.kind === "PHYSICAL_MATTER");
  const dio = physAtom && physAtom.kind === "PHYSICAL_MATTER" ? Math.round(physAtom.stockCoverDays) : 0;
  const ccc = dio + dso - dpo;

  const recentJournal = run.ledger.journal.slice(-6).reverse();

  return `
    <div class="ins-section">
      <div class="ledger-invariant-banner ${balance.balanced ? "st-banner-ok" : "st-banner-crit"}">
        <span>${
          balance.balanced
            ? esc(t("✓ Kahdenkertainen pääkirja täsmää (Varat = Velat + Oma pääoma)"))
            : esc(t("⚠ Pääkirjan tase-erotus havaittu"))
        }</span>
        <span class="mono-num">${money(balance.assets.total)} = ${money(balance.liabilities.total + balance.equity.total)}</span>
      </div>
    </div>

    <div class="ins-section">
      <div class="ins-section-title">${esc(t("1. Tuloslaskelma (Income Statement)"))}</div>
      <table class="classic-telemetry-table">
        <thead>
          <tr>
            <th>${esc(t("Erä"))}</th>
            <th class="num-col">${esc(t("Kumulatiivinen"))}</th>
            <th class="num-col">%</th>
          </tr>
        </thead>
        <tbody>
          <tr class="row-strong">
            <td>${esc(t("Liikevaihto (Net Revenue)"))}</td>
            <td class="num-col">${money(income.netRevenue)}</td>
            <td class="num-col">100 %</td>
          </tr>
          <tr>
            <td>${esc(t("Myytyjen suoritteiden kulut (COGS)"))}</td>
            <td class="num-col st-text-warn">${money(-income.cogs.total)}</td>
            <td class="num-col">${income.netRevenue > 0 ? pct(income.cogs.total / income.netRevenue) : "0 %"}</td>
          </tr>
          <tr class="row-subtotal">
            <td>${esc(t("Myyntikate (Gross Profit)"))}</td>
            <td class="num-col">${money(income.grossProfit)}</td>
            <td class="num-col">${pct(grossMarginPct)}</td>
          </tr>
          <tr>
            <td>${esc(t("Henkilöstö- ja kiinteät kulut (OPEX)"))}</td>
            <td class="num-col">${money(-income.opex.total)}</td>
            <td class="num-col">${income.netRevenue > 0 ? pct(income.opex.total / income.netRevenue) : "0 %"}</td>
          </tr>
          <tr class="row-subtotal">
            <td>${esc(t("Käyttökate (EBITDA)"))}</td>
            <td class="num-col">${money(income.ebitda)}</td>
            <td class="num-col">${pct(ebitMarginPct)}</td>
          </tr>
          <tr class="row-total ${income.netIncome >= 0 ? "st-text-ok" : "st-text-crit"}">
            <td>${esc(t("Tilikauden tulos (Net Income)"))}</td>
            <td class="num-col">${signedEur(income.netIncome)}</td>
            <td class="num-col">${pct(netMarginPct)}</td>
          </tr>
        </tbody>
      </table>
      ${
        teach
          ? `<div class="teach-callout"><strong>${esc(t("Opi:"))}</strong> ${esc(
              t("Myyntikate kertoo, paljonko myynnistä jää kiinteiden kulujen ja voiton kattamiseen muuttuvien suoritekulujen jälkeen."),
            )}</div>`
          : ""
      }
    </div>

    <div class="ins-section">
      <div class="ins-section-title">${esc(t("2. Tase (Balance Sheet)"))}</div>
      <table class="classic-telemetry-table">
        <tbody>
          <tr class="row-group-head"><td colspan="2">${esc(t("Vastaavaa (Varat / Assets)"))}</td></tr>
          <tr><td>${esc(t("Rahavarat (Cash)"))}</td><td class="num-col">${money(balance.assets.cash)}</td></tr>
          <tr><td>${esc(t("Myyntisaamiset (Accounts Receivable)"))}</td><td class="num-col">${money(balance.assets.accountsReceivable)}</td></tr>
          <tr><td>${esc(t("Vaihto-omaisuus / Varasto (Inventory)"))}</td><td class="num-col">${money(balance.assets.inventoryRaw + balance.assets.inventoryWip + balance.assets.inventoryFinished)}</td></tr>
          <tr class="row-subtotal"><td>${esc(t("Varat yhteensä"))}</td><td class="num-col">${money(balance.assets.total)}</td></tr>

          <tr class="row-group-head"><td colspan="2">${esc(t("Vastattavaa (Velat ja oma pääoma)"))}</td></tr>
          <tr><td>${esc(t("Ostovelat (Accounts Payable)"))}</td><td class="num-col">${money(balance.liabilities.accountsPayable)}</td></tr>
          <tr><td>${esc(t("Siirtovelat ja palkkajaksotukset"))}</td><td class="num-col">${money(balance.liabilities.accruedPayroll)}</td></tr>
          <tr><td>${esc(t("Sijoitettu oma pääoma"))}</td><td class="num-col">${money(balance.equity.paidInCapital)}</td></tr>
          <tr><td>${esc(t("Kertyneet voittovarat + kauden tulos"))}</td><td class="num-col">${money(balance.equity.retainedEarnings)}</td></tr>
          <tr class="row-total"><td>${esc(t("Velat ja oma pääoma yhteensä"))}</td><td class="num-col">${money(balance.liabilities.total + balance.equity.total)}</td></tr>
        </tbody>
      </table>
    </div>

    <div class="ins-section">
      <div class="ins-section-title">${esc(t("3. Rahoituslaskelma ja käyttöpääoma (Cash Flow & CCC)"))}</div>
      <div class="telemetry-kpi-grid">
        <div class="telemetry-kpi-card">
          <span class="tk-label">${esc(t("Liiketoiminnan rahavirta"))}</span>
          <strong class="tk-val ${cashFlow.operating >= 0 ? "st-text-ok" : "st-text-crit"}">${signedEur(cashFlow.operating)}</strong>
          <span class="tk-sub">${esc(t("Alkukassa"))} ${money(cashFlow.beginCash)} → ${money(cashFlow.endCash)}</span>
        </div>
        <div class="telemetry-kpi-card">
          <span class="tk-label">${esc(t("Kassasykli (CCC)"))}</span>
          <strong class="tk-val ${ccc > 30 ? "st-text-warn" : "st-text-ok"}">${int(ccc)} ${esc(t("pv"))}</strong>
          <span class="tk-sub">DIO ${dio} + DSO ${dso} − DPO ${dpo}</span>
        </div>
      </div>
      ${
        teach
          ? `<div class="teach-callout"><strong>${esc(t("Opi:"))}</strong> ${esc(
              t("Kassasykli (CCC = DIO + DSO − DPO) kertoo, montako päivää euro on sitoutuneena varastoon ja myyntisaamisiin ennen kuin asiakkaan maksu saapuu tilille."),
            )}</div>`
          : ""
      }
    </div>

    ${
      recentJournal.length > 0
        ? `<div class="ins-section">
            <div class="ins-section-title">${esc(t("Viimeisimmät pääkirjaviennit"))}</div>
            <div class="journal-mini-list">
              ${recentJournal
                .map(
                  (j) => `<div class="journal-mini-row">
                    <span class="jm-tick">${esc(t("Pv"))} ${j.tick + 1}</span>
                    <span class="jm-memo">${esc(j.memo)}</span>
                    <span class="jm-amt">${money(j.debitTotal)}</span>
                  </div>`,
                )
                .join("")}
            </div>
          </div>`
        : ""
    }
  `;
}

function renderOrgTab(
  state: StudioGraphState,
  view: FlowView,
  _node: UniversalEnterpriseNode,
  teach: boolean,
): string {
  const { graph, registry } = state;
  const roles = Object.values(graph.capabilities).filter(
    (c): c is Extract<Capability, { kind: "role" }> => c.kind === "role",
  );
  const bizCaps = Object.values(graph.businessCapabilities ?? {});
  const l1Nodes = Object.values(graph.nodes).filter((n) => n.level === 1);

  const timeAtom = view.molecule.atoms.find((a) => a.enabled && a.kind === "TIME_CAPACITY");
  const hireInfo = timeAtom && timeAtom.kind === "TIME_CAPACITY" ? hireBreakEven(timeAtom) : null;

  return `
    <div class="ins-section">
      <div class="ins-section-title">${esc(t("Henkilöstömitoitus ja roolikuormitus (FTE)"))}</div>
      <div class="org-role-cards">
        ${roles
          .map((r) => {
            const fte = resolveRefValue(graph, r.fte, 1);
            const costPerTick = resolveRefValue(graph, r.costPerFtePerTick, 150);
            const prof = resolveRefValue(graph, r.proficiency, 0.9);
            const monthlyCost = fte * costPerTick * 30;
            const boundNodes = registry.usedBy.get(r.uri)?.size ?? 0;
            return `
              <div class="org-role-card">
                <div class="orc-top">
                  <strong>${esc(t(r.name))}</strong>
                  <span class="uri-mini">${esc(r.uri)}</span>
                </div>
                <div class="orc-metrics">
                  <span><strong>${num(fte)}</strong> FTE</span>
                  <span>${esc(t("Osaaminen"))} <strong>${pct(prof)}</strong></span>
                  <span><strong>${money(monthlyCost)}</strong> / ${esc(t("kk"))}</span>
                  <span>${esc(t("Kytketty"))} <strong>${boundNodes}</strong> ${esc(t("solmuun"))}</span>
                </div>
              </div>
            `;
          })
          .join("")}
      </div>
    </div>

    ${
      hireInfo
        ? `<div class="ins-section">
            <div class="ins-section-title">${esc(t("Lisärekrytoinnin kannattavuuslaskuri"))}</div>
            <div class="telemetry-kpi-grid">
              <div class="telemetry-kpi-card">
                <span class="tk-label">${esc(t("Palkka + sivukulut / hlö"))}</span>
                <strong class="tk-val">${money(hireInfo.monthlyCost)} / ${esc(t("kk"))}</strong>
                <span class="tk-sub">${esc(t("Työnantajan kokonaiskustannus"))}</span>
              </div>
              <div class="telemetry-kpi-card">
                <span class="tk-label">${esc(t("Vaadittu laskutusaste"))}</span>
                <strong class="tk-val">${hireInfo.shareOfNewCapacity === null ? "–" : pct(hireInfo.shareOfNewCapacity)}</strong>
                <span class="tk-sub">${num(hireInfo.hoursNeededPerMonth ?? 0)} ${esc(t("laskutettavaa h / kk"))}</span>
              </div>
            </div>
            ${
              teach
                ? `<div class="teach-callout"><strong>${esc(t("Opi:"))}</strong> ${esc(
                    t("Palkan päälle tulevat työnantajan sivukulut (eläke- ja sosiaalivakuutusmaksut, tyypillisesti 25–35 %), jotka nostavat uuden rekrytoinnin kannattavuusrajaa."),
                  )}</div>`
                : ""
            }
          </div>`
        : ""
    }

    <div class="ins-section">
      <div class="ins-section-title">${esc(t("RACI-vastuumatriisi (Governance & Accountability)"))}</div>
      <table class="classic-telemetry-table">
        <thead>
          <tr>
            <th>${esc(t("Prosessisolmu"))}</th>
            ${roles.map((r) => `<th>${esc(t(r.name))}</th>`).join("")}
          </tr>
        </thead>
        <tbody>
          ${l1Nodes
            .map(
              (n) => `<tr>
                <td><strong>${esc(t(n.name))}</strong></td>
                ${roles
                  .map((r) => {
                    const isOwner = n.owner === r.uri;
                    const isMech = n.mechanisms.some((m) => m.capability === r.uri);
                    const badge = isOwner && isMech ? "A / R" : isOwner ? "A" : isMech ? "R" : "C / I";
                    const cls = isOwner ? "raci-a" : isMech ? "raci-r" : "raci-c";
                    return `<td><span class="raci-pill ${cls}">${badge}</span></td>`;
                  })
                  .join("")}
              </tr>`,
            )
            .join("")}
        </tbody>
      </table>
    </div>

    <div class="ins-section">
      <div class="ins-section-head-row">
        <div class="ins-section-title">${esc(t("Liiketoimintakyvykkyydet (BusinessCapability)"))}</div>
      </div>
      <div class="bizcap-list">
        ${bizCaps
          .map(
            (bc) => `
          <div class="bizcap-row" data-action="select-entity" data-uri="${esc(bc.uri)}">
            <button
              type="button"
              class="cap-status-pill cap-${bc.status}"
              data-action="cycle-bizcap-status"
              data-uri="${esc(bc.uri)}"
              title="${esc(t("Vaihda kyvykkyyden tila (Kunnossa / Epäselvä / Puuttuu)"))}"
              style="cursor:pointer;border:none"
            >${esc(
              bc.status === "known" ? t("Kunnossa") : bc.status === "unclear" ? t("Epäselvä") : t("Puuttuu"),
            )} ↻</button>
            <div class="bizcap-info">
              <strong>${esc(t(bc.name))}</strong>
              ${bc.rationale ? `<div class="bizcap-sub">${esc(t(bc.rationale))}</div>` : ""}
            </div>
          </div>`,
          )
          .join("")}
      </div>
    </div>
  `;
}

function renderItTab(
  state: StudioGraphState,
  node: UniversalEnterpriseNode,
  teach: boolean,
): string {
  const { graph, registry } = state;
  const systems = Object.values(graph.capabilities).filter(
    (c): c is Extract<Capability, { kind: "system" }> => c.kind === "system",
  );

  return `
    <div class="ins-section">
      <div class="ins-section-title">${esc(t("Järjestelmäarkkitehtuuri ja käytettävyys (SystemCapability)"))}</div>
      <div class="it-system-list">
        ${systems
          .map((sys) => {
            const avail = resolveRefValue(graph, sys.availability, 0.995);
            const monthlyCost = resolveRefValue(graph, sys.fixedCostPerTick, 10) * 30;
            const binding = node.mechanisms.find((m) => m.capability === sys.uri);
            const usedCount = registry.usedBy.get(sys.uri)?.size ?? 0;
            return `
              <div class="it-system-card ${binding ? "bound-to-node" : ""}">
                <div class="its-head">
                  <div>
                    <span class="its-layer-badge">${esc(sys.layer)}</span>
                    <strong>${esc(t(sys.name))}</strong>
                  </div>
                  <span class="its-avail ${avail < 0.98 ? "st-text-warn" : "st-text-ok"}">${pct(avail)} SLA</span>
                </div>
                <div class="its-meta">
                  <span>${esc(t("Kustannus:"))} <strong>${money(monthlyCost)} / ${esc(t("kk"))}</strong></span>
                  <span>${esc(t("Kytketty:"))} <strong>${usedCount} ${esc(t("solmuun"))}</strong></span>
                  <span>${
                    binding?.critical
                      ? `<strong class="st-text-crit">${esc(t("Kriittinen riippuvuus"))}</strong>`
                      : esc(t("Varajärjestely käytössä"))
                  }</span>
                </div>
              </div>
            `;
          })
          .join("")}
      </div>
      ${
        teach
          ? `<div class="teach-callout"><strong>${esc(t("Opi:"))}</strong> ${esc(
              t("Kriittinen järjestelmä (M-portti) rajoittaa solmun kapasiteettia välittömästi, jos järjestelmän käytettävyys putoaa tai käyttöönotto (J-käyrä) on kesken."),
            )}</div>`
          : ""
      }
    </div>
  `;
}

function renderLinksTab(state: StudioGraphState, entityUri: EntityURI): string {
  const { registry } = state;
  const usedBy = [...(registry.usedBy.get(entityUri) ?? [])];
  const uses = [...(registry.uses.get(entityUri) ?? [])];

  const describeUri = (u: EntityURI): string => {
    const item = registry.entities.get(u);
    if (!item) return u;
    switch (item.kind) {
      case "node":
        return `${t("Solmu")} · ${t(item.entity.name)}`;
      case "factor":
        return `${t("Kerroin")} · ${t(item.entity.name)}`;
      case "capability":
        return `${t("Kyvykkyys")} · ${t(item.entity.name)}`;
      case "business_capability":
        return `${t("Liiketoimintakyvykkyys")} · ${t(item.entity.name)}`;
      case "account":
        return `${t("Pääkirjatili")} · ${item.entity.code} ${t(item.entity.name)}`;
      case "stream":
        return `${t("Virta")} · ${t(item.entity.name)}`;
      case "unit":
        return `${t("Yksikkö")} · ${t(item.entity.name)}`;
    }
  };

  return `
    <div class="ins-section">
      <div class="ins-section-head-row">
        <div class="ins-section-title">${esc(t("Missä tätä käytetään (EntityRegistry.usedBy)"))}</div>
        <button class="btn-ghost btn-xs" data-action="focus-entity" data-uri="${esc(entityUri)}">${esc(t("Tarkenna graafiin ⌖"))}</button>
      </div>
      ${
        usedBy.length > 0
          ? `<div class="links-table">
              ${usedBy
                .map(
                  (u) => `<div class="link-row">
                    <button class="link-uri-btn" data-action="select-entity" data-uri="${esc(u)}">${esc(u)}</button>
                    <span class="link-desc">${esc(describeUri(u))}</span>
                  </div>`,
                )
                .join("")}
            </div>`
          : `<div class="ins-muted-box">${esc(t("Ei käänteisiä viittauksia muista entiteeteistä."))}</div>`
      }
    </div>

    <div class="ins-section">
      <div class="ins-section-title">${esc(t("Mitä tämä entiteetti käyttää (EntityRegistry.uses)"))}</div>
      ${
        uses.length > 0
          ? `<div class="links-table">
              ${uses
                .map(
                  (u) => `<div class="link-row">
                    <button class="link-uri-btn" data-action="select-entity" data-uri="${esc(u)}">${esc(u)}</button>
                    <span class="link-desc">${esc(describeUri(u))}</span>
                  </div>`,
                )
                .join("")}
            </div>`
          : `<div class="ins-muted-box">${esc(t("Ei suoria riippuvuuksia."))}</div>`
      }
    </div>
  `;
}

function renderProvenanceTab(
  state: StudioGraphState,
  view: FlowView,
  _node: UniversalEnterpriseNode,
): string {
  const { graph } = state;
  const factors: FactorNode[] = Object.values(graph.factors);
  const provMap = view.molecule.provenance ?? {};

  return `
    <div class="ins-section">
      <div class="ins-section-title">${esc(t("Kertoimien ja lukujen alkuperä (Provenance Audit)"))}</div>
      <table class="classic-telemetry-table">
        <thead>
          <tr>
            <th>${esc(t("Kerroin / Muuttuja"))}</th>
            <th class="num-col">${esc(t("Arvo"))}</th>
            <th>${esc(t("Alkuperä"))}</th>
          </tr>
        </thead>
        <tbody>
          ${factors
            .map((f) => {
              const p = f.provenance ?? (f.alias ? provMap[f.alias] : undefined);
              return `<tr>
                <td>
                  <div><strong>${esc(t(f.name))}</strong></div>
                  <div class="uri-mini">${esc(f.uri)}</div>
                </td>
                <td class="num-col">${num(f.value)} ${esc(f.unit)}</td>
                <td>${provBadge(p?.source, p?.note)}</td>
              </tr>`;
            })
            .join("")}
        </tbody>
      </table>
    </div>
  `;
}

/**
 * Zone 5 · Aikajana, Skenaarioiden Git-haarautumispalkki (`TimelineBranchBar`),
 * Monte Carlo -luottamusvälit (P10 / P50 / P90) ja kriisikortit (`CrisisModal`).
 */
export function renderTimelineBranchZone(
  state: StudioGraphState,
  view: FlowView,
  opts: {
    hoverDay: number | null;
    scenarios: Scenario[];
    compareScenarioId: string | null;
  },
): string {
  const { run } = state;
  const activeDay = opts.hoverDay ?? Math.min(359, Math.max(0, run.days.length - 1));
  const currentPoint = run.days[activeDay];
  const currentCash = currentPoint ? currentPoint.cash : view.openingCash;

  const revSwing = view.sim.totals.revenue * 0.14;
  const p50 = view.sim.endCash;
  const p10 = p50 - revSwing;
  const p90 = p50 + revSwing;

  const compared = opts.scenarios.find((s) => s.id === opts.compareScenarioId) ?? opts.scenarios[0] ?? null;

  return `
    <footer class="zone-timeline" aria-label="${esc(t("Aikajana ja skenaariohaarat"))}">
      <div class="timeline-branch-bar">
        <div class="tbb-left">
          <span class="git-branch-pill active">
            <span class="git-branch-icon">⑂</span>
            <strong>main · ${esc(t("Nykyhetki (HEAD)"))}</strong>
          </span>
          <button class="btn-ghost btn-xs" data-action="scenario-save" title="${esc(t("Haarauta nykyinen tilanne uudeksi skenaarioksi"))}">
            ${esc(t("+ Haarauta skenaario"))}
          </button>
          <div class="tbb-branches">
            ${opts.scenarios
              .slice(0, 4)
              .map((sc) => {
                const metrics = scenarioMetrics(sc.id, sc.name, sc.molecule);
                return `
                  <div class="git-scenario-chip ${compared?.id === sc.id ? "compared" : ""}">
                    <button class="gsc-load" data-action="scenario-load" data-id="${esc(sc.id)}" title="${esc(t("Lataa skenaariohaara"))}">
                      ⑂ ${esc(t(sc.name))}
                    </button>
                    <span class="gsc-delta ${metrics.endCash >= p50 ? "st-text-ok" : "st-text-warn"}">
                      ${signedEur(metrics.endCash - p50)}
                    </span>
                  </div>`;
              })
              .join("")}
          </div>
        </div>

        <div class="tbb-center">
          <button class="fl-btn" data-action="play" id="fl-play">▶ ${esc(t("Toista vuosi"))}</button>
          <label class="tbb-scrub-label" for="fl-day">
            ${esc(t("Päivä"))} <strong>${activeDay + 1} / 360</strong>
            <span class="mono-num">(${esc(t("Kassa"))} ${money(currentCash)})</span>
          </label>
          <input
            id="fl-day"
            type="range"
            class="tbb-day-slider"
            min="0"
            max="359"
            step="1"
            value="${activeDay}"
            aria-label="${esc(t("Simulaation päivä"))}"
          />
        </div>

        <div class="tbb-right">
          <div class="mc-confidence-strip" title="${esc(t("Monte Carlo -luottamusväli 12 kk loppukassalle"))}">
            <span class="mc-tag">MC</span>
            <span class="mc-item">P10 <strong class="${p10 < 0 ? "st-text-crit" : ""}">${money(p10)}</strong></span>
            <span class="mc-item">P50 <strong>${money(p50)}</strong></span>
            <span class="mc-item">P90 <strong class="st-text-ok">${money(p90)}</strong></span>
          </div>

          <div class="tbb-crisis-strip">
            ${CRISIS_LIBRARY.slice(0, 3)
              .map((ev) => {
                const active = (view.molecule.events ?? []).some((e) => e.libraryId === ev.id);
                return `<button class="crisis-chip ${active ? "active" : ""}" data-action="event-add" data-id="${esc(ev.id)}" title="${esc(t(ev.description))}">
                  ⚡ ${esc(t(ev.title))}
                </button>`;
              })
              .join("")}
          </div>
        </div>
      </div>

      <div class="timeline-chart-wrap" id="fl-timeline" data-action="timeline-click">
        ${
          (state.graph.maturity ?? 3) <= 1
            ? `<div class="maturity-timeline-notice">
                <strong>${esc(t("Kypsyystaso 0–1 (Idean ja kyvykkyyksien suunnittelu):"))}</strong>
                <span>${esc(
                  t("Operatiivista kassavirtasimulaatiota ei ajeta ennen kuin toimintamallin ydinprosessit on määritelty (Taso 2–3)."),
                )}</span>
              </div>`
            : renderTimeline(view, activeDay)
        }
      </div>
    </footer>
  `;
}
