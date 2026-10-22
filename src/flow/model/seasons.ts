/**
 * APEX Studio — kausivaihtelu ja kriisikortit (`src/flow/model/seasons.ts`).
 *
 * Kausiprofiilit ovat valmiita lähtökohtia, joita käyttäjä voi muokata.
 * Kriisikortit ovat tyypillisiä yrittäjän kohtaamia tilanteita; niiden vaikutukset
 * ovat esimerkkejä, eivät ennusteita, ja niitä voi säätää vapaasti.
 */
import type { BusinessEvent, Molecule } from "../kernel/types.ts";
import { newId } from "../kernel/presets.ts";
import { msg, t } from "../i18n/index.ts";
import type { FlowCommand } from "./commands.ts";

export type SeasonProfileId = "flat" | "summer" | "christmas" | "b2b" | "winter";

export const SEASON_PROFILES: Record<SeasonProfileId, { title: string; hint: string; factors: number[] }> = {
  flat: { title: msg("Tasainen"), hint: msg("Kysyntä on sama joka kuukausi"), factors: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1] },
  summer: {
    title: msg("Kesäpainotteinen"),
    hint: msg("Jäätelö, terassi, matkailu: kesä vilkas, talvi hiljainen"),
    factors: [0.3, 0.35, 0.5, 0.8, 1.3, 1.9, 2.2, 1.9, 1.0, 0.6, 0.4, 0.45],
  },
  christmas: {
    title: msg("Joulupainotteinen"),
    hint: msg("Vähittäiskauppa, lahjat: marras–joulukuu vilkkaimmat"),
    factors: [0.8, 0.75, 0.85, 0.9, 0.95, 0.9, 0.85, 0.9, 0.95, 1.05, 1.5, 2.1],
  },
  b2b: {
    title: msg("Yrityspalvelu (B2B)"),
    hint: msg("Heinäkuu ja joulun aika hiljaisia, muuten tasainen"),
    factors: [1.0, 1.05, 1.1, 1.05, 1.05, 0.9, 0.35, 0.85, 1.15, 1.15, 1.1, 0.75],
  },
  winter: {
    title: msg("Talvipainotteinen"),
    hint: msg("Hiihtokeskus, lämmitys, talvirenkaat"),
    factors: [1.8, 1.9, 1.6, 1.0, 0.5, 0.35, 0.3, 0.35, 0.6, 0.9, 1.3, 1.7],
  },
};

export interface CrisisCard {
  id: string;
  title: string;
  description: string;
  durationMonths: number;
  volumeChange?: number;
  priceChange?: number;
  variableCostChange?: number;
  fixedCostChange?: number;
  oneOffCost?: number;
  /** Ehdotetut vastaukset (valmentaja tarjoaa näitä). */
  responses: { label: string; commands: (m: Molecule) => FlowCommand[] }[];
}

const firstPriceTarget = (m: Molecule): FlowCommand[] => {
  const a = m.atoms.find((x) => x.enabled);
  if (!a) return [];
  const field = { TIME_CAPACITY: "hourlyRate", PHYSICAL_MATTER: "unitPrice", RECURRING_SUB: "pricePerMonth", TRANSACTIONAL_TRADE: "averageTicket" }[a.kind];
  return [{ type: "scale_atom_field", atomId: a.id, field, factor: 1.08 }];
};

const addBuffer = (amount: number) => (m: Molecule): FlowCommand[] => [{ type: "set_credit", field: "openingCash", value: m.credit.openingCash + amount }];

export const CRISIS_LIBRARY: CrisisCard[] = [
  {
    id: "big-customer-leaves",
    title: msg("Suurin asiakas lähtee"),
    description: msg("Tärkein asiakas kilpailuttaa ja valitsee toisen. Myynti putoaa, kunnes uusia asiakkaita löytyy."),
    durationMonths: 6,
    volumeChange: -0.3,
    responses: [
      { label: msg("Nosta hintoja 8 % muille"), commands: firstPriceTarget },
      { label: msg("Lisää kassapuskuria 5 000 €"), commands: addBuffer(5000) },
    ],
  },
  {
    id: "competitor",
    title: msg("Kilpailija avaa viereen"),
    description: msg("Uusi kilpailija houkuttelee osan asiakkaista ja pakottaa laskemaan hintoja."),
    durationMonths: 6,
    volumeChange: -0.15,
    priceChange: -0.07,
    responses: [{ label: msg("Lisää kassapuskuria 3 000 €"), commands: addBuffer(3000) }],
  },
  {
    id: "energy",
    title: msg("Energian hinta nousee"),
    description: msg("Sähkö ja muut kiinteät kulut kallistuvat talveksi."),
    durationMonths: 4,
    fixedCostChange: 0.12,
    responses: [{ label: msg("Nosta hintoja 8 %"), commands: firstPriceTarget }],
  },
  {
    id: "raw-materials",
    title: msg("Raaka-aineiden hinnat nousevat"),
    description: msg("Toimittajat korottavat hintoja. Jokainen myynti tuottaa vähemmän katetta."),
    durationMonths: 6,
    variableCostChange: 0.25,
    responses: [{ label: msg("Nosta hintoja 8 %"), commands: firstPriceTarget }],
  },
  {
    id: "sick",
    title: msg("Sairastut kuukaudeksi"),
    description: msg("Yrittäjä on poissa töistä. Myynti lähes pysähtyy, mutta kiinteät kulut juoksevat."),
    durationMonths: 1,
    volumeChange: -0.8,
    responses: [{ label: msg("Lisää kassapuskuria 5 000 €"), commands: addBuffer(5000) }],
  },
  {
    id: "equipment",
    title: msg("Tärkeä laite hajoaa"),
    description: msg("Kone, auto tai tietokone pitää korvata heti."),
    durationMonths: 1,
    oneOffCost: 3000,
    responses: [{ label: msg("Lisää kassapuskuria 3 000 €"), commands: addBuffer(3000) }],
  },
  {
    id: "boom",
    title: msg("Somehitti: kysyntä räjähtää"),
    description: msg("Juttu leviää ja kysyntä kasvaa hetkessä. Riittääkö toimituskyky?"),
    durationMonths: 3,
    volumeChange: 0.6,
    responses: [{ label: msg("Nosta hintoja 8 %"), commands: firstPriceTarget }],
  },
];

/** Luo mallin tapahtuman kriisikortista (otsikko käännetään luontihetken kielelle). */
export function eventFromCard(card: CrisisCard, startMonth: number): BusinessEvent {
  return {
    id: newId("ev"),
    title: t(card.title),
    libraryId: card.id,
    startMonth: Math.max(0, Math.min(11, Math.round(startMonth))),
    durationMonths: card.durationMonths,
    volumeChange: card.volumeChange,
    priceChange: card.priceChange,
    variableCostChange: card.variableCostChange,
    fixedCostChange: card.fixedCostChange,
    oneOffCost: card.oneOffCost,
  };
}

/** Satunnainen kriisi (siemenellä toistettava). */
export function randomCrisis(seed: number): { card: CrisisCard; startMonth: number } {
  const harmful = CRISIS_LIBRARY.filter((c) => c.id !== "boom");
  const r1 = Math.abs(Math.sin(seed * 12.9898) * 43758.5453) % 1;
  const r2 = Math.abs(Math.sin(seed * 78.233) * 12345.678) % 1;
  return { card: harmful[Math.floor(r1 * harmful.length)], startMonth: 1 + Math.floor(r2 * 8) };
}

/** Selkokielinen kuvaus tapahtuman vaikutuksista. */
export function describeEventEffects(e: Pick<BusinessEvent, "volumeChange" | "priceChange" | "variableCostChange" | "fixedCostChange" | "oneOffCost">): string {
  const parts: string[] = [];
  const p = (x: number) => `${x > 0 ? "+" : ""}${Math.round(x * 100)} %`;
  if (e.volumeChange) parts.push(t("kysyntä {p}", { p: p(e.volumeChange) }));
  if (e.priceChange) parts.push(t("hinnat {p}", { p: p(e.priceChange) }));
  if (e.variableCostChange) parts.push(t("muuttuvat kulut {p}", { p: p(e.variableCostChange) }));
  if (e.fixedCostChange) parts.push(t("kiinteät kulut {p}", { p: p(e.fixedCostChange) }));
  if (e.oneOffCost) parts.push(t("kertakulu {amount} €", { amount: Math.round(e.oneOffCost) }));
  return parts.join(", ");
}
