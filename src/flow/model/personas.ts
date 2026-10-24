/**
 * APEX Studio — käyttäjäpersoonat ja näkökulmat (`src/flow/model/personas.ts`).
 *
 * Persoona kertoo, miksi käyttäjä on täällä (opiskelu, perustaminen, johtaminen...).
 * Näkökulma (linssi) rajaa näkymän yhteen osa-alueeseen: osa-aluejohtaja näkee vain
 * oman tonttinsa vivut ja luvut, ja muu yritys näkyy rajapintana.
 * Laskenta on aina sama – vain se, mitä näytetään, muuttuu.
 */
import type { Lever } from "./levers.ts";
import { unit, type FlowView, type Headline, type NodeId } from "./view.ts";
import { int, money, num, pct } from "./format.ts";
import { msg, t } from "../i18n/index.ts";
import type { EnterpriseGraph, VentureMaturity } from "../graph/types.ts";
import type { SimulationRun } from "../graph/simulate.ts";

export type PersonaId = "student" | "founder" | "owner" | "director" | "ceo" | "advisor" | "investor";
export type LensId = "all" | "sales" | "operations" | "finance";
export type XRayLensId = "ops" | "financial" | "it" | "org";
export type InspectorTabId = "physics" | "finance" | "org" | "it" | "links" | "provenance";

export const XRAY_LENS_LABELS: Record<XRayLensId, string> = {
  ops: msg("Toimitusvirta"),
  financial: msg("Talouskate (Sankey)"),
  it: msg("IT ja data"),
  org: msg("Organisaatio ja vastuu"),
};

export const INSPECTOR_TAB_LABELS: Record<InspectorTabId, string> = {
  physics: msg("Fysiikka"),
  finance: msg("Talous"),
  org: msg("Org"),
  it: msg("IT"),
  links: msg("Linkit"),
  provenance: msg("Alkuperä"),
};

export const MATURITY_LABELS: Record<VentureMaturity, string> = {
  0: msg("0 Idea"),
  1: msg("1 Konsepti"),
  2: msg("2 Toimintamalli"),
  3: msg("3 Toiminta"),
};

export const MATURITY_HINTS: Record<VentureMaturity, string> = {
  0: msg("Kyvykkyyskartta, avoimet kysymykset ja alustava kulukartoitus ilman prosessioletuksia"),
  1: msg("Kyvykkyyskartta, puuteanalyysi ja karkeat kustannushaarukat"),
  2: msg("Ylätason arvovirta (L0–L1), yksikkötalous ja kassan riittävyys"),
  3: msg("Täysi prosessigraafi (L0–L5), puskurit, pääkirja ja skenaariot"),
};

export interface PersonaDef {
  id: PersonaId;
  /** Käännösavaimet. */
  title: string;
  hint: string;
  defaultLens: LensId;
  /** Oletuskypsyystaso (TSD 2.5). */
  defaultMaturity: VentureMaturity;
  /** Oletus-röntgenlinssi (TSD 2.5). */
  defaultXRayLens: XRayLensId;
  /** Oletus-zoom-taso prosentteina (TSD 2.5 & 3.5). */
  defaultZoom: number;
  /** Tarkastimen välilehtien järjestys persoonan mukaan (TSD 2.5). */
  inspectorTabs: InspectorTabId[];
  /** Näytetäänkö näkökulman valinta (osa-alueet). */
  lensPicker: boolean;
  /** Korostetaanko perustamislistaa. */
  launchpad: boolean;
  /** Näytetäänkö stressitestit suoraan päänäkymässä. */
  quickStress: boolean;
  /** Valmentajan opettava sävy: käsitteiden selitykset näkyvät. */
  teach: boolean;
  /** Työkalurivin painikkeet tässä järjestyksessä (muut löytyvät "Lisää"-valikosta). */
  tools: string[];
}

export const PERSONAS: PersonaDef[] = [
  {
    id: "student",
    title: msg("Opiskelen"),
    hint: msg("Haluan ymmärtää, miten yritys toimii"),
    defaultLens: "all",
    defaultMaturity: 3,
    defaultXRayLens: "ops",
    defaultZoom: 45,
    inspectorTabs: ["physics", "finance", "org", "it", "links", "provenance"],
    lensPicker: false,
    launchpad: false,
    quickStress: false,
    teach: true,
    tools: ["tasks", "scenarios", "seasons", "advisors", "widgets"],
  },
  {
    id: "founder",
    title: msg("Perustan yritystä"),
    hint: msg("Kokeilen liikeideaa ja valmistaudun aloittamaan"),
    defaultLens: "all",
    defaultMaturity: 0,
    defaultXRayLens: "ops",
    defaultZoom: 40,
    inspectorTabs: ["physics", "finance", "links", "org", "it", "provenance"],
    lensPicker: false,
    launchpad: true,
    quickStress: false,
    teach: true,
    tools: ["founder", "scenarios", "seasons", "advisors", "market", "report"],
  },
  {
    id: "owner",
    title: msg("Pyöritän yritystä"),
    hint: msg("Testaan hinnoittelua, rekryjä ja kassaa omilla luvuillani"),
    defaultLens: "all",
    defaultMaturity: 3,
    defaultXRayLens: "financial",
    defaultZoom: 45,
    inspectorTabs: ["finance", "physics", "org", "it", "links", "provenance"],
    lensPicker: false,
    launchpad: false,
    quickStress: true,
    teach: false,
    tools: ["actuals", "scenarios", "founder", "seasons", "widgets", "report"],
  },
  {
    id: "director",
    title: msg("Johdan osa-aluetta"),
    hint: msg("Simuloin vain omaa vastuualuettani"),
    defaultLens: "sales",
    defaultMaturity: 3,
    defaultXRayLens: "ops",
    defaultZoom: 75,
    inspectorTabs: ["physics", "org", "it", "finance", "links", "provenance"],
    lensPicker: true,
    launchpad: false,
    quickStress: false,
    teach: false,
    tools: ["goals", "scenarios", "widgets", "advisors"],
  },
  {
    id: "ceo",
    title: msg("Johdan yritystä"),
    hint: msg("Koko yrityksen kokonaiskuva ja riskit"),
    defaultLens: "all",
    defaultMaturity: 3,
    defaultXRayLens: "financial",
    defaultZoom: 45,
    inspectorTabs: ["finance", "physics", "org", "it", "links", "provenance"],
    lensPicker: true,
    launchpad: false,
    quickStress: true,
    teach: false,
    tools: ["scenarios", "advisors", "goals", "seasons", "report", "widgets"],
  },
  {
    id: "advisor",
    title: msg("Neuvon asiakkaita"),
    hint: msg("Käyn asiakkaan luvut läpi visuaalisesti"),
    defaultLens: "all",
    defaultMaturity: 3,
    defaultXRayLens: "financial",
    defaultZoom: 45,
    inspectorTabs: ["provenance", "finance", "physics", "org", "it", "links"],
    lensPicker: true,
    launchpad: true,
    quickStress: true,
    teach: true,
    tools: ["actuals", "scenarios", "advisors", "report", "founder"],
  },
  {
    id: "investor",
    title: msg("Arvioin rahoitusta"),
    hint: msg("Stressitestaan liiketoimintasuunnitelman"),
    defaultLens: "finance",
    defaultMaturity: 3,
    defaultXRayLens: "financial",
    defaultZoom: 40,
    inspectorTabs: ["finance", "provenance", "physics", "links", "org", "it"],
    lensPicker: true,
    launchpad: false,
    quickStress: true,
    teach: false,
    tools: ["scenarios", "seasons", "report", "market"],
  },
];

export const ALL_TOOLS = ["tasks", "scenarios", "founder", "goals", "seasons", "advisors", "market", "widgets", "actuals", "report"];

export function personaDef(id: PersonaId | null | undefined): PersonaDef {
  return PERSONAS.find((p) => p.id === id) ?? PERSONAS[1];
}

/**
 * Palauttaa persoonan oletuskypsyystason (TSD 2.5):
 * - Founder -> 0 (Idea)
 * - Student -> 3 (valmiilla esimerkkimallilla) tai 0 (tyhjästä aloittaessa)
 * - Owner / Director / CEO / Advisor / Investor -> 3
 */
export function defaultMaturityForPersona(
  persona: PersonaId | null | undefined,
  hasPresetModel = true,
): VentureMaturity {
  if (persona === "founder") return 0;
  if (persona === "student") return hasPresetModel ? 3 : 0;
  return 3;
}

/**
 * Kypsyystasojen 0–1 KPI-nauha (TSD 2.3 & 2.5):
 * Näyttää kassavirran sijaan puuttuvien kyvykkyyksien määrän, tunnistetut/avoimet kustannukset ja avoimet kysymykset.
 */
export function maturityHeadlines(graph: EnterpriseGraph, _run?: SimulationRun): Headline[] {
  const bcs = Object.values(graph.businessCapabilities ?? {});
  const missingCount = bcs.filter((bc) => bc.status === "missing").length;
  const unclearCount = bcs.filter((bc) => bc.status === "unclear").length;
  const knownCount = bcs.filter((bc) => bc.status === "known").length;
  const gapTotal = missingCount + unclearCount;

  let estimatedMonthlyCost = 0;
  let openCostItems = 0;
  let openQuestions = 0;
  let obligations = 0;

  for (const bc of bcs) {
    for (const note of bc.notes) {
      if (note.kind === "cost") {
        if (note.amount) {
          const val = "const" in note.amount ? note.amount.const : (graph.factors[note.amount.factor]?.value ?? 0);
          if (val > 0) estimatedMonthlyCost += val;
          else openCostItems += 1;
        } else {
          openCostItems += 1;
        }
      } else if (note.kind === "question") {
        openQuestions += 1;
      } else if (note.kind === "obligation" || note.kind === "risk") {
        obligations += 1;
      }
    }
  }

  return [
    {
      label: t("Kyvykkyysvajeet"),
      value: t("{n} kpl", { n: int(gapTotal) }),
      sub: t("{missing} puuttuu · {unclear} epäselvä · {known} kunnossa", {
        missing: int(missingCount),
        unclear: int(unclearCount),
        known: int(knownCount),
      }),
      status: missingCount > 0 ? "alert" : unclearCount > 0 ? "warn" : "ok",
    },
    {
      label: t("Kustannusarvio ja avoimet kulut"),
      value: estimatedMonthlyCost > 0 ? t("{amount} / kk", { amount: money(estimatedMonthlyCost) }) : t("Ei arviota"),
      sub:
        openCostItems > 0
          ? t("{n} kuluerää vaatii vielä hinnoittelun", { n: int(openCostItems) })
          : t("tunnistetut alustavat kuukausikulut"),
      status: openCostItems > 0 ? "warn" : "ok",
    },
    {
      label: t("Avoimet kysymykset ja velvoitteet"),
      value: t("{n} avointa", { n: int(openQuestions + obligations) }),
      sub: t("{q} kysymystä · {o} velvoitetta tai riskiä", {
        q: int(openQuestions),
        o: int(obligations),
      }),
      status: openQuestions + obligations > 2 ? "warn" : "ok",
    },
  ];
}

export const LENS_LABELS: Record<LensId, string> = {
  all: msg("Koko yritys"),
  sales: msg("Myynti"),
  operations: msg("Toimitus"),
  finance: msg("Talous"),
};

const SALES_FIELDS = new Set([
  "hourlyRate", "unitPrice", "unitsPerMonth", "pricePerMonth", "newPerMonth", "churnRateMonthly",
  "cacPerNew", "averageTicket", "visitorsPerDay", "conversionRate", "startingSubscribers", "customerTermsDays",
]);
const OPS_FIELDS = new Set([
  "utilization", "people", "hoursPerWeek", "variableCostPerHour", "unitCost", "spoilageRate", "stockCoverDays",
  "costPerSubscriberMonth", "costPerSale", "openDaysPerMonth", "salaryPerPersonMonth", "sideCostRate", "supplierTermsDays",
]);
const FINANCE_FIELDS = new Set(["customerTermsDays", "supplierTermsDays", "openingCash", "hourlyRate", "unitPrice", "pricePerMonth", "averageTicket"]);

/** Solmut, jotka ovat näkökulman fokuksessa. Muut näytetään himmennettyinä rajapintoina. */
export function lensNodes(lens: LensId): NodeId[] {
  switch (lens) {
    case "sales":
      return ["demand", "capacity"];
    case "operations":
      return ["capacity", "costs"];
    case "finance":
      return ["receivables", "cash", "costs"];
    default:
      return ["demand", "capacity", "receivables", "cash", "costs"];
  }
}

/** Vivut näkökulman mukaan. Osa-alueilla kaikki osa-alueen vivut ovat näkyvissä. */
export function leversForLens(levers: Lever[], lens: LensId): Lever[] {
  if (lens === "all") return levers;
  const set = lens === "sales" ? SALES_FIELDS : lens === "operations" ? OPS_FIELDS : FINANCE_FIELDS;
  return levers.filter((l) => set.has(l.field)).map((l) => ({ ...l, primary: true }));
}

/** Näkökulman pääluvut. */
export function lensHeadlines(view: FlowView, lens: LensId): Headline[] {
  if (lens === "all" || lens === "finance") return view.headlines;
  if (lens === "sales") {
    const lost = view.econ.reduce((s, e) => s + e.lostDemand * e.unitPrice, 0);
    const contribution = view.econ.reduce((s, e) => s + e.contributionPerMonth, 0);
    const cmr = view.monthlyRevenue > 0 ? contribution / view.monthlyRevenue : 0;
    return [
      { label: t("Myynti"), value: t("{amount} / kk", { amount: money(view.monthlyRevenue) }), sub: view.econ.map((e) => `${e.label} ${money(e.revenuePerMonth)}`).join(" · "), status: view.monthlyRevenue > 0 ? "ok" : "idle" },
      { label: t("Myyntikate"), value: pct(cmr), sub: t("{amount} / kk muuttuvien kulujen jälkeen", { amount: money(contribution) }), status: cmr < 0.2 ? "warn" : "ok" },
      lost > 0
        ? { label: t("Myymättä jää"), value: t("{amount} / kk", { amount: money(lost) }), sub: t("toimituskyky ei riitä kaikelle kysynnälle"), status: "alert" }
        : { label: t("Myymättä jää"), value: money(0), sub: t("toimituskyky riittää kysyntään"), status: "ok" },
    ];
  }
  const b = view.bottleneck;
  const usage = b && b.bottleneckRatio !== null ? Math.min(1, b.bottleneckRatio) : null;
  const unitCosts = view.econ.map((e) => `${e.label} ${money(e.unitVariableCost)} / ${unit(e)}`);
  return [
    {
      label: t("Kapasiteetin käyttö"),
      value: usage === null ? t("Ei rajaa") : pct(usage),
      sub: b ? (b.demandAssumed ? t("oletus: kysyntää riittää") : `${num(b.demand)} / ${num(b.capacity ?? 0)} ${unit(b)}`) : t("kapasiteettia ei ole rajattu"),
      status: b && !b.demandAssumed && (b.bottleneckRatio ?? 0) > 1 ? "alert" : usage !== null && usage > 0.9 && !b?.demandAssumed ? "warn" : "ok",
    },
    { label: t("Muuttuvat kulut"), value: t("{amount} / kk", { amount: money(view.monthlyVariable) }), sub: unitCosts.join(" · ") || "–", status: "ok" },
    { label: t("Kiinteät kulut"), value: t("{amount} / kk", { amount: money(view.monthlyFixed) }), sub: t("palkat, tilat ja muut kiinteät"), status: "ok" },
  ];
}

/** Rajapintaviestit: mitä muu yritys "kertoo" osa-aluejohtajalle hänen päätöstensä seurauksista. */
export function boundaryMessages(view: FlowView, lens: LensId): string[] {
  if (lens === "all") return [];
  const out: string[] = [];
  const b = view.bottleneck;
  if (lens === "sales") {
    if (b && !b.demandAssumed && b.lostDemand > 0) {
      out.push(t("Toimitus: myyntisi ylittää toimituskyvyn {pct}:lla – {n} {unit} kuussa jää toimittamatta.", { pct: pct((b.bottleneckRatio ?? 1) - 1), n: int(b.lostDemand), unit: unit(b) }));
    }
    if (view.sim.cashOutDay !== null) out.push(t("Talous: kassa loppuu päivänä {day}. Maksuehdot ja hinnoittelu vaikuttavat tähän.", { day: view.sim.cashOutDay + 1 }));
  }
  if (lens === "operations") {
    if (b && !b.demandAssumed && b.idleCapacity > 0) out.push(t("Myynti: kapasiteettia on vapaana {n} {unit} kuussa – myynnillä on tilaa kasvaa.", { n: num(b.idleCapacity), unit: unit(b) }));
    if (b && !b.demandAssumed && b.lostDemand > 0) out.push(t("Myynti: asiakkaita jää palvelematta – {n} {unit} kuussa.", { n: int(b.lostDemand), unit: unit(b) }));
    if (view.firstMonthProfit < 0) out.push(t("Talous: yritys tekee tappiota {amount} kuussa.", { amount: money(-view.firstMonthProfit) }));
  }
  if (lens === "finance" && view.firstMonthProfit < 0) {
    out.push(t("Myynti ja toimitus: kate ei kata kiinteitä kuluja ({amount} / kk).", { amount: money(view.firstMonthProfit) }));
  }
  return out;
}
