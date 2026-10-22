/**
 * Telemetry: daily KPI series and monthly reports (statements + executive KPIs).
 */
import { z } from "zod";
import { Cents, Tick } from "./primitives";
import { FinancialStatements } from "./finance";

export const DailyKpi = z.object({
  tick: Tick,
  cash: Cents,
  netRevenue: Cents,
  cogs: Cents,
  grossProfit: Cents,
  opex: Cents,
  netIncome: Cents,
  purchases: Cents,
  netCashFlow: Cents,
  unitsDemanded: z.number(),
  unitsShipped: z.number(),
  unitsLost: z.number(),
  backlogUnits: z.number(),
  fillRate: z.number(),
  inventoryValue: Cents,
  accountsReceivable: Cents,
  accountsPayable: Cents,
  debt: Cents,
  /** null = cash-flow positive (infinite runway). */
  runwayDays: z.number().nullable(),
  dso: z.number(),
  dio: z.number(),
  dpo: z.number(),
  ccc: z.number(),
  warehouseUtilization: z.number(),
  productionUtilization: z.number(),
  headcount: z.number(),
  morale: z.number(),
  marketShare: z.number(),
  awareness: z.number(),
  governanceDrift: z.number(),
});
export type DailyKpi = z.infer<typeof DailyKpi>;

export const MonthToDate = z.object({
  marketingSpend: Cents,
  newCustomers: z.number(),
  unitsSold: z.number(),
  unitsDemanded: z.number(),
  unitsLost: z.number(),
  purchases: Cents,
  contractsWon: z.number(),
});
export type MonthToDate = z.infer<typeof MonthToDate>;

export const MonthlyReport = z.object({
  monthIndex: z.number().int().min(0),
  startTick: Tick,
  endTick: Tick,
  statements: FinancialStatements,
  activity: MonthToDate,
  kpis: z.object({
    grossMargin: z.number(),
    ebitdaMargin: z.number(),
    netMargin: z.number(),
    revenueGrowthMoM: z.number().nullable(),
    dso: z.number(),
    dio: z.number(),
    dpo: z.number(),
    ccc: z.number(),
    inventoryTurns: z.number(),
    cac: z.number().nullable(),
    ltv: z.number().nullable(),
    ltvToCac: z.number().nullable(),
    roic: z.number().nullable(),
    fillRate: z.number(),
    burnRate: Cents,
    runwayMonths: z.number().nullable(),
    headcount: z.number(),
  }),
});
export type MonthlyReport = z.infer<typeof MonthlyReport>;
