/**
 * APEX Studio — omat widgetit (`src/flow/model/widgets.ts`).
 *
 * Widget on KUVAUS (JSON), ei ohjelmakoodia. Kielimalli tai käyttäjä kirjoittaa
 * kuvauksen, ja sovellus piirtää sen valmiista palikoista. Kaavat lasketaan
 * turvallisella kaavatulkilla (formula.ts), joka tuntee vain alla luetellut muuttujat.
 */
import type { AtomKind, Molecule, RevenueAtom } from "../kernel/types.ts";
import type { EnterpriseGraph } from "../graph/types.ts";
import { migrateMoleculeToGraph } from "../graph/migrate.ts";
import { simulateGraph, type SimulationRun } from "../graph/simulate.ts";
import { newId } from "../kernel/presets.ts";
import { isEditableField } from "./edit.ts";
import type { FlowView } from "./view.ts";
import { founderStats } from "./founder.ts";
import { evaluate, parseFormula, variablesOf, type Scope } from "./formula.ts";
import { eur, int, money, num, pct } from "./format.ts";
import { msg, t } from "../i18n/index.ts";

export type WidgetFormat = "eur" | "pct" | "num" | "int" | "days" | "months";
export type WidgetOrigin = "ai" | "template" | "user";

interface WidgetBase {
  id: string;
  title: string;
  enabled: boolean;
  origin: WidgetOrigin;
  /** Käyttäjän pyyntö, josta widgetti luotiin. */
  prompt?: string;
  description?: string;
  createdAt: number;
}

export interface MetricWidget extends WidgetBase {
  kind: "metric";
  formula: string;
  format: WidgetFormat;
}
export interface AlertWidget extends WidgetBase {
  kind: "alert";
  condition: string;
  message: string;
  severity: "info" | "warn" | "alert";
}
export interface LeverWidget extends WidgetBase {
  kind: "lever";
  target: string;
  min: number;
  max: number;
  step: number;
  format: WidgetFormat;
}
export interface ChartSeries {
  label: string;
  formula: string;
}
export interface ChartWidget extends WidgetBase {
  kind: "chart";
  series: ChartSeries[];
  style: "line" | "bar";
  format: WidgetFormat;
}
export interface TableRow {
  label: string;
  formula: string;
  format: WidgetFormat;
}
export interface TableWidget extends WidgetBase {
  kind: "table";
  rows: TableRow[];
}

export type WidgetSpec = MetricWidget | AlertWidget | LeverWidget | ChartWidget | TableWidget;

// ---------------------------------------------------------------------------
// Muuttujasanasto
// ---------------------------------------------------------------------------

const SLUG: Record<AtomKind, string> = { TIME_CAPACITY: "time", PHYSICAL_MATTER: "goods", RECURRING_SUB: "sub", TRANSACTIONAL_TRADE: "trade" };

/** Atomin muuttujaetuliite: ensimmäinen aika-atomi = "time", toinen = "time2" jne. */
export function atomSlugs(m: Molecule): Map<string, RevenueAtom> {
  const out = new Map<string, RevenueAtom>();
  const counts: Record<string, number> = {};
  for (const a of m.atoms.filter((x) => x.enabled)) {
    const base = SLUG[a.kind];
    counts[base] = (counts[base] ?? 0) + 1;
    out.set(counts[base] === 1 ? base : `${base}${counts[base]}`, a);
  }
  return out;
}

export const GLOBAL_VARS: Record<string, string> = {
  revenue: msg("myynti / kk (tavallinen kuukausi)"),
  variableCosts: msg("muuttuvat kulut / kk"),
  fixedCosts: msg("kiinteät kulut / kk (ml. palkat)"),
  costs: msg("kaikki kulut / kk"),
  contribution: msg("myyntikate € / kk"),
  contributionMargin: msg("myyntikate-% (0–1)"),
  profit: msg("tulos 1. kuukautena"),
  profit12: msg("tulos 12. kuukautena"),
  profitYear: msg("tulos 12 kk yhteensä"),
  cash: msg("kassa 12 kk päästä"),
  cashMin: msg("kassan pohja 12 kk aikana"),
  cashOutDay: msg("päivä, jona kassa loppuu (0 = ei lopu)"),
  openingCash: msg("alkukassa"),
  breakEven: msg("kannattavuusraja € / kk (0 = ei saavutettavissa)"),
  marginOfSafety: msg("pelivara (0–1)"),
  lostSales: msg("myymättä jäävä myynti € / kk"),
  customerTerms: msg("asiakkaan maksuaika (pv)"),
  supplierTerms: msg("toimittajan maksuaika (pv)"),
  ownSalary: msg("yrittäjän oma palkka / kk"),
  founderHours: msg("yrittäjän viikkotunnit"),
  hourlyWage: msg("yrittäjän tuntipalkka"),
  livingCosts: msg("yrittäjän elinkustannukset / kk"),
};

const ATOM_ECON_VARS: Record<string, string> = {
  revenue: msg("myynti / kk"),
  volume: msg("myyty määrä / kk"),
  demand: msg("kysyntä / kk"),
  capacity: msg("kapasiteetti / kk (0 = ei rajaa)"),
  lostDemand: msg("myymättä jäävä määrä / kk"),
  idle: msg("käyttämätön kapasiteetti / kk"),
  unitPrice: msg("hinta / yksikkö"),
  unitVariableCost: msg("muuttuva kulu / yksikkö"),
  margin: msg("myyntikate € / kk"),
  marginRatio: msg("myyntikate-% (0–1)"),
  usage: msg("kapasiteetin käyttö (0–1)"),
};

export const MONTH_VARS: Record<string, string> = {
  month: msg("kuukauden numero 1–12"),
  "month.revenue": msg("kuukauden myynti"),
  "month.costs": msg("kuukauden kulut"),
  "month.profit": msg("kuukauden tulos"),
  "month.cash": msg("kassa kuukauden lopussa"),
  "month.receivables": msg("saamiset kuukauden lopussa"),
  "month.season": msg("kausikerroin"),
};

export interface WidgetContext {
  molecule: Molecule;
  view: FlowView;
  scope: Scope;
  graph?: EnterpriseGraph;
}

export function populateGraphFactorsIntoScope(scope: Scope, graph: EnterpriseGraph): void {
  for (const f of Object.values(graph.factors)) {
    if (!Number.isFinite(f.value)) continue;
    scope[f.uri] = f.value;
    if (f.alias) scope[f.alias] = f.value;
    const rawPath = f.uri.replace(/^apex:\/\/factor\//, "");
    const dotted = rawPath.replace(/[^A-Za-z0-9_]+/g, ".");
    scope[`factor.${dotted}`] = f.value;
    scope[dotted] = scope[dotted] ?? f.value;
  }
}

export function buildGraphWidgetScope(graph: EnterpriseGraph, existingRun?: SimulationRun): Scope {
  const run = existingRun ?? simulateGraph(graph);
  const monthlyRevenue = run.totals.revenue / 12;
  const monthlyVariable = run.totals.variableCosts / 12;
  const monthlyFixed = run.totals.fixedCosts / 12;
  const costs = monthlyFixed + monthlyVariable;
  const contribution = monthlyRevenue - monthlyVariable;
  const scope: Scope = {
    revenue: monthlyRevenue,
    variableCosts: monthlyVariable,
    fixedCosts: monthlyFixed,
    costs,
    contribution,
    contributionMargin: monthlyRevenue > 0 ? contribution / monthlyRevenue : 0,
    profit: run.months[0]?.operatingProfit ?? run.totals.operatingProfit / 12,
    profit12: run.months[run.months.length - 1]?.operatingProfit ?? run.totals.operatingProfit / 12,
    profitYear: run.totals.operatingProfit,
    cash: run.endCash,
    cashMin: run.minCash,
    cashOutDay: run.cashOutDay === null ? 0 : run.cashOutDay + 1,
    openingCash: graph.opening.cash,
    breakEven: contribution > 0 && monthlyRevenue > 0 ? monthlyFixed / (contribution / monthlyRevenue) : 0,
    marginOfSafety: 0,
    lostSales: 0,
    customerTerms: graph.factors["apex://factor/credit_customerTermsDays"]?.value ?? 0,
    supplierTerms: graph.factors["apex://factor/credit_supplierTermsDays"]?.value ?? 0,
    ownSalary: 0,
    founderHours: 40,
    hourlyWage: 0,
    livingCosts: 0,
  };
  populateGraphFactorsIntoScope(scope, graph);
  return scope;
}

export function buildScope(m: Molecule, v: FlowView, graph?: EnterpriseGraph): Scope {
  const f = founderStats(m);
  const costs = v.monthlyFixed + v.monthlyVariable;
  const contribution = v.econ.reduce((s, e) => s + e.contributionPerMonth, 0);
  const scope: Scope = {
    revenue: v.monthlyRevenue,
    variableCosts: v.monthlyVariable,
    fixedCosts: v.monthlyFixed,
    costs,
    contribution,
    contributionMargin: v.monthlyRevenue > 0 ? contribution / v.monthlyRevenue : 0,
    profit: v.firstMonthProfit,
    profit12: v.lastMonthProfit,
    profitYear: v.sim.totals.operatingProfit,
    cash: v.sim.endCash,
    cashMin: v.sim.minCash,
    cashOutDay: v.sim.cashOutDay === null ? 0 : v.sim.cashOutDay + 1,
    openingCash: m.credit.openingCash,
    breakEven: v.be.breakEvenRevenuePerMonth ?? 0,
    marginOfSafety: v.be.marginOfSafety ?? 0,
    lostSales: v.econ.reduce((s, e) => s + e.lostDemand * e.unitPrice, 0),
    customerTerms: m.credit.customerTermsDays,
    supplierTerms: m.credit.supplierTermsDays,
    ownSalary: f.ownSalary,
    founderHours: f.weeklyHours,
    hourlyWage: f.hourlyWage,
    livingCosts: f.livingCosts,
  };
  for (const [slug, atom] of atomSlugs(m)) {
    for (const [k, val] of Object.entries(atom)) {
      if (typeof val === "number" && isEditableField(atom.kind, k)) scope[`${slug}.${k}`] = val;
    }
    if (atom.kind === "TIME_CAPACITY" && atom.demandHoursPerMonth === null) scope[`${slug}.demandHoursPerMonth`] = 0;
    const e = v.econ.find((x) => x.atomId === atom.id);
    if (!e) continue;
    Object.assign(scope, {
      [`${slug}.revenue`]: e.revenuePerMonth,
      [`${slug}.volume`]: e.volume,
      [`${slug}.demand`]: e.demand,
      [`${slug}.capacity`]: e.capacity ?? 0,
      [`${slug}.lostDemand`]: e.lostDemand,
      [`${slug}.idle`]: e.idleCapacity,
      [`${slug}.unitPrice`]: e.unitPrice,
      [`${slug}.unitVariableCost`]: e.unitVariableCost,
      [`${slug}.margin`]: e.contributionPerMonth,
      [`${slug}.marginRatio`]: e.contributionMarginRatio,
      [`${slug}.usage`]: e.capacity ? Math.min(1, e.demand / e.capacity) : 0,
    });
  }
  populateGraphFactorsIntoScope(scope, graph ?? migrateMoleculeToGraph(m));
  return scope;
}

/** Muuttujat selityksineen (näytetään käyttäjälle ja annetaan kielimallille). */
export function vocabulary(m: Molecule): { name: string; description: string }[] {
  const out = Object.entries(GLOBAL_VARS).map(([name, d]) => ({ name, description: t(d) }));
  for (const [slug, atom] of atomSlugs(m)) {
    for (const [k, val] of Object.entries(atom)) {
      if ((typeof val === "number" || val === null) && isEditableField(atom.kind, k)) out.push({ name: `${slug}.${k}`, description: `${atom.label}: ${k}` });
    }
    for (const [k, d] of Object.entries(ATOM_ECON_VARS)) out.push({ name: `${slug}.${k}`, description: `${atom.label}: ${t(d)}` });
  }
  return out;
}

function monthScope(base: Scope, v: FlowView, i: number): Scope {
  const mo = v.sim.months[i];
  return {
    ...base,
    month: i + 1,
    "month.revenue": mo.revenue,
    "month.costs": mo.variableCosts + mo.fixedCosts,
    "month.profit": mo.operatingProfit,
    "month.cash": mo.endCash,
    "month.receivables": mo.endReceivables,
    "month.season": mo.seasonFactor,
  };
}

// ---------------------------------------------------------------------------
// Validointi
// ---------------------------------------------------------------------------

const FORMATS: WidgetFormat[] = ["eur", "pct", "num", "int", "days", "months"];
const isObj = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
const str = (x: unknown, max: number): string | null => (typeof x === "string" && x.trim() && x.length <= max ? x.trim() : null);
const fmt = (x: unknown): WidgetFormat => (FORMATS.includes(x as WidgetFormat) ? (x as WidgetFormat) : "num");

function checkFormula(src: unknown, known: Set<string>, allowMonth: boolean): string {
  const s = str(src, 400);
  if (!s) throw new Error(t("Kaava puuttuu"));
  const vars = variablesOf(parseFormula(s));
  for (const v of vars) {
    if (known.has(v)) continue;
    if (allowMonth && (v === "month" || v in MONTH_VARS)) continue;
    throw new Error(t("Tuntematon muuttuja \"{name}\"", { name: v }));
  }
  return s;
}

/** Ratkaisee vipuwidgetin kohteen (esim. "time.hourlyRate") vivun tunnisteeksi. */
export function resolveLeverTarget(m: Molecule, target: string): { leverId: string; value: number } | null {
  const [scope, field] = target.split(".");
  if (!field) return null;
  if (scope === "credit") {
    if (!["customerTermsDays", "supplierTermsDays", "openingCash"].includes(field)) return null;
    return { leverId: `credit:${field}`, value: (m.credit as unknown as Record<string, number>)[field] };
  }
  const atom = atomSlugs(m).get(scope);
  if (!atom || !isEditableField(atom.kind, field)) return null;
  const v = (atom as unknown as Record<string, unknown>)[field];
  return typeof v === "number" ? { leverId: `${atom.id}:${field}`, value: v } : null;
}

export type ValidationResult = { spec: WidgetSpec; error: null } | { spec: null; error: string };

/** Validoi tuntemattoman syötteen (esim. kielimallin JSON) widgetiksi tätä mallia vasten. */
export function validateWidget(raw: unknown, m: Molecule, v: FlowView, origin: WidgetOrigin, prompt?: string): ValidationResult {
  try {
    if (!isObj(raw)) throw new Error(t("Widgetin kuvaus puuttuu"));
    const known = new Set(Object.keys(buildScope(m, v)));
    const title = str(raw.title, 60);
    if (!title) throw new Error(t("Widgetiltä puuttuu otsikko"));
    const base = {
      id: newId("w"),
      title,
      enabled: true,
      origin,
      prompt: prompt?.slice(0, 500),
      description: str(raw.description, 300) ?? undefined,
      createdAt: Date.now(),
    };
    switch (raw.kind) {
      case "metric":
        return { spec: { ...base, kind: "metric", formula: checkFormula(raw.formula, known, false), format: fmt(raw.format) }, error: null };
      case "alert": {
        const message = str(raw.message, 200);
        if (!message) throw new Error(t("Hälytykseltä puuttuu viesti"));
        const severity = raw.severity === "alert" || raw.severity === "info" ? raw.severity : "warn";
        return { spec: { ...base, kind: "alert", condition: checkFormula(raw.condition, known, false), message, severity }, error: null };
      }
      case "lever": {
        const target = str(raw.target, 60);
        const resolved = target ? resolveLeverTarget(m, target) : null;
        if (!target || !resolved) throw new Error(t("Vivun kohde ei ole muokattava luku"));
        const min = typeof raw.min === "number" && Number.isFinite(raw.min) ? raw.min : 0;
        const max = typeof raw.max === "number" && Number.isFinite(raw.max) && raw.max > min ? raw.max : Math.max(min + 1, resolved.value * 2 || 100);
        const step = typeof raw.step === "number" && raw.step > 0 ? raw.step : (max - min) / 100;
        return { spec: { ...base, kind: "lever", target, min, max, step, format: fmt(raw.format) }, error: null };
      }
      case "chart": {
        const series = Array.isArray(raw.series) ? raw.series.slice(0, 3) : [];
        if (series.length === 0) throw new Error(t("Kuvaajalta puuttuu sarja"));
        const out = series.map((s) => {
          if (!isObj(s)) throw new Error(t("Virheellinen sarja"));
          return { label: str(s.label, 40) ?? title, formula: checkFormula(s.formula, known, true) };
        });
        return { spec: { ...base, kind: "chart", series: out, style: raw.style === "bar" ? "bar" : "line", format: fmt(raw.format) }, error: null };
      }
      case "table": {
        const rows = Array.isArray(raw.rows) ? raw.rows.slice(0, 10) : [];
        if (rows.length === 0) throw new Error(t("Taulukolta puuttuvat rivit"));
        const out = rows.map((r) => {
          if (!isObj(r)) throw new Error(t("Virheellinen rivi"));
          return { label: str(r.label, 50) ?? "–", formula: checkFormula(r.formula, known, false), format: fmt(r.format) };
        });
        return { spec: { ...base, kind: "table", rows: out }, error: null };
      }
      default:
        throw new Error(t("Tuntematon widgettityyppi"));
    }
  } catch (e) {
    return { spec: null, error: (e as Error).message };
  }
}

// ---------------------------------------------------------------------------
// Laskenta
// ---------------------------------------------------------------------------

export function formatWidgetValue(v: number, f: WidgetFormat): string {
  if (!Number.isFinite(v)) return "–";
  switch (f) {
    case "eur":
      return Math.abs(v) < 100 ? eur(v) : money(v);
    case "pct":
      return pct(v, Math.abs(v) < 0.1 ? 1 : 0);
    case "int":
      return int(v);
    case "days":
      return t("{n} pv", { n: int(v) });
    case "months":
      return t("{n} kk", { n: num(v, 1) });
    default:
      return num(v, Math.abs(v) < 10 ? 2 : 1);
  }
}

export type WidgetResult =
  | { kind: "metric"; text: string; value: number | null; error: string | null }
  | { kind: "alert"; active: boolean; error: string | null }
  | { kind: "lever"; leverId: string | null; value: number; error: string | null }
  | { kind: "chart"; series: { label: string; values: number[] }[]; error: string | null }
  | { kind: "table"; rows: { label: string; text: string }[]; error: string | null };

const safe = (src: string, scope: Scope): number => evaluate(parseFormula(src), scope);

export function evaluateWidget(w: WidgetSpec, ctx: WidgetContext): WidgetResult {
  try {
    switch (w.kind) {
      case "metric": {
        const value = safe(w.formula, ctx.scope);
        return { kind: "metric", value, text: formatWidgetValue(value, w.format), error: null };
      }
      case "alert":
        return { kind: "alert", active: !!safe(w.condition, ctx.scope), error: null };
      case "lever": {
        const r = resolveLeverTarget(ctx.molecule, w.target);
        return r ? { kind: "lever", leverId: r.leverId, value: r.value, error: null } : { kind: "lever", leverId: null, value: 0, error: t("Vivun kohdetta ei enää ole mallissa") };
      }
      case "chart":
        return {
          kind: "chart",
          series: w.series.map((s) => ({ label: s.label, values: ctx.view.sim.months.map((_, i) => safe(s.formula, monthScope(ctx.scope, ctx.view, i))) })),
          error: null,
        };
      case "table":
        return { kind: "table", rows: w.rows.map((r) => ({ label: r.label, text: formatWidgetValue(safe(r.formula, ctx.scope), r.format) })), error: null };
    }
  } catch (e) {
    const error = (e as Error).message;
    switch (w.kind) {
      case "metric":
        return { kind: "metric", text: "–", value: null, error };
      case "alert":
        return { kind: "alert", active: false, error };
      case "lever":
        return { kind: "lever", leverId: null, value: 0, error };
      case "chart":
        return { kind: "chart", series: [], error };
      case "table":
        return { kind: "table", rows: [], error };
    }
  }
}

export function evaluateGraphWidget(w: WidgetSpec, graph: EnterpriseGraph, existingRun?: SimulationRun): WidgetResult {
  const run = existingRun ?? simulateGraph(graph);
  const scope = buildGraphWidgetScope(graph, run);
  try {
    switch (w.kind) {
      case "metric": {
        const value = safe(w.formula, scope);
        return { kind: "metric", value, text: formatWidgetValue(value, w.format), error: null };
      }
      case "alert":
        return { kind: "alert", active: !!safe(w.condition, scope), error: null };
      case "lever": {
        const factor = Object.values(graph.factors).find(
          (f) =>
            f.uri === w.target ||
            f.alias === w.target ||
            `factor.${f.uri.replace(/^apex:\/\/factor\//, "").replace(/[^A-Za-z0-9_]+/g, ".")}` === w.target,
        );
        return factor ? { kind: "lever", leverId: factor.uri, value: factor.value, error: null } : { kind: "lever", leverId: null, value: 0, error: t("Vivun kohdetta ei enää ole mallissa") };
      }
      case "chart": {
        const months = run.months ?? [];
        return {
          kind: "chart",
          series: w.series.map((s) => ({
            label: s.label,
            values: months.map((mo, i) =>
              safe(s.formula, {
                ...scope,
                month: i + 1,
                "month.revenue": mo.revenue,
                "month.costs": mo.variableCosts + mo.fixedCosts,
                "month.profit": mo.operatingProfit,
                "month.cash": mo.endCash,
                "month.receivables": mo.endReceivables,
                "month.season": mo.seasonFactor,
              }),
            ),
          })),
          error: null,
        };
      }
      case "table":
        return { kind: "table", rows: w.rows.map((r) => ({ label: r.label, text: formatWidgetValue(safe(r.formula, scope), r.format) })), error: null };
    }
  } catch (e) {
    const error = (e as Error).message;
    switch (w.kind) {
      case "metric":
        return { kind: "metric", text: "–", value: null, error };
      case "alert":
        return { kind: "alert", active: false, error };
      case "lever":
        return { kind: "lever", leverId: null, value: 0, error };
      case "chart":
        return { kind: "chart", series: [], error };
      case "table":
        return { kind: "table", rows: [], error };
    }
  }
}

// ---------------------------------------------------------------------------
// Valmiit pohjat (toimivat ilman kielimallia)
// ---------------------------------------------------------------------------

export interface WidgetTemplate {
  id: string;
  title: string;
  description: string;
  requires?: string;
  build: (m: Molecule) => unknown;
}

const priceFieldOf = (a: RevenueAtom) =>
  ({ TIME_CAPACITY: "hourlyRate", PHYSICAL_MATTER: "unitPrice", RECURRING_SUB: "pricePerMonth", TRANSACTIONAL_TRADE: "averageTicket" })[a.kind];

export const WIDGET_TEMPLATES: WidgetTemplate[] = [
  { id: "runway", title: msg("Kassa riittää"), description: msg("Montako kuukauden kulut kassa kattaa vuoden lopussa"), build: () => ({ kind: "metric", title: t("Kassa riittää"), formula: "cash / costs", format: "months" }) },
  { id: "margin", title: msg("Myyntikate"), description: msg("Kuinka suuri osa myynnistä jää muuttuvien kulujen jälkeen"), build: () => ({ kind: "metric", title: t("Myyntikate"), formula: "contributionMargin", format: "pct" }) },
  {
    id: "hour-margin",
    title: msg("Kate per työtunti"),
    description: msg("Mitä yksi tehty työtunti tuottaa, kun laskuttamaton aika huomioidaan"),
    requires: "time",
    build: () => ({ kind: "metric", title: t("Kate per työtunti"), formula: "(time.unitPrice - time.unitVariableCost) * time.utilization", format: "eur" }),
  },
  { id: "wage", title: msg("Oma tuntipalkka"), description: msg("Oma palkka jaettuna tehdyillä tunneilla"), build: () => ({ kind: "metric", title: t("Oma tuntipalkka"), formula: "hourlyWage", format: "eur" }) },
  {
    id: "cash-alert",
    title: msg("Hälytys: kassa alle 2 kk kulut"),
    description: msg("Varoittaa, jos kassan pohja jää alle kahden kuukauden kulujen"),
    build: () => ({ kind: "alert", title: t("Kassapuskuri"), condition: "cashMin < 2 * costs", message: t("Kassan pohja jää alle kahden kuukauden kulujen."), severity: "warn" }),
  },
  { id: "profit-chart", title: msg("Tulos kuukausittain"), description: msg("Pylväskuvaaja kuukausituloksesta"), build: () => ({ kind: "chart", title: t("Tulos kuukausittain"), series: [{ label: t("Tulos"), formula: "month.profit" }], style: "bar", format: "eur" }) },
  {
    id: "rev-cost-chart",
    title: msg("Myynti ja kulut"),
    description: msg("Myynti ja kulut kuukausittain samassa kuvaajassa"),
    build: () => ({ kind: "chart", title: t("Myynti ja kulut"), series: [{ label: t("Myynti"), formula: "month.revenue" }, { label: t("Kulut"), formula: "month.costs" }], style: "line", format: "eur" }),
  },
  {
    id: "ltv-cac",
    title: msg("Asiakkaan arvo / hankintakulu"),
    description: msg("Tilausliiketoiminnan terveys: vähintään 3 on hyvä"),
    requires: "sub",
    build: () => ({ kind: "metric", title: t("Asiakkaan arvo / hankintakulu"), formula: "if(sub.cacPerNew > 0, (sub.pricePerMonth - sub.costPerSubscriberMonth) / max(sub.churnRateMonthly, 0.001) / sub.cacPerNew, 0)", format: "num" }),
  },
  { id: "lost", title: msg("Myymättä jäävä myynti"), description: msg("Kapasiteetin takia menetetty myynti kuukaudessa"), build: () => ({ kind: "metric", title: t("Myymättä jäävä myynti"), formula: "lostSales", format: "eur" }) },
  {
    id: "price-lever",
    title: msg("Pikavipu: hinta"),
    description: msg("Ensimmäisen tulovirran hinta omana vipunaan"),
    build: (m) => {
      const [slug, a] = [...atomSlugs(m).entries()][0] ?? [];
      if (!a || !slug) return null;
      const cur = (a as unknown as Record<string, number>)[priceFieldOf(a)];
      return { kind: "lever", title: t("Hinta: {label}", { label: a.label }), target: `${slug}.${priceFieldOf(a)}`, min: Math.max(0, cur * 0.5), max: cur * 2 || 100, step: cur >= 50 ? 1 : 0.1, format: "eur" };
    },
  },
  {
    id: "unit-table",
    title: msg("Yksikkötalous"),
    description: msg("Hinta, muuttuva kulu ja kate yhdellä silmäyksellä"),
    build: (m) => {
      const [slug] = [...atomSlugs(m).keys()];
      if (!slug) return null;
      return {
        kind: "table",
        title: t("Yksikkötalous"),
        rows: [
          { label: t("Hinta"), formula: `${slug}.unitPrice`, format: "eur" },
          { label: t("Muuttuva kulu"), formula: `${slug}.unitVariableCost`, format: "eur" },
          { label: t("Kate / yksikkö"), formula: `${slug}.unitPrice - ${slug}.unitVariableCost`, format: "eur" },
          { label: t("Myyntikate-%"), formula: `${slug}.marginRatio`, format: "pct" },
        ],
      };
    },
  },
];

export function availableTemplates(m: Molecule): WidgetTemplate[] {
  const slugs = new Set(atomSlugs(m).keys());
  return WIDGET_TEMPLATES.filter((tpl) => !tpl.requires || slugs.has(tpl.requires));
}

export function widgetFromTemplate(id: string, m: Molecule, v: FlowView): ValidationResult {
  const tpl = WIDGET_TEMPLATES.find((x) => x.id === id);
  if (!tpl) return { spec: null, error: t("Pohjaa ei löytynyt") };
  return validateWidget(tpl.build(m), m, v, "template");
}
