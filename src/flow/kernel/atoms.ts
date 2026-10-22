/**
 * APEX Flow — atomien kuukausitalous (`src/flow/kernel/atoms.ts`).
 *
 * Jokainen tuloatomi palauttaa saman muotoisen `AtomEconomics`-kuvauksen, joten
 * käyttöliittymä, herkkyysmoottori ja valmentaja voivat käsitellä mitä tahansa
 * atomiyhdistelmää ilman toimialakohtaista koodia.
 */
import type {
  AtomEconomics,
  Molecule,
  PhysicalMatterAtom,
  RecurringSubAtom,
  RevenueAtom,
  TimeCapacityAtom,
  TransactionalTradeAtom,
} from "./types.ts";
import { DAYS_PER_MONTH, WEEKS_PER_MONTH } from "./types.ts";
import { msg } from "../i18n/index.ts";

const nonNeg = (n: number): number => (Number.isFinite(n) && n > 0 ? n : 0);
const clamp01 = (n: number): number => Math.min(1, Math.max(0, Number.isFinite(n) ? n : 0));

/** Lajikohtainen oletusmaksuaika, jos atomille ei ole asetettu omaa. */
export function resolvePaymentTerms(atom: RevenueAtom, molecule: Molecule): number {
  if (typeof atom.paymentTermsDays === "number" && atom.paymentTermsDays >= 0) {
    return Math.round(atom.paymentTermsDays);
  }
  switch (atom.kind) {
    case "TIME_CAPACITY":
    case "PHYSICAL_MATTER":
      return Math.max(0, Math.round(molecule.credit.customerTermsDays));
    case "RECURRING_SUB":
      return 0;
    case "TRANSACTIONAL_TRADE":
      return 1;
  }
}

/** Kuukausittainen laskutettava kapasiteetti tunteina. */
export function timeCapacityHours(atom: TimeCapacityAtom): number {
  return nonNeg(atom.people) * nonNeg(atom.hoursPerWeek) * WEEKS_PER_MONTH * clamp01(atom.utilization);
}

/** Aika-atomin palkat sivukuluineen kuukaudessa. */
export function timePayrollPerMonth(atom: TimeCapacityAtom): number {
  return nonNeg(atom.people) * nonNeg(atom.salaryPerPersonMonth) * (1 + nonNeg(atom.sideCostRate));
}

function timeEconomics(atom: TimeCapacityAtom, terms: number): AtomEconomics {
  const capacity = timeCapacityHours(atom);
  const demand = atom.demandHoursPerMonth === null ? capacity : nonNeg(atom.demandHoursPerMonth);
  const volume = Math.min(capacity, demand);
  const price = nonNeg(atom.hourlyRate);
  const unitVar = nonNeg(atom.variableCostPerHour);
  return finish(atom, terms, {
    demandAssumed: atom.demandHoursPerMonth === null,
    volume,
    volumeUnit: msg("h"),
    demand,
    capacity,
    unitPrice: price,
    unitVariableCost: unitVar,
    attachedFixedCostPerMonth: timePayrollPerMonth(atom),
  });
}

/** Fyysisen atomin kpl-kustannus hävikki mukaan lukien: jokainen myyty kpl vaatii 1/(1−h) ostettua. */
export function physicalEffectiveUnitCost(atom: PhysicalMatterAtom): number {
  const spoil = Math.min(0.95, clamp01(atom.spoilageRate));
  return nonNeg(atom.unitCost) / (1 - spoil);
}

function physicalEconomics(atom: PhysicalMatterAtom, terms: number): AtomEconomics {
  const demand = nonNeg(atom.unitsPerMonth);
  const capacity = atom.capacityUnitsPerMonth === null ? null : nonNeg(atom.capacityUnitsPerMonth);
  const volume = capacity === null ? demand : Math.min(capacity, demand);
  return finish(atom, terms, {
    volume,
    volumeUnit: msg("kpl"),
    demand,
    capacity,
    unitPrice: nonNeg(atom.unitPrice),
    unitVariableCost: physicalEffectiveUnitCost(atom),
    attachedFixedCostPerMonth: 0,
  });
}

/** Tilaajamäärä kuukauden m alussa (m = 0 on ensimmäinen kuukausi). */
export function subscribersAtMonth(atom: RecurringSubAtom, month: number): number {
  const churn = clamp01(atom.churnRateMonthly);
  const add = nonNeg(atom.newPerMonth);
  let s = nonNeg(atom.startingSubscribers) + add;
  for (let m = 1; m <= month; m += 1) {
    s = s * (1 - churn) + add;
  }
  return s;
}

/** Tasapainotila, johon tilaajamäärä hakeutuu: uudet / poistuma. `null` jos poistuma on 0. */
export function steadyStateSubscribers(atom: RecurringSubAtom): number | null {
  const churn = clamp01(atom.churnRateMonthly);
  if (churn === 0) return null;
  return nonNeg(atom.newPerMonth) / churn;
}

function subEconomics(atom: RecurringSubAtom, terms: number): AtomEconomics {
  const subs = subscribersAtMonth(atom, 0);
  return finish(atom, terms, {
    volume: subs,
    volumeUnit: msg("asiakasta"),
    demand: subs,
    capacity: null,
    unitPrice: nonNeg(atom.pricePerMonth),
    unitVariableCost: nonNeg(atom.costPerSubscriberMonth),
    attachedFixedCostPerMonth: 0,
  });
}

/** Myyntien määrä kuukaudessa ennen kapasiteettirajaa. */
export function tradeDemandPerMonth(atom: TransactionalTradeAtom): number {
  return nonNeg(atom.visitorsPerDay) * clamp01(atom.conversionRate) * nonNeg(atom.openDaysPerMonth);
}

function tradeEconomics(atom: TransactionalTradeAtom, terms: number): AtomEconomics {
  const demand = tradeDemandPerMonth(atom);
  const capacity =
    atom.capacityPerDay === null ? null : nonNeg(atom.capacityPerDay) * nonNeg(atom.openDaysPerMonth);
  const volume = capacity === null ? demand : Math.min(capacity, demand);
  return finish(atom, terms, {
    volume,
    volumeUnit: msg("myyntiä"),
    demand,
    capacity,
    unitPrice: nonNeg(atom.averageTicket),
    unitVariableCost: nonNeg(atom.costPerSale),
    attachedFixedCostPerMonth: 0,
  });
}

interface PartialEconomics {
  demandAssumed?: boolean;
  volume: number;
  volumeUnit: string;
  demand: number;
  capacity: number | null;
  unitPrice: number;
  unitVariableCost: number;
  attachedFixedCostPerMonth: number;
}

function finish(atom: RevenueAtom, terms: number, p: PartialEconomics): AtomEconomics {
  const revenue = p.volume * p.unitPrice;
  const variable = p.volume * p.unitVariableCost;
  const contribution = revenue - variable;
  const lostDemand = p.capacity === null ? 0 : Math.max(0, p.demand - p.capacity);
  const idle = p.capacity === null ? 0 : Math.max(0, p.capacity - p.demand);
  const bottleneckRatio = p.capacity === null || p.capacity === 0 ? null : p.demand / p.capacity;
  return {
    atomId: atom.id,
    kind: atom.kind,
    label: atom.label,
    volume: p.volume,
    volumeUnit: p.volumeUnit,
    demand: p.demand,
    demandAssumed: p.demandAssumed ?? false,
    capacity: p.capacity,
    lostDemand,
    idleCapacity: idle,
    bottleneckRatio,
    unitPrice: p.unitPrice,
    unitVariableCost: p.unitVariableCost,
    revenuePerMonth: revenue,
    variableCostPerMonth: variable,
    contributionPerMonth: contribution,
    contributionMarginRatio: revenue > 0 ? contribution / revenue : 0,
    attachedFixedCostPerMonth: p.attachedFixedCostPerMonth,
    paymentTermsDays: terms,
  };
}

export function atomEconomics(atom: RevenueAtom, molecule: Molecule): AtomEconomics {
  const terms = resolvePaymentTerms(atom, molecule);
  switch (atom.kind) {
    case "TIME_CAPACITY":
      return timeEconomics(atom, terms);
    case "PHYSICAL_MATTER":
      return physicalEconomics(atom, terms);
    case "RECURRING_SUB":
      return subEconomics(atom, terms);
    case "TRANSACTIONAL_TRADE":
      return tradeEconomics(atom, terms);
  }
}

export function moleculeEconomics(molecule: Molecule): AtomEconomics[] {
  return molecule.atoms.filter((a) => a.enabled).map((a) => atomEconomics(a, molecule));
}

/** Kaikki kiinteät kulut kuukaudessa: erilliset kulut + aika-atomien palkat. */
export function totalFixedCostsPerMonth(molecule: Molecule): number {
  const listed = molecule.fixedCosts.reduce((s, c) => s + nonNeg(c.amountPerMonth), 0);
  const payroll = molecule.atoms
    .filter((a): a is TimeCapacityAtom => a.enabled && a.kind === "TIME_CAPACITY")
    .reduce((s, a) => s + timePayrollPerMonth(a), 0);
  return listed + payroll;
}

/** Fyysisen atomin aloitusvarasto euroina (ostetaan päivänä 0). */
export function physicalOpeningInventory(atom: PhysicalMatterAtom): number {
  const demand = nonNeg(atom.unitsPerMonth);
  const cap = atom.capacityUnitsPerMonth === null ? demand : Math.min(demand, nonNeg(atom.capacityUnitsPerMonth));
  const dailyPurchaseValue = (cap / DAYS_PER_MONTH) * physicalEffectiveUnitCost(atom);
  return dailyPurchaseValue * nonNeg(atom.stockCoverDays);
}
