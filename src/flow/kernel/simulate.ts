/**
 * APEX Flow — päivätason kassasimulaatio (`src/flow/kernel/simulate.ts`).
 *
 * Simuloi molekyylin rahavirrat päivä päivältä:
 * - myynti kirjataan saamiseksi ja raha saapuu kassaan maksuajan päästä,
 * - muuttuvat kulut kirjataan ostoveloiksi ja maksetaan toimittajan maksuajan päästä,
 * - kiinteät kulut ja palkat maksetaan omana maksupäivänään,
 * - fyysinen aloitusvarasto ostetaan päivänä 0 (raha sitoutuu varastoon).
 *
 * Simulaatio on deterministinen: samasta molekyylistä tulee aina sama tulos.
 */
import type {
  AtomMonthStats,
  DayPoint,
  Molecule,
  MonthResult,
  PhysicalMatterAtom,
  RecurringSubAtom,
  SimulationResult,
  TimeCapacityAtom,
  TransactionalTradeAtom,
} from "./types.ts";
import { DAYS_PER_MONTH } from "./types.ts";
import {
  atomEconomics,
  physicalOpeningInventory,
  resolvePaymentTerms,
  subscribersAtMonth,
  timePayrollPerMonth,
} from "./atoms.ts";

const clampDay = (d: number): number => Math.min(DAYS_PER_MONTH, Math.max(1, Math.round(d || 1)));
const nonNeg = (n: number): number => (Number.isFinite(n) && n > 0 ? n : 0);

class Schedule {
  private readonly amounts: number[] = [];
  add(day: number, amount: number): void {
    if (amount === 0) return;
    this.amounts[day] = (this.amounts[day] ?? 0) + amount;
  }
  take(day: number): number {
    const v = this.amounts[day] ?? 0;
    this.amounts[day] = 0;
    return v;
  }
}

export interface SimulateOptions {
  /** Ylikirjoittaa molekyylin tarkasteluajan (kuukausina). */
  horizonMonths?: number;
}

export function simulate(molecule: Molecule, options: SimulateOptions = {}): SimulationResult {
  const months = Math.max(1, Math.round(options.horizonMonths ?? molecule.horizonMonths ?? 12));
  const H = months * DAYS_PER_MONTH;
  const supplierTerms = Math.max(0, Math.round(molecule.credit.supplierTermsDays));
  const openingCash = Number.isFinite(molecule.credit.openingCash) ? molecule.credit.openingCash : 0;
  const payrollDay = clampDay(molecule.payrollDay);

  const active = molecule.atoms.filter((a) => a.enabled);
  const timeAtoms = active.filter((a): a is TimeCapacityAtom => a.kind === "TIME_CAPACITY");
  const physAtoms = active.filter((a): a is PhysicalMatterAtom => a.kind === "PHYSICAL_MATTER");
  const subAtoms = active.filter((a): a is RecurringSubAtom => a.kind === "RECURRING_SUB");
  const tradeAtoms = active.filter((a): a is TransactionalTradeAtom => a.kind === "TRANSACTIONAL_TRADE");

  const econ = new Map(active.map((a) => [a.id, atomEconomics(a, molecule)]));
  const terms = new Map(active.map((a) => [a.id, resolvePaymentTerms(a, molecule)]));

  const receipts = new Schedule();
  const payments = new Schedule();

  let cash = openingCash;
  let receivables = 0;
  let payables = 0;
  let inventory = 0;

  const days: DayPoint[] = [];
  const monthResults: MonthResult[] = [];

  let mRevenue = 0;
  let mVariable = 0;
  let mFixed = 0;
  let mByAtom: Record<string, AtomMonthStats> = {};
  const totals = { revenue: 0, variableCosts: 0, fixedCosts: 0, operatingProfit: 0 };

  const resetMonth = (): void => {
    mRevenue = 0;
    mVariable = 0;
    mFixed = 0;
    mByAtom = {};
    for (const a of active) mByAtom[a.id] = { revenue: 0, variableCosts: 0, volume: 0 };
  };
  resetMonth();

  const sell = (atomId: string, day: number, amount: number): void => {
    if (amount <= 0) return;
    receivables += amount;
    receipts.add(day + (terms.get(atomId) ?? 0), amount);
    mRevenue += amount;
    mByAtom[atomId].revenue += amount;
  };
  const buyOnCredit = (day: number, amount: number): void => {
    if (amount <= 0) return;
    payables += amount;
    payments.add(day + supplierTerms, amount);
  };
  const variableCost = (atomId: string, day: number, amount: number): void => {
    if (amount <= 0) return;
    buyOnCredit(day, amount);
    mVariable += amount;
    mByAtom[atomId].variableCosts += amount;
  };
  const payFixedNow = (amount: number): void => {
    if (amount <= 0) return;
    cash -= amount;
    mFixed += amount;
  };

  // Päivä 0: fyysinen aloitusvarasto ostetaan toimittajan maksuehdoilla.
  for (const a of physAtoms) {
    const stock = physicalOpeningInventory(a);
    inventory += stock;
    buyOnCredit(0, stock);
  }

  let minCash = cash;
  let minCashDay = 0;
  let cashOutDay: number | null = null;

  for (let d = 0; d < H; d += 1) {
    const dom = (d % DAYS_PER_MONTH) + 1;
    const month = Math.floor(d / DAYS_PER_MONTH);

    // Kuukauden alku: tilaukset laskutetaan, uusien asiakkaiden hankinta maksetaan.
    if (dom === 1) {
      for (const a of subAtoms) {
        const subs = subscribersAtMonth(a, month);
        mByAtom[a.id].volume = subs;
        sell(a.id, d, subs * nonNeg(a.pricePerMonth));
        variableCost(a.id, d, subs * nonNeg(a.costPerSubscriberMonth));
        const cac = nonNeg(a.newPerMonth) * nonNeg(a.cacPerNew);
        cash -= cac;
        mVariable += cac;
        mByAtom[a.id].variableCosts += cac;
      }
    }

    // Päivittäinen myynti: fyysinen tavara ja tiskikauppa.
    for (const a of physAtoms) {
      const e = econ.get(a.id)!;
      const unitsToday = e.volume / DAYS_PER_MONTH;
      mByAtom[a.id].volume += unitsToday;
      sell(a.id, d, unitsToday * e.unitPrice);
      variableCost(a.id, d, unitsToday * e.unitVariableCost);
    }
    for (const a of tradeAtoms) {
      const e = econ.get(a.id)!;
      const salesToday = e.volume / DAYS_PER_MONTH;
      mByAtom[a.id].volume += salesToday;
      sell(a.id, d, salesToday * e.unitPrice);
      variableCost(a.id, d, salesToday * e.unitVariableCost);
    }

    // Kiinteät kulut omana maksupäivänään.
    for (const c of molecule.fixedCosts) {
      if (clampDay(c.dayOfMonth) === dom) payFixedNow(nonNeg(c.amountPerMonth));
    }
    // Palkat.
    if (dom === payrollDay) {
      for (const a of timeAtoms) payFixedNow(timePayrollPerMonth(a));
    }

    // Kuukauden lopussa aika-atomit laskuttavat tehdyt tunnit.
    if (dom === DAYS_PER_MONTH) {
      for (const a of timeAtoms) {
        const e = econ.get(a.id)!;
        mByAtom[a.id].volume = e.volume;
        sell(a.id, d, e.revenuePerMonth);
        variableCost(a.id, d, e.variableCostPerMonth);
      }
    }

    // Saapuvat asiakasmaksut ja lähtevät toimittajamaksut.
    const inflow = receipts.take(d);
    cash += inflow;
    receivables -= inflow;
    const outflow = payments.take(d);
    cash -= outflow;
    payables -= outflow;

    days.push({ day: d, cash, receivables, payables, inventory });
    if (cash < minCash) {
      minCash = cash;
      minCashDay = d;
    }
    if (cashOutDay === null && cash < 0) cashOutDay = d;

    if (dom === DAYS_PER_MONTH) {
      const grossMargin = mRevenue - mVariable;
      const operatingProfit = grossMargin - mFixed;
      monthResults.push({
        month,
        revenue: mRevenue,
        variableCosts: mVariable,
        grossMargin,
        fixedCosts: mFixed,
        operatingProfit,
        endCash: cash,
        endReceivables: receivables,
        endPayables: payables,
        inventory,
        byAtom: mByAtom,
      });
      totals.revenue += mRevenue;
      totals.variableCosts += mVariable;
      totals.fixedCosts += mFixed;
      totals.operatingProfit += operatingProfit;
      resetMonth();
    }
  }

  const reconciliationError =
    cash - openingCash - (totals.operatingProfit - receivables + payables - inventory);

  return {
    horizonDays: H,
    days,
    months: monthResults,
    openingCash,
    endCash: cash,
    minCash,
    minCashDay,
    cashOutDay,
    totals,
    reconciliationError,
  };
}
