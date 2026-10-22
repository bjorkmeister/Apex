/**
 * APEX Flow — kausivaihtelu ja tapahtumat simulaatiossa (`src/flow/kernel/events.ts`).
 */
import type { BusinessEvent, Molecule } from "./types.ts";
import { combineStress, type StressInput } from "./stress.ts";

export interface MonthModifier {
  calendarMonth: number;
  seasonFactor: number;
  stress: StressInput;
  activeEvents: BusinessEvent[];
  /** Tässä kuussa alkavien tapahtumien kertakulut. */
  oneOffCost: number;
}

const fin = (n: unknown, d = 0): number => (typeof n === "number" && Number.isFinite(n) ? n : d);

export function seasonFactorFor(m: Molecule, calendarMonth: number): number {
  const s = m.seasonality;
  if (!Array.isArray(s) || s.length !== 12) return 1;
  return Math.max(0, fin(s[calendarMonth], 1));
}

export function calendarMonthOf(m: Molecule, simMonth: number): number {
  const start = Math.round(fin(m.startMonth, 0));
  return (((start + simMonth) % 12) + 12) % 12;
}

export function isEventActive(e: BusinessEvent, simMonth: number): boolean {
  const start = Math.round(fin(e.startMonth));
  const dur = Math.max(1, Math.round(fin(e.durationMonths, 1)));
  return simMonth >= start && simMonth < start + dur;
}

/** Kuukauden muutokset: kausikerroin kertoo kysynnän, tapahtumat yhdistetään kertomalla. */
export function monthModifier(m: Molecule, simMonth: number): MonthModifier {
  const calendarMonth = calendarMonthOf(m, simMonth);
  const seasonFactor = seasonFactorFor(m, calendarMonth);
  let stress: StressInput = { volumeChange: seasonFactor - 1 };
  const activeEvents: BusinessEvent[] = [];
  let oneOffCost = 0;
  for (const e of m.events ?? []) {
    if (!isEventActive(e, simMonth)) continue;
    activeEvents.push(e);
    stress = combineStress(stress, {
      volumeChange: Math.max(-1, fin(e.volumeChange)),
      priceChange: Math.max(-0.95, fin(e.priceChange)),
      variableCostChange: Math.max(-0.95, fin(e.variableCostChange)),
      fixedCostChange: Math.max(-0.95, fin(e.fixedCostChange)),
    });
    if (Math.round(fin(e.startMonth)) === simMonth) oneOffCost += Math.max(0, fin(e.oneOffCost));
  }
  return { calendarMonth, seasonFactor, stress, activeEvents, oneOffCost };
}

/** Onko mallissa kausivaihtelua tai tapahtumia (simulaatio voi ohittaa kuukausikohtaisen laskennan, jos ei). */
export function hasMonthlyVariation(m: Molecule): boolean {
  const seasonal = Array.isArray(m.seasonality) && m.seasonality.length === 12 && m.seasonality.some((x) => fin(x, 1) !== 1);
  return seasonal || (m.events?.length ?? 0) > 0;
}
