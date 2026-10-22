/**
 * APEX Studio — näkymämalli (`src/flow/model/view.ts`).
 *
 * Muuntaa molekyylin ja simulaation enintään viideksi pääsolmuksi ja kolmeksi
 * selkokieliseksi pääluvuksi. Kaikki syvempi tieto avautuu solmua klikkaamalla.
 */
import type { AtomEconomics, Molecule, SimulationResult } from "../kernel/types.ts";
import { DAYS_PER_MONTH } from "../kernel/types.ts";
import { moleculeEconomics, totalFixedCostsPerMonth } from "../kernel/atoms.ts";
import { simulate } from "../kernel/simulate.ts";
import { breakEven, type BreakEvenResult } from "../kernel/sensitivity.ts";
import { hasMonthlyVariation } from "../kernel/events.ts";
import { eur, int, money, num, pct } from "./format.ts";
import { t } from "../i18n/index.ts";

export type NodeId = "demand" | "capacity" | "receivables" | "cash" | "costs";
export type NodeStatus = "ok" | "warn" | "alert" | "idle";

export interface FlowNodeView {
  id: NodeId;
  title: string;
  value: string;
  sub: string;
  status: NodeStatus;
}

export interface Headline {
  label: string;
  value: string;
  sub: string;
  status: NodeStatus;
}

export interface FlowView {
  molecule: Molecule;
  econ: AtomEconomics[];
  sim: SimulationResult;
  be: BreakEvenResult;
  /** Tavallisen kuukauden luvut (ilman kausivaihtelua ja tapahtumia). */
  monthlyRevenue: number;
  monthlyVariable: number;
  monthlyFixed: number;
  /** Ensimmäisen kuukauden tulos simulaatiosta. */
  firstMonthProfit: number;
  lastMonthProfit: number;
  headlines: Headline[];
  nodes: FlowNodeView[];
  /** Pahin pullonkaula: atomi, jonka kysyntä / kapasiteetti on suurin. */
  bottleneck: AtomEconomics | null;
  hasInvoicing: boolean;
  isEmpty: boolean;
  /** Onko mallissa kausivaihtelua tai tapahtumia. */
  varies: boolean;
}

/** Yksikön näyttöteksti (atomien yksiköt ovat käännösavaimia). */
export function unit(e: AtomEconomics): string {
  return t(e.volumeUnit);
}

function worstBottleneck(econ: AtomEconomics[]): AtomEconomics | null {
  let worst: AtomEconomics | null = null;
  for (const e of econ) {
    if (e.bottleneckRatio === null) continue;
    if (worst === null || e.bottleneckRatio > (worst.bottleneckRatio ?? 0)) worst = e;
  }
  return worst;
}

export function buildView(molecule: Molecule): FlowView {
  const econ = moleculeEconomics(molecule);
  const sim = simulate(molecule);
  const be = breakEven(molecule);
  const monthlyRevenue = econ.reduce((s, e) => s + e.revenuePerMonth, 0);
  const monthlyVariable = econ.reduce((s, e) => s + e.variableCostPerMonth, 0);
  const monthlyFixed = totalFixedCostsPerMonth(molecule);
  const first = sim.months[0];
  const last = sim.months[sim.months.length - 1];
  const firstMonthProfit = first ? first.operatingProfit : 0;
  const lastMonthProfit = last ? last.operatingProfit : 0;
  const bottleneck = worstBottleneck(econ);
  const hasInvoicing = econ.some((e) => e.paymentTermsDays >= 7);
  const isEmpty = econ.length === 0;
  const varies = hasMonthlyVariation(molecule);

  // --- Pääluvut ---
  const profits = sim.months.map((m) => m.operatingProfit);
  const minProfit = Math.min(...profits);
  const maxProfit = Math.max(...profits);
  const profitGrows = Math.abs(lastMonthProfit - firstMonthProfit) > Math.max(50, Math.abs(firstMonthProfit) * 0.05);
  let profitSub = t("myynti − kulut, ennen veroja");
  if (varies && maxProfit - minProfit > 50) profitSub = t("vaihtelee kuukausittain: {min} … {max}", { min: money(minProfit), max: money(maxProfit) });
  else if (profitGrows) profitSub = t("12. kuukautena {amount}", { amount: money(lastMonthProfit) });
  const profitHeadline: Headline = {
    label: t("Kuussa jää käteen"),
    value: money(firstMonthProfit),
    sub: profitSub,
    status: firstMonthProfit >= 0 ? "ok" : "alert",
  };
  const cashHeadline: Headline =
    sim.cashOutDay === null
      ? {
          label: t("Kassa"),
          value: t("Riittää"),
          sub: t("pienimmillään {amount} (päivä {day})", { amount: money(sim.minCash), day: sim.minCashDay + 1 }),
          status: sim.minCash < monthlyFixed * 0.5 ? "warn" : "ok",
        }
      : {
          label: t("Kassa loppuu"),
          value: t("päivänä {day}", { day: sim.cashOutDay + 1 }),
          sub: t("pohja {amount} päivänä {day}", { amount: money(sim.minCash), day: sim.minCashDay + 1 }),
          status: "alert",
        };
  let beHeadline: Headline;
  if (!isEmpty && monthlyFixed <= 0) {
    beHeadline = { label: t("Kannattavuusraja"), value: t("Ei kiinteitä kuluja"), sub: t("lisää oma palkka, tilat ja muut kulut"), status: "warn" };
  } else if (be.breakEvenVolume) {
    const u = t(be.breakEvenVolume.unit);
    beHeadline = {
      label: t("Kannattavuusraja"),
      value: t("{n} {unit} / kk", { n: int(be.breakEvenVolume.volume), unit: u }),
      sub:
        be.breakEvenWithinCapacity === false
          ? t("ei mahdu nykyiseen kapasiteettiin")
          : t("nyt {n} {unit} / kk", { n: int(econ[0].volume), unit: u }),
      status: be.breakEvenWithinCapacity === false ? "alert" : (be.marginOfSafety ?? -1) < 0.15 ? "warn" : "ok",
    };
  } else if (be.breakEvenRevenuePerMonth !== null) {
    beHeadline = {
      label: t("Kannattavuusraja"),
      value: t("{amount} / kk", { amount: money(be.breakEvenRevenuePerMonth) }),
      sub: t("myynti nyt {amount} / kk", { amount: money(monthlyRevenue) }),
      status: (be.marginOfSafety ?? -1) < 0 ? "alert" : (be.marginOfSafety ?? 0) < 0.15 ? "warn" : "ok",
    };
  } else {
    beHeadline = { label: t("Kannattavuusraja"), value: t("Ei saavutettavissa"), sub: t("myyntikate on nolla tai negatiivinen"), status: "alert" };
  }

  // --- Solmut ---
  const demandNode: FlowNodeView = {
    id: "demand",
    title: t("Kysyntä"),
    value: t("{amount} / kk", { amount: money(monthlyRevenue) }),
    sub:
      econ.length === 1
        ? `${int(econ[0].volume)} ${unit(econ[0])} × ${eur(econ[0].unitPrice)}`
        : t("{n} tulovirtaa", { n: econ.length }),
    status: isEmpty ? "idle" : "ok",
  };

  let capacityNode: FlowNodeView;
  if (!bottleneck) {
    capacityNode = { id: "capacity", title: t("Toimituskyky"), value: t("Ei rajaa"), sub: t("kapasiteettia ei ole rajattu"), status: isEmpty ? "idle" : "ok" };
  } else {
    const ratio = bottleneck.bottleneckRatio ?? 0;
    capacityNode = {
      id: "capacity",
      title: t("Toimituskyky"),
      value: t("{pct} käytössä", { pct: pct(Math.min(ratio, 1)) }),
      sub: bottleneck.demandAssumed
        ? t("oletus: kysyntää riittää")
        : bottleneck.lostDemand > 0
          ? t("{n} {unit} jää myymättä", { n: int(bottleneck.lostDemand), unit: unit(bottleneck) })
          : bottleneck.idleCapacity > 0
            ? t("{n} {unit} vapaana", { n: num(bottleneck.idleCapacity), unit: unit(bottleneck) })
            : t("täsmälleen täynnä"),
      status: bottleneck.demandAssumed ? "ok" : ratio > 1 ? "alert" : ratio > 0.9 ? "warn" : "ok",
    };
  }

  const receivablesNow = sim.days.length > 0 ? Math.max(...sim.days.slice(0, DAYS_PER_MONTH * 3).map((d) => d.receivables)) : 0;
  const maxTerms = econ.reduce((m, e) => Math.max(m, e.paymentTermsDays), 0);
  const receivablesNode: FlowNodeView = {
    id: "receivables",
    title: t("Rahat matkalla"),
    value: hasInvoicing ? t("{n} pv viive", { n: maxTerms }) : t("Heti kassaan"),
    sub: hasInvoicing ? t("enint. {amount} odottaa", { amount: money(receivablesNow) }) : t("kortti- ja käteismaksut"),
    status: sim.cashOutDay !== null && hasInvoicing ? "alert" : maxTerms > 30 ? "warn" : "ok",
  };

  const cashNode: FlowNodeView = { id: "cash", title: t("Kassa"), value: money(sim.endCash), sub: t("12 kk päästä"), status: cashHeadline.status };

  const costsNode: FlowNodeView = {
    id: "costs",
    title: t("Kulut"),
    value: t("{amount} / kk", { amount: money(monthlyFixed + monthlyVariable) }),
    sub: monthlyVariable > 0.5 ? t("kiinteät {amount} + muuttuvat", { amount: money(monthlyFixed) }) : t("kaikki kiinteitä"),
    status: firstMonthProfit < 0 ? "warn" : "ok",
  };

  return {
    molecule,
    econ,
    sim,
    be,
    monthlyRevenue,
    monthlyVariable,
    monthlyFixed,
    firstMonthProfit,
    lastMonthProfit,
    headlines: [profitHeadline, cashHeadline, beHeadline],
    nodes: [demandNode, capacityNode, receivablesNode, cashNode, costsNode],
    bottleneck,
    hasInvoicing,
    isEmpty,
    varies,
  };
}
