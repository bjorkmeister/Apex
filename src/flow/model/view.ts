/**
 * APEX Flow — näkymämalli (`src/flow/model/view.ts`).
 *
 * Muuntaa molekyylin ja simulaation enintään viideksi pääsolmuksi ja kolmeksi
 * selkokieliseksi pääluvuksi. Kaikki syvempi tieto avautuu solmua klikkaamalla.
 */
import type { AtomEconomics, Molecule, SimulationResult } from "../kernel/types.ts";
import { DAYS_PER_MONTH } from "../kernel/types.ts";
import { moleculeEconomics, totalFixedCostsPerMonth } from "../kernel/atoms.ts";
import { simulate } from "../kernel/simulate.ts";
import { breakEven, type BreakEvenResult } from "../kernel/sensitivity.ts";
import { eur, int, money, num, pct } from "./format.ts";

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
  monthlyRevenue: number;
  monthlyVariable: number;
  monthlyFixed: number;
  /** Ensimmäisen kuukauden tulos (tilausatomeilla tulos muuttuu kuukausittain). */
  firstMonthProfit: number;
  lastMonthProfit: number;
  headlines: Headline[];
  nodes: FlowNodeView[];
  /** Pahin pullonkaula: atomi, jonka kysyntä / kapasiteetti on suurin. */
  bottleneck: AtomEconomics | null;
  hasInvoicing: boolean;
  isEmpty: boolean;
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

  // --- Pääluvut ---
  const profitGrows = Math.abs(lastMonthProfit - firstMonthProfit) > Math.max(50, Math.abs(firstMonthProfit) * 0.05);
  const profitHeadline: Headline = {
    label: "Kuussa jää käteen",
    value: money(firstMonthProfit),
    sub: profitGrows ? `12. kuukautena ${money(lastMonthProfit)}` : "myynti − kulut, ennen veroja",
    status: firstMonthProfit >= 0 ? "ok" : "alert",
  };
  const cashHeadline: Headline =
    sim.cashOutDay === null
      ? {
          label: "Kassa",
          value: "Riittää",
          sub: `pienimmillään ${money(sim.minCash)} (päivä ${sim.minCashDay + 1})`,
          status: sim.minCash < monthlyFixed * 0.5 ? "warn" : "ok",
        }
      : {
          label: "Kassa loppuu",
          value: `päivänä ${sim.cashOutDay + 1}`,
          sub: `pohja ${money(sim.minCash)} päivänä ${sim.minCashDay + 1}`,
          status: "alert",
        };
  let beHeadline: Headline;
  if (be.breakEvenVolume) {
    const unitWord = be.breakEvenVolume.unit;
    beHeadline = {
      label: "Kannattavuusraja",
      value: `${int(be.breakEvenVolume.volume)} ${unitWord} / kk`,
      sub:
        be.breakEvenWithinCapacity === false
          ? "ei mahdu nykyiseen kapasiteettiin"
          : `nyt ${int(econ[0].volume)} ${unitWord} / kk`,
      status: be.breakEvenWithinCapacity === false ? "alert" : (be.marginOfSafety ?? -1) < 0.15 ? "warn" : "ok",
    };
  } else if (be.breakEvenRevenuePerMonth !== null) {
    beHeadline = {
      label: "Kannattavuusraja",
      value: `${money(be.breakEvenRevenuePerMonth)} / kk`,
      sub: `myynti nyt ${money(monthlyRevenue)} / kk`,
      status: (be.marginOfSafety ?? -1) < 0 ? "alert" : (be.marginOfSafety ?? 0) < 0.15 ? "warn" : "ok",
    };
  } else {
    beHeadline = {
      label: "Kannattavuusraja",
      value: "Ei saavutettavissa",
      sub: "myyntikate on nolla tai negatiivinen",
      status: "alert",
    };
  }

  // --- Solmut ---
  const demandTotal = econ.reduce((s, e) => s + e.revenuePerMonth, 0);
  const demandNode: FlowNodeView = {
    id: "demand",
    title: "Kysyntä",
    value: `${money(demandTotal)} / kk`,
    sub: econ.length === 1 ? `${int(econ[0].volume)} ${econ[0].volumeUnit} × ${eur(econ[0].unitPrice)}` : `${econ.length} tulovirtaa`,
    status: isEmpty ? "idle" : "ok",
  };

  let capacityNode: FlowNodeView;
  if (!bottleneck) {
    capacityNode = { id: "capacity", title: "Toimituskyky", value: "Ei rajaa", sub: "kapasiteettia ei ole rajattu", status: isEmpty ? "idle" : "ok" };
  } else {
    const ratio = bottleneck.bottleneckRatio ?? 0;
    const usage = Math.min(ratio, 1);
    capacityNode = {
      id: "capacity",
      title: "Toimituskyky",
      value: `${pct(usage)} käytössä`,
      sub: bottleneck.demandAssumed
        ? "oletus: kysyntää riittää"
        : bottleneck.lostDemand > 0
          ? `${int(bottleneck.lostDemand)} ${bottleneck.volumeUnit} jää myymättä`
          : bottleneck.idleCapacity > 0
            ? `${num(bottleneck.idleCapacity)} ${bottleneck.volumeUnit} vapaana`
            : "täsmälleen täynnä",
      status: bottleneck.demandAssumed ? "ok" : ratio > 1 ? "alert" : ratio > 0.9 ? "warn" : "ok",
    };
  }

  const receivablesNow = sim.days.length > 0 ? Math.max(...sim.days.slice(0, DAYS_PER_MONTH * 3).map((d) => d.receivables)) : 0;
  const maxTerms = econ.reduce((m, e) => Math.max(m, e.paymentTermsDays), 0);
  const receivablesNode: FlowNodeView = {
    id: "receivables",
    title: "Rahat matkalla",
    value: hasInvoicing ? `${maxTerms} pv viive` : "Heti kassaan",
    sub: hasInvoicing ? `enint. ${money(receivablesNow)} odottaa` : "kortti- ja käteismaksut",
    status: sim.cashOutDay !== null && hasInvoicing ? "alert" : maxTerms > 30 ? "warn" : "ok",
  };

  const cashNode: FlowNodeView = {
    id: "cash",
    title: "Kassa",
    value: money(sim.endCash),
    sub: "12 kk päästä",
    status: cashHeadline.status,
  };

  const costsNode: FlowNodeView = {
    id: "costs",
    title: "Kulut",
    value: `${money(monthlyFixed + monthlyVariable)} / kk`,
    sub: monthlyVariable > 0.5 ? `kiinteät ${money(monthlyFixed)} + muuttuvat` : "kaikki kiinteitä",
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
  };
}
