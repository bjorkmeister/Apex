/**
 * APEX Studio — liikeidea omin sanoin → malli (`src/flow/model/genesis.ts`).
 *
 * Tämä on sääntöpohjainen tulkki, joka toimii aina ilman kielimallia: avainsanat
 * kertovat, millaisia tulovirtoja yrityksessä on, ja tekstissä mainitut luvut
 * (hinta, maksuaika, alkupääoma) asetetaan malliin. Kielimallin versio
 * (palvelimella) palauttaa samat tarkistetut komennot.
 */
import type { AtomKind, Molecule } from "../kernel/types.ts";
import { emptyMolecule, fixedCost } from "../kernel/presets.ts";
import { addAtom, setAtomField } from "./edit.ts";
import { parseIntent } from "./intent.ts";
import { applyCommands } from "./commands.ts";
import { emptyChecklist } from "./launchpad.ts";
import { SEASON_PROFILES, type SeasonProfileId } from "./seasons.ts";
import { withProvenance, provKey } from "./provenance.ts";
import { t } from "../i18n/index.ts";

const KIND_PATTERNS: Record<AtomKind, RegExp> = {
  TIME_CAPACITY:
    /konsult|suunnittel|koodaa|ohjelmoi|kirjanpit|lakimie|lakiasia|valmenta|parturi|kampaamo|hieroja|hieronta|siivo|remont|valokuva|kääntä|opetta|tutor|design|graafi|toimisto|freelanc|asiantunti|osaamis|tunti|consult|hairdress|barber|massage|cleaning|photograph|developer|agency|lawyer|accountant|coach|trainer|tutoring|renovat|translat|hourly/,
  PHYSICAL_MATTER:
    /verkkokaup|tuotte|tuote|käsityö|valmista|tukku|vaate|kosmetiik|koru|kirjoja myy|tavara|webshop|e-?commerce|online store|products?|handmade|manufactur|wholesale|clothing|cosmetics|jewel|merch/,
  RECURRING_SUB:
    /saas|ohjelmisto|sovellus|jäsen|kuukausimaks|kuukausitila|tilaus|abonnem|kuntosali|ylläpitosopim|retainer|software|subscription|membership|\bapp\b|gym|platform|alusta/,
  TRANSACTIONAL_TRADE:
    /kahvila|kioski|ravintola|grilli|nakki|jäätelö|ruokarek|food ?truck|myymälä|baari|pizzer|lounas|leipomo|lähikauppa|kivijalka|café|cafe|kiosk|restaurant|\bbar\b|\bshop\b|ice cream|bakery|street food|hot dog/,
};

const SEASON_PATTERNS: [SeasonProfileId, RegExp][] = [
  ["summer", /jäätelö|terassi|kesä|ranta|mökki|matkailu|ice cream|summer|terrace|beach|tourism/],
  ["christmas", /joulu|lahja|christmas|gift/],
  ["winter", /hiihto|laskettelu|talvi|ski|winter|snow/],
];

export interface GenesisResult {
  molecule: Molecule;
  kinds: AtomKind[];
  notes: string[];
}

function nameFromIdea(idea: string): string {
  const clean = idea
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(minä |mä )?(haluan|aion|ajattelin|suunnittelen|meinaan)\s+/i, "")
    .replace(/^(perustaa|perustan|aloittaa|aloitan|avata|avaan|käynnistää)\s+/i, "")
    .replace(/^(i (want|plan|would like|'d like) to|i'm going to|let's)\s+/i, "")
    .replace(/^(start|open|launch|run|build)\s+(a|an|my)?\s*/i, "");
  const first = clean.split(/[.,!?;\n]/)[0].trim();
  const short = first.length > 40 ? `${first.slice(0, 38).trim()}…` : first;
  return short ? short.charAt(0).toUpperCase() + short.slice(1) : t("Oma yritys");
}

export function detectKinds(idea: string): AtomKind[] {
  const text = idea.toLowerCase();
  return (Object.keys(KIND_PATTERNS) as AtomKind[]).filter((k) => KIND_PATTERNS[k].test(text));
}

export function ideaToMolecule(idea: string): GenesisResult {
  const text = idea.toLowerCase();
  const notes: string[] = [];
  let kinds = detectKinds(idea);
  if (kinds.length === 0) {
    kinds = ["TIME_CAPACITY"];
    notes.push(t("En tunnistanut toimialaa, joten aloitin asiantuntijatyöstä. Lisää tai vaihda tulovirtoja Kysyntä-paneelissa."));
  }
  let m = emptyMolecule(nameFromIdea(idea));
  for (const k of kinds) m = addAtom(m, k);

  const time = m.atoms.find((a) => a.kind === "TIME_CAPACITY");
  const costs = [fixedCost(t("Kirjanpito"), 150, "admin", 5)];
  if (!time) costs.push(fixedCost(t("Oma palkka (nosto)"), 2500, "other", 15));
  if (kinds.includes("TRANSACTIONAL_TRADE")) costs.push(fixedCost(t("Toimitila tai paikkavuokra"), 900, "rent", 1));
  if (kinds.includes("PHYSICAL_MATTER")) costs.push(fixedCost(t("Varasto ja verkkokauppa-alusta"), 400, "rent", 1), fixedCost(t("Mainonta"), 500, "marketing", 1));
  if (kinds.includes("RECURRING_SUB")) costs.push(fixedCost(t("Pilvipalvelut"), 200, "software", 1), fixedCost(t("Markkinointi"), 800, "marketing", 1));
  if (time && kinds.length === 1) costs.push(fixedCost(t("Ohjelmistot ja laitteet"), 120, "software", 1));
  m = { ...m, fixedCosts: costs };

  // Rahat tulevat heti, jos laskutettavia virtoja ei ole.
  if (!m.atoms.some((a) => a.kind === "TIME_CAPACITY" || a.kind === "PHYSICAL_MATTER")) {
    m = { ...m, credit: { ...m.credit, customerTermsDays: 0 } };
  }
  if (time && /parturi|kampaamo|hieroja|hieronta|hairdress|barber|massage/.test(text)) {
    m = setAtomField(m, time.id, "paymentTermsDays", 1);
    notes.push(t("Palvelu maksetaan paikan päällä, joten maksuaika on 1 päivä."));
  }

  // Kausivaihtelu tekstin perusteella.
  for (const [profile, re] of SEASON_PATTERNS) {
    if (re.test(text)) {
      m = { ...m, seasonality: [...SEASON_PROFILES[profile].factors], startMonth: new Date().getMonth() };
      notes.push(t("Lisäsin kausivaihtelun: {profile}.", { profile: t(SEASON_PROFILES[profile].title) }));
      break;
    }
  }

  // Alkupääoma: "alkupääoma 10 000 €", "starting capital €10,000".
  const capital = /(alkupääom\w*|säästö\w*|pääom\w*|starting capital|savings|capital)[^0-9]{0,15}(\d[\d\s.,]*)\s*(k\b|t\b|tuhatta|thousand)?/.exec(text);
  if (capital) {
    let v = Number(capital[2].replace(/[\s.]/g, "").replace(",", "."));
    if (capital[3]) v *= 1000;
    if (Number.isFinite(v) && v > 0 && v < 1e8) {
      m = withProvenance({ ...m, credit: { ...m.credit, openingCash: v } }, [provKey("credit", "openingCash")], "genesis");
      notes.push(t("Alkukassa: {amount} €.", { amount: Math.round(v) }));
    }
  }

  // Hinnat ja maksuajat tekstistä samalla tulkilla kuin keskustelussa.
  const intent = parseIntent(idea, m).commands.filter((c) => c.type === "set_atom_field" || c.type === "scale_atom_field" || c.type === "set_credit");
  if (intent.length > 0) m = applyCommands(m, emptyChecklist(), intent, { source: "genesis" }).molecule;

  return { molecule: m, kinds, notes };
}
