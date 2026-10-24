/**
 * APEX Studio — kielimallia käyttävät toiminnot palvelimella (`src/flow/server/ai.ts`).
 *
 * Kaikki kielimallin vastaukset validoidaan ennen kuin ne palautetaan selaimelle:
 * - liikeidea → malli: sallitut komennot (`validateCommand`)
 * - omat widgetit: widgetin kuvaus (`validateWidget`), ei ajettavaa koodia
 * - neuvonantajat: lausunnot + tarkistetut ehdotukset
 * - markkinatieto: ehdotukset vain olemassa oleviin kenttiin; lähteeksi kelpaa vain
 *   oikeasti haettu osoite, muuten arvo merkitään "kielimallin arvioksi".
 * Ilman kielimallia käytetään sääntöpohjaisia vaihtoehtoja.
 */
import type { Molecule } from "../kernel/types.ts";
import type { AsyncLLMHydration, EnterpriseGraph, GraphCommand } from "../graph/types.ts";
import { validateGraphCommand } from "../graph/commands.ts";
import { emptyMolecule } from "../kernel/presets.ts";
import { buildView } from "../model/view.ts";
import { applyCommands, validateCommand, type FlowCommand } from "../model/commands.ts";
import { emptyChecklist, checklistView } from "../model/launchpad.ts";
import { ideaToMolecule } from "../model/genesis.ts";
import { validateWidget, vocabulary, type WidgetSpec } from "../model/widgets.ts";
import { coachInsights } from "../model/coach.ts";
import { ruleAdvisors, type AdvisorRole } from "../model/advisors.ts";
import { atomSlugs } from "../model/widgets.ts";
import { isEditableField } from "../model/edit.ts";
import { personaDef, type PersonaId } from "../model/personas.ts";
import { isLocale, t, withLocale, type Locale } from "../i18n/index.ts";
import { callLlmJson, getMaskedLlmConfig, isLlmConfigured } from "../../core/llm/client.ts";
import { fetchLiveWebSignals, type WebSearchSignal } from "../../core/llm/market-research.ts";

const LANG_NAME: Record<Locale, string> = { fi: "suomeksi", en: "in English" };

export function isMolecule(x: unknown): x is Molecule {
  const m = x as Molecule;
  return !!m && Array.isArray(m.atoms) && m.atoms.length <= 20 && typeof m.credit === "object" && Array.isArray(m.fixedCosts) && m.fixedCosts.length <= 100;
}

export function localeOf(body: unknown): Locale {
  const l = (body as { locale?: unknown })?.locale;
  return isLocale(l) ? l : "fi";
}

export function llmStatus() {
  const cfg = getMaskedLlmConfig();
  return { llm: isLlmConfigured(), provider: cfg.provider, model: cfg.model };
}

const COMMANDS_DOC = `Sallitut komennot (JSON):
- {"type":"set_name","name":"Yrityksen nimi"}
- {"type":"add_atom","kind":"TIME_CAPACITY"|"PHYSICAL_MATTER"|"RECURRING_SUB"|"TRANSACTIONAL_TRADE","label":"nimi","params":{"kenttä":luku}}
- {"type":"add_fixed_cost","label":"nimi","amountPerMonth":luku,"dayOfMonth":1-30,"category":"rent"|"admin"|"insurance"|"pension"|"software"|"marketing"|"other"}
- {"type":"set_credit","field":"customerTermsDays"|"supplierTermsDays"|"openingCash","value":luku}
- {"type":"set_seasonality","factors":[12 kerrointa tammikuusta joulukuuhun, 1 = tavallinen]}
- {"type":"set_start_month","month":0-11}
Atomien kentät:
TIME_CAPACITY: people, hoursPerWeek, utilization (0..1), hourlyRate, demandHoursPerMonth (null = kysyntää riittää), salaryPerPersonMonth, sideCostRate (0..1), variableCostPerHour, paymentTermsDays
PHYSICAL_MATTER: unitsPerMonth, unitPrice, unitCost, spoilageRate (0..0.95), stockCoverDays, capacityUnitsPerMonth (null = ei rajaa), paymentTermsDays
RECURRING_SUB: startingSubscribers, newPerMonth, churnRateMonthly (0..1), pricePerMonth, costPerSubscriberMonth, cacPerNew, paymentTermsDays
TRANSACTIONAL_TRADE: visitorsPerDay, conversionRate (0..1), averageTicket, costPerSale, openDaysPerMonth, capacityPerDay (null = ei rajaa), paymentTermsDays`;

// ---------------------------------------------------------------------------
// Liikeidea omin sanoin → malli
// ---------------------------------------------------------------------------

export interface GenesisResponse {
  molecule: Molecule;
  source: "llm" | "rules";
  notes: string[];
}

export async function handleGenesis(body: unknown): Promise<GenesisResponse> {
  const locale = localeOf(body);
  const idea = String((body as { idea?: unknown })?.idea ?? "").trim().slice(0, 2000);
  const fallback = (note?: string): GenesisResponse =>
    withLocale(locale, () => {
      const r = ideaToMolecule(idea || t("Oma yritys"));
      return { molecule: r.molecule, source: "rules", notes: note ? [note, ...r.notes] : r.notes };
    });
  if (!idea) return fallback();
  if (!isLlmConfigured()) return fallback();
  const res = await callLlmJson<{ commands?: unknown; notes?: unknown }>({
    systemInstruction: `Olet APEX Studio -liiketoimintamallintaja. Muunna käyttäjän liikeidea toimialasta riippumattomaksi malliksi.
Malli koostuu tulovirroista (atomeista) ja kiinteistä kuluista. Valitse vain ne tulovirrat, jotka idealla oikeasti on (voi olla useita).
Käytä realistisia, varovaisia suomalaisia oletuksia (summat ilman arvonlisäveroa). Lisää aina yrittäjän oma palkka (aika-atomin salaryPerPersonMonth tai kiinteä kulu "Oma palkka") sekä kirjanpito.
Jos idea on kausiluonteinen, aseta set_seasonality. Jos tekstissä on luvuja (hinta, alkupääoma, maksuaika), käytä niitä.
Kirjoita nimet ja huomiot ${LANG_NAME[locale]}.
${COMMANDS_DOC}
Palauta pelkkä JSON: {"commands":[...], "notes":["lyhyt huomio oletuksista", ...]}`,
    userPrompt: idea,
    temperature: 0.2,
    timeoutMs: 30000,
    taskLabelFi: "APEX Studio: liikeidea → malli",
  });
  const raw = res.data && Array.isArray(res.data.commands) ? res.data.commands : null;
  if (!raw) return fallback(withLocale(locale, () => t("Kielimalli ei vastannut ({error}), käytin sääntöpohjaista tulkkia.", { error: res.meta.error ?? "?" })));
  return withLocale(locale, () => {
    const base = emptyMolecule(t("Oma yritys"));
    const r = applyCommands(base, emptyChecklist(), raw, { source: "genesis" });
    if (r.molecule.atoms.length === 0) return fallback(t("Kielimallin ehdotuksesta ei syntynyt tulovirtoja, käytin sääntöpohjaista tulkkia."));
    const notes = Array.isArray(res.data?.notes) ? res.data!.notes.filter((n): n is string => typeof n === "string").map((n) => n.slice(0, 300)).slice(0, 6) : [];
    if (r.rejected > 0) notes.push(t("{n} ehdotettua muutosta hylättiin, koska ne eivät olleet kelvollisia.", { n: r.rejected }));
    return { molecule: r.molecule, source: "llm" as const, notes };
  });
}

// ---------------------------------------------------------------------------
// Prompt-to-widget
// ---------------------------------------------------------------------------

export interface WidgetResponse {
  widgets: WidgetSpec[];
  error: string | null;
  source: "llm" | "none";
}

/** Kielimallit palauttavat joskus {widget}, {widgets:[…]}, taulukon tai yksittäisen kuvauksen. */
function widgetCandidates(data: unknown): unknown[] {
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== "object") return [];
  const d = data as Record<string, unknown>;
  if (Array.isArray(d.widgets)) return d.widgets;
  if (d.widget && typeof d.widget === "object") return [d.widget];
  if (typeof d.kind === "string") return [d];
  return [];
}

export async function handleWidget(body: unknown): Promise<WidgetResponse> {
  const locale = localeOf(body);
  const b = body as { prompt?: unknown; molecule?: unknown };
  const prompt = String(b?.prompt ?? "").trim().slice(0, 1000);
  if (!prompt || !isMolecule(b.molecule)) return { widgets: [], error: withLocale(locale, () => t("Pyyntö puuttuu.")), source: "none" };
  if (!isLlmConfigured()) return { widgets: [], error: withLocale(locale, () => t("Omien widgettien luonti vaatii kielimallin (oma API-avain asetuksissa). Valmiit pohjat toimivat ilman.")), source: "none" };
  const m = b.molecule;
  const vocab = withLocale(locale, () => vocabulary(m).map((x) => `${x.name}: ${x.description}`).join("\n"));
  const ask = async (extra: string) =>
    callLlmJson<unknown>({
      systemInstruction: `Olet APEX Studion widgettisuunnittelija. Käyttäjä pyytää uutta näkymää yrityksensä malliin.
Palauta 1–3 widgetin kuvausta JSONina. Et kirjoita ohjelmakoodia: kaavat käyttävät vain alla olevia muuttujia, lukuja, + - * / ^ ( ), vertailuja (< > <= >= == !=), and/or/not ja funktioita min, max, abs, round(x, desimaalit), floor, ceil, clamp(x, a, b), if(ehto, a, b).
Widgettityypit:
- {"kind":"metric","title":"...","formula":"...","format":"eur"|"pct"|"num"|"int"|"days"|"months","description":"..."}
- {"kind":"alert","title":"...","condition":"kaava joka on tosi kun pitää varoittaa","message":"...","severity":"info"|"warn"|"alert"}
- {"kind":"lever","title":"...","target":"muokattava muuttuja, esim. time.hourlyRate tai credit.customerTermsDays","min":luku,"max":luku,"step":luku,"format":"eur"}
- {"kind":"chart","title":"...","series":[{"label":"...","formula":"kaava joka voi käyttää kuukausimuuttujia"}],"style":"line"|"bar","format":"eur"}
- {"kind":"table","title":"...","rows":[{"label":"...","formula":"...","format":"eur"}]}
pct-muotoiltu arvo on osuus (0.25 = 25 %).
Kuukausimuuttujat (vain chart): month, month.revenue, month.costs, month.profit, month.cash, month.receivables, month.season
Mallin muuttujat:
${vocab}
Jos pyyntöä ei voi toteuttaa näillä muuttujilla, palauta {"error":"lyhyt selitys ${LANG_NAME[locale]}"}.
Kirjoita otsikot ja tekstit ${LANG_NAME[locale]}.
Palauta pelkkä JSON muodossa {"widgets":[ ... ]}.${extra}`,
      userPrompt: prompt,
      temperature: 0.2,
      timeoutMs: 25000,
      taskLabelFi: "APEX Studio: oma widgetti",
    });
  const view = buildView(m);
  let res = await ask("");
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (!res.data) return { widgets: [], error: withLocale(locale, () => t("Kielimalli ei vastannut ({error}).", { error: res.meta.error ?? "?" })), source: "llm" };
    const err = (res.data as { error?: unknown }).error;
    if (typeof err === "string") return { widgets: [], error: err.slice(0, 300), source: "llm" };
    const results = withLocale(locale, () => widgetCandidates(res.data).slice(0, 3).map((c) => validateWidget(c, m, view, "ai", prompt)));
    const ok = results.flatMap((r) => (r.spec ? [r.spec] : []));
    const errors = results.flatMap((r) => (r.error ? [r.error] : []));
    if (ok.length > 0 && (errors.length === 0 || attempt === 1)) return { widgets: ok, error: errors[0] ?? null, source: "llm" };
    if (attempt === 1) return { widgets: [], error: errors[0] ?? withLocale(locale, () => t("Widgetin kuvaus puuttuu")), source: "llm" };
    res = await ask(`\nEdellinen vastauksesi hylättiin: ${errors.join("; ") || "väärä muoto"}. Korjaa se.`);
  }
  return { widgets: [], error: "?", source: "llm" };
}

// ---------------------------------------------------------------------------
// Neuvonantajat
// ---------------------------------------------------------------------------

export interface AdvisorsResponse {
  statements: { role: AdvisorRole; text: string }[];
  consensus: string;
  proposals: { label: string; commands: FlowCommand[] }[];
  source: "llm" | "rules";
  note?: string;
}

export async function handleAdvisors(body: unknown): Promise<AdvisorsResponse> {
  const locale = localeOf(body);
  const b = body as { molecule?: unknown; question?: unknown; persona?: unknown };
  if (!isMolecule(b.molecule)) return { statements: [], consensus: "", proposals: [], source: "rules" };
  const m = b.molecule;
  const question = String(b.question ?? "").trim().slice(0, 600);
  const persona = personaDef(b.persona as PersonaId);
  const ruleBased = (note?: string): AdvisorsResponse =>
    withLocale(locale, () => {
      const v = buildView(m);
      const ins = coachInsights(m, v, checklistView(m, v, emptyChecklist()), persona.id);
      const adv = ruleAdvisors(m, v, ins);
      return {
        statements: adv.map((a) => ({ role: a.role, text: [a.summary, ...a.points.slice(0, 2)].filter(Boolean).join(" ") })),
        consensus: ins[0] ? t("Tärkein asia nyt: {title}", { title: ins[0].title }) : t("Malli on tasapainossa."),
        proposals: ins.flatMap((i) => i.actions).filter((a) => a.commands.every((c) => c.type !== "open_panel")).slice(0, 4),
        source: "rules",
        note,
      };
    });
  if (!isLlmConfigured()) return ruleBased();
  const telemetry = withLocale(locale, () => {
    const v = buildView(m);
    return JSON.stringify({
      nimi: m.name,
      tulovirrat: m.atoms.filter((a) => a.enabled),
      kulut: m.fixedCosts.map((c) => ({ nimi: c.label, euroaKk: Math.round(c.amountPerMonth) })),
      kassa: m.credit,
      tapahtumat: m.events ?? [],
      kausikertoimet: m.seasonality ?? null,
      tulokset: {
        myyntiKk: Math.round(v.monthlyRevenue),
        kulutKk: Math.round(v.monthlyFixed + v.monthlyVariable),
        tulos1: Math.round(v.firstMonthProfit),
        tulos12: Math.round(v.lastMonthProfit),
        kassaLoppuuPaivana: v.sim.cashOutDay === null ? null : v.sim.cashOutDay + 1,
        kassanPohja: Math.round(v.sim.minCash),
        pelivara: v.be.marginOfSafety,
      },
    });
  });
  const res = await callLlmJson<{ statements?: unknown; consensus?: unknown; proposals?: unknown }>({
    systemInstruction: `Olet APEX Studion neuvonantajaryhmä: talousjohtaja (cfo), myyntijohtaja (sales), operatiivinen johtaja (ops) ja henkilöstö- ja jaksamisasiantuntija (people).
Jokainen antaa lyhyen (1–3 virkettä), luvuilla perustellun näkemyksen OMASTA näkökulmastaan. Saatte olla eri mieltä. Älä keksi markkinadataa.
Lopuksi yhteinen johtopäätös ja enintään 3 konkreettista ehdotusta, joista jokaisessa on komennot.
${COMMANDS_DOC}
Lisäksi: {"type":"set_atom_field","atomId":"id","field":"kenttä","value":luku}, {"type":"scale_atom_field","atomId":"id","field":"kenttä","factor":1.1}
Kirjoita ${LANG_NAME[locale]}. Käyttäjä: ${persona.id}.
Palauta pelkkä JSON: {"statements":[{"role":"cfo","text":"..."},...],"consensus":"...","proposals":[{"label":"...","commands":[...]}]}`,
    userPrompt: `MALLI:\n${telemetry}\n\nKYSYMYS: ${question || "Mitä meidän pitäisi tehdä seuraavaksi?"}`,
    temperature: 0.4,
    timeoutMs: 30000,
    taskLabelFi: "APEX Studio: neuvonantajat",
  });
  const d = res.data;
  if (!d || !Array.isArray(d.statements)) return ruleBased(withLocale(locale, () => t("Kielimalli ei vastannut ({error}), näytän sääntöpohjaiset näkemykset.", { error: res.meta.error ?? "?" })));
  const roles: AdvisorRole[] = ["cfo", "sales", "ops", "people"];
  const statements = d.statements
    .filter((s): s is { role: AdvisorRole; text: string } => !!s && roles.includes((s as { role: AdvisorRole }).role) && typeof (s as { text: unknown }).text === "string")
    .map((s) => ({ role: s.role, text: s.text.slice(0, 600) }))
    .slice(0, 8);
  const proposals = (Array.isArray(d.proposals) ? d.proposals : [])
    .slice(0, 3)
    .map((p) => {
      const label = typeof (p as { label?: unknown })?.label === "string" ? String((p as { label: string }).label).slice(0, 80) : "";
      const cmds = Array.isArray((p as { commands?: unknown })?.commands) ? ((p as { commands: unknown[] }).commands) : [];
      return { label, commands: cmds.map((c) => validateCommand(c, m)).filter((c): c is FlowCommand => c !== null) };
    })
    .filter((p) => p.label && p.commands.length > 0);
  return { statements, consensus: typeof d.consensus === "string" ? d.consensus.slice(0, 600) : "", proposals, source: "llm" };
}

// ---------------------------------------------------------------------------
// Markkinatieto lähteineen
// ---------------------------------------------------------------------------

export interface MarketSuggestion {
  atomId: string;
  field: string;
  value: number;
  current: number | null;
  rationale: string;
  source: { title: string; url: string } | null;
}

export interface MarketResponse {
  signals: WebSearchSignal[];
  suggestions: MarketSuggestion[];
  summary: string;
  source: "llm" | "none";
  error?: string;
}

export async function handleMarket(body: unknown): Promise<MarketResponse> {
  const locale = localeOf(body);
  const b = body as { molecule?: unknown; query?: unknown };
  if (!isMolecule(b.molecule)) return { signals: [], suggestions: [], summary: "", source: "none", error: "?" };
  const m = b.molecule;
  const query = String(b.query ?? m.name).trim().slice(0, 120);
  const signals = await fetchLiveWebSignals(query).catch(() => [] as WebSearchSignal[]);
  if (!isLlmConfigured()) {
    return {
      signals,
      suggestions: [],
      summary: "",
      source: "none",
      error: withLocale(locale, () =>
        signals.length ? t("Löysin lähteitä, mutta lukujen ehdottaminen vaatii kielimallin (oma API-avain asetuksissa).") : t("Markkinatieto vaatii kielimallin ja verkkoyhteyden."),
      ),
    };
  }
  const slugs = [...atomSlugs(m).entries()].map(([slug, a]) => ({ slug, id: a.id, kind: a.kind, label: a.label, values: a }));
  const res = await callLlmJson<{ suggestions?: unknown; summary?: unknown }>({
    systemInstruction: `Olet APEX Studion markkina-analyytikko. Arvioi, ovatko yrityksen oletukset (hinnat, kulut, määrät) realistisia Suomessa.
Ehdota korjauksia VAIN jos sinulla on perusteltu syy. Jos käytät alla olevaa hakutulosta, viittaa sen täsmälliseen url-osoitteeseen. Älä keksi lähteitä: jos arvio on yleistietoa, jätä "sourceUrl" tyhjäksi.
Atomit ja kentät: ${JSON.stringify(slugs.map((s) => ({ atomId: s.id, kind: s.kind, label: s.label, values: s.values })))}
Hakutulokset: ${JSON.stringify(signals)}
Kirjoita ${LANG_NAME[locale]}.
Palauta pelkkä JSON: {"summary":"2–3 virkettä","suggestions":[{"atomId":"...","field":"...","value":luku,"rationale":"miksi","sourceUrl":"url tai tyhjä"}]}`,
    userPrompt: `Yritys: ${m.name}. Haku: ${query}`,
    temperature: 0.2,
    timeoutMs: 30000,
    taskLabelFi: "APEX Studio: markkinatieto",
  });
  const d = res.data;
  if (!d) return { signals, suggestions: [], summary: "", source: "llm", error: withLocale(locale, () => t("Kielimalli ei vastannut ({error}).", { error: res.meta.error ?? "?" })) };
  const urls = new Map(signals.map((s) => [s.url, s.title]));
  const suggestions: MarketSuggestion[] = (Array.isArray(d.suggestions) ? d.suggestions : [])
    .slice(0, 8)
    .map((raw) => {
      const r = raw as { atomId?: unknown; field?: unknown; value?: unknown; rationale?: unknown; sourceUrl?: unknown };
      const atom = m.atoms.find((a) => a.id === r.atomId);
      if (!atom || typeof r.field !== "string" || !isEditableField(atom.kind, r.field) || typeof r.value !== "number" || !Number.isFinite(r.value) || r.value < 0) return null;
      const cur = (atom as unknown as Record<string, unknown>)[r.field];
      const url = typeof r.sourceUrl === "string" && urls.has(r.sourceUrl) ? r.sourceUrl : null;
      return {
        atomId: atom.id,
        field: r.field,
        value: r.value,
        current: typeof cur === "number" ? cur : null,
        rationale: typeof r.rationale === "string" ? r.rationale.slice(0, 400) : "",
        source: url ? { title: urls.get(url)!, url } : null,
      };
    })
    .filter((x): x is MarketSuggestion => x !== null);
  return { signals, suggestions, summary: typeof d.summary === "string" ? d.summary.slice(0, 600) : "", source: "llm" };
}

// ---------------------------------------------------------------------------
// Nopeus 3: Asynkroninen Ghost-solmun ja luonnoksen LLM-hydraatio (Invariantti A4)
// ---------------------------------------------------------------------------

export function isEnterpriseGraph(x: unknown): x is EnterpriseGraph {
  const g = x as EnterpriseGraph;
  return !!g && typeof g === "object" && typeof g.nodes === "object" && typeof g.streams === "object" && typeof g.factors === "object";
}

export async function handleGraphHydration(
  body: unknown,
): Promise<AsyncLLMHydration & { failed?: boolean; error?: string; rationale?: string }> {
  const locale = localeOf(body);
  const b = body as { patchId?: unknown; request?: unknown; graph?: unknown };
  const patchId = typeof b?.patchId === "string" && b.patchId.trim() ? b.patchId.trim() : "opt-unknown";
  const request = typeof b?.request === "string" ? b.request.trim().slice(0, 1000) : "";

  if (!isEnterpriseGraph(b?.graph)) {
    return {
      patchId,
      streamed: [],
      failed: true,
      error: withLocale(locale, () => t("Graafimalli puuttuu hydraatiopyynnöstä.")),
    };
  }
  const graph = b.graph;
  const ghostNode = Object.values(graph.nodes).find((n) => n.ghost?.patchId === patchId);
  const draftNodeUri = ghostNode?.uri;

  const fallbackHydration = (note?: string) => ({
    patchId,
    streamed: [] as GraphCommand[],
    rationale:
      note ??
      withLocale(locale, () => t("Sääntöpohjainen hydraatio vahvisti optimistisen luonnossolmun määritellyksi prosessisolmuksi.")),
  });

  if (!isLlmConfigured()) {
    return fallbackHydration();
  }

  const res = await callLlmJson<{ commands?: unknown; rationale?: unknown }>({
    systemInstruction: `Olet APEX Studio -yritysgraafin arkkitehti. Vahvista optimistinen Ghost-luonnossolmu (${draftNodeUri ?? patchId}) määritellyksi prosessisolmuksi.
Palauta vain kelvollisia GraphCommand-komentoja JSON-muodossa:
- {"type":"set_factor","uri":"apex://factor/...","value":luku}
- {"type":"attach_capability","node":"apex://node/...","binding":{"capability":"apex://system/...","critical":false}}
Kirjoita perustelu ${LANG_NAME[locale]}.
Palauta pelkkä JSON: {"commands":[...],"rationale":"..."}`,
    userPrompt: `Pyyntö: ${request}\nSolmu: ${draftNodeUri ?? patchId}\nFaktorit: ${JSON.stringify(
      Object.values(graph.factors).map((f) => ({ uri: f.uri, name: f.name, value: f.value })),
    )}`,
    temperature: 0.2,
    timeoutMs: 20000,
    taskLabelFi: "APEX Studio: Ghost-solmun hydraatio",
  });

  if (!res.data || !Array.isArray(res.data.commands)) {
    return fallbackHydration(
      withLocale(locale, () => t("Kielimalli ei vastannut ({error}), vahvistin luonnoksen sääntöpohjaisesti.", { error: res.meta.error ?? "?" })),
    );
  }

  const validCommands = res.data.commands
    .map((c) => validateGraphCommand(c, graph))
    .filter((c): c is GraphCommand => c !== null);

  return {
    patchId,
    streamed: validCommands,
    rationale: typeof res.data.rationale === "string" ? res.data.rationale.slice(0, 400) : undefined,
  };
}
