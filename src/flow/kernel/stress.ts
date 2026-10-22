/**
 * APEX Flow — suhteelliset muutokset malliin (`src/flow/kernel/stress.ts`).
 *
 * Samaa muunnosta käyttävät stressitesti, vaihteluvälisimulaatio (Monte Carlo),
 * kausivaihtelu ja tapahtumat. Erillinen moduuli, jotta simulaatio ja
 * herkkyysmoottori voivat molemmat käyttää sitä ilman kehäriippuvuutta.
 */
import type { Molecule, RevenueAtom } from "./types.ts";
import { timeCapacityHours } from "./atoms.ts";

export interface StressInput {
  /** Myyntimäärän (kysynnän) muutos, esim. −0.25 = −25 %. */
  volumeChange?: number;
  /** Hinnan muutos. */
  priceChange?: number;
  /** Muuttuvien kulujen muutos. */
  variableCostChange?: number;
  /** Kiinteiden kulujen (ml. palkat) muutos. */
  fixedCostChange?: number;
}

const scale = (n: number, r: number | undefined): number => n * (1 + (r ?? 0));

export function isNeutralStress(s: StressInput): boolean {
  return !s.volumeChange && !s.priceChange && !s.variableCostChange && !s.fixedCostChange;
}

export function stressAtom(a: RevenueAtom, s: StressInput): RevenueAtom {
  switch (a.kind) {
    case "TIME_CAPACITY": {
      // Määrän muutos osuu kysyntään; jos kysyntää ei ole annettu, oletuksena on koko kapasiteetti.
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
  if (isNeutralStress(s)) return molecule;
  return {
    ...molecule,
    atoms: molecule.atoms.map((a) => stressAtom(a, s)),
    fixedCosts: molecule.fixedCosts.map((c) => ({ ...c, amountPerMonth: scale(c.amountPerMonth, s.fixedCostChange) })),
  };
}

/** Yhdistää kaksi muutosta kertomalla: (1 + a)(1 + b) − 1. */
export function combineStress(a: StressInput, b: StressInput): StressInput {
  const c = (x?: number, y?: number) => (1 + (x ?? 0)) * (1 + (y ?? 0)) - 1;
  return {
    volumeChange: c(a.volumeChange, b.volumeChange),
    priceChange: c(a.priceChange, b.priceChange),
    variableCostChange: c(a.variableCostChange, b.variableCostChange),
    fixedCostChange: c(a.fixedCostChange, b.fixedCostChange),
  };
}
