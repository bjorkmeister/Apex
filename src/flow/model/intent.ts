/**
 * APEX Flow — sääntöpohjainen komentotulkki (`src/flow/model/intent.ts`).
 *
 * Ymmärtää yleisimmät suomenkieliset pyynnöt ilman kielimallia ja muuntaa ne
 * validoitaviksi komennoiksi. Kun kielimalli on käytössä, sitä käytetään ensin;
 * tämä tulkki on varajärjestelmä, joka toimii aina.
 */
import type { AtomKind, Molecule } from "../kernel/types.ts";
import type { FlowCommand } from "./commands.ts";
import { priceFieldFor } from "./coach.ts";

export interface IntentResult {
  reply: string;
  commands: FlowCommand[];
  understood: boolean;
}

export const RULE_EXAMPLES = [
  "Nosta hintaa 10 %",
  "Tuntihinta 95 €",
  "Maksuaika 14 päivää",
  "Palkkaa uusi työntekijä",
  "Lisää kulu toimisto 600 €",
  "Lisää kuukausisopimukset 300 € / kk",
  "Mitä jos myynti putoaa 20 %?",
];

const num = (s: string): number => Number(s.replace(/\s/g, "").replace(",", "."));

function targetAtoms(m: Molecule, text: string) {
  const enabled = m.atoms.filter((a) => a.enabled);
  const named = enabled.filter((a) => text.includes(a.label.toLowerCase()));
  return named.length > 0 ? named : enabled;
}

export function parseIntent(message: string, m: Molecule): IntentResult {
  const t = message.toLowerCase().replace(/\s+/g, " ").trim();
  const commands: FlowCommand[] = [];
  const replies: string[] = [];

  // Stressitesti: "mitä jos myynti putoaa 20 %"
  const stress = /mitä jos.*(myynti|kysyntä|asiakkaat|asiakasmäärä)[^0-9]*?(putoa|laske|vähene|sakkaa|romahta)[^0-9]*(\d+[,.]?\d*)\s*%/.exec(t);
  if (stress) {
    const x = num(stress[3]) / 100;
    commands.push({ type: "stress", stress: { volumeChange: -x } });
    replies.push(`Ajoin stressitestin: myynti −${Math.round(x * 100)} %. Näet tuloksen kassapaneelissa.`);
    return { reply: replies.join(" "), commands, understood: true };
  }

  // Hinta prosentteina: "nosta hintaa 10 %", "laske hintoja 5 %"
  const pricePct = /(nosta|korota|laske|alenna|pudota)\w*\s.*?(hin\w*)[^0-9]*(\d+[,.]?\d*)\s*(%|prosent)/.exec(t);
  // Hinta euroina: "tuntihinta 95 €", "hinta 120 euroa"
  const priceAbs = /(tuntihin\w*|hin\w*|keskiosto\w*|kuukausihin\w*)\s*(on|olkoon|→|=|:)?\s*(\d+[,.]?\d*)\s*(€|e\b|euro)/.exec(t);
  if (pricePct) {
    const sign = /laske|alenna|pudota/.test(pricePct[1]) ? -1 : 1;
    const factor = 1 + (sign * num(pricePct[3])) / 100;
    for (const a of targetAtoms(m, t)) commands.push({ type: "scale_atom_field", atomId: a.id, field: priceFieldFor(a.kind), factor });
    replies.push(`Muutin hintaa ${sign > 0 ? "+" : "−"}${pricePct[3]} %.`);
  } else if (priceAbs && !/kulu/.test(t)) {
    const value = num(priceAbs[3]);
    const wantsHourly = /tunti/.test(priceAbs[1]);
    const atoms = targetAtoms(m, t).filter((a) => !wantsHourly || a.kind === "TIME_CAPACITY");
    for (const a of atoms) commands.push({ type: "set_atom_field", atomId: a.id, field: priceFieldFor(a.kind), value });
    if (atoms.length > 0) replies.push(`Asetin hinnaksi ${value} €.`);
  }

  // Maksuaika: "maksuaika 14 päivää"
  const terms = /maksua\w*[^0-9]*(\d+)\s*(pv|päiv|vrk)?/.exec(t);
  if (terms && !/toimittaja/.test(t)) {
    commands.push({ type: "set_credit", field: "customerTermsDays", value: Math.min(365, num(terms[1])) });
    replies.push(`Asiakkaan maksuaika on nyt ${terms[1]} päivää.`);
  } else if (terms) {
    commands.push({ type: "set_credit", field: "supplierTermsDays", value: Math.min(365, num(terms[1])) });
    replies.push(`Toimittajan maksuaika on nyt ${terms[1]} päivää.`);
  }

  // Rekry: "palkkaa uusi työntekijä"
  if (/(palkkaa|rekrytoi|palkkaisin|otan)\b.*(työntekijä|henkilö|tekijä|konsultti|apulai|myyjä|kaveri)/.test(t)) {
    const time = m.atoms.find((a) => a.enabled && a.kind === "TIME_CAPACITY");
    if (time && time.kind === "TIME_CAPACITY") {
      commands.push({ type: "set_atom_field", atomId: time.id, field: "people", value: time.people + 1 });
      replies.push(`Lisäsin tekijän: ${time.label} – nyt ${time.people + 1} henkilöä. Katso toimituskyky-paneelista, maksaako rekry itsensä.`);
    } else {
      commands.push({ type: "add_fixed_cost", label: "Työntekijä (palkka + sivukulut)", amountPerMonth: Math.round(3000 * 1.21), dayOfMonth: 15, category: "other" });
      replies.push("Lisäsin työntekijän kiinteäksi kuluksi (3 000 € + 21 % sivukulut). Muokkaa summaa kulupaneelissa.");
    }
  }

  // Kiinteä kulu: "lisää kulu toimisto 600 €"
  const cost = /lisää\s+(?:kiinteä\s+)?(?:kulu|kuluihin|kuluksi)\s+(.+?)\s+(\d+[ ,.]?\d*)\s*(€|e\b|euro)/.exec(t);
  if (cost) {
    const label = cost[1].replace(/[:\-–]+$/, "").trim();
    const amount = num(cost[2]);
    commands.push({ type: "add_fixed_cost", label: label.charAt(0).toUpperCase() + label.slice(1), amountPerMonth: amount });
    replies.push(`Lisäsin kiinteän kulun "${label}" ${amount} € / kk.`);
  }

  // Uusi tulovirta.
  if (/lisää|aloita|haluan myydä|otan käyttöön/.test(t) && !cost) {
    let kind: AtomKind | null = null;
    let label: string | undefined;
    if (/kuukausi(tila|sopim|maks)|tilaus|jäsenyy|ylläpito|retainer|abonnement/.test(t)) {
      kind = "RECURRING_SUB";
      label = /ylläpito/.test(t) ? "Ylläpitosopimukset" : "Kuukausitilaukset";
    } else if (/tuote|tavara|verkkokaup|varasto/.test(t)) {
      kind = "PHYSICAL_MATTER";
      label = "Tuotemyynti";
    } else if (/tiski|kioski|myymälä|kahvila|tapahtuma/.test(t)) {
      kind = "TRANSACTIONAL_TRADE";
      label = "Tiskimyynti";
    } else if (/tunti|konsultoi|palvelu|koulutu|projekti/.test(t)) {
      kind = "TIME_CAPACITY";
      label = /koulutu/.test(t) ? "Koulutukset" : "Asiantuntijatyö";
    }
    if (kind) {
      const params: Record<string, number> = {};
      const monthly = /(\d+[,.]?\d*)\s*(€|e|euroa)\s*\/?\s*(kk|kuukau)/.exec(t);
      let assumption = "";
      if (kind === "RECURRING_SUB") {
        if (monthly) params.pricePerMonth = num(monthly[1]);
        // Isot kuukausisopimukset (ylläpito, retainer) myydään yksitellen, eivät kymmenittäin kuussa.
        if (/sopimu|ylläpito|retainer/.test(t) || (params.pricePerMonth ?? 0) >= 100) {
          label = /ylläpito/.test(t) ? "Ylläpitosopimukset" : "Kuukausisopimukset";
          params.newPerMonth = 1;
          params.startingSubscribers = 0;
          params.churnRateMonthly = 0.02;
          params.cacPerNew = 0;
          params.costPerSubscriberMonth = 0;
          assumption = " Oletin yhden uuden sopimuksen kuussa ja 2 % poistuman – säädä nämä vivuista.";
        }
      }
      commands.push({ type: "add_atom", kind, label, params });
      replies.push(`Lisäsin uuden tulovirran: ${label}. Sen vivut ilmestyivät oikealle – säädä luvut omiksesi.${assumption}`);
    }
  }

  if (commands.length === 0) {
    return {
      reply: `En ymmärtänyt pyyntöä ilman kielimallia. Voit kokeilla esimerkiksi: ${RULE_EXAMPLES.map((e) => `"${e}"`).join(", ")}. Kun kielimalli on kytketty (APEXin asetukset), ymmärrän vapaamuotoisempia pyyntöjä.`,
      commands: [],
      understood: false,
    };
  }
  return { reply: replies.join(" "), commands, understood: true };
}
