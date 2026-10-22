/**
 * APEX Studio — skenaariot ja aikakone (`src/flow/model/scenarios.ts`).
 *
 * Skenaario on tallennettu kopio mallista. Skenaarioita verrataan rinnakkain
 * samoilla mittareilla, ja niiden kassakäyrät piirretään samaan kuvaan.
 */
import type { Molecule, SimulationResult } from "../kernel/types.ts";
import { simulate } from "../kernel/simulate.ts";
import { breakEven } from "../kernel/sensitivity.ts";
import { newId } from "../kernel/presets.ts";

export interface Scenario {
  id: string;
  name: string;
  molecule: Molecule;
  createdAt: number;
  /** Näytetäänkö kassakäyrä vertailussa. */
  compare: boolean;
}

export const SCENARIO_COLORS = ["#f472b6", "#a78bfa", "#facc15", "#34d399", "#fb923c"];

export function createScenario(name: string, molecule: Molecule): Scenario {
  return { id: newId("sc"), name: name.trim().slice(0, 60) || "A", molecule: JSON.parse(JSON.stringify(molecule)) as Molecule, createdAt: Date.now(), compare: true };
}

export interface ScenarioMetrics {
  id: string;
  name: string;
  firstMonthProfit: number;
  lastMonthProfit: number;
  totalProfit: number;
  endCash: number;
  minCash: number;
  cashOutDay: number | null;
  breakEvenRevenue: number | null;
  sim: SimulationResult;
}

export function scenarioMetrics(id: string, name: string, m: Molecule): ScenarioMetrics {
  const sim = simulate(m);
  return {
    id,
    name,
    firstMonthProfit: sim.months[0]?.operatingProfit ?? 0,
    lastMonthProfit: sim.months[sim.months.length - 1]?.operatingProfit ?? 0,
    totalProfit: sim.totals.operatingProfit,
    endCash: sim.endCash,
    minCash: sim.minCash,
    cashOutDay: sim.cashOutDay,
    breakEvenRevenue: breakEven(m).breakEvenRevenuePerMonth,
    sim,
  };
}

/** Nykyinen malli ensin, sitten valitut skenaariot. */
export function compareScenarios(current: Molecule, currentName: string, scenarios: Scenario[]): ScenarioMetrics[] {
  return [scenarioMetrics("current", currentName, current), ...scenarios.map((s) => scenarioMetrics(s.id, s.name, s.molecule))];
}
