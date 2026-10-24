/**
 * APEX Studio — sääntöpohjainen komentotulkki (`src/flow/model/intent.ts`).
 *
 * Ymmärtää yleisimmät suomen- ja englanninkieliset pyynnöt ilman kielimallia ja
 * muuntaa ne validoitaviksi komennoiksi. Kun kielimalli on käytössä, sitä käytetään
 * ensin; tämä tulkki on varajärjestelmä, joka toimii aina.
 */
import type { AtomKind, Molecule } from "../kernel/types.ts";
import type {
  AtomKind as GraphAtomKind,
  EnterpriseGraph,
  NodeBand,
  OptimisticNodePatch,
} from "../graph/types.ts";
import {
  applyOptimisticPatch,
  type OptimisticDraftSpec,
} from "../graph/optimistic.ts";
import type { FlowCommand } from "./commands.ts";
import { priceFieldFor } from "./coach.ts";
import { msg, t } from "../i18n/index.ts";

export interface IntentResult {
  reply: string;
  commands: FlowCommand[];
  understood: boolean;
}

export const RULE_EXAMPLES = [
  msg("Nosta hintaa 10 %"),
  msg("Tuntihinta 95 €"),
  msg("Maksuaika 14 päivää"),
  msg("Palkkaa uusi työntekijä"),
  msg("Lisää kulu toimisto 600 €"),
  msg("Lisää kuukausisopimukset 300 € / kk"),
  msg("Mitä jos myynti putoaa 20 %?"),
];

const num = (s: string): number => Number(s.replace(/\s/g, "").replace(",", "."));

function targetAtoms(m: Molecule, text: string) {
  const enabled = m.atoms.filter((a) => a.enabled);
  const named = enabled.filter((a) => text.includes(a.label.toLowerCase()));
  return named.length > 0 ? named : enabled;
}

const N = String.raw`(\d+(?:[ ,.]\d+)?)`;

export function parseIntent(message: string, m: Molecule): IntentResult {
  const text = message.toLowerCase().replace(/\s+/g, " ").trim();
  const commands: FlowCommand[] = [];
  const replies: string[] = [];

  // Stressitesti: "mitä jos myynti putoaa 20 %" / "what if sales drop 20%"
  const stress =
    new RegExp(String.raw`mitä jos.*(myynti|kysyntä|asiakkaat|asiakasmäärä)[^0-9]*?(putoa|laske|vähene|sakkaa|romahta)[^0-9]*${N}\s*%`).exec(text) ??
    new RegExp(String.raw`what if.*(sales|demand|customers|revenue)[^0-9]*?(drop|fall|decline|decrease|shrink)[^0-9]*${N}\s*%`).exec(text);
  if (stress) {
    const x = num(stress[3]) / 100;
    commands.push({ type: "stress", stress: { volumeChange: -x } });
    replies.push(t("Ajoin stressitestin: myynti −{pct} %. Näet tuloksen kassapaneelissa.", { pct: Math.round(x * 100) }));
    return { reply: replies.join(" "), commands, understood: true };
  }

  // Hinta prosentteina.
  const pricePct =
    new RegExp(String.raw`(nosta|korota|laske|alenna|pudota)\w*\s.*?(hin\w*)[^0-9]*${N}\s*(%|prosent)`).exec(text) ??
    new RegExp(String.raw`(raise|increase|lift|lower|cut|reduce|decrease)\s.*?(price\w*)[^0-9]*${N}\s*(%|percent)`).exec(text);
  // Hinta euroina.
  const priceAbs =
    new RegExp(String.raw`(tuntihin\w*|hin\w*|keskiosto\w*|kuukausihin\w*)\s*(on|olkoon|→|=|:)?\s*${N}\s*(€|e\b|euro)`).exec(text) ??
    new RegExp(String.raw`(hourly rate|price|average ticket|monthly price)\s*(is|to|=|:|of)?\s*€?\s*${N}\s*(€|eur|euro)?`).exec(text);
  if (pricePct) {
    const sign = /laske|alenna|pudota|lower|cut|reduce|decrease/.test(pricePct[1]) ? -1 : 1;
    const factor = 1 + (sign * num(pricePct[3])) / 100;
    for (const a of targetAtoms(m, text)) commands.push({ type: "scale_atom_field", atomId: a.id, field: priceFieldFor(a.kind), factor });
    replies.push(t("Muutin hintaa {sign}{pct} %.", { sign: sign > 0 ? "+" : "−", pct: pricePct[3] }));
  } else if (priceAbs && !/kulu|cost/.test(text)) {
    const value = num(priceAbs[3]);
    const wantsHourly = /tunti|hourly/.test(priceAbs[1]);
    const atoms = targetAtoms(m, text).filter((a) => !wantsHourly || a.kind === "TIME_CAPACITY");
    for (const a of atoms) commands.push({ type: "set_atom_field", atomId: a.id, field: priceFieldFor(a.kind), value });
    if (atoms.length > 0) replies.push(t("Asetin hinnaksi {amount} €.", { amount: value }));
  }

  // Maksuaika.
  const terms = /maksua\w*[^0-9]*(\d+)\s*(pv|päiv|vrk)?/.exec(text) ?? /payment terms?[^0-9]*(\d+)\s*(days?|d)?/.exec(text);
  if (terms) {
    const supplier = /toimittaja|supplier/.test(text);
    commands.push({ type: "set_credit", field: supplier ? "supplierTermsDays" : "customerTermsDays", value: Math.min(365, num(terms[1])) });
    replies.push(supplier ? t("Toimittajan maksuaika on nyt {n} päivää.", { n: terms[1] }) : t("Asiakkaan maksuaika on nyt {n} päivää.", { n: terms[1] }));
  }

  // Rekry.
  if (/(palkkaa|rekrytoi|palkkaisin|otan)\b.*(työntekijä|henkilö|tekijä|konsultti|apulai|myyjä|kaveri)/.test(text) || /\b(hire|recruit)\b/.test(text)) {
    const time = m.atoms.find((a) => a.enabled && a.kind === "TIME_CAPACITY");
    if (time && time.kind === "TIME_CAPACITY") {
      commands.push({ type: "set_atom_field", atomId: time.id, field: "people", value: time.people + 1 });
      replies.push(t("Lisäsin tekijän: {label} – nyt {n} henkilöä. Katso toimituskyky-paneelista, maksaako rekry itsensä.", { label: time.label, n: time.people + 1 }));
    } else {
      commands.push({ type: "add_fixed_cost", label: t("Työntekijä (palkka + sivukulut)"), amountPerMonth: Math.round(3000 * 1.21), dayOfMonth: 15, category: "other" });
      replies.push(t("Lisäsin työntekijän kiinteäksi kuluksi (3 000 € + 21 % sivukulut). Muokkaa summaa kulupaneelissa."));
    }
  }

  // Kiinteä kulu.
  const cost =
    new RegExp(String.raw`lisää\s+(?:kiinteä\s+)?(?:kulu|kuluihin|kuluksi)\s+(.+?)\s+${N}\s*(€|e\b|euro)`).exec(text) ??
    new RegExp(String.raw`add\s+(?:a\s+)?(?:fixed\s+)?cost\s+(?:for\s+)?(.+?)\s+€?${N}\s*(€|eur|euro)?`).exec(text);
  if (cost) {
    const label = cost[1].replace(/[:\-–]+$/, "").trim();
    const amount = num(cost[2]);
    commands.push({ type: "add_fixed_cost", label: label.charAt(0).toUpperCase() + label.slice(1), amountPerMonth: amount });
    replies.push(t("Lisäsin kiinteän kulun \"{label}\" {amount} € / kk.", { label, amount }));
  }

  // Uusi tulovirta.
  if (/lisää|aloita|haluan myydä|otan käyttöön|\badd\b|\bstart\b|\bsell\b/.test(text) && !cost) {
    let kind: AtomKind | null = null;
    let label: string | undefined;
    if (/kuukausi(tila|sopim|maks)|tilaus|jäsenyy|ylläpito|retainer|abonnement|subscription|membership|maintenance/.test(text)) {
      kind = "RECURRING_SUB";
      label = /ylläpito|maintenance/.test(text) ? t("Ylläpitosopimukset") : t("Kuukausitilaukset");
    } else if (/tuote|tavara|verkkokaup|varasto|product|goods|webshop|online store|inventory/.test(text)) {
      kind = "PHYSICAL_MATTER";
      label = t("Tuotemyynti");
    } else if (/tiski|kioski|myymälä|kahvila|tapahtuma|counter|kiosk|shop|café|cafe|store/.test(text)) {
      kind = "TRANSACTIONAL_TRADE";
      label = t("Tiskimyynti");
    } else if (/tunti|konsultoi|palvelu|koulutu|projekti|hours|consult|service|training|project/.test(text)) {
      kind = "TIME_CAPACITY";
      label = /koulutu|training/.test(text) ? t("Koulutukset") : t("Asiantuntijatyö");
    }
    if (kind) {
      const params: Record<string, number> = {};
      const monthly = /(\d+[,.]?\d*)\s*(€|e|euroa|eur)?\s*\/\s*(kk|kuukau|month|mo)/.exec(text) ?? /€\s*(\d+[,.]?\d*)\s*\/\s*(month|mo)/.exec(text);
      let assumption = "";
      if (kind === "RECURRING_SUB") {
        if (monthly) params.pricePerMonth = num(monthly[1]);
        if (/sopimu|ylläpito|retainer|contract|maintenance/.test(text) || (params.pricePerMonth ?? 0) >= 100) {
          label = /ylläpito|maintenance/.test(text) ? t("Ylläpitosopimukset") : t("Kuukausisopimukset");
          Object.assign(params, { newPerMonth: 1, startingSubscribers: 0, churnRateMonthly: 0.02, cacPerNew: 0, costPerSubscriberMonth: 0 });
          assumption = " " + t("Oletin yhden uuden sopimuksen kuussa ja 2 % poistuman – säädä nämä vivuista.");
        }
      }
      commands.push({ type: "add_atom", kind, label, params });
      replies.push(t("Lisäsin uuden tulovirran: {label}. Sen vivut ilmestyivät oikealle – säädä luvut omiksesi.", { label: label ?? "" }) + assumption);
    }
  }

  if (commands.length === 0) {
    return {
      reply: t("En ymmärtänyt pyyntöä ilman kielimallia. Voit kokeilla esimerkiksi: {examples}. Kun kielimalli on kytketty (asetukset), ymmärrän vapaamuotoisempia pyyntöjä.", {
        examples: RULE_EXAMPLES.map((e) => `"${t(e)}"`).join(", "),
      }),
      commands: [],
      understood: false,
    };
  }
  return { reply: replies.join(" "), commands, understood: true };
}

export interface GraphIntentResult {
  understood: boolean;
  reply: string;
  draft: OptimisticDraftSpec;
}

/**
 * Nopeus 2 paikallinen luonnostulkki (`parseGraphIntent`, TSD 1.3 A4 & 8.1):
 * Muodostaa käyttäjän luonnollisen kielen pyynnöstä välittömän paikallisen `OptimisticDraftSpec`-luonnoksen
 * `< 50 ms` vasteajalla ilman kielimallikutsua.
 */
export function parseGraphIntent(
  message: string,
  graph: EnterpriseGraph,
): GraphIntentResult {
  const clean = message.replace(/\s+/g, " ").trim();
  const lower = clean.toLowerCase();

  let atom: GraphAtomKind = "time_capacity";
  let band: NodeBand = "value_stream";
  let unitUri: "apex://unit/items" | "apex://unit/hours" | "apex://unit/subscribers" | "apex://unit/transactions" =
    "apex://unit/items";

  if (/kuukausi|tilaus|sopimus|jäsenyy|ylläpito|retainer|subscription|recurring|membership/.test(lower)) {
    atom = "recurring_subscription";
    unitUri = "apex://unit/subscribers";
  } else if (/tuote|valmistu|varasto|raaka-aine|tehdas|pakkau|toimittaja|hankin|physical|inventory|product|manufactur|sourcing|supplier/.test(lower)) {
    atom = "physical_matter";
    unitUri = "apex://unit/items";
  } else if (/kanava|myymälä|verkkokaup|kassa|kampanja|liidi|markkinoin|jakelu|channel|store|shop|checkout|funnel|lead/.test(lower)) {
    atom = "transactional_trade";
    unitUri = "apex://unit/transactions";
  } else {
    atom = "time_capacity";
    unitUri = "apex://unit/hours";
  }

  if (/hallinto|tuki|talous|kirjanpito|lakisääte|it-tuki|hr|support|governance|admin|backoffice/.test(lower)) {
    band = "enabling";
  }

  // Poimi mahdollinen euromäärä
  const eurMatch = /(\d+(?:[ ,.]\d+)?)\s*(?:€|eur|euro)/i.exec(clean);
  const parsedEur = eurMatch ? num(eurMatch[1]!) : 110;

  // Muodosta selkeä nimi pyynnöstä poistamalla aloituskomentosanat
  const stripped = clean
    .replace(
      /^(lisää|luo|rakenna|avaa|käynnistä|kytke|suunnittele|add|create|build|open|launch|connect|design)\s+(uusi\s+|new\s+)?(prosessisolmu\s+|solmu\s+|vaihe\s+|tulovirta\s+|kanava\s+|node\s+|step\s+|stream\s+)?/i,
      "",
    )
    .replace(/\s+\d+(?:[ ,.]\d+)?\s*(?:€|eur|euro).*$/i, "")
    .trim();

  const rawTitle = stripped.length >= 2 ? stripped : t("Uusi luonnossolmu");
  const nodeName = rawTitle.charAt(0).toUpperCase() + rawTitle.slice(1);

  const parentUri =
    graph.scopeRoot && graph.nodes[graph.scopeRoot] ? graph.scopeRoot : graph.root;

  const draft: OptimisticDraftSpec = {
    name: nodeName,
    parentUri,
    band,
    apqcCategory: band === "value_stream" ? 3.0 : 8.0,
    atom,
    unitUri,
    estimatedUnitPrice: parsedEur,
    estimatedUnitCost: Math.round(parsedEur * 0.3),
    estimatedCapacityPerTick: 15,
    estimatedCycleTicks: 1,
    estimatedFixedCostPerTick: 12,
  };

  return {
    understood: clean.length > 0,
    reply: t("Loin välittömän paikallisen luonnossolmun '{name}' (luonnos, odottaa tarkennusta). Luonnoksen lukuja ei lasketa kassaan, pääkirjaan eikä KPI-mittareihin ennen vahvistusta.", { name: nodeName }),
    draft,
  };
}

/**
 * Luo ja kytkee välittömästi paikallisen `OptimisticNodePatch` ghost-solmun käyttäjän luonnollisen
 * kielen pyynnöstä `< 50 ms` vasteajalla (Nopeus 2, Invariantti A4).
 */
export function createOptimisticDraftFromIntent(
  message: string,
  graph: EnterpriseGraph,
): {
  graph: EnterpriseGraph;
  patch: OptimisticNodePatch;
  draft: OptimisticDraftSpec;
  reply: string;
  elapsedMs: number;
} {
  const parsed = parseGraphIntent(message, graph);
  const applied = applyOptimisticPatch(graph, message, parsed.draft);
  return {
    graph: applied.graph,
    patch: applied.patch,
    draft: parsed.draft,
    reply: parsed.reply,
    elapsedMs: applied.elapsedMs,
  };
}
