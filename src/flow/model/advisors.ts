/**
 * APEX Studio — neuvonantajat (`src/flow/model/advisors.ts`).
 *
 * Neljä neuvonantajaa katsoo samaa mallia oman roolinsa silmin. Ilman kielimallia
 * jokainen esittää luvuilla perustellun näkemyksen ja ehdotukset (valmentajan
 * havainnot jaetaan rooleittain). Kielimallin kanssa neuvonantajat keskustelevat
 * vapaammin (palvelimen /api/flow/advisors), mutta ehdotukset tarkistetaan aina.
 */
import type { Molecule } from "../kernel/types.ts";
import { atomPriceTolerance } from "../kernel/sensitivity.ts";
import type { CoachInsight, CoachAction } from "./coach.ts";
import type { FlowView } from "./view.ts";
import { founderStats, hoursLevelLabel } from "./founder.ts";
import { money, num, pct } from "./format.ts";
import { msg, t } from "../i18n/index.ts";

export type AdvisorRole = "cfo" | "sales" | "ops" | "people";

export const ADVISORS: Record<AdvisorRole, { name: string; title: string; icon: string }> = {
  cfo: { name: msg("Talous"), title: msg("Talousjohtaja"), icon: "💶" },
  sales: { name: msg("Myynti"), title: msg("Myyntijohtaja"), icon: "📈" },
  ops: { name: msg("Toimitus"), title: msg("Operatiivinen johtaja"), icon: "⚙️" },
  people: { name: msg("Ihmiset"), title: msg("Henkilöstö ja jaksaminen"), icon: "🧑‍🤝‍🧑" },
};

export interface AdvisorView {
  role: AdvisorRole;
  stance: "ok" | "concern" | "alarm";
  summary: string;
  points: string[];
  actions: CoachAction[];
}

function stanceOf(list: CoachInsight[]): AdvisorView["stance"] {
  if (list.some((i) => i.severity === "alert")) return "alarm";
  if (list.some((i) => i.severity === "warn")) return "concern";
  return "ok";
}

export function ruleAdvisors(m: Molecule, v: FlowView, insights: CoachInsight[]): AdvisorView[] {
  const by = (r: AdvisorRole) => insights.filter((i) => i.role === r);
  const contribution = v.econ.reduce((s, e) => s + e.contributionPerMonth, 0);
  const cmr = v.monthlyRevenue > 0 ? contribution / v.monthlyRevenue : 0;
  const f = founderStats(m);
  const payroll = m.atoms.reduce((s, a) => (a.enabled && a.kind === "TIME_CAPACITY" ? s + a.people * a.salaryPerPersonMonth * (1 + a.sideCostRate) : s), 0);

  const cfoPoints = [
    t("Kassa vuoden lopussa {end}, pohja {min}.", { end: money(v.sim.endCash), min: money(v.sim.minCash) }),
    v.be.marginOfSafety !== null ? t("Pelivara kannattavuusrajaan {pct}.", { pct: pct(v.be.marginOfSafety) }) : t("Kannattavuusrajaa ei voi laskea."),
    v.hasInvoicing ? t("Asiakkaiden maksuaika {n} päivää.", { n: m.credit.customerTermsDays }) : t("Rahat tulevat kassaan heti."),
  ];
  const first = v.econ[0];
  const tol = first ? atomPriceTolerance(first, 0.1) : null;
  const salesPoints = [
    t("Myynti {amount} / kk, myyntikate {pct}.", { amount: money(v.monthlyRevenue), pct: pct(cmr) }),
    tol && tol.maxVolumeLoss !== null ? t("Jos hinta nousee 10 %, myynnistä saa pudota {pct} ennen kuin kate pienenee.", { pct: pct(tol.maxVolumeLoss) }) : "",
    v.econ.some((e) => e.demandAssumed) ? t("Osa kysynnästä on vielä oletus – varmista se asiakkailta.") : "",
  ].filter(Boolean);
  const b = v.bottleneck;
  const opsPoints = [
    b && b.bottleneckRatio !== null ? t("Kapasiteetin käyttö {pct}.", { pct: pct(Math.min(1, b.bottleneckRatio)) }) : t("Kapasiteettia ei ole rajattu."),
    t("Muuttuvat kulut {amount} / kk.", { amount: money(v.monthlyVariable) }),
  ];
  const peoplePoints = [
    f.salarySource === "none" ? t("Yrittäjän omaa palkkaa ei ole mallissa.") : t("Oma palkka {salary} / kk, tuntipalkka {wage}.", { salary: money(f.ownSalary), wage: money(f.hourlyWage) }),
    t("Viikkotunnit {h}: {level}.", { h: num(f.weeklyHours, 0), level: hoursLevelLabel(f.hoursLevel) }),
    payroll > 0 && v.monthlyRevenue > 0 ? t("Palkat ovat {pct} myynnistä.", { pct: pct(payroll / v.monthlyRevenue) }) : "",
  ].filter(Boolean);

  const make = (role: AdvisorRole, points: string[]): AdvisorView => {
    const list = by(role);
    const stance = stanceOf(list);
    const summary = list[0]?.title ?? (stance === "ok" ? t("Ei huomautettavaa.") : "");
    return { role, stance, summary, points: [...list.slice(0, 2).map((i) => i.body), ...points], actions: list.flatMap((i) => i.actions).slice(0, 3) };
  };
  return [make("cfo", cfoPoints), make("sales", salesPoints), make("ops", opsPoints), make("people", peoplePoints)];
}
