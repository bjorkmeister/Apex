/**
 * APEX Studio — harjoitustehtävät (`src/flow/model/tasks.ts`).
 *
 * Opiskelijalle (ja kenelle tahansa) suunnatut tehtävät: valmis lähtötilanne,
 * selkeä tavoite ja automaattinen tarkistus. Tavoitteet on muotoiltu niin, että
 * ne voi ratkaista usealla tavalla, eikä "lisää rahaa" kelpaa oikotieksi.
 */
import type { Molecule, RecurringSubAtom, TransactionalTradeAtom } from "../kernel/types.ts";
import { simulate } from "../kernel/simulate.ts";
import { createPreset, type PresetId } from "../kernel/presets.ts";
import { stressTest } from "../kernel/sensitivity.ts";
import type { FlowView } from "./view.ts";
import { SEASON_PROFILES } from "./seasons.ts";
import { money, num } from "./format.ts";
import { msg, t } from "../i18n/index.ts";

export interface TaskCheck {
  done: boolean;
  /** Tilanne nyt, selkokielellä. */
  progress: string;
}

export interface TaskDef {
  id: string;
  title: string;
  brief: string;
  goal: string;
  hint: string;
  /** Mitä tehtävä opettaa. */
  learn: string;
  preset: PresetId;
  setup?: (m: Molecule) => Molecule;
  check: (m: Molecule, v: FlowView, start: Molecule) => TaskCheck;
}

const yes = (b: boolean) => (b ? "✓" : "✗");

export const TASKS: TaskDef[] = [
  {
    id: "rescue-cash",
    title: msg("Pelasta kassa"),
    brief: msg("IT-konsultti on kannattava, mutta kassa loppuu toisena kuukautena."),
    goal: msg("Kassa ei mene miinukselle koko vuoden aikana – ilman lisärahaa."),
    hint: msg("Katso Rahat matkalla -solmua. Milloin asiakkaat maksavat ja milloin palkka maksetaan?"),
    learn: msg("Kassavirta ja tulos ovat eri asioita: maksuaika siirtää rahaa myöhemmäksi."),
    preset: "it_consultant",
    check: (m, v, start) => {
      const noExtra = m.credit.openingCash <= start.credit.openingCash + 1;
      return {
        done: v.sim.cashOutDay === null && noExtra,
        progress: `${yes(v.sim.cashOutDay === null)} ${t("kassa riittää")} · ${yes(noExtra)} ${t("ei lisärahaa")}`,
      };
    },
  },
  {
    id: "break-even",
    title: msg("Löydä kannattavuus"),
    brief: msg("Kioskin vuokra nousi, ja yritys tekee nyt tappiota."),
    goal: msg("Kuukauden tulos on vähintään nolla – ilman että ohikulkijoita lisätään."),
    hint: msg("Kokeile keskiostosta, ostoprosenttia tai raaka-ainekulua. Kannattavuusraja-kortti näyttää tavoitteen."),
    learn: msg("Kannattavuusraja: kate kattaa kiinteät kulut. Pieni muutos hinnassa vaikuttaa katteeseen paljon."),
    preset: "food_kiosk",
    setup: (m) => ({
      ...m,
      atoms: m.atoms.map((a) => (a.kind === "TRANSACTIONAL_TRADE" ? { ...a, averageTicket: 6.5 } : a)),
      fixedCosts: m.fixedCosts.map((c) => (c.category === "rent" ? { ...c, amountPerMonth: 2000 } : c)),
    }),
    check: (m, v, start) => {
      const trade = m.atoms.find((a): a is TransactionalTradeAtom => a.kind === "TRANSACTIONAL_TRADE");
      const base = start.atoms.find((a): a is TransactionalTradeAtom => a.kind === "TRANSACTIONAL_TRADE");
      const fair = !trade || !base || trade.visitorsPerDay <= base.visitorsPerDay + 0.5;
      return { done: v.firstMonthProfit >= 0 && fair, progress: `${t("tulos")} ${money(v.firstMonthProfit)} · ${yes(fair)} ${t("ohikulkijat ennallaan")}` };
    },
  },
  {
    id: "bottleneck",
    title: msg("Pullonkaula"),
    brief: msg("Konsultilla on enemmän kysyntää kuin aikaa. Asiakkaita jää palvelematta."),
    goal: msg("Kaikki kysyntä palvellaan ja tulos on parempi kuin alussa."),
    hint: msg("Avaa Toimituskyky. Kannattaako palkata, nostaa hintaa vai molempia?"),
    learn: msg("Pullonkaula rajoittaa koko yritystä. Sen poistaminen kasvattaa myyntiä eniten."),
    preset: "it_consultant",
    setup: (m) => ({ ...m, credit: { ...m.credit, customerTermsDays: 14 }, atoms: m.atoms.map((a) => (a.kind === "TIME_CAPACITY" ? { ...a, demandHoursPerMonth: 200 } : a)) }),
    check: (m, v, start) => {
      const lost = v.econ.reduce((s, e) => s + e.lostDemand, 0);
      const startProfit = startViewProfit(start);
      return {
        done: lost < 0.5 && v.firstMonthProfit > startProfit + 1,
        progress: `${t("myymättä")} ${num(lost)} h · ${t("tulos")} ${money(v.firstMonthProfit)} (${t("alussa")} ${money(startProfit)})`,
      };
    },
  },
  {
    id: "unit-economics",
    title: msg("Tilausten yksikkötalous"),
    brief: msg("Ohjelmistoyrityksen asiakashankinta on liian kallista."),
    goal: msg("Asiakkaan elinkaariarvo on vähintään 3 × hankintakulu."),
    hint: msg("Elinkaariarvo = kuukausikate / poistuma. Kolme vipua: hinta, poistuma, hankintakulu."),
    learn: msg("Jos asiakas tuottaa vähemmän kuin hänen hankkimisensa maksaa, kasvu syö kassaa."),
    preset: "saas_hybrid",
    setup: (m) => ({ ...m, atoms: m.atoms.map((a) => (a.kind === "RECURRING_SUB" ? { ...a, cacPerNew: 2500 } : a)) }),
    check: (m) => {
      const s = m.atoms.find((a): a is RecurringSubAtom => a.kind === "RECURRING_SUB");
      if (!s) return { done: false, progress: "–" };
      const ratio = s.cacPerNew > 0 ? (s.pricePerMonth - s.costPerSubscriberMonth) / Math.max(0.001, s.churnRateMonthly) / s.cacPerNew : 99;
      return { done: ratio >= 3, progress: t("suhde nyt {r} (tavoite 3)", { r: num(ratio, 1) }) };
    },
  },
  {
    id: "bad-quarter",
    title: msg("Kestä huono kvartaali"),
    brief: msg("Verkkokauppa toimii, mutta kestääkö se, jos myynti putoaa neljänneksellä?"),
    goal: msg("Myynnin pudotessa 25 % kassa ei lopu – ilman lisärahaa."),
    hint: msg("Pienennä kiinteitä kuluja tai varaston sitomaa rahaa, tai paranna katetta."),
    learn: msg("Stressitesti: hyvä suunnitelma kestää myös huonon skenaarion."),
    preset: "webshop",
    setup: (m) => ({ ...m, credit: { ...m.credit, openingCash: 3000 }, fixedCosts: m.fixedCosts.map((c) => (c.category === "marketing" ? { ...c, amountPerMonth: 2500 } : c)) }),
    check: (m, _v, start) => {
      const s = stressTest(m, { volumeChange: -0.25 }).stressed;
      const noExtra = m.credit.openingCash <= start.credit.openingCash + 1;
      return { done: s.cashOutDay === null && noExtra, progress: `${yes(s.cashOutDay === null)} ${t("kassa kestää −25 %")} · ${yes(noExtra)} ${t("ei lisärahaa")}` };
    },
  },
  {
    id: "seasons",
    title: msg("Selviä talvesta"),
    brief: msg("Jäätelökioski aloittaa lokakuussa. Kesä on vilkas, mutta talvi on pitkä."),
    goal: msg("Kassa riittää talven yli – ilman lisärahaa."),
    hint: msg("Kiinteät kulut juoksevat myös hiljaisella kaudella. Voiko kioskin pitää kiinni talvella tai myydä talvella jotain muuta?"),
    learn: msg("Kausivaihtelussa kesän tulos pitää säästää talven varalle."),
    preset: "food_kiosk",
    setup: (m) => ({ ...m, name: t("Jäätelökioski"), credit: { ...m.credit, openingCash: 1000 }, seasonality: [...SEASON_PROFILES.summer.factors], startMonth: 9 }),
    check: (m, v, start) => {
      const noExtra = m.credit.openingCash <= start.credit.openingCash + 1;
      return { done: v.sim.cashOutDay === null && noExtra, progress: `${yes(v.sim.cashOutDay === null)} ${t("kassa riittää")} · ${yes(noExtra)} ${t("ei lisärahaa")}` };
    },
  },
];

function startViewProfit(start: Molecule): number {
  return simulate(start).months[0]?.operatingProfit ?? 0;
}

export function taskStart(id: string): Molecule | null {
  const def = TASKS.find((x) => x.id === id);
  if (!def) return null;
  const base = createPreset(def.preset);
  return def.setup ? def.setup(base) : base;
}
