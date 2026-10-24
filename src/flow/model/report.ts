/**
 * APEX Studio — liiketoimintasuunnitelman raportti (`src/flow/model/report.ts`).
 *
 * Tuottaa mallista Markdown-raportin rahoittajalle, pankille tai omaan käyttöön.
 * Raportti kertoo luvut, oletukset ja niiden alkuperän sekä rajoitukset.
 */
import type { Molecule } from "../kernel/types.ts";
import type { EnterpriseGraph, FactorRef } from "../graph/types.ts";
import { migrateMoleculeToGraph } from "../graph/migrate.ts";
import { ATOM_KIND_LABELS } from "../kernel/presets.ts";
import { atomPriceTolerance, customerTermsImpact, stressTest } from "../kernel/sensitivity.ts";
import { buildView, unit } from "./view.ts";
import { checklistView, type ChecklistState } from "./launchpad.ts";
import { founderStats } from "./founder.ts";
import { compareScenarios, type Scenario } from "./scenarios.ts";
import { describeEventEffects } from "./seasons.ts";
import { getProvenance, sourceLabel } from "./provenance.ts";
import { leversFor } from "./levers.ts";
import { eur, int, money, monthName, num, pct } from "./format.ts";
import { getLocale, t } from "../i18n/index.ts";

const row = (cells: string[]) => `| ${cells.join(" | ")} |`;
const sep = (n: number) => `|${" --- |".repeat(n)}`;

export interface ReportInput {
  molecule: Molecule;
  checklist: ChecklistState;
  scenarios: Scenario[];
  graph?: EnterpriseGraph;
}

export function buildReport({ molecule: m, checklist, scenarios, graph }: ReportInput): string {
  const v = buildView(m);
  const g = graph ?? migrateMoleculeToGraph(m);
  const cl = checklistView(m, v, checklist);
  const f = founderStats(m);
  const date = new Date().toLocaleDateString(getLocale() === "en" ? "en-GB" : "fi-FI");
  const out: string[] = [];

  out.push(`# ${m.name}`);
  out.push(t("*Liiketoimintasuunnitelman laskelmat · APEX Studio · {date}*", { date }));
  out.push("");
  out.push(`## ${t("Yhteenveto")}`);
  for (const h of v.headlines) out.push(`- **${h.label}:** ${h.value} (${h.sub})`);
  out.push(`- **${t("Myynti")}:** ${t("{amount} / kk", { amount: money(v.monthlyRevenue) })}`);
  out.push(`- **${t("Kulut")}:** ${t("{amount} / kk", { amount: money(v.monthlyFixed + v.monthlyVariable) })}`);
  out.push(`- **${t("Tulos 12 kk")}:** ${money(v.sim.totals.operatingProfit)}`);
  out.push("");

  out.push(`## ${t("Tulovirrat")}`);
  out.push(row([t("Tulovirta"), t("Tyyppi"), t("Määrä / kk"), t("Hinta"), t("Myynti / kk"), t("Myyntikate")]));
  out.push(sep(6));
  for (const e of v.econ) {
    const a = m.atoms.find((x) => x.id === e.atomId)!;
    out.push(row([e.label, t(ATOM_KIND_LABELS[a.kind].title), `${int(e.volume)} ${unit(e)}`, eur(e.unitPrice), money(e.revenuePerMonth), pct(e.contributionMarginRatio)]));
  }
  out.push("");

  out.push(`## ${t("Kiinteät kulut")}`);
  out.push(row([t("Kulu"), t("€ / kk"), t("Maksupäivä")]));
  out.push(sep(3));
  for (const c of m.fixedCosts) out.push(row([c.label, money(c.amountPerMonth), String(c.dayOfMonth)]));
  for (const a of m.atoms) {
    if (a.enabled && a.kind === "TIME_CAPACITY") out.push(row([`${a.label}: ${t("palkat")} (${a.people} × ${money(a.salaryPerPersonMonth)})`, money(a.people * a.salaryPerPersonMonth * (1 + a.sideCostRate)), String(m.payrollDay)]));
  }
  out.push("");

  out.push(`## ${t("12 kuukauden laskelma")}`);
  out.push(row([t("kk"), t("Myynti"), t("Kulut"), t("Tulos"), t("Kassa lopussa")]));
  out.push(sep(5));
  for (const mo of v.sim.months) {
    const label = v.varies ? `${mo.month + 1} (${monthName(mo.calendarMonth)})` : String(mo.month + 1);
    out.push(row([label, money(mo.revenue), money(mo.variableCosts + mo.fixedCosts), money(mo.operatingProfit), money(mo.endCash)]));
  }
  out.push("");

  out.push(`## ${t("Kannattavuus ja herkkyys")}`);
  if (v.be.breakEvenRevenuePerMonth !== null) out.push(`- ${t("Kannattavuusraja")}: ${t("{amount} / kk", { amount: money(v.be.breakEvenRevenuePerMonth) })}`);
  if (v.be.marginOfSafety !== null) out.push(`- ${t("Pelivara")}: ${pct(v.be.marginOfSafety)}`);
  for (const e of v.econ) {
    const up = atomPriceTolerance(e, 0.1);
    if (up.maxVolumeLoss !== null) out.push(`- ${t("{label}: hinta +10 % → myynnistä saa pudota {pct} ennen kuin kate pienenee.", { label: e.label, pct: pct(up.maxVolumeLoss) })}`);
  }
  out.push("");
  out.push(`### ${t("Stressitestit")}`);
  out.push(row([t("Tilanne"), t("Kassa vuoden lopussa"), t("Kassa loppuu")]));
  out.push(sep(3));
  const stresses: [string, Parameters<typeof stressTest>[1]][] = [
    [t("Nykyinen suunnitelma"), {}],
    [t("Myynti −25 %"), { volumeChange: -0.25 }],
    [t("Hinnat −10 %"), { priceChange: -0.1 }],
    [t("Kiinteät kulut +15 %"), { fixedCostChange: 0.15 }],
  ];
  for (const [label, s] of stresses) {
    const r = stressTest(m, s).stressed;
    out.push(row([label, money(r.endCash), r.cashOutDay === null ? t("ei") : t("päivänä {day}", { day: r.cashOutDay + 1 })]));
  }
  if (v.hasInvoicing) {
    out.push("");
    out.push(`### ${t("Asiakkaan maksuajan vaikutus")}`);
    out.push(row([t("Maksuaika"), t("Kassan pohja"), t("Kassa loppuu")]));
    out.push(sep(3));
    for (const s of customerTermsImpact(m)) out.push(row([t("{n} pv", { n: s.customerTermsDays }), money(s.minCash), s.cashOutDay === null ? t("ei") : t("päivänä {day}", { day: s.cashOutDay + 1 })]));
  }
  out.push("");

  if ((m.events ?? []).length > 0 || v.varies) {
    out.push(`## ${t("Kausivaihtelu ja tapahtumat")}`);
    if ((m.seasonality ?? []).some((x) => x !== 1)) out.push(`- ${t("Kausikertoimet")}: ${(m.seasonality ?? []).map((x, i) => `${monthName(i)} ${num(x, 2)}`).join(", ")}`);
    for (const e of m.events ?? []) out.push(`- ${e.title}: ${t("kuukausi {start}, kesto {n} kk", { start: e.startMonth + 1, n: e.durationMonths })} – ${describeEventEffects(e)}`);
    out.push("");
  }

  if (scenarios.length > 0) {
    out.push(`## ${t("Skenaarioiden vertailu")}`);
    out.push(row([t("Skenaario"), t("Tulos 1. kk"), t("Tulos 12 kk"), t("Kassa lopussa"), t("Kassan pohja")]));
    out.push(sep(5));
    for (const s of compareScenarios(m, t("Nykyinen"), scenarios)) out.push(row([s.name, money(s.firstMonthProfit), money(s.totalProfit), money(s.endCash), money(s.minCash)]));
    out.push("");
  }

  out.push(`## ${t("Yrittäjä")}`);
  out.push(`- ${t("Oma palkka")}: ${f.salarySource === "none" ? t("ei mallissa") : t("{amount} / kk", { amount: money(f.ownSalary) })}`);
  out.push(`- ${t("Viikkotunnit")}: ${num(f.weeklyHours, 0)} · ${t("tuntipalkka")} ${money(f.hourlyWage)}`);
  out.push("");

  out.push(`## ${t("Oletukset ja niiden alkuperä")}`);
  out.push(row([t("Oletus"), t("Arvo"), t("Lähde")]));
  out.push(sep(3));
  for (const l of leversFor(m)) {
    const p = getProvenance(m, l.id);
    const value = l.format === "pct" ? pct(l.value, 1) : l.format === "eur" ? eur(l.value) : l.format === "days" ? t("{n} pv", { n: int(l.value) }) : num(l.value, 2);
    out.push(row([`${l.group}: ${t(l.label)}`, value, `${sourceLabel(p)}${p?.url ? ` ([${t("lähde")}](${p.url}))` : ""}${p?.note ? ` – ${p.note.replace(/\|/g, "/")}` : ""}`]));
  }
  out.push("");

  out.push(`## ${t("Perustamislista")}`);
  out.push(t("{done} / {total} valmiina.", { done: cl.done, total: cl.total }));
  for (const i of cl.items) out.push(`- [${i.status === "done" ? "x" : " "}] ${t(i.def.title)}`);
  out.push("");

  const resolveRef = (ref: FactorRef | undefined, fb = 0): number => {
    if (!ref) return fb;
    if ("const" in ref) return ref.const;
    return g.factors[ref.factor]?.value ?? fb;
  };
  const allNodes = Object.values(g.nodes);
  const allCaps = Object.values(g.capabilities);

  // L1-prosessikartta (EnterpriseGraph)
  out.push(`## ${t("L1-prosessikartta")}`);
  out.push(row([t("Prosessi"), t("APQC-luokka"), t("Määrittelytila"), t("Kapasiteetti / tick"), t("Vastuuhenkilö / Rooli")]));
  out.push(sep(5));
  for (const n of allNodes) {
    const ownerCap = n.owner ? g.capabilities[n.owner]?.name ?? n.owner : "–";
    const defState = n.definition ?? "defined";
    const isUndefined = defState === "named" || defState === "unknown" || n.ghost?.status === "pending";
    const primaryMod = n.physics?.[0];
    const capVal = resolveRef(primaryMod?.params.capacityPerTick, 0);
    const capText = isUndefined
      ? t("Ei laskettu, koska määrittelemätön")
      : primaryMod
        ? `${num(capVal, 1)} (${primaryMod.atom})`
        : "–";
    out.push(row([n.name, `${n.apqcCategory ?? n.band} (L${n.level})`, defState, capText, ownerCap]));
  }
  out.push("");

  // IT-järjestelmäkartta
  const itSystems = allCaps.filter((c): c is Extract<typeof c, { kind: "system" }> => c.kind === "system");
  out.push(`## ${t("IT-järjestelmäkartta")}`);
  if (itSystems.length === 0) {
    out.push(`- ${t("Ei määriteltyjä IT-järjestelmiä.")}`);
  } else {
    out.push(row([t("Järjestelmä"), t("Automaatioaste"), t("Käytettävyys"), t("Kustannus / kk"), t("Kytketyt prosessit")]));
    out.push(sep(5));
    for (const sys of itSystems) {
      const boundNodes = allNodes
        .filter((n) => n.mechanisms.some((b) => b.capability === sys.uri))
        .map((n) => n.name)
        .join(", ") || "–";
      out.push(
        row([
          sys.name,
          sys.layer,
          pct(resolveRef(sys.availability, 1), 1),
          money(resolveRef(sys.fixedCostPerTick, 0) * 30),
          boundNodes,
        ]),
      );
    }
  }
  out.push("");

  // Organisaatiokuorma ja vastuut
  const roles = allCaps.filter((c): c is Extract<typeof c, { kind: "role" }> => c.kind === "role");
  out.push(`## ${t("Organisaatiokuorma ja vastuut")}`);
  if (roles.length === 0) {
    out.push(`- ${t("Ei erillisiä organisaatiorooleja.")}`);
  } else {
    out.push(row([t("Rooli"), t("FTE"), t("Kapasiteetti / tick"), t("Kustannus / kk"), t("Vastuusolmut")]));
    out.push(sep(5));
    for (const r of roles) {
      const owned = allNodes
        .filter((n) => n.owner === r.uri || n.mechanisms.some((b) => b.capability === r.uri))
        .map((n) => n.name)
        .join(", ") || "–";
      const fte = resolveRef(r.fte, 1);
      const hrs = resolveRef(r.hoursPerFtePerTick, 8);
      const costPerFte = resolveRef(r.costPerFtePerTick, 0);
      out.push(row([r.name, num(fte, 1), num(fte * hrs, 1), money(fte * costPerFte * 30), owned]));
    }
  }
  out.push("");

  // Eksplisiittinen lista määrittelemättömistä (named / unknown / ghost) solmuista
  const undefinedNodes = allNodes.filter((n) => n.definition === "named" || n.definition === "unknown" || n.ghost?.status === "pending");
  if (undefinedNodes.length > 0) {
    out.push(`## ${t("Määrittelemättömät prosessisolmut")}`);
    for (const u of undefinedNodes) {
      out.push(`- **${u.name}** (\`${u.uri}\`, \`${u.definition ?? "named"}\`): ${t("Ei laskettu, koska määrittelemätön")}`);
    }
    out.push("");
  }

  out.push(`## ${t("Laskelman rajoitukset")}`);
  out.push(`- ${t("Summat ilman arvonlisäveroa. Tuloveroja, lainoja ja korkoja ei ole mallinnettu.")}`);
  out.push(`- ${t("Kuukausi = 30 päivää. Kysyntä ja hinnat ovat suunnitelman oletuksia, eivät ennusteita.")}`);
  out.push(`- ${t("Laskenta: päivätason kassasimulaatio, kirjanpidon täsmäytysero {amount}.", { amount: money(v.sim.reconciliationError) })}`);
  return out.join("\n");
}
