/**
 * APEX Flow — päivätason kassasimulaatio (`src/flow/kernel/simulate.ts`).
 *
 * Simuloi molekyylin rahavirrat päivä päivältä:
 * - myynti kirjataan saamiseksi ja raha saapuu kassaan maksuajan päästä,
 * - muuttuvat kulut kirjataan ostoveloiksi ja maksetaan toimittajan maksuajan päästä,
 * - kiinteät kulut ja palkat maksetaan omana maksupäivänään,
 * - fyysinen aloitusvarasto ostetaan päivänä 0 (raha sitoutuu varastoon),
 * - kausivaihtelu ja tapahtumat muuttavat kunkin kuukauden lukuja (events.ts).
 *
 * Simulaatio on deterministinen: samasta molekyylistä tulee aina sama tulos.
 */
import type {
  AtomEconomics,
  AtomMonthStats,
  DayPoint,
  FixedCost,
  Molecule,
  MonthResult,
  PhysicalMatterAtom,
  RecurringSubAtom,
  SimulationResult,
  TimeCapacityAtom,
} from "./types.ts";
import { DAYS_PER_MONTH } from "./types.ts";
import { atomEconomics, physicalOpeningInventory, resolvePaymentTerms, timePayrollPerMonth } from "./atoms.ts";
import { applyStress } from "./stress.ts";
import { monthModifier } from "./events.ts";

const clampDay = (d: number): number => Math.min(DAYS_PER_MONTH, Math.max(1, Math.round(d || 1)));
const nonNeg = (n: number): number => (Number.isFinite(n) && n > 0 ? n : 0);
const clamp01 = (n: number): number => Math.min(1, Math.max(0, Number.isFinite(n) ? n : 0));

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
  const physAtoms = active.filter((a): a is PhysicalMatterAtom => a.kind === "PHYSICAL_MATTER");
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

  // Kuukauden tila (päivitetään kunkin kuukauden alussa).
  let econ = new Map<string, AtomEconomics>();
  let monthFixedCosts: FixedCost[] = molecule.fixedCosts;
  let monthTimeAtoms: TimeCapacityAtom[] = [];
  let monthMeta = { calendarMonth: 0, seasonFactor: 1, activeEvents: [] as string[] };
  const subscribers = new Map<string, number>();

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

  const startMonth = (month: number, day: number): void => {
    mRevenue = 0;
    mVariable = 0;
    mFixed = 0;
    mByAtom = {};
    for (const a of active) mByAtom[a.id] = { revenue: 0, variableCosts: 0, volume: 0 };
    const mod = monthModifier(molecule, month);
    const monthMol = applyStress(molecule, mod.stress);
    const monthActive = monthMol.atoms.filter((a) => a.enabled);
    econ = new Map(monthActive.map((a) => [a.id, atomEconomics(a, monthMol)]));
    monthFixedCosts = monthMol.fixedCosts;
    monthTimeAtoms = monthActive.filter((a): a is TimeCapacityAtom => a.kind === "TIME_CAPACITY");
    monthMeta = { calendarMonth: mod.calendarMonth, seasonFactor: mod.seasonFactor, activeEvents: mod.activeEvents.map((e) => e.title) };

    // Tapahtumien kertakulut.
    payFixedNow(mod.oneOffCost);

    // Tilaukset laskutetaan kuun alussa, uusien asiakkaiden hankinta maksetaan heti.
    for (const a of monthActive) {
      if (a.kind !== "RECURRING_SUB") continue;
      const base = molecule.atoms.find((b) => b.id === a.id) as RecurringSubAtom;
      const add = nonNeg(a.newPerMonth);
      const prev = subscribers.get(a.id);
      const subs = prev === undefined ? nonNeg(base.startingSubscribers) + add : prev * (1 - clamp01(a.churnRateMonthly)) + add;
      subscribers.set(a.id, subs);
      mByAtom[a.id].volume = subs;
      sell(a.id, day, subs * nonNeg(a.pricePerMonth));
      variableCost(a.id, day, subs * nonNeg(a.costPerSubscriberMonth));
      const cac = add * nonNeg(a.cacPerNew);
      cash -= cac;
      mVariable += cac;
      mByAtom[a.id].variableCosts += cac;
    }
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

    if (dom === 1) startMonth(month, d);

    // Päivittäinen myynti: fyysinen tavara ja tiskikauppa.
    for (const [id, e] of econ) {
      if (e.kind !== "PHYSICAL_MATTER" && e.kind !== "TRANSACTIONAL_TRADE") continue;
      const perDay = e.volume / DAYS_PER_MONTH;
      mByAtom[id].volume += perDay;
      sell(id, d, perDay * e.unitPrice);
      variableCost(id, d, perDay * e.unitVariableCost);
    }

    // Kiinteät kulut omana maksupäivänään.
    for (const c of monthFixedCosts) {
      if (clampDay(c.dayOfMonth) === dom) payFixedNow(nonNeg(c.amountPerMonth));
    }
    // Palkat.
    if (dom === payrollDay) {
      for (const a of monthTimeAtoms) payFixedNow(timePayrollPerMonth(a));
    }

    // Kuukauden lopussa aika-atomit laskuttavat tehdyt tunnit.
    if (dom === DAYS_PER_MONTH) {
      for (const a of monthTimeAtoms) {
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
        calendarMonth: monthMeta.calendarMonth,
        seasonFactor: monthMeta.seasonFactor,
        activeEvents: monthMeta.activeEvents,
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
