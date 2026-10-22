/**
 * APEX Genesis Studio & Business Idea Canvas (`/src/components/GenesisStudio.ts`).
 *
 * Implements the human-first, progressive onboarding journey:
 *  1. Phase 0: Tabula Rasa (Clean slate, idea prompt & demo sandbox shortcuts)
 *  2. Phase 1: Interactive Business Idea Canvas (Team setup, Founder role, Capability design & Unit economics)
 *  3. Phase 2: Ignition -> Launch into full AAA War Room Mission Control.
 */
import {
  ARCHETYPE_BASELINES,
  buildPreFlightSenseCheck,
  SCENARIO_PRESETS,
  suggestInitialCapitalEuros,
} from "../core/compiler";
import { buildIncomeStatement } from "../core/engine/ledger";
import { unitBookCost } from "../core/engine/warehouse";
import type { MaskedLlmConfig } from "../core/llm";
import { getLlmSessionTelemetry, getMaskedLlmConfig, PROVIDER_PRESETS } from "../core/llm";
import type { IndustryArchetype, WorldState } from "../core/schema";
import { escapeHtml, fmtCurrency, fmtPct } from "./formatters";

export interface GenesisStudioProps {
  mode: "genesis" | "canvas";
  draftPrompt?: string;
  initialCapitalEuros?: number;
  commercialModelNotes?: string;
  state: WorldState;
  founderRole?: "solo_founder" | "commercial" | "product" | "general_manager" | "custom";
  customFounderRole?: string;
  capabilities?: {
    production: "in_house" | "outsource";
    warehouse: "in_house" | "outsource";
    logistics: "in_house" | "outsource";
    qa: "in_house" | "outsource";
  };
  llmConfig?: MaskedLlmConfig;
}

export function renderApiTelemetryPillHtml(maskedCfg: MaskedLlmConfig): string {
  const tel = maskedCfg.telemetry ?? getLlmSessionTelemetry();
  const providerSpec = PROVIDER_PRESETS[maskedCfg.provider] ?? PROVIDER_PRESETS.deterministic;
  const statusColor =
    tel.quotaStatus === "active"
      ? "tag-green"
      : tel.quotaStatus === "rate_limited"
        ? "tag-amber"
        : tel.quotaStatus === "error"
          ? "tag-red"
          : "tag-slate";

  const lastAct = tel.recentActivities[0];
  return `
    <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
      <button type="button" class="btn btn-xs btn-secondary" id="btn-open-llm-modal" title="${escapeHtml(tel.tierNoteFi)}" style="display:inline-flex;align-items:center;gap:6px">
        <span>⚙ ${escapeHtml(maskedCfg.isKeySet ? providerSpec.name : "LLM Engine (BYOK)")}</span>
        <span class="tag ${statusColor} mono" style="font-size:9.5px;padding:1px 5px">
          API: ${tel.totalCalls} kutsua (${tel.successfulCalls} OK) • ~${tel.totalTokens.toLocaleString("fi-FI")} tok
        </span>
      </button>
      <span class="tag ${statusColor} mono" style="font-size:10px" title="${escapeHtml(tel.tierNoteFi)}">
        ${escapeHtml(tel.quotaLabelFi)}
      </span>
      ${
        lastAct
          ? `<span class="sub mono" style="font-size:10.5px;color:#93c5fd">⚡ Viimeisin: ${escapeHtml(lastAct.titleFi)} (${escapeHtml(lastAct.timestampIso)})</span>`
          : ""
      }
    </div>
  `;
}

export function renderGenesisTabulaRasa(props: GenesisStudioProps): string {
  const maskedCfg = props.llmConfig ?? getMaskedLlmConfig();
  const providerSpec = PROVIDER_PRESETS[maskedCfg.provider] ?? PROVIDER_PRESETS.deterministic;
  const defaultCap =
    props.initialCapitalEuros ??
    props.state.company.initialCapitalEuros ??
    suggestInitialCapitalEuros(props.draftPrompt || "jäätelökioski");
  const defaultNotes =
    props.commercialModelNotes ?? props.state.company.commercialModelNotes ?? "";

  const llmBadge = maskedCfg.isKeySet
    ? `<span class="tag tag-cyan mono">AI-MOOTTORI: ${escapeHtml(providerSpec.name.toUpperCase())} (${escapeHtml(maskedCfg.model)})</span>`
    : `<span class="tag tag-slate mono">AI-MOOTTORI: SISÄINEN FYSIKKAMOOTTORI</span>`;

  return `
    <div class="genesis-shell">
      <!-- TOP NAVIGATION -->
      <header class="genesis-topbar">
        <div class="brand-cluster">
          <div class="apex-logo">▲ APEX</div>
          <div>
            <div class="company-title-row">
              <span class="genesis-title">VENTURE STUDIO &amp; BUSINESS SIMULATOR</span>
              <span class="tag tag-blue mono">VAIHE 0 • LIIKEIDEAN PERUSTAMINEN</span>
              ${llmBadge}
            </div>
            <p class="sub">Muunna mikä tahansa liikeidea eläväksi yritykseksi — nakkikiskasta pörssiyhtiöön.</p>
          </div>
        </div>
        <div class="topbar-actions">
          <a href="/" title="APEX Studio: uusi toimialasta riippumaton näkymä. Tämä klassinen näkymä poistuu myöhemmin." style="display:inline-flex;align-items:center;gap:6px;padding:6px 12px;border:1px solid #38bdf8;border-radius:8px;color:#e0f2fe;text-decoration:none;font-size:13px;background:rgba(14,116,144,0.25)">← Siirry APEX Studioon</a>
          ${renderApiTelemetryPillHtml(maskedCfg)}
        </div>
      </header>

      <!-- LIVE ENGINE / LLM ACTIVITY BANNER (shown during compilation) -->
      <div id="genesis-live-activity-banner" style="display:none;margin:10px auto 0 auto;max-width:920px;padding:12px 16px;background:rgba(14,116,144,0.22);border:1px solid #38bdf8;border-radius:10px;color:#e0f2fe">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:12px">
          <div style="display:flex;align-items:center;gap:10px">
            <span class="tag tag-cyan mono">⏳ APEX TYÖSTÄÄ</span>
            <strong id="genesis-live-activity-title">Rakennetaan yrityksen toimintamallia, arvoketjua ja Sense Check -riskianalyysiä...</strong>
          </div>
          <span class="mono" id="genesis-live-activity-timer" style="font-size:12px;color:#38bdf8">0.0s</span>
        </div>
        <div id="genesis-live-activity-sub" class="sub" style="margin-top:4px;color:#bae6fd">
          ${maskedCfg.isKeySet ? `Kutsutaan ${escapeHtml(providerSpec.name)} (${escapeHtml(maskedCfg.model)}) API-rajapintaa ja lasketaan alkutase...` : "Syntetisoidaan toimialan arvoketju, yksikkötalous ja kannattavuusraja..."}
        </div>
      </div>

      <!-- HERO / INVITATION SECTION -->
      <main class="genesis-hero-container">
        <div class="genesis-hero-card">
          <div class="genesis-badge-row">
            <span class="tag tag-green">TYHJÄ PÖYTÄ • TABULA RASA</span>
            <span class="sub">Aloita yksinkertaisesta — malli skaalautuu mukanasi</span>
          </div>

          <h1 class="genesis-hero-h1">Minkälaisen yrityksen haluat rakentaa?</h1>
          <p class="genesis-hero-p">
            Kerro ideasi, aseta alkupääomasi ja halutessasi oma näkemyksesi hinnoittelusta. Ennen kuin simulaatio alkaa,
            APEX tekee ideallesi <strong>Sense Check -kannattavuus- ja riskianalyysin</strong> ja varmistaa, että luvut käyvät järkeen.
          </p>

          <!-- PROMPT INPUT FORM -->
          <form id="genesis-spark-form" class="genesis-spark-form">
            <div class="prompt-input-wrapper">
              <label style="display:block;font-size:11.5px;font-weight:700;color:#94a3b8;margin-bottom:5px;letter-spacing:0.04em">
                1. LIIKEIDEA OMIN SANOIN
              </label>
              <textarea
                id="genesis-prompt-input"
                class="genesis-textarea"
                rows="3"
                placeholder="Kuvaile liikeideasi omin sanoin... Esimerkiksi: 'Yögrilli ja nakkikiska keskustassa, höyrymakkarat, lihapiirakat ja kylmät juomat' tai 'Korkealuokkainen hapanjuurileipomo...'"
              >${escapeHtml(props.draftPrompt || "")}</textarea>
            </div>

            <!-- INSPIRATION PILLS -->
            <div class="inspiration-container">
              <span class="sub">Tai valitse valmis ideaesimerkki:</span>
              <div class="inspiration-pills">
                <button type="button" class="btn-pill" data-fill-prompt="Kesäinen jäätelökioski kauppatorilla, Valion ja Pingviinin jäätelöt, oma myyntiluukku ja terassi." data-fill-capital="8000" data-fill-notes="Jäätelöpallo 4,50 €, tötteröt ja jäätelö tukusta n. 1,10 €/annos, kesäpäivänä 50–80 asiakasta.">
                  🍦 Jäätelökioski (8 000 €)
                </button>
                <button type="button" class="btn-pill" data-fill-prompt="Yögrilli ja nakkikiska keskustassa, höyrymakkarat, lihapiirakat ja juomat." data-fill-capital="10000" data-fill-notes="Grilliannos keskimäärin 7,50 €, raaka-aineet 2,10 €/annos, kiinteä kojussa 1 yrittäjä aluksi.">
                  🌭 Nakkikiska &amp; Grilli (10 000 €)
                </button>
                <button type="button" class="btn-pill" data-fill-prompt="Korkealuokkainen hapanjuurileipomo D2C-tilauslaatikolla ja B2B-kahvilatoimituksilla." data-fill-capital="25000" data-fill-notes="Artesaanileipä 6,50 € ulosmyynti, jauhot ja energia 1,80 €/leipä.">
                  🥐 Hapanjuurileipomo (25 000 €)
                </button>
                <button type="button" class="btn-pill" data-fill-prompt="B2B-teollisuuslaitteiden ennakoiva huoltoalusta ja etädiagnostiikka IoT-laitteilla." data-fill-capital="40000" data-fill-notes="Kuukausitilaus (SaaS) 290 €/kk per yritysasiakas.">
                  ☁️ B2B Kalusto-SaaS (40 000 €)
                </button>
                <button type="button" class="btn-pill" data-fill-prompt="Robottiohjattu vertikaalinen mansikkatila ja salaattiviljelmä kaupunkikeskuksessa." data-fill-capital="150000" data-fill-notes="">
                  🍓 Robottimansikkatila (150 000 €)
                </button>
                <button type="button" class="btn-pill" data-fill-prompt="Räätälöityjä titaanirunkoisia sähköpyöriä valmistava tehdas D2C- ja erikoisliikejakelulla." data-fill-capital="200000" data-fill-notes="">
                  🚲 Titaanisähköpyörät (200 000 €)
                </button>
              </div>
            </div>

            <!-- STARTING CAPITAL & COMMERCIAL MODEL INPUTS -->
            <div style="display:grid;grid-template-columns:1fr 1.35fr;gap:14px;margin-top:14px;padding:12px 14px;background:#0f172a;border:1px solid #1e293b;border-radius:10px;text-align:left">
              <div>
                <label for="genesis-capital-input" style="display:block;font-size:11.5px;font-weight:700;color:#38bdf8;margin-bottom:4px">
                  2. ALKUPÄÄOMA (€) — PALJONKO SIJOITAT ALKUUN?
                </label>
                <div style="display:flex;align-items:center;gap:8px">
                  <input
                    type="number"
                    id="genesis-capital-input"
                    min="500"
                    max="10000000"
                    step="500"
                    value="${defaultCap}"
                    style="width:140px;padding:7px 10px;border-radius:6px;border:1px solid #334155;background:#020617;color:#f8fafc;font-size:14px;font-weight:700"
                  />
                  <span class="mono" style="font-size:12px;color:#94a3b8">€ alkukassa</span>
                </div>
                <div style="display:flex;gap:5px;flex-wrap:wrap;margin-top:7px">
                  ${[2500, 5000, 10000, 25000, 50000, 200000]
                    .map(
                      (amt) => `
                    <button type="button" class="btn btn-xs btn-secondary" data-set-genesis-capital="${amt}" style="font-size:10.5px;padding:2px 7px">
                      ${amt.toLocaleString("fi-FI")} €
                    </button>`,
                    )
                    .join("")}
                </div>
                <span class="sub" style="display:block;margin-top:5px;font-size:11px">
                  Pieni alkupääoma (esim. 5 000–25 000 €) käynnistää yrityksen <b>1 hengen yksinyrittäjänä</b>, jolloin voit palkata ensimmäiset työntekijät myynnin kasvaessa.
                </span>
              </div>

              <div>
                <label for="genesis-commercial-notes" style="display:block;font-size:11.5px;font-weight:700;color:#10b981;margin-bottom:4px">
                  3. OMA NÄKEMYS KAUPALLISESTA MALLISTA &amp; HINNOITTELUSTA (VALINNAINEN)
                </label>
                <textarea
                  id="genesis-commercial-notes"
                  rows="2"
                  placeholder="Esim. 'Annos maksaa 7,50 €, raaka-aineet n. 2 € tukusta, tavoite 50 asiakasta päivässä' tai jätä tyhjäksi, jolloin APEX ehdottaa mallia."
                  style="width:100%;padding:7px 10px;border-radius:6px;border:1px solid #334155;background:#020617;color:#f8fafc;font-size:12.5px;line-height:1.4"
                >${escapeHtml(defaultNotes)}</textarea>
                <span class="sub" style="display:block;margin-top:4px;font-size:11px">
                  APEX lukee hinnoittelu- ja volyymiajatuksesi ja tekee niille <b>Sense Check -kannattavuuslaskelman</b> seuraavassa vaiheessa.
                </span>
              </div>
            </div>

            <!-- FORM ACTIONS -->
            <div class="genesis-form-actions" style="margin-top:16px">
              <button type="button" class="btn btn-primary btn-lg" id="btn-submit-spark">
                🛡️ Tee Sense Check, riskianalyysi &amp; toimintamalli →
              </button>
            </div>
          </form>

          <!-- FAST TRACK: DEMO SANDBOX -->
          <div class="genesis-sandbox-section">
            <div class="sandbox-divider">
              <span>TAI ASTU SUORAAN VALMIISEEN SIMULAATIOON (DEMO SANDBOX)</span>
            </div>
            <div class="sandbox-cards-grid">
              ${SCENARIO_PRESETS.map((p) => {
                const icon =
                  p.id === "vertical_farm"
                    ? "🍓"
                    : p.id === "custom_ebike"
                      ? "🚲"
                      : "🧊";
                return `
                  <button type="button" class="sandbox-card" data-launch-sandbox="${p.id}">
                    <div class="sandbox-card-top">
                      <span class="sandbox-icon">${icon}</span>
                      <strong>${escapeHtml(p.name)}</strong>
                    </div>
                    <span class="tag tag-cyan tag-xs">${escapeHtml(p.industry)}</span>
                    <p class="sandbox-desc">${escapeHtml(p.tagline)}</p>
                    <div class="sandbox-action-row">
                      <span class="link-help">Astu War Roomiin →</span>
                    </div>
                  </button>
                `;
              }).join("")}
            </div>
          </div>
        </div>
      </main>
    </div>
  `;
}

interface ArchetypeCanvasConfig {
  physicsExplanation: string;
  roles: {
    id: "commercial" | "product" | "general_manager";
    title: string;
    sub: string;
  }[];
  capabilities: {
    key: "production" | "warehouse" | "logistics";
    icon: string;
    title: string;
    sub: string;
    inHouseLabel: string;
    outsourceLabel: string;
  }[];
  economics: {
    itemLabel: string;
    itemSub: string;
    priceLabel: string;
    priceSub: string;
    marginLabel: string;
    marginSub: string;
  };
  ignitionText: string;
}

export const ARCHETYPE_FRIENDLY_NAMES: Record<IndustryArchetype, string> = {
  PERISHABLE_COLD_CHAIN: "Tuoretuote & Kioski / Kylmäketju",
  HIGH_VELOCITY_D2C: "Kuluttajatuote & Verkkokauppa (D2C)",
  B2B_ENTERPRISE_SERVICES: "Asiantuntijapalvelu & B2B-osaaminen",
  PLATFORM_RECURRING: "Ohjelmisto & SaaS-alusta",
  ASSET_HEAVY_MANUFACTURING: "Teollinen valmistus & Konepaja",
};

const ARCHETYPE_CANVAS_CONFIGS: Record<IndustryArchetype, ArchetypeCanvasConfig> = {
  B2B_ENTERPRISE_SERVICES: {
    physicsExplanation:
      "Asiantuntijapalvelut & B2B-osaaminen. Simulaation fysiikka: asiantuntijoiden laskutusaste, ihmispääoman tuottavuus ja B2B-asiakkaiden tyypilliset maksuajat (15–60 pv) ilman fyysistä varasto- tai rahtiriskiä.",
    roles: [
      {
        id: "commercial",
        title: "🎯 Managing Partner / Asiakkuusjohtaja",
        sub: "Fokuksesi on uusasiakashankinnassa, tarjouksissa ja B2B-asiakassuhteissa. CRO toimii läheisenä sparraajanasi.",
      },
      {
        id: "product",
        title: "🧠 Principal Consultant / Johtava asiantuntija",
        sub: "Fokuksesi on asiakastoimituksissa, toimituslaadussa ja metodologiassa. Delivery Lead sparraa toimitusresursseja.",
      },
      {
        id: "general_manager",
        title: "📊 Toimitusjohtaja / Managing Director",
        sub: "Fokuksesi on tiimin rekrytoinnissa, laskutusasteessa ja kassavirrassa. CFO valvoo kiitotietä.",
      },
    ],
    capabilities: [
      {
        key: "production",
        icon: "👥",
        title: "Asiantuntijatyö & Toimitus (Core Delivery)",
        sub: "Oma senior-tiimi takaa korkean laadun ja metodologisen IP:n. Freelancer-verkosto joustaa ilman kiinteää palkkariskiä.",
        inHouseLabel: "Oma senior-tiimi",
        outsourceLabel: "Freelancer-verkosto",
      },
      {
        key: "warehouse",
        icon: "🤝",
        title: "B2B-Asiakashankinta & Myynti",
        sub: "Oma B2B-myyntitiimi rakentaa syvät asiakassuhteet. Kumppaniverkosto toimii provisiopohjaisesti ilman kiinteää palkkakulua.",
        inHouseLabel: "Oma myyntitiimi",
        outsourceLabel: "Kumppaniverkosto",
      },
      {
        key: "logistics",
        icon: "📚",
        title: "Metodologia, Työkalut & IP",
        sub: "Omat patentoidut menetelmät ja proprietary-työkalut nostavat päivähintaa. Standardityökalut ovat nopeita ottaa käyttöön.",
        inHouseLabel: "Omat metodit & IP",
        outsourceLabel: "Standardityökalut",
      },
    ],
    economics: {
      itemLabel: "PÄÄPALVELU",
      itemSub: "Laskutettava asiantuntijapalvelu • Ei fyysistä varastoa",
      priceLabel: "LASKUTUSHINTA / PÄIVÄ",
      priceSub: "Laskutettava asiantuntijapäivä",
      marginLabel: "PALVELUKATE",
      marginSub: "Ei fyysistä tuotehävikkiä (100% osaamispääomaa)",
    },
    ignitionText:
      "Toimintamalli on nyt viritetty. Kun painat käynnistysnappia, Engine A käynnistää Päivän 1, asiantuntijatiimisi ottaa ensimmäiset toimeksiannot työn alle ja johtoryhmäsi (Managing Partner, Delivery Lead, CFO) astuu esiin ensimmäiseen strategiaväittelyyn.",
  },
  PLATFORM_RECURRING: {
    physicsExplanation:
      "Jatkuvalasketteinen SaaS & Digitaalinen Alusta. Simulaation fysiikka: toistuva kuukausitulo (MRR), asiakaspoistuma (churn) ja pilvi-infrastruktuuri ilman fyysistä varastoriskiä.",
    roles: [
      {
        id: "commercial",
        title: "🎯 Growth Lead / Kaupallinen johtaja",
        sub: "Fokuksesi on SaaS-kasvussa, konversiossa ja asiakashankinnassa (CAC). CRO sparraa markkinointisuppiloa.",
      },
      {
        id: "product",
        title: "💻 CTO / Tuotearkkitehti",
        sub: "Fokuksesi on tuotteen ominaisuuksissa, koodin laadussa ja UX-kokemuksessa. Head of Eng sparraa dev-tiimiä.",
      },
      {
        id: "general_manager",
        title: "📊 CEO / General Manager",
        sub: "Fokuksesi on strategiassa, rahoituskierroksissa ja kassakiitotiessä. CFO valvoo kiitotietä.",
      },
    ],
    capabilities: [
      {
        key: "production",
        icon: "💻",
        title: "Tuotekehitys & Ohjelmointi (Core Dev)",
        sub: "Omat in-house kehittäjät mahdollistavat nopean iteroinnin. Dev-toimisto mahdollistaa MVP:n ilman kiinteitä rekrytointeja.",
        inHouseLabel: "Omat koodarit",
        outsourceLabel: "Dev-toimisto",
      },
      {
        key: "warehouse",
        icon: "☁️",
        title: "Pilvi-infrastruktuuri & DevOps",
        sub: "Oma pilviarkkitehtuuri minimoi yksikkökulut skaalassa. Täysin hallittu Serverless/PaaS säästää ylläpidon ilman omaa tiimiä.",
        inHouseLabel: "Oma pilviarkkitehtuuri",
        outsourceLabel: "Managed PaaS",
      },
      {
        key: "logistics",
        icon: "🎧",
        title: "Asiakastuki & Onboarding (Customer Success)",
        sub: "Dedikoitu CS-tiimi minimoi poistuman (churn). Itsepalvelu ja automaatio skaalautuvat rajattomasti nollakuluin.",
        inHouseLabel: "Dedikoitu CS-tiimi",
        outsourceLabel: "Itsepalvelu & Botit",
      },
    ],
    economics: {
      itemLabel: "PÄÄTILAUS (SAAS)",
      itemSub: "Toistuva kuukausitilaus (MRR) • Pilvialusta",
      priceLabel: "KUUKAUSIHINTA (MRR / SEAT)",
      priceSub: "Pilvi-infran yksikkökustannus",
      marginLabel: "BRUTTOKATE (SAAS)",
      marginSub: "Korkea ohjelmistokate • Ei fyysistä varastoriskiä",
    },
    ignitionText:
      "Toimintamalli on nyt viritetty. Kun painat käynnistysnappia, Engine A käynnistää Päivän 1, pilvi-infrastruktuuri aktivoituu, ensimmäiset kokeilukäyttäjät saapuvat suppiloon ja johtoryhmäsi (CTO, CRO, CFO) astuu esiin ensimmäiseen strategiaväittelyyn.",
  },
  HIGH_VELOCITY_D2C: {
    physicsExplanation:
      "Korkean kierron kuluttajabrändi & D2C. Simulaation fysiikka: asiakashankintakustannus (CAC), varaston kiertoaika (DIO) ja suoran verkkokauppamyynnin katteet.",
    roles: [
      {
        id: "commercial",
        title: "🎯 Brand & Growth Director",
        sub: "Fokuksesi on digitaalisessa markkinoinnissa, brändissä ja verkkokauppakonversiossa. CRO sparraa kampanjoita.",
      },
      {
        id: "product",
        title: "🎨 Head of Design & Product",
        sub: "Fokuksesi on tuotemuotoilussa, pakkauksissa ja unboxing-kokemuksessa. COO sparraa toimitusketjua.",
      },
      {
        id: "general_manager",
        title: "📊 Operations & Supply Lead",
        sub: "Fokuksesi on toimitusketjussa, varastonkierrossa ja käyttöpääoman riittävyydessä. CFO valvoo kiitotietä.",
      },
    ],
    capabilities: [
      {
        key: "production",
        icon: "✨",
        title: "Tuotesuunnittelu & Brändi (Design Core)",
        sub: "Oma tiimi luo uniikin brändi-identiteetin. Ulkoinen agency tuo nopeutta ja kokenutta kampanjaosaamista.",
        inHouseLabel: "Oma design-tiimi",
        outsourceLabel: "Creative Agency",
      },
      {
        key: "warehouse",
        icon: "🏭",
        title: "Valmistus & Tuotanto (Manufacturing)",
        sub: "Oma pientuotanto mahdollistaa nopeat erät ja tarkan laadun. Sopimusvalmistus (OEM) mahdollistaa suuret volyymit edullisesti.",
        inHouseLabel: "Oma paja",
        outsourceLabel: "Sopimusvalmistus (OEM)",
      },
      {
        key: "logistics",
        icon: "📦",
        title: "Tilauskeräily & Verkkokauppalogistiikka",
        sub: "Oma varasto takaa brändätyn pakkauselämyksen. 3PL-varastointi automatisoi globaalin toimituksen ilman tilavuokria.",
        inHouseLabel: "Oma pakkausvarasto",
        outsourceLabel: "3PL-verkkokauppavarasto",
      },
    ],
    economics: {
      itemLabel: "PÄÄTUOTE (SKU)",
      itemSub: "Kuluttajatuote & Verkkokauppavarasto",
      priceLabel: "ULOSMYYNTIHINTA",
      priceSub: "Yksikkökustannus (COGS)",
      marginLabel: "BRUTTOKATE",
      marginSub: "D2C-brändikate",
    },
    ignitionText:
      "Toimintamalli on nyt viritetty. Kun painat käynnistysnappia, Engine A käynnistää Päivän 1, verkkokauppakampanjat käynnistyvät ja johtoryhmäsi (Brand Lead, COO, CFO) astuu esiin ensimmäiseen strategiaväittelyyn.",
  },
  ASSET_HEAVY_MANUFACTURING: {
    physicsExplanation:
      "Pääomavaltainen laitevalmistus & Konepaja. Simulaation fysiikka: koneiden käyttöaste ja Little's Law -jonot, komponenttihankinnat ja teollisuusasiakkaiden maksuajat.",
    roles: [
      {
        id: "commercial",
        title: "🎯 Kaupallinen johtaja / Teollisuusmyynti",
        sub: "Fokuksesi on teollisuusasiakkaissa, puitesopimuksissa ja tarjouslaskennassa. CRO sparraa myyntiputkea.",
      },
      {
        id: "product",
        title: "⚙️ Pääinsinööri / Tehtaanjohtaja",
        sub: "Fokuksesi on koneiden käyttöasteessa, läpimenoajoissa ja teknisessä laadussa. COO sparraa tuotannon pullonkauloja.",
      },
      {
        id: "general_manager",
        title: "📊 General Manager / CFO",
        sub: "Fokuksesi on koneinvestoinneissa (CapEx), velkavivussa ja kassanhallinnassa. CFO valvoo kiitotietä.",
      },
    ],
    capabilities: [
      {
        key: "production",
        icon: "⚙️",
        title: "Koneistus & Kokoonpano (Production Core)",
        sub: "Oma tehdas takaa täyden kapasiteetin kontrollin. Alihankintakoneistus säästää miljoonien koneinvestoinneilta.",
        inHouseLabel: "Omat koneet & tehdas",
        outsourceLabel: "Alihankintakoneistus",
      },
      {
        key: "warehouse",
        icon: "🔬",
        title: "R&D & Tekninen suunnittelu",
        sub: "Oma insinööritiimi tuottaa proprietary-patentteja ja CAD-malleja. Ulkoinen suunnittelutoimisto joustaa tuotekehityssykleissä.",
        inHouseLabel: "Oma insinööritiimi",
        outsourceLabel: "Insinööritoimisto",
      },
      {
        key: "logistics",
        icon: "🔧",
        title: "Asennus, Käyttöönotto & Kenttähuolto",
        sub: "Oma huoltoverkosto tuo korkeakatteisia jatkuvia huoltosopimuksia. Paikalliset huoltopartnerit kattavat kentän keveästi.",
        inHouseLabel: "Oma kenttähuolto",
        outsourceLabel: "Huoltopartnerit",
      },
    ],
    economics: {
      itemLabel: "PÄÄTUOTE",
      itemSub: "Valmistettu kone/laite",
      priceLabel: "ULOSMYYNTIHINTA",
      priceSub: "Arvioitu yksikkökustannus",
      marginLabel: "BRUTTOKATE",
      marginSub: "Teollinen valmistuskate",
    },
    ignitionText:
      "Toimintamalli on nyt viritetty. Kun painat käynnistysnappia, Engine A käynnistää Päivän 1, tehtaan ja kokoonpanon valot syttyvät ja johtoryhmäsi (Pääinsinööri, COO, CFO) astuu esiin ensimmäiseen strategiaväittelyyn.",
  },
  PERISHABLE_COLD_CHAIN: {
    physicsExplanation:
      "Tuoretuotanto & Kylmäketju. Simulaation fysiikka: tuotteiden säilyvyysaika, hävikkikäyrät (spoilage) ja aamutuoreuden toimitusnopeus.",
    roles: [
      {
        id: "commercial",
        title: "🎯 Kaupallinen johtaja / Myynti",
        sub: "Fokuksesi on B2B-kahviloissa, ravintoloissa ja tilauskanavissa. CRO toimii läheisenä sparraajanasi.",
      },
      {
        id: "product",
        title: "🛠 Chief Product Officer / Mestari",
        sub: "Fokuksesi on laadussa, tuotantoprosessissa ja reseptissä. COO sparraa tuotannon pullonkauloja.",
      },
      {
        id: "general_manager",
        title: "📊 General Manager / Strategi",
        sub: "Fokuksesi on pääoman allokoinnissa, tiimin rakentamisessa ja kassanhallinnassa. CFO valvoo kiitotietä.",
      },
    ],
    capabilities: [
      {
        key: "production",
        icon: "🥐",
        title: "Ensisijainen valmistus / Paisto / Viljely",
        sub: "Oma tila takaa täyden kontrollin tuoreuteen ja reseptiin. Co-Packer tarjoaa valmiin elintarvikehyväksytyn tilan.",
        inHouseLabel: "Oma tila / leipomo",
        outsourceLabel: "Co-Packer",
      },
      {
        key: "warehouse",
        icon: "❄️",
        title: "Varastointi & Kylmäkeräily",
        sub: "Oma kylmävarasto takaa täyden laadunvalvonnan. 3PL-kylmäketju kantaa kylmätilojen kiinteän vuokrariskin.",
        inHouseLabel: "Oma kylmävarasto",
        outsourceLabel: "3PL-partneri",
      },
      {
        key: "logistics",
        icon: "🚚",
        title: "Jakelu & Viimeinen maili",
        sub: "Oma jakeluauto varmistaa aamutuoreuden asiakkaan ovelle. Ulkoinen kuriiri skaalautuu ilman omaa autokalustoa.",
        inHouseLabel: "Oma kalusto",
        outsourceLabel: "Ulkoinen rahti",
      },
    ],
    economics: {
      itemLabel: "PÄÄTUOTE",
      itemSub: "Tuore-erä / Valmistuserä",
      priceLabel: "ULOSMYYNTIHINTA",
      priceSub: "Arvioitu yksikkökustannus",
      marginLabel: "BRUTTOKATE",
      marginSub: "Tuoretuotteen kate",
    },
    ignitionText:
      "Toimintamalli on nyt viritetty. Kun painat käynnistysnappia, Engine A käynnistää Päivän 1, keittiön ja uunien valot syttyvät ja johtoryhmäsi (COO, CFO, CRO, CHRO) astuu esiin ensimmäiseen strategiaväittelyyn.",
  },
};

export function renderGenesisCanvas(props: GenesisStudioProps): string {
  const { state } = props;
  const founderRole = props.founderRole ?? "commercial";
  const caps = props.capabilities ?? {
    production: "in_house",
    warehouse: "in_house",
    logistics: "outsource",
    qa: "in_house",
  };

  const archetype = state.company.archetype ?? "ASSET_HEAVY_MANUFACTURING";
  const spec = ARCHETYPE_BASELINES[archetype];
  const fallbackConfig =
    ARCHETYPE_CANVAS_CONFIGS[archetype] ?? ARCHETYPE_CANVAS_CONFIGS.ASSET_HEAVY_MANUFACTURING;
  const domainUi = state.company.domainUi;
  const archConfig: ArchetypeCanvasConfig = domainUi
    ? {
        physicsExplanation: domainUi.physicsExplanation,
        roles: domainUi.canvasConfig.roles,
        capabilities: domainUi.canvasConfig.capabilities,
        economics: domainUi.canvasConfig.economics,
        ignitionText: domainUi.canvasConfig.ignitionText,
      }
    : fallbackConfig;
  const industryBadgeLabel =
    domainUi?.industryLabel ||
    state.company.industry ||
    ARCHETYPE_FRIENDLY_NAMES[archetype] ||
    archetype;

  const mainOff = state.commercial.offerings[0];
  const offState = state.commercial.offeringStates[0];
  const unitCostCents = mainOff ? Math.max(100, unitBookCost(state, mainOff.itemId)) : 45_00;
  const listPriceCents =
    offState?.lastPrice ||
    (mainOff
      ? mainOff.pricing.kind === "value_based"
        ? mainOff.pricing.listPrice
        : mainOff.pricing.kind === "subscription"
          ? mainOff.pricing.monthlyPrice
          : 95_00
      : 95_00);
  const grossMargin = listPriceCents > 0 ? (listPriceCents - unitCostCents) / listPriceCents : 0.52;

  // Monthly burn calculation
  const monthlyPayroll = state.org.positions.reduce((sum, pos) => {
    const role = state.org.roles.find((r) => r.id === pos.roleId);
    if (!role) return sum;
    const hc = pos.cohorts.reduce((s, c) => s + c.count, 0);
    return sum + Math.round((hc * role.annualSalary * (1 + role.benefitsLoad)) / 12);
  }, 0);
  const monthlyRent = state.warehouses.sites.reduce((sum, w) => sum + w.rentPerDay * 30, 0);
  const monthlyFixedBurn = monthlyPayroll + monthlyRent;
  const maskedCfg = props.llmConfig ?? getMaskedLlmConfig();
  const senseCheck = buildPreFlightSenseCheck(state);
  const verdictBadgeClass =
    senseCheck.verdictLevel === "strong"
      ? "tag-green"
      : senseCheck.verdictLevel === "caution"
        ? "tag-amber"
        : "tag-red";

  return `
    <div class="genesis-shell">
      <!-- TOP NAVIGATION -->
      <header class="genesis-topbar">
        <div class="brand-cluster">
          <div class="apex-logo">▲ APEX</div>
          <div>
            <div class="company-title-row">
              <span class="genesis-title">BUSINESS IDEA CANVAS &amp; SENSE CHECK</span>
              <span class="tag tag-cyan mono">VAIHE 1 • TOIMINTAMALLIN TARKISTUS &amp; RISKIANALYYSI</span>
            </div>
            <p class="sub">Tarkista liikeidean kannattavuus, riskit ja alkupääoma ennen kuin simulaatio käynnistyy.</p>
          </div>
        </div>
        <div class="topbar-actions" style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
          <button type="button" class="btn btn-xs btn-secondary" id="btn-back-to-spark">
            ← Muuta ideaa / alkupääomaa
          </button>
          <button type="button" class="btn btn-sm btn-primary" id="btn-launch-mission-control-top" style="font-weight:700;box-shadow:0 0 14px rgba(56,189,248,0.4)">
            🚀 Käynnistä simulaatio (Päivä 1) →
          </button>
          ${renderApiTelemetryPillHtml(maskedCfg)}
        </div>
      </header>

      <!-- CANVAS BODY -->
      <main class="canvas-main-container">
        <!-- STEP BREADCRUMBS -->
        <div class="canvas-breadcrumbs">
          <span class="breadcrumb-step done">✓ 1. Liikeidea &amp; Alkupääoma</span>
          <span class="breadcrumb-arrow">→</span>
          <span class="breadcrumb-step active">2. Rooli &amp; Kyvykkyydet</span>
          <span class="breadcrumb-arrow">→</span>
          <span class="breadcrumb-step active">3. Sense Check &amp; Riskianalyysi</span>
          <span class="breadcrumb-arrow">→</span>
          <span class="breadcrumb-step">4. Päivittäinen Johtaminen</span>
        </div>

        <!-- ACTION READY BANNER -->
        <div style="margin-bottom:12px;padding:10px 14px;background:rgba(14,116,144,0.18);border:1px solid #0284c7;border-radius:8px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px">
          <div style="font-size:12.5px;color:#e0f2fe">
            💡 <strong>Toimintamalli ja Sense Check on valmis!</strong> Tarkista luvut ja valitse perustajan roolisi alta. Kun olet valmis, käynnistä simulaatio suoraan ylä- tai alapainikkeesta.
          </div>
          <button type="button" class="btn btn-xs btn-primary" id="btn-launch-mission-control-banner" style="font-weight:700">
            🚀 Käynnistä simulaatio →
          </button>
        </div>

        <div class="canvas-grid">
          <!-- CARD 1: YRITYKSEN IDENTITEETTI JA TOIMINTAMALLI -->
          <div class="canvas-card">
            <div class="canvas-card-header">
              <span class="tag tag-blue mono">1. IDENTITEETTI &amp; TOIMINTALOGIIKKA</span>
              <h3>${escapeHtml(state.company.name)}</h3>
            </div>
            <p class="canvas-tagline">${escapeHtml(state.company.tagline)}</p>
            ${
              state.company.commercialModelNotes
                ? `<div style="margin:6px 0;padding:6px 9px;background:#0f172a;border-left:3px solid #10b981;border-radius:4px;font-size:11.5px;color:#cbd5e1">
                    <strong>Oma kaupallinen mallisi:</strong> ${escapeHtml(state.company.commercialModelNotes)}
                  </div>`
                : ""
            }

            <div class="archetype-info-box">
              <div class="archetype-badge-row">
                <strong class="text-cyan">${escapeHtml(industryBadgeLabel)}</strong>
                <span class="tag tag-green">Tavoitekate ${(spec.grossMarginBand[0] * 100).toFixed(0)}–${(spec.grossMarginBand[1] * 100).toFixed(0)}%</span>
              </div>
              <p class="sub" style="margin-top:6px; line-height: 1.45;">
                ${escapeHtml(archConfig.physicsExplanation)}
              </p>
            </div>
          </div>

          <!-- CARD 2: PERUSTAJAN ROOLI JA TIIMI (WHAT DO YOU DO YOURSELF?) -->
          <div class="canvas-card">
            <div class="canvas-card-header">
              <span class="tag tag-cyan mono">2. PERUSTAJAN PÄÄROOLI</span>
              <h3>Mitä teet itse yrityksessä?</h3>
            </div>
            <p class="sub">Ennen kuin voi johtaa, pitää tietää missä oma aika ja fokus kuluu:</p>

            <div class="role-selector-grid">
              <!-- SOLO FOUNDER -->
              <label class="role-card ${founderRole === "solo_founder" ? "selected" : ""}">
                <input type="radio" name="founder_role" value="solo_founder" ${founderRole === "solo_founder" ? "checked" : ""} />
                <div class="role-card-body">
                  <strong>👑 Yksinyrittäjä / Kaikkiruokainen perustaja (Hoidat aluksi kaiken itse)</strong>
                  <span class="sub">Myyt, valmistat ja hoidat ostot itse. Voit palkata apukäsiä ja vastaavia yrityksen kasvaessa.</span>
                </div>
              </label>

              <!-- DOMAIN / ARCHETYPE ROLES -->
              ${archConfig.roles.map((r) => `
                <label class="role-card ${founderRole === r.id ? "selected" : ""}">
                  <input type="radio" name="founder_role" value="${r.id}" ${founderRole === r.id ? "checked" : ""} />
                  <div class="role-card-body">
                    <strong>${escapeHtml(r.title)}</strong>
                    <span class="sub">${escapeHtml(r.sub)}</span>
                  </div>
                </label>
              `).join("")}

              <!-- CUSTOM ROLE WRITE-IN -->
              <label class="role-card ${founderRole === "custom" ? "selected" : ""}">
                <input type="radio" name="founder_role" value="custom" ${founderRole === "custom" ? "checked" : ""} />
                <div class="role-card-body" style="width: 100%;">
                  <strong>✍️ Muu, mikä? (Määrittele oma roolisi)</strong>
                  <span class="sub">Kirjoita vapaasti oma roolisi ja fokuksesi yrityksessä:</span>
                  <input
                    type="text"
                    id="custom-founder-role-input"
                    class="custom-role-input"
                    placeholder="Esim. Grilliyrittäjä, Jäätelökauppias, Pääsuunnittelija..."
                    value="${escapeHtml(props.customFounderRole || "")}"
                  />
                </div>
              </label>
            </div>
          </div>

          <!-- CARD 3: CAPABILITY DESIGN (INSOURCE VS OUTSOURCE) -->
          <div class="canvas-card">
            <div class="canvas-card-header">
              <span class="tag tag-amber mono">3. KYVYKKYYDET: OMA VAI ALIHANKINTA?</span>
              <h3>Mitä teet itse vs. ostat kumppanilta?</h3>
            </div>
            <p class="sub">Kaikkea ei tarvitse omistaa heti. Valitse mitkä toiminnot pystytetään itse:</p>

            <div class="capability-toggles-list">
              ${archConfig.capabilities.map((c) => {
                const currentMode = caps[c.key];
                return `
                  <div class="cap-toggle-item">
                    <div class="cap-info">
                      <strong>${c.icon} ${escapeHtml(c.title)}</strong>
                      <span class="sub">${escapeHtml(c.sub)}</span>
                    </div>
                    <div class="cap-switch-group">
                      <button type="button" class="btn btn-xs ${currentMode === "in_house" ? "btn-primary" : "btn-secondary"}" data-set-cap="${c.key}:in_house">
                        ${escapeHtml(c.inHouseLabel)}
                      </button>
                      <button type="button" class="btn btn-xs ${currentMode === "outsource" ? "btn-primary" : "btn-secondary"}" data-set-cap="${c.key}:outsource">
                        ${escapeHtml(c.outsourceLabel)}
                      </button>
                    </div>
                  </div>
                `;
              }).join("")}
            </div>
          </div>

          <!-- CARD 4: YKSIKKÖTALOUS & ALKUPÄÄOMA -->
          <div class="canvas-card">
            <div class="canvas-card-header">
              <span class="tag tag-green mono">4. YKSIKKÖTALOUS &amp; KIITOTIE</span>
              <h3>Tuotteen kate &amp; Alkukassa</h3>
            </div>
            <p class="sub">Perusmatematiikka: Voittaako yksittäisen myynnin kate päivittäiset kulut?</p>

            <div class="economics-summary-grid">
              <div class="econ-box">
                <label>${escapeHtml(archConfig.economics.itemLabel)}</label>
                <strong>${escapeHtml(mainOff?.name || "Päätuote")}</strong>
                <span class="sub">${escapeHtml(archConfig.economics.itemSub)}</span>
              </div>

              <div class="econ-box">
                <label>${escapeHtml(archConfig.economics.priceLabel)}</label>
                <strong class="text-cyan">${senseCheck.unitPriceEuros.toLocaleString("fi-FI")} € / ${escapeHtml(senseCheck.uomLabel)}</strong>
                <span class="sub">Yksikkökustannus: ${senseCheck.unitCostEuros.toLocaleString("fi-FI")} € (Kate +${senseCheck.unitContributionEuros.toLocaleString("fi-FI")} €)</span>
              </div>

              <div class="econ-box">
                <label>${escapeHtml(archConfig.economics.marginLabel)}</label>
                <strong class="${grossMargin >= 0.4 ? "text-green" : "text-amber"}">${fmtPct(grossMargin)}</strong>
                <span class="sub">${escapeHtml(archConfig.economics.marginSub)} • Kannattavuusraja: ${senseCheck.breakEvenUnitsPerDay} ${escapeHtml(senseCheck.uomLabel)}/pv</span>
              </div>

              <div class="econ-box">
                <label>VALITTU ALKUPÄÄOMA &amp; KASSA</label>
                <strong class="text-green">${fmtCurrency(senseCheck.initialCapitalEuros * 100)}</strong>
                <span class="sub">Kiinteä kulu n. ${senseCheck.dailyFixedCostEuros} €/pv (${senseCheck.monthlyFixedCostEuros.toLocaleString("fi-FI")} €/kk) • Kiitotie ~${senseCheck.estimatedRunwayMonths} kk</span>
              </div>
            </div>
          </div>
        </div>

        <!-- SHIELD CARD: APEX PRE-FLIGHT SENSE CHECK & RISKIANALYYSI -->
        <section class="canvas-card" style="margin-top:16px;border:1.5px solid ${senseCheck.verdictLevel === "strong" ? "#10b981" : senseCheck.verdictLevel === "caution" ? "#f59e0b" : "#ef4444"};background:linear-gradient(180deg, rgba(15,23,42,0.96), rgba(2,6,23,0.98))">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:10px">
            <div>
              <span class="tag ${verdictBadgeClass} mono">🛡️ APEX SENSE CHECK &amp; RISKIANALYYSI ENNEN SIMULAATIOTA</span>
              <h3 style="margin-top:4px;font-size:17px">${escapeHtml(senseCheck.verdictTitleFi)}</h3>
            </div>
            <div style="display:flex;gap:8px;align-items:center">
              <span class="tag tag-cyan mono">Kannattavuusraja: ${senseCheck.breakEvenUnitsPerDay} ${escapeHtml(senseCheck.uomLabel)}/pv</span>
              <span class="tag ${senseCheck.safetyMarginUnitsPerDay >= 0 ? "tag-green" : "tag-red"} mono">
                Arvioitu alkukysyntä: ~${senseCheck.estimatedDailyDemandUnits} ${escapeHtml(senseCheck.uomLabel)}/pv
              </span>
            </div>
          </div>

          <p style="font-size:13.5px;color:#e2e8f0;line-height:1.55;padding:10px 12px;background:#0f172a;border:1px solid #1e293b;border-radius:8px;margin-bottom:14px">
            📊 <strong>Laskelma selkokielellä:</strong> ${escapeHtml(senseCheck.executiveSummaryFi)}
          </p>

          <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
            <!-- LEFT: TOP 3 RISKS -->
            <div style="padding:10px 12px;background:#090d16;border:1px solid #1e293b;border-radius:8px">
              <strong style="display:block;font-size:12px;color:#f59e0b;margin-bottom:8px">
                ⚠️ TUNNISTETUT LIIKETOIMINTARISKIT (3 KPL)
              </strong>
              <div style="display:flex;flex-direction:column;gap:8px">
                ${senseCheck.risks
                  .map(
                    (r) => `
                  <div style="padding:7px 9px;background:#0f172a;border-left:3px solid ${r.severity === "critical" ? "#ef4444" : r.severity === "warning" ? "#f59e0b" : "#38bdf8"};border-radius:4px">
                    <div style="font-size:12px;font-weight:700;color:#f8fafc">${escapeHtml(r.titleFi)}</div>
                    <div class="sub" style="font-size:11.5px;margin-top:2px">${escapeHtml(r.descriptionFi)}</div>
                  </div>`,
                  )
                  .join("")}
              </div>
            </div>

            <!-- RIGHT: 1-CLICK SUGGESTIONS BEFORE LAUNCH -->
            <div style="padding:10px 12px;background:#090d16;border:1px solid #1e293b;border-radius:8px">
              <strong style="display:block;font-size:12px;color:#38bdf8;margin-bottom:8px">
                💡 APEXIN KEHITYSEHDOTUKSET (KLIKKAA SOVELTAAKSESI ENNEN ALOITUSTA)
              </strong>
              <div style="display:flex;flex-direction:column;gap:8px">
                ${senseCheck.suggestions
                  .map(
                    (s) => `
                  <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding:7px 9px;background:#0f172a;border:1px solid #1e293b;border-radius:6px">
                    <div>
                      <div style="font-size:12px;font-weight:700;color:#e2e8f0">${escapeHtml(s.labelFi)}</div>
                      <div class="sub" style="font-size:11px">${escapeHtml(s.impactFi)}</div>
                    </div>
                    <button
                      type="button"
                      class="btn btn-xs btn-secondary"
                      data-sensecheck-suggest='${JSON.stringify({
                        assumptionKey: s.assumptionKey,
                        multiplier: s.multiplier,
                        addCapitalEuros: s.addCapitalEuros,
                      })}'
                      style="white-space:nowrap"
                    >
                      ✨ Sovella
                    </button>
                  </div>`,
                  )
                  .join("")}
              </div>
            </div>
          </div>
        </section>

        <!-- IGNITION FOOTER (EXPLICIT GO / NO-GO CONFIRMATION) - STICKY AT BOTTOM -->
        <div class="canvas-ignition-footer" style="margin-top:16px;position:sticky;bottom:12px;z-index:99;background:rgba(15,23,42,0.96);padding:14px 18px;border:1px solid #38bdf8;border-radius:10px;box-shadow:0 8px 30px rgba(0,0,0,0.75);backdrop-filter:blur(8px)">
          <div class="ignition-text">
            <h4>Haluatko todella simuloida tätä yritystä näillä lähtötiedoilla?</h4>
            <p class="sub">
              ${escapeHtml(archConfig.ignitionText)}
            </p>
          </div>
          <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
            <button type="button" class="btn btn-secondary" id="btn-back-to-spark-bottom">
              ← Muokkaa ideaa / pääomaa
            </button>
            <button type="button" class="btn btn-primary btn-lg btn-ignition" id="btn-launch-mission-control">
              🚀 KYLLÄ, KÄYNNISTÄ SIMULAATIO →
            </button>
          </div>
        </div>
      </main>
    </div>
  `;
}
