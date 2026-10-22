/**
 * APEX Flow — herkkyys- ja kipurajamoottori (`src/flow/kernel/sensitivity.ts`).
 *
 * Periaate: moottori ei koskaan arvaa, miten asiakkaat reagoivat hintaan.
 * Se laskee täsmällisesti, kuinka paljon määrää saa menettää (tai pitää saada lisää),
 * jotta tulos pysyy ennallaan. Arvion siitä, onko se realistista, tekee käyttäjä.
 */
import type { AtomEconomics, Molecule, RevenueAtom, SimulationResult, TimeCapacityAtom } from "./types.ts";
import { moleculeEconomics, timeCapacityHours, totalFixedCostsPerMonth } from "./atoms.ts";
import { simulate } from "./simulate.ts";

export interface PriceChangeTolerance {
  currentPrice: number;
  newPrice: number;
  unitVariableCost: number;
  currentUnitMargin: number;
  newUnitMargin: number;
  /** Uusi määrä / nykyinen määrä, jolla katetta jää euroina täsmälleen yhtä paljon. */
  breakEvenVolumeRatio: number | null;
  /** Hinnan nostossa: kuinka monta % määrästä voi menettää ennen kuin kate pienenee (0..1). */
  maxVolumeLoss: number | null;
  /** Hinnan laskussa: kuinka monta % lisää määrää tarvitaan, jotta kate pysyy ennallaan. */
  requiredVolumeGain: number | null;
  /** Tosi, jos uusi hinta ei kata edes muuttuvaa kulua: mikään määrä ei pelasta katetta. */
  impossible: boolean;
}

/**
 * Hinnanmuutoksen kipuraja.
 *
 * Kate ennen: (P − v) · Q. Kate jälkeen: (P' − v) · Q'.
 * Sama kate, kun Q' / Q = (P − v) / (P' − v).
 */
export function priceChangeTolerance(
  price: number,
  unitVariableCost: number,
  priceChangeRatio: number,
): PriceChangeTolerance {
  const newPrice = price * (1 + priceChangeRatio);
  const m0 = price - unitVariableCost;
  const m1 = newPrice - unitVariableCost;
  const base = {
    currentPrice: price,
    newPrice,
    unitVariableCost,
    currentUnitMargin: m0,
    newUnitMargin: m1,
  };
  if (m1 <= 0) {
    return { ...base, breakEvenVolumeRatio: null, maxVolumeLoss: null, requiredVolumeGain: null, impossible: true };
  }
  if (m0 <= 0) {
    // Nykyhinnalla jokainen myynti on tappiollinen: mikä tahansa myynti uudella hinnalla parantaa katetta.
    return { ...base, breakEvenVolumeRatio: 0, maxVolumeLoss: 1, requiredVolumeGain: null, impossible: false };
  }
  const ratio = m0 / m1;
  return {
    ...base,
    breakEvenVolumeRatio: ratio,
    maxVolumeLoss: ratio <= 1 ? 1 - ratio : null,
    requiredVolumeGain: ratio > 1 ? ratio - 1 : null,
    impossible: false,
  };
}

export function atomPriceTolerance(e: AtomEconomics, priceChangeRatio: number): PriceChangeTolerance {
  return priceChangeTolerance(e.unitPrice, e.unitVariableCost, priceChangeRatio);
}

export interface BreakEvenResult {
  fixedCostsPerMonth: number;
  revenuePerMonth: number;
  contributionPerMonth: number;
  /** Painotettu myyntikateprosentti nykyisellä myyntijakaumalla. */
  contributionMarginRatio: number;
  /** Liikevaihto, jolla kate kattaa kiinteät kulut. `null` jos kate ≤ 0. */
  breakEvenRevenuePerMonth: number | null;
  /** (Liikevaihto − kannattavuusraja) / liikevaihto. Negatiivinen = tappiolla. */
  marginOfSafety: number | null;
  /** Yksittäisen tuloatomin tapauksessa kannattavuusraja omassa yksikössään (h, kpl, ...). */
  breakEvenVolume: { volume: number; unit: string; atomId: string } | null;
  /** Mahtuuko kannattavuusrajan määrä kapasiteettiin (yksittäinen atomi). */
  breakEvenWithinCapacity: boolean | null;
}

/** Kuukausitason kannattavuusraja nykyisellä myyntijakaumalla. */
export function breakEven(molecule: Molecule): BreakEvenResult {
  const econ = moleculeEconomics(molecule);
  const fixed = totalFixedCostsPerMonth(molecule);
  const revenue = econ.reduce((s, e) => s + e.revenuePerMonth, 0);
  const contribution = econ.reduce((s, e) => s + e.contributionPerMonth, 0);
  const cmr = revenue > 0 ? contribution / revenue : 0;
  const beRevenue = cmr > 0 ? fixed / cmr : null;
  let beVolume: BreakEvenResult["breakEvenVolume"] = null;
  let withinCapacity: boolean | null = null;
  if (econ.length === 1) {
    const e = econ[0];
    const unitMargin = e.unitPrice - e.unitVariableCost;
    if (unitMargin > 0) {
      const v = fixed / unitMargin;
      beVolume = { volume: v, unit: e.volumeUnit, atomId: e.atomId };
      withinCapacity = e.capacity === null ? true : v <= e.capacity + 1e-9;
    }
  }
  return {
    fixedCostsPerMonth: fixed,
    revenuePerMonth: revenue,
    contributionPerMonth: contribution,
    contributionMarginRatio: cmr,
    breakEvenRevenuePerMonth: beRevenue,
    marginOfSafety: beRevenue !== null && revenue > 0 ? (revenue - beRevenue) / revenue : null,
    breakEvenVolume: beVolume,
    breakEvenWithinCapacity: withinCapacity,
  };
}

export interface HireBreakEven {
  monthlyCost: number;
  unitMargin: number;
  /** Laskutettavia lisätunteja kuukaudessa, jotta rekry maksaa itsensä. `null` jos tuntikate ≤ 0. */
  hoursNeededPerMonth: number | null;
  /** Uuden henkilön laskutettava kapasiteetti samalla laskutusasteella. */
  newPersonCapacityHours: number;
  /** Tarvittavat tunnit / uuden henkilön kapasiteetti. */
  shareOfNewCapacity: number | null;
}

/** Kuinka paljon lisää laskutusta yksi uusi henkilö vaatii, jotta hän maksaa itsensä. */
export function hireBreakEven(
  atom: TimeCapacityAtom,
  salaryPerMonth: number = atom.salaryPerPersonMonth,
  sideCostRate: number = atom.sideCostRate,
): HireBreakEven {
  const monthlyCost = Math.max(0, salaryPerMonth) * (1 + Math.max(0, sideCostRate));
  const unitMargin = atom.hourlyRate - atom.variableCostPerHour;
  const capacity = timeCapacityHours({ ...atom, people: 1 });
  const hours = unitMargin > 0 ? monthlyCost / unitMargin : null;
  return {
    monthlyCost,
    unitMargin,
    hoursNeededPerMonth: hours,
    newPersonCapacityHours: capacity,
    shareOfNewCapacity: hours !== null && capacity > 0 ? hours / capacity : null,
  };
}

/** Palauttaa molekyylin kopion, jossa asiakkaiden oletusmaksuaika ja laskutettavien atomien maksuaika on vaihdettu. */
export function withCustomerTerms(molecule: Molecule, days: number): Molecule {
  return {
    ...molecule,
    credit: { ...molecule.credit, customerTermsDays: days },
    atoms: molecule.atoms.map((a) =>
      a.kind === "TIME_CAPACITY" || a.kind === "PHYSICAL_MATTER" ? { ...a, paymentTermsDays: undefined } : a,
    ),
  };
}

export interface TermsScenario {
  customerTermsDays: number;
  minCash: number;
  minCashDay: number;
  cashOutDay: number | null;
  endCash: number;
}

/** Ajaa simulaation eri asiakasmaksuajoilla ja vertaa kassan pohjaa. */
export function customerTermsImpact(molecule: Molecule, options: number[] = [0, 14, 30, 45, 60]): TermsScenario[] {
  return options.map((days) => {
    const r = simulate(withCustomerTerms(molecule, days));
    return { customerTermsDays: days, minCash: r.minCash, minCashDay: r.minCashDay, cashOutDay: r.cashOutDay, endCash: r.endCash };
  });
}

export interface StressInput {
  /** Myyntimäärän muutos, esim. −0.25 = −25 %. */
  volumeChange?: number;
  /** Hinnan muutos. */
  priceChange?: number;
  /** Muuttuvien kulujen muutos. */
  variableCostChange?: number;
  /** Kiinteiden kulujen (ml. palkat) muutos. */
  fixedCostChange?: number;
}

const scale = (n: number, r: number | undefined): number => n * (1 + (r ?? 0));

function stressAtom(a: RevenueAtom, s: StressInput): RevenueAtom {
  switch (a.kind) {
    case "TIME_CAPACITY": {
      // Määrän lasku osuu kysyntään; jos kysyntä on rajaton, se osuu laskutettaviin tunteihin laskutusasteen kautta.
      const demand =
        a.demandHoursPerMonth === null
          ? s.volumeChange
            ? timeCapacityHours(a) * (1 + s.volumeChange)
            : null
          : scale(a.demandHoursPerMonth, s.volumeChange);
      return {
        ...a,
        demandHoursPerMonth: demand === null ? null : Math.max(0, demand),
        hourlyRate: scale(a.hourlyRate, s.priceChange),
        variableCostPerHour: scale(a.variableCostPerHour, s.variableCostChange),
        salaryPerPersonMonth: scale(a.salaryPerPersonMonth, s.fixedCostChange),
      };
    }
    case "PHYSICAL_MATTER":
      return {
        ...a,
        unitsPerMonth: Math.max(0, scale(a.unitsPerMonth, s.volumeChange)),
        unitPrice: scale(a.unitPrice, s.priceChange),
        unitCost: scale(a.unitCost, s.variableCostChange),
      };
    case "RECURRING_SUB":
      return {
        ...a,
        newPerMonth: Math.max(0, scale(a.newPerMonth, s.volumeChange)),
        startingSubscribers: Math.max(0, scale(a.startingSubscribers, s.volumeChange)),
        pricePerMonth: scale(a.pricePerMonth, s.priceChange),
        costPerSubscriberMonth: scale(a.costPerSubscriberMonth, s.variableCostChange),
      };
    case "TRANSACTIONAL_TRADE":
      return {
        ...a,
        visitorsPerDay: Math.max(0, scale(a.visitorsPerDay, s.volumeChange)),
        averageTicket: scale(a.averageTicket, s.priceChange),
        costPerSale: scale(a.costPerSale, s.variableCostChange),
      };
  }
}

export function applyStress(molecule: Molecule, s: StressInput): Molecule {
  return {
    ...molecule,
    atoms: molecule.atoms.map((a) => stressAtom(a, s)),
    fixedCosts: molecule.fixedCosts.map((c) => ({ ...c, amountPerMonth: scale(c.amountPerMonth, s.fixedCostChange) })),
  };
}

export interface StressResult {
  input: StressInput;
  base: SimulationResult;
  stressed: SimulationResult;
}

export function stressTest(molecule: Molecule, s: StressInput): StressResult {
  return { input: s, base: simulate(molecule), stressed: simulate(applyStress(molecule, s)) };
}
