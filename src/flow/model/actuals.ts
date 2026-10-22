/**
 * APEX Studio — toteuma vs. suunnitelma (`src/flow/model/actuals.ts`).
 *
 * Tiliotteelta luetut kuukausitoteumat verrataan mallin kuukausiin: mallin
 * kuukausi 1 rinnastetaan toteuman ensimmäiseen kuukauteen.
 */
import type { SimulationResult } from "../kernel/types.ts";
import type { MonthlyActual } from "./importer.ts";

export interface ActualRow {
  month: string;
  plannedRevenue: number;
  actualRevenue: number;
  revenueDiff: number;
  /** Ero suhteessa suunnitelmaan (null jos suunnitelma 0). */
  revenueDiffRatio: number | null;
  plannedCosts: number;
  actualCosts: number;
  costDiff: number;
  plannedProfit: number;
  actualProfit: number;
}

export interface ActualsComparison {
  rows: ActualRow[];
  totalPlannedRevenue: number;
  totalActualRevenue: number;
  totalPlannedProfit: number;
  totalActualProfit: number;
}

export function compareActuals(sim: SimulationResult, actuals: MonthlyActual[]): ActualsComparison {
  const rows: ActualRow[] = actuals.slice(0, sim.months.length).map((a, i) => {
    const p = sim.months[i];
    const plannedCosts = p.variableCosts + p.fixedCosts;
    return {
      month: a.month,
      plannedRevenue: p.revenue,
      actualRevenue: a.income,
      revenueDiff: a.income - p.revenue,
      revenueDiffRatio: p.revenue > 0 ? (a.income - p.revenue) / p.revenue : null,
      plannedCosts,
      actualCosts: a.expenses,
      costDiff: a.expenses - plannedCosts,
      plannedProfit: p.operatingProfit,
      actualProfit: a.income - a.expenses,
    };
  });
  const sum = (f: (r: ActualRow) => number) => rows.reduce((s, r) => s + f(r), 0);
  return {
    rows,
    totalPlannedRevenue: sum((r) => r.plannedRevenue),
    totalActualRevenue: sum((r) => r.actualRevenue),
    totalPlannedProfit: sum((r) => r.plannedProfit),
    totalActualProfit: sum((r) => r.actualProfit),
  };
}
