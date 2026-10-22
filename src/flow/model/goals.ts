/**
 * APEX Studio — osa-alueiden tavoitteet (`src/flow/model/goals.ts`).
 *
 * Käyttäjä asettaa tavoitteita (esim. myyntikate ≥ 40 %). Tavoitteet näkyvät
 * oman näkökulman yläpuolella, ja rikkoutunut tavoite näkyy rajapintaviestinä.
 */
import type { FlowView } from "./view.ts";
import type { LensId } from "./personas.ts";
import { newId } from "../kernel/presets.ts";
import { msg, t } from "../i18n/index.ts";
import { money, pct } from "./format.ts";

export type GoalMetric = "revenue" | "contributionMargin" | "profit" | "cashMin" | "marginOfSafety" | "utilization" | "lostDemand" | "endCash";
export type GoalOp = "gte" | "lte";

export interface Goal {
  id: string;
  metric: GoalMetric;
  op: GoalOp;
  value: number;
  lens: LensId;
}

export const GOAL_METRICS: Record<GoalMetric, { label: string; format: "eur" | "pct"; lens: LensId; defaultOp: GoalOp }> = {
  revenue: { label: msg("Myynti / kk"), format: "eur", lens: "sales", defaultOp: "gte" },
  contributionMargin: { label: msg("Myyntikate %"), format: "pct", lens: "sales", defaultOp: "gte" },
  lostDemand: { label: msg("Myymättä jäävä myynti / kk"), format: "eur", lens: "operations", defaultOp: "lte" },
  utilization: { label: msg("Kapasiteetin käyttö"), format: "pct", lens: "operations", defaultOp: "lte" },
  profit: { label: msg("Tulos / kk"), format: "eur", lens: "finance", defaultOp: "gte" },
  cashMin: { label: msg("Kassan pohja"), format: "eur", lens: "finance", defaultOp: "gte" },
  marginOfSafety: { label: msg("Pelivara"), format: "pct", lens: "finance", defaultOp: "gte" },
  endCash: { label: msg("Kassa vuoden lopussa"), format: "eur", lens: "finance", defaultOp: "gte" },
};

export function metricValue(v: FlowView, metric: GoalMetric): number | null {
  switch (metric) {
    case "revenue":
      return v.monthlyRevenue;
    case "contributionMargin": {
      const c = v.econ.reduce((s, e) => s + e.contributionPerMonth, 0);
      return v.monthlyRevenue > 0 ? c / v.monthlyRevenue : null;
    }
    case "lostDemand":
      return v.econ.reduce((s, e) => s + e.lostDemand * e.unitPrice, 0);
    case "utilization":
      return v.bottleneck && v.bottleneck.bottleneckRatio !== null ? Math.min(1, v.bottleneck.bottleneckRatio) : null;
    case "profit":
      return v.firstMonthProfit;
    case "cashMin":
      return v.sim.minCash;
    case "marginOfSafety":
      return v.be.marginOfSafety;
    case "endCash":
      return v.sim.endCash;
  }
}

export function formatGoalValue(metric: GoalMetric, value: number): string {
  return GOAL_METRICS[metric].format === "pct" ? pct(value) : money(value);
}

export interface GoalStatus {
  goal: Goal;
  actual: number | null;
  ok: boolean | null;
  label: string;
}

export function evaluateGoals(v: FlowView, goals: Goal[]): GoalStatus[] {
  return goals.map((g) => {
    const actual = metricValue(v, g.metric);
    const ok = actual === null ? null : g.op === "gte" ? actual >= g.value - 1e-9 : actual <= g.value + 1e-9;
    const label = `${t(GOAL_METRICS[g.metric].label)} ${g.op === "gte" ? "≥" : "≤"} ${formatGoalValue(g.metric, g.value)}`;
    return { goal: g, actual, ok, label };
  });
}

/** Ehdotettu tavoite mittarille: nykyarvoa hieman parempi taso. */
export function suggestGoal(v: FlowView, metric: GoalMetric): Goal {
  const def = GOAL_METRICS[metric];
  const cur = metricValue(v, metric) ?? 0;
  let value: number;
  if (def.format === "pct") value = Math.round(Math.max(0, Math.min(1, cur + (def.defaultOp === "gte" ? 0.05 : -0.05))) * 100) / 100;
  else value = Math.round((def.defaultOp === "gte" ? Math.max(0, cur * 1.1) : Math.max(0, cur * 0.5)) / 100) * 100;
  return { id: newId("goal"), metric, op: def.defaultOp, value, lens: def.lens };
}

export function brokenGoalMessages(statuses: GoalStatus[], lens: LensId): string[] {
  return statuses
    .filter((s) => s.ok === false && (lens === "all" || s.goal.lens === lens))
    .map((s) => t("Tavoite ei täyty: {goal} (nyt {actual})", { goal: s.label, actual: s.actual === null ? "–" : formatGoalValue(s.goal.metric, s.actual) }));
}
