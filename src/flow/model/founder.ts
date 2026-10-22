/**
 * APEX Studio — yrittäjän oma tilanne (`src/flow/model/founder.ts`).
 *
 * Lasketaan vain se, mikä voidaan laskea rehellisesti: oma palkka, tuntipalkka,
 * riittääkö palkka elämiseen ja viikkotuntien kestävyys nyrkkisäännöllä.
 * Väsymyksen vaikutusta myyntiin ei arvata eikä mallinneta.
 */
import type { Molecule, TimeCapacityAtom } from "../kernel/types.ts";
import { WEEKS_PER_MONTH } from "../kernel/types.ts";
import { t } from "../i18n/index.ts";

export const DEFAULT_LIVING_COSTS = 1800;
export const SUSTAINABLE_HOURS = 45;
export const HEAVY_HOURS = 55;

export type HoursLevel = "sustainable" | "heavy" | "unsustainable";

export interface FounderStats {
  /** Oma bruttopalkka tai nosto kuukaudessa. */
  ownSalary: number;
  /** Mistä oma palkka luettiin. */
  salarySource: "time-atom" | "fixed-cost" | "none";
  weeklyHours: number;
  hourlyWage: number;
  livingCosts: number;
  /** Palkka − elinkustannukset (ennen veroja). */
  personalMargin: number;
  hoursLevel: HoursLevel;
  /** Viikkotunnit annettu itse vai luettu aika-atomista. */
  hoursFromInput: boolean;
}

const SALARY_RE = /palkka|nosto|salary|draw/i;

export function founderStats(m: Molecule): FounderStats {
  const timeAtoms = m.atoms.filter((a): a is TimeCapacityAtom => a.enabled && a.kind === "TIME_CAPACITY");
  const salaryCost = m.fixedCosts.find((c) => SALARY_RE.test(c.label) && c.amountPerMonth > 0);
  let ownSalary = 0;
  let salarySource: FounderStats["salarySource"] = "none";
  if (salaryCost) {
    ownSalary = salaryCost.amountPerMonth;
    salarySource = "fixed-cost";
  } else if (timeAtoms.length > 0 && timeAtoms[0].salaryPerPersonMonth > 0) {
    ownSalary = timeAtoms[0].salaryPerPersonMonth;
    salarySource = "time-atom";
  }
  const hoursFromInput = typeof m.founder?.weeklyHours === "number";
  const weeklyHours = hoursFromInput ? m.founder!.weeklyHours : timeAtoms[0]?.hoursPerWeek ?? 40;
  const livingCosts = m.founder?.livingCostsPerMonth ?? DEFAULT_LIVING_COSTS;
  const hoursPerMonth = weeklyHours * WEEKS_PER_MONTH;
  return {
    ownSalary,
    salarySource,
    weeklyHours,
    hourlyWage: hoursPerMonth > 0 ? ownSalary / hoursPerMonth : 0,
    livingCosts,
    personalMargin: ownSalary - livingCosts,
    hoursLevel: weeklyHours <= SUSTAINABLE_HOURS ? "sustainable" : weeklyHours <= HEAVY_HOURS ? "heavy" : "unsustainable",
    hoursFromInput,
  };
}

export function hoursLevelLabel(l: HoursLevel): string {
  return l === "sustainable" ? t("Kestävä tahti") : l === "heavy" ? t("Raskas tahti") : t("Ei kestä pitkään");
}
