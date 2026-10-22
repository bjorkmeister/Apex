/**
 * APEX Flow — perustajan muistilista (`src/flow/model/launchpad.ts`).
 *
 * Muistilista ei ole irrallinen tehtävälista: kohdat, joilla on rahavaikutus,
 * muuttavat simulaatiota heti (esim. YEL lisää kuukausikulun, perustamismaksu
 * pienentää alkukassaa, 14 päivän maksuehto lyhentää maksuaikaputkea).
 * Jokainen vaikutus on peruttavissa: ruksin poisto palauttaa mallin ennalleen.
 *
 * Viranomaismaksut ja -prosentit ovat arvioita, ja ne on merkitty muokattaviksi.
 * Käyttäjää ohjataan tarkistamaan ajantasaiset luvut lähteestä.
 */
import type { Molecule } from "../kernel/types.ts";
import { addFixedCost, removeFixedCost } from "./edit.ts";
import { withCustomerTerms } from "../kernel/sensitivity.ts";
import type { FlowView, NodeId } from "./view.ts";
import { msg, t } from "../i18n/index.ts";
import { provKey, withProvenance } from "./provenance.ts";

export type LaunchStep = 1 | 2 | 3 | 4 | 5;

export const STEP_TITLES: Record<LaunchStep, string> = {
  1: msg("Liikeidea"),
  2: msg("Hinnoittelu ja kannattavuus"),
  3: msg("Hallinto ja lakisääteiset asiat"),
  4: msg("Asiakkaat ja maksuehdot"),
  5: msg("Valmis käynnistykseen"),
};

export interface ParamDef {
  key: string;
  label: string;
  unit: string;
  default: number;
  step: number;
}

export interface ItemDef {
  id: string;
  step: LaunchStep;
  title: string;
  /** Miksi tämä on tärkeää, selkokielellä. */
  why: string;
  /** "manual" = käyttäjä ruksaa, "auto" = APEX tarkistaa mallista. */
  mode: "manual" | "auto";
  params?: ParamDef[];
  /** Lähde, josta ajantasainen tieto tarkistetaan. */
  source?: string;
  /** Avaa tämän paneelin, kun käyttäjä haluaa tehdä asian. */
  open?: NodeId;
  /** Näytetäänkö kohta tälle mallille. */
  relevant?: (m: Molecule, v: FlowView) => boolean;
}

export interface ItemState {
  checked: boolean;
  params?: Record<string, number>;
  /** Tallennettu tieto peruutusta varten (esim. aiempi maksuaika). */
  undo?: Record<string, number>;
}

export interface ChecklistState {
  items: Record<string, ItemState>;
}

export const emptyChecklist = (): ChecklistState => ({ items: {} });

const invoiced = (m: Molecule) =>
  m.atoms.some((a) => a.enabled && (a.kind === "TIME_CAPACITY" || a.kind === "PHYSICAL_MATTER"));
const hasTimeAtom = (m: Molecule) => m.atoms.some((a) => a.enabled && a.kind === "TIME_CAPACITY");

/** Arvonlisäverovelvollisuuden alaraja (liikevaihto / tilikausi). Tarkista ajantasainen raja Verohallinnosta. */
export const VAT_THRESHOLD_EUR = 15000;

export const CHECKLIST: ItemDef[] = [
  {
    id: "idea",
    step: 1,
    title: msg("Kuvaa, mitä myyt ja kenelle"),
    why: msg("Kun tiedät, kuka maksaa ja mistä, tiedät myös mitä virtoja mallissa tarvitaan."),
    mode: "auto",
    open: "demand",
  },
  {
    id: "own-salary",
    step: 2,
    title: msg("Päätä oma palkkasi"),
    why: msg("Yritys, joka ei maksa tekijälleen palkkaa, ei ole vielä kannattava – se vain näyttää siltä."),
    mode: "auto",
    open: "costs",
  },
  {
    id: "break-even",
    step: 2,
    title: msg("Hinnoittele niin, että kannattavuusraja jää selvästi alle myynnin"),
    why: msg("Vähintään 20 %:n pelivara tarkoittaa, että yksi huono kuukausi ei kaada yritystä."),
    mode: "auto",
    open: "demand",
  },
  {
    id: "company-form",
    step: 3,
    title: msg("Valitse yritysmuoto ja tee perustamisilmoitus (Y-tunnus)"),
    why: msg("Toiminimi on nopein aloittaa, osakeyhtiö erottaa omat ja yrityksen rahat. Perustamismaksu maksetaan heti, joten se pienentää alkukassaa."),
    mode: "manual",
    params: [{ key: "fee", label: msg("Perustamismaksu"), unit: msg("€"), default: 75, step: 5 }],
    source: msg("PRH / YTJ: ajantasaiset käsittelymaksut (toiminimi ja osakeyhtiö eroavat)"),
  },
  {
    id: "yel",
    step: 3,
    title: msg("Ota yrittäjän eläkevakuutus (YEL)"),
    why: msg("YEL on pakollinen, kun työtulosi ylittää alarajan. Se on myös sosiaaliturvasi perusta: sairauspäiväraha ja eläke lasketaan YEL-työtulosta."),
    mode: "manual",
    params: [
      { key: "income", label: msg("YEL-työtulo"), unit: msg("€ / v"), default: 15000, step: 500 },
      { key: "rate", label: msg("Maksuprosentti"), unit: msg("%"), default: 24.4, step: 0.1 },
      { key: "discount", label: msg("Aloittavan alennus"), unit: msg("%"), default: 22, step: 1 },
    ],
    source: msg("Eläkeyhtiö tai Työeläke.fi: vuoden maksuprosentti ja alkavan yrittäjän alennus (48 kk)"),
  },
  {
    id: "accounting",
    step: 3,
    title: msg("Järjestä kirjanpito"),
    why: msg("Kirjanpito on lakisääteinen. Tilitoimisto maksaa, mutta säästää aikaa ja virheitä."),
    mode: "manual",
    params: [{ key: "amount", label: msg("Kirjanpito"), unit: msg("€ / kk"), default: 150, step: 10 }],
  },
  {
    id: "insurance",
    step: 3,
    title: msg("Hanki yritysvakuutukset"),
    why: msg("Vastuuvakuutus suojaa, jos työssäsi sattuu virhe. Monet asiakkaat vaativat sen."),
    mode: "manual",
    params: [{ key: "amount", label: msg("Vakuutukset"), unit: msg("€ / kk"), default: 40, step: 5 }],
  },
  {
    id: "vat",
    step: 3,
    title: msg("Selvitä arvonlisäverovelvollisuus"),
    why: msg("Jos liikevaihtosi ylittää {threshold} € tilikaudessa, rekisteröidy ALV-velvolliseksi. APEX laskee hinnat ilman arvonlisäveroa: muista lisätä vero asiakkaan hintaan."),
    mode: "manual",
    source: msg("Verohallinto: ALV-velvollisuuden alaraja ja ilmoitusaikataulu"),
  },
  {
    id: "bank",
    step: 3,
    title: msg("Avaa yritykselle oma pankkitili"),
    why: msg("Erillinen tili pitää yrityksen ja omat rahat erillään – ja kassan seuranta helpottuu."),
    mode: "manual",
  },
  {
    id: "terms",
    step: 4,
    title: msg("Sovi lyhyt maksuehto (14 pv)"),
    why: msg("Lyhyt maksuaika tuo rahat kassaan ennen kuin omat laskusi erääntyvät."),
    mode: "manual",
    relevant: (m) => invoiced(m),
    open: "receivables",
  },
  {
    id: "first-customers",
    step: 4,
    title: msg("Varmista ensimmäiset asiakkaat"),
    why: msg("Arvio kysynnästä muuttuu todeksi vasta, kun joku sitoutuu ostamaan. Syötä varmistettu kysyntä malliin."),
    mode: "auto",
    open: "demand",
  },
  {
    id: "buffer",
    step: 5,
    title: msg("Varmista kassapuskuri: kassa ei mene miinukselle"),
    why: msg("Kun kassa riittää koko vuoden ja pohjallakin on vähintään kuukauden kiinteät kulut, yritys kestää yllätyksiä."),
    mode: "auto",
    open: "cash",
  },
];

/** Molekyylissä on vähintään yksi kiinteä kulu tai palkka, joka kuvaa omaa palkkaa. */
function hasOwnSalary(m: Molecule): boolean {
  const time = m.atoms.some((a) => a.enabled && a.kind === "TIME_CAPACITY" && a.salaryPerPersonMonth > 0);
  const listed = m.fixedCosts.some((c) => /palkka|nosto|salary|draw/i.test(c.label) && c.amountPerMonth > 0);
  return time || listed;
}

/** Automaattisten kohtien tila suoraan mallista. */
export function autoCheck(id: string, m: Molecule, v: FlowView): boolean {
  switch (id) {
    case "idea":
      return m.atoms.some((a) => a.enabled) && m.name.trim().length > 0 && v.monthlyRevenue > 0;
    case "own-salary":
      return hasOwnSalary(m);
    case "break-even":
      return (v.be.marginOfSafety ?? -1) >= 0.2;
    case "first-customers":
      return v.econ.length > 0 && v.econ.every((e) => !e.demandAssumed);
    case "buffer":
      return v.sim.cashOutDay === null && v.sim.minCash >= v.monthlyFixed;
    default:
      return false;
  }
}

function paramsOf(def: ItemDef, st: ItemState | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of def.params ?? []) out[p.key] = st?.params?.[p.key] ?? p.default;
  return out;
}

/** YEL-kuukausimaksu: työtulo × maksuprosentti × (1 − alennus) / 12. */
export function yelMonthly(income: number, ratePct: number, discountPct: number): number {
  return (Math.max(0, income) * Math.max(0, ratePct) / 100 * (1 - Math.min(100, Math.max(0, discountPct)) / 100)) / 12;
}

/** Kohdan rahavaikutus kuvauksena (näytetään käyttäjälle ennen ruksausta). */
export function effectLabel(id: string, params: Record<string, number>): string | null {
  switch (id) {
    case "company-form":
      return t("alkukassa −{amount} €", { amount: Math.round(params.fee) });
    case "yel":
      return t("+{amount} € / kk kuluihin", { amount: Math.round(yelMonthly(params.income, params.rate, params.discount)) });
    case "accounting":
    case "insurance":
      return t("+{amount} € / kk kuluihin", { amount: Math.round(params.amount) });
    case "terms":
      return t("asiakkaan maksuaika 14 pv");
    default:
      return null;
  }
}

const fcId = (id: string) => `lp-${id}`;

function applyEffect(m: Molecule, id: string, params: Record<string, number>, prev: ItemState | undefined): { m: Molecule; undo?: Record<string, number> } {
  switch (id) {
    case "company-form": {
      const fee = Math.max(0, params.fee);
      const already = prev?.undo?.fee ?? 0;
      return { m: withProvenance({ ...m, credit: { ...m.credit, openingCash: m.credit.openingCash + already - fee } }, [provKey("credit", "openingCash")], "launchpad"), undo: { fee } };
    }
    case "yel":
      return {
        m: addFixedCost(m, {
          id: fcId(id),
          label: t("YEL-vakuutus"),
          amountPerMonth: yelMonthly(params.income, params.rate, params.discount),
          category: "pension",
          dayOfMonth: 20,
          source: "launchpad",
        }),
      };
    case "accounting":
      return { m: addFixedCost(m, { id: fcId(id), label: t("Kirjanpito"), amountPerMonth: params.amount, category: "admin", dayOfMonth: 5, source: "launchpad" }) };
    case "insurance":
      return { m: addFixedCost(m, { id: fcId(id), label: t("Yritysvakuutukset"), amountPerMonth: params.amount, category: "insurance", dayOfMonth: 1, source: "launchpad" }) };
    case "terms": {
      const previous = prev?.undo?.terms ?? m.credit.customerTermsDays;
      return { m: withProvenance(withCustomerTerms(m, Math.min(14, previous)), [provKey("credit", "customerTermsDays")], "launchpad"), undo: { terms: previous } };
    }
    default:
      return { m };
  }
}

function revertEffect(m: Molecule, id: string, st: ItemState | undefined): Molecule {
  switch (id) {
    case "company-form":
      return { ...m, credit: { ...m.credit, openingCash: m.credit.openingCash + (st?.undo?.fee ?? 0) } };
    case "yel":
    case "accounting":
    case "insurance":
      return removeFixedCost(m, fcId(id));
    case "terms":
      return st?.undo?.terms !== undefined ? withCustomerTerms(m, st.undo.terms) : m;
    default:
      return m;
  }
}

export interface ChecklistUpdate {
  molecule: Molecule;
  checklist: ChecklistState;
}

/** Ruksaa tai poistaa ruksin. Rahavaikutteiset kohdat muuttavat mallia. */
export function toggleItem(m: Molecule, cl: ChecklistState, id: string, checked: boolean): ChecklistUpdate {
  const def = CHECKLIST.find((d) => d.id === id);
  if (!def || def.mode !== "manual") return { molecule: m, checklist: cl };
  const prev = cl.items[id];
  if (!!prev?.checked === checked) return { molecule: m, checklist: cl };
  if (checked) {
    const { m: next, undo } = applyEffect(m, id, paramsOf(def, prev), undefined);
    return { molecule: next, checklist: { items: { ...cl.items, [id]: { ...prev, checked: true, undo } } } };
  }
  const reverted = revertEffect(m, id, prev);
  return { molecule: reverted, checklist: { items: { ...cl.items, [id]: { ...prev, checked: false, undo: undefined } } } };
}

/** Muuttaa kohdan parametria (esim. YEL-työtuloa). Jos kohta on ruksattu, vaikutus päivitetään heti. */
export function setItemParam(m: Molecule, cl: ChecklistState, id: string, key: string, value: number): ChecklistUpdate {
  const def = CHECKLIST.find((d) => d.id === id);
  if (!def || !def.params?.some((p) => p.key === key) || !Number.isFinite(value)) return { molecule: m, checklist: cl };
  const prev = cl.items[id] ?? { checked: false };
  const nextState: ItemState = { ...prev, params: { ...prev.params, [key]: value } };
  if (!prev.checked) return { molecule: m, checklist: { items: { ...cl.items, [id]: nextState } } };
  const { m: next, undo } = applyEffect(m, id, paramsOf(def, nextState), prev);
  return { molecule: next, checklist: { items: { ...cl.items, [id]: { ...nextState, undo: undo ?? prev.undo } } } };
}

export type ItemStatus = "done" | "todo" | "attention";

export interface ItemView {
  def: ItemDef;
  status: ItemStatus;
  checked: boolean;
  params: Record<string, number>;
  effect: string | null;
  /** Lisähuomio, esim. "liikevaihtosi ylittää ALV-rajan". */
  note: string | null;
}

export interface ChecklistView {
  items: ItemView[];
  done: number;
  total: number;
  /** Ensimmäinen tekemätön kohta: valmentaja ehdottaa tätä seuraavaksi. */
  next: ItemView | null;
}

export function checklistView(m: Molecule, v: FlowView, cl: ChecklistState): ChecklistView {
  const items: ItemView[] = [];
  for (const def of CHECKLIST) {
    if (def.relevant && !def.relevant(m, v)) continue;
    const st = cl.items[def.id];
    const params = paramsOf(def, st);
    const checked = def.mode === "auto" ? autoCheck(def.id, m, v) : !!st?.checked;
    let note: string | null = null;
    let status: ItemStatus = checked ? "done" : "todo";
    if (def.id === "vat" && v.monthlyRevenue * 12 > VAT_THRESHOLD_EUR) {
      note = t("Mallisi vuosimyynti on noin {amount} € – ALV-rekisteröinti on todennäköisesti pakollinen.", { amount: Math.round(v.monthlyRevenue * 12) });
      if (!checked) status = "attention";
    }
    if (def.id === "own-salary" && !checked && !hasTimeAtom(m)) {
      note = t("Lisää kuluihin kiinteä kulu nimeltä \"Oma palkka\".");
    }
    if (def.id === "buffer" && !checked && v.sim.cashOutDay !== null) {
      note = t("Kassa loppuu nyt päivänä {day}.", { day: v.sim.cashOutDay + 1 });
      status = "attention";
    }
    items.push({ def, status, checked, params, effect: def.mode === "manual" ? effectLabel(def.id, params) : null, note });
  }
  const done = items.filter((i) => i.status === "done").length;
  return { items, done, total: items.length, next: items.find((i) => i.status !== "done") ?? null };
}
