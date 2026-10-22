/**
 * APEX Flow — käyttäjäpersoonat ja näkökulmat (`src/flow/model/personas.ts`).
 *
 * Persoona kertoo, miksi käyttäjä on täällä (opiskelu, perustaminen, johtaminen...).
 * Näkökulma (linssi) rajaa näkymän yhteen osa-alueeseen: osa-aluejohtaja näkee vain
 * oman tonttinsa vivut ja luvut, ja muu yritys näkyy rajapintana.
 * Laskenta on aina sama – vain se, mitä näytetään, muuttuu.
 */
import type { Lever } from "./levers.ts";
import type { FlowView, Headline, NodeId } from "./view.ts";
import { int, money, num, pct } from "./format.ts";

export type PersonaId = "student" | "founder" | "owner" | "director" | "ceo" | "advisor" | "investor";
export type LensId = "all" | "sales" | "operations" | "finance";

export interface PersonaDef {
  id: PersonaId;
  title: string;
  hint: string;
  defaultLens: LensId;
  /** Näytetäänkö näkökulman valinta (osa-alueet). */
  lensPicker: boolean;
  /** Korostetaanko perustamislistaa. */
  launchpad: boolean;
  /** Näytetäänkö stressitestit suoraan päänäkymässä. */
  quickStress: boolean;
  /** Valmentajan opettava sävy: käsitteiden selitykset näkyvät. */
  teach: boolean;
}

export const PERSONAS: PersonaDef[] = [
  { id: "student", title: "Opiskelen", hint: "Haluan ymmärtää, miten yritys toimii", defaultLens: "all", lensPicker: false, launchpad: false, quickStress: false, teach: true },
  { id: "founder", title: "Perustan yritystä", hint: "Kokeilen liikeideaa ja valmistaudun aloittamaan", defaultLens: "all", lensPicker: false, launchpad: true, quickStress: false, teach: true },
  { id: "owner", title: "Pyöritän yritystä", hint: "Testaan hinnoittelua, rekryjä ja kassaa omilla luvuillani", defaultLens: "all", lensPicker: false, launchpad: false, quickStress: true, teach: false },
  { id: "director", title: "Johdan osa-aluetta", hint: "Simuloin vain omaa vastuualuettani", defaultLens: "sales", lensPicker: true, launchpad: false, quickStress: false, teach: false },
  { id: "ceo", title: "Johdan yritystä", hint: "Koko yrityksen kokonaiskuva ja riskit", defaultLens: "all", lensPicker: true, launchpad: false, quickStress: true, teach: false },
  { id: "advisor", title: "Neuvon asiakkaita", hint: "Käyn asiakkaan luvut läpi visuaalisesti", defaultLens: "all", lensPicker: true, launchpad: true, quickStress: true, teach: true },
  { id: "investor", title: "Arvioin rahoitusta", hint: "Stressitestaan liiketoimintasuunnitelman", defaultLens: "finance", lensPicker: true, launchpad: false, quickStress: true, teach: false },
];

export function personaDef(id: PersonaId | null | undefined): PersonaDef {
  return PERSONAS.find((p) => p.id === id) ?? PERSONAS[1];
}

export const LENS_LABELS: Record<LensId, string> = {
  all: "Koko yritys",
  sales: "Myynti",
  operations: "Toimitus",
  finance: "Talous",
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

/**
 * Vivut näkökulman mukaan. "Koko yritys" -näkymässä näytetään ensisijaiset vivut;
 * osa-alueilla kaikki osa-alueen vivut ovat näkyvissä, koska niitä on vähemmän.
 */
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
      { label: "Myynti", value: `${money(view.monthlyRevenue)} / kk`, sub: view.econ.map((e) => `${e.label} ${money(e.revenuePerMonth)}`).join(" · "), status: view.monthlyRevenue > 0 ? "ok" : "idle" },
      { label: "Myyntikate", value: pct(cmr), sub: `${money(contribution)} / kk muuttuvien kulujen jälkeen`, status: cmr < 0.2 ? "warn" : "ok" },
      lost > 0
        ? { label: "Myymättä jää", value: `${money(lost)} / kk`, sub: "toimituskyky ei riitä kaikelle kysynnälle", status: "alert" }
        : { label: "Myymättä jää", value: "0 €", sub: "toimituskyky riittää kysyntään", status: "ok" },
    ];
  }
  // Toimitus
  const b = view.bottleneck;
  const usage = b && b.bottleneckRatio !== null ? Math.min(1, b.bottleneckRatio) : null;
  const unitCosts = view.econ.map((e) => `${e.label} ${money(e.unitVariableCost)} / ${e.volumeUnit === "h" ? "h" : e.volumeUnit === "kpl" ? "kpl" : e.volumeUnit === "asiakasta" ? "asiakas" : "myynti"}`);
  return [
    {
      label: "Kapasiteetin käyttö",
      value: usage === null ? "Ei rajaa" : pct(usage),
      sub: b ? (b.demandAssumed ? "oletus: kysyntää riittää" : `${num(b.demand)} / ${num(b.capacity ?? 0)} ${b.volumeUnit}`) : "kapasiteettia ei ole rajattu",
      status: b && !b.demandAssumed && (b.bottleneckRatio ?? 0) > 1 ? "alert" : usage !== null && usage > 0.9 && !b?.demandAssumed ? "warn" : "ok",
    },
    { label: "Muuttuvat kulut", value: `${money(view.monthlyVariable)} / kk`, sub: unitCosts.join(" · ") || "–", status: "ok" },
    { label: "Kiinteät kulut", value: `${money(view.monthlyFixed)} / kk`, sub: "palkat, tilat ja muut kiinteät", status: "ok" },
  ];
}

/** Rajapintaviestit: mitä muu yritys "kertoo" osa-aluejohtajalle hänen päätöstensä seurauksista. */
export function boundaryMessages(view: FlowView, lens: LensId): string[] {
  if (lens === "all") return [];
  const out: string[] = [];
  const b = view.bottleneck;
  if (lens === "sales") {
    if (b && !b.demandAssumed && b.lostDemand > 0) {
      out.push(`Toimitus: myyntisi ylittää toimituskyvyn ${pct((b.bottleneckRatio ?? 1) - 1)}:lla – ${int(b.lostDemand)} ${b.volumeUnit} kuussa jää toimittamatta.`);
    }
    if (view.sim.cashOutDay !== null) out.push(`Talous: kassa loppuu päivänä ${view.sim.cashOutDay + 1}. Maksuehdot ja hinnoittelu vaikuttavat tähän.`);
  }
  if (lens === "operations") {
    if (b && !b.demandAssumed && b.idleCapacity > 0) out.push(`Myynti: kapasiteettia on vapaana ${num(b.idleCapacity)} ${b.volumeUnit} kuussa – myynnillä on tilaa kasvaa.`);
    if (b && !b.demandAssumed && b.lostDemand > 0) out.push(`Myynti: asiakkaita jää palvelematta – ${int(b.lostDemand)} ${b.volumeUnit} kuussa.`);
    if (view.firstMonthProfit < 0) out.push(`Talous: yritys tekee tappiota ${money(-view.firstMonthProfit)} kuussa.`);
  }
  if (lens === "finance") {
    if (view.firstMonthProfit < 0) out.push(`Myynti ja toimitus: kate ei kata kiinteitä kuluja (${money(view.firstMonthProfit)} / kk).`);
  }
  return out;
}
