/**
 * APEX Flow — proaktiivinen valmentaja (`src/flow/model/coach.ts`).
 *
 * Sääntöpohjainen valmentaja lukee simulaation tuloksen ja nostaa esiin tärkeimmät
 * havainnot luvuin perusteltuina. Jokaisessa ehdotuksessa on valmis toimenpide
 * (`FlowCommand`), jonka käyttäjä voi kokeilla yhdellä klikkauksella.
 * Valmentaja ei tarvitse kielimallia: se toimii aina, myös ilman API-avainta.
 */
import type { AtomEconomics, Molecule, RecurringSubAtom, TimeCapacityAtom } from "../kernel/types.ts";
import { simulate } from "../kernel/simulate.ts";
import { hireBreakEven, withCustomerTerms } from "../kernel/sensitivity.ts";
import type { FlowCommand } from "./commands.ts";
import type { FlowView } from "./view.ts";
import type { ChecklistView } from "./launchpad.ts";
import type { PersonaId } from "./personas.ts";
import { money, num, pct } from "./format.ts";

export type InsightSeverity = "alert" | "warn" | "tip" | "good";

export interface CoachAction {
  label: string;
  commands: FlowCommand[];
}

export interface CoachInsight {
  id: string;
  severity: InsightSeverity;
  title: string;
  body: string;
  /** Lyhyt selitys käsitteestä oppijoille. */
  learn?: string;
  actions: CoachAction[];
}

const PRICE_FIELD: Record<AtomEconomics["kind"], string> = {
  TIME_CAPACITY: "hourlyRate",
  PHYSICAL_MATTER: "unitPrice",
  RECURRING_SUB: "pricePerMonth",
  TRANSACTIONAL_TRADE: "averageTicket",
};

export function priceFieldFor(kind: AtomEconomics["kind"]): string {
  return PRICE_FIELD[kind];
}

const ORDER: Record<InsightSeverity, number> = { alert: 0, warn: 1, tip: 2, good: 3 };

function cashInsight(m: Molecule, v: FlowView): CoachInsight | null {
  if (v.sim.cashOutDay === null) return null;
  const day = v.sim.cashOutDay + 1;
  const actions: CoachAction[] = [];
  let body = `Kassa menee miinukselle päivänä ${day} ja pohja on ${money(v.sim.minCash)}.`;
  if (v.hasInvoicing && v.firstMonthProfit > 0) {
    const fix = [21, 14, 7, 0].filter((d) => d < m.credit.customerTermsDays).find((d) => simulate(withCustomerTerms(m, d)).cashOutDay === null);
    body += ` Yritys on kannattava, mutta asiakkaiden ${m.credit.customerTermsDays} päivän maksuaika tuo rahat liian myöhään.`;
    if (fix !== undefined) {
      actions.push({ label: `Kokeile ${fix} pv maksuaikaa`, commands: [{ type: "set_credit", field: "customerTermsDays", value: fix }] });
    }
  } else if (v.firstMonthProfit <= 0) {
    body += " Syy on se, että kulut ovat suuremmat kuin myynnin kate – lisärahoitus vain siirtää ongelmaa.";
  }
  const need = Math.ceil((-v.sim.minCash + v.monthlyFixed * 0.5) / 500) * 500;
  if (need > 0) {
    actions.push({
      label: `Lisää alkukassaa ${money(need)}`,
      commands: [{ type: "set_credit", field: "openingCash", value: m.credit.openingCash + need }],
    });
  }
  return {
    id: "cash-out",
    severity: "alert",
    title: `Kassa loppuu päivänä ${day}`,
    body,
    learn: "Kassavirta ja tulos ovat eri asioita: tulos kertoo, kannattaako toiminta, kassa kertoo, riittävätkö rahat maksuihin juuri nyt.",
    actions,
  };
}

function lossInsight(m: Molecule, v: FlowView): CoachInsight | null {
  if (v.isEmpty || v.firstMonthProfit >= 0) return null;
  const gap = -v.firstMonthProfit;
  const actions: CoachAction[] = [];
  let body = `Kuukauden tulos on ${money(v.firstMonthProfit)}. Katetta puuttuu ${money(gap)} kuussa.`;
  if (v.econ.length === 1) {
    const e = v.econ[0];
    const unitMargin = e.unitPrice - e.unitVariableCost;
    if (e.volume > 0) {
      const neededPrice = e.unitVariableCost + (unitMargin * e.volume + gap) / e.volume;
      const factor = neededPrice / Math.max(1e-9, e.unitPrice);
      body += ` Samalla määrällä hinnan pitäisi olla ${money(neededPrice)} (nyt ${money(e.unitPrice)}).`;
      if (factor < 1.6) {
        actions.push({ label: `Kokeile hintaa ${money(Math.ceil(neededPrice))}`, commands: [{ type: "set_atom_field", atomId: e.atomId, field: priceFieldFor(e.kind), value: Math.ceil(neededPrice) }] });
      }
    }
    if (unitMargin > 0) body += ` Tai myyntiä pitäisi olla ${num(gap / unitMargin)} ${e.volumeUnit} enemmän kuussa.`;
  }
  if (v.lastMonthProfit > 0) body += ` Hyvä uutinen: 12. kuukautena tulos on jo ${money(v.lastMonthProfit)}.`;
  actions.push({ label: "Katso kulut", commands: [{ type: "open_panel", panel: "costs" }] });
  return { id: "loss", severity: v.lastMonthProfit > 0 ? "warn" : "alert", title: "Yritys tekee tappiota", body, actions };
}

function bottleneckInsight(m: Molecule, v: FlowView): CoachInsight | null {
  const b = v.bottleneck;
  if (!b || b.lostDemand <= 0 || b.demandAssumed) return null;
  const lostShare = b.lostDemand / b.demand;
  const actions: CoachAction[] = [];
  let body = `Kysyntää jää palvelematta ${num(b.lostDemand)} ${b.volumeUnit} kuussa (${money(b.lostDemand * b.unitPrice)} myyntiä).`;
  const raise = Math.min(0.25, Math.floor(lostShare * 20) / 20) || 0.05;
  body += ` Kun kysyntää on yli kapasiteetin, voit nostaa hintaa: vaikka ${pct(lostShare)} asiakkaista jäisi pois, myyt silti saman määrän.`;
  actions.push({ label: `Kokeile hintaa +${pct(raise)}`, commands: [{ type: "scale_atom_field", atomId: b.atomId, field: priceFieldFor(b.kind), factor: 1 + raise }] });
  const atom = m.atoms.find((a) => a.id === b.atomId);
  if (atom?.kind === "TIME_CAPACITY") {
    const t = atom as TimeCapacityAtom;
    const hire = hireBreakEven(t, t.salaryPerPersonMonth || 3200, t.sideCostRate || 0.21);
    if (hire.hoursNeededPerMonth !== null) {
      const pays = b.lostDemand >= hire.hoursNeededPerMonth;
      body += ` Uusi tekijä maksaa itsensä ${num(hire.hoursNeededPerMonth)} laskutetulla tunnilla kuussa – ${pays ? "menetetty kysyntä riittää siihen" : "menetetty kysyntä ei vielä riitä siihen"}.`;
      if (pays) actions.push({ label: "Palkkaa uusi tekijä", commands: [{ type: "set_atom_field", atomId: t.id, field: "people", value: t.people + 1 }] });
    }
  }
  return {
    id: "bottleneck",
    severity: "warn",
    title: "Toimituskyky on pullonkaula",
    body,
    learn: "Pullonkaula on se kohta, joka rajoittaa koko ketjun läpimenoa. Sen ohittaminen kasvattaa myyntiä enemmän kuin minkään muun kohdan parantaminen.",
    actions,
  };
}

function idleInsight(m: Molecule, v: FlowView): CoachInsight | null {
  const idle = v.econ.find((e) => e.kind === "TIME_CAPACITY" && !e.demandAssumed && e.capacity !== null && e.idleCapacity > e.capacity * 0.2);
  if (!idle) return null;
  const lostEur = idle.idleCapacity * idle.unitPrice;
  return {
    id: "idle",
    severity: "tip",
    title: "Laskuttamatonta aikaa jää paljon",
    body: `Kalenterissa on ${num(idle.idleCapacity)} h kuussa myymättä – se on ${money(lostEur)} myyntiä, joka ei palaa koskaan. Kiinteä kuukausisopimus (ylläpito, tuki) tasaa kuormaa ja tuo tasaisen rahavirran.`,
    learn: "Asiantuntijatyössä myymätön tunti on samaa kuin pilaantunut tavara kaupassa: se menetetään lopullisesti.",
    actions: [
      {
        label: "Lisää kuukausisopimukset",
        commands: [{ type: "add_atom", kind: "RECURRING_SUB", label: "Ylläpitosopimukset", params: { startingSubscribers: 0, newPerMonth: 1, churnRateMonthly: 0.02, pricePerMonth: 500, costPerSubscriberMonth: 0, cacPerNew: 300 } }],
      },
      { label: "Syötä kysyntä", commands: [{ type: "open_panel", panel: "demand" }] },
    ],
  };
}

function marginInsight(v: FlowView): CoachInsight | null {
  const mos = v.be.marginOfSafety;
  if (mos === null || mos < 0 || mos >= 0.15 || v.firstMonthProfit < 0) return null;
  return {
    id: "thin-margin",
    severity: "warn",
    title: "Pelivara on ohut",
    body: `Myynti on vain ${pct(mos)} kannattavuusrajan yläpuolella. Jo ${pct(mos)} pudotus myynnissä vie yrityksen tappiolle.`,
    actions: [{ label: "Stressitestaa −15 %", commands: [{ type: "stress", stress: { volumeChange: -0.15 } }] }],
  };
}

function subscriptionInsight(m: Molecule): CoachInsight | null {
  const sub = m.atoms.find((a): a is RecurringSubAtom => a.enabled && a.kind === "RECURRING_SUB");
  if (!sub || sub.cacPerNew <= 0) return null;
  const margin = sub.pricePerMonth - sub.costPerSubscriberMonth;
  if (margin <= 0) return null;
  const payback = sub.cacPerNew / margin;
  const ltv = sub.churnRateMonthly > 0 ? margin / sub.churnRateMonthly : null;
  const ratioLtv = ltv !== null ? ltv / sub.cacPerNew : null;
  if (ratioLtv !== null && ratioLtv >= 3 && payback <= 12) return null;
  return {
    id: "unit-economics",
    severity: ratioLtv !== null && ratioLtv < 1 ? "alert" : "warn",
    title: "Asiakashankinta on kallista suhteessa asiakkaan arvoon",
    body: `Uuden asiakkaan hankinta (${money(sub.cacPerNew)}) maksaa itsensä takaisin ${num(payback)} kuukaudessa. ${
      ltv !== null ? `Asiakas tuo katetta keskimäärin ${money(ltv)} elinaikanaan, eli ${num(ratioLtv ?? 0)} × hankintakulu. Terve taso on yleensä vähintään 3 ×.` : ""
    }`,
    learn: "Asiakkaan elinkaariarvo = kuukausikate / poistuma. Jos se on pienempi kuin hankintakulu, jokainen uusi asiakas syö kassaa.",
    actions: [
      { label: "Poistuma 30 % pienemmäksi", commands: [{ type: "scale_atom_field", atomId: sub.id, field: "churnRateMonthly", factor: 0.7 }] },
      { label: "Hinta +15 %", commands: [{ type: "scale_atom_field", atomId: sub.id, field: "pricePerMonth", factor: 1.15 }] },
    ],
  };
}

function spoilageInsight(m: Molecule, v: FlowView): CoachInsight | null {
  for (const a of m.atoms) {
    if (!a.enabled || a.kind !== "PHYSICAL_MATTER" || a.spoilageRate < 0.05) continue;
    const e = v.econ.find((x) => x.atomId === a.id);
    if (!e) continue;
    const wasteEur = e.volume * (e.unitVariableCost - a.unitCost);
    return {
      id: `spoilage-${a.id}`,
      severity: "tip",
      title: "Hävikki maksaa",
      body: `${pct(a.spoilageRate)} hävikki maksaa noin ${money(wasteEur)} kuussa. Puolittamalla sen tulos paranee ${money(wasteEur / 2)} kuussa.`,
      actions: [{ label: "Puolita hävikki", commands: [{ type: "set_atom_field", atomId: a.id, field: "spoilageRate", value: a.spoilageRate / 2 }] }],
    };
  }
  return null;
}

function demandAssumedInsight(v: FlowView, persona: PersonaId): CoachInsight | null {
  if (persona === "student") return null;
  const assumed = v.econ.find((e) => e.demandAssumed);
  if (!assumed) return null;
  return {
    id: "demand-assumed",
    severity: "tip",
    title: "Kysyntä on vielä oletus",
    body: `Malli olettaa, että ${assumed.label.toLowerCase()} myy kaiken kapasiteettinsa (${num(assumed.volume)} ${assumed.volumeUnit} / kk). Syötä varmistettu kysyntä, niin luvut perustuvat todellisuuteen.`,
    actions: [{ label: "Syötä kysyntä", commands: [{ type: "open_panel", panel: "demand" }] }],
  };
}

function nextStepInsight(cl: ChecklistView, persona: PersonaId): CoachInsight | null {
  if (!cl.next || (persona !== "founder" && persona !== "student")) return null;
  const n = cl.next;
  return {
    id: `next-${n.def.id}`,
    severity: "tip",
    title: `Seuraava askel: ${n.def.title}`,
    body: `${n.def.why}${n.effect ? ` Vaikutus malliin: ${n.effect}.` : ""}`,
    actions: [
      ...(n.def.mode === "manual" && n.effect ? [{ label: "Tee nyt", commands: [{ type: "checklist", id: n.def.id, checked: true } as FlowCommand] }] : []),
      { label: "Avaa perustamislista", commands: [{ type: "open_panel", panel: "launchpad" }] },
    ],
  };
}

function noFixedCostsInsight(v: FlowView): CoachInsight | null {
  if (v.isEmpty || v.monthlyFixed > 0) return null;
  return {
    id: "no-fixed-costs",
    severity: "warn",
    title: "Mallissa ei ole vielä kiinteitä kuluja",
    body: "Ilman kiinteitä kuluja jokainen yritys näyttää kannattavalta. Lisää ainakin oma palkkasi, toimitila ja kirjanpito – vasta silloin luvut kertovat totuuden.",
    learn: "Kiinteät kulut maksetaan joka kuukausi myynnistä riippumatta. Kannattavuusraja on se myynti, jonka kate kattaa ne.",
    actions: [
      { label: "Lisää oma palkka 2 500 € / kk", commands: [{ type: "add_fixed_cost", label: "Oma palkka (nosto)", amountPerMonth: 2500, dayOfMonth: 15, category: "other" }] },
      { label: "Avaa kulut", commands: [{ type: "open_panel", panel: "costs" }] },
    ],
  };
}

function goodInsight(v: FlowView): CoachInsight | null {
  if (v.isEmpty || v.monthlyFixed <= 0 || v.sim.cashOutDay !== null || v.firstMonthProfit <= 0 || (v.be.marginOfSafety ?? 0) < 0.15) return null;
  return {
    id: "healthy",
    severity: "good",
    title: "Malli on terveellä pohjalla",
    body: `Yritys on kannattava ensimmäisestä kuukaudesta (${money(v.firstMonthProfit)} / kk), kassa riittää koko vuoden ja myynti on ${pct(v.be.marginOfSafety ?? 0)} kannattavuusrajan yläpuolella. Kokeile stressitestiä: kestääkö malli huonon kvartaalin?`,
    actions: [{ label: "Myynti −25 %", commands: [{ type: "stress", stress: { volumeChange: -0.25 } }] }],
  };
}

export function coachInsights(m: Molecule, v: FlowView, cl: ChecklistView, persona: PersonaId): CoachInsight[] {
  if (v.isEmpty) {
    return [
      {
        id: "empty",
        severity: "tip",
        title: "Lisää ensimmäinen tulovirta",
        body: "Kerro, miten yrityksesi ansaitsee rahaa. Voit yhdistellä useita tapoja.",
        actions: [{ label: "Lisää tulovirta", commands: [{ type: "open_panel", panel: "demand" }] }],
      },
    ];
  }
  const list = [
    cashInsight(m, v),
    lossInsight(m, v),
    noFixedCostsInsight(v),
    bottleneckInsight(m, v),
    subscriptionInsight(m),
    marginInsight(v),
    spoilageInsight(m, v),
    idleInsight(m, v),
    demandAssumedInsight(v, persona),
    nextStepInsight(cl, persona),
    goodInsight(v),
  ].filter((x): x is CoachInsight => x !== null);
  return list.sort((a, b) => ORDER[a.severity] - ORDER[b.severity]);
}
