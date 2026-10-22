/**
 * Interactive SVG Value Chain & Operations Node Map:
 *  Column 1: Tier-1 Suppliers (lead time, MOQ, reliability, credit hold status)
 *  Column 2: Inbound Freight Lanes & Open PO Pipeline (in-transit / at-dock units)
 *  Column 3: Warehouses & Storage Zones (cubic utilization, pick-pack utilization, on-hand inventory)
 *  Column 4: Production Work Centers & Capabilities (Little's Law L = λW, utilization ρ, condition)
 *  Column 5: Commercial Channels & Pricing Engines (net price, payment terms, fulfillment SLA)
 *  Column 6: Customer Segments & B2B Contracts (market share, awareness, daily demand)
 */
import { type AssumptionKey, markTag } from "../core/compiler/assumptions";
import type { IndustryArchetype, WorldState } from "../core/schema";
import { escapeHtml, fmtCurrency, fmtCurrencyPrecise, fmtNum, fmtPct } from "./formatters";

export type ClarityMode = "simple" | "expert";

export interface SelectedNode {
  kind: "supplier" | "lane" | "warehouse" | "workCenter" | "channel" | "segment";
  id: string;
}

interface PositionedNode {
  kind: SelectedNode["kind"];
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  title: string;
  subtitle: string;
  metricLabel: string;
  metricValue: string;
  utilization: number;
  status: "ok" | "warn" | "crit";
  badge?: string;
}

interface Edge {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  active: boolean;
  stressed: boolean;
  label?: string;
}

export function getSimpleColHeaders(archetype?: IndustryArchetype): string[] {
  switch (archetype) {
    case "B2B_ENTERPRISE_SERVICES":
      return [
        "1. KUMPPANIT & TYÖKALUT",
        "2. KÄYTTÖÖNOTTO & YHTEYDET",
        "3. TOIMITILA & OSAAMISRESURSSIT",
        "4. ASIANTUNTIJATYÖ & PROJEKTIT",
        "5. ASIAKKUUDET & LASKUTUS",
        "6. B2B-ASIAKKAAT",
      ];
    case "PLATFORM_RECURRING":
      return [
        "1. PILVI-INFRA & APIT",
        "2. INTEGRAATIOT & TIETOLIIKENNE",
        "3. PALVELIMET & TIETOKANNAT",
        "4. KEHITYS & DEVOPS-YLLÄPITO",
        "5. TILAUSKANAVAT & SAAS",
        "6. KÄYTTÄJÄT & TILAAJAT",
      ];
    case "HIGH_VELOCITY_D2C":
      return [
        "1. MATERIAALIT & PAKKAUKSET",
        "2. SAAPUVA RAHTI & LOGISTIIKKA",
        "3. KESKUSVARASTO & HYLLYT",
        "4. PAKKAUS & LÄHETYKSET",
        "5. VERKKOKAUPPA & MYYMÄLÄT",
        "6. KULUTTAJAT & KOHDERYHMÄT",
      ];
    case "ASSET_HEAVY_MANUFACTURING":
      return [
        "1. METALLIT & KOMPONENTIT",
        "2. RASKAS RAHTI & TOIMITUKSET",
        "3. TEHDASVARASTO & TILAT",
        "4. KONEISTUS & KOKOONPANO",
        "5. B2B-MYYNTI & SOPIMUKSET",
        "6. TEOLLISUUSASIAKKAAT",
      ];
    case "PERISHABLE_COLD_CHAIN":
    default:
      return [
        "1. TUKUT & HANKINNAT",
        "2. KULJETUS & TOIMITUKSET",
        "3. KIOSKI / VARASTO",
        "4. VALMISTUS & TISKI",
        "5. MYYNTIPISTE & KASSA",
        "6. ASIAKKAAT",
      ];
  }
}

export function renderValueChainSvg(
  state: WorldState,
  selected?: SelectedNode | null,
  clarityMode: ClarityMode = "simple",
): string {
  const width = 1220;
  const height = 430;
  const nodeW = 166;
  const nodeH = 86;

  const domainUi = state.company.domainUi;
  const colX = [20, 224, 428, 632, 836, 1034];
  const colHeaders =
    clarityMode === "simple"
      ? domainUi?.valueChainColumns?.length === 6
        ? domainUi.valueChainColumns
        : getSimpleColHeaders(state.company.archetype)
      : [
          "1. TIER-1 SUPPLIERS",
          "2. INBOUND LOGISTICS",
          "3. WAREHOUSE PHYSICS",
          "4. PRODUCTION (L = λW)",
          "5. SALES CHANNELS",
          "6. MARKET SEGMENTS",
        ];

  const nodes: PositionedNode[] = [];
  const edges: Edge[] = [];

  const yPos = (idx: number, total: number): number => {
    const usableH = height - 64;
    const spacing = usableH / Math.max(1, total);
    return Math.round(48 + spacing * idx + (spacing - nodeH) / 2);
  };

  // 1. Suppliers
  state.supply.suppliers.forEach((sup, idx) => {
    const openPos = state.supply.purchaseOrders.filter(
      (p) => p.supplierId === sup.id && p.status !== "received" && p.status !== "cancelled",
    );
    const openQty = openPos.reduce((s, p) => s + (p.qty - p.receivedQty), 0);
    const status: PositionedNode["status"] = sup.creditHold
      ? "crit"
      : sup.reliability < 0.85
        ? "warn"
        : "ok";
    const termsLabel =
      clarityMode === "simple"
        ? sup.terms.kind === "cash"
          ? "Käteinen / Heti"
          : sup.terms.kind === "net"
            ? `Maksuehto ${sup.terms.days} pv`
            : sup.terms.kind
        : sup.terms.kind === "net"
          ? `Net ${sup.terms.days}`
          : sup.terms.kind.toUpperCase();

    nodes.push({
      kind: "supplier",
      id: sup.id,
      x: colX[0],
      y: yPos(idx, state.supply.suppliers.length),
      w: nodeW,
      h: nodeH,
      title: sup.name,
      subtitle: `${sup.region} • ${termsLabel}`,
      metricLabel: clarityMode === "simple" ? "Toimitusvarmuus" : "Rel / Open PO",
      metricValue:
        clarityMode === "simple"
          ? `${fmtPct(sup.reliability, 0)} • ${openQty > 0 ? `${fmtNum(openQty)} kpl` : "Ei avoimia"}`
          : `${fmtPct(sup.reliability, 0)} • ${fmtNum(openQty)}u`,
      utilization: 1 - sup.reliability,
      status,
      badge:
        clarityMode === "simple"
          ? sup.creditHold
            ? "TOIMITUSKIELLOSSA"
            : "Toimittaja"
          : sup.creditHold
            ? "CREDIT HOLD"
            : `Tier ${sup.tier}`,
    });
  });

  // 2. Inbound Lanes
  const inboundLanes = state.supply.lanes.filter((l) => l.direction === "inbound");
  const lanesToRender = inboundLanes.length > 0 ? inboundLanes : state.supply.lanes.slice(0, 2);
  lanesToRender.forEach((lane, idx) => {
    const inTransitPos = state.supply.purchaseOrders.filter(
      (p) =>
        p.laneId === lane.id &&
        (p.status === "placed" || p.status === "in_transit" || p.status === "at_dock"),
    );
    const transitUnits = inTransitPos.reduce(
      (s, p) => s + Math.max(0, p.qty - p.receivedQty - p.damagedQty),
      0,
    );
    const atDockUnits = inTransitPos
      .filter((p) => p.status === "at_dock")
      .reduce((s, p) => s + Math.max(0, p.qty - p.receivedQty - p.damagedQty), 0);

    const laneModeLabel =
      clarityMode === "simple"
        ? lane.mode === "parcel"
          ? "Paketti / Pientoimitus"
          : lane.mode === "lcl"
            ? "Nouto tukusta"
            : lane.mode === "van"
              ? "Jakeluauto"
              : "Kuljetus"
        : `Mode: ${lane.mode.toUpperCase()}`;

    nodes.push({
      kind: "lane",
      id: lane.id,
      x: colX[1],
      y: yPos(idx, lanesToRender.length),
      w: nodeW,
      h: nodeH,
      title: lane.name,
      subtitle: laneModeLabel,
      metricLabel: clarityMode === "simple" ? "Kuormassa / Perillä" : "In-Transit / Dock",
      metricValue:
        clarityMode === "simple"
          ? `${fmtNum(transitUnits)} kpl / ${fmtNum(atDockUnits)} kpl`
          : `${fmtNum(transitUnits)}u / ${fmtNum(atDockUnits)}u`,
      utilization: Math.min(1, lane.delayProb * 3 + (atDockUnits > 0 ? 0.5 : 0.2)),
      status: atDockUnits > 0 ? "warn" : "ok",
      badge:
        clarityMode === "simple"
          ? lane.mode === "parcel"
            ? "PAKETTI"
            : lane.mode === "lcl"
              ? "NOUTO"
              : "KULJETUS"
          : lane.mode.toUpperCase(),
    });
  });

  // 3. Warehouses
  state.warehouses.sites.forEach((wh, idx) => {
    const onHand = state.warehouses.lots
      .filter((l) => l.warehouseId === wh.id)
      .reduce((s, l) => s + l.qty, 0);
    const maxUtil = Math.max(wh.telemetry.utilization, wh.telemetry.pickUtilization);
    const status: PositionedNode["status"] =
      maxUtil > 0.88 || wh.telemetry.receivingBacklogUnits > 0
        ? "crit"
        : maxUtil > 0.72
          ? "warn"
          : "ok";

    const arch = state.company.archetype;
    let whSubtitle = `${wh.mode.toUpperCase()} • ${wh.zones.map((z) => z.handling).join("/")}`;
    let whMetricLabel = "Cube / On-Hand";
    if (clarityMode === "simple") {
      if (domainUi?.nodeLabels) {
        whSubtitle = domainUi.nodeLabels.facilitySubtitle;
        whMetricLabel = domainUi.nodeLabels.facilityMetricLabel;
      } else {
        switch (arch) {
          case "B2B_ENTERPRISE_SERVICES":
            whSubtitle = "Toimisto & työtilat";
            whMetricLabel = "Tilan käyttöaste";
            break;
          case "PLATFORM_RECURRING":
            whSubtitle = "Pilvipalvelimet & tietokanta";
            whMetricLabel = "Infran kuormitus";
            break;
          case "HIGH_VELOCITY_D2C":
            whSubtitle = "Keskusvarasto & hyllytila";
            whMetricLabel = "Täyttöaste / Kpl";
            break;
          case "ASSET_HEAVY_MANUFACTURING":
            whSubtitle = "Tehdas- ja komponenttivarasto";
            whMetricLabel = "Täyttöaste / Kpl";
            break;
          case "PERISHABLE_COLD_CHAIN":
          default:
            whSubtitle = wh.zones.some((z) => z.handling === "frozen" || z.handling === "cold")
              ? "Pakkas- & kylmätila"
              : "Säilytys- & varastotila";
            whMetricLabel = "Täyttöaste / Kpl";
            break;
        }
      }
    }

    nodes.push({
      kind: "warehouse",
      id: wh.id,
      x: colX[2],
      y: yPos(idx, state.warehouses.sites.length),
      w: nodeW,
      h: nodeH,
      title: wh.name,
      subtitle: whSubtitle,
      metricLabel: whMetricLabel,
      metricValue:
        clarityMode === "simple"
          ? `${fmtPct(wh.telemetry.utilization, 0)} • ${fmtNum(onHand)} kpl`
          : `${fmtPct(wh.telemetry.utilization, 0)} • ${fmtNum(onHand)}u`,
      utilization: maxUtil,
      status,
      badge:
        clarityMode === "simple"
          ? wh.telemetry.receivingBacklogUnits > 0
            ? "Kuorma saapunut"
            : "Tilaa vapaana"
          : wh.telemetry.receivingBacklogUnits > 0
            ? `DOCK +${fmtNum(wh.telemetry.receivingBacklogUnits)}`
            : `Auto ${fmtPct(wh.automationLevel, 0)}`,
    });
  });

  // 4. Work Centers
  state.operations.workCenters.forEach((wc, idx) => {
    const util = wc.telemetry.utilization;
    const status: PositionedNode["status"] =
      util > 0.88 || wc.condition < 0.65
        ? "crit"
        : util > 0.75 || wc.condition < 0.8
          ? "warn"
          : "ok";

    const arch = state.company.archetype;
    const uomLabel = state.catalog.items.find((i) => i.kind !== "raw")?.uom || "kpl";
    let wcSubtitle = `${wc.sourcing.toUpperCase()} • Cond ${fmtPct(wc.condition, 0)}`;
    let wcMetricLabel = "Util ρ / Little's L";
    let wcMetricValue = `${fmtPct(util, 0)} • L=${wc.telemetry.littlesL.toFixed(1)}`;
    let wcBadge = `W=${wc.telemetry.avgWaitDays.toFixed(1)}d`;

    const estServiceWaitMins =
      wc.telemetry.avgWaitDays <= 0.08
        ? Math.max(1, Math.round(wc.telemetry.avgWaitDays * 12 * 60))
        : Math.max(1, Math.min(45, Math.round(util * 18)));

    if (clarityMode === "simple") {
      if (domainUi?.nodeLabels) {
        wcSubtitle = wc.sourcing === "insourced" ? domainUi.nodeLabels.workCenterTag : "Alihankintakumppani";
        wcMetricLabel = domainUi.nodeLabels.workCenterQueueLabel;
        wcMetricValue = `${fmtPct(util, 0)} • ~${Math.round(wc.telemetry.littlesL)} ${uomLabel}`;
        wcBadge =
          util > 0.12
            ? `Jono ~${estServiceWaitMins} min`
            : "Ei jonoa";
      } else {
        switch (arch) {
          case "B2B_ENTERPRISE_SERVICES":
            wcSubtitle = wc.sourcing === "insourced" ? "Oma asiantuntijatiimi" : "Freelancer-verkosto";
            wcMetricLabel = "Tiimin kuormitus / Työjono";
            wcMetricValue = `${fmtPct(util, 0)} • ~${Math.round(wc.telemetry.littlesL)} projektia`;
            wcBadge = wc.telemetry.avgWaitDays > 0.05 ? `Odotus ~${Math.max(1, Math.round(wc.telemetry.avgWaitDays * 30))} pv` : "Vapaana";
            break;
          case "PLATFORM_RECURRING":
            wcSubtitle = wc.sourcing === "insourced" ? "Oma kehitystiimi" : "Ulkoinen tiimi";
            wcMetricLabel = "Sprinttikuorma / Työjono";
            wcMetricValue = `${fmtPct(util, 0)} • ~${Math.round(wc.telemetry.littlesL)} tikettiä`;
            wcBadge = "Sprintti käynnissä";
            break;
          case "HIGH_VELOCITY_D2C":
            wcSubtitle = wc.sourcing === "insourced" ? "Oma pakkaamo & unboxing" : "3PL-jakelu";
            wcMetricLabel = "Pakkaamon kuormitus / Jono";
            wcMetricValue = `${fmtPct(util, 0)} • ~${Math.round(wc.telemetry.littlesL)} lähetystä`;
            wcBadge = wc.telemetry.avgWaitDays > 0.05 ? `Lähetysaika ~${Math.max(1, Math.round(wc.telemetry.avgWaitDays * 24))} h` : "Lähtee heti";
            break;
          case "ASSET_HEAVY_MANUFACTURING":
            wcSubtitle = wc.sourcing === "insourced" ? "Oma koneistus & kokoonpano" : "Alihankintakoneistus";
            wcMetricLabel = "Koneiden käyttöaste / Työjono";
            wcMetricValue = `${fmtPct(util, 0)} • ~${Math.round(wc.telemetry.littlesL)} työtä`;
            wcBadge = wc.telemetry.avgWaitDays > 0.05 ? `Läpimeno ~${wc.telemetry.avgWaitDays.toFixed(1)} pv` : "Ei jonoa";
            break;
          case "PERISHABLE_COLD_CHAIN":
          default:
            wcSubtitle = wc.sourcing === "insourced" ? "Oma valmistus & tiski" : "Valmiit tuotteet";
            wcMetricLabel = "Tiskin ruuhka / Jono";
            wcMetricValue = `${fmtPct(util, 0)} • ~${Math.round(wc.telemetry.littlesL)} annosta`;
            wcBadge = util > 0.12 ? `Jono ~${estServiceWaitMins} min` : "Ei jonoa";
            break;
        }
      }
    }

    nodes.push({
      kind: "workCenter",
      id: wc.id,
      x: colX[3],
      y: yPos(idx, state.operations.workCenters.length),
      w: nodeW,
      h: nodeH,
      title: wc.name,
      subtitle: wcSubtitle,
      metricLabel: wcMetricLabel,
      metricValue: wcMetricValue,
      utilization: Math.min(1, util),
      status,
      badge: wcBadge,
    });
  });

  // 5. Sales Channels
  state.commercial.channels.forEach((ch, idx) => {
    const off = state.commercial.offerings.find((o) => o.channelId === ch.id);
    const ost = off
      ? state.commercial.offeringStates.find((s) => s.offeringId === off.id)
      : undefined;
    const fill = ost?.fillRateEma ?? 1;
    const status: PositionedNode["status"] =
      fill < 0.75 ? "crit" : fill < 0.9 ? "warn" : "ok";

    const chSubtitle =
      clarityMode === "simple"
        ? ch.paymentTermsDays === 0
          ? `Kortti & käteinen • Kulu ${fmtPct(ch.feePct, 1)}`
          : `Lasku ${ch.paymentTermsDays} pv • Kulu ${fmtPct(ch.feePct, 1)}`
        : `Net ${ch.paymentTermsDays}d • Fee ${fmtPct(ch.feePct, 1)}`;

    const arch = state.company.archetype;
    const channelBadge =
      clarityMode === "simple"
        ? domainUi?.nodeLabels?.channelTag
          ? domainUi.nodeLabels.channelTag
          : arch === "B2B_ENTERPRISE_SERVICES"
            ? "B2B-LASKUTUS"
            : arch === "PLATFORM_RECURRING"
              ? (off?.pricing.kind === "subscription" ? "SAAS-TILAUS" : "VERKKOPALVELU")
              : arch === "HIGH_VELOCITY_D2C"
                ? "VERKKOKAUPPA"
                : arch === "ASSET_HEAVY_MANUFACTURING"
                  ? "B2B-MYYNTI"
                  : "MYYNTIPISTE"
        : off
          ? off.pricing.kind.replace("_", " ").toUpperCase()
          : ch.kind.toUpperCase();

    nodes.push({
      kind: "channel",
      id: ch.id,
      x: colX[4],
      y: yPos(idx, state.commercial.channels.length),
      w: nodeW,
      h: nodeH,
      title: ch.name,
      subtitle: chSubtitle,
      metricLabel: clarityMode === "simple" ? "Hinta / Saatavuus" : "Price / Fill SLA",
      metricValue: `${fmtCurrency(ost?.lastPrice ?? 0, false)} • ${fmtPct(fill, 0)}`,
      utilization: 1 - fill,
      status,
      badge: channelBadge,
    });
  });

  // 6. Customer Segments
  state.market.segments.forEach((seg, idx) => {
    const pres = state.market.presence.find((p) => p.segmentId === seg.id);
    const share = pres?.marketShare ?? 0;
    const status: PositionedNode["status"] =
      share < 0.12 ? "crit" : share < 0.22 ? "warn" : "ok";

    const segSubtitle =
      clarityMode === "simple"
        ? `Maksuhalukkuus ~${fmtCurrency(seg.wtpMean, false)}`
        : `${seg.kind.toUpperCase()} • WTP ${fmtCurrency(seg.wtpMean, true)}`;

    nodes.push({
      kind: "segment",
      id: seg.id,
      x: colX[5],
      y: yPos(idx, state.market.segments.length),
      w: nodeW,
      h: nodeH,
      title: seg.name,
      subtitle: segSubtitle,
      metricLabel: clarityMode === "simple" ? "Osuus / Tunnettuus" : "Share / Awareness",
      metricValue: `${fmtPct(share, 0)} • ${fmtPct(pres?.awareness ?? 0, 0)}`,
      utilization: share,
      status,
      badge: `${fmtNum(pres?.customers ?? 0)} ${clarityMode === "simple" ? "asiakasta" : "cust"}`,
    });
  });

  // Build Edges across adjacent columns
  const byKind = (k: PositionedNode["kind"]) => nodes.filter((n) => n.kind === k);
  const supNodes = byKind("supplier");
  const laneNodes = byKind("lane");
  const whNodes = byKind("warehouse");
  const wcNodes = byKind("workCenter");
  const chNodes = byKind("channel");
  const segNodes = byKind("segment");

  // Supplier -> Lane
  for (const sNode of supNodes) {
    const sup = state.supply.suppliers.find((s) => s.id === sNode.id);
    for (const lNode of laneNodes) {
      if (!sup || sup.laneIds.includes(lNode.id) || laneNodes.length === 1) {
        edges.push({
          fromX: sNode.x + sNode.w,
          fromY: sNode.y + sNode.h / 2,
          toX: lNode.x,
          toY: lNode.y + lNode.h / 2,
          active: !sup?.creditHold,
          stressed: Boolean(sup?.creditHold),
        });
      }
    }
  }

  // Lane -> Warehouse
  for (const lNode of laneNodes) {
    for (const wNode of whNodes) {
      edges.push({
        fromX: lNode.x + lNode.w,
        fromY: lNode.y + lNode.h / 2,
        toX: wNode.x,
        toY: wNode.y + wNode.h / 2,
        active: true,
        stressed: wNode.status === "crit",
      });
    }
  }

  // Warehouse -> WorkCenter
  for (const wNode of whNodes) {
    for (const cNode of wcNodes) {
      edges.push({
        fromX: wNode.x + wNode.w,
        fromY: wNode.y + wNode.h / 2,
        toX: cNode.x,
        toY: cNode.y + cNode.h / 2,
        active: true,
        stressed: cNode.status === "crit",
      });
    }
  }

  // WorkCenter -> Channel
  for (const cNode of wcNodes) {
    for (const chNode of chNodes) {
      edges.push({
        fromX: cNode.x + cNode.w,
        fromY: cNode.y + cNode.h / 2,
        toX: chNode.x,
        toY: chNode.y + chNode.h / 2,
        active: true,
        stressed: chNode.status === "crit",
      });
    }
  }

  // Channel -> Segment
  for (const chNode of chNodes) {
    const ch = state.commercial.channels.find((c) => c.id === chNode.id);
    for (const segNode of segNodes) {
      if (!ch || ch.segmentIds.includes(segNode.id)) {
        edges.push({
          fromX: chNode.x + chNode.w,
          fromY: chNode.y + chNode.h / 2,
          toX: segNode.x,
          toY: segNode.y + segNode.h / 2,
          active: true,
          stressed: chNode.status === "crit",
        });
      }
    }
  }

  const headerSvg = colHeaders
    .map(
      (label, i) => `
      <g transform="translate(${colX[i]}, 12)">
        <rect x="0" y="0" width="${nodeW}" height="22" rx="4" fill="#0f172a" stroke="#1e293b" />
        <text x="${nodeW / 2}" y="15" text-anchor="middle" fill="#94a3b8" font-size="10" font-weight="700" letter-spacing="0.08em">${escapeHtml(label)}</text>
      </g>`,
    )
    .join("");

  const edgeSvg = edges
    .map((e, idx) => {
      const midX = (e.fromX + e.toX) / 2;
      const d = `M ${e.fromX} ${e.fromY} C ${midX} ${e.fromY}, ${midX} ${e.toY}, ${e.toX} ${e.toY}`;
      const stroke = e.stressed ? "#ef4444" : e.active ? "#38bdf8" : "#475569";
      return `
        <path d="${d}" fill="none" stroke="${stroke}" stroke-width="2" stroke-opacity="0.45" />
        ${
          e.active
            ? `<path d="${d}" fill="none" stroke="${stroke}" stroke-width="2.2" stroke-dasharray="6 10" class="vc-flow-edge" style="animation-delay: -${(idx * 0.35).toFixed(2)}s" />`
            : ""
        }
      `;
    })
    .join("");

  const nodesSvg = nodes
    .map((n) => {
      const isSelected = selected?.kind === n.kind && selected?.id === n.id;
      const borderColor = isSelected
        ? "#38bdf8"
        : n.status === "crit"
          ? "#ef4444"
          : n.status === "warn"
            ? "#f59e0b"
            : "#334155";
      const statusDotColor =
        n.status === "crit" ? "#ef4444" : n.status === "warn" ? "#f59e0b" : "#10b981";
      const barWidth = Math.round(Math.max(4, Math.min(1, n.utilization) * ( n.w - 20 )));
      const shortTitle = n.title.length > 22 ? `${n.title.slice(0, 21)}…` : n.title;
      const shortSub = n.subtitle.length > 26 ? `${n.subtitle.slice(0, 25)}…` : n.subtitle;
      const shortMetricLabel = n.badge && n.metricLabel.length > 16 ? `${n.metricLabel.slice(0, 15)}…` : n.metricLabel;

      return `
        <g class="vc-node" data-node-kind="${n.kind}" data-node-id="${escapeHtml(n.id)}" transform="translate(${n.x}, ${n.y})" style="cursor:pointer">
          <rect x="0" y="0" width="${n.w}" height="${n.h}" rx="8" fill="${isSelected ? "#172554" : "#0f172a"}" stroke="${borderColor}" stroke-width="${isSelected ? "2.5" : "1.5"}" />
          <circle cx="12" cy="15" r="4" fill="${statusDotColor}" />
          <text x="22" y="18" fill="#f8fafc" font-size="11" font-weight="700">${escapeHtml(shortTitle)}</text>
          <text x="10" y="34" fill="#94a3b8" font-size="9.5">${escapeHtml(shortSub)}</text>
          <text x="10" y="52" fill="#64748b" font-size="9">${escapeHtml(shortMetricLabel)}</text>
          ${
            n.badge
              ? `<rect x="${n.w - 68}" y="42" width="60" height="14" rx="3" fill="#1e293b" />
                 <text x="${n.w - 38}" y="52" text-anchor="middle" fill="#38bdf8" font-size="8" font-weight="700">${escapeHtml(n.badge.slice(0, 12))}</text>`
              : ""
          }
          <text x="10" y="67" fill="#e2e8f0" font-size="10.5" font-weight="600" font-family="ui-monospace, SFMono-Regular, Menlo, monospace">${escapeHtml(n.metricValue)}</text>
          <rect x="10" y="74" width="${n.w - 20}" height="5" rx="2.5" fill="#1e293b" />
          <rect x="10" y="74" width="${barWidth}" height="5" rx="2.5" fill="${statusDotColor}" />
        </g>
      `;
    })
    .join("");

  return `
    <svg viewBox="0 0 ${width} ${height}" width="100%" height="100%" class="vc-svg">
      <defs>
        <pattern id="vc-grid" width="24" height="24" patternUnits="userSpaceOnUse">
          <path d="M 24 0 L 0 0 0 24" fill="none" stroke="#1e293b" stroke-width="0.6" stroke-opacity="0.55" />
        </pattern>
      </defs>
      <rect width="${width}" height="${height}" fill="url(#vc-grid)" rx="8" />
      ${headerSvg}
      ${edgeSvg}
      ${nodesSvg}
    </svg>
  `;
}

export function getInspectorTagTitle(
  kind: SelectedNode["kind"],
  archetype?: IndustryArchetype,
  clarityMode: ClarityMode = "simple",
): string {
  if (clarityMode === "expert") {
    switch (kind) {
      case "supplier": return "SUPPLIER NODE";
      case "lane": return "FREIGHT LANE";
      case "warehouse": return "WAREHOUSE NODE";
      case "workCenter": return "PRODUCTION WORK CENTER (LITTLE'S LAW)";
      case "channel": return "COMMERCIAL CHANNEL";
      case "segment": return "CUSTOMER SEGMENT";
    }
  }

  switch (kind) {
    case "supplier":
      switch (archetype) {
        case "B2B_ENTERPRISE_SERVICES": return "TYÖKALU- JA LISENSSITOIMITTAJA";
        case "PLATFORM_RECURRING": return "PILVI- JA INFRAKUMPPANI";
        case "HIGH_VELOCITY_D2C": return "MATERIAALI- JA PAKKAUSTOIMITTAJA";
        case "ASSET_HEAVY_MANUFACTURING": return "METALLI- JA KOMPONENTTITOIMITTAJA";
        case "PERISHABLE_COLD_CHAIN":
        default: return "TUKKURI & TAVARANTOIMITTAJA";
      }
    case "lane":
      switch (archetype) {
        case "B2B_ENTERPRISE_SERVICES":
        case "PLATFORM_RECURRING": return "DIGITAALISET YHTEYDET & KÄYTTÖÖNOTTO";
        case "ASSET_HEAVY_MANUFACTURING": return "RASKAS RAHTI & LOGISTIIKKA";
        default: return "KULJETUS & LOGISTIIKKA";
      }
    case "warehouse":
      switch (archetype) {
        case "B2B_ENTERPRISE_SERVICES": return "TOIMITILAT & TYÖPISTEET";
        case "PLATFORM_RECURRING": return "PILVIPALVELIMET & TIETOKANNAT";
        case "HIGH_VELOCITY_D2C": return "KESKUSVARASTO & LÄHETYSTILA";
        case "ASSET_HEAVY_MANUFACTURING": return "TEHDASHALLI & MATERIAALIVARASTO";
        case "PERISHABLE_COLD_CHAIN":
        default: return "SÄILYTYS, KYLMÄTILAT & VARASTO";
      }
    case "workCenter":
      switch (archetype) {
        case "B2B_ENTERPRISE_SERVICES": return "ASIANTUNTIJATYÖ & ASIAKASTOIMITUS";
        case "PLATFORM_RECURRING": return "OHJELMISTOKEHITYS & YLLÄPITO";
        case "HIGH_VELOCITY_D2C": return "PAKKAUS & TILAUSTEN KÄSITTELY";
        case "ASSET_HEAVY_MANUFACTURING": return "TEHDAS, KONEISTUS & KOKOONPANO";
        case "PERISHABLE_COLD_CHAIN":
        default: return "VALMISTUS & ASIAKASPALVELU";
      }
    case "channel":
      switch (archetype) {
        case "B2B_ENTERPRISE_SERVICES": return "B2B-ASIAKKUUDET & MYYNTI";
        case "PLATFORM_RECURRING": return "TILAUSKANAVA & ITSEPALVELU";
        case "HIGH_VELOCITY_D2C": return "VERKKOKAUPPA & MYYMÄLÄT";
        case "ASSET_HEAVY_MANUFACTURING": return "B2B-TEOLLISUUSMYYNTI";
        case "PERISHABLE_COLD_CHAIN":
        default: return "MYYNTIPISTE & KASSA";
      }
    case "segment":
      switch (archetype) {
        case "B2B_ENTERPRISE_SERVICES":
        case "ASSET_HEAVY_MANUFACTURING": return "YRITYSASIAKKAAT & KOHDERYHMÄT";
        case "PLATFORM_RECURRING": return "KÄYTTÄJÄT & TILAAJARYHMÄT";
        default: return "ASIAKASKUNTA & KYSYNTÄ";
      }
  }
}

/**
 * Render the contextual node inspector & quick-action controls when a user clicks a node on the Value Chain map.
 */
export function renderNodeInspector(
  state: WorldState,
  selected?: SelectedNode | null,
  clarityMode: ClarityMode = "simple",
): string {
  if (!selected) {
    const wc = state.operations.workCenters[0];
    if (wc) {
      selected = { kind: "workCenter", id: wc.id };
    } else {
      return `<div class="empty-hint">${
        clarityMode === "simple"
          ? "Klikkaa mitä tahansa laatikkoa yllä olevassa ketjussa nähdäksesi tiedot ja toimenpiteet."
          : "Click any node in the Value Chain Map above to inspect live physics and execute tactical actions."
      }</div>`;
    }
  }

  const arch = state.company.archetype;
  const domainUi = state.company.domainUi;
  const nl = domainUi?.nodeLabels;
  const tick = state.calendar.tick;

  if (selected.kind === "supplier") {
    const sup = state.supply.suppliers.find((s) => s.id === selected!.id) ?? state.supply.suppliers[0];
    if (!sup) return "";
    const offer = sup.offers[0];
    const wh = state.warehouses.sites[0];
    const lane = state.supply.lanes.find((l) => sup.laneIds.includes(l.id)) ?? state.supply.lanes[0];

    const tagTitle = (clarityMode === "simple" && nl?.supplierTag) || getInspectorTagTitle("supplier", arch, clarityMode);
    const statusText = sup.creditHold
      ? clarityMode === "simple" ? "TOIMITUSKIELLOSSA" : "CREDIT HOLD"
      : clarityMode === "simple" ? "AKTIIVINEN TOIMITTAJA" : "ACTIVE";
    const termsText =
      clarityMode === "simple"
        ? sup.terms.kind === "cash"
          ? "Käteinen / Heti"
          : sup.terms.kind === "net"
            ? `Maksuehto ${sup.terms.days} pv`
            : sup.terms.kind
        : sup.terms.kind === "net"
          ? `Net ${sup.terms.days}d`
          : sup.terms.kind.toUpperCase();

    const supIndex = state.supply.suppliers.findIndex((s) => s.id === sup.id);
    const supAssumptionKey: AssumptionKey = supIndex === 1 ? "raw_cost_2" : "raw_cost_1";
    const supMark = markTag(state, supAssumptionKey);

    const offerRows = sup.offers
      .map((o) => {
        const item = state.catalog.items.find((i) => i.id === o.itemId);
        const onHand = state.warehouses.lots
          .filter((l) => l.itemId === o.itemId)
          .reduce((s, l) => s + l.qty, 0);
        const rp = state.supply.reorderPolicies.find((r) => r.itemId === o.itemId);
        const batchCost = o.unitPrice * o.moq;
        return `
          <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 10px;background:#0f172a;border:1px solid #1e293b;border-radius:6px;margin-top:6px;gap:8px;flex-wrap:wrap">
            <div>
              <strong style="color:#f8fafc;font-size:12.5px">📦 ${escapeHtml(item?.name ?? o.itemId)}</strong>
              <span class="sub" style="display:block;color:#94a3b8">
                ${
                  clarityMode === "simple"
                    ? `Varastossa nyt: <b style="color:${onHand < o.moq * 0.5 ? "#ef4444" : "#38bdf8"}">${fmtNum(onHand)} ${escapeHtml(item?.uom ?? "kpl")}</b> • Yksikköhinta: <button type="button" class="assumption-pill" data-assumption-key="${supAssumptionKey}" title="Klikkaa nähdäksesi sidonnaisuudet ja muokataksesi sisäänostohintaa">${fmtCurrencyPreciseOrStd(o.unitPrice)}/${escapeHtml(item?.uom ?? "kpl")}${supMark}</button> • Toimituserä: ${o.moq} ${escapeHtml(item?.uom ?? "kpl")} (${fmtCurrency(batchCost)}${supMark}) • Toimitusaika ~${o.leadTimeDays} pv`
                    : `On-Hand: ${fmtNum(onHand)} ${escapeHtml(item?.uom ?? "u")} • Unit: <button type="button" class="assumption-pill" data-assumption-key="${supAssumptionKey}">${fmtCurrencyPreciseOrStd(o.unitPrice)}${supMark}</button> • MOQ: ${o.moq}u (${fmtCurrency(batchCost)}) • Lead: ${o.leadTimeDays}d`
                }
              </span>
            </div>
            <div style="display:flex;gap:6px;align-items:center">
              ${
                wh && lane
                  ? `<button class="btn btn-xs btn-primary" data-action='{"type":"PLACE_PURCHASE_ORDER","supplierId":"${sup.id}","itemId":"${o.itemId}","qty":${o.moq},"warehouseId":"${wh.id}","laneId":"${lane.id}"}'>
                      ${clarityMode === "simple" ? `🛒 Osta +${o.moq} ${escapeHtml(item?.uom ?? "kpl")} (${fmtCurrency(batchCost)})` : `Order +${o.moq}u`}
                    </button>`
                  : ""
              }
              <button type="button" class="btn btn-xs btn-secondary" data-assumption-key="${supAssumptionKey}">
                ✏️ Muokkaa hintaa (${supMark})
              </button>
              ${
                rp
                  ? `<span class="tag tag-slate" title="Automaattinen täydennysraja">${clarityMode === "simple" ? `Automaattitilaus (${rp.safetyStockDays} pv puskuri)` : `Auto-${rp.mode.toUpperCase()} (${rp.safetyStockDays}d)`}</span>`
                  : ""
              }
            </div>
          </div>
        `;
      })
      .join("");

    return `
      <div class="inspector-card">
        <div class="inspector-header">
          <div>
            <span class="tag tag-cyan">${escapeHtml(tagTitle)}</span>
            <h4>${escapeHtml(sup.name)} (${escapeHtml(sup.region)})</h4>
          </div>
          <span class="tag ${sup.creditHold ? "tag-red" : "tag-green"}">${statusText}</span>
        </div>
        <div class="inspector-grid">
          <div><label>${clarityMode === "simple" ? "Toimitusvarmuus" : "Reliability"}</label><strong>${fmtPct(sup.reliability, 1)}*</strong></div>
          <div><label>${clarityMode === "simple" ? "Maksuehto" : "Payment Terms"}</label><strong>${termsText}</strong></div>
          <div><label>${clarityMode === "simple" ? "Sisäänostohinta / Minimi" : "Unit Price / MOQ"}</label><strong>${offer ? `<button type="button" class="assumption-pill" data-assumption-key="${supAssumptionKey}">${fmtCurrencyPreciseOrStd(offer.unitPrice)}${supMark}</button> / ${offer.moq} ${clarityMode === "simple" ? "kpl" : "u"}` : "N/A"}</strong></div>
          <div><label>${clarityMode === "simple" ? "Neuvotteluvoima & Suhde" : "Relationship"}</label><strong>${fmtPct(sup.relationship, 0)}</strong></div>
        </div>
        <div style="margin:8px 0">
          <div style="font-size:11px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:0.06em">
            ${clarityMode === "simple" ? "Toimittajan valikoima, hinnat & nykyinen varastosaldo:" : "Supplier Catalog, Unit Economics & On-Hand Stock:"}
          </div>
          ${offerRows}
        </div>
        ${
          offer && wh && lane
            ? `<div class="inspector-actions">
                <button class="btn btn-sm btn-primary" data-action='{"type":"PLACE_PURCHASE_ORDER","supplierId":"${sup.id}","itemId":"${offer.itemId}","qty":${offer.moq},"warehouseId":"${wh.id}","laneId":"${lane.id}"}'>
                  ${clarityMode === "simple" ? (nl?.orderSupplyActionLabel || `Tilaa erä (${offer.moq} kpl)`) : `Order MOQ (${offer.moq}u)`}
                </button>
                <button class="btn btn-sm btn-secondary" data-negotiate-supplier="${sup.id}">
                  ${clarityMode === "simple" ? "🤝 Neuvottele maksuaika / tukkualennus" : "Negotiate Net 45 / Bulk Discount"}
                </button>
                <button class="btn btn-sm btn-secondary" data-tab="operations">
                  ${clarityMode === "simple" ? "📦 Avaa koko varasto- ja ostokirjanpito →" : "Open Full Inventory & PO Ledger →"}
                </button>
              </div>`
            : ""
        }
      </div>
    `;
  }

  if (selected.kind === "warehouse") {
    const wh = state.warehouses.sites.find((w) => w.id === selected!.id) ?? state.warehouses.sites[0];
    if (!wh) return "";

    const tagTitle = (clarityMode === "simple" && nl?.facilityTag) || getInspectorTagTitle("warehouse", arch, clarityMode);
    const badgeText = clarityMode === "simple"
      ? wh.zones.some((z) => z.handling === "frozen" || z.handling === "cold") ? "PAKKANEN & KYLMÄ" : "TOIMITILA & VARASTO"
      : wh.mode.toUpperCase();
    const dailyRent = wh.rentPerDay ?? 0;
    const monthlyRent = dailyRent * 30;
    const rentMark = markTag(state, "facility_rent");
    const whLots = state.warehouses.lots.filter((l) => l.warehouseId === wh.id);

    const lotSummaryHtml = whLots
      .slice(0, 6)
      .map((lot) => {
        const it = state.catalog.items.find((i) => i.id === lot.itemId);
        const remDays = lot.expiryTick !== undefined ? Math.max(0, lot.expiryTick - tick) : null;
        return `
          <div style="display:flex;justify-content:space-between;align-items:center;padding:6px 10px;background:#0f172a;border:1px solid #1e293b;border-radius:6px;margin-top:4px;font-size:12px">
            <div>
              <strong style="color:#f8fafc">${escapeHtml(it?.name ?? lot.itemId)}</strong>
              <span class="sub" style="margin-left:6px;color:#94a3b8">(${it?.kind === "raw" ? (clarityMode === "simple" ? "Raaka-aine / tarvike" : "Raw") : (clarityMode === "simple" ? "Valmis myytävä" : "Finished")})</span>
            </div>
            <div class="mono" style="color:#e2e8f0">
              <b>${fmtNum(lot.qty)} ${escapeHtml(it?.uom ?? "kpl")}</b> • ${fmtCurrency(lot.value)}
              ${remDays !== null ? ` • <span style="color:${remDays <= 4 ? "#ef4444" : "#10b981"}">${clarityMode === "simple" ? `Säilyy ${remDays} pv` : `${remDays}d shelf`}</span>` : ""}
            </div>
          </div>
        `;
      })
      .join("");

    return `
      <div class="inspector-card">
        <div class="inspector-header">
          <div>
            <span class="tag tag-cyan">${escapeHtml(tagTitle)}</span>
            <h4>${escapeHtml(wh.name)} (${escapeHtml(wh.region)})</h4>
          </div>
          <span class="tag tag-blue">${badgeText}</span>
        </div>
        <div class="inspector-grid">
          <div><label>${clarityMode === "simple" ? "Vuokra / Tilakustannus" : "Facility Lease"}</label><strong>${dailyRent > 0 ? `<button type="button" class="assumption-pill" data-assumption-key="facility_rent" title="Klikkaa nähdäksesi vuokran sidonnaisuudet ja muokataksesi sitä">${fmtCurrency(dailyRent)}/${clarityMode === "simple" ? "pv" : "d"} (${fmtCurrency(monthlyRent)}/kk)${rentMark}</button>` : (clarityMode === "simple" ? "Oma / Sisältyy" : "Owned")}</strong></div>
          <div><label>${clarityMode === "simple" ? (nl?.facilityMetricLabel || "Tilan täyttöaste") : "Cubic Utilization"}</label><strong>${fmtPct(wh.telemetry.utilization, 1)}</strong></div>
          <div><label>${clarityMode === "simple" ? "Kapasiteetti / päivä" : "Receiving / Pick Cap"}</label><strong>${wh.receivingUnitsPerDay} / ${wh.pickPackUnitsPerDay} ${clarityMode === "simple" ? "kpl/pv" : "u/d"}</strong></div>
          <div><label>${clarityMode === "simple" ? "Kylmä- & laitetaso" : "Automation Level"}</label><strong>${fmtPct(wh.automationLevel, 0)}</strong></div>
        </div>
        <div style="margin:8px 0">
          <div style="font-size:11px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:0.06em">
            ${clarityMode === "simple" ? "Kojun / Varaston sisältö juuri nyt:" : "Live Inventory Lots On-Hand:"}
          </div>
          ${lotSummaryHtml || `<div class="sub" style="padding:6px 0">${clarityMode === "simple" ? "Varasto on tyhjä — tilaa täydennystä toimittajalta!" : "No inventory lots on hand."}</div>`}
        </div>
        <div class="inspector-actions">
          <button type="button" class="btn btn-sm btn-secondary" data-assumption-key="facility_rent">
            ✏️ Muokkaa vuokraa & katso sidonnaisuudet (${rentMark})
          </button>
          <button class="btn btn-sm btn-primary" data-action='{"type":"CAPEX_UPGRADE","targetKind":"warehouse","targetId":"${wh.id}","upgrade":"automation","amount":3500000,"financing":"equipment_loan"}'>
            ${clarityMode === "simple" ? (arch === "B2B_ENTERPRISE_SERVICES" ? "+Työkalujen ja järjestelmien tehostus" : arch === "PLATFORM_RECURRING" ? "+Pilvi-infrastruktuurin skaalaus" : "+Uusi laitteisto / kylmäkalusteet (Lainarahoitus)") : "+Automation CapEx ($35k Loan)"}
          </button>
          <button class="btn btn-sm btn-secondary" data-action='{"type":"CAPEX_UPGRADE","targetKind":"warehouse","targetId":"${wh.id}","upgrade":"capacity","amount":4000000,"financing":"cash"}'>
            ${clarityMode === "simple" ? (arch === "B2B_ENTERPRISE_SERVICES" ? "Laajenna toimitiloja +25%" : arch === "PLATFORM_RECURRING" ? "Kasvata pilvikapasiteettia +25%" : "Laajenna kojua / varastotilaa +25%") : "Expand Zone Cube +25% ($40k)"}
          </button>
          <button class="btn btn-sm btn-secondary" data-tab="operations">
            ${clarityMode === "simple" ? "📦 Tutki kaikkia varastoeriä & päiväyksiä →" : "Inspect All FEFO Lots →"}
          </button>
        </div>
      </div>
    `;
  }

  if (selected.kind === "workCenter") {
    const wc =
      state.operations.workCenters.find((w) => w.id === selected!.id) ??
      state.operations.workCenters[0];
    if (!wc) return "";
    const nextSourcing = wc.sourcing === "insourced" ? "outsourced" : "insourced";
    const uomLabel = state.catalog.items.find((i) => i.kind !== "raw")?.uom || "kpl";
    const recipe = state.catalog.recipes.find((r) => r.workCenterId === wc.id) ?? state.catalog.recipes[0];
    const outItem = recipe ? state.catalog.items.find((i) => i.id === recipe.outputItemId) : undefined;
    const capMark = markTag(state, "service_capacity");
    const raw1Mark = markTag(state, "raw_cost_1");

    const tagTitle = (clarityMode === "simple" && nl?.workCenterTag) || getInspectorTagTitle("workCenter", arch, clarityMode);
    const badgeText = clarityMode === "simple"
      ? `Kuormitus: ${fmtPct(wc.telemetry.utilization, 0)}`
      : `ρ = ${fmtPct(wc.telemetry.utilization, 1)}`;

    const arrivalLabel =
      clarityMode === "simple"
        ? arch === "B2B_ENTERPRISE_SERVICES" ? "Toimeksiantoja / Saapuvia töitä" : "Asiakkaita / Tilauksia päivässä"
        : "Arrival Rate (λ)";

    const arrivalUnits =
      clarityMode === "simple"
        ? arch === "B2B_ENTERPRISE_SERVICES"
          ? `~${Math.round(wc.telemetry.arrivalRateEma)} toimeksiantoa/kk`
          : arch === "PLATFORM_RECURRING"
            ? `~${Math.round(wc.telemetry.arrivalRateEma * 5)} tikettiä/vko`
            : `~${Math.round(wc.telemetry.arrivalRateEma * (recipe?.outputQty ?? 1))} ${uomLabel}/pv`
        : `${wc.telemetry.arrivalRateEma.toFixed(2)} batches/d`;

    const waitLabel =
      clarityMode === "simple"
        ? nl?.workCenterQueueLabel ||
          (arch === "B2B_ENTERPRISE_SERVICES"
            ? "Projektin aloitusaika / Odotus"
            : arch === "PLATFORM_RECURRING"
              ? "Odotusaika jonossa"
              : arch === "ASSET_HEAVY_MANUFACTURING"
                ? "Jonotusaika tehtaalla"
                : "Jonotusaika tiskillä")
        : "Avg Wait Time (W)";

    const estWaitMins =
      wc.telemetry.avgWaitDays <= 0.08
        ? Math.max(1, Math.round(wc.telemetry.avgWaitDays * 12 * 60))
        : Math.max(1, Math.min(45, Math.round(wc.telemetry.utilization * 18)));

    const waitUnits =
      clarityMode === "simple"
        ? arch === "B2B_ENTERPRISE_SERVICES"
          ? (wc.telemetry.avgWaitDays > 0.05 ? `~${Math.max(1, Math.round(wc.telemetry.avgWaitDays * 30))} pv` : "Heti vapaa")
          : arch === "PLATFORM_RECURRING"
            ? (wc.telemetry.avgWaitDays > 0.05 ? `~${Math.max(1, Math.round(wc.telemetry.avgWaitDays * 7))} pv` : "Työn alla")
            : arch === "ASSET_HEAVY_MANUFACTURING"
              ? (wc.telemetry.avgWaitDays > 0.05 ? `~${wc.telemetry.avgWaitDays.toFixed(1)} pv` : "Ei jonoa")
              : (wc.telemetry.utilization > 0.12 ? `~${estWaitMins} min` : "Alle 1 min")
        : `${wc.telemetry.avgWaitDays.toFixed(2)} days`;

    const wipLabel =
      clarityMode === "simple"
        ? arch === "B2B_ENTERPRISE_SERVICES"
          ? "Käynnissä olevat projektit"
          : arch === "PLATFORM_RECURRING"
            ? "Sprintissä olevat tehtävät"
            : "Jonossa olevat tilaukset"
        : "Little's Law WIP (L=λW)";

    const wipUnits =
      clarityMode === "simple"
        ? arch === "B2B_ENTERPRISE_SERVICES"
          ? `~${Math.round(wc.telemetry.littlesL)} projektia`
          : arch === "PLATFORM_RECURRING"
            ? `~${Math.round(wc.telemetry.littlesL)} tehtävää`
            : `~${Math.round(wc.telemetry.littlesL)} ${uomLabel}`
        : `${wc.telemetry.littlesL.toFixed(2)} batches`;

    const bomBreakdown = recipe
      ? recipe.inputs
          .map((inp) => {
            const it = state.catalog.items.find((i) => i.id === inp.itemId);
            return `${inp.qty} ${escapeHtml(it?.uom ?? "kpl")} ${escapeHtml(it?.name ?? inp.itemId)}`;
          })
          .join(" + ")
      : "";

    return `
      <div class="inspector-card">
        <div class="inspector-header">
          <div>
            <span class="tag tag-cyan">${escapeHtml(tagTitle)}</span>
            <h4>${escapeHtml(wc.name)}</h4>
          </div>
          <span class="tag ${wc.telemetry.utilization > 0.85 ? "tag-red" : "tag-green"}">${badgeText}</span>
        </div>
        <div class="inspector-grid">
          <div><label>${arrivalLabel}</label><strong>${arrivalUnits}</strong></div>
          <div><label>${waitLabel}</label><strong>${waitUnits}</strong></div>
          <div><label>${wipLabel}</label><strong>${wipUnits}</strong></div>
          <div><label>${clarityMode === "simple" ? "Aukiolo / Palvelutunnit" : "Daily Capacity Hours"}</label><strong><button type="button" class="assumption-pill" data-assumption-key="service_capacity" title="Klikkaa muokataksesi palvelutunteja ja kapasiteettia">${wc.laborHoursPerDay} h/pv${capMark}</button></strong></div>
        </div>
        ${
          recipe
            ? `<div style="padding:8px 10px;background:#0f172a;border:1px solid #1e293b;border-radius:6px;margin:8px 0;font-size:12px;color:#cbd5e1">
                <strong>${clarityMode === "simple" ? "⚙️ Valmistusresepti & Annosketju:" : "⚙️ Production BOM Recipe:"}</strong>
                <span> ${bomBreakdown ? `${bomBreakdown} ➔ ` : ""}<b>${recipe.outputQty} ${escapeHtml(outItem?.uom ?? "kpl")} ${escapeHtml(outItem?.name ?? recipe.name)}</b> (${clarityMode === "simple" ? `Yksikön omakustannus <button type="button" class="assumption-pill" data-assumption-key="raw_cost_1">~${fmtCurrencyPrecise(outItem?.standardCost ?? 0)}${raw1Mark}</button>` : `Std Cost ${fmtCurrencyPrecise(outItem?.standardCost ?? 0)}`})</span>
              </div>`
            : ""
        }
        <div class="inspector-actions">
          <button type="button" class="btn btn-sm btn-secondary" data-assumption-key="service_capacity">
            ✏️ Muokkaa aukioloa / kapasiteettia (${capMark})
          </button>
          <button class="btn btn-sm btn-primary" data-action='{"type":"SET_OVERTIME","workCenterId":"${wc.id}","hoursPerDay":${Math.min(wc.maxOvertimeHoursPerDay, wc.overtimeHoursPerDay + 4)}}'>
            ${clarityMode === "simple" ? `${nl?.addCapacityActionLabel || "Pidennä aukioloa +4h"} (Nyt ${wc.overtimeHoursPerDay}h)` : `Overtime +4h/d (Now ${wc.overtimeHoursPerDay}h)`}
          </button>
          <button class="btn btn-sm btn-secondary" data-action='{"type":"CAPEX_UPGRADE","targetKind":"work_center","targetId":"${wc.id}","upgrade":"capacity","amount":4500000,"financing":"equipment_loan"}'>
            ${clarityMode === "simple" ? (arch === "B2B_ENTERPRISE_SERVICES" ? "Palkkaa kokenut asiantuntija (+22% tehoa)" : arch === "PLATFORM_RECURRING" ? "Laajenna kehitystiimiä (+22% tehoa)" : "Lisää tiski- / laitekapasiteettia (+22% tehoa)") : "Expand Line +22% ($45k Loan)"}
          </button>
          <button class="btn btn-sm btn-secondary" data-action='{"type":"SET_WORK_CENTER_SOURCING","workCenterId":"${wc.id}","sourcing":"${nextSourcing}"}'>
            ${clarityMode === "simple" ? `Vaihda toimintatapa (${nextSourcing === "insourced" ? "Oma työ" : "Alihankinta"})` : `Switch to ${nextSourcing.toUpperCase()}`}
          </button>
        </div>
      </div>
    `;
  }

  if (selected.kind === "channel") {
    const ch =
      state.commercial.channels.find((c) => c.id === selected!.id) ??
      state.commercial.channels[0];
    if (!ch) return "";
    const off = state.commercial.offerings.find((o) => o.channelId === ch.id);
    const ost = off
      ? state.commercial.offeringStates.find((s) => s.offeringId === off.id)
      : undefined;
    const item = off ? state.catalog.items.find((i) => i.id === off.itemId) : undefined;
    const curPrice = ost?.lastPrice ?? 100_00;
    const unitCost = item?.standardCost ?? Math.round(curPrice * 0.35);
    const feeCost = Math.round(curPrice * ch.feePct);
    const unitProfit = curPrice - unitCost - feeCost;
    const unitMarginPct = curPrice > 0 ? unitProfit / curPrice : 0;
    const upPrice = Math.round(curPrice * 1.06);
    const downPrice = Math.max(100, Math.round(curPrice * 0.94));
    const priceMark = markTag(state, "selling_price");
    const costMark = markTag(state, "raw_cost_1");

    const tagTitle = (clarityMode === "simple" && nl?.channelTag) || (clarityMode === "simple" ? "MYYNTIKANAVA & HINNOITTELU" : "COMMERCIAL CHANNEL");
    const badgeText = clarityMode === "simple"
      ? ch.paymentTermsDays === 0 ? "Korttimaksu & käteinen" : `Lasku ${ch.paymentTermsDays} pv`
      : `Net ${ch.paymentTermsDays}d`;

    return `
      <div class="inspector-card">
        <div class="inspector-header">
          <div>
            <span class="tag tag-cyan">${escapeHtml(tagTitle)}</span>
            <h4>${escapeHtml(ch.name)}</h4>
          </div>
          <span class="tag tag-blue">${badgeText}</span>
        </div>
        <div class="inspector-grid">
          <div><label>${clarityMode === "simple" ? "Tuote / Palvelu" : "Offering"}</label><strong>${escapeHtml(off?.name ?? "N/A")}</strong></div>
          <div><label>${clarityMode === "simple" ? "Myyntihinta / kpl" : "Realized Unit Price"}</label><strong><button type="button" class="assumption-pill" data-assumption-key="selling_price" title="Klikkaa muokataksesi myyntihintaa ja tutkiaksesi sen sidonnaisuuksia">${fmtCurrencyPrecise(curPrice)}${priceMark}</button></strong></div>
          <div><label>${clarityMode === "simple" ? "Yksikkökate (Hinta − Raaka-aineet)" : "Unit Contribution Margin"}</label><strong class="${unitProfit >= 0 ? "text-green" : "text-red"}">+${fmtCurrencyPrecise(unitProfit)} (${fmtPct(unitMarginPct, 0)})</strong></div>
          <div><label>${clarityMode === "simple" ? "Kuukauden myyntituotto" : "MTD Revenue"}</label><strong>${fmtCurrency(ost?.revenueMtd ?? 0)} (${fmtNum(ost?.shippedUnitsMtd ?? 0)} ${escapeHtml(item?.uom ?? "kpl")})</strong></div>
        </div>
        <div style="padding:8px 10px;background:#0f172a;border:1px solid #1e293b;border-radius:6px;margin:8px 0;font-size:12px;color:#cbd5e1">
          <strong>${clarityMode === "simple" ? "💡 Yksikkötalouden läpileikkaus & sidonnaisuudet:" : "💡 Unit Economics Breakdown:"}</strong>
          <span>
            ${
              clarityMode === "simple"
                ? `Asiakas maksaa <button type="button" class="assumption-pill" data-assumption-key="selling_price">${fmtCurrencyPrecise(curPrice)}${priceMark}</button> − Raaka-aine & valmistus <button type="button" class="assumption-pill" data-assumption-key="raw_cost_1">${fmtCurrencyPrecise(unitCost)}${costMark}</button> − Maksupääte/kanavakulu <b>${fmtCurrencyPrecise(feeCost)}</b> = Sinulle jää käteen <b>${fmtCurrencyPrecise(unitProfit)} / ${escapeHtml(item?.uom ?? "kpl")}</b>.`
                : `Price ${fmtCurrencyPrecise(curPrice)} − Std COGS ${fmtCurrencyPrecise(unitCost)} − Channel Fee ${fmtCurrencyPrecise(feeCost)} = Contribution ${fmtCurrencyPrecise(unitProfit)}/u.`
            }
          </span>
        </div>
        ${
          off
            ? `<div class="inspector-actions">
                <button type="button" class="btn btn-sm btn-secondary" data-assumption-key="selling_price">
                  ✏️ Muokkaa myyntihintaa & sidonnaisuuksia (${priceMark})
                </button>
                <button class="btn btn-sm btn-primary" data-price-shift="${off.id}:1.06">
                  ${clarityMode === "simple" ? `📈 Nosta hintaa +6% (${fmtCurrencyPrecise(upPrice)})` : `Raise Price +6% (${fmtCurrency(upPrice)})`}
                </button>
                <button class="btn btn-sm btn-secondary" data-price-shift="${off.id}:0.94">
                  ${clarityMode === "simple" ? `📉 Laske hintaa -6% (${fmtCurrencyPrecise(downPrice)})` : `Cut Price -6% (${fmtCurrency(downPrice)})`}
                </button>
                <button class="btn btn-sm btn-secondary" data-tab="financials">
                  ${clarityMode === "simple" ? "💰 Avaa tuloslaskelma & kassavirta →" : "Open 3-Statement P&L →"}
                </button>
              </div>`
            : ""
        }
      </div>
    `;
  }

  if (selected.kind === "segment") {
    const seg =
      state.market.segments.find((s) => s.id === selected!.id) ?? state.market.segments[0];
    if (!seg) return "";
    const pres = state.market.presence.find((p) => p.segmentId === seg.id);
    const mkt = state.commercial.marketing.find((m) => m.targetSegmentIds.includes(seg.id)) ?? state.commercial.marketing[0];
    const compPrices = state.market.competitors
      .filter((c) => !c.bankrupt)
      .map((c) => c.offerings.find((o) => o.segmentId === seg.id)?.price ?? c.offerings[0]?.price ?? 0)
      .filter((p) => p > 0);
    const avgCompPrice =
      compPrices.length > 0
        ? Math.round(compPrices.reduce((s, p) => s + p, 0) / compPrices.length)
        : seg.wtpMean;

    const tagTitle = (clarityMode === "simple" && nl?.segmentTag) || (clarityMode === "simple" ? "ASIAKASKUNTA, ASIAKASVIRTA & MARKKINOINTI" : "CUSTOMER SEGMENT");
    const badgeText = clarityMode === "simple"
      ? `Markkinaosuus ${fmtPct(pres?.marketShare ?? 0, 1)}`
      : `Share ${fmtPct(pres?.marketShare ?? 0, 1)}`;
    const potential = Math.round(pres?.potentialToday ?? seg.baseDailyDemand);
    const capturedPerDay = Math.round(potential * (pres?.marketShare ?? 0.25));
    const demMark = markTag(state, "daily_demand");
    const wtpMark = markTag(state, "customer_wtp");
    const compMark = markTag(state, "competitor_price");
    const mktMark = markTag(state, "marketing_budget");

    return `
      <div class="inspector-card">
        <div class="inspector-header">
          <div>
            <span class="tag tag-cyan">${escapeHtml(tagTitle)}</span>
            <h4>${escapeHtml(seg.name)}</h4>
          </div>
          <span class="tag tag-green">${badgeText}</span>
        </div>
        <div class="inspector-grid">
          <div><label>${clarityMode === "simple" ? "Ohikulkijat / Kysyntäpotentiaali" : "Daily Segment Demand"}</label><strong><button type="button" class="assumption-pill" data-assumption-key="daily_demand" title="Klikkaa muokataksesi päivittäistä asiakasvirtaa">${fmtNum(potential)} ${clarityMode === "simple" ? "asiakasta/pv" : "u/d"}${demMark}</button></strong></div>
          <div><label>${clarityMode === "simple" ? "Meille ostamaan tulevat" : "Captured Daily Volume"}</label><strong class="text-cyan">~${fmtNum(capturedPerDay)} ${clarityMode === "simple" ? "ostajaa/pv" : "u/d"} (${fmtPct(pres?.marketShare ?? 0, 1)})</strong></div>
          <div><label>${clarityMode === "simple" ? "Maksuhalukkuus vs. Kilpailijat" : "WTP vs. Competitor Avg"}</label><strong><button type="button" class="assumption-pill" data-assumption-key="customer_wtp">${fmtCurrencyPrecise(seg.wtpMean)}${wtpMark}</button> vs. <button type="button" class="assumption-pill" data-assumption-key="competitor_price">${fmtCurrencyPrecise(avgCompPrice)}${compMark}</button></strong></div>
          <div><label>${clarityMode === "simple" ? "Tunnettuus & Vetovoima" : "Brand / Awareness"}</label><strong>${fmtPct(pres?.awareness ?? 0, 0)} • Brändi ${fmtPct(pres?.brandEquity ?? 0, 0)}</strong></div>
        </div>
        ${
          mkt
            ? `<div style="padding:8px 10px;background:#0f172a;border:1px solid #1e293b;border-radius:6px;margin:8px 0;font-size:12px;color:#cbd5e1">
                <strong>📣 ${clarityMode === "simple" ? `Aktiivinen markkinointikampanja (${escapeHtml(mkt.name)}):` : `Active Marketing Engine (${escapeHtml(mkt.name)}):`}</strong>
                <span> ${clarityMode === "simple" ? `Panostat nyt <button type="button" class="assumption-pill" data-assumption-key="marketing_budget">${fmtCurrency(mkt.dailyBudget)}/päivä${mktMark}</button>. Se kasvattaa alueellista tunnettuutta (${fmtPct(pres?.awareness ?? 0, 0)}) ja tuo uusia asiakkaita luukulle.` : `Spend ${fmtCurrency(mkt.dailyBudget)}/d • Awareness ${fmtPct(pres?.awareness ?? 0, 1)}.`}</span>
              </div>
              <div class="inspector-actions">
                <button type="button" class="btn btn-sm btn-secondary" data-assumption-key="daily_demand">
                  ✏️ Muokkaa asiakasvirtaa (${demMark})
                </button>
                <button class="btn btn-sm btn-primary" data-action='{"type":"SET_MARKETING_BUDGET","channelId":"${mkt.id}","dailyBudget":${Math.round(mkt.dailyBudget * 1.35)}}'>
                  ${clarityMode === "simple" ? `📣 Lisää markkinointia +35% (${fmtCurrency(Math.round(mkt.dailyBudget * 1.35))}/pv)` : `Boost ${escapeHtml(mkt.name)} +35% (${fmtCurrency(Math.round(mkt.dailyBudget * 1.35))}/d)`}
                </button>
                <button class="btn btn-sm btn-secondary" data-action='{"type":"SET_MARKETING_BUDGET","channelId":"${mkt.id}","dailyBudget":${Math.max(1000, Math.round(mkt.dailyBudget * 0.7))}}'>
                  ${clarityMode === "simple" ? `Säästä markkinoinnissa -30% (${fmtCurrency(Math.max(1000, Math.round(mkt.dailyBudget * 0.7)))}/pv)` : `Trim Spend -30%`}
                </button>
              </div>`
            : ""
        }
      </div>
    `;
  }

  // Fallback for lane node
  const lane = state.supply.lanes.find((l) => l.id === selected!.id) ?? state.supply.lanes[0];
  const laneModeLabel =
    clarityMode === "simple"
      ? lane?.mode === "parcel"
        ? "Paketti / Pientoimitus"
        : lane?.mode === "lcl"
          ? "Nouto tukusta"
          : lane?.mode === "van"
            ? "Jakeluauto"
            : "Kuljetus"
      : lane?.mode.toUpperCase() ?? "FTL";
  const laneTagTitle = (clarityMode === "simple" && nl?.inboundTag) || (clarityMode === "simple" ? "KULJETUS & LOGISTIIKKA" : "FREIGHT LANE");
  const openPosOnLane = state.supply.purchaseOrders.filter(
    (p) => p.laneId === lane?.id && p.status !== "received" && p.status !== "cancelled",
  );

  return `
    <div class="inspector-card">
      <div class="inspector-header">
        <div>
          <span class="tag tag-cyan">${escapeHtml(laneTagTitle)}</span>
          <h4>${escapeHtml(lane?.name ?? "Logistics Lane")}</h4>
        </div>
        <span class="tag tag-blue">${escapeHtml(laneModeLabel)}</span>
      </div>
      <div class="inspector-grid">
        <div><label>${clarityMode === "simple" ? "Reitti" : "Route"}</label><strong>${escapeHtml(lane?.origin ?? "")} → ${escapeHtml(lane?.destination ?? "")}</strong></div>
        <div><label>${clarityMode === "simple" ? "Kuljetuskustannus" : "Cost / m³ + Fixed"}</label><strong>${clarityMode === "simple" ? `${fmtCurrency(lane?.fixedCostPerShipment ?? 0)} / toimitus` : `${fmtCurrency(lane?.costPerM3 ?? 0)}/m³ + ${fmtCurrency(lane?.fixedCostPerShipment ?? 0)}`}</strong></div>
        <div><label>${clarityMode === "simple" ? "Viivästysriski" : "Delay Probability"}</label><strong>${fmtPct(lane?.delayProb ?? 0, 1)}</strong></div>
        <div><label>${clarityMode === "simple" ? "Matkalla olevat tilaukset" : "Active Shipments"}</label><strong>${openPosOnLane.length} ${clarityMode === "simple" ? "kuormaa" : "POs"}</strong></div>
      </div>
    </div>
  `;
}

function fmtCurrencyPreciseOrStd(cents: number): string {
  return fmtCurrencyPrecise(cents);
}

