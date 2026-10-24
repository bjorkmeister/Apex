/**
 * APEX Studio v3.2 — Unified Enterprise Flow & ICOM Canvas (`src/flow/client/canvas.ts`).
 *
 * Implements TSD v3.2 Sections 2.3, 2.4, 3.5, 4.4 and Invariant A3:
 * - Live particle flow canvas + liquid cash tank (`FlowCanvas`).
 * - Semantic Zoom (`< 25%` -> L0, `25-60%` -> L1, `> 60%` -> L2+ / Spotlight).
 * - Spotlight Viewport Isolation (`computeSpotlightView`): shows selected parent and at most 7 children
 *   (grouping >7 into `"+N muuta"`), dims surrounding nodes (`opacity: 0.15`, `pointer-events: none`),
 *   and never renders internal children of sibling departments to the DOM.
 * - Natural Capability Zoom (`shouldShowMechanismPills`): M-port mechanism pills are hidden on L0-L1
 *   and revealed only on L2-L4 or when the `it` / `org` X-Ray lens is active.
 * - Stream Bundling (`computeBundledStreams`): leaf streams between two visible nodes bundle into a
 *   composite stream weighted by the active X-Ray lens (`ops`, `financial`, `it`, `org`).
 * - Maturity 0-1 `BusinessCapability` Map (`renderCapabilityMapSvg`).
 */
import type { FlowView, NodeId, NodeStatus } from "../model/view.ts";
import type { XRayLensId } from "../model/personas.ts";
import type {
  BusinessCapability,
  Capability,
  EnterpriseGraph,
  EntityURI,
  UniversalEnterpriseNode,
} from "../graph/types.ts";
import type { SimulationRun } from "../graph/simulate.ts";
import { esc, int, money, monthName, num, pct } from "../model/format.ts";
import { t } from "../i18n/index.ts";

const SVG_NS = "http://www.w3.org/2000/svg";

interface Particle {
  lane: "demand" | "invoice" | "drain" | "lost";
  t: number;
  speed: number;
}

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

const BOXES: Record<Exclude<NodeId, "cash">, Box> = {
  demand: { x: 20, y: 120, w: 190, h: 110 },
  capacity: { x: 270, y: 120, w: 190, h: 110 },
  receivables: { x: 478, y: 14, w: 196, h: 90 },
  costs: { x: 840, y: 268, w: 150, h: 84 },
};
const TANK: Box = { x: 690, y: 50, w: 130, h: 260 };
const PIPE_Y = 175;

const STATUS_COLORS: Record<NodeStatus, string> = {
  ok: "#10b981",
  warn: "#f59e0b",
  alert: "#ef4444",
  idle: "#64748b",
};

/**
 * Semanttisen zoomin tasokynnys (TSD 3.5):
 * - `< 25 %` -> L0 (koko yritys / alipuun juuri yhtenä laatikkona)
 * - `25–60 %` -> L1 (arvovirta- ja tukikaistat, max 8 arvovirtalaatikkoa ja 6 tukilaatikkoa)
 * - `> 60 %` -> L2+ (avaa kohdesolmun ja näyttää kaikki mittarit + M-porttien pillerit)
 */
export function zoomLevelForPercent(zoomPct: number): 0 | 1 | 2 {
  if (zoomPct < 25) return 0;
  if (zoomPct <= 60) return 1;
  return 2;
}

/**
 * Invariantti A3 (Natural Capability Zoom):
 * M-porttien mekanismipillerit (roolit/FTE, IT-järjestelmät, kalusto) EIVÄT renderöidy
 * tasoilla L0–L1 oletuslinsseissä, vaan ne paljastuvat alareunasta vasta tasoilla L2–L4
 * TAI kun `IT & Data`- tai `Org & Accountability` -röntgenlinssi on aktiivinen.
 */
export function shouldShowMechanismPills(nodeLevel: number, xrayLens: XRayLensId): boolean {
  if (xrayLens === "it" || xrayLens === "org") return true;
  return nodeLevel >= 2;
}

export interface SpotlightChildItem {
  uri: EntityURI;
  name: string;
  level: number;
  capacity: number;
  throughput: number;
  utilization: number;
  isOverflowGroup?: boolean;
  overflowCount?: number;
  groupedUris?: EntityURI[];
}

export interface SpotlightBoundaryNode {
  uri: EntityURI;
  name: string;
  level: number;
  opacity: number;
  pointerEvents: "none" | "auto";
}

export interface SpotlightViewResult {
  active: boolean;
  parentUri: EntityURI | null;
  parentName: string;
  /** Näkyvät 3–7 lapsisolmua (kapasiteetin mukaan järjestettynä; >7 ryhmitelty "+N muuta" -solmuksi). */
  visibleChildren: SpotlightChildItem[];
  /** Himmennetyt ympäröivät rinnakkaissolmut (opacity: 0.15, pointer-events: none). */
  dimmedBoundaryNodes: SpotlightBoundaryNode[];
  /** Kaikki DOM:iin renderöitävät solmu-URI:t (muiden osastojen sisäiset lapsisolmut on rajattu pois). */
  renderedDomNodeUris: Set<EntityURI>;
}

/**
 * Invariantti A3 (Spotlight Viewport Isolation):
 * Kun solmu avataan Spotlightiin:
 * - Vain valittu solmu ja sen 3–7 alisolmua (kapasiteetin mukaan järjestettynä; jos >7, loput
 *   ryhmitellään "+N muuta" -solmuksi) pysyvät kirkkaina.
 * - Ympäröivät rinnakkaissolmut himmennetään (`opacity: 0.15`, `pointer-events: none`).
 * - Muiden osastojen sisäisiä lapsisolmuja EI lisätä `renderedDomNodeUris`-joukkoon eikä renderöidä DOM:iin.
 */
export function computeSpotlightView(
  graph: EnterpriseGraph,
  run: SimulationRun,
  spotlightParentUri: EntityURI | null,
): SpotlightViewResult {
  if (!spotlightParentUri || !graph.nodes[spotlightParentUri]) {
    const l1Nodes = Object.values(graph.nodes).filter((n) => n.level === 1);
    const rendered = new Set<EntityURI>([graph.root, ...l1Nodes.map((n) => n.uri)]);
    return {
      active: false,
      parentUri: null,
      parentName: graph.name,
      visibleChildren: [],
      dimmedBoundaryNodes: [],
      renderedDomNodeUris: rendered,
    };
  }

  const parent = graph.nodes[spotlightParentUri]!;
  const rawChildren = parent.children
    .map((u) => graph.nodes[u])
    .filter((n): n is UniversalEnterpriseNode => Boolean(n));

  const sorted = [...rawChildren].sort((a, b) => {
    const capA = run.nodeStates[a.uri]?.capacity ?? 0;
    const capB = run.nodeStates[b.uri]?.capacity ?? 0;
    return capB - capA;
  });

  const visibleChildren: SpotlightChildItem[] = [];
  const renderedDomNodeUris = new Set<EntityURI>([parent.uri]);

  if (sorted.length <= 7) {
    for (const ch of sorted) {
      const st = run.nodeStates[ch.uri];
      visibleChildren.push({
        uri: ch.uri,
        name: ch.name,
        level: ch.level,
        capacity: st?.capacity ?? 0,
        throughput: st?.throughput ?? 0,
        utilization: st?.utilization ?? 0,
      });
      renderedDomNodeUris.add(ch.uri);
    }
  } else {
    const head = sorted.slice(0, 6);
    const tail = sorted.slice(6);
    for (const ch of head) {
      const st = run.nodeStates[ch.uri];
      visibleChildren.push({
        uri: ch.uri,
        name: ch.name,
        level: ch.level,
        capacity: st?.capacity ?? 0,
        throughput: st?.throughput ?? 0,
        utilization: st?.utilization ?? 0,
      });
      renderedDomNodeUris.add(ch.uri);
    }
    const overflowCap = tail.reduce((s, c) => s + (run.nodeStates[c.uri]?.capacity ?? 0), 0);
    const overflowTp = tail.reduce((s, c) => s + (run.nodeStates[c.uri]?.throughput ?? 0), 0);
    const overflowUtil = overflowCap > 0 ? overflowTp / overflowCap : 0;
    const overflowUri = `${parent.uri}_overflow` as EntityURI;
    visibleChildren.push({
      uri: overflowUri,
      name: t("+{n} muuta", { n: int(tail.length) }),
      level: parent.level + 1,
      capacity: overflowCap,
      throughput: overflowTp,
      utilization: overflowUtil,
      isOverflowGroup: true,
      overflowCount: tail.length,
      groupedUris: tail.map((c) => c.uri),
    });
    renderedDomNodeUris.add(overflowUri);
  }

  // Ympäröivät samantasoiset solmut himmennetään rajapinnoiksi; niiden sisäisiä lapsia EI oteta mukaan!
  const siblings = Object.values(graph.nodes).filter(
    (n) => n.parent === parent.parent && n.uri !== parent.uri,
  );
  const dimmedBoundaryNodes: SpotlightBoundaryNode[] = siblings.map((sib) => {
    renderedDomNodeUris.add(sib.uri);
    return {
      uri: sib.uri,
      name: sib.name,
      level: sib.level,
      opacity: 0.15,
      pointerEvents: "none",
    };
  });

  return {
    active: true,
    parentUri: parent.uri,
    parentName: parent.name,
    visibleChildren,
    dimmedBoundaryNodes,
    renderedDomNodeUris,
  };
}

export interface BundledStream {
  from: EntityURI;
  to: EntityURI;
  leafStreamUris: EntityURI[];
  totalFlow: number;
  strokeWidth: number;
  label: string;
}

/**
 * Virtojen niputus (Stream Bundling, TSD 3.5):
 * Niputtaa kahden näkyvän solmun (tai niiden jälkeläisten) väliset lehtivirrat yhdeksi
 * koostevirraksi, jonka paksuus määräytyy aktiivisen röntgenlinssin mukaan.
 */
export function computeBundledStreams(
  graph: EnterpriseGraph,
  run: SimulationRun,
  visibleNodeUris: Set<EntityURI>,
  xrayLens: XRayLensId,
): BundledStream[] {
  const findVisibleAncestor = (uri: EntityURI): EntityURI | null => {
    let cur: UniversalEnterpriseNode | undefined = graph.nodes[uri];
    while (cur) {
      if (visibleNodeUris.has(cur.uri)) return cur.uri;
      cur = cur.parent ? graph.nodes[cur.parent] : undefined;
    }
    return null;
  };

  const bundles = new Map<string, { from: EntityURI; to: EntityURI; streams: EntityURI[]; flow: number }>();

  for (const s of Object.values(graph.streams)) {
    if (s.children.length > 0) continue;
    const fromVis = findVisibleAncestor(s.from.node);
    const toVis = findVisibleAncestor(s.to.node);
    if (!fromVis || !toVis || fromVis === toVis) continue;

    const st = run.streamStates[s.uri];
    const baseDelivered = st?.delivered ?? 1;
    const weight =
      xrayLens === "financial"
        ? baseDelivered * 25 + (st?.transferCost ?? 0)
        : xrayLens === "it"
          ? 10
          : baseDelivered;

    const key = `${fromVis}->${toVis}`;
    const existing = bundles.get(key);
    if (existing) {
      existing.streams.push(s.uri);
      existing.flow += weight;
    } else {
      bundles.set(key, { from: fromVis, to: toVis, streams: [s.uri], flow: weight });
    }
  }

  return [...bundles.values()].map((b) => ({
    from: b.from,
    to: b.to,
    leafStreamUris: b.streams,
    totalFlow: b.flow,
    strokeWidth: Math.min(12, Math.max(2, 2 + Math.log10(Math.max(1, b.flow)) * 2.5)),
    label:
      b.streams.length > 1
        ? t("{n} virtaa niputettu", { n: int(b.streams.length) })
        : t("1 virta"),
  }));
}

/**
 * Renderöi kypsyystasojen 0–1 (Idea / Konsepti) `BusinessCapability`-kyvykkyyskartan (TSD 2.3 & 4.4).
 * Korvaa monimutkaisen prosessiketjun selkeällä kyvykkyys-, riippuvuus- ja puutekartalla.
 */
export function renderCapabilityMapSvg(
  graph: EnterpriseGraph,
  selectedUri?: EntityURI,
): string {
  const bcs: BusinessCapability[] = Object.values(graph.businessCapabilities ?? {});
  const statusBadge = (status: BusinessCapability["status"]) => {
    if (status === "known") return { cls: "cap-card-known", label: t("Kunnossa"), color: "#10b981" };
    if (status === "unclear") return { cls: "cap-card-unclear", label: t("Epäselvä"), color: "#f59e0b" };
    return { cls: "cap-card-missing", label: t("Puuttuu"), color: "#ef4444" };
  };

  return `
    <div class="capability-map-stage" data-maturity="${graph.maturity ?? 0}">
      <div class="cap-map-header">
        <div>
          <span class="zone-kicker">${esc(t("Kypsyystaso 0–1 · Liiketoimintakyvykkyyksien suunnittelu"))}</span>
          <h4>${esc(t("Kyvykkyyskartta ja puuteanalyysi (BusinessCapability Map)"))}</h4>
        </div>
        <div class="cap-map-legend">
          <span class="cml-item"><i class="cap-dot-known"></i> ${esc(t("Kunnossa"))}</span>
          <span class="cml-item"><i class="cap-dot-unclear"></i> ${esc(t("Epäselvä"))}</span>
          <span class="cml-item"><i class="cap-dot-missing"></i> ${esc(t("Puuttuu (vaatii ratkaisun)"))}</span>
          <span class="cap-inline-add">
            <input id="cap-new-name" class="cmd-search-input" type="text" placeholder="${esc(t("Uusi liiketoimintakyvykkyys…"))}" aria-label="${esc(t("Uusi liiketoimintakyvykkyys"))}" />
            <button class="btn-ghost btn-xs" data-action="add-bizcap">${esc(t("+ Lisää kyvykkyys"))}</button>
          </span>
        </div>
      </div>

      <div class="capability-card-grid">
        ${bcs
          .map((bc) => {
            const st = statusBadge(bc.status);
            const active = selectedUri === bc.uri;
            return `
              <div
                class="capability-map-card ${st.cls} ${active ? "selected" : ""}"
                data-action="select-entity"
                data-uri="${esc(bc.uri)}"
                style="border-color:${st.color}"
              >
                <div class="cmc-top">
                  <span class="cmc-ref">${esc(bc.canonicalRef ?? "CAP")}</span>
                  <button
                    type="button"
                    class="cmc-status-pill"
                    data-action="cycle-bizcap-status"
                    data-uri="${esc(bc.uri)}"
                    title="${esc(t("Vaihda kyvykkyyden tila (Kunnossa / Epäselvä / Puuttuu)"))}"
                    style="color:${st.color};background:transparent;border:1px solid ${st.color};border-radius:999px;padding:1px 8px;cursor:pointer"
                  >${esc(st.label)} ↻</button>
                </div>
                <strong class="cmc-title">${esc(t(bc.name))}</strong>
                ${bc.rationale ? `<p class="cmc-rationale">${esc(t(bc.rationale))}</p>` : ""}
                <div class="cmc-notes">
                  ${bc.notes
                    .map((n) => {
                      const icon =
                        n.kind === "cost"
                          ? "€"
                          : n.kind === "risk"
                            ? "⚠"
                            : n.kind === "obligation"
                              ? "§"
                              : "?";
                      return `<div class="cmc-note cmc-note-${n.kind}">
                        <span class="cmc-note-icon">${icon}</span>
                        <span>${esc(t(n.text))}</span>
                      </div>`;
                    })
                    .join("")}
                </div>
                ${
                  bc.dependsOn.length > 0
                    ? `<div class="cmc-deps">${esc(t("Riippuu:"))} ${bc.dependsOn
                        .map((d) => esc(t(graph.businessCapabilities?.[d]?.name ?? d)))
                        .join(", ")}</div>`
                    : ""
                }
              </div>
            `;
          })
          .join("")}
      </div>
    </div>
  `;
}

/**
 * Renderöi Zone 3:n ICOM-prosessisolmukaistan, X-Ray-linssinäkymän, Spotlight-eristyksen
 * ja Natural Capability Zoomin M-porttipillerit (TSD 2.4 & 3.5).
 */
export function renderIcomProcessOverlayHtml(
  graph: EnterpriseGraph,
  run: SimulationRun,
  opts: {
    zoomPct: number;
    xrayLens: XRayLensId;
    selectedUri: EntityURI;
    spotlightParentUri: EntityURI | null;
  },
): string {
  const maturity = graph.maturity ?? 3;
  if (maturity <= 1) {
    return renderCapabilityMapSvg(graph, opts.selectedUri);
  }

  const semanticLevel = zoomLevelForPercent(opts.zoomPct);
  const spotlight = computeSpotlightView(graph, run, opts.spotlightParentUri);
  const activeNodeLevel = spotlight.active ? 2 : semanticLevel;
  const showMechPills = shouldShowMechanismPills(activeNodeLevel, opts.xrayLens);

  // Tiheyssääntö (TSD 2.4): L1-päänäkymä näyttää enintään 8 arvovirtalaatikkoa ja 6 tukilaatikkoa;
  // L0–L1 näyttää enintään 3 mittaria per solmu, L2+ näyttää kaikki.
  const valueStreamNodes = Object.values(graph.nodes)
    .filter((n) => n.level === 1 && n.band === "value_stream")
    .slice(0, 8);
  const supportNodes = Object.values(graph.nodes)
    .filter((n) => n.level === 1 && n.band !== "value_stream")
    .slice(0, 6);

  const renderMechPills = (node: UniversalEnterpriseNode): string => {
    if (!showMechPills || node.mechanisms.length === 0) return "";
    return `
      <div class="icom-mech-strip" data-mech-strip="${esc(node.uri)}">
        ${node.mechanisms
          .map((mb) => {
            const cap: Capability | undefined = graph.capabilities[mb.capability];
            if (!cap) return "";
            const cls =
              cap.kind === "role"
                ? "mech-pill-people"
                : cap.kind === "system"
                  ? "mech-pill-app"
                  : "mech-pill-asset";
            return `<span class="icom-mech-pill ${cls}" data-action="select-entity" data-uri="${esc(cap.uri)}">
              M · ${esc(t(cap.name))}
            </span>`;
          })
          .join("")}
      </div>
    `;
  };

  const renderNodeCard = (node: UniversalEnterpriseNode, isDimmed = false): string => {
    const st = run.nodeStates[node.uri];
    const util = st?.utilization ?? 0;
    const isBottleneck = run.bottleneckNodeUri === node.uri;
    const statusCls =
      isBottleneck || util > 0.95 ? "icom-crit" : util > 0.8 ? "icom-warn" : "icom-ok";

    // L0–L1: max 3 mittaria per solmu; L2+ tai röntgenlinssi: kaikki mittarit
    const metrics: { label: string; val: string }[] = [];
    if (opts.xrayLens === "financial") {
      const margin = (st?.revenue ?? 0) - (st?.variableCost ?? 0) - (st?.fixedCost ?? 0);
      metrics.push(
        { label: t("Tuotto/pv"), val: money(st?.revenue ?? 0) },
        { label: t("Kulut/pv"), val: money((st?.variableCost ?? 0) + (st?.fixedCost ?? 0)) },
        { label: t("Kate/pv"), val: money(margin) },
      );
    } else if (opts.xrayLens === "it") {
      const sysCount = node.mechanisms.filter((m) => graph.capabilities[m.capability]?.kind === "system").length;
      metrics.push(
        { label: t("IT-kytkennät"), val: `${sysCount} kpl` },
        { label: t("Käyttöaste"), val: pct(util) },
        { label: t("Ensisaanto"), val: pct(st?.firstPassYield ?? 1) },
      );
    } else if (opts.xrayLens === "org") {
      const ownerName = node.owner ? graph.capabilities[node.owner]?.name ?? node.owner : t("Ei vastuuhenkilöä");
      metrics.push(
        { label: t("Vastuu (A)"), val: t(ownerName) },
        { label: t("Kuormitus"), val: pct(util) },
        { label: t("Roolit"), val: `${node.mechanisms.length}` },
      );
    } else {
      metrics.push(
        { label: t("Käyttöaste"), val: pct(util) },
        { label: t("Virta (λ)"), val: `${num(st?.throughput ?? 0)}/pv` },
        { label: t("Viive (W)"), val: `${num(st?.cycleTime ?? 1)} pv` },
      );
      if (activeNodeLevel >= 2) {
        metrics.push(
          { label: t("Jono (L)"), val: num(st?.wip ?? 0) },
          { label: t("Saanto"), val: pct(st?.firstPassYield ?? 1) },
        );
      }
    }

    const visibleMetrics = activeNodeLevel <= 1 ? metrics.slice(0, 3) : metrics;
    const styleAttr = isDimmed ? `style="opacity:0.15;pointer-events:none"` : "";

    return `
      <div
        class="icom-node-card ${statusCls} ${opts.selectedUri === node.uri ? "selected" : ""} ${isDimmed ? "spotlight-dimmed" : ""}"
        data-node-uri="${esc(node.uri)}"
        data-node-level="${node.level}"
        ${styleAttr}
      >
        <div class="icom-port-rail icom-rail-top" title="${esc(t("C · Ohjausportit (Control)"))}">
          <span class="icom-dot icom-dot-c">C</span>
        </div>
        <div class="icom-card-body" data-action="select-entity" data-uri="${esc(node.uri)}">
          <div class="icom-port-rail icom-rail-left" title="${esc(t("I · Syöteportit (Input)"))}">
            <span class="icom-dot icom-dot-i">I</span>
          </div>
          <div class="icom-card-main">
            <div class="icom-card-head">
              <span class="icom-level-badge">L${node.level}</span>
              <strong class="icom-card-title">${esc(t(node.name))}</strong>
              <button
                class="icom-zoom-in-btn"
                data-action="spotlight-node"
                data-uri="${esc(node.uri)}"
                title="${esc(t("Avaa solmu Spotlight-näkymään (L2)"))}">
                ⌖
              </button>
            </div>
            <div class="icom-metrics-row">
              ${visibleMetrics
                .map(
                  (m) => `<div class="icom-metric-cell">
                    <span class="im-lbl">${esc(m.label)}</span>
                    <strong class="im-val">${esc(m.val)}</strong>
                  </div>`,
                )
                .join("")}
            </div>
          </div>
          <div class="icom-port-rail icom-rail-right" title="${esc(t("O · Tuotosportit (Output)"))}">
            <span class="icom-dot icom-dot-o">O</span>
          </div>
        </div>
        ${renderMechPills(node)}
      </div>
    `;
  };

  if ( semanticLevel === 0 && !spotlight.active ) {
    const rootNode = graph.nodes[graph.root]!;
    return `
      <div class="icom-architecture-deck" data-semantic-level="0" data-xray-lens="${opts.xrayLens}">
        <div class="icom-band-label">${esc(t("Semanttinen zoom L0 (< 25 %) · Koko yritys yhtenä mustana laatikkona"))}</div>
        <div class="icom-node-strip">
          ${renderNodeCard(rootNode, false)}
        </div>
      </div>
    `;
  }

  if (spotlight.active && spotlight.parentUri) {
    const parentNode = graph.nodes[spotlight.parentUri]!;
    const bundled = computeBundledStreams(graph, run, spotlight.renderedDomNodeUris, opts.xrayLens);

    return `
      <div class="icom-architecture-deck spotlight-mode" data-semantic-level="2" data-xray-lens="${opts.xrayLens}" data-spotlight-parent="${esc(parentNode.uri)}">
        <div class="spotlight-banner">
          <div>
            <span class="zone-kicker">${esc(t("Spotlight-eristys (Invariantti A3 · L2–L5)"))}</span>
            <strong>${esc(t(parentNode.name))}</strong>
            <span class="spotlight-sub">${esc(t("Näytetään {n} alisolmua · muut osastot himmennetty rajapinnoiksi", { n: int(spotlight.visibleChildren.length) }))}</span>
          </div>
          <button class="btn-ghost btn-xs" data-action="exit-spotlight">${esc(t("Poistu Spotlightista (Esc)"))}</button>
        </div>

        <div class="spotlight-children-grid">
          ${spotlight.visibleChildren
            .map((ch) => {
              if (ch.isOverflowGroup) {
                return `
                  <div class="icom-node-card icom-overflow-card" data-node-uri="${esc(ch.uri)}" data-overflow-group="true">
                    <div class="icom-card-head">
                      <span class="icom-level-badge">L${ch.level}</span>
                      <strong class="icom-card-title">${esc(ch.name)}</strong>
                    </div>
                    <div class="icom-metrics-row">
                      <div class="icom-metric-cell">
                        <span class="im-lbl">${esc(t("Yhteenlaskettu kap."))}</span>
                        <strong class="im-val">${num(ch.capacity)}/pv</strong>
                      </div>
                      <div class="icom-metric-cell">
                        <span class="im-lbl">${esc(t("Yhteenlaskettu virta"))}</span>
                        <strong class="im-val">${num(ch.throughput)}/pv</strong>
                      </div>
                    </div>
                  </div>
                `;
              }
              const childNode = graph.nodes[ch.uri];
              return childNode ? renderNodeCard(childNode, false) : "";
            })
            .join("")}
        </div>

        ${
          bundled.length > 0
            ? `<div class="bundled-streams-strip">
                ${bundled
                  .map(
                    (b) => `<span class="bundled-stream-pill" style="border-bottom-width:${b.strokeWidth.toFixed(1)}px">
                      ${esc(t(graph.nodes[b.from]?.name ?? b.from))} → ${esc(t(graph.nodes[b.to]?.name ?? b.to))} (${esc(b.label)})
                    </span>`,
                  )
                  .join("")}
              </div>`
            : ""
        }

        ${
          spotlight.dimmedBoundaryNodes.length > 0
            ? `<div class="spotlight-boundary-strip">
                <span class="icom-band-label">${esc(t("Ympäröivät rajapinnat (himmennetty 15 %, sisäiset lapset piilotettu DOM:sta)"))}</span>
                <div class="icom-node-strip">
                  ${spotlight.dimmedBoundaryNodes
                    .map((bn) => {
                      const sib = graph.nodes[bn.uri];
                      return sib ? renderNodeCard(sib, true) : "";
                    })
                    .join("")}
                </div>
              </div>`
            : ""
        }
      </div>
    `;
  }

  return `
    <div class="icom-architecture-deck" data-semantic-level="${semanticLevel}" data-xray-lens="${opts.xrayLens}">
      <div class="icom-band-row">
        <div class="icom-band-head-row" style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap">
          <div class="icom-band-label">${esc(t("Arvovirtakaista (Core Value Stream · L1)"))}</div>
          <div class="icom-canvas-actions" style="display:flex;gap:6px;flex-wrap:wrap">
            <button class="btn-ghost btn-xs" data-action="add-atom" data-kind="TIME_CAPACITY" title="${esc(t("Lisää aikakapasiteetti- ja asiantuntijaprosessisolmu"))}">${esc(t("+ Aikakapasiteetti"))}</button>
            <button class="btn-ghost btn-xs" data-action="add-atom" data-kind="PHYSICAL_MATTER" title="${esc(t("Lisää fyysisen valmistuksen tai varastovirran prosessisolmu"))}">${esc(t("+ Fyysinen virta"))}</button>
            <button class="btn-ghost btn-xs" data-action="add-atom" data-kind="RECURRING_SUB" title="${esc(t("Lisää jatkuvan sopimus- tai tilausvirran prosessisolmu"))}">${esc(t("+ Toistuva sopimus"))}</button>
            <button class="btn-ghost btn-xs" data-action="add-atom" data-kind="TRANSACTIONAL_TRADE" title="${esc(t("Lisää tapahtuma- tai transaktiovirran prosessisolmu"))}">${esc(t("+ Transaktiovirta"))}</button>
          </div>
        </div>
        <div class="icom-node-strip">
          ${
            valueStreamNodes.length > 0
              ? valueStreamNodes.map((n) => renderNodeCard(n, false)).join("")
              : `<div class="ins-muted-box" style="width:100%">${esc(
                  t("Puhdas pöytä (Tabula Rasa): kanvaasilla ei ole vielä arvovirtasolmuja. Lisää ensimmäinen prosessisolmu yllä olevista painikkeista tai vaihda kypsyystasolle 0–1 suunnitellaksesi kyvykkyydet ensin."),
                )}</div>`
          }
        </div>
      </div>
      ${
        supportNodes.length > 0
          ? `<div class="icom-band-row icom-support-band">
              <div class="icom-band-label">${esc(t("Tukitoiminnot ja kiinteä rakenne (Enabling Band · L1)"))}</div>
              <div class="icom-node-strip">
                ${supportNodes.map((n) => renderNodeCard(n, false)).join("")}
              </div>
            </div>`
          : ""
      }
    </div>
  `;
}

function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
}

/** Asettaa tekstin ja lyhentää sen kolmella pisteellä, jos se ei mahdu laatikkoon. */
function fitText(tEl: SVGTextElement, text: string, maxWidth: number): void {
  tEl.textContent = text;
  tEl.removeAttribute("data-full");
  try {
    if (tEl.getComputedTextLength() <= maxWidth) return;
    tEl.setAttribute("data-full", text);
    let s = text;
    while (s.length > 4) {
      s = s.slice(0, -1);
      tEl.textContent = `${s.trimEnd()}…`;
      if (tEl.getComputedTextLength() <= maxWidth) break;
    }
    const title = document.createElementNS(SVG_NS, "title");
    title.textContent = text;
    tEl.appendChild(title);
  } catch {
    // Elementti ei ole vielä renderöity: jätetään teksti ennalleen.
  }
}

export class FlowCanvas {
  private readonly svg: SVGSVGElement;
  private readonly particleLayer: SVGGElement;
  private readonly water: SVGPathElement;
  private readonly tankLabel: SVGTextElement;
  private readonly tankSub: SVGTextElement;
  private readonly tankFrame: SVGRectElement;
  private readonly pipeAmount: SVGTextElement;
  private readonly nodeTexts = new Map<string, { value: SVGTextElement; sub: SVGTextElement; frame: SVGRectElement; maxWidth: number }>();
  private particles: Particle[] = [];
  private view: FlowView | null = null;
  private day = 0;
  private lastTs = 0;
  private wavePhase = 0;
  private spawnAcc = { demand: 0, invoice: 0, drain: 0 };
  private rafId = 0;
  private readonly onSelect: (id: NodeId) => void;

  constructor(host: HTMLElement, onSelect: (id: NodeId) => void) {
    this.onSelect = onSelect;
    this.svg = el("svg", { viewBox: "0 0 1000 370", class: "flow-svg", role: "img", "aria-label": t("Yrityksen rahavirrat") });
    host.innerHTML = "";
    host.appendChild(this.svg);

    const defs = el("defs", {});
    const clip = el("clipPath", { id: "tank-clip" });
    clip.appendChild(el("rect", { x: TANK.x + 4, y: TANK.y + 4, width: TANK.w - 8, height: TANK.h - 8, rx: 14 }));
    defs.appendChild(clip);
    const grad = el("linearGradient", { id: "water-grad", x1: 0, y1: 0, x2: 0, y2: 1 });
    grad.appendChild(el("stop", { offset: "0%", "stop-color": "#38bdf8" }));
    grad.appendChild(el("stop", { offset: "100%", "stop-color": "#0369a1" }));
    defs.appendChild(grad);
    this.svg.appendChild(defs);

    // Putket (taustalle).
    const pipes = el("g", { class: "flow-pipes" });
    pipes.appendChild(el("path", { d: this.lanePath("demand"), class: "flow-pipe" }));
    pipes.appendChild(el("path", { d: this.lanePath("invoice"), class: "flow-pipe flow-pipe-wide", "data-node": "receivables" }));
    pipes.appendChild(el("path", { d: this.lanePath("drain"), class: "flow-pipe" }));
    this.svg.appendChild(pipes);

    // Rahat matkalla -summa putken päällä.
    this.pipeAmount = el("text", { x: 575, y: PIPE_Y + 34, class: "flow-pipe-amount", "text-anchor": "middle" });
    this.svg.appendChild(this.pipeAmount);

    this.particleLayer = el("g", { class: "flow-particles" });
    this.svg.appendChild(this.particleLayer);

    // Solmulaatikot.
    for (const [id, b] of Object.entries(BOXES)) this.addNodeBox(id as NodeId, b);

    // Kassasäiliö.
    const tankGroup = el("g", { class: "flow-node flow-tank", "data-node": "cash", tabindex: 0 });
    this.tankFrame = el("rect", { x: TANK.x, y: TANK.y, width: TANK.w, height: TANK.h, rx: 18, class: "flow-tank-frame" });
    tankGroup.appendChild(this.tankFrame);
    this.water = el("path", { d: "", fill: "url(#water-grad)", "clip-path": "url(#tank-clip)", class: "flow-water" });
    tankGroup.appendChild(this.water);
    tankGroup.appendChild(el("text", { x: TANK.x + TANK.w / 2, y: TANK.y - 14, class: "flow-node-title", "text-anchor": "middle" })).textContent = t("Kassa");
    this.tankLabel = el("text", { x: TANK.x + TANK.w / 2, y: TANK.y + 40, class: "flow-tank-value", "text-anchor": "middle" });
    this.tankSub = el("text", { x: TANK.x + TANK.w / 2, y: TANK.y + 60, class: "flow-node-sub", "text-anchor": "middle" });
    tankGroup.appendChild(this.tankLabel);
    tankGroup.appendChild(this.tankSub);
    this.svg.appendChild(tankGroup);

    this.svg.addEventListener("click", (ev) => {
      const target = (ev.target as Element).closest("[data-node]");
      const id = target?.getAttribute("data-node") as NodeId | null;
      if (id) this.onSelect(id);
    });
    this.svg.addEventListener("keydown", (ev) => {
      if (ev.key !== "Enter" && ev.key !== " ") return;
      const id = (ev.target as Element).getAttribute?.("data-node") as NodeId | null;
      if (id) {
        ev.preventDefault();
        this.onSelect(id);
      }
    });

    this.rafId = requestAnimationFrame((ts) => this.frame(ts));
  }

  destroy(): void {
    cancelAnimationFrame(this.rafId);
  }

  /** Himmentää solmut, jotka eivät kuulu valittuun näkökulmaan (osa-aluejohtajan rajapinnat). */
  setFocus(nodes: NodeId[]): void {
    this.svg.querySelectorAll<SVGElement>(".flow-node[data-node]").forEach((g) => {
      const id = g.getAttribute("data-node") as NodeId;
      g.classList.toggle("dim", !nodes.includes(id));
    });
  }

  private addNodeBox(id: NodeId, b: Box): void {
    const g = el("g", { class: "flow-node", "data-node": id, tabindex: 0 });
    const frame = el("rect", { x: b.x, y: b.y, width: b.w, height: b.h, rx: 14, class: "flow-node-frame" });
    g.appendChild(frame);
    const title = el("text", { x: b.x + 14, y: b.y + 24, class: "flow-node-title" });
    g.appendChild(title);
    const value = el("text", { x: b.x + 14, y: b.y + 52, class: "flow-node-value" });
    g.appendChild(value);
    const sub = el("text", { x: b.x + 14, y: b.y + 74, class: "flow-node-sub" });
    g.appendChild(sub);
    if (b.h > 90) {
      const hint = el("text", { x: b.x + b.w - 14, y: b.y + b.h - 12, class: "flow-node-hint", "text-anchor": "end" });
      hint.textContent = t("avaa ›");
      g.appendChild(hint);
    }
    title.setAttribute("data-title", id);
    this.svg.appendChild(g);
    this.nodeTexts.set(id, { value, sub, frame, maxWidth: b.w - 28 });
  }

  private lanePath(lane: Particle["lane"]): string {
    const d = BOXES.demand;
    const c = BOXES.capacity;
    const k = BOXES.costs;
    switch (lane) {
      case "demand":
        return `M ${d.x + d.w} ${PIPE_Y} L ${c.x} ${PIPE_Y}`;
      case "invoice":
        return `M ${c.x + c.w} ${PIPE_Y} L ${TANK.x} ${PIPE_Y}`;
      case "drain":
        return `M ${TANK.x + TANK.w / 2} ${TANK.y + TANK.h} L ${TANK.x + TANK.w / 2} ${k.y + k.h / 2} L ${k.x} ${k.y + k.h / 2}`;
      case "lost":
        return `M ${c.x - 10} ${PIPE_Y} Q ${c.x - 40} ${PIPE_Y + 60} ${c.x - 70} ${PIPE_Y + 150}`;
    }
  }

  private pointOn(lane: Particle["lane"], tVal: number): { x: number; y: number } {
    const d = BOXES.demand;
    const c = BOXES.capacity;
    const k = BOXES.costs;
    switch (lane) {
      case "demand":
        return { x: d.x + d.w + (c.x - d.x - d.w) * tVal, y: PIPE_Y };
      case "invoice":
        return { x: c.x + c.w + (TANK.x - c.x - c.w) * tVal, y: PIPE_Y };
      case "drain": {
        const x0 = TANK.x + TANK.w / 2;
        const y0 = TANK.y + TANK.h;
        const y1 = k.y + k.h / 2;
        const seg1 = y1 - y0;
        const seg2 = x0 - k.x;
        const total = Math.abs(seg1) + Math.abs(seg2);
        const dist = tVal * total;
        if (dist <= Math.abs(seg1)) return { x: x0, y: y0 + dist };
        return { x: x0 + (dist - Math.abs(seg1)), y: y1 };
      }
      case "lost": {
        const x0 = c.x - 10;
        const cx = c.x - 40;
        const x1 = c.x - 70;
        const y0 = PIPE_Y;
        const cy = PIPE_Y + 60;
        const y1 = PIPE_Y + 150;
        const u = 1 - tVal;
        return { x: u * u * x0 + 2 * u * tVal * cx + tVal * tVal * x1, y: u * u * y0 + 2 * u * tVal * cy + tVal * tVal * y1 };
      }
    }
  }

  /** Päivittää datan. Animaatio jatkuu katkeamatta. */
  update(view: FlowView): void {
    this.view = view;
    for (const n of view.nodes) {
      if (n.id === "cash") continue;
      const item = this.nodeTexts.get(n.id);
      if (!item) continue;
      const titleEl = this.svg.querySelector(`[data-title="${n.id}"]`);
      if (titleEl) titleEl.textContent = n.title;
      fitText(item.value, n.value, item.maxWidth);
      fitText(item.sub, n.sub, item.maxWidth);
      item.frame.setAttribute("stroke", STATUS_COLORS[n.status]);
      item.frame.setAttribute("data-status", n.status);
    }
    const cashNode = view.nodes.find((n) => n.id === "cash");
    if (cashNode) this.tankFrame.setAttribute("stroke", STATUS_COLORS[cashNode.status]);
    this.setDay(Math.min(this.day, Math.max(0, view.sim.days.length - 1)));
  }

  setDay(day: number): void {
    this.day = day;
    const v = this.view;
    if (!v || v.sim.days.length === 0) {
      this.tankLabel.textContent = "–";
      this.tankSub.textContent = "";
      this.pipeAmount.textContent = "";
      return;
    }
    const p = v.sim.days[Math.min(day, v.sim.days.length - 1)]!;
    this.tankLabel.textContent = money(p.cash);
    this.tankLabel.setAttribute("data-negative", p.cash < 0 ? "1" : "0");
    const mo = v.sim.months[Math.floor(day / 30)];
    this.tankSub.textContent = v.varies && mo ? `${monthName(mo.calendarMonth)} · ${t("pv {d}", { d: (day % 30) + 1 })}` : t("kk {m}, pv {d}", { m: Math.floor(day / 30) + 1, d: (day % 30) + 1 });
    this.pipeAmount.textContent = p.receivables > 0.5 ? t("{amount} matkalla", { amount: money(p.receivables) }) : "";
  }

  private frame(ts: number): void {
    const dt = this.lastTs ? Math.min(0.05, (ts - this.lastTs) / 1000) : 0;
    this.lastTs = ts;
    this.wavePhase += dt * 2.2;
    const v = this.view;
    if (v && !v.isEmpty) this.stepParticles(v, dt);
    this.drawWater();
    this.drawParticles();
    this.rafId = requestAnimationFrame((nextTs) => this.frame(nextTs));
  }

  private stepParticles(v: FlowView, dt: number): void {
    const rate = (eurPerMonth: number) => Math.min(9, Math.max(0, eurPerMonth) / 3300);
    const lostShare = v.bottleneck && v.bottleneck.demand > 0 ? v.bottleneck.lostDemand / v.bottleneck.demand : 0;
    const termsDays = v.econ.reduce((m, e) => Math.max(m, e.paymentTermsDays), 0);
    const invoiceSpeed = 1 / Math.max(0.5, 0.6 + termsDays * 0.07);

    this.spawnAcc.demand += rate(v.monthlyRevenue / Math.max(0.05, 1 - lostShare)) * dt;
    this.spawnAcc.invoice += rate(v.monthlyRevenue) * dt;
    this.spawnAcc.drain += rate(v.monthlyFixed + v.monthlyVariable) * dt;

    while (this.spawnAcc.demand >= 1) {
      this.spawnAcc.demand -= 1;
      this.particles.push({ lane: "demand", t: 0, speed: 0.9 });
    }
    while (this.spawnAcc.invoice >= 1) {
      this.spawnAcc.invoice -= 1;
      this.particles.push({ lane: "invoice", t: 0, speed: invoiceSpeed });
    }
    while (this.spawnAcc.drain >= 1) {
      this.spawnAcc.drain -= 1;
      this.particles.push({ lane: "drain", t: 0, speed: 0.55 });
    }

    const next: Particle[] = [];
    for (const p of this.particles) {
      p.t += p.speed * dt;
      if (p.t < 1) {
        next.push(p);
      } else if (p.lane === "demand" && lostShare > 0 && Math.random() < lostShare) {
        next.push({ lane: "lost", t: 0, speed: 0.8 });
      }
    }
    this.particles = next.slice(-160);
  }

  private drawParticles(): void {
    const layer = this.particleLayer;
    while (layer.childNodes.length < this.particles.length) {
      layer.appendChild(el("circle", { r: 5 }));
    }
    while (layer.childNodes.length > this.particles.length) {
      layer.removeChild(layer.lastChild as ChildNode);
    }
    this.particles.forEach((p, i) => {
      const c = layer.childNodes[i] as SVGCircleElement;
      const pt = this.pointOn(p.lane, p.t);
      c.setAttribute("cx", pt.x.toFixed(1));
      c.setAttribute("cy", pt.y.toFixed(1));
      c.setAttribute("class", `flow-dot flow-dot-${p.lane}`);
      c.setAttribute("r", p.lane === "invoice" ? "6" : "4.5");
      if (p.lane === "lost") c.setAttribute("opacity", (1 - p.t).toFixed(2));
      else c.removeAttribute("opacity");
    });
  }

  private drawWater(): void {
    const v = this.view;
    let level = 0;
    if (v && v.sim.days.length > 0) {
      const maxAbs = Math.max(1, ...v.sim.days.map((d) => Math.abs(d.cash)), Math.abs(v.sim.openingCash));
      const cash = v.sim.days[Math.min(this.day, v.sim.days.length - 1)]!.cash;
      level = Math.max(0, cash) / maxAbs;
    }
    const innerTop = TANK.y + 4;
    const innerH = TANK.h - 8;
    const surface = innerTop + innerH * (1 - Math.min(1, level));
    const amp = level > 0.01 ? 4 : 0;
    const left = TANK.x;
    const right = TANK.x + TANK.w;
    let d = `M ${left} ${TANK.y + TANK.h} L ${left} ${surface.toFixed(1)}`;
    for (let x = left; x <= right; x += 10) {
      const y = surface + Math.sin(this.wavePhase + (x - left) / 18) * amp;
      d += ` L ${x} ${y.toFixed(1)}`;
    }
    d += ` L ${right} ${TANK.y + TANK.h} Z`;
    this.water.setAttribute("d", d);
  }
}

export interface TimelineOverlay {
  name: string;
  color: string;
  cash: number[];
}

/** Kassan aikajana: viiva, nollataso, miinusalue, tapahtumat, skenaariot ja valittu päivä. */
export function renderTimeline(view: FlowView, dayInput: number | null = 0, overlays: TimelineOverlay[] = []): string {
  const days = view.sim.days;
  if (days.length === 0) return "";
  const day = dayInput ?? Math.min(359, Math.max(0, days.length - 1));
  const W = 1000;
  const H = 120;
  const pad = 8;
  const all = [...days.map((d) => d.cash), ...overlays.flatMap((o) => o.cash)];
  const max = Math.max(0, ...all);
  const min = Math.min(0, ...all);
  const span = Math.max(1, max - min);
  const x = (i: number) => pad + (i / (days.length - 1)) * (W - pad * 2);
  const y = (c: number) => pad + ((max - c) / span) * (H - pad * 2);
  const line = (cash: number[]) => cash.map((c, i) => `${x(i).toFixed(1)},${y(c).toFixed(1)}`).join(" ");
  const zeroY = y(0);
  const months = view.sim.months
    .map((mo) => {
      const d = mo.month * 30;
      const label = view.varies ? monthName(mo.calendarMonth) : String(mo.month + 1);
      return `<line x1="${x(d)}" x2="${x(d)}" y1="${pad}" y2="${H - pad}" class="tl-month"/><text x="${x(d) + 4}" y="${H - 2}" class="tl-month-label">${esc(label)}</text>`;
    })
    .join("");
  const events = (view.molecule.events ?? [])
    .map((e) => {
      const x0 = x(Math.min(days.length - 1, e.startMonth * 30));
      const x1 = x(Math.min(days.length - 1, (e.startMonth + e.durationMonths) * 30 - 1));
      return `<rect x="${x0}" y="0" width="${Math.max(2, x1 - x0)}" height="${H}" class="tl-event"><title>${esc(e.title)}</title></rect><text x="${x0 + 3}" y="11" class="tl-event-label">${esc(e.title.slice(0, 26))}</text>`;
    })
    .join("");
  const cashOut =
    view.sim.cashOutDay !== null
      ? `<circle cx="${x(view.sim.cashOutDay)}" cy="${zeroY}" r="6" class="tl-cashout"/><text x="${x(view.sim.cashOutDay) + 9}" y="${zeroY - 8}" class="tl-cashout-label">${esc(t("Kassa loppuu"))}</text>`
      : "";
  const cur = days[Math.min(day, days.length - 1)]!;
  const legend = overlays.length
    ? `<div class="tl-legend"><span><i style="background:#38bdf8"></i>${esc(t("Nykyinen"))}</span>${overlays.map((o) => `<span><i style="background:${o.color}"></i>${esc(o.name)}</span>`).join("")}</div>`
    : "";
  return `<svg viewBox="0 0 ${W} ${H}" class="flow-timeline-svg" preserveAspectRatio="none" aria-label="${esc(t("Kassan kehitys 12 kuukautta"))}">
    <rect x="0" y="${zeroY}" width="${W}" height="${Math.max(0, H - zeroY)}" class="tl-negative"/>
    ${events}
    ${months}
    <line x1="0" x2="${W}" y1="${zeroY}" y2="${zeroY}" class="tl-zero"/>
    ${overlays.map((o) => `<polyline points="${line(o.cash)}" class="tl-overlay" style="stroke:${o.color}"/>`).join("")}
    <polyline points="${line(days.map((d) => d.cash))}" class="tl-line"/>
    ${cashOut}
    <line x1="${x(day)}" x2="${x(day)}" y1="0" y2="${H}" class="tl-cursor"/>
    <circle cx="${x(day)}" cy="${y(cur.cash)}" r="5" class="tl-cursor-dot"/>
  </svg>
  <div class="tl-caption">${esc(t("Päivä {d}: kassa {amount}", { d: day + 1, amount: money(cur.cash) }))}${cur.receivables > 0.5 ? esc(" · " + t("{amount} matkalla", { amount: money(cur.receivables) })) : ""}${legend}</div>`;
}
