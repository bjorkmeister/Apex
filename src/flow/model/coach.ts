/**
 * APEX Studio — proaktiivinen valmentaja (`src/flow/model/coach.ts`).
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
import { unit, type FlowView } from "./view.ts";
import { VAT_THRESHOLD_EUR, type ChecklistView } from "./launchpad.ts";
import type { PersonaId } from "./personas.ts";
import { founderStats, HEAVY_HOURS } from "./founder.ts";
import { CRISIS_LIBRARY } from "./seasons.ts";
import { int, money, monthEnd, monthFull, num, pct } from "./format.ts";
import { t } from "../i18n/index.ts";

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
  /** Neuvonantajan rooli, jolle havainto kuuluu. */
  role: "cfo" | "sales" | "ops" | "people";
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
  let body = t("Kassa menee miinukselle päivänä {day} ja pohja on {amount}.", { day, amount: money(v.sim.minCash) });
  if (v.hasInvoicing && v.firstMonthProfit > 0) {
    const fix = [21, 14, 7, 0].filter((d) => d < m.credit.customerTermsDays).find((d) => simulate(withCustomerTerms(m, d)).cashOutDay === null);
    body += " " + t("Yritys on kannattava, mutta asiakkaiden {days} päivän maksuaika tuo rahat liian myöhään.", { days: m.credit.customerTermsDays });
    if (fix !== undefined) actions.push({ label: t("Kokeile {days} pv maksuaikaa", { days: fix }), commands: [{ type: "set_credit", field: "customerTermsDays", value: fix }] });
  } else if (v.firstMonthProfit <= 0 && !v.varies) {
    body += " " + t("Syy on se, että kulut ovat suuremmat kuin myynnin kate – lisärahoitus vain siirtää ongelmaa.");
  } else if (v.varies) {
    const worst = [...v.sim.months].sort((a, b) => a.operatingProfit - b.operatingProfit)[0];
    if (worst) body += " " + t("Heikoin kuukausi on {month} (tulos {amount}).", { month: monthFull(worst.calendarMonth), amount: money(worst.operatingProfit) });
  }
  const need = Math.ceil((-v.sim.minCash + v.monthlyFixed * 0.5) / 500) * 500;
  if (need > 0) actions.push({ label: t("Lisää alkukassaa {amount}", { amount: money(need) }), commands: [{ type: "set_credit", field: "openingCash", value: m.credit.openingCash + need }] });
  return {
    id: "cash-out",
    severity: "alert",
    role: "cfo",
    title: t("Kassa loppuu päivänä {day}", { day }),
    body,
    learn: t("Kassavirta ja tulos ovat eri asioita: tulos kertoo, kannattaako toiminta, kassa kertoo, riittävätkö rahat maksuihin juuri nyt."),
    actions,
  };
}

function lossInsight(v: FlowView): CoachInsight | null {
  if (v.isEmpty || v.firstMonthProfit >= 0) return null;
  const gap = -v.firstMonthProfit;
  const actions: CoachAction[] = [];
  let body = t("Kuukauden tulos on {profit}. Katetta puuttuu {gap} kuussa.", { profit: money(v.firstMonthProfit), gap: money(gap) });
  if (v.econ.length === 1) {
    const e = v.econ[0];
    const unitMargin = e.unitPrice - e.unitVariableCost;
    if (e.volume > 0) {
      const neededPrice = e.unitVariableCost + (unitMargin * e.volume + gap) / e.volume;
      const factor = neededPrice / Math.max(1e-9, e.unitPrice);
      body += " " + t("Samalla määrällä hinnan pitäisi olla {needed} (nyt {now}).", { needed: money(neededPrice), now: money(e.unitPrice) });
      if (factor < 1.6) actions.push({ label: t("Kokeile hintaa {amount}", { amount: money(Math.ceil(neededPrice)) }), commands: [{ type: "set_atom_field", atomId: e.atomId, field: priceFieldFor(e.kind), value: Math.ceil(neededPrice) }] });
    }
    if (unitMargin > 0) body += " " + t("Tai myyntiä pitäisi olla {n} {unit} enemmän kuussa.", { n: num(gap / unitMargin), unit: unit(e) });
  }
  if (v.lastMonthProfit > 0) body += " " + t("Hyvä uutinen: 12. kuukautena tulos on jo {amount}.", { amount: money(v.lastMonthProfit) });
  actions.push({ label: t("Katso kulut"), commands: [{ type: "open_panel", panel: "costs" }] });
  return { id: "loss", severity: v.lastMonthProfit > 0 ? "warn" : "alert", role: "cfo", title: t("Yritys tekee tappiota"), body, actions };
}

function bottleneckInsight(m: Molecule, v: FlowView): CoachInsight | null {
  const b = v.bottleneck;
  if (!b || b.lostDemand <= 0 || b.demandAssumed) return null;
  const lostShare = b.lostDemand / b.demand;
  const actions: CoachAction[] = [];
  let body = t("Kysyntää jää palvelematta {n} {unit} kuussa ({amount} myyntiä).", { n: num(b.lostDemand), unit: unit(b), amount: money(b.lostDemand * b.unitPrice) });
  const raise = Math.min(0.25, Math.floor(lostShare * 20) / 20) || 0.05;
  body += " " + t("Kun kysyntää on yli kapasiteetin, voit nostaa hintaa: vaikka {pct} asiakkaista jäisi pois, myyt silti saman määrän.", { pct: pct(lostShare) });
  actions.push({ label: t("Kokeile hintaa +{pct}", { pct: pct(raise) }), commands: [{ type: "scale_atom_field", atomId: b.atomId, field: priceFieldFor(b.kind), factor: 1 + raise }] });
  const atom = m.atoms.find((a) => a.id === b.atomId);
  if (atom?.kind === "TIME_CAPACITY") {
    const tAtom = atom as TimeCapacityAtom;
    const hire = hireBreakEven(tAtom, tAtom.salaryPerPersonMonth || 3200, tAtom.sideCostRate || 0.21);
    if (hire.hoursNeededPerMonth !== null) {
      const pays = b.lostDemand >= hire.hoursNeededPerMonth;
      body +=
        " " +
        (pays
          ? t("Uusi tekijä maksaa itsensä {n} laskutetulla tunnilla kuussa – menetetty kysyntä riittää siihen.", { n: num(hire.hoursNeededPerMonth) })
          : t("Uusi tekijä maksaa itsensä {n} laskutetulla tunnilla kuussa – menetetty kysyntä ei vielä riitä siihen.", { n: num(hire.hoursNeededPerMonth) }));
      if (pays) actions.push({ label: t("Palkkaa uusi tekijä"), commands: [{ type: "set_atom_field", atomId: tAtom.id, field: "people", value: tAtom.people + 1 }] });
    }
  }
  return {
    id: "bottleneck",
    severity: "warn",
    role: "ops",
    title: t("Toimituskyky on pullonkaula"),
    body,
    learn: t("Pullonkaula on se kohta, joka rajoittaa koko ketjun läpimenoa. Sen ohittaminen kasvattaa myyntiä enemmän kuin minkään muun kohdan parantaminen."),
    actions,
  };
}

function idleInsight(v: FlowView): CoachInsight | null {
  const idle = v.econ.find((e) => e.kind === "TIME_CAPACITY" && !e.demandAssumed && e.capacity !== null && e.idleCapacity > e.capacity * 0.2);
  if (!idle) return null;
  return {
    id: "idle",
    severity: "tip",
    role: "sales",
    title: t("Laskuttamatonta aikaa jää paljon"),
    body: t("Kalenterissa on {n} h kuussa myymättä – se on {amount} myyntiä, joka ei palaa koskaan. Kiinteä kuukausisopimus (ylläpito, tuki) tasaa kuormaa ja tuo tasaisen rahavirran.", {
      n: num(idle.idleCapacity),
      amount: money(idle.idleCapacity * idle.unitPrice),
    }),
    learn: t("Asiantuntijatyössä myymätön tunti on samaa kuin pilaantunut tavara kaupassa: se menetetään lopullisesti."),
    actions: [
      {
        label: t("Lisää kuukausisopimukset"),
        commands: [{ type: "add_atom", kind: "RECURRING_SUB", label: t("Ylläpitosopimukset"), params: { startingSubscribers: 0, newPerMonth: 1, churnRateMonthly: 0.02, pricePerMonth: 500, costPerSubscriberMonth: 0, cacPerNew: 300 } }],
      },
      { label: t("Syötä kysyntä"), commands: [{ type: "open_panel", panel: "demand" }] },
    ],
  };
}

function marginInsight(v: FlowView): CoachInsight | null {
  const mos = v.be.marginOfSafety;
  if (mos === null || mos < 0 || mos >= 0.15 || v.firstMonthProfit < 0) return null;
  return {
    id: "thin-margin",
    severity: "warn",
    role: "cfo",
    title: t("Pelivara on ohut"),
    body: t("Myynti on vain {pct} kannattavuusrajan yläpuolella. Jo {pct} pudotus myynnissä vie yrityksen tappiolle.", { pct: pct(mos) }),
    actions: [{ label: t("Stressitestaa −15 %"), commands: [{ type: "stress", stress: { volumeChange: -0.15 } }] }],
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
    role: "sales",
    title: t("Asiakashankinta on kallista suhteessa asiakkaan arvoon"),
    body:
      t("Uuden asiakkaan hankinta ({cac}) maksaa itsensä takaisin {months} kuukaudessa.", { cac: money(sub.cacPerNew), months: num(payback) }) +
      (ltv !== null ? " " + t("Asiakas tuo katetta keskimäärin {ltv} elinaikanaan, eli {ratio} × hankintakulu. Terve taso on yleensä vähintään 3 ×.", { ltv: money(ltv), ratio: num(ratioLtv ?? 0) }) : ""),
    learn: t("Asiakkaan elinkaariarvo = kuukausikate / poistuma. Jos se on pienempi kuin hankintakulu, jokainen uusi asiakas syö kassaa."),
    actions: [
      { label: t("Poistuma 30 % pienemmäksi"), commands: [{ type: "scale_atom_field", atomId: sub.id, field: "churnRateMonthly", factor: 0.7 }] },
      { label: t("Hinta +15 %"), commands: [{ type: "scale_atom_field", atomId: sub.id, field: "pricePerMonth", factor: 1.15 }] },
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
      role: "ops",
      title: t("Hävikki maksaa"),
      body: t("{pct} hävikki maksaa noin {amount} kuussa. Puolittamalla sen tulos paranee {half} kuussa.", { pct: pct(a.spoilageRate), amount: money(wasteEur), half: money(wasteEur / 2) }),
      actions: [{ label: t("Puolita hävikki"), commands: [{ type: "set_atom_field", atomId: a.id, field: "spoilageRate", value: a.spoilageRate / 2 }] }],
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
    role: "sales",
    title: t("Kysyntä on vielä oletus"),
    body: t("Malli olettaa, että {label} myy kaiken kapasiteettinsa ({n} {unit} / kk). Syötä varmistettu kysyntä, niin luvut perustuvat todellisuuteen.", {
      label: assumed.label,
      n: num(assumed.volume),
      unit: unit(assumed),
    }),
    actions: [{ label: t("Syötä kysyntä"), commands: [{ type: "open_panel", panel: "demand" }] }],
  };
}

function nextStepInsight(cl: ChecklistView, persona: PersonaId): CoachInsight | null {
  if (!cl.next || (persona !== "founder" && persona !== "student")) return null;
  const n = cl.next;
  return {
    id: `next-${n.def.id}`,
    severity: "tip",
    role: "cfo",
    title: t("Seuraava askel: {title}", { title: t(n.def.title) }),
    body: `${t(n.def.why, { threshold: int(VAT_THRESHOLD_EUR) })}${n.effect ? " " + t("Vaikutus malliin: {effect}.", { effect: n.effect }) : ""}`,
    actions: [
      ...(n.def.mode === "manual" && n.effect ? [{ label: t("Tee nyt"), commands: [{ type: "checklist", id: n.def.id, checked: true } as FlowCommand] }] : []),
      { label: t("Avaa perustamislista"), commands: [{ type: "open_panel", panel: "launchpad" }] },
    ],
  };
}

function noFixedCostsInsight(v: FlowView): CoachInsight | null {
  if (v.isEmpty || v.monthlyFixed > 0) return null;
  return {
    id: "no-fixed-costs",
    severity: "warn",
    role: "cfo",
    title: t("Mallissa ei ole vielä kiinteitä kuluja"),
    body: t("Ilman kiinteitä kuluja jokainen yritys näyttää kannattavalta. Lisää ainakin oma palkkasi, toimitila ja kirjanpito – vasta silloin luvut kertovat totuuden."),
    learn: t("Kiinteät kulut maksetaan joka kuukausi myynnistä riippumatta. Kannattavuusraja on se myynti, jonka kate kattaa ne."),
    actions: [
      { label: t("Lisää oma palkka 2 500 € / kk"), commands: [{ type: "add_fixed_cost", label: t("Oma palkka (nosto)"), amountPerMonth: 2500, dayOfMonth: 15, category: "other" }] },
      { label: t("Avaa kulut"), commands: [{ type: "open_panel", panel: "costs" }] },
    ],
  };
}

function founderInsight(m: Molecule, v: FlowView): CoachInsight | null {
  if (v.isEmpty) return null;
  const f = founderStats(m);
  if (f.salarySource !== "none" && f.personalMargin < 0 && m.founder) {
    return {
      id: "founder-income",
      severity: "warn",
      role: "people",
      title: t("Oma palkka ei riitä elämiseen"),
      body: t("Palkkasi {salary} / kk jää {gap} alle elinkustannustesi ({living}). Yrityksen pitää maksaa tekijälleen elämiseen riittävä palkka, muuten malli on vasta harrastus.", {
        salary: money(f.ownSalary),
        gap: money(-f.personalMargin),
        living: money(f.livingCosts),
      }),
      actions: [{ label: t("Avaa yrittäjän tilanne"), commands: [{ type: "open_panel", panel: "founder" }] }],
    };
  }
  if (f.weeklyHours > HEAVY_HOURS) {
    return {
      id: "founder-hours",
      severity: "warn",
      role: "people",
      title: t("Viikkotunnit eivät ole kestävällä tasolla"),
      body: t("{hours} tuntia viikossa ei kestä pitkään. Tuntipalkkasi on {wage}. Kokeile hinnan nostoa tai työn jakamista, ennen kuin jaksaminen loppuu.", {
        hours: num(f.weeklyHours, 0),
        wage: money(f.hourlyWage),
      }),
      learn: t("Yksinyrittäjän suurin riski on usein oma jaksaminen: kun yrittäjä väsyy, koko yritys pysähtyy."),
      actions: [{ label: t("Avaa yrittäjän tilanne"), commands: [{ type: "open_panel", panel: "founder" }] }],
    };
  }
  return null;
}

function eventInsight(m: Molecule, v: FlowView): CoachInsight | null {
  const events = m.events ?? [];
  if (events.length === 0) return null;
  const latest = events[events.length - 1];
  const card = CRISIS_LIBRARY.find((c) => c.id === latest.libraryId);
  const affected = v.sim.months.filter((mo) => mo.activeEvents.includes(latest.title));
  const loss = affected.reduce((s, mo) => s + Math.min(0, mo.operatingProfit), 0);
  const actions: CoachAction[] = (card?.responses ?? []).map((r) => ({ label: t(r.label), commands: r.commands(m) }));
  actions.push({ label: t("Poista tapahtuma"), commands: [{ type: "remove_event", id: latest.id }] });
  return {
    id: `event-${latest.id}`,
    severity: v.sim.cashOutDay !== null ? "alert" : "tip",
    role: "cfo",
    title: t("Tapahtuma: {title}", { title: latest.title }),
    body:
      t("Tapahtuma alkaa kuukautena {month} ja kestää {n} kk.", { month: latest.startMonth + 1, n: latest.durationMonths }) +
      " " +
      (v.sim.cashOutDay !== null
        ? t("Kassa ei kestä: se loppuu päivänä {day}.", { day: v.sim.cashOutDay + 1 })
        : loss < 0
          ? t("Kassa kestää, mutta tappiota kertyy {amount} niinä kuukausina.", { amount: money(-loss) })
          : t("Kassa kestää, ja tulos pysyy plussalla.")),
    actions,
  };
}

function seasonInsight(m: Molecule, v: FlowView): CoachInsight | null {
  if (!v.varies || !(m.seasonality ?? []).some((x) => x !== 1)) return null;
  const worst = [...v.sim.months].sort((a, b) => a.endCash - b.endCash)[0];
  if (!worst || v.sim.cashOutDay !== null) return null;
  return {
    id: "season",
    severity: "tip",
    role: "cfo",
    title: t("Kausivaihtelu: varaudu hiljaiseen kauteen"),
    body: t("Kassa on pienimmillään {when} ({amount}). Kerää puskuri vilkkaana kautena – ja tarkista kiinteät kulut hiljaiselle kaudelle.", {
      when: monthEnd(worst.calendarMonth),
      amount: money(worst.endCash),
    }),
    actions: [{ label: t("Avaa sesongit"), commands: [{ type: "open_panel", panel: "seasons" }] }],
  };
}

function goodInsight(v: FlowView): CoachInsight | null {
  if (v.isEmpty || v.monthlyFixed <= 0 || v.sim.cashOutDay !== null || v.firstMonthProfit <= 0 || (v.be.marginOfSafety ?? 0) < 0.15) return null;
  return {
    id: "healthy",
    severity: "good",
    role: "cfo",
    title: t("Malli on terveellä pohjalla"),
    body: t("Yritys on kannattava ensimmäisestä kuukaudesta ({profit} / kk), kassa riittää koko vuoden ja myynti on {pct} kannattavuusrajan yläpuolella. Kokeile stressitestiä: kestääkö malli huonon kvartaalin?", {
      profit: money(v.firstMonthProfit),
      pct: pct(v.be.marginOfSafety ?? 0),
    }),
    actions: [{ label: t("Myynti −25 %"), commands: [{ type: "stress", stress: { volumeChange: -0.25 } }] }],
  };
}

export function coachInsights(m: Molecule, v: FlowView, cl: ChecklistView, persona: PersonaId): CoachInsight[] {
  if (v.isEmpty) {
    return [
      {
        id: "empty",
        severity: "tip",
        role: "sales",
        title: t("Lisää ensimmäinen tulovirta"),
        body: t("Kerro, miten yrityksesi ansaitsee rahaa. Voit yhdistellä useita tapoja."),
        actions: [{ label: t("Lisää tulovirta"), commands: [{ type: "open_panel", panel: "demand" }] }],
      },
    ];
  }
  const list = [
    cashInsight(m, v),
    lossInsight(v),
    noFixedCostsInsight(v),
    eventInsight(m, v),
    bottleneckInsight(m, v),
    subscriptionInsight(m),
    marginInsight(v),
    founderInsight(m, v),
    seasonInsight(m, v),
    spoilageInsight(m, v),
    idleInsight(v),
    demandAssumedInsight(v, persona),
    nextStepInsight(cl, persona),
    goodInsight(v),
  ].filter((x): x is CoachInsight => x !== null);
  return list.sort((a, b) => ORDER[a.severity] - ORDER[b.severity]);
}
