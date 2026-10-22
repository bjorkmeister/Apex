/**
 * APEX Flow — keskusteleva valmentaja palvelimella (`src/flow/server/chat.ts`).
 *
 * Jos kielimalli on kytketty (APEXin BYOK-asetukset), viesti ja mallin telemetria
 * lähetetään sille, ja vastauksen komennot validoidaan ennen palautusta. Muuten tai
 * virhetilanteessa käytetään sääntöpohjaista komentotulkkia.
 */
import type { Molecule } from "../kernel/types.ts";
import { ATOM_KIND_LABELS } from "../kernel/presets.ts";
import { buildView } from "../model/view.ts";
import { validateCommand, type FlowCommand } from "../model/commands.ts";
import { parseIntent } from "../model/intent.ts";
import { checklistView, emptyChecklist, type ChecklistState } from "../model/launchpad.ts";
import { personaDef, type PersonaId } from "../model/personas.ts";
import { callLlmJson, isLlmConfigured } from "../../core/llm/client.ts";
import { t, withLocale, type Locale } from "../i18n/index.ts";
import { localeOf } from "./ai.ts";

export interface ChatRequest {
  locale?: Locale;
  message: string;
  molecule: Molecule;
  checklist?: ChecklistState;
  persona?: PersonaId;
  history?: { role: "user" | "coach"; text: string }[];
}

export interface ChatResponse {
  reply: string;
  commands: FlowCommand[];
  source: "llm" | "rules";
  note?: string;
}

const EDITABLE_FIELDS_DOC = `
TIME_CAPACITY: people, hoursPerWeek, utilization (0..1), hourlyRate, demandHoursPerMonth (null = kysyntää riittää), salaryPerPersonMonth, sideCostRate (0..1), variableCostPerHour, paymentTermsDays
PHYSICAL_MATTER: unitsPerMonth, unitPrice, unitCost, spoilageRate (0..0.95), stockCoverDays, capacityUnitsPerMonth (null = ei rajaa), paymentTermsDays
RECURRING_SUB: startingSubscribers, newPerMonth, churnRateMonthly (0..1), pricePerMonth, costPerSubscriberMonth, cacPerNew, paymentTermsDays
TRANSACTIONAL_TRADE: visitorsPerDay, conversionRate (0..1), averageTicket, costPerSale, openDaysPerMonth, capacityPerDay (null = ei rajaa), paymentTermsDays`;

const SYSTEM = `Olet APEX Flow -yritysvalmentaja. Puhut selkeää, lämmintä ja maanläheistä suomea ilman jargonia.
Käyttäjä mallintaa yritystään. Saat mallin tilan (telemetria) ja käyttäjän viestin.

Tehtäväsi:
1. Vastaa lyhyesti (enintään 5 virkettä) ja perustele luvuilla telemetriasta.
2. Jos käyttäjä pyytää muutosta malliin (uusi tulovirta, hinta, kulu, maksuaika, rekry...), palauta komennot.
3. ÄLÄ keksi markkinadataa tai hintajoustoja. Jos käyttäjä kysyy, miten asiakkaat reagoivat, kerro kipuraja: kuinka paljon määrää saa menettää.
4. Summat ovat ilman arvonlisäveroa. Kuukausi = 30 päivää.

Palauta AINA pelkkä JSON: {"reply": "teksti", "commands": [ ... ]}
Sallitut komennot:
- {"type":"set_atom_field","atomId":"<id telemetriasta>","field":"<kenttä>","value":<luku tai null>}
- {"type":"scale_atom_field","atomId":"<id>","field":"<kenttä>","factor":<kerroin, esim. 1.1>}
- {"type":"set_credit","field":"customerTermsDays"|"supplierTermsDays"|"openingCash","value":<luku>}
- {"type":"add_atom","kind":"TIME_CAPACITY"|"PHYSICAL_MATTER"|"RECURRING_SUB"|"TRANSACTIONAL_TRADE","label":"nimi","params":{"kenttä":luku}}
- {"type":"remove_atom","atomId":"<id>"}
- {"type":"add_fixed_cost","label":"nimi","amountPerMonth":<luku>,"dayOfMonth":<1-30>}
- {"type":"remove_fixed_cost","id":"<kulun id>"}
- {"type":"checklist","id":"company-form"|"yel"|"accounting"|"insurance"|"vat"|"bank"|"terms","checked":true|false}
- {"type":"open_panel","panel":"demand"|"capacity"|"receivables"|"cash"|"costs"|"launchpad"}
- {"type":"stress","stress":{"volumeChange":-0.2,"priceChange":0,"variableCostChange":0,"fixedCostChange":0}}
- {"type":"add_event","event":{"title":"nimi","startMonth":0-11,"durationMonths":1-12,"volumeChange":-0.3,"priceChange":0,"variableCostChange":0,"fixedCostChange":0,"oneOffCost":0}}
- {"type":"remove_event","id":"<tapahtuman id>"}
- {"type":"set_seasonality","factors":[12 kerrointa tammi–joulu, 1 = tavallinen]}
- {"type":"set_founder","weeklyHours":luku,"livingCostsPerMonth":luku}
- {"type":"open_panel","panel":"scenarios"|"widgets"|"advisors"|"market"|"seasons"|"founder"|"goals"|"report"|"actuals"|"tasks"}
Muokattavat kentät atomityypeittäin:${EDITABLE_FIELDS_DOC}
Esimerkki: "Lisää Wolt-kotiinkuljetus 30 % komissiolla" ruokakioskille → add_atom TRANSACTIONAL_TRADE, label "Wolt-kotiinkuljetus", params joissa costPerSale = raaka-aineet + 0.30 × averageTicket.
Jos pyyntö ei vaadi muutosta, palauta "commands": [].
Jos käyttäjä haluaa uuden näkymän, mittarin tai kuvaajan, ohjaa hänet Widgetit-paneeliin (open_panel "widgets").`;

function telemetry(req: ChatRequest): string {
  const m = req.molecule;
  const v = buildView(m);
  const cl = checklistView(m, v, req.checklist ?? emptyChecklist());
  const persona = personaDef(req.persona);
  return JSON.stringify({
    yritys: m.name,
    kayttaja: persona.title,
    tulovirrat: m.atoms.filter((a) => a.enabled).map((a) => ({ ...a, tyyppi: ATOM_KIND_LABELS[a.kind].title })),
    kiinteatKulut: m.fixedCosts.map((c) => ({ id: c.id, nimi: c.label, euroaKk: Math.round(c.amountPerMonth), paiva: c.dayOfMonth })),
    kassa: m.credit,
    palkkapaiva: m.payrollDay,
    tulokset: {
      myyntiKk: Math.round(v.monthlyRevenue),
      muuttuvatKulutKk: Math.round(v.monthlyVariable),
      kiinteatKulutKk: Math.round(v.monthlyFixed),
      tulosEnsimmainenKk: Math.round(v.firstMonthProfit),
      tulos12Kk: Math.round(v.lastMonthProfit),
      kassaLoppuuPaivana: v.sim.cashOutDay === null ? null : v.sim.cashOutDay + 1,
      kassanPohja: Math.round(v.sim.minCash),
      kassaVuodenLopussa: Math.round(v.sim.endCash),
      kannattavuusrajaKk: v.be.breakEvenRevenuePerMonth === null ? null : Math.round(v.be.breakEvenRevenuePerMonth),
      pelivara: v.be.marginOfSafety,
      pullonkaula: v.bottleneck ? { tulovirta: v.bottleneck.label, kysyntaPerKapasiteetti: v.bottleneck.bottleneckRatio, kysyntaOletus: v.bottleneck.demandAssumed } : null,
    },
    perustamislista: { valmiina: cl.done, yhteensa: cl.total, seuraava: cl.next?.def.title ?? null },
  });
}

function isMolecule(x: unknown): x is Molecule {
  const m = x as Molecule;
  return !!m && Array.isArray(m.atoms) && m.atoms.length <= 20 && typeof m.credit === "object" && Array.isArray(m.fixedCosts) && m.fixedCosts.length <= 100;
}

export async function handleChat(raw: unknown): Promise<ChatResponse> {
  const req = raw as ChatRequest;
  const locale = localeOf(raw);
  if (!req || typeof req.message !== "string" || !req.message.trim() || req.message.length > 2000 || !isMolecule(req.molecule)) {
    return { reply: withLocale(locale, () => t("Viestiä ei voitu käsitellä.")), commands: [], source: "rules" };
  }
  const message = req.message.trim();
  if (isLlmConfigured()) {
    const history = (req.history ?? [])
      .slice(-10)
      .filter((h) => h && typeof h.text === "string")
      .map((h) => `${h.role === "user" ? "Käyttäjä" : "Valmentaja"}: ${h.text.slice(0, 600)}`)
      .join("\n");
    const res = await callLlmJson<{ reply?: unknown; commands?: unknown }>({
      systemInstruction: `${SYSTEM}\nVastaa käyttäjän kielellä (${locale === "en" ? "English" : "suomi"}).`,
      userPrompt: `TELEMETRIA:\n${withLocale(locale, () => telemetry(req))}\n\nAIEMPI KESKUSTELU:\n${history || "(ei aiempaa)"}\n\nKÄYTTÄJÄN VIESTI:\n${message}`,
      temperature: 0.3,
      timeoutMs: 25000,
      taskLabelFi: "APEX Flow -valmentaja",
    });
    if (res.data && typeof res.data.reply === "string") {
      const rawCmds = Array.isArray(res.data.commands) ? res.data.commands : [];
      const commands = rawCmds.map((c) => validateCommand(c, req.molecule)).filter((c): c is FlowCommand => c !== null);
      const dropped = rawCmds.length - commands.length;
      return {
        reply: res.data.reply.slice(0, 2000),
        commands,
        source: "llm",
        note: dropped > 0 ? withLocale(locale, () => t("{n} ehdotettua muutosta hylättiin, koska ne eivät olleet kelvollisia.", { n: dropped })) : undefined,
      };
    }
    const fallback = withLocale(locale, () => parseIntent(message, req.molecule));
    return { ...fallback, source: "rules", note: withLocale(locale, () => t("Kielimalli ei vastannut ({error}), käytin sääntöpohjaista tulkkia.", { error: res.meta.error ?? "?" })) };
  }
  const r = withLocale(locale, () => parseIntent(message, req.molecule));
  return { reply: r.reply, commands: r.commands, source: "rules" };
}
