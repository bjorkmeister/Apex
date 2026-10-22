import type { WorldState, MarketIntelligenceReport, StrategicPlayCard } from "../schema/state";
import { ASSUMPTION_KEYS, type AssumptionKey, applyAssumptionUpdate, buildAssumptionDependencyGraph } from "../compiler/assumptions";
import { getActiveLlmConfig, isLlmConfigured, cleanJsonText, callLlmJson, getMaskedLlmConfig } from "./client";
import { postJournal } from "../engine/ledger";
import { pushNotification } from "../engine/modifiers";

export interface WebSearchSignal {
  title: string;
  url: string;
  snippet: string;
}

/**
 * Fetches live web signals from public knowledge & search APIs (Wikipedia FI/EN)
 * with a strict timeout so it never blocks gameplay if offline.
 */
export async function fetchLiveWebSignals(query: string): Promise<WebSearchSignal[]> {
  const cleanQuery = query.trim().slice(0, 120);
  if (!cleanQuery) return [];

  const signals: WebSearchSignal[] = [];
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2800);

  try {
    const wikiFiUrl = `https://fi.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(cleanQuery)}&utf8=&format=json&srlimit=3`;
    const wikiEnUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(cleanQuery)}&utf8=&format=json&srlimit=2`;

    const [fiRes, enRes] = await Promise.allSettled([
      fetch(wikiFiUrl, { signal: controller.signal, headers: { "User-Agent": "ApexBusinessSimulator/1.0" } }),
      fetch(wikiEnUrl, { signal: controller.signal, headers: { "User-Agent": "ApexBusinessSimulator/1.0" } }),
    ]);

    if (fiRes.status === "fulfilled" && fiRes.value.ok) {
      const data = (await fiRes.value.json()) as any;
      const items = data?.query?.search ?? [];
      for (const item of items) {
        const snippet = String(item.snippet ?? "").replace(/<[^>]+>/g, "").trim();
        if (item.title && snippet) {
          signals.push({
            title: `${item.title} (Wikipedia FI)`,
            url: `https://fi.wikipedia.org/wiki/${encodeURIComponent(String(item.title).replace(/ /g, "_"))}`,
            snippet,
          });
        }
      }
    }

    if (enRes.status === "fulfilled" && enRes.value.ok) {
      const data = (await enRes.value.json()) as any;
      const items = data?.query?.search ?? [];
      for (const item of items) {
        const snippet = String(item.snippet ?? "").replace(/<[^>]+>/g, "").trim();
        if (item.title && snippet) {
          signals.push({
            title: `${item.title} (Wikipedia EN)`,
            url: `https://en.wikipedia.org/wiki/${encodeURIComponent(String(item.title).replace(/ /g, "_"))}`,
            snippet,
          });
        }
      }
    }
  } catch {
    // Offline or blocked; gracefully fall back
  } finally {
    clearTimeout(timeout);
  }

  return signals.slice(0, 4);
}

/**
 * Calls Gemini with native Google Search Grounding (`tools: [{ google_search: {} }]`) if Gemini is active,
 * falling back to standard `callLlmJson` if grounding tool is not supported on the model or another provider is active.
 */
async function callLlmWithOptionalGoogleSearch<T>(
  systemPrompt: string,
  userPrompt: string,
): Promise<{ data: T | null; groundedSources: WebSearchSignal[] }> {
  const cfg = getActiveLlmConfig();
  if (!isLlmConfigured(cfg)) return { data: null, groundedSources: [] };

  if (cfg.provider === "gemini" && cfg.apiKey) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 22000);
    const activeModel =
      cfg.model === "gemini-3.8-flash" ? "gemini-2.5-flash" : (cfg.model || "gemini-2.5-flash");
    const isVertexExpressKey = cfg.apiKey.startsWith("AQ.");
    try {
      const url = isVertexExpressKey
        ? `https://aiplatform.googleapis.com/v1/publishers/google/models/${encodeURIComponent(activeModel)}:generateContent?key=${encodeURIComponent(cfg.apiKey)}`
        : `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(activeModel)}:generateContent?key=${encodeURIComponent(cfg.apiKey)}`;
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemPrompt }] },
          contents: [{ role: "user", parts: [{ text: userPrompt }] }],
          tools: [{ google_search: {} }],
          generationConfig: {
            temperature: 0.25,
          },
        }),
        signal: controller.signal,
      });

      if (response.ok) {
        const payload = (await response.json()) as any;
        const text = payload?.candidates?.[0]?.content?.parts
          ?.map((p: any) => p?.text ?? "")
          .join("\n") ?? "";
        const chunks = payload?.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
        const groundedSources: WebSearchSignal[] = [];
        for (const ch of chunks) {
          if (ch?.web?.uri && ch?.web?.title) {
            groundedSources.push({
              title: String(ch.web.title),
              url: String(ch.web.uri),
              snippet: "Google Search Grounding -lähde",
            });
          }
        }
        if (text) {
          const parsed = cleanJsonText<T>(text);
          return { data: parsed, groundedSources };
        }
      }
    } catch {
      // Fall back to standard callLlmJson below
    } finally {
      clearTimeout(timeout);
    }
  }

  try {
    const { data } = await callLlmJson<T>({
      systemInstruction: systemPrompt,
      userPrompt,
      temperature: 0.25,
      timeoutMs: 22000,
    });
    return { data, groundedSources: [] };
  } catch {
    return { data: null, groundedSources: [] };
  }
}

/**
 * Generates domain-contextual default MarketIntelligenceReport, assumptionOrigins, benchmarks,
 * and 3 executable StrategicPlayCards ("Peliliikkeet") so any business is immediately playable.
 */
export function buildDefaultMarketIntelligence(
  state: WorldState,
  customQuery?: string,
): MarketIntelligenceReport {
  const graph = buildAssumptionDependencyGraph(state);
  const industryLabel = state.company.industry || state.company.name;
  const finItem =
    state.catalog.items.find((i) => i.kind !== "raw") ??
    state.catalog.items[state.catalog.items.length - 1];
  const raw1 = state.catalog.items.find((i) => i.id === "item_raw_1") ?? state.catalog.items[0];
  const raw2 = state.catalog.items.find((i) => i.id === "item_raw_2") ?? state.catalog.items[1];
  const wh0 = state.warehouses.sites[0];
  const sup1 = state.supply.suppliers[0];

  const isService =
    finItem?.kind === "service" || state.company.archetype === "B2B_ENTERPRISE_SERVICES";
  const unitSingular = finItem?.uom ?? "kpl";
  const unitPlural = `${finItem?.uom ?? "kpl"}`;

  const sellingPriceEuros = graph.selling_price.currentValue;
  const raw1Euros = graph.raw_cost_1.currentValue;
  const raw2Euros = graph.raw_cost_2.currentValue;
  const rentEuros = graph.facility_rent.currentValue;
  const dailyDemand = graph.daily_demand.currentValue;
  const wtpEuros = graph.customer_wtp.currentValue;
  const mktDailyEuros = graph.marketing_budget.currentValue;
  const serviceHours = graph.service_capacity.currentValue;
  const salaryEuros = graph.founder_salary.currentValue;
  const compPriceEuros = graph.competitor_price.currentValue;

  if (!state.company.assumptionOrigins) {
    state.company.assumptionOrigins = {};
  }
  const origins: Record<string, string> = {
    selling_price: `Toimialan (${industryLabel}) tyypillinen ulosmyyntihinta tuotteelle "${finItem?.name ?? unitSingular}" Suomen markkinassa.`,
    raw_cost_1: isService
      ? `Arvioitu alihankinta-/ohjelmistokustannus per ${unitSingular}.`
      : `Tukkuhinta raaka-aineelle "${raw1?.name ?? "Pääraaka-aine"}" (${sup1?.name ?? "Tukkutoimittaja"}).`,
    raw_cost_2: `Pakkaus-, tarvike- tai oheismateriaalikustannus ("${raw2?.name ?? "Tarvikkeet"}") per ${unitSingular}.`,
    facility_rent: `Liiketilan tai toimipisteen ("${wh0?.name ?? "Toimitila"}") keskimääräinen kuukausivuokra ja ylläpito.`,
    daily_demand: `Arvioitu päivittäinen asiakasvirta (${dailyDemand} asiakasta/pv) nykyisellä sijainnilla ja tunnettuudella.`,
    customer_wtp: `Asiakkaiden arvioitu maksuhalukkuus (${wtpEuros} €) perustuen paikalliseen ostovoimaan ja kilpailijoihin.`,
    marketing_budget: `Päivittäinen asiakashankinta- ja näkyvyyspanostus (${mktDailyEuros} €/pv).`,
    service_capacity: `Tehollinen päivittäinen myynti- ja palveluaika (${serviceHours} h/pv).`,
    founder_salary: `Yrittäjän / vastuuhenkilön kuukausipalkka (${salaryEuros} €/kk) sivukuluineen.`,
    competitor_price: `Paikallisten kilpailijoiden (${state.market.competitors.map((c) => c.name).join(", ")}) painotettu keskihinta.`,
  };

  for (const [k, v] of Object.entries(origins)) {
    if (!state.company.assumptionOrigins[k]) {
      state.company.assumptionOrigins[k] = v;
    }
  }

  const strategicPlays: StrategicPlayCard[] = [
    {
      id: "play_local_hype_campaign",
      title: `🚀 Paikallinen Asiakasryntäys & Näkyvyysisku (${finItem?.name ?? industryLabel})`,
      category: "growth",
      description: `Käynnistä kohdennettu paikallinen avajais-/somekampanja ja katunäkyvyys. Nostaa päivittäistä asiakasvirtaa +28 % ja parantaa asiakkaiden maksuhalukkuutta +8 %.`,
      costEuros: Math.max(150, Math.round(mktDailyEuros * 10)),
      expectedImpactSummary: `Asiakasvirta ${dailyDemand} -> ${Math.max(dailyDemand + 2, Math.round(dailyDemand * 1.28))}/pv, maksuhalukkuus +8 %`,
      competitorReaction: `${state.market.competitors[0]?.name ?? "Pääkilpailija"} huomaa kasvaneen jonon ja lisää omaa markkinointiaan puolustaakseen markkinaosuuttaan.`,
      assumptionPatches: [
        {
          key: "daily_demand",
          targetValue: Math.max(dailyDemand + 2, Math.round(dailyDemand * 1.28)),
          reason: "Onnistunut paikallinen näkyvyysisku ja puskaradio kasvattivat päivittäistä asiakasvirtaa.",
        },
        {
          key: "customer_wtp",
          targetValue: Number((wtpEuros * 1.08).toFixed(2)),
          reason: "Vahvempi brändimielikuva nosti asiakkaiden maksuhalukkuutta.",
        },
      ],
      executed: false,
    },
    {
      id: "play_supplier_direct_deal",
      title: isService
        ? `⚡ Työkalujen & Alihankinnan Automatisointi`
        : `📦 Suora Tuottaja-/Tukkudiili (${raw1?.name ?? "Pääraaka-aineet"})`,
      category: "supply_chain",
      description: isService
        ? `Neuvottele vuosisopimus ohjelmistoista ja automatisoi rutiinityövaiheet. Laskee suoraa yksikkökulua -22 % ja vapauttaa +2 h/pv lisää laskutettavaa palveluaikaa.`
        : `Ohita välikädet ja sovi suora toimitusketju (${sup1?.name ?? "Päätukku"}). Laskee pääraaka-aineen ostohintaa -20 % ja pakkauskuluja -15 %.`,
      costEuros: Math.max(250, Math.round(rentEuros * 0.35)),
      expectedImpactSummary: isService
        ? `Yksikkökulut -22 %, palvelukapasiteetti ${serviceHours} -> ${Math.min(18, serviceHours + 2)} h/pv`
        : `Raaka-ainekulut -20 % (${raw1Euros} € -> ${Number((raw1Euros * 0.8).toFixed(2))} €), myyntikate paranee välittömästi`,
      competitorReaction: `Toimitusketjusi tehostuminen antaa sinulle kustannusedun, johon ${state.market.competitors[1]?.name ?? "halpakilpailija"} ei pysty vastaamaan ilman tappiota.`,
      assumptionPatches: isService
        ? [
            {
              key: "raw_cost_1",
              targetValue: Number(Math.max(0.1, raw1Euros * 0.78).toFixed(2)),
              reason: "Ohjelmistojen ja alihankinnan volyymialennus laski yksikkökustannusta.",
            },
            {
              key: "service_capacity",
              targetValue: Math.min(18, serviceHours + 2),
              reason: "Rutiinien automatisointi vapautti +2 h/pv suoraan asiakastyöhön.",
            },
          ]
        : [
            {
              key: "raw_cost_1",
              targetValue: Number(Math.max(0.05, raw1Euros * 0.8).toFixed(2)),
              reason: "Suora tukkusopimus laski pääraaka-aineen yksikköhinnan uudelle tasolle.",
            },
            {
              key: "raw_cost_2",
              targetValue: Number(Math.max(0.02, raw2Euros * 0.85).toFixed(2)),
              reason: "Suurempi tilauserä laski tarvike- ja pakkauskustannusta -15 %.",
            },
          ],
      executed: false,
    },
    {
      id: "play_premium_signature_tier",
      title: `💎 Premium Signature -tuotteistus & Aukiolon Laajennus`,
      category: "pricing",
      description: `Lanseeraa korkeamman katteen erikoisversio ("Signature ${finItem?.name ?? unitSingular}") ja pidennä myyntiaikaa parhaaseen sesonkiaikaan. Nostaa myyntihintaa +14 % ja palveluaikaa +2 h/pv.`,
      costEuros: Math.max(200, Math.round(sellingPriceEuros * 18)),
      expectedImpactSummary: `Myyntihinta ${sellingPriceEuros} € -> ${Number((sellingPriceEuros * 1.14).toFixed(2))} €, aukiolo/kapasiteetti +2 h/pv`,
      competitorReaction: `${state.market.competitors[0]?.name ?? "Laatukilpailija"} joutuu päivittämään omaa valikoimaansa, muttei pysty kopioimaan konseptiasi heti.`,
      assumptionPatches: [
        {
          key: "selling_price",
          targetValue: Number((sellingPriceEuros * 1.14).toFixed(2)),
          reason: "Signature-erikoistuotteistus mahdollisti +14 % korkeamman keskiostoksen.",
        },
        {
          key: "customer_wtp",
          targetValue: Number((Math.max(wtpEuros, sellingPriceEuros) * 1.15).toFixed(2)),
          reason: "Erikoistuote nosti asiakkaiden kokemaa arvoa ja maksuhalukkuutta.",
        },
        {
          key: "service_capacity",
          targetValue: Math.min(18, serviceHours + 2),
          reason: "Laajennettu palveluaika poistaa pullonkaulaa huipputunteina.",
        },
      ],
      executed: false,
    },
  ];

  return {
    lastUpdatedTick: state.calendar.tick,
    researchQuery: customQuery || `${industryLabel} (${finItem?.name ?? unitSingular}) markkinahinnat ja kannattavuus Suomessa`,
    usedLiveLlm: false,
    usedWebSearch: false,
    providerLabel: "Paikallinen Toimiala- & Markkinatietokanta (Oletuskalibrointi)",
    executiveSummary: `${state.company.name} toimii markkinassa "${industryLabel}". Nykyinen ulosmyyntihinta (${sellingPriceEuros} €) suhteessa kilpailijoiden keskihintaan (${compPriceEuros} €) ja asiakkaiden maksuhalukkuuteen (${wtpEuros} €) luo selkeän peliteoreettisen asetelman. Voit kalibroida kaikki muuttujat oikean maailman datalla klikkaamalla "Tee Live-Markkinatutkimus (LLM + Web)" tai toteuttaa suoraan alla olevia strategisia peliliikkeitä.`,
    marketSizingNote: `Paikallinen kysyntäpotentiaali: ~${dailyDemand} asiakasta/pv (vuositasolla ~${(dailyDemand * 360).toLocaleString("fi-FI")} ${unitPlural}/v). Kriittinen pullonkaula on ${serviceHours} h/pv kapasiteetti sekä asiakashankinnan tehokkuus.`,
    benchmarks: [
      {
        assumptionKey: "selling_price",
        label: `Myyntihinta (${finItem?.name ?? unitSingular})`,
        marketLow: Number((sellingPriceEuros * 0.78).toFixed(2)),
        marketTypical: compPriceEuros,
        marketHigh: Number((sellingPriceEuros * 1.35).toFixed(2)),
        unit: "€",
        rationale: `Markkinan hintahaarukka vastaavalle tuotteelle/palvelulle (${industryLabel}).`,
      },
      {
        assumptionKey: "raw_cost_1",
        label: `Yksikköhankintahinta (${raw1?.name ?? "Pääpanos"})`,
        marketLow: Number((raw1Euros * 0.72).toFixed(2)),
        marketTypical: raw1Euros,
        marketHigh: Number((raw1Euros * 1.3).toFixed(2)),
        unit: "€",
        rationale: `Suora hankinta- tai materiaalipanos per ${unitSingular} tilausvolyymista riippuen.`,
      },
      {
        assumptionKey: "daily_demand",
        label: `Päivittäinen asiakasvirta (asiakasta/pv)`,
        marketLow: Math.max(1, Math.round(dailyDemand * 0.55)),
        marketTypical: dailyDemand,
        marketHigh: Math.round(dailyDemand * 1.85),
        unit: `asiakasta/pv`,
        rationale: `Tyypillinen päivämyynti toimipisteelle toimialalla ${industryLabel}.`,
      },
      {
        assumptionKey: "facility_rent",
        label: `Toimitilan vuokra / kk (${wh0?.name ?? "Toimipiste"})`,
        marketLow: Math.round(rentEuros * 0.65),
        marketTypical: rentEuros,
        marketHigh: Math.round(rentEuros * 1.6),
        unit: "€/kk",
        rationale: `Sijainnista ja koosta riippuva kuukausivuokra Suomessa.`,
      },
    ],
    webSources: [],
    strategicPlays,
  };
}

interface LlmMarketCalibrationPayload {
  executiveSummary?: string;
  marketSizingNote?: string;
  calibratedVariables?: Partial<Record<AssumptionKey, number>>;
  assumptionOrigins?: Partial<Record<AssumptionKey, string>>;
  benchmarks?: Array<{
    assumptionKey: string;
    label: string;
    marketLow: number;
    marketTypical: number;
    marketHigh: number;
    unit: string;
    rationale: string;
  }>;
  strategicPlays?: Array<{
    id: string;
    title: string;
    category: "pricing" | "supply_chain" | "growth" | "capacity" | "m_and_a";
    description: string;
    costEuros: number;
    expectedImpactSummary: string;
    competitorReaction: string;
    assumptionPatches: Array<{
      key: string;
      targetValue: number;
      reason: string;
    }>;
  }>;
  webSources?: Array<{
    title: string;
    url: string;
    snippet: string;
  }>;
}

/**
 * Runs an autonomous Live Market Research & Variable Calibration pass using:
 * 1) Real Web Signals (Wikipedia REST Search + Gemini Google Search Grounding when Gemini is active)
 * 2) Active LLM (Gemini / OpenAI / Anthropic) to calibrate all 10 core quantitative variables,
 *    explain every `*` assumption origin, produce real-world benchmarks, and generate 3 bespoke Strategic Plays.
 * 3) Deterministic fallback with live web signals if no API key is configured.
 */
export async function runMarketResearchAndCalibrateWithLlm(
  state: WorldState,
  customQuery?: string,
): Promise<{
  ok: boolean;
  usedLiveLlm: boolean;
  usedWebSearch: boolean;
  updatedKeys: AssumptionKey[];
  summary: string;
  report: MarketIntelligenceReport;
}> {
  const industryLabel = state.company.industry || state.company.name;
  const finItem =
    state.catalog.items.find((i) => i.kind !== "raw") ??
    state.catalog.items[state.catalog.items.length - 1];
  const searchQuery =
    customQuery?.trim() ||
    `${industryLabel} ${finItem?.name ?? ""} hinta kustannukset markkina Suomi`.trim();

  // 1. Fetch live web signals in parallel
  const webSignals = await fetchLiveWebSignals(searchQuery);

  // Ensure default report exists as baseline
  const baselineReport = state.company.marketIntelligence ?? buildDefaultMarketIntelligence(state, searchQuery);
  const currentGraph = buildAssumptionDependencyGraph(state);

  const active = isLlmConfigured();
  if (!active) {
    // Offline / No API key: still enrich with any live web signals found and update timestamps
    const report: MarketIntelligenceReport = {
      ...baselineReport,
      lastUpdatedTick: state.calendar.tick,
      researchQuery: searchQuery,
      usedLiveLlm: false,
      usedWebSearch: webSignals.length > 0,
      providerLabel: webSignals.length > 0
        ? "Web-haku + Paikallinen Toimialamalli (Lisää LLM API-avain syväkalibrointiin)"
        : "Paikallinen Toimialamalli (Lisää LLM API-avain oikean paneelin Asetuksista)",
      webSources: webSignals.length > 0 ? webSignals : baselineReport.webSources,
    };
    state.company.marketIntelligence = report;
    pushNotification(
      state,
      "info",
      "strategy",
      `🔍 Markkinatutkimus päivitetty haulla "${searchQuery}". (Vinkki: Syötä Gemini/OpenAI/Anthropic API-avain oikean reunan paneeliin, jolloin tekoäly kalibroi kaikki 10 *-muuttujaa reaaliaikaisella web-haulla!)`,
    );
    return {
      ok: true,
      usedLiveLlm: false,
      usedWebSearch: webSignals.length > 0,
      updatedKeys: [],
      summary: "Paikallinen markkinatutkimus ja peliliikkeet päivitetty. Lisää API-avain täyteen LLM-kalibrointiin.",
      report,
    };
  }

  // 2. Build prompt with current business context, all 10 variables, and live web signals
  const currentVarsSummary = ASSUMPTION_KEYS.map((k) => {
    const n = currentGraph[k];
    return `- ${k} (${n.label}): nykyarvo = ${n.currentValue} ${n.unit} (vaihteluväli ${n.min} - ${n.max})`;
  }).join("\n");

  const webContextText =
    webSignals.length > 0
      ? `LIVE WEB-HAKUTULOKSET HAULLE "${searchQuery}":\n` +
        webSignals.map((w, i) => `${i + 1}. ${w.title} (${w.url}): ${w.snippet}`).join("\n")
      : `Ei suoria Wikipedia-osumia haulle "${searchQuery}", käytä toimialatietämystäsi ja mahdollista Google Search -työkalua.`;

  const systemPrompt = `Olet AAA-luokan Business Manager -pelin (Football Manager -tyylinen yrityssimulaattori) pääekonomisti ja markkinatutkija.
Tehtäväsi on tehdä realistinen, Suomen markkinaan (euroissa) ankkuroitu markkinatutkimus ja kalibroida yrityksen 10 keskeistä kvantitatiivista oletusta (*-muuttujaa), perustella jokaisen luvun alkuperä selkeällä suomen kielellä sekä luoda 3 konkreettista, klikattavaa strategista peliliikettä ("strategicPlays").

TÄRKEÄÄ:
1. Palauta VAIN validi JSON-objekti, ei selityksiä JSONin ulkopuolella.
2. Jos kyseessä on pieni yksikkötuote (esim. jäätelökioski, kahvila, leipomo, nakkikiska), pidä yksikköhinnat ja raaka-ainekulut realistisina per annos/kpl (esim. myyntihinta 3.50 - 7.50 €, raaka-aine 0.40 - 1.80 €, kuppi/kääre 0.15 - 0.50 €). Jos kyseessä on B2B-asiantuntija tai iso projekti, käytä sille realistisia hintoja.
3. Jokaisen "assumptionPatches.key" ja "benchmarks.assumptionKey" on oltava jokin näistä 10 avaimesta:
   "selling_price", "raw_cost_1", "raw_cost_2", "facility_rent", "daily_demand", "customer_wtp", "marketing_budget", "service_capacity", "founder_salary", "competitor_price".`;

  const userPrompt = `YRITYS: "${state.company.name}"
KÄYTTÄJÄN LIIKEIDEA / PROMletti: "${state.company.prompt || state.company.name}"
TOIMIALA: "${industryLabel}" (Arkkityyppi: ${state.company.archetype ?? "HIGH_VELOCITY_D2C"})
MYYTÄVÄ PÄÄTUOTE/PALVELU: "${finItem?.name ?? "Päätuote"}"
MARKKINATUTKIMUKSEN FOKUS / HAKU: "${searchQuery}"

NYKYISET 10 OLETUSMUUTTUJAA (*):
${currentVarsSummary}

${webContextText}

Palauta täsmällinen JSON-rakenne:
{
  "executiveSummary": "2-3 lauseen terävä, konkreettinen suomenkielinen markkina-analyysi yritykselle ja haulle '${searchQuery}'.",
  "marketSizingNote": "1-2 lauseen arvio paikallisesta kysyntäpotentiaalista, sesongista ja pullonkauloista.",
  "calibratedVariables": {
    "selling_price": <numero>,
    "raw_cost_1": <numero>,
    "raw_cost_2": <numero>,
    "facility_rent": <numero>,
    "daily_demand": <kokonaisluku>,
    "customer_wtp": <numero>,
    "marketing_budget": <numero>,
    "service_capacity": <kokonaisluku 1-24>,
    "founder_salary": <numero>,
    "competitor_price": <numero>
  },
  "assumptionOrigins": {
    "selling_price": "Tarkka suomenkielinen perustelu mistä tämä markkinahinta juontuu...",
    "raw_cost_1": "Tarkka perustelu pääraaka-aineen/panoksen tukkuhinnalle...",
    "raw_cost_2": "Tarkka perustelu pakkaus-/tarvikekululle...",
    "facility_rent": "Tarkka perustelu toimitilan vuokratasolle...",
    "daily_demand": "Tarkka perustelu päivittäiselle asiakasvirralle...",
    "customer_wtp": "Tarkka perustelu asiakkaiden maksuhalukkuudelle...",
    "marketing_budget": "Tarkka perustelu päivittäiselle markkinointipanokselle...",
    "service_capacity": "Tarkka perustelu päivittäiselle palvelu-/aukioloajalle...",
    "founder_salary": "Tarkka perustelu yrittäjän/vastuuhenkilön kuukausipalkalle...",
    "competitor_price": "Tarkka perustelu kilpailijoiden keskihinnalle..."
  },
  "benchmarks": [
    {
      "assumptionKey": "selling_price",
      "label": "Myyntihinta",
      "marketLow": <numero>,
      "marketTypical": <numero>,
      "marketHigh": <numero>,
      "unit": "€",
      "rationale": "Lyhyt selitys markkinan hintahaarukasta"
    },
    {
      "assumptionKey": "raw_cost_1",
      "label": "Pääraaka-aine / Suora yksikkökulu",
      "marketLow": <numero>,
      "marketTypical": <numero>,
      "marketHigh": <numero>,
      "unit": "€",
      "rationale": "Lyhyt selitys tukkuhintahaarukasta"
    },
    {
      "assumptionKey": "daily_demand",
      "label": "Asiakasvirta / pv",
      "marketLow": <numero>,
      "marketTypical": <numero>,
      "marketHigh": <numero>,
      "unit": "asiakasta/pv",
      "rationale": "Lyhyt selitys asiakasvirran vaihteluvälistä"
    },
    {
      "assumptionKey": "facility_rent",
      "label": "Toimitilan vuokra / kk",
      "marketLow": <numero>,
      "marketTypical": <numero>,
      "marketHigh": <numero>,
      "unit": "€/kk",
      "rationale": "Lyhyt selitys vuokratasosta"
    }
  ],
  "strategicPlays": [
    {
      "id": "play_1",
      "title": "Iskevä suomenkielinen nimi peliliikkeelle 1",
      "category": "growth",
      "description": "Konkreettinen kuvaus mitä yritys tekee käytännössä.",
      "costEuros": <kertaluonteinen investointi euroina, esim 300>,
      "expectedImpactSummary": "Esim. Asiakasvirta +30 %, maksuhalukkuus +10 %",
      "competitorReaction": "Miten paikalliset kilpailijat reagoivat tähän siirtoon peliteoreettisesti.",
      "assumptionPatches": [
        { "key": "daily_demand", "targetValue": <uusi_arvo>, "reason": "Miksi arvo muuttuu" }
      ]
    },
    {
      "id": "play_2",
      "title": "Iskevä suomenkielinen nimi peliliikkeelle 2 (esim. hankintaketju)",
      "category": "supply_chain",
      "description": "Konkreettinen kuvaus toimitusketjun tai kapasiteetin peliliikkeestä.",
      "costEuros": <numero>,
      "expectedImpactSummary": "Lyhyt vaikutustiivistelmä",
      "competitorReaction": "Kilpailijoiden reaktio",
      "assumptionPatches": [
        { "key": "raw_cost_1", "targetValue": <uusi_arvo>, "reason": "Miksi arvo muuttuu" }
      ]
    },
    {
      "id": "play_3",
      "title": "Iskevä suomenkielinen nimi peliliikkeelle 3 (esim. hinnoittelu/laajennus)",
      "category": "pricing",
      "description": "Konkreettinen kuvaus hinnoittelu- tai laajennuspeliliikkeestä.",
      "costEuros": <numero>,
      "expectedImpactSummary": "Lyhyt vaikutustiivistelmä",
      "competitorReaction": "Kilpailijoiden reaktio",
      "assumptionPatches": [
        { "key": "selling_price", "targetValue": <uusi_arvo>, "reason": "Miksi arvo muuttuu" }
      ]
    }
  ]
}`;

  const { data: llmResult, groundedSources } = await callLlmWithOptionalGoogleSearch<LlmMarketCalibrationPayload>(
    systemPrompt,
    userPrompt,
  );

  if (!llmResult) {
    const fallbackReport: MarketIntelligenceReport = {
      ...baselineReport,
      lastUpdatedTick: state.calendar.tick,
      researchQuery: searchQuery,
      usedLiveLlm: false,
      usedWebSearch: webSignals.length > 0,
      webSources: webSignals,
    };
    state.company.marketIntelligence = fallbackReport;
    return {
      ok: false,
      usedLiveLlm: false,
      usedWebSearch: webSignals.length > 0,
      updatedKeys: [],
      summary: "LLM-kutsu ei palauttanut tulosta. Säilytettiin nykyinen markkinadata.",
      report: fallbackReport,
    };
  }

  // 3. Apply calibrated variables through the deterministic assumption engine!
  const updatedKeys: AssumptionKey[] = [];
  if (!state.company.assumptionOrigins) {
    state.company.assumptionOrigins = {};
  }

  if (llmResult.assumptionOrigins) {
    for (const key of ASSUMPTION_KEYS) {
      const originText = llmResult.assumptionOrigins[key];
      if (typeof originText === "string" && originText.trim().length > 0) {
        state.company.assumptionOrigins[key] = originText.trim();
      }
    }
  }

  if (llmResult.calibratedVariables) {
    for (const key of ASSUMPTION_KEYS) {
      const rawVal = llmResult.calibratedVariables[key];
      if (typeof rawVal === "number" && Number.isFinite(rawVal) && rawVal >= 0) {
        const customOrigin = state.company.assumptionOrigins[key];
        const res = applyAssumptionUpdate(state, key, rawVal, {
          markCustomized: false, // Keep '*' badge since this came from LLM market intelligence!
          customOrigin,
          silent: true,
        });
        if (res.ok) {
          updatedKeys.push(key);
        }
      }
    }
  }

  const combinedSources = [...groundedSources, ...webSignals, ...(llmResult.webSources ?? [])].slice(0, 6);

  const validPlays: StrategicPlayCard[] =
    Array.isArray(llmResult.strategicPlays) && llmResult.strategicPlays.length > 0
      ? llmResult.strategicPlays.slice(0, 4).map((p, idx) => ({
          id: p.id || `llm_play_${idx + 1}`,
          title: p.title || `Strateginen peliliike #${idx + 1}`,
          category: p.category || "growth",
          description: p.description || "",
          costEuros: Math.max(0, Number(p.costEuros ?? 250)),
          expectedImpactSummary: p.expectedImpactSummary || "Parantaa markkina-asemaa",
          competitorReaction: p.competitorReaction || "Kilpailijat seuraavat tilannetta.",
          assumptionPatches: (p.assumptionPatches ?? [])
            .filter((patch) => (ASSUMPTION_KEYS as readonly string[]).includes(patch.key) && Number.isFinite(patch.targetValue))
            .map((patch) => ({
              key: patch.key,
              targetValue: Number(patch.targetValue),
              reason: patch.reason || "LLM-peliliikkeen vaikutus",
            })),
          executed: false,
        }))
      : baselineReport.strategicPlays;

  const validBenchmarks =
    Array.isArray(llmResult.benchmarks) && llmResult.benchmarks.length > 0
      ? llmResult.benchmarks.slice(0, 6).map((b) => ({
          assumptionKey: b.assumptionKey || "selling_price",
          label: b.label || b.assumptionKey,
          marketLow: Number(b.marketLow ?? 0),
          marketTypical: Number(b.marketTypical ?? 0),
          marketHigh: Number(b.marketHigh ?? 0),
          unit: b.unit || "€",
          rationale: b.rationale || "",
        }))
      : baselineReport.benchmarks;

  const status = getMaskedLlmConfig();
  const report: MarketIntelligenceReport = {
    lastUpdatedTick: state.calendar.tick,
    researchQuery: searchQuery,
    usedLiveLlm: true,
    usedWebSearch: combinedSources.length > 0,
    providerLabel: `${status.provider.toUpperCase()} (${status.model})${combinedSources.length > 0 ? " + Live Web Search" : ""}`,
    executiveSummary: llmResult.executiveSummary || baselineReport.executiveSummary,
    marketSizingNote: llmResult.marketSizingNote || baselineReport.marketSizingNote,
    benchmarks: validBenchmarks,
    webSources: combinedSources,
    strategicPlays: validPlays,
  };

  state.company.marketIntelligence = report;

  const summary = `🌍 AI-Markkinatutkimus valmis (${report.providerLabel}): ${updatedKeys.length} *-muuttujaa kalibroitu oikean markkinadatan pohjalta ja ${validPlays.length} uutta strategista peliliikettä avattu!`;
  pushNotification(state, "info", "strategy", summary);

  return {
    ok: true,
    usedLiveLlm: true,
    usedWebSearch: combinedSources.length > 0,
    updatedKeys,
    summary,
    report,
  };
}

/**
 * Executes a 1-click Strategic Play ("Peliliike") from the War Room:
 * 1) Charges upfront investment cost via double-entry journal (`cash` -> `opex_other`)
 * 2) Applies all `assumptionPatches` to the live `WorldState` and updates downstream economics
 * 3) Triggers game-theoretic competitor reaction and logs an event notification
 */
export function executeStrategicPlay(
  state: WorldState,
  playId: string,
): {
  ok: boolean;
  summary: string;
  play?: StrategicPlayCard;
} {
  if (!state.company.marketIntelligence) {
    state.company.marketIntelligence = buildDefaultMarketIntelligence(state);
  }
  const report = state.company.marketIntelligence;
  const play = report.strategicPlays.find((p) => p.id === playId);
  if (!play) {
    return { ok: false, summary: `Strategista peliliikettä (${playId}) ei löytynyt.` };
  }
  if (play.executed) {
    return { ok: false, summary: `Peliliike "${play.title}" on jo toteutettu.` };
  }

  // 1. Charge upfront investment cost if > 0 while preserving strict accounting invariants
  const requestedCostCents = Math.max(0, Math.round(play.costEuros * 100));
  const availableCashCents = Math.max(0, state.finance.ledger.balances.cash ?? 0);
  const actualCostCents = Math.min(requestedCostCents, availableCashCents);

  if (actualCostCents > 0) {
    postJournal(state, {
      memo: `Strateginen peliliike: ${play.title}`,
      source: "strategic_play",
      cashFlow: "operating",
      lines: [
        { account: "cash", amount: -actualCostCents },
        { account: "opex_other", amount: actualCostCents },
      ],
    });
  }

  // 2. Apply all assumption patches
  const appliedChanges: string[] = [];
  for (const patch of play.assumptionPatches) {
    if ((ASSUMPTION_KEYS as readonly string[]).includes(patch.key)) {
      const k = patch.key as AssumptionKey;
      const res = applyAssumptionUpdate(state, k, patch.targetValue, {
        markCustomized: true,
        customOrigin: `Toteutettu peliliike (${play.title}): ${patch.reason}`,
        silent: true,
      });
      if (res.ok && res.node) {
        appliedChanges.push(`${res.node.label} -> ${res.node.displayValue}`);
      }
    }
  }

  play.executed = true;

  // 3. Apply subtle game-theory competitor counter-move
  if (state.market.competitors.length > 0) {
    const mainComp = state.market.competitors[0];
    if (play.category === "pricing" && mainComp.offerings[0]) {
      mainComp.offerings[0].quality = Math.min(1, Number((mainComp.offerings[0].quality + 0.02).toFixed(2)));
    } else if (play.category === "growth") {
      mainComp.aggression = Math.min(1, Number((mainComp.aggression + 0.04).toFixed(2)));
    }
  }

  const costFormatted = (actualCostCents / 100).toLocaleString("fi-FI", { maximumFractionDigits: 0 });
  const summary = `⚡ Peliliike toteutettu: "${play.title}" (Investointi ${costFormatted} €). Vaikutus: ${appliedChanges.join(", ")}. Kilpailijareaktio: ${play.competitorReaction}`;
  pushNotification(state, "info", "strategy", summary);

  return {
    ok: true,
    summary,
    play,
  };
}

/**
 * Steps the living market intelligence & competitor reactions as time progresses.
 */
export function stepLivingWorldDynamics(state: WorldState): void {
  if (!state.company.marketIntelligence) {
    state.company.marketIntelligence = buildDefaultMarketIntelligence(state);
  }
  const ost0 = state.commercial.offeringStates[0];
  const off0 = state.commercial.offerings[0];
  const ourPrice =
    ost0?.lastPrice ??
    (off0?.pricing.kind === "value_based" ? off0.pricing.listPrice : 2500);
  const comp0 = state.market.competitors[0];
  if (!comp0 || !comp0.offerings[0]) return;

  const compPrice = comp0.offerings[0].price;
  if (state.calendar.tick > 0 && state.calendar.tick % 5 === 0) {
    if (ourPrice < compPrice * 0.82 && comp0.aggression > 0.5) {
      const nextCompPrice = Math.max(100, Math.round(compPrice * 0.96));
      if (nextCompPrice !== compPrice) {
        comp0.offerings[0].price = nextCompPrice;
        pushNotification(
          state,
          "warning",
          "market",
          `⚔️ Peliteoreettinen reaktio: ${comp0.name} laski hintaansa (${(nextCompPrice / 100).toFixed(2)} €) vastauksena hinnoitteluusi!`,
        );
      }
    } else if (ourPrice > compPrice * 1.15 && (ost0?.qualityScore ?? 0.8) >= 0.75) {
      const nextCompPrice = Math.round(compPrice * 1.03);
      comp0.offerings[0].price = nextCompPrice;
    }
  }
}
