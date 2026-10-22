/**
 * Module 1: Archetype-Bounded Dynamic Business DNA Compiler (Zero-to-Ontology).
 *
 * Translates *any* free-text business concept prompt into a mathematically valid,
 * ledger-balanced `WorldState` (Target Operating Model) before Tick 1 begins.
 *
 * Strictly anchors compilation to 5 explicit baseline industry archetypes:
 *  - `ASSET_HEAVY_MANUFACTURING`
 *  - `PERISHABLE_COLD_CHAIN`
 *  - `HIGH_VELOCITY_D2C`
 *  - `B2B_ENTERPRISE_SERVICES`
 *  - `PLATFORM_RECURRING`
 *
 * Enforces hard economic sanity bounds on every compiled state:
 *  - Gross Margins bounded within `[0.20, 0.80]` (20%–80%).
 *  - Operating Cash Reserve floor ($\ge 30$ days of baseline operating burn and archetype floor).
 *  - Archetype-typical DSO and DPO payment term bands.
 */
import { debitBalance, postJournal, verifyAccountingInvariants } from "../engine/ledger";
import { resolveOfferingPrice } from "../engine/market";
import { nextId, pushNotification } from "../engine/modifiers";
import { clamp } from "../engine/rng";
import { unitBookCost } from "../engine/warehouse";
import {
  type Cents,
  type DomainUiConfig,
  type EvolutionStageSpec,
  type IndustryArchetype,
  WorldState,
} from "../schema";
import {
  buildColdChainLogisticsScenario,
  buildCustomEbikeScenario,
  buildVerticalFarmScenario,
  initializeOpeningBalanceSheet,
  SCENARIO_PRESETS,
  type ScenarioPresetId,
} from "./presets";
import { buildDefaultMarketIntelligence } from "../llm/market-research";

export interface ArchetypeBaselineSpec {
  archetype: IndustryArchetype;
  label: string;
  /** Global sanity bound is [0.20, 0.80]; archetype target band sits within [0.20, 0.80]. */
  grossMarginBand: readonly [number, number];
  /** Minimum opening operating cash reserve in integer cents. */
  minOperatingCashCents: Cents;
  /** Minimum cash reserve expressed in days of fixed payroll/rent OpEx. */
  minRunwayReserveDays: number;
  /** Typical customer payment terms (DSO) band in days. */
  dsoBandDays: readonly [number, number];
  /** Typical supplier payment terms (DPO) band in days. */
  dpoBandDays: readonly [number, number];
}

export const GLOBAL_GROSS_MARGIN_MIN = 0.2;
export const GLOBAL_GROSS_MARGIN_MAX = 0.8;

export const ARCHETYPE_BASELINES: Record<IndustryArchetype, ArchetypeBaselineSpec> = {
  ASSET_HEAVY_MANUFACTURING: {
    archetype: "ASSET_HEAVY_MANUFACTURING",
    label: "Asset-Heavy Precision Manufacturing",
    grossMarginBand: [0.25, 0.65],
    minOperatingCashCents: 250_000_00,
    minRunwayReserveDays: 35,
    dsoBandDays: [0, 60],
    dpoBandDays: [15, 60],
  },
  PERISHABLE_COLD_CHAIN: {
    archetype: "PERISHABLE_COLD_CHAIN",
    label: "Perishable Cold-Chain & Controlled-Environment Production",
    grossMarginBand: [0.25, 0.72],
    minOperatingCashCents: 220_000_00,
    minRunwayReserveDays: 30,
    dsoBandDays: [0, 45],
    dpoBandDays: [14, 45],
  },
  HIGH_VELOCITY_D2C: {
    archetype: "HIGH_VELOCITY_D2C",
    label: "High-Velocity Omnichannel D2C Brand",
    grossMarginBand: [0.35, 0.78],
    minOperatingCashCents: 200_000_00,
    minRunwayReserveDays: 30,
    dsoBandDays: [0, 30],
    dpoBandDays: [15, 45],
  },
  B2B_ENTERPRISE_SERVICES: {
    archetype: "B2B_ENTERPRISE_SERVICES",
    label: "B2B Enterprise Services & Contract Fleet",
    grossMarginBand: [0.3, 0.78],
    minOperatingCashCents: 250_000_00,
    minRunwayReserveDays: 35,
    dsoBandDays: [15, 75],
    dpoBandDays: [15, 60],
  },
  PLATFORM_RECURRING: {
    archetype: "PLATFORM_RECURRING",
    label: "Recurring Subscription & Platform Ecosystem",
    grossMarginBand: [0.45, 0.8],
    minOperatingCashCents: 220_000_00,
    minRunwayReserveDays: 35,
    dsoBandDays: [0, 45],
    dpoBandDays: [15, 45],
  },
};

export interface CompilerOptions {
  seed?: number;
  presetId?: ScenarioPresetId;
  archetype?: IndustryArchetype;
  /** User-specified starting capital in Euros (e.g. 5000, 10000, 50000). */
  initialCapitalEuros?: number;
  /** User's own notes or pricing/commercial model thoughts (e.g. "Annos 6 €, raaka-aineet 1,50 €"). */
  commercialModelNotes?: string;
  /** If true, invokes Gemini when GEMINI_API_KEY is configured and llmGenerator is not supplied. */
  useLiveLlm?: boolean;
  /** Optional async LLM generator returning a partial or full TOM override. */
  llmGenerator?: (prompt: string) => Promise<Partial<WorldState>>;
}

/** Suggest a realistic starting capital in Euros for a business prompt when the user hasn't typed one yet. */
export function suggestInitialCapitalEuros(prompt: string): number {
  const lower = (prompt || "").toLowerCase();
  if (
    lower.includes("kioski") ||
    lower.includes("kiosk") ||
    lower.includes("nakkikiska") ||
    lower.includes("grilli") ||
    lower.includes("jäätelö") ||
    lower.includes("kahvila") ||
    lower.includes("kukk") ||
    lower.includes("parturi") ||
    lower.includes("freelanc") ||
    lower.includes("toiminimi") ||
    lower.includes("yksinyrittäjä") ||
    lower.includes("konsult")
  ) {
    return 10_000;
  }
  if (
    lower.includes("leipomo") ||
    lower.includes("ravintola") ||
    lower.includes("verkkokauppa") ||
    lower.includes("d2c") ||
    lower.includes("saas") ||
    lower.includes("sovellus")
  ) {
    return 25_000;
  }
  if (
    lower.includes("tehdas") ||
    lower.includes("factory") ||
    lower.includes("laivasto") ||
    lower.includes("fleet") ||
    lower.includes("mansikkatila") ||
    lower.includes("vertical farm")
  ) {
    return 150_000;
  }
  return 15_000;
}

export function computeSensibleMoq(unitCostCents: number): number {
  if (unitCostCents <= 3_00) return 100;
  if (unitCostCents <= 15_00) return 30;
  if (unitCostCents <= 50_00) return 15;
  return 5;
}

/** Deterministic string hash -> signed 32-bit integer seed. */
export function hashPromptToSeed(prompt: string): number {
  let h = 2166136261;
  for (let i = 0; i < prompt.length; i++) {
    h ^= prompt.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h | 0 || 20261016;
}

/**
 * Map any free-text business concept prompt to one of the 5 canonical `IndustryArchetype` baselines.
 */
export function classifyPromptArchetype(prompt: string): IndustryArchetype {
  const lower = prompt.toLowerCase();

  if (
    lower.includes("saas") ||
    lower.includes("platform") ||
    lower.includes("recurring") ||
    lower.includes("subscription software") ||
    lower.includes("cloud") ||
    lower.includes("marketplace") ||
    lower.includes("ohjelmistoalusta") ||
    lower.includes("pilvipalvelu") ||
    lower.includes("kuukausitilaus") ||
    lower.includes("tilauspalvelu")
  ) {
    return "PLATFORM_RECURRING";
  }

  if (
    lower.includes("strawberry") ||
    lower.includes("vertical farm") ||
    lower.includes("hydroponic") ||
    lower.includes("greenhouse") ||
    lower.includes("perishable") ||
    lower.includes("food") ||
    lower.includes("coffee") ||
    lower.includes("bakery") ||
    lower.includes("brewery") ||
    lower.includes("dairy") ||
    lower.includes("fresh") ||
    lower.includes("meal") ||
    lower.includes("leipomo") ||
    lower.includes("kahvila") ||
    lower.includes("ravintola") ||
    lower.includes("ruoka") ||
    lower.includes("panimo") ||
    lower.includes("mansikka") ||
    lower.includes("kasvihuone") ||
    lower.includes("tuoretuote") ||
    lower.includes("jäätelö") ||
    lower.includes("ice cream") ||
    lower.includes("gelato") ||
    lower.includes("kioski") ||
    lower.includes("kiosk") ||
    lower.includes("nakkikiska") ||
    lower.includes("grilli") ||
    lower.includes("snägäri") ||
    lower.includes("pikaruoka") ||
    lower.includes("street food") ||
    lower.includes("burger") ||
    lower.includes("hodari") ||
    lower.includes("torikauppa") ||
    lower.includes("torimyynti") ||
    lower.includes("kukk") ||
    lower.includes("flower") ||
    lower.includes("florist") ||
    lower.includes("limonad") ||
    lower.includes("sitruuna") ||
    lower.includes("limsa") ||
    lower.includes("mehu") ||
    lower.includes("juoma") ||
    lower.includes("smoothie") ||
    lower.includes("koju") ||
    lower.includes("myyntipöytä")
  ) {
    return "PERISHABLE_COLD_CHAIN";
  }

  if (
    lower.includes("apparel") ||
    lower.includes("cosmetics") ||
    lower.includes("skin") ||
    lower.includes("vaate") ||
    lower.includes("kosmetiikka") ||
    lower.includes("kuluttajatuote") ||
    lower.includes("verkkokauppa") ||
    lower.includes("e-commerce") ||
    lower.includes("ecommerce") ||
    lower.includes("d2c") ||
    lower.includes("direct-to-consumer")
  ) {
    return "HIGH_VELOCITY_D2C";
  }

  if (
    lower.includes("cold-chain") ||
    lower.includes("cold chain") ||
    lower.includes("pharma") ||
    lower.includes("logistics") ||
    lower.includes("fleet") ||
    lower.includes("biologics") ||
    lower.includes("consulting") ||
    lower.includes("agency") ||
    lower.includes("clinic") ||
    lower.includes("hospitality") ||
    lower.includes("b2b") ||
    lower.includes("enterprise service") ||
    lower.includes("osaami") || // catches osaaminen, osaamistani, osaamiseni, osaamisen
    lower.includes("asiantuntija") ||
    lower.includes("konsult") || // catches konsultti, konsultointi, konsulttitoimisto
    lower.includes("neuvonanto") ||
    lower.includes("valmennus") ||
    lower.includes("koulutus") ||
    lower.includes("lakimies") ||
    lower.includes("asianajo") ||
    lower.includes("lakiasiain") ||
    lower.includes("tilitoimisto") ||
    lower.includes("tilintarkastus") ||
    lower.includes("arkkiteht") ||
    lower.includes("advisory") ||
    lower.includes("professional service") ||
    lower.includes("freelanc") ||
    lower.includes("ohjelmistopalvelu") ||
    lower.includes("digitoimisto") ||
    lower.includes("suunnittelutoimisto") ||
    lower.includes("palveluliiketoiminta") ||
    lower.includes("rekrytointi") ||
    lower.includes("henkilöstö") ||
    lower.includes("trimmaamo") ||
    lower.includes("lemmikki") ||
    lower.includes("koira") ||
    lower.includes("kissa") ||
    lower.includes("kuntosali") ||
    lower.includes("fitness") ||
    lower.includes("gym") ||
    lower.includes("jooga") ||
    lower.includes("parturi") ||
    lower.includes("kampaamo") ||
    lower.includes("kauneus") ||
    lower.includes("hieronta") ||
    lower.includes("fysio") ||
    lower.includes("terapia") ||
    lower.includes("korjaamo") ||
    lower.includes("autohuolto") ||
    lower.includes("huolto") ||
    lower.includes("pesula") ||
    lower.includes("siivous") ||
    lower.includes("lvi") ||
    lower.includes("putki") ||
    lower.includes("sähkö") ||
    lower.includes("remontti") ||
    lower.includes("maalaus") ||
    lower.includes("valokuvaus") ||
    lower.includes("studio") ||
    lower.includes("tatuointi")
  ) {
    return "B2B_ENTERPRISE_SERVICES";
  }

  if (
    lower.includes("saas") ||
    lower.includes("software") ||
    lower.includes("ohjelmisto") ||
    lower.includes("alusta") ||
    lower.includes("platform") ||
    lower.includes("app") ||
    lower.includes("sovellus") ||
    lower.includes("portaali") ||
    lower.includes("tilaus") ||
    lower.includes("subscription") ||
    lower.includes("marketplace") ||
    lower.includes("pilvi") ||
    lower.includes("cloud")
  ) {
    return "PLATFORM_RECURRING";
  }

  if (
    lower.includes("bicycle") ||
    lower.includes("e-bike") ||
    lower.includes("ebike") ||
    lower.includes("titanium") ||
    lower.includes("industrial") ||
    lower.includes("equipment") ||
    lower.includes("machining") ||
    lower.includes("cnc") ||
    lower.includes("robotics") ||
    lower.includes("drone") ||
    lower.includes("solar") ||
    lower.includes("manufacturing") ||
    lower.includes("factory") ||
    lower.includes("tehdas") ||
    lower.includes("koneistus") ||
    lower.includes("valmistus") ||
    lower.includes("konepaja") ||
    lower.includes("laite")
  ) {
    return "ASSET_HEAVY_MANUFACTURING";
  }

  // Agnostic fallback: if prompt mentions goods/sales/products -> HIGH_VELOCITY_D2C, else B2B_ENTERPRISE_SERVICES
  const hasPhysicalGoodsHint =
    lower.includes("tuote") ||
    lower.includes("tavara") ||
    lower.includes("kauppa") ||
    lower.includes("myy") ||
    lower.includes("paketti") ||
    lower.includes("kpl") ||
    lower.includes("esine");
  return hasPhysicalGoodsHint ? "HIGH_VELOCITY_D2C" : "B2B_ENTERPRISE_SERVICES";
}

/**
 * Enforce archetype validation sanity bounds on a compiled `WorldState`:
 *  1. Gross Margins across all offerings bounded within `[0.20, 0.80]` (20%–80%).
 *  2. Operating Cash Reserve meets both the archetype floor and >= 30 days of fixed payroll/rent OpEx.
 *  3. Customer segment DSO (`creditDays`) and Supplier DPO (`paymentTermsDays`) clamped to archetype bands.
 *  4. Re-initializes the opening balance sheet so `Assets === Liabilities + Equity` holds exactly.
 */
export function enforceArchetypeSanityBounds(
  state: WorldState,
  explicitArchetype?: IndustryArchetype,
): WorldState {
  const archetype =
    explicitArchetype ??
    state.company.archetype ??
    classifyPromptArchetype(state.company.prompt || state.company.industry);
  const spec = ARCHETYPE_BASELINES[archetype];
  state.company.archetype = archetype;

  const minGm = Math.max(GLOBAL_GROSS_MARGIN_MIN, spec.grossMarginBand[0]);
  const maxGm = Math.min(GLOBAL_GROSS_MARGIN_MAX, spec.grossMarginBand[1]);

  // 1. Enforce Gross Margin sanity bounds [20%, 80%] (and archetype sub-band) on every offering
  for (const off of state.commercial.offerings) {
    const ch = state.commercial.channels.find((c) => c.id === off.channelId);
    const whId = ch?.fulfillmentWarehouseId;
    const unitCostCents = Math.max(10, unitBookCost(state, off.itemId, whId));
    const { netUnitPrice } = resolveOfferingPrice(state, off);

    // Gross Margin GM = (P - C) / P  =>  P = C / (1 - GM)
    const currentGm =
      netUnitPrice > 0 ? (netUnitPrice - unitCostCents) / netUnitPrice : 0;

    if (currentGm < GLOBAL_GROSS_MARGIN_MIN || currentGm > GLOBAL_GROSS_MARGIN_MAX) {
      const targetGm = clamp(currentGm, minGm, maxGm);
      const boundedNetPrice = Math.max(
        Math.ceil(unitCostCents / (1 - GLOBAL_GROSS_MARGIN_MIN)),
        Math.min(
          Math.floor(unitCostCents / (1 - GLOBAL_GROSS_MARGIN_MAX)),
          Math.round(unitCostCents / (1 - targetGm)),
        ),
      );
      const grossTargetPrice = Math.max(
        1,
        Math.round(boundedNetPrice / Math.max(0.1, 1 - off.discountPct)),
      );

      switch (off.pricing.kind) {
        case "value_based":
          off.pricing.listPrice = grossTargetPrice;
          break;
        case "cost_plus":
          off.pricing.markupPct = Math.max(
            0.25,
            (grossTargetPrice - unitCostCents) / unitCostCents,
          );
          break;
        case "dynamic_surge":
          off.pricing.basePrice = grossTargetPrice;
          break;
        case "tiered_volume":
          for (const t of off.pricing.tiers) {
            t.unitPrice = grossTargetPrice;
          }
          break;
        case "wholesale":
          off.pricing.msrp = Math.max(
            1,
            Math.round(
              grossTargetPrice / Math.max(0.2, 1 - off.pricing.distributorMarginPct),
            ),
          );
          break;
        case "subscription":
          off.pricing.monthlyPrice = Math.max(
            1,
            Math.round(grossTargetPrice * Math.max(1, off.pricing.unitsPerMonth)),
          );
          break;
        case "razor_blades":
          off.pricing.razorPrice = grossTargetPrice;
          break;
      }

      // Adjust segment WTP mean if price was clamped upward so demand remains well-calibrated
      const seg = state.market.segments.find((s) => s.id === off.segmentId);
      if (seg && seg.wtpMean < boundedNetPrice * 0.9) {
        seg.wtpMean = Math.round(boundedNetPrice * 1.12);
      }
    }
  }

  // 2. Enforce DSO / DPO bands on channels and suppliers
  for (const ch of state.commercial.channels) {
    if (ch.paymentTermsDays > 0 || spec.dsoBandDays[0] > 0) {
      ch.paymentTermsDays = Math.round(
        clamp(ch.paymentTermsDays, spec.dsoBandDays[0], spec.dsoBandDays[1]),
      );
    }
  }
  for (const sup of state.supply.suppliers) {
    if (sup.terms.kind === "net" && sup.terms.days > 0) {
      sup.terms.days = Math.round(
        clamp(sup.terms.days, spec.dpoBandDays[0], spec.dpoBandDays[1]),
      );
    }
    for (const off of sup.offers) {
      if (!off.moq || off.moq <= 1) {
        off.moq = computeSensibleMoq(off.unitPrice);
      }
    }
  }

  // 3. Enforce Operating Cash Reserve requirements OR User-Specified Starting Capital
  if (
    state.company.initialCapitalEuros !== undefined &&
    state.company.initialCapitalEuros > 0
  ) {
    return applyInitialCapitalAndCommercialModel(
      state,
      state.company.initialCapitalEuros,
      state.company.commercialModelNotes,
    );
  }

  const dailyPayrollCents = state.org.positions.reduce((sum, pos) => {
    const role = state.org.roles.find((r) => r.id === pos.roleId);
    if (!role) return sum;
    const hc = pos.cohorts.reduce((s, c) => s + c.count, 0);
    return sum + Math.round((hc * role.annualSalary * (1 + role.benefitsLoad)) / 360);
  }, 0);
  const dailyRentCents = state.warehouses.sites.reduce(
    (sum, w) => sum + w.rentPerDay,
    0,
  );
  const minReserveByBurn = (dailyPayrollCents + dailyRentCents) * spec.minRunwayReserveDays;
  const requiredCashFloor = Math.max(spec.minOperatingCashCents, minReserveByBurn);

  const currentCash =
    state.finance.periodStartCash ||
    state.finance.ledger.balances.cash ||
    spec.minOperatingCashCents;
  const boundedCash = Math.max(requiredCashFloor, currentCash);

  const initialized = initializeOpeningBalanceSheet(state, boundedCash);
  if (!initialized.company.marketIntelligence) {
    initialized.company.marketIntelligence = buildDefaultMarketIntelligence(initialized);
  }
  return initialized;
}

/**
 * Apply user-chosen starting capital (`initialCapitalEuros`) and commercial model notes
 * (`commercialModelNotes`) to `state`, scaling opening cash, fixed assets, debt facilities,
 * initial inventory lots, and solo-founder vs. team staffing so a 10 000 € kiosk starts with
 * 10 000 € cash and 1 founder (ready to hire roles as it scales).
 */
export function applyInitialCapitalAndCommercialModel(
  state: WorldState,
  initialCapitalEuros?: number,
  commercialModelNotes?: string,
): WorldState {
  if (initialCapitalEuros !== undefined && initialCapitalEuros > 0) {
    state.company.initialCapitalEuros = Math.round(initialCapitalEuros);
  }
  if (commercialModelNotes !== undefined) {
    state.company.commercialModelNotes = commercialModelNotes.trim();
  }

  // Parse explicit user commercial model notes for price or volume if present
  const notes = state.company.commercialModelNotes || "";
  if (notes.length > 0) {
    // Match e.g. "hinta 6 €" or "6,50 €" or "myyntihinta 12e"
    const priceMatch = notes.match(/(?:hinta|myyntihinta|annos|kpl|tuote)\s*(?:on\s*|n\.\s*)?(\d+(?:[.,]\d+)?)\s*(?:€|eur|e\b)/i) ??
      notes.match(/(\d+(?:[.,]\d+)?)\s*(?:€|eur)\s*\/\s*(?:annos|kpl|tuote|asiakas|kk|pv)/i);
    if (priceMatch?.[1]) {
      const parsedPriceEuros = Number(priceMatch[1].replace(",", "."));
      if (Number.isFinite(parsedPriceEuros) && parsedPriceEuros >= 1 && parsedPriceEuros <= 50_000) {
        const priceCents = Math.round(parsedPriceEuros * 100);
        const off0 = state.commercial.offerings[0];
        if (off0) {
          if (off0.pricing.kind === "value_based") off0.pricing.listPrice = priceCents;
          else if (off0.pricing.kind === "subscription") off0.pricing.monthlyPrice = priceCents;
        }
        if (state.commercial.offeringStates[0]) {
          state.commercial.offeringStates[0].lastPrice = priceCents;
        }
        if (state.market.segments[0] && state.market.segments[0].wtpMean < priceCents) {
          state.market.segments[0].wtpMean = Math.round(priceCents * 1.15);
        }
      }
    }

    // Match daily demand / customers e.g. "60 asiakasta päivässä" or "50 annosta/pv"
    const volMatch = notes.match(/(\d+)\s*(?:asiakasta|annosta|tilaus|tilausta|kpl|myyntiä)\s*(?:päivässä|\/\s*pv|pv)/i);
    if (volMatch?.[1]) {
      const parsedVol = Number(volMatch[1]);
      if (Number.isFinite(parsedVol) && parsedVol >= 2 && parsedVol <= 100_000) {
        if (state.market.segments[0]) {
          state.market.segments[0].baseDailyDemand = Math.max(5, Math.round(parsedVol * 2.2));
        }
      }
    }
  }

  const capEuros = state.company.initialCapitalEuros;
  if (capEuros !== undefined && capEuros > 0) {
    const openingCashCents = Math.max(500_00, Math.round(capEuros * 100));
    const isSoloMicro = capEuros <= 30_000;

    // For solo/micro capital (<= 30 000 €), start with 1 person (the founder) so the user starts
    // as a true solo entrepreneur and can hire employees/managers as revenue grows!
    if (isSoloMicro && state.org.positions.length > 0) {
      state.org.positions.forEach((pos, idx) => {
        if (idx === 0) {
          pos.cohorts = [{ count: 1, hiredTick: 0 }];
          pos.laborHoursAvailable = 10;
        } else {
          pos.cohorts = [];
          pos.laborHoursAvailable = 0;
        }
      });
      if (state.org.roles[0]) {
        state.org.roles[0].hoursPerDay = 10;
        state.org.roles[0].isDirectLabor = true;
        // Scale solo entrepreneur salary draw to fit starting capital
        if (capEuros <= 15_000) {
          state.org.roles[0].annualSalary = Math.min(state.org.roles[0].annualSalary, 24_000_00);
        }
      }
      // Ensure RACI processes are owned by role_0 while solo
      for (const proc of state.org.processes) {
        proc.accountableRoleId = state.org.roles[0]?.id ?? "role_0";
        proc.responsibleRoleIds = [state.org.roles[0]?.id ?? "role_0"];
      }
    }

    // Scale facility rent & marketing to be proportional if starting capital is small
    if (capEuros <= 15_000 && state.warehouses.sites[0]) {
      state.warehouses.sites[0].rentPerDay = Math.min(
        state.warehouses.sites[0].rentPerDay,
        Math.max(15_00, Math.round((openingCashCents * 0.003) / 100) * 100),
      );
      for (const cap of state.operations.capabilities) {
        cap.dailyInvestment = Math.min(cap.dailyInvestment, 10_00);
        cap.maintenanceSpendPerDay = Math.min(cap.maintenanceSpendPerDay, 8_00);
      }
      for (const mkt of state.commercial.marketing) {
        mkt.dailyBudget = Math.min(mkt.dailyBudget, 15_00);
      }
    }

    // Scale fixed assets and debt facilities to match the business scale
    if (state.finance.fixedAssets.length > 0) {
      const targetPpe = Math.max(1_000_00, Math.round(openingCashCents * 0.45));
      state.finance.fixedAssets = [
        {
          ...state.finance.fixedAssets[0],
          cost: targetPpe,
          salvage: Math.round(targetPpe * 0.1),
          accumulatedDepreciation: 0,
        },
      ];
    }

    if (state.finance.debts.length > 0) {
      const revLimit = Math.max(2_500_00, Math.round(openingCashCents * 0.6));
      state.finance.debts[0].limit = revLimit;
      state.finance.debts[0].principal = 0;
      state.finance.debts[0].covenants = [
        {
          metric: "min_cash",
          threshold: Math.max(250_00, Math.round(openingCashCents * 0.08)),
          comparator: "gte",
        },
      ];
      if (state.finance.debts[1]) {
        const termPrincipal = isSoloMicro ? 0 : Math.round(openingCashCents * 0.25);
        state.finance.debts[1].limit = Math.max(5_000_00, termPrincipal);
        state.finance.debts[1].principal = termPrincipal;
        state.finance.debts[1].monthlyAmortization = termPrincipal > 0 ? Math.round(termPrincipal / 36) : 0;
        state.finance.debts[1].covenants = [];
      }
    }

    // Scale competitor cash to a comparable order of magnitude
    for (const comp of state.market.competitors) {
      comp.cash = Math.max(5_000_00, Math.round(openingCashCents * 1.35));
    }

    initializeOpeningBalanceSheet(state, openingCashCents);
  }

  if (!state.company.marketIntelligence) {
    state.company.marketIntelligence = buildDefaultMarketIntelligence(state);
  }
  return state;
}

export interface PreFlightSenseCheck {
  viabilityScore: number;
  verdictLevel: "strong" | "caution" | "high_risk";
  verdictTitleFi: string;
  executiveSummaryFi: string;
  initialCapitalEuros: number;
  unitPriceEuros: number;
  unitCostEuros: number;
  unitContributionEuros: number;
  grossMarginPct: number;
  dailyFixedCostEuros: number;
  monthlyFixedCostEuros: number;
  breakEvenUnitsPerDay: number;
  estimatedDailyDemandUnits: number;
  safetyMarginUnitsPerDay: number;
  estimatedRunwayMonths: number;
  uomLabel: string;
  risks: Array<{
    severity: "critical" | "warning" | "info";
    titleFi: string;
    descriptionFi: string;
  }>;
  suggestions: Array<{
    id: string;
    labelFi: string;
    impactFi: string;
    assumptionKey?: string;
    multiplier?: number;
    addCapitalEuros?: number;
  }>;
}

/**
 * Compute the Pre-Flight Sense Check & Risk Analysis before starting the simulation.
 */
export function buildPreFlightSenseCheck(state: WorldState): PreFlightSenseCheck {
  const mainOff = state.commercial.offerings[0];
  const offState = state.commercial.offeringStates[0];
  const mainItem = state.catalog.items.find((i) => i.id === mainOff?.itemId) ?? state.catalog.items[state.catalog.items.length - 1];
  const uomLabel = mainItem?.uom || "kpl";

  const unitCostCents = mainOff ? Math.max(20, unitBookCost(state, mainOff.itemId)) : 2_00;
  const listPriceCents =
    offState?.lastPrice ||
    (mainOff
      ? mainOff.pricing.kind === "value_based"
        ? mainOff.pricing.listPrice
        : mainOff.pricing.kind === "subscription"
          ? mainOff.pricing.monthlyPrice
          : 8_00
      : 8_00);

  const unitPriceEuros = Number((listPriceCents / 100).toFixed(2));
  const unitCostEuros = Number((unitCostCents / 100).toFixed(2));
  const unitContributionEuros = Number(Math.max(0.05, unitPriceEuros - unitCostEuros).toFixed(2));
  const grossMarginPct = listPriceCents > 0 ? Math.round(((listPriceCents - unitCostCents) / listPriceCents) * 100) : 50;

  // Daily fixed costs: payroll + rent + marketing + capability maintenance
  const dailyPayrollCents = state.org.positions.reduce((sum, pos) => {
    const role = state.org.roles.find((r) => r.id === pos.roleId);
    if (!role) return sum;
    const hc = pos.cohorts.reduce((s, c) => s + c.count, 0);
    return sum + Math.round((hc * role.annualSalary * (1 + role.benefitsLoad)) / 360);
  }, 0);
  const dailyRentCents = state.warehouses.sites.reduce((s, w) => s + w.rentPerDay, 0);
  const dailyMktCents = state.commercial.marketing.reduce((s, m) => s + m.dailyBudget, 0);
  const dailyCapCents = state.operations.capabilities.reduce((s, c) => s + c.dailyInvestment, 0);
  const dailyFixedCents = Math.max(10_00, dailyPayrollCents + dailyRentCents + dailyMktCents + dailyCapCents);

  const dailyFixedCostEuros = Math.round(dailyFixedCents / 100);
  const monthlyFixedCostEuros = dailyFixedCostEuros * 30;

  const breakEvenUnitsPerDay = Math.max(1, Math.ceil(dailyFixedCostEuros / Math.max(0.2, unitContributionEuros)));

  // Estimated daily demand from segments * player initial share (~26%)
  const totalMarketDaily = state.market.segments.reduce((s, seg) => s + seg.baseDailyDemand, 0);
  const avgShare =
    state.market.presence.length > 0
      ? state.market.presence.reduce((s, p) => s + (p.marketShare || 0.25), 0) / state.market.presence.length
      : 0.25;
  const estimatedDailyDemandUnits = Math.max(1, Math.round(totalMarketDaily * Math.max(0.18, avgShare)));
  const safetyMarginUnitsPerDay = estimatedDailyDemandUnits - breakEvenUnitsPerDay;

  const cashCents = state.finance.periodStartCash || state.finance.ledger.balances.cash || 10_000_00;
  const initialCapitalEuros = state.company.initialCapitalEuros ?? Math.round(cashCents / 100);
  const estimatedRunwayMonths = Number(
    (initialCapitalEuros / Math.max(100, monthlyFixedCostEuros)).toFixed(1),
  );

  // Score calculation (0..100)
  let score = 68;
  if (grossMarginPct >= 55) score += 12;
  else if (grossMarginPct < 35) score -= 18;

  if (estimatedDailyDemandUnits >= breakEvenUnitsPerDay * 1.25) score += 14;
  else if (estimatedDailyDemandUnits < breakEvenUnitsPerDay) score -= 22;

  if (estimatedRunwayMonths >= 4) score += 8;
  else if (estimatedRunwayMonths < 2) score -= 18;

  score = Math.round(clamp(score, 18, 96));

  const verdictLevel: PreFlightSenseCheck["verdictLevel"] =
    score >= 72 ? "strong" : score >= 50 ? "caution" : "high_risk";
  const verdictTitleFi =
    verdictLevel === "strong"
      ? `Vahva & Terve Liiketoimintamalli (${score}/100)`
      : verdictLevel === "caution"
        ? `Toteuttamiskelpoinen, mutta vaatii tarkkaa kassakuria (${score}/100)`
        : `Korkea Kassakriisiriski — Säädä parametreja ennen aloitusta (${score}/100)`;

  const executiveSummaryFi =
    `Alkupääomasi on ${initialCapitalEuros.toLocaleString("fi-FI")} €. Yhden myydyn yksikön (${uomLabel}) hinta on ${unitPriceEuros.toLocaleString("fi-FI")} € ja välitön yksikkökate ${unitContributionEuros.toLocaleString("fi-FI")} € (${grossMarginPct}%). ` +
    `Kiinteät kulut (palkat, tilavuokra ja markkinointi) ovat n. ${dailyFixedCostEuros.toLocaleString("fi-FI")} €/pv (${monthlyFixedCostEuros.toLocaleString("fi-FI")} €/kk). ` +
    `Pääset omillesi (Break-Even), kun myyt vähintään ${breakEvenUnitsPerDay} ${uomLabel}/päivä. ` +
    `Alustava markkinakysyntäarvio yrityksellesi on ~${estimatedDailyDemandUnits} ${uomLabel}/päivä.`;

  const risks: PreFlightSenseCheck["risks"] = [];
  if (estimatedDailyDemandUnits < breakEvenUnitsPerDay) {
    risks.push({
      severity: "critical",
      titleFi: `Kysyntäarvio (${estimatedDailyDemandUnits} ${uomLabel}/pv) alittaa kannattavuusrajan (${breakEvenUnitsPerDay} ${uomLabel}/pv)`,
      descriptionFi: `Nykyisillä kiinteillä kuluilla (${dailyFixedCostEuros} €/pv) ja katteella (${unitContributionEuros} €/${uomLabel}) kassa hupenee joka päivä, ellei myyntihintaa nosteta tai kiinteitä kuluja kevennetä.`,
    });
  } else {
    risks.push({
      severity: "info",
      titleFi: `Kannattavuusraja ${breakEvenUnitsPerDay} ${uomLabel}/pv (${Math.round((breakEvenUnitsPerDay / Math.max(1, estimatedDailyDemandUnits)) * 100)}% arvioidusta kysynnästä)`,
      descriptionFi: `Jos päivämyynti laskee hiljaisina päivinä alle ${breakEvenUnitsPerDay} ${uomLabel}, päivän tulos kääntyy tappiolliseksi.`,
    });
  }

  if (estimatedRunwayMonths < 3) {
    risks.push({
      severity: "critical",
      titleFi: `Ohut kassapuskuri (${initialCapitalEuros.toLocaleString("fi-FI")} € ≈ ${estimatedRunwayMonths} kk kiinteät kulut)`,
      descriptionFi: `Ensimmäiset raaka-aineiden tukkuostot sitovat heti rahaa varastoon. Pienikin toimitusviive tai hiljainen viikko voi tyhjentää kassan.`,
    });
  } else {
    risks.push({
      severity: "warning",
      titleFi: `Tukkuriippuvuus & Raaka-aineiden täydennykset (${state.supply.suppliers[0]?.name ?? "Päätukku"})`,
      descriptionFi: `Jos raaka-aineet pääsevät loppumaan varastosta, asiakkaat kääntyvät luukulta kilpailijoille (${state.market.competitors[0]?.name ?? "lähikilpailija"}).`,
    });
  }

  const ch0 = state.commercial.channels[0];
  if (ch0 && ch0.paymentTermsDays >= 14) {
    risks.push({
      severity: "warning",
      titleFi: `Käyttöpääoma-ansa: Asiakkaiden maksuaika on ${ch0.paymentTermsDays} päivää`,
      descriptionFi: `Maksat raaka-aineet ja palkat ennen kuin asiakkaiden laskut kilahtavat tilille. Seuraa myyntisaamisia tarkasti.`,
    });
  } else {
    risks.push({
      severity: "warning",
      titleFi: `Kilpailijoiden hintareaktio & Paikallinen kilpailu`,
      descriptionFi: `Markkinoilla toimii ${state.market.competitors.length} kilpailijaa (mm. ${state.market.competitors.map((c) => c.name).slice(0, 2).join(" ja ")}). Vältä turhaa hintasotaa ja kilpaile palvelunopeudella.`,
    });
  }

  const suggestions: PreFlightSenseCheck["suggestions"] = [
    {
      id: "sug_price_up",
      labelFi: `Nosta myyntihintaa +12% (${unitPriceEuros.toFixed(2)} € → ${(unitPriceEuros * 1.12).toFixed(2)} €)`,
      impactFi: `Parantaa yksikkökatetta ja laskee päivittäistä kannattavuusrajaa (Break-Even).`,
      assumptionKey: "unit_price",
      multiplier: 1.12,
    },
    {
      id: "sug_rent_down",
      labelFi: `Aloita kevyemmällä tilavuokralla (-25%: ${Math.round(dailyRentCents / 100)} €/pv → ${Math.round((dailyRentCents * 0.75) / 100)} €/pv)`,
      impactFi: `Pienentää kiinteää päiväkulua ja pidentää alkupääoman kiitotietä.`,
      assumptionKey: "facility_rent",
      multiplier: 0.75,
    },
    {
      id: "sug_capital_boost",
      labelFi: `Lisää alkupääomapuskuria (+${initialCapitalEuros < 20_000 ? "5 000" : "25 000"} €)`,
      impactFi: `Antaa turvallisen puskurin ensimmäisiin tukkuostoihin ja hiljaisiin aloituspäiviin.`,
      addCapitalEuros: initialCapitalEuros < 20_000 ? 5_000 : 25_000,
    },
  ];

  return {
    viabilityScore: score,
    verdictLevel,
    verdictTitleFi,
    executiveSummaryFi,
    initialCapitalEuros,
    unitPriceEuros,
    unitCostEuros,
    unitContributionEuros,
    grossMarginPct,
    dailyFixedCostEuros,
    monthlyFixedCostEuros,
    breakEvenUnitsPerDay,
    estimatedDailyDemandUnits,
    safetyMarginUnitsPerDay,
    estimatedRunwayMonths,
    uomLabel,
    risks,
    suggestions,
  };
}

/**
 * Synchronous deterministic compiler: turns any user business prompt (or preset selection)
 * into a validated, archetype-bounded, double-entry reconciled `WorldState`.
 */
export function compileBusinessPromptSync(
  prompt: string,
  opts: {
    seed?: number;
    presetId?: ScenarioPresetId;
    archetype?: IndustryArchetype;
    initialCapitalEuros?: number;
    commercialModelNotes?: string;
  } = {},
): WorldState {
  const clean = prompt.trim();
  const seed = opts.seed ?? (clean ? hashPromptToSeed(clean) : 20261016);

  if (opts.presetId) {
    const found = SCENARIO_PRESETS.find((p) => p.id === opts.presetId);
    if (found) {
      const built = found.build(seed);
      if (opts.initialCapitalEuros !== undefined) {
        built.company.initialCapitalEuros = opts.initialCapitalEuros;
      }
      if (opts.commercialModelNotes !== undefined) {
        built.company.commercialModelNotes = opts.commercialModelNotes;
      }
      const out = opts.archetype
        ? enforceArchetypeSanityBounds(built, opts.archetype)
        : opts.initialCapitalEuros !== undefined || opts.commercialModelNotes !== undefined
          ? applyInitialCapitalAndCommercialModel(built, opts.initialCapitalEuros, opts.commercialModelNotes)
          : built;
      if (!out.company.marketIntelligence) {
        out.company.marketIntelligence = buildDefaultMarketIntelligence(out);
      }
      return out;
    }
  }

  const lower = clean.toLowerCase();

  // Direct match to our 3 canonical presets when keywords align closely
  if (
    !opts.archetype &&
    (lower.includes("strawberry") ||
      lower.includes("vertical farm") ||
      lower.includes("hydroponic") ||
      lower.includes("greenhouse"))
  ) {
    const st = buildVerticalFarmScenario(seed);
    if (clean) st.company.prompt = clean;
    if (opts.initialCapitalEuros !== undefined || opts.commercialModelNotes !== undefined) {
      applyInitialCapitalAndCommercialModel(st, opts.initialCapitalEuros, opts.commercialModelNotes);
    }
    if (!st.company.marketIntelligence) {
      st.company.marketIntelligence = buildDefaultMarketIntelligence(st);
    }
    return st;
  }

  if (
    !opts.archetype &&
    (lower.includes("bicycle") ||
      lower.includes("e-bike") ||
      lower.includes("ebike") ||
      lower.includes("titanium"))
  ) {
    const st = buildCustomEbikeScenario(seed);
    if (clean) st.company.prompt = clean;
    if (opts.initialCapitalEuros !== undefined || opts.commercialModelNotes !== undefined) {
      applyInitialCapitalAndCommercialModel(st, opts.initialCapitalEuros, opts.commercialModelNotes);
    }
    if (!st.company.marketIntelligence) {
      st.company.marketIntelligence = buildDefaultMarketIntelligence(st);
    }
    return st;
  }

  if (
    !opts.archetype &&
    (lower.includes("cold-chain") ||
      lower.includes("cold chain") ||
      lower.includes("pharma") ||
      lower.includes("logistics fleet") ||
      lower.includes("biologics"))
  ) {
    const st = buildColdChainLogisticsScenario(seed);
    if (clean) st.company.prompt = clean;
    if (opts.initialCapitalEuros !== undefined || opts.commercialModelNotes !== undefined) {
      applyInitialCapitalAndCommercialModel(st, opts.initialCapitalEuros, opts.commercialModelNotes);
    }
    if (!st.company.marketIntelligence) {
      st.company.marketIntelligence = buildDefaultMarketIntelligence(st);
    }
    return st;
  }

  // General Archetype-Bounded Zero-to-Ontology synthesis for arbitrary user prompts
  const synthesized = synthesizeCustomBusinessState(
    clean || "Autonomous Industrial Venture",
    seed,
    opts.archetype,
  );
  if (opts.initialCapitalEuros !== undefined || opts.commercialModelNotes !== undefined) {
    return applyInitialCapitalAndCommercialModel(
      synthesized,
      opts.initialCapitalEuros,
      opts.commercialModelNotes,
    );
  }
  return synthesized;
}

/**
 * Async compiler supporting an optional LLM structured-schema generator with strict
 * Archetype Sanity Bounds + Zod + Double-Entry Ledger verification.
 */
export async function compileBusinessPrompt(
  prompt: string,
  opts: CompilerOptions = {},
): Promise<WorldState> {
  const enrichedPrompt = opts.commercialModelNotes
    ? `${prompt.trim()}\nKaupallinen malli & hinnoitteluajatukset: ${opts.commercialModelNotes.trim()}`
    : prompt;
  const base = compileBusinessPromptSync(prompt, opts);
  const targetArchetype =
    opts.archetype ?? base.company.archetype ?? classifyPromptArchetype(prompt);

  if (opts.llmGenerator) {
    const patch = await opts.llmGenerator(enrichedPrompt);
    const merged: WorldState = {
      ...base,
      ...patch,
      company: {
        ...base.company,
        ...(patch.company ?? {}),
        archetype: targetArchetype,
        prompt,
        initialCapitalEuros: opts.initialCapitalEuros ?? base.company.initialCapitalEuros,
        commercialModelNotes: opts.commercialModelNotes ?? base.company.commercialModelNotes,
      },
    };
    const bounded = enforceArchetypeSanityBounds(merged, targetArchetype);
    const parsed = WorldState.parse(bounded);
    const errs = verifyAccountingInvariants(parsed);
    if (errs.length > 0) {
      throw new Error(`Compiled TOM failed accounting invariants: ${errs.join("; ")}`);
    }
    return parsed;
  }

  if (opts.useLiveLlm) {
    const { generateBusinessDnaPatchWithLlm, isLlmConfigured } = await import(
      "../llm"
    );
    if (isLlmConfigured()) {
      const { patch } = await generateBusinessDnaPatchWithLlm(enrichedPrompt, base);
      if (patch && Object.keys(patch).length > 0) {
        const llmArchetype =
          opts.archetype ?? patch.company?.archetype ?? targetArchetype;
        const merged: WorldState = {
          ...base,
          ...patch,
          company: {
            ...base.company,
            ...(patch.company ?? {}),
            archetype: llmArchetype,
            prompt,
            initialCapitalEuros: opts.initialCapitalEuros ?? base.company.initialCapitalEuros,
            commercialModelNotes: opts.commercialModelNotes ?? base.company.commercialModelNotes,
          },
        };
        const bounded = enforceArchetypeSanityBounds(merged, llmArchetype);
        const safe = WorldState.safeParse(bounded);
        if (safe.success) {
          const errs = verifyAccountingInvariants(safe.data);
          if (errs.length === 0) {
            return safe.data;
          }
        }
      }
    }
  }

  const parsed = WorldState.parse(base);
  const errs = verifyAccountingInvariants(parsed);
  if (errs.length > 0) {
    throw new Error(`Compiled TOM failed accounting invariants: ${errs.join("; ")}`);
  }
  return parsed;
}

export interface DomainValueChainSpec {
  companyName: string;
  industry: string;
  tagline: string;
  supplier1: {
    name: string;
    region: string;
    itemName: string;
    itemCostCents: number;
    uom: string;
    leadTimeDays: number;
  };
  supplier2: {
    name: string;
    region: string;
    itemName: string;
    itemCostCents: number;
    uom: string;
    leadTimeDays: number;
  };
  inboundLane: {
    name: string;
    mode: "ltl" | "ftl" | "parcel" | "air" | "ocean";
  };
  facility: {
    name: string;
    rentPerDay: number;
    handling: "ambient" | "chilled" | "frozen" | "hazmat";
    cubeM3: number;
  };
  workCenter: {
    name: string;
    machineHoursPerDay: number;
    laborHoursPerDay: number;
    varCostPerHour?: number;
  };
  rawItem1: {
    name: string;
    uom: string;
    standardCost: number;
  };
  rawItem2: {
    name: string;
    uom: string;
    standardCost: number;
  };
  finishedItem: {
    name: string;
    kind: "finished" | "service";
    uom: string;
    handling: "ambient" | "chilled" | "frozen" | "hazmat";
    shelfLifeDays?: number;
    standardCost: number;
  };
  recipe: {
    name: string;
    outputQty: number;
    laborHours: number;
    machineHours: number;
  };
  channel1: {
    name: string;
    paymentTermsDays: number;
    listPrice: number;
  };
  channel2: {
    name: string;
    paymentTermsDays: number;
    listPrice: number;
    pricingKind?: "value_based" | "subscription" | "wholesale";
  };
  segment1: {
    name: string;
    wtpMean: number;
  };
  segment2: {
    name: string;
    wtpMean: number;
  };
  roles: {
    name: string;
    department: string;
    salary: number;
  }[];
  competitors: {
    name: string;
    persona: "quality_leader" | "low_cost" | "agile";
  }[];
}

export function resolveEndToEndDomain(
  prompt: string,
  archetype: IndustryArchetype,
  seed: number,
): DomainValueChainSpec {
  const lower = prompt.toLowerCase();

  // Extract clean brand noun from prompt
  const words = prompt
    .replace(/[^a-zA-Z0-9\s-äöåÄÖÅ]/g, " ")
    .split(/\s+/)
    .filter(
      (w) =>
        w.length > 2 &&
        !["the", "and", "for", "with", "that", "from", "tai", "sekä", "joka", "kun", "ovat", "myyn", "vain"].includes(w.toLowerCase()),
    );
  const focusNoun =
    words
      .slice(0, 3)
      .map((w) => w[0].toUpperCase() + w.slice(1))
      .join(" ") || "Apex Venture";

  // 0. JÄÄTELÖKIOSKI, NAKKIKISKA, GRILLI, STREET FOOD, TORIMYYNTI & KAHVILA
  if (
    lower.includes("jäätelö") ||
    lower.includes("ice cream") ||
    lower.includes("gelato") ||
    lower.includes("kioski") ||
    lower.includes("kiosk") ||
    lower.includes("nakkikiska") ||
    lower.includes("grilli") ||
    lower.includes("snägäri") ||
    lower.includes("pikaruoka") ||
    lower.includes("street food") ||
    lower.includes("torimyynti") ||
    lower.includes("torikauppa") ||
    lower.includes("burger") ||
    lower.includes("hodari") ||
    lower.includes("limonad") ||
    lower.includes("sitruuna") ||
    lower.includes("limsa") ||
    lower.includes("mehu") ||
    lower.includes("juoma") ||
    lower.includes("smoothie") ||
    lower.includes("koju")
  ) {
    const isBeverage =
      lower.includes("limonad") ||
      lower.includes("sitruuna") ||
      lower.includes("limsa") ||
      lower.includes("mehu") ||
      lower.includes("juoma") ||
      lower.includes("smoothie") ||
      lower.includes("tee");
    const isIceCream =
      !isBeverage &&
      (lower.includes("jäätelö") || lower.includes("ice cream") || lower.includes("gelato"));
    const isGrill =
      !isBeverage &&
      (lower.includes("grilli") ||
        lower.includes("nakkikiska") ||
        lower.includes("snägäri") ||
        lower.includes("burger") ||
        lower.includes("hodari"));

    if (isBeverage) {
      const itemTitle = lower.includes("sitruuna")
        ? "Sitruunalimonadi"
        : lower.includes("mehu")
          ? "Tuorepuristettu Mehu"
          : lower.includes("smoothie")
            ? "Marjasmoothie"
            : lower.includes("tee")
              ? "Jäätee"
              : "Raikas Kioskijuoma";

      return {
        companyName: `${focusNoun} Juoma & Kioski`,
        industry: "Juomamyynti & Katuruokakioski",
        tagline: prompt.length > 110 ? `${prompt.slice(0, 107)}...` : prompt,
        supplier1: {
          name: "Kotimainen Raaka-aine- ja Mehutukku",
          region: "EU-FI",
          itemName: `Ainesosat ja maku-uutteet (${itemTitle.toLowerCase()})`,
          itemCostCents: 60,
          uom: "annos",
          leadTimeDays: 2,
        },
        supplier2: {
          name: "Bio-Kertakäyttömukit, Pillit & Jäätukku",
          region: "EU-FI",
          itemName: "Kierrätettävät mukit, pillit & puhdas jää",
          itemCostCents: 25,
          uom: "kpl",
          leadTimeDays: 2,
        },
        inboundLane: {
          name: "Päivittäinen kylmäjakelu myyntipisteelle",
          mode: "ltl",
        },
        facility: {
          name: "Torikoju, myyntipöytä & kylmäsäilytys",
          rentPerDay: 18_00,
          handling: "chilled",
          cubeM3: 10,
        },
        workCenter: {
          name: `${itemTitle} valmistus, sekoitus & tarjoilu`,
          machineHoursPerDay: 8,
          laborHoursPerDay: 8,
          varCostPerHour: 6_00,
        },
        rawItem1: {
          name: `Tuorepuristettu juomapohja (${itemTitle})`,
          uom: "annos",
          standardCost: 60,
        },
        rawItem2: {
          name: "Kertakäyttömukit, pillit & jääpalat",
          uom: "kpl",
          standardCost: 25,
        },
        finishedItem: {
          name: `Raikas ${itemTitle} (0.4L)`,
          kind: "finished",
          uom: "lasi",
          handling: "chilled",
          shelfLifeDays: 3,
          standardCost: 85,
        },
        recipe: {
          name: "Ainesosien sekoitus jäihin & tarjoilu",
          outputQty: 1,
          laborHours: 0.02,
          machineHours: 0.005,
        },
        channel1: {
          name: "Kojun myyntitiski (Kortti & MobilePay)",
          paymentTermsDays: 0,
          listPrice: 4_00,
        },
        channel2: {
          name: "Iso tuoppi (0.5L) & erikoisversiot",
          paymentTermsDays: 0,
          listPrice: 5_50,
        },
        segment1: {
          name: "Kesäiset janoiset ohikulkijat ja torikansalaiset",
          wtpMean: 4_50,
        },
        segment2: {
          name: "Perheet, turistit & virkistyksen etsijät",
          wtpMean: 5_50,
        },
        roles: [
          { name: "Kioskikauppias / Yrittäjä (Kaikki roolit)", department: "Myynti & Johto", salary: 28_000_00 },
          { name: "Kojuapulainen / Kaveri", department: "Asiakaspalvelu", salary: 18_000_00 },
        ],
        competitors: [
          { name: "Viereinen Torikioski", persona: "low_cost" },
          { name: "Rantakahvilan Virvokkeet", persona: "quality_leader" },
          { name: "Lähikaupan Juomahylly", persona: "agile" },
        ],
      };
    }

    if (isIceCream) {
      return {
        companyName: `${focusNoun} Jäätelökioski & Torikahvila`,
        industry: "Jäätelökioski & Kesämyynti",
        tagline: prompt.length > 110 ? `${prompt.slice(0, 107)}...` : prompt,
        supplier1: {
          name: "Valio & Pingviini Jäätelötukku",
          region: "EU-FI",
          itemName: "Kermajäätelöaltaat (5L) & mehujäät",
          itemCostCents: 1_10,
          uom: "annos",
          leadTimeDays: 2,
        },
        supplier2: {
          name: "Vohveli-, Strösseli- ja Pikaritukku",
          region: "EU-FI",
          itemName: "Rapeat vohvelitötteröt, pikarit & lusikat",
          itemCostCents: 30,
          uom: "kpl",
          leadTimeDays: 2,
        },
        inboundLane: {
          name: "Kylmäauton viikkotoimitus suoraan kioskille",
          mode: "ltl",
        },
        facility: {
          name: "Jäätelökioski & pakastealtaat (-18°C)",
          rentPerDay: 35_00,
          handling: "frozen",
          cubeM3: 20,
        },
        workCenter: {
          name: "Jäätelötiski, annostelu & asiakaspalvelu",
          machineHoursPerDay: 8,
          laborHoursPerDay: 8,
          varCostPerHour: 12_00,
        },
        rawItem1: {
          name: "Kermajäätelöt & erikoismaut (5L astiat)",
          uom: "annos",
          standardCost: 1_10,
        },
        rawItem2: {
          name: "Rapeat vohvelitötteröt, pikarit & strösselit",
          uom: "kpl",
          standardCost: 30,
        },
        finishedItem: {
          name: "Jäätelötötterö / pikarillinen tiskiltä",
          kind: "finished",
          uom: "annos",
          handling: "frozen",
          shelfLifeDays: 60,
          standardCost: 1_40,
        },
        recipe: {
          name: "Jäätelöannoksen pyöritys & vohvelitarjoilu",
          outputQty: 1,
          laborHours: 0.03,
          machineHours: 0.01,
        },
        channel1: {
          name: "Kioskin myyntiluukku (Kortti & MobilePay)",
          paymentTermsDays: 0,
          listPrice: 4_50,
        },
        channel2: {
          name: "Tuplatötteröt, erikoiskahvit & virvokkeet",
          paymentTermsDays: 0,
          listPrice: 6_50,
        },
        segment1: {
          name: "Kesälomailijat, perheet ja lapset",
          wtpMean: 4_80,
        },
        segment2: {
          name: "Helteiset ohikulkijat & herkkusuut",
          wtpMean: 6_50,
        },
        roles: [
          { name: "Kioskiyrittäjä (Myynti, tilitykset ja varasto)", department: "Myynti & Johto", salary: 32_000_00 },
          { name: "Kioskiapulainen / Kesätyöntekijä", department: "Asiakaspalvelu", salary: 22_000_00 },
        ],
        competitors: [
          { name: "Viereinen Torikahvila & Kioski", persona: "quality_leader" },
          { name: "Lähimarketin Jäätelöallas", persona: "low_cost" },
          { name: "Rantabulevardin Gelateria", persona: "agile" },
        ],
      };
    } else if (isGrill) {
      return {
        companyName: `${focusNoun} Grilli & Katuruoka`,
        industry: "Perinteinen Grilli & Yökioski",
        tagline: prompt.length > 110 ? `${prompt.slice(0, 107)}...` : prompt,
        supplier1: {
          name: "Lihanjalostaja & Makkaratukku",
          region: "EU-FI",
          itemName: "Höyrynakit, grillimakkarat & pihvit",
          itemCostCents: 1_90,
          uom: "annos",
          leadTimeDays: 2,
        },
        supplier2: {
          name: "Leipomotukku & Maustekeskus",
          region: "EU-FI",
          itemName: "Sämpylät, perunat, sinapit & kurkkusalaatti",
          itemCostCents: 70,
          uom: "kpl",
          leadTimeDays: 2,
        },
        inboundLane: {
          name: "Tukkurahti ja aamukuorma grillille",
          mode: "ltl",
        },
        facility: {
          name: "Grillikioski & kylmiö (+4°C)",
          rentPerDay: 40_00,
          handling: "chilled",
          cubeM3: 25,
        },
        workCenter: {
          name: "Grilliparila, rasvakeitin & annostelu",
          machineHoursPerDay: 10,
          laborHoursPerDay: 10,
          varCostPerHour: 14_00,
        },
        rawItem1: {
          name: "Grillimakkarat, nakit & pihvit",
          uom: "annos",
          standardCost: 1_90,
        },
        rawItem2: {
          name: "Hampurilaissämpylät, mausteet & lisukkeet",
          uom: "kpl",
          standardCost: 70,
        },
        finishedItem: {
          name: "Grilliateria / Lihapiirakka mausteilla",
          kind: "finished",
          uom: "annos",
          handling: "chilled",
          shelfLifeDays: 5,
          standardCost: 2_60,
        },
        recipe: {
          name: "Grillaus, maustaminen & käärepaperiin pakkaus",
          outputQty: 1,
          laborHours: 0.05,
          machineHours: 0.03,
        },
        channel1: {
          name: "Grillin palveluluukku (Käteinen & Kortti)",
          paymentTermsDays: 0,
          listPrice: 9_50,
        },
        channel2: {
          name: "Yömyynti & Wolt-noutotilaukset",
          paymentTermsDays: 0,
          listPrice: 12_50,
        },
        segment1: {
          name: "Lounastajat & Päiväasiakkaat",
          wtpMean: 10_00,
        },
        segment2: {
          name: "Iltamenijät & Yönälkäiset",
          wtpMean: 13_00,
        },
        roles: [
          { name: "Grilliyrittäjä (Paisto, myynti ja hankinnat)", department: "Myynti & Paisto", salary: 36_000_00 },
          { name: "Grillimyyjä / Iltatyöntekijä", department: "Asiakaspalvelu", salary: 24_000_00 },
        ],
        competitors: [
          { name: "Keskustan Pikaruokaketju", persona: "low_cost" },
          { name: "Viereinen Kebab-Pizzeria", persona: "quality_leader" },
          { name: "Huoltoaseman Yögrilli", persona: "agile" },
        ],
      };
    } else {
      return {
        companyName: `${focusNoun} Kioski & Torikauppa`,
        industry: "Torikauppa & Pienkioski",
        tagline: prompt.length > 110 ? `${prompt.slice(0, 107)}...` : prompt,
        supplier1: {
          name: "Pääelintarvike- ja juomatukku",
          region: "EU-FI",
          itemName: "Juomat, makeiset & kahvipavut",
          itemCostCents: 1_20,
          uom: "kpl",
          leadTimeDays: 2,
        },
        supplier2: {
          name: "Leipomo- ja kioskituotetukku",
          region: "EU-FI",
          itemName: "Tuoreet pullat, pikarit & tarvikkeet",
          itemCostCents: 80,
          uom: "kpl",
          leadTimeDays: 1,
        },
        inboundLane: {
          name: "Tukkutoimitus suoraan kioskille",
          mode: "ltl",
        },
        facility: {
          name: "Kioskirakennus & pikkutakahuone",
          rentPerDay: 30_00,
          handling: "ambient",
          cubeM3: 20,
        },
        workCenter: {
          name: "Myyntitiski, kahvinkeitto & asiakaspalvelu",
          machineHoursPerDay: 8,
          laborHoursPerDay: 8,
          varCostPerHour: 10_00,
        },
        rawItem1: {
          name: "Kahvipavut, virvokkeet & makeiset",
          uom: "kpl",
          standardCost: 1_20,
        },
        rawItem2: {
          name: "Tuoreet leivonnaiset & take-away kupit",
          uom: "kpl",
          standardCost: 80,
        },
        finishedItem: {
          name: "Kahvi & korvapuusti / Kioskiannos",
          kind: "finished",
          uom: "annos",
          handling: "ambient",
          shelfLifeDays: 2,
          standardCost: 2_00,
        },
        recipe: {
          name: "Kahvin suodatus & leivonnaisen tarjoilu",
          outputQty: 1,
          laborHours: 0.02,
          machineHours: 0.01,
        },
        channel1: {
          name: "Kioskin palvelutiski (Maksu heti)",
          paymentTermsDays: 0,
          listPrice: 5_50,
        },
        channel2: {
          name: "Take-away matkaajat & eväät",
          paymentTermsDays: 0,
          listPrice: 4_50,
        },
        segment1: {
          name: "Aamun työmatkalaiset & kahvittelijat",
          wtpMean: 5_50,
        },
        segment2: {
          name: "Päivän ohikulkijat & herkkusuut",
          wtpMean: 5_00,
        },
        roles: [
          { name: "Kioskinpitäjä / Yksinyrittäjä", department: "Johto & Myynti", salary: 32_000_00 },
          { name: "Kioskiapulainen (Osa-aikainen)", department: "Asiakaspalvelu", salary: 18_000_00 },
        ],
        competitors: [
          { name: "Aseman R-Kioski", persona: "quality_leader" },
          { name: "Lähimarketin Kahvipiste", persona: "low_cost" },
          { name: "Korttelikahvila", persona: "agile" },
        ],
      };
    }
  }

  // 1. KUKKAKAUPPA / FLOWERS / FLORIST
  if (
    lower.includes("kukk") ||
    lower.includes("flower") ||
    lower.includes("florist") ||
    lower.includes("kimppu") ||
    lower.includes("asetelma")
  ) {
    return {
      companyName: `${focusNoun} Kukkastudio & Floristiikka`,
      industry: "Kukkakauppa & Käsityönä sidotut kimput",
      tagline: prompt.length > 110 ? `${prompt.slice(0, 107)}...` : prompt,
      supplier1: {
        name: "Hollannin Kukkahuutokauppa & Viljelijät (EU-NL)",
        region: "EU-NL",
        itemName: "Tuoreet sesonkileikkokukat (ruusut, neilikat, tulppaanit)",
        itemCostCents: 18_00,
        uom: "nippu",
        leadTimeDays: 2,
      },
      supplier2: {
        name: "Kukkatarvike & Silkkipaperitukku",
        region: "EU-FI",
        itemName: "Sidontanauhat, paperit & kukkamaljakot",
        itemCostCents: 4_50,
        uom: "kpl",
        leadTimeDays: 3,
      },
      inboundLane: {
        name: "Kylmäkuljetus ja aamujakelu kukkakauppaan",
        mode: "ltl",
      },
      facility: {
        name: "Kukkakaupan myymälä & viileäkylmiö (+4°C)",
        rentPerDay: 110_00,
        handling: "chilled",
        cubeM3: 350,
      },
      workCenter: {
        name: "Kukkasidonta, kimppumuotoilu & laadunvalvonta",
        machineHoursPerDay: 6,
        laborHoursPerDay: 32,
        varCostPerHour: 15_00,
      },
      rawItem1: {
        name: "Tuoreet leikkokukat (sesonkiniput)",
        uom: "nippu",
        standardCost: 18_00,
      },
      rawItem2: {
        name: "Kukkasidonnan paperit & koristenauhat",
        uom: "kpl",
        standardCost: 4_50,
      },
      finishedItem: {
        name: "Käsityönä sidottu kukkakimppu / asetelma",
        kind: "finished",
        uom: "kimppu",
        handling: "chilled",
        shelfLifeDays: 7,
        standardCost: 22_50,
      },
      recipe: {
        name: "Uniikin kukkakimpun sidonta & pakkaus",
        outputQty: 5,
        laborHours: 3.5,
        machineHours: 0.5,
      },
      channel1: {
        name: "Kivijalkamyymälä & noutopiste",
        paymentTermsDays: 0,
        listPrice: 48_00,
      },
      channel2: {
        name: "Verkkokauppa & pikatoimitus kotiovelle",
        paymentTermsDays: 0,
        listPrice: 58_00,
      },
      segment1: {
        name: "Arjen hemmottelijat & kodinsisustajat",
        wtpMean: 52_00,
      },
      segment2: {
        name: "Juhla-, hää- ja yritystilaajat",
        wtpMean: 95_00,
      },
      roles: [
        { name: "Johtava Floristi & Kauppias", department: "Sidonta & Myymälä", salary: 48_000_00 },
        { name: "Kukkasitoja & Floristiassistentti", department: "Tuotanto & Sidonta", salary: 38_000_00 },
        { name: "Verkkokauppa- ja kuljetusvastaava", department: "Logistiikka & Verkkokauppa", salary: 35_000_00 },
      ],
      competitors: [
        { name: "Keskustan Kukkatori", persona: "quality_leader" },
        { name: "Marketin Kukkamyynti", persona: "low_cost" },
        { name: "Verkkokukka Express", persona: "agile" },
      ],
    };
  }

  // 2. HOTELLI- JA PIKATOIMITUS / HOTEL EXPRESS CONCIERGE / TUNTITOIMITUS
  if (
    lower.includes("hotelli") ||
    lower.includes("hotel") ||
    lower.includes("tuntitoimitus") ||
    lower.includes("tuliainen") ||
    lower.includes("tuliais") ||
    lower.includes("matkustaja") ||
    lower.includes("matkatarvik") ||
    lower.includes("concierge")
  ) {
    return {
      companyName: `${focusNoun} Express D2C`,
      industry: "Hotellivieraiden pikatoimitus & Concierge D2C",
      tagline: prompt.length > 110 ? `${prompt.slice(0, 107)}...` : prompt,
      supplier1: {
        name: "Kauppatukku & Pientavaratoimittaja",
        region: "EU-FI",
        itemName: "Matkatarvikkeet, kosmetiikka & pikaeväät",
        itemCostCents: 12_00,
        uom: "erä",
        leadTimeDays: 2,
      },
      supplier2: {
        name: "Premium Tuliais- ja lahjapakkaajat",
        region: "EU-FI",
        itemName: "Tuliaisrasiat, matkamuistot & lahjapussit",
        itemCostCents: 5_00,
        uom: "kpl",
        leadTimeDays: 3,
      },
      inboundLane: {
        name: "Pikatukkurahti kaupunkihubiin",
        mode: "parcel",
      },
      facility: {
        name: "Kaupunkihubin pikatilausvarasto & pakkauspiste",
        rentPerDay: 130_00,
        handling: "ambient",
        cubeM3: 400,
      },
      workCenter: {
        name: "Tilauskeräily, hotellipakkaus & pikalähetysvalmistelu",
        machineHoursPerDay: 8,
        laborHoursPerDay: 35,
        varCostPerHour: 18_00,
      },
      rawItem1: {
        name: "Matkatarvikkeet & pikatuliaistuotteet",
        uom: "erä",
        standardCost: 12_00,
      },
      rawItem2: {
        name: "Hotellien brändikassit & sinettipakkaukset",
        uom: "kpl",
        standardCost: 5_00,
      },
      finishedItem: {
        name: "Hotellivieraan pikatoimituspaketti (Tuntitoimitus)",
        kind: "finished",
        uom: "tilaus",
        handling: "ambient",
        shelfLifeDays: undefined,
        standardCost: 17_00,
      },
      recipe: {
        name: "Pikatilauksen keräily, laadunvarmistus & sinetöinti",
        outputQty: 10,
        laborHours: 3.5,
        machineHours: 1.0,
      },
      channel1: {
        name: "Hotellikumppanuus & aula-automaatti / respatoimitus",
        paymentTermsDays: 14,
        listPrice: 42_00,
      },
      channel2: {
        name: "Mobiilitilaus hotellihuoneeseen (Pikalähetys)",
        paymentTermsDays: 0,
        listPrice: 49_00,
      },
      segment1: {
        name: "Hotellivieraat & liikematkustajat",
        wtpMean: 55_00,
      },
      segment2: {
        name: "Tuliaisten ostajat & turistit",
        wtpMean: 65_00,
      },
      roles: [
        { name: "Toiminnanjohtaja & Perustaja", department: "Johto & Kumppanuudet", salary: 65_000_00 },
        { name: "Hotellikumppanuus- ja myyntivastaava", department: "Myynti & Asiakkuudet", salary: 52_000_00 },
        { name: "Pikalähetti & Varastokeräilijä", department: "Operatiivinen toimitus", salary: 36_000_00 },
      ],
      competitors: [
        { name: "Hotellin oma minibaari", persona: "low_cost" },
        { name: "Korttelin 24/7 Lähikauppa", persona: "quality_leader" },
        { name: "Kansainvälinen Pikalähettiapp", persona: "agile" },
      ],
    };
  }

  // 3. LEIPOMO / BAKERY / SOURDOUGH / KAHVILA
  if (
    lower.includes("leipo") ||
    lower.includes("leipä") ||
    lower.includes("sourdough") ||
    lower.includes("hapanjuuri") ||
    lower.includes("bakery") ||
    lower.includes("kondiittori") ||
    lower.includes("leivos") ||
    lower.includes("kahvila") ||
    lower.includes("cafe")
  ) {
    return {
      companyName: `${focusNoun} Hapanjuurileipomo`,
      industry: "Kiviuunileipomo & Artisan-kahvila",
      tagline: prompt.length > 110 ? `${prompt.slice(0, 107)}...` : prompt,
      supplier1: {
        name: "Pellon Luomumylly",
        region: "EU-FI",
        itemName: "Luomuruis- ja vehnäjauhot",
        itemCostCents: 1_80,
        uom: "kg",
        leadTimeDays: 3,
      },
      supplier2: {
        name: "Leipomotarvike & Eko-pakkaukset",
        region: "EU-FI",
        itemName: "Biohajoavat leipäpussit & leivontatarvikkeet",
        itemCostCents: 80,
        uom: "kpl",
        leadTimeDays: 4,
      },
      inboundLane: {
        name: "Myllyrahti ja jauhekuljetus leipomoon",
        mode: "ltl",
      },
      facility: {
        name: "Leipomon tuotantotila & jauhovarasto",
        rentPerDay: 140_00,
        handling: "ambient",
        cubeM3: 500,
      },
      workCenter: {
        name: "Taikinanvaivaus, hapanjuurinostatus & kiviuunipaisto",
        machineHoursPerDay: 8,
        laborHoursPerDay: 40,
        varCostPerHour: 22_00,
      },
      rawItem1: {
        name: "Luomuruis- ja spelttijauhot",
        uom: "kg",
        standardCost: 1_80,
      },
      rawItem2: {
        name: "Hapanjuuri & biohajoavat leipäpussit",
        uom: "kpl",
        standardCost: 80,
      },
      finishedItem: {
        name: "Kiviuunissa paistettu hapanjuurileipä",
        kind: "finished",
        uom: "kpl",
        handling: "ambient",
        shelfLifeDays: 3,
        standardCost: 2_60,
      },
      recipe: {
        name: "Aamun hapanjuurileipäerän paisto (20 kpl)",
        outputQty: 20,
        laborHours: 5.0,
        machineHours: 4.0,
      },
      channel1: {
        name: "Oma leipomomyymälä & aamiaiskahvila",
        paymentTermsDays: 0,
        listPrice: 8_50,
      },
      channel2: {
        name: "B2B-toimitukset ravintoloille & kahviloille",
        paymentTermsDays: 14,
        listPrice: 6_20,
      },
      segment1: {
        name: "Aamutuoreen artisan-leivän ystävät",
        wtpMean: 9_50,
      },
      segment2: {
        name: "Laaturavintolat & boutique-hotellit",
        wtpMean: 7_50,
      },
      roles: [
        { name: "Pääleipuri / Mestari", department: "Leivonta & Reseptiikka", salary: 52_000_00 },
        { name: "Leipurikisälli & Paistaja", department: "Tuotanto & Uunit", salary: 38_000_00 },
        { name: "Myymälä- ja toimitusvastaava", department: "Myymälä & Logistiikka", salary: 36_000_00 },
      ],
      competitors: [
        { name: "Teollinen Suurleipomo", persona: "low_cost" },
        { name: "Lähikorttelin Artisan-kahvila", persona: "quality_leader" },
        { name: "Paahtimokahvila Bakery", persona: "agile" },
      ],
    };
  }

  // 4. ASIANTUNTIJATYÖ / KONSULTOINTI / OSAAMINEN / NEUVONANTO / LAKIASIAIN
  if (
    lower.includes("osaami") ||
    lower.includes("konsult") ||
    lower.includes("asiantuntija") ||
    lower.includes("neuvonanto") ||
    lower.includes("valmennus") ||
    lower.includes("koulutus") ||
    lower.includes("lakimies") ||
    lower.includes("asianajo") ||
    lower.includes("tilitoimisto") ||
    lower.includes("advisory") ||
    lower.includes("agency")
  ) {
    return {
      companyName: `${focusNoun} Advisors & Consulting`,
      industry: "B2B-Asiantuntijapalvelut & Strategianeuvonanto",
      tagline: prompt.length > 110 ? `${prompt.slice(0, 107)}...` : prompt,
      supplier1: {
        name: "Tutkimus- ja markkinadatatoimittaja",
        region: "EU-FI",
        itemName: "Analyysityökalut & ammattilisenssit",
        itemCostCents: 25_00,
        uom: "lisenssi",
        leadTimeDays: 1,
      },
      supplier2: {
        name: "Pilvityökalujen & viestinnän tarjoaja",
        region: "EU-FI",
        itemName: "Toimistoinfra & digitaaliset työkalut",
        itemCostCents: 10_00,
        uom: "käyttäjä",
        leadTimeDays: 1,
      },
      inboundLane: {
        name: "Digitaalinen provisiointi & pilvi-integraatio",
        mode: "parcel",
      },
      facility: {
        name: "Päätoimisto & Asiantuntijakeskus",
        rentPerDay: 150_00,
        handling: "ambient",
        cubeM3: 600,
      },
      workCenter: {
        name: "Asiantuntijatyö, strategianeuvonanto & asiakasprojektit",
        machineHoursPerDay: 8,
        laborHoursPerDay: 40,
        varCostPerHour: 20_00,
      },
      rawItem1: {
        name: "Ammattityökalut & analyysilisenssit",
        uom: "lisenssi",
        standardCost: 25_00,
      },
      rawItem2: {
        name: "Projektinhallinta- ja raportointityökalut",
        uom: "käyttäjä",
        standardCost: 10_00,
      },
      finishedItem: {
        name: "Asiantuntijapäivä (Laskutettava palvelu)",
        kind: "service",
        uom: "day",
        handling: "ambient",
        shelfLifeDays: undefined,
        standardCost: 350_00,
      },
      recipe: {
        name: "Asiantuntijatoimitus & strategiaprojekti (5 päivää)",
        outputQty: 5,
        laborHours: 7.5,
        machineHours: 0.5,
      },
      channel1: {
        name: "Suora B2B-myynti & toimeksiannot",
        paymentTermsDays: 30,
        listPrice: 1450_00,
      },
      channel2: {
        name: "Jatkuvat retainer-sopimukset",
        paymentTermsDays: 45,
        listPrice: 4800_00,
        pricingKind: "subscription",
      },
      segment1: {
        name: "Enterprise-asiakkaat & suuryritykset",
        wtpMean: 1600_00,
      },
      segment2: {
        name: "Kasvuyritysten johtoryhmät & hallitukset",
        wtpMean: 5200_00,
      },
      roles: [
        { name: "Managing Partner / Johtava Konsultti", department: "Johto & Asiakkuudet", salary: 120_000_00 },
        { name: "Senior Asiantuntija / Projektipäällikkö", department: "Toimitus & Analyysi", salary: 85_000_00 },
        { name: "B2B-Asiakkuusjohtaja (Myynti & Kasvu)", department: "Myynti & Markkinointi", salary: 75_000_00 },
      ],
      competitors: [
        { name: "Kansainvälinen Konsulttijätti", persona: "quality_leader" },
        { name: "Paikallinen Freelance-verkosto", persona: "low_cost" },
        { name: "Boutique-strategiatoimisto", persona: "agile" },
      ],
    };
  }

  // 5. OHJELMISTO / SAAS / ALUSTA / CLOUD
  if (
    lower.includes("saas") ||
    lower.includes("platform") ||
    lower.includes("software") ||
    lower.includes("ohjelmisto") ||
    lower.includes("alusta") ||
    lower.includes("pilvi") ||
    lower.includes("app") ||
    lower.includes("sovellus")
  ) {
    return {
      companyName: `${focusNoun} Cloud Platform`,
      industry: "SaaS-ohjelmisto & Pilvialusta",
      tagline: prompt.length > 110 ? `${prompt.slice(0, 107)}...` : prompt,
      supplier1: {
        name: "Pilvi-infrastruktuuri (AWS / GCP / Azure)",
        region: "EU-FI",
        itemName: "Palvelinkapasiteetti & tietokantaresurssit",
        itemCostCents: 12_00,
        uom: "solmu",
        leadTimeDays: 1,
      },
      supplier2: {
        name: "DevOps- & Tietoturvakumppani",
        region: "EU-FI",
        itemName: "Valvonta- ja tietoturvalisenssit",
        itemCostCents: 4_00,
        uom: "istunto",
        leadTimeDays: 1,
      },
      inboundLane: {
        name: "Pilviarkkitehtuurin automatisoitu provisiointi",
        mode: "parcel",
      },
      facility: {
        name: "Pilvi-infrastruktuuri (Helsinki / Frankfurt Region)",
        rentPerDay: 110_00,
        handling: "ambient",
        cubeM3: 1000,
      },
      workCenter: {
        name: "Ohjelmistokehitys, koodaus & DevOps-ylläpito",
        machineHoursPerDay: 8,
        laborHoursPerDay: 20,
        varCostPerHour: 10_00,
      },
      rawItem1: {
        name: "Pilvikapasiteetti & API-kutsut",
        uom: "solmu",
        standardCost: 12_00,
      },
      rawItem2: {
        name: "Tietokanta- ja tietoturvakohteet",
        uom: "istunto",
        standardCost: 4_00,
      },
      finishedItem: {
        name: "SaaS-käyttölisenssi (Kuukausitilaus)",
        kind: "service",
        uom: "kk",
        handling: "ambient",
        shelfLifeDays: undefined,
        standardCost: 15_00,
      },
      recipe: {
        name: "Alustan ylläpito, päivitykset & DevOps-ajot (50 lisenssiä)",
        outputQty: 50,
        laborHours: 2.0,
        machineHours: 8.0,
      },
      channel1: {
        name: "Itsepalveluverkkosivusto (Self-Serve SaaS)",
        paymentTermsDays: 0,
        listPrice: 99_00,
      },
      channel2: {
        name: "Enterprise Cloud Plan & Suoramyynti",
        paymentTermsDays: 30,
        listPrice: 850_00,
        pricingKind: "subscription",
      },
      segment1: {
        name: "Kehittäjätiimit & teknologia-startupit",
        wtpMean: 120_00,
      },
      segment2: {
        name: "Keskisuuret ja suuret yritysasiakkaat",
        wtpMean: 950_00,
      },
      roles: [
        { name: "CTO & Tuotearkkitehti", department: "Tuotekehitys & Teknologia", salary: 95_000_00 },
        { name: "Growth Lead / Kaupallinen johtaja", department: "Kasvu & Markkinointi", salary: 75_000_00 },
        { name: "Full-Stack Kehittäjä & DevOps", department: "Teknologia", salary: 65_000_00 },
      ],
      competitors: [
        { name: "Globaali SaaS-markkinajohtaja", persona: "quality_leader" },
        { name: "Avoin Open-Source vaihtoehto", persona: "low_cost" },
        { name: "Ketterä Kasvuyrityshaastaja", persona: "agile" },
      ],
    };
  }

  // 6. KULUTTAJATUOTE / VAATTEET / MUOTI / KOSMETIIKKA / D2C
  if (
    lower.includes("vaate") ||
    lower.includes("muoti") ||
    lower.includes("apparel") ||
    lower.includes("clothing") ||
    lower.includes("kosmetiik") ||
    lower.includes("ihonhoito") ||
    lower.includes("skin") ||
    lower.includes("d2c") ||
    lower.includes("brand") ||
    lower.includes("brändi")
  ) {
    return {
      companyName: `${focusNoun} Brand & Apparel`,
      industry: "Korkean kierron D2C-kuluttajabrändi",
      tagline: prompt.length > 110 ? `${prompt.slice(0, 107)}...` : prompt,
      supplier1: {
        name: "Tekstiili- ja materiaalivalmistaja",
        region: "EU-FI",
        itemName: "Päämateriaalit & kankaat / luonnonuutteet",
        itemCostCents: 20_00,
        uom: "metri",
        leadTimeDays: 7,
      },
      supplier2: {
        name: "Eko-pakkaukset & Lähetyslaatikot",
        region: "EU-FI",
        itemName: "Brändipakkaukset & suojatarvikkeet",
        itemCostCents: 6_00,
        uom: "kpl",
        leadTimeDays: 5,
      },
      inboundLane: {
        name: "Mannerrahti ja tukkutoimitus päävarastolle",
        mode: "ltl",
      },
      facility: {
        name: "Brändin keskusvarasto & pakkauspiste",
        rentPerDay: 140_00,
        handling: "ambient",
        cubeM3: 650,
      },
      workCenter: {
        name: "Tarkastelu, lajittelu & brändätty unboxing-pakkaus",
        machineHoursPerDay: 6,
        laborHoursPerDay: 30,
        varCostPerHour: 16_00,
      },
      rawItem1: {
        name: "Valmistusmateriaalit & puolivalmisteet",
        uom: "metri",
        standardCost: 20_00,
      },
      rawItem2: {
        name: "Brändätyt lähetyslaatikot & suojaus",
        uom: "kpl",
        standardCost: 6_00,
      },
      finishedItem: {
        name: "Brändituoteyksikkö (D2C Core SKU)",
        kind: "finished",
        uom: "kpl",
        handling: "ambient",
        shelfLifeDays: undefined,
        standardCost: 26_00,
      },
      recipe: {
        name: "Brändituotteen viimeistely & pakkaus (10 kpl)",
        outputQty: 10,
        laborHours: 2.0,
        machineHours: 0.5,
      },
      channel1: {
        name: "Oma D2C-verkkokauppa",
        paymentTermsDays: 0,
        listPrice: 79_00,
      },
      channel2: {
        name: "Valikoidut lifestyle-myymälät",
        paymentTermsDays: 30,
        listPrice: 55_00,
      },
      segment1: {
        name: "Tietoiset laatukuluttajat & brändiuskolliset",
        wtpMean: 89_00,
      },
      segment2: {
        name: "Trenditietoiset verkkoshoppaajat",
        wtpMean: 79_00,
      },
      roles: [
        { name: "Brand & Growth Director", department: "Brändi & Kasvu", salary: 72_000_00 },
        { name: "Pääsuunnittelija / Creative Lead", department: "Muotoilu & Tuote", salary: 58_000_00 },
        { name: "Verkkokauppa- ja logistiikkavastaava", department: "Logistiikka & Varasto", salary: 42_000_00 },
      ],
      competitors: [
        { name: "Globaali Pikamuotiketju", persona: "low_cost" },
        { name: "Pohjoismainen Premium-brändi", persona: "quality_leader" },
        { name: "TikTok-virushitti D2C", persona: "agile" },
      ],
    };
  }

  // 7. VALMISTUS / PYÖRÄT / KONEPAJA / TEOLLISUUS
  if (
    lower.includes("pyörä") ||
    lower.includes("bike") ||
    lower.includes("kone") ||
    lower.includes("tehdas") ||
    lower.includes("industrial") ||
    lower.includes("manufacturing") ||
    lower.includes("cnc") ||
    lower.includes("machining") ||
    lower.includes("titaani") ||
    lower.includes("laite")
  ) {
    return {
      companyName: `${focusNoun} Precision Works`,
      industry: "Pääomavaltainen laitevalmistus & konepaja",
      tagline: prompt.length > 110 ? `${prompt.slice(0, 107)}...` : prompt,
      supplier1: {
        name: "Metallitukku & Raakakomponentit",
        region: "EU-FI",
        itemName: "Titaani-, teräs- ja alumiiniaihiot",
        itemCostCents: 850_00,
        uom: "kg",
        leadTimeDays: 14,
      },
      supplier2: {
        name: "Erikoiskomponentit & Elektroniikka",
        region: "EU-DE",
        itemName: "Moottorit, anturit & laakerit",
        itemCostCents: 950_00,
        uom: "sarja",
        leadTimeDays: 20,
      },
      inboundLane: {
        name: "Raskas maantierahti tehtaalle",
        mode: "ftl",
      },
      facility: {
        name: "Konepaja & kokoonpanohalli",
        rentPerDay: 260_00,
        handling: "ambient",
        cubeM3: 1200,
      },
      workCenter: {
        name: "CNC-koneistus, hitsaus & tarkkuuskokoonpano",
        machineHoursPerDay: 16,
        laborHoursPerDay: 48,
        varCostPerHour: 45_00,
      },
      rawItem1: {
        name: "Metalliraaka-aineet & komponenttiaihio",
        uom: "kg",
        standardCost: 850_00,
      },
      rawItem2: {
        name: "Moottori- ja elektroniikkasarjat",
        uom: "sarja",
        standardCost: 950_00,
      },
      finishedItem: {
        name: "Valmistettu erikoislaite / tarkkuusyksikkö",
        kind: "finished",
        uom: "kpl",
        handling: "ambient",
        shelfLifeDays: undefined,
        standardCost: 1800_00,
      },
      recipe: {
        name: "Erikoislaitteen koneistus, kokoonpano & testaus",
        outputQty: 2,
        laborHours: 6.0,
        machineHours: 8.0,
      },
      channel1: {
        name: "Suora B2B-teollisuusmyynti & mittatilaus",
        paymentTermsDays: 30,
        listPrice: 4200_00,
      },
      channel2: {
        name: "Erikoisjälleenmyyjät & huoltoverkosto",
        paymentTermsDays: 45,
        listPrice: 3200_00,
      },
      segment1: {
        name: "Teollisuusasiakkaat & ammattikäyttäjät",
        wtpMean: 4500_00,
      },
      segment2: {
        name: "Erikoiskomponentteja vaativat OEM-asiakkaat",
        wtpMean: 3800_00,
      },
      roles: [
        { name: "Tehtaanjohtaja / Pääinsinööri", department: "Tuotanto & Insinöörityö", salary: 85_000_00 },
        { name: "CNC-koneistaja & Kokoonpanomestari", department: "Koneistus", salary: 55_000_00 },
        { name: "Teollisuusmyynti- ja asiakkuuspäällikkö", department: "Myynti", salary: 65_000_00 },
      ],
      competitors: [
        { name: "Saksalainen Teollisuusjätti", persona: "quality_leader" },
        { name: "Aasialainen Suursarjatoimittaja", persona: "low_cost" },
        { name: "Ketterä Kotimainen Konepaja", persona: "agile" },
      ],
    };
  }

  // 8. GENERAL DYNAMIC FALLBACK (TAILORED STRICTLY TO USER'S PROMPT VOCABULARY)
  return {
    companyName: `${focusNoun} Co.`,
    industry: `${focusNoun} Liiketoiminta`,
    tagline: prompt.length > 110 ? `${prompt.slice(0, 107)}...` : prompt,
    supplier1: {
      name: `${focusNoun} Päämateriaalien Toimittaja`,
      region: "EU-FI",
      itemName: `${focusNoun} Ensisijaiset raaka-aineet`,
      itemCostCents: 15_00,
      uom: "yks",
      leadTimeDays: 4,
    },
    supplier2: {
      name: `${focusNoun} Pakkaus- ja tarviketukku`,
      region: "EU-FI",
      itemName: `${focusNoun} Pakkaukset & oheistarvikkeet`,
      itemCostCents: 5_00,
      uom: "kpl",
      leadTimeDays: 3,
    },
    inboundLane: {
      name: `${focusNoun} Saapuvan tavaran logistiikka`,
      mode: "ltl",
    },
    facility: {
      name: `${focusNoun} Toimipiste & Keskusvarasto`,
      rentPerDay: 140_00,
      handling: "ambient",
      cubeM3: 500,
    },
    workCenter: {
      name: `${focusNoun} Tuotanto- ja toimitusprosessi`,
      machineHoursPerDay: 8,
      laborHoursPerDay: 32,
      varCostPerHour: 20_00,
    },
    rawItem1: {
      name: `${focusNoun} Pääraaka-aineet`,
      uom: "yks",
      standardCost: 15_00,
    },
    rawItem2: {
      name: `${focusNoun} Pakkaukset & oheistarvikkeet`,
      uom: "kpl",
      standardCost: 5_00,
    },
    finishedItem: {
      name: `${focusNoun} Päätuote / Palvelu`,
      kind: "finished",
      uom: "kpl",
      handling: "ambient",
      shelfLifeDays: undefined,
      standardCost: 20_00,
    },
    recipe: {
      name: `${focusNoun} Valmistus- ja laadunvarmistuserä`,
      outputQty: 10,
      laborHours: 3.0,
      machineHours: 1.0,
    },
    channel1: {
      name: `Suora asiakaskanava (Direct)`,
      paymentTermsDays: 0,
      listPrice: 55_00,
    },
    channel2: {
      name: `Kumppaniverkosto & Jälleenmyynti`,
      paymentTermsDays: 30,
      listPrice: 45_00,
    },
    segment1: {
      name: `Ensisijainen asiakaskohderyhmä`,
      wtpMean: 65_00,
    },
    segment2: {
      name: `Yritys- ja erikoisasiakkaat`,
      wtpMean: 75_00,
    },
    roles: [
      { name: `${focusNoun} Perustaja & Toiminnanjohtaja`, department: "Johto", salary: 60_000_00 },
      { name: `${focusNoun} Tuote- ja toimitusvastaava`, department: "Toimitus", salary: 45_000_00 },
      { name: `${focusNoun} Myynti- ja asiakkuuspäällikkö`, department: "Myynti", salary: 48_000_00 },
    ],
    competitors: [
      { name: "Vakiintunut Toimija", persona: "quality_leader" },
      { name: "Edullinen Hintahaastaja", persona: "low_cost" },
      { name: "Ketterä Uustulokas", persona: "agile" },
    ],
  };
}

export function deriveDomainUiFromSpec(
  specDomain: DomainValueChainSpec,
  archetype?: IndustryArchetype,
): DomainUiConfig {
  const indLower = `${specDomain.companyName} ${specDomain.industry} ${specDomain.facility.name} ${specDomain.workCenter.name}`.toLowerCase();
  const isService = specDomain.finishedItem.kind === "service";
  const isSaas =
    archetype === "PLATFORM_RECURRING" ||
    indLower.includes("saas") ||
    indLower.includes("cloud") ||
    indLower.includes("pilvi") ||
    indLower.includes("ohjelmisto");
  const isKioskOrGrill =
    indLower.includes("kioski") ||
    indLower.includes("jäätelö") ||
    indLower.includes("grilli") ||
    indLower.includes("nakkikiska") ||
    indLower.includes("torikahvila") ||
    indLower.includes("katuruoka");
  const isFlorist = indLower.includes("kukk") || indLower.includes("florist");
  const isBakery = indLower.includes("leipomo") || indLower.includes("hapanjuuri") || indLower.includes("kiviuuni");

  if (isService && !isSaas) {
    return {
      industryLabel: specDomain.industry,
      physicsExplanation: `${specDomain.industry}. Toiminnan ydin: asiantuntijoiden laskutusaste, osaamispääoman tuottavuus, asiakasprojektien läpimeno ja maksuajat (${specDomain.channel1.paymentTermsDays} pv) ilman fyysistä varasto- tai hävikkiriskiä.`,
      valueChainColumns: [
        "1. KUMPPANIT & TYÖKALUT",
        "2. KÄYTTÖÖNOTTO & YHTEYDET",
        "3. TOIMITILA & OSAAMISRESURSSIT",
        "4. ASIANTUNTIJATYÖ & PROJEKTIT",
        "5. ASIAKKUUDET & LASKUTUS",
        "6. B2B-ASIAKKAAT",
      ],
      nodeLabels: {
        supplierTag: "TYÖKALU- / DATAKUMPPANI",
        inboundTag: "KÄYTTÖÖNOTTO & LISENSSIT",
        facilityTag: "TOIMITILA & RESURSSIT",
        facilitySubtitle: "Toimisto & osaamisresurssit",
        facilityMetricLabel: "Toimitilan & resurssien käyttö",
        workCenterTag: "ASIANTUNTIJATYÖ & TOIMITUS",
        workCenterQueueLabel: "Tiimin kuormitus / Työjono",
        channelTag: "B2B-LASKUTUSKANAVA",
        segmentTag: "YRITYSASIAKKAAT",
        addCapacityActionLabel: "Lisää asiantuntijatunteja (+4h/pv)",
        orderSupplyActionLabel: "Hanki lisälisenssejä / resursseja",
      },
      canvasConfig: {
        roles: [
          {
            id: "commercial",
            title: `🎯 ${specDomain.roles[0]?.name || "Managing Partner / Asiakkuusjohtaja"}`,
            sub: "Fokuksesi on uusasiakashankinnassa, tarjouksissa ja asiakassuhteissa.",
          },
          {
            id: "product",
            title: "🧠 Principal Consultant / Johtava asiantuntija",
            sub: `Fokuksesi on asiakastoimituksissa (${specDomain.workCenter.name}) ja laadussa.`,
          },
          {
            id: "general_manager",
            title: "📊 Toimitusjohtaja / Managing Director",
            sub: "Fokuksesi on tiimin rekrytoinnissa, laskutusasteessa ja kassavirrassa.",
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
            sub: "Omat menetelmät ja työkalut nostavat laskutushintaa. Standardityökalut ovat nopeita ottaa käyttöön.",
            inHouseLabel: "Omat metodit & IP",
            outsourceLabel: "Standardityökalut",
          },
        ],
        economics: {
          itemLabel: "PÄÄPALVELU",
          itemSub: "Laskutettava asiantuntijapalvelu • Ei fyysistä varastoa",
          priceLabel: "LASKUTUSHINTA",
          priceSub: "Suora kustannus / suorite",
          marginLabel: "PALVELUKATE",
          marginSub: "Ei fyysistä tuotehävikkiä (100% osaamispääomaa)",
        },
        ignitionText: `Toimintamalli yritykselle ${specDomain.companyName} on nyt valmis. Kun painat käynnistysnappia, Päivä 1 alkaa, asiantuntijatiimisi ottaa ensimmäiset toimeksiannot työn alle ja johtoryhmäsi sparraa kanssasi ensimmäiset päätökset.`,
      },
    };
  }

  if (isSaas) {
    return {
      industryLabel: specDomain.industry,
      physicsExplanation: `${specDomain.industry}. Toiminnan ydin: jatkuva tilauslaskutus (MRR), kehitystiimin läpimeno (${specDomain.workCenter.name}) ja pilvi-infrastruktuurin skaalautuvuus.`,
      valueChainColumns: [
        "1. PILVI-INFRA & APIT",
        "2. INTEGRAATIOT & TIETOLIIKENNE",
        "3. PALVELIMET & TIETOKANNAT",
        "4. KEHITYS & DEVOPS-YLLÄPITO",
        "5. TILAUSKANAVAT & SAAS",
        "6. KÄYTTÄJÄT & TILAAJAT",
      ],
      nodeLabels: {
        supplierTag: "PILVI- / API-KUMPPANI",
        inboundTag: "INTEGRAATIO & PROVISIOINTI",
        facilityTag: "PILVI-INFRASTRUKTUURI",
        facilitySubtitle: "Pilvipalvelimet & tietokanta",
        facilityMetricLabel: "Palvelinkapasiteetin käyttö",
        workCenterTag: "TUOTEKEHITYS & DEVOPS",
        workCenterQueueLabel: "Sprinttikuorma / Työjono",
        channelTag: "TILAUSKANAVA (SAAS)",
        segmentTag: "KÄYTTÄJÄSEGMENTTI",
        addCapacityActionLabel: "Lisää kehitystunteja (+4h/pv)",
        orderSupplyActionLabel: "Varaa lisäpalvelinkapasiteettia",
      },
      canvasConfig: {
        roles: [
          {
            id: "commercial",
            title: "🎯 Growth Lead / Kaupallinen johtaja",
            sub: "Fokuksesi on SaaS-kasvussa, konversiossa ja asiakashankinnassa.",
          },
          {
            id: "product",
            title: "💻 CTO / Tuotearkkitehti",
            sub: "Fokuksesi on tuotteen ominaisuuksissa, koodin laadussa ja käyttökokemuksessa.",
          },
          {
            id: "general_manager",
            title: "📊 CEO / General Manager",
            sub: "Fokuksesi on strategiassa, hinnoittelussa ja kassakiitotiessä.",
          },
        ],
        capabilities: [
          {
            key: "production",
            icon: "💻",
            title: "Tuotekehitys & Ohjelmointi (Core Dev)",
            sub: "Omat kehittäjät mahdollistavat nopean tuotekehityksen. Ohjelmistokumppani joustaa ilman kiinteitä rekrytointeja.",
            inHouseLabel: "Omat koodarit",
            outsourceLabel: "Dev-kumppani",
          },
          {
            key: "warehouse",
            icon: "☁️",
            title: "Pilvi-infrastruktuuri & DevOps",
            sub: "Oma pilviarkkitehtuuri optimoi yksikkökulut skaalassa. Hallittu PaaS säästää ylläpitotyön.",
            inHouseLabel: "Oma pilvi-infra",
            outsourceLabel: "Managed PaaS",
          },
          {
            key: "logistics",
            icon: "🎧",
            title: "Asiakastuki & Käyttöönotto (Onboarding)",
            sub: "Oma asiakastiimi minimoi tilauspoistuman. Itsepalvelu ja automaatio skaalautuvat kevyesti.",
            inHouseLabel: "Oma CS-tiimi",
            outsourceLabel: "Itsepalvelu & automaatio",
          },
        ],
        economics: {
          itemLabel: "PÄÄTILAUS (SAAS)",
          itemSub: "Toistuva tilaus / käyttölisenssi",
          priceLabel: "TILAUSHINTA",
          priceSub: "Pilvi-infran yksikkökulu",
          marginLabel: "OHJELMISTOKATE",
          marginSub: "Korkea skaalautuva kate",
        },
        ignitionText: `Toimintamalli alustalle ${specDomain.companyName} on viritetty. Kun painat käynnistysnappia, pilvi-infra aktivoituu, ensimmäiset tilaajat saapuvat kanaviin ja johtoryhmäsi sparraa kanssasi kasvupäätöksistä.`,
      },
    };
  }

  if (isKioskOrGrill) {
    return {
      industryLabel: specDomain.industry,
      physicsExplanation: `${specDomain.industry}. Toiminnan ydin: päivittäinen asiakasvirta luukulla, annosten myyntikate, raaka-aineiden riittävyys kylmätiloissa (${specDomain.facility.name}) sekä välitön kassavirta.`,
      valueChainColumns: [
        "1. TUKUT & HANKINNAT",
        "2. KULJETUS & TOIMITUKSET",
        "3. KIOSKI / VARASTO",
        "4. VALMISTUS & TISKI",
        "5. MYYNTIPISTE & KASSA",
        "6. ASIAKKAAT",
      ],
      nodeLabels: {
        supplierTag: "TUKKU / TAVARANTOIMITTAJA",
        inboundTag: "TUKKUTOIMITUS KIOSKILLE",
        facilityTag: "KIOSKI & KYLMÄSÄILYTYS",
        facilitySubtitle: "Pakkas- & kylmätila",
        facilityMetricLabel: "Varastosaldot / Kylmätila",
        workCenterTag: "VALMISTUS & ASIAKASPALVELUTISKI",
        workCenterQueueLabel: "Jonotusaika tiskillä",
        channelTag: "MYYNTILUUKKU & KASSA",
        segmentTag: "ASIAKKAAT",
        addCapacityActionLabel: "Ota lisätyövuoro / apulainen tiskille (+4h/pv)",
        orderSupplyActionLabel: "Tilaa täydennyskuorma tukusta",
      },
      canvasConfig: {
        roles: [
          {
            id: "commercial",
            title: "🎯 Kioskiyrittäjä / Myynti & Asiakasvirta",
            sub: "Fokuksesi on myyntipaikan näkyvyydessä, hinnoittelussa ja lisämyynnissä luukulla.",
          },
          {
            id: "product",
            title: "🍦 Palveluvastaava / Valikoima & Tiski",
            sub: `Fokuksesi on tuotteiden laadussa, nopeassa palvelussa (${specDomain.workCenter.name}) ja siisteydessä.`,
          },
          {
            id: "general_manager",
            title: "📊 Yrittäjä / Kassan & Hankintojen hoitaja",
            sub: "Fokuksesi on tukkutilauksissa, hävikin minimoinnissa ja päiväkassan hallinnassa.",
          },
        ],
        capabilities: [
          {
            key: "production",
            icon: "🍦",
            title: `${specDomain.workCenter.name}`,
            sub: "Oma valmistus ja palvelu tiskillä pitää laadun ja katteen omissa käsissä. Valmiit tukkuannokset nopeuttavat myyntiä ruuhkassa.",
            inHouseLabel: "Oma valmistus & palvelu",
            outsourceLabel: "Valmiit tukkupakkaukset",
          },
          {
            key: "warehouse",
            icon: "❄️",
            title: `${specDomain.facility.name}`,
            sub: "Omat pakastealtaat ja kylmäkalusto kioskilla tuovat joustavuutta. Vuokrakalusto säästää alkuinvestoinnin.",
            inHouseLabel: "Oma kylmäkalusto",
            outsourceLabel: "Vuokrakalusto / Tukkusäilytys",
          },
          {
            key: "logistics",
            icon: "🚚",
            title: "Täydennykset & Tukkukuljetus",
            sub: "Oma nouto tukusta säästää rahtikuluissa. Tukun suora kylmäkuljetus tuo tavaran valmiiksi ovelle.",
            inHouseLabel: "Oma tukun nouto",
            outsourceLabel: "Tukun jakeluauto",
          },
        ],
        economics: {
          itemLabel: "MYYTÄVÄ ANNOS / TUOTE",
          itemSub: specDomain.finishedItem.name,
          priceLabel: "MYYNTIHINTA LUUKULLA",
          priceSub: "Raaka-aine- & annoskulu",
          marginLabel: "MYYNTIKATE / ANNOS",
          marginSub: "Kate ennen kioskin vuokraa ja palkkoja",
        },
        ignitionText: `Kioski (${specDomain.companyName}) on nyt valmiina avaukseen! Kun painat käynnistysnappia, myyntiluukku aukeaa, kylmäaltaat ovat täynnä ja ensimmäiset asiakkaat saapuvat tiskille.`,
      },
    };
  }

  if (isFlorist) {
    return {
      industryLabel: specDomain.industry,
      physicsExplanation: `${specDomain.industry}. Toiminnan ydin: leikkokukkien tuoreus ja kylmäsäilytys (+4°C), floristien käsityönä tekemä sidonta sekä sesonki- ja juhlamyynti.`,
      valueChainColumns: [
        "1. VILJELIJÄT & KUKKATUKUT",
        "2. KYLMÄKULJETUS & JAKELU",
        "3. MYYMÄLÄ & KUKKAKYLMIÖ",
        "4. KUKKASIDONTA & KIMPUT",
        "5. KIVIJALKA & VERKKOKAUPPA",
        "6. KUKKIEN OSTAJAT & JUHLAT",
      ],
      nodeLabels: {
        supplierTag: "KUKKATUKKU / VILJELIJÄ",
        inboundTag: "KYLMÄKULJETUS MYYMÄLÄÄN",
        facilityTag: "MYYMÄLÄ & KUKKAKYLMIÖ",
        facilitySubtitle: "Myymälä & viileäkylmiö (+4°C)",
        facilityMetricLabel: "Kukkasaldot / Kylmiötila",
        workCenterTag: "KUKKASIDONTA & KIMPPUPAJA",
        workCenterQueueLabel: "Sidontapöydän tilausjono",
        channelTag: "MYYMÄLÄ & KUKKATOIMITUS",
        segmentTag: "ASIAKASRYHMÄ",
        addCapacityActionLabel: "Lisää floristin työtunteja (+4h/pv)",
        orderSupplyActionLabel: "Tilaa tuore kukkaerä tukusta",
      },
      canvasConfig: {
        roles: [
          {
            id: "commercial",
            title: "🎯 Kauppias / Myymälä & Yritysasiakkaat",
            sub: "Fokuksesi on myymälän ilmeessä, juhla-asiakkaissa ja verkkokaupan kukkatilauksissa.",
          },
          {
            id: "product",
            title: "💐 Johtava Floristi / Sidonta & Asetelmat",
            sub: "Fokuksesi on kimppujen sidonnassa, kukkien tuoreudessa ja sesonkivalikoimassa.",
          },
          {
            id: "general_manager",
            title: "📊 Kukkakauppias / Hankinnat & Talous",
            sub: "Fokuksesi on kukkahuutokaupan ostoissa, hävikin hallinnassa ja kassavirrassa.",
          },
        ],
        capabilities: [
          {
            key: "production",
            icon: "💐",
            title: "Kukkasidonta & Floristiikka",
            sub: "Omat floristit luovat uniikit kimput ja korkean katteen. Valmiit tukkukimput nopeuttavat perusmyyntiä.",
            inHouseLabel: "Oma sidontapaja",
            outsourceLabel: "Valmiit tukkukimput",
          },
          {
            key: "warehouse",
            icon: "❄️",
            title: "Kukkamyymälä & Kylmiösäilytys",
            sub: "Oma viileäkylmiö (+4°C) pidentää leikkokukkien kestoa. Päivittäinen tukkutoimitus pienentää tilantarvetta.",
            inHouseLabel: "Oma kylmiö & myymälä",
            outsourceLabel: "Suora tukkutoimitus",
          },
          {
            key: "logistics",
            icon: "🚐",
            title: "Kukkalähetti & Kotiinkuljetus",
            sub: "Oma kukkalähetti varmistaa herkkien asetelmien ehjän perillemenon. Kuriiripalvelu joustaa sesonkipiikeissä.",
            inHouseLabel: "Oma kukkalähetti",
            outsourceLabel: "Lähettikumppani",
          },
        ],
        economics: {
          itemLabel: "PÄÄTUOTE (KIMPPU)",
          itemSub: specDomain.finishedItem.name,
          priceLabel: "MYYNTIHINTA",
          priceSub: "Leikkokukkien & tarvikkeiden kulu",
          marginLabel: "MYYNTIKATE",
          marginSub: "Floristinen käsityökate",
        },
        ignitionText: `Kukkakauppasi (${specDomain.companyName}) on valmis! Kun painat käynnistysnappia, tuoreet leikkokukat saapuvat kylmiöön, sidontapöytä käynnistyy ja myymälän ovet avautuvat.`,
      },
    };
  }

  // Generic dynamic derivation directly from specDomain fields (works for bakeries, D2C, factories, dog salons, repair shops, etc.)
  return {
    industryLabel: specDomain.industry,
    physicsExplanation: `${specDomain.industry}. Toiminnan ydin: ${specDomain.workCenter.name.toLowerCase()}, ${specDomain.facility.name.toLowerCase()}, toimitusketju (${specDomain.supplier1.name}) sekä myyntikanavat (${specDomain.channel1.name}).`,
    valueChainColumns: [
      "1. TOIMITTAJAT & HANKINNAT",
      "2. SAAPUVA LOGISTIIKKA",
      "3. TILAT & VARASTO",
      "4. TUOTANTO & PALVELU",
      "5. MYYNTIKANAVAT",
      "6. ASIAKKAAT",
    ],
    nodeLabels: {
      supplierTag: "TOIMITTAJA / KUMPPANI",
      inboundTag: "SAAPUVA TOIMITUS",
      facilityTag: "TOIMIPISTE & VARASTO",
      facilitySubtitle: specDomain.facility.name,
      facilityMetricLabel: "Kapasiteetti & Saldot",
      workCenterTag: "TUOTANTO & PALVELU",
      workCenterQueueLabel: "Työpisteen kuormitus / Jono",
      channelTag: "MYYNTIKANAVA",
      segmentTag: "ASIAKASRYHMÄ",
      addCapacityActionLabel: "Lisää työtunteja (+4h/pv)",
      orderSupplyActionLabel: "Tilaa täydennyserä toimittajalta",
    },
    canvasConfig: {
      roles: [
        {
          id: "commercial",
          title: "🎯 Kaupallinen johtaja / Myynti & Asiakkaat",
          sub: `Fokuksesi on myyntikanavissa (${specDomain.channel1.name}) ja asiakashankinnassa.`,
        },
        {
          id: "product",
          title: isBakery ? "🛠 Chief Product Officer / Mestari" : `🛠 Tuotanto- & Palveluvastaava (${specDomain.roles[1]?.name || "Operatiivinen"})`,
          sub: `Fokuksesi on ydintekemisessä (${specDomain.workCenter.name}) ja laadussa.`,
        },
        {
          id: "general_manager",
          title: `📊 ${specDomain.roles[0]?.name || "Yrittäjä / Toimitusjohtaja"}`,
          sub: "Fokuksesi on kokonaisuuden johtamisessa, hankinnoissa ja kassavirrassa.",
        },
      ],
      capabilities: [
        {
          key: "production",
          icon: "⚙️",
          title: specDomain.workCenter.name,
          sub: "Oma tekeminen takaa laadun ja parhaan katteen. Kumppanin hyödyntäminen tuo joustoa ilman kiinteitä kuluja.",
          inHouseLabel: "Oma tuotanto / tiimi",
          outsourceLabel: "Sopimuskumppani",
        },
        {
          key: "warehouse",
          icon: "🏢",
          title: specDomain.facility.name,
          sub: "Oma toimitila ja varasto antavat täyden hallinnan. Kevyt kumppanimalli säästää kiinteissä tilavuokrissa.",
          inHouseLabel: "Oma toimitila & kalusto",
          outsourceLabel: "Kumppanin tilat / 3PL",
        },
        {
          key: "logistics",
          icon: "🚚",
          title: `${specDomain.inboundLane.name} & Toimitukset`,
          sub: "Oma kuljetus ja jakelu varmistaa nopeuden. Ulkoinen kuljetuskumppani skaalautuu ilman kalustoriskiä.",
          inHouseLabel: "Oma kuljetus",
          outsourceLabel: "Kuljetuskumppani",
        },
      ],
      economics: {
        itemLabel: "PÄÄTUOTE / SUORITE",
        itemSub: specDomain.finishedItem.name,
        priceLabel: "MYYNTIHINTA",
        priceSub: "Arvioitu yksikkökustannus",
        marginLabel: "BRUTTOKATE",
        marginSub: "Myyntikate per yksikkö",
      },
      ignitionText: `Yrityksesi (${specDomain.companyName}) toimintamalli on nyt valmis! Kun painat käynnistysnappia, Päivä 1 käynnistyy, ${specDomain.workCenter.name.toLowerCase()} alkaa ja ensimmäiset asiakkaat saapuvat kanaviin.`,
    },
    evolutionStages: buildEvolutionStagesForNameAndIndustry(
      specDomain.companyName,
      specDomain.industry,
      specDomain.facility.name,
      specDomain.workCenter.name,
      specDomain.channel1.name,
    ),
  };
}

export function buildEvolutionStagesForNameAndIndustry(
  companyName: string,
  industry: string,
  facilityName: string,
  workCenterName: string,
  channelName: string,
): EvolutionStageSpec[] {
  const lower = `${companyName} ${industry} ${facilityName} ${workCenterName}`.toLowerCase();
  const isIceCreamOrDessert =
    lower.includes("jäätelö") || lower.includes("gelato") || lower.includes("ice cream") || lower.includes("jälkiruoka");
  const isKioskOrFood =
    isIceCreamOrDessert ||
    lower.includes("kioski") ||
    lower.includes("grilli") ||
    lower.includes("nakkikiska") ||
    lower.includes("kahvila") ||
    lower.includes("leipomo");
  const isService =
    lower.includes("konsult") ||
    lower.includes("osaamis") ||
    lower.includes("toimisto") ||
    lower.includes("advisory") ||
    lower.includes("trimma") ||
    lower.includes("salonki");

  if (isIceCreamOrDessert) {
    return [
      {
        stage: 1,
        title: "Vaihe 1: Yksittäinen Jäätelökioski",
        subtitle: "1 myyntipiste torilla, jäätelöaltaat ja vohvelit tukusta, välitön kassavirta luukulta.",
        unlockCostEuros: 0,
        demandMultiplier: 1,
        newFacilityName: facilityName,
        newWorkCenterName: workCenterName,
        newChannelName: channelName,
        newSegmentName: "Torin kesäasiakkaat & perheet",
        newRoleTitle: "Kioskiyrittäjä",
        gameTheoryNote: "Hotellingin sijaintipeli: kilpailet viereisen kahvilan ja lähimarketin pakastealtaan kanssa nopeudella, sijainnilla ja tuoreudella.",
      },
      {
        stage: 2,
        title: "Vaihe 2: Kaupunkiketju (4 Kioskia) & Oma Artesaanijäätelöpaja",
        subtitle: "Avaat 3 uutta huippupaikan kioskia ja oman jäätelöpajan — valmistat omat nimikkojäätelöt itse korkeammalla katteella.",
        unlockCostEuros: 15_000,
        demandMultiplier: 2.5,
        newFacilityName: "Kaupunkiketjun 4 Kioskia & Kylmävarasto (-22°C)",
        newWorkCenterName: "Oma Artesaanijäätelöpaja & Kioskien Palvelutiskit",
        newChannelName: "Kaupungin 4 Nimikkokioskia & Wolt-kotiinkuljetus",
        newSegmentName: "Kaupunkilaiset herkkusuut & kotiinkuljetusasiakkaat",
        newRoleTitle: "Jäätelömestari & Pajan Vastaava",
        gameTheoryNote: "Nash-erilaistuminen: oma artesaaniresepti irrottaa sinut markettien hintasodasta (Vangin dilemma) ja nostaa asiakkaiden maksuhalukkuutta.",
      },
      {
        stage: 3,
        title: "Vaihe 3: Valtakunnallinen Jäätelöbrändi & Kauppajakelu (K- & S-Ryhmä)",
        subtitle: "Omat 500 ml jäätelöpurkit satojen ruokakauppojen pakastealtaisiin ympäri maan sekä valtakunnallinen lippulaivaketju.",
        unlockCostEuros: 65_000,
        demandMultiplier: 6.0,
        newFacilityName: "Valtakunnallinen Jäätelötehdas & Keskuspakastamo",
        newWorkCenterName: "Teollinen Jäätelö- & Pakkauslinjasto (Purkit & Puikot)",
        newChannelName: "Päivittäistavarakaupat (K- & S-ryhmä) & HoReCa-tukku",
        newSegmentName: "Valtakunnalliset ruokakauppa-asiakkaat & ravintolat",
        newRoleTitle: "Avainasiakasjohtaja (B2B Kaupparyhmät & Jakelu)",
        gameTheoryNote: "Stackelberg-kanavapeli & Neuvotteluvoima: neuvottelet keskusliikkeiden hyllytilasta, volyymialennuksista ja 30 pv maksuajoista.",
      },
      {
        stage: 4,
        title: "Vaihe 4: Monikansallinen Jälkiruokakonserni (Nordics & Europe)",
        subtitle: "Pohjoismaiden ja Keski-Euroopan vienti, automatisoitu suurtehdas, yritysostot (M&A) ja täysi konsernijohto.",
        unlockCostEuros: 180_000,
        demandMultiplier: 14.0,
        newFacilityName: "Pohjoismaiden & Euroopan Jälkiruokatehdas & Kylmähubi",
        newWorkCenterName: "Automaattinen Suurtuotanto- & Vientipakkauslinja",
        newChannelName: "Kansainvälinen Vähittäiskauppa- & Vientiverkosto (EU)",
        newSegmentName: "Euroopan kuluttajamarkkinat & kansainväliset kauppaketjut",
        newRoleTitle: "Kansainvälisen Liiketoiminnan Johtaja (VP International & M&A)",
        gameTheoryNote: "Oligopolistinen markkinapeli (Cournot & Bertrand): globaalit elintarvikejätit reagoivat markkinaosuuteesi; skaalaetu ratkaisee yksikkökustannuksen.",
      },
    ];
  }

  if (isKioskOrFood) {
    return [
      {
        stage: 1,
        title: "Vaihe 1: Yksittäinen Toimipiste & Yrittäjävetoinen Aloitus",
        subtitle: "Ensimmäinen myyntipiste, suorat tukkuostot ja päivittäinen asiakasvirta luukulla.",
        unlockCostEuros: 0,
        demandMultiplier: 1,
        newFacilityName: facilityName,
        newWorkCenterName: workCenterName,
        newChannelName: channelName,
        newSegmentName: "Paikalliset asiakkaat & ohikulkijat",
        newRoleTitle: "Yrittäjä / Pisteen vastaava",
        gameTheoryNote: "Hotellingin sijaintipeli: voitat lähikilpailijat tuoreudella, nopeudella ja näkyvyydellä.",
      },
      {
        stage: 2,
        title: "Vaihe 2: Kaupunkiketju (3–5 Pistettä) & Oma Keskusvalmistus",
        subtitle: "Laajennat useampaan myyntipisteeseen ja keskität valmistuksen omaan keskuskeittiöön.",
        unlockCostEuros: 18_000,
        demandMultiplier: 2.5,
        newFacilityName: `${companyName} — Keskuskeittiö & Kaupunkipisteet`,
        newWorkCenterName: "Keskusvalmistus & Toimipisteiden Asiakaspalvelu",
        newChannelName: "Kaupunkiketjun Myyntipisteet & Kotiinkuljetus",
        newSegmentName: "Koko kaupungin asiakaskunta & kotiinkuljetus",
        newRoleTitle: "Keittiömestari / Tuotantopäällikkö",
        gameTheoryNote: "Nash-erilaistuminen: oma brändi ja tasalaatuinen tuote estävät paikallisen hintasodan.",
      },
      {
        stage: 3,
        title: "Vaihe 3: Valtakunnallinen Brändiketju & B2B-Kauppajakelu",
        subtitle: "Valtakunnallinen toimipisteverkosto ja omat tuotteet vähittäiskauppojen hyllyille.",
        unlockCostEuros: 70_000,
        demandMultiplier: 6.0,
        newFacilityName: `${companyName} — Valtakunnallinen Tuotantolaitos & Terminaali`,
        newWorkCenterName: "Valtakunnallinen Tuotanto- & Pakkauslinja",
        newChannelName: "Valtakunnallinen Ketju & Päivittäistavarakaupat (B2B)",
        newSegmentName: "Valtakunnalliset kuluttajat & kaupparyhmät",
        newRoleTitle: "Kaupallinen Johtaja (Valtakunnallinen Jakelu)",
        gameTheoryNote: "Stackelberg-peli: suurempi osto- ja myyntivolyymi antaa neuvotteluvoiman tukkujen ja kauppaketjujen suuntaan.",
      },
      {
        stage: 4,
        title: "Vaihe 4: Monikansallinen Elintarvike- & Ravintolakonserni",
        subtitle: "Kansainvälinen vienti, franchising- ja tytäryhtiöverkosto sekä yritysostot (M&A).",
        unlockCostEuros: 190_000,
        demandMultiplier: 14.0,
        newFacilityName: `${companyName} — Pohjoismaiden & Euroopan Logistiikkakeskus`,
        newWorkCenterName: "Kansainvälinen Suurtuotanto & Konserniohjaus",
        newChannelName: "Pohjoismaiden & Euroopan Myynti- ja Vientikanavat",
        newSegmentName: "Kansainväliset kuluttaja- ja B2B-markkinat",
        newRoleTitle: "Konsernin Kasvu- & Yritysostojohtaja (VP International & M&A)",
        gameTheoryNote: "Oligopolipeli: hallitset markkinaa skaalaedulla, brändillä ja yritysostoilla.",
      },
    ];
  }

  if (isService) {
    return [
      {
        stage: 1,
        title: "Vaihe 1: Yksinyrittäjä / Erikoistunut Studio",
        subtitle: "Myyt omaa huippuosaamistasi ja palveluasi suoraan ensimmäisille asiakkaille.",
        unlockCostEuros: 0,
        demandMultiplier: 1,
        newFacilityName: facilityName,
        newWorkCenterName: workCenterName,
        newChannelName: channelName,
        newSegmentName: "Ensimmäiset suora-asiakkaat",
        newRoleTitle: "Perustaja & Johtava Asiantuntija",
        gameTheoryNote: "Maine- ja luottamuspeli: asiakas valitsee todistetun osaamisen halvimman tuntihinnan sijaan.",
      },
      {
        stage: 2,
        title: "Vaihe 2: Asiantuntijatoimisto & Moniammatillinen Tiimi",
        subtitle: "Palkkaat tiimin, tuotteistat palvelupaketit ja kasvatat kuukausittaista sopimuslaskutusta.",
        unlockCostEuros: 20_000,
        demandMultiplier: 2.5,
        newFacilityName: `${companyName} — Pääkaupunkiseudun Toimisto & Studio`,
        newWorkCenterName: "Asiantuntijatiimit & Tuotteistetut Palveluprojektit",
        newChannelName: "Ratkaisumyynti & Jatkuvat Palvelusopimukset (Retainer)",
        newSegmentName: "Kasvuyritykset & toistuvat sopimusasiakkaat",
        newRoleTitle: "Tiiminvetäjä / Senior Specialist",
        gameTheoryNote: "Vaihtokustannuspeli (Switching Cost): jatkuvat sopimukset lukitsevat asiakassuhteen ja suojaavat kilpailijoilta.",
      },
      {
        stage: 3,
        title: "Vaihe 3: Valtakunnallinen Markkinajohtaja & Kumppaniverkosto",
        subtitle: "Usean kaupungin toimipisteet, oma digitaalinen palvelualusta ja suuryritysasiakkaat.",
        unlockCostEuros: 75_000,
        demandMultiplier: 6.0,
        newFacilityName: `${companyName} — Valtakunnalliset Toimipisteet & Digialusta`,
        newWorkCenterName: "Valtakunnallinen Palvelutuotanto & Skaalautuva Alusta",
        newChannelName: "Enterprise-puitesopimukset & Valtakunnallinen Verkosto",
        newSegmentName: "Valtakunnalliset suuryritykset & julkishallinto",
        newRoleTitle: "Enterprise-asiakkuusjohtaja (Head of Key Accounts)",
        gameTheoryNote: "Verkostovaikutus & Signalling-peli: markkinajohtajan asema voittaa suuret puitesopimuskilpailutukset.",
      },
      {
        stage: 4,
        title: "Vaihe 4: Monikansallinen Palvelu- & Teknologiakonserni",
        subtitle: "Kansainväliset tytäryhtiöt, skaalautuva lisenssi-/alustaliiketoiminta ja yritysostot (M&A).",
        unlockCostEuros: 200_000,
        demandMultiplier: 14.0,
        newFacilityName: `${companyName} — International Group HQ & Cloud Hub`,
        newWorkCenterName: "Kansainvälinen Toimitusorganisaatio & Digitaaliset Tuotteet",
        newChannelName: "Kansainvälinen Enterprise-myynti & Lisenssikanava",
        newSegmentName: "Euroopan ja Pohjoismaiden suuryritysmarkkina",
        newRoleTitle: "Kansainvälisten Toimintojen Johtaja (EVP Global & M&A)",
        gameTheoryNote: "Globaali oligopolipeli: yhdistät korkean katteen teknologia-IP:n ja kansainvälisen toimituskyvyn.",
      },
    ];
  }

  return [
    {
      stage: 1,
      title: "Vaihe 1: Yrittäjävetoinen Aloitus & Ensimmäinen Toimipiste",
      subtitle: "Ensimmäiset tuotteet, suorat toimittajat ja ensimmäinen asiakaskunta.",
      unlockCostEuros: 0,
      demandMultiplier: 1,
      newFacilityName: facilityName,
      newWorkCenterName: workCenterName,
      newChannelName: channelName,
      newSegmentName: "Ensimmäiset kuluttaja- ja yritysasiakkaat",
      newRoleTitle: "Perustaja & Yrittäjä",
      gameTheoryNote: "Fokus- ja erilaistumispeli: voitat ensimmäiset asiakkaat erikoistumisella ja nopealla palvelulla.",
    },
    {
      stage: 2,
      title: "Vaihe 2: Paikallinen Kasvuyritys & Oma Tuotantolinja",
      subtitle: "Kasvatat kapasiteettia, palkkaat avaintiimin ja avaat uusia myyntikanavia.",
      unlockCostEuros: 22_000,
      demandMultiplier: 2.5,
      newFacilityName: `${companyName} — Laajennettu Toimitila & Varasto`,
      newWorkCenterName: `${workCenterName} (Laajennettu Tuotanto)`,
      newChannelName: `${channelName} + Verkkokauppa & Kumppanit`,
      newSegmentName: "Alueelliset kanta-asiakkaat & jälleenmyyjät",
      newRoleTitle: "Tuotanto- & Laadunvarmistusvastaava",
      gameTheoryNote: "Nash-erilaistuminen: korkeampi laatu ja brändi suojaavat katetta halpakilpailijoilta.",
    },
    {
      stage: 3,
      title: "Vaihe 3: Valtakunnallinen Ketju & B2B-Sopimusjakelu",
      subtitle: "Keskusvarasto, teollinen mittakaava ja valtakunnalliset jakelusopimukset.",
      unlockCostEuros: 80_000,
      demandMultiplier: 6.0,
      newFacilityName: `${companyName} — Valtakunnallinen Keskusvarasto & Tehdas`,
      newWorkCenterName: "Teollisen Mittakaavan Tuotanto- & Toimituslinja",
      newChannelName: "Valtakunnallinen B2B-Jakelu & Verkkokauppa",
      newSegmentName: "Valtakunnalliset ketju- ja kuluttaja-asiakkaat",
      newRoleTitle: "Valtakunnallinen Myynti- & Jakelujohtaja",
      gameTheoryNote: "Stackelberg-neuvottelupeli: volyymietu alentaa yksikköhankintahintaa ja avaa suuret jakelukanavat.",
    },
    {
      stage: 4,
      title: "Vaihe 4: Monikansallinen Konserni & Vientiyhtiö",
      subtitle: "Kansainvälinen vienti, automatisoitu suurtuotanto, yritysostot (M&A) ja konsernijohto.",
      unlockCostEuros: 210_000,
      demandMultiplier: 14.0,
      newFacilityName: `${companyName} — Euroopan Tuotanto- & Logistiikkakeskus`,
      newWorkCenterName: "Automaattinen Konsernituotanto & Vientilogistiikka",
      newChannelName: "Pohjoismaiden & Euroopan Vienti- ja B2B-kanavat",
      newSegmentName: "Kansainväliset vientimarkkinat & suuryritykset",
      newRoleTitle: "Kansainvälisen Liiketoiminnan Johtaja (VP International & M&A)",
      gameTheoryNote: "Oligopolipeli (Cournot & Bertrand): skaalaetu, kansainvälinen jakeluvoima ja yritysostot.",
    },
  ];
}

export function getEvolutionStagesForState(state: WorldState): EvolutionStageSpec[] {
  if (
    state.company.domainUi?.evolutionStages &&
    state.company.domainUi.evolutionStages.length >= 4
  ) {
    return state.company.domainUi.evolutionStages;
  }
  const built = buildEvolutionStagesForNameAndIndustry(
    state.company.name,
    state.company.industry,
    state.warehouses.sites[0]?.name ?? "Toimipiste",
    state.operations.workCenters[0]?.name ?? "Valmistus & Palvelu",
    state.commercial.channels[0]?.name ?? "Myyntikanava",
  );
  if (state.company.domainUi) {
    state.company.domainUi.evolutionStages = built;
  }
  return built;
}

/**
 * Scale the venture to the next evolutionary stage (Stage 1 -> 2 -> 3 -> 4).
 * Mutates `state` in place while strictly preserving double-entry accounting invariants.
 */
export function evolveVentureToNextStage(state: WorldState): {
  ok: boolean;
  stage: number;
  title: string;
  summary: string;
} {
  const currentStage = state.company.ventureStage ?? 1;
  const stages = getEvolutionStagesForState(state);
  if (currentStage >= 4) {
    return {
      ok: false,
      stage: 4,
      title: stages[3]?.title ?? "Vaihe 4",
      summary: "Yritys toimii jo korkeimmassa Vaiheessa 4 (Monikansallinen konserni & M&A).",
    };
  }

  const nextStageNum = currentStage + 1;
  const spec = stages.find((s) => s.stage === nextStageNum) ?? stages[nextStageNum - 1];
  const tick = state.calendar.tick;
  const costCents = Math.round(spec.unlockCostEuros * 100);

  // Book balanced growth CapEx investment (financed via cash if plentiful, otherwise growth loan)
  if (costCents > 0) {
    const currentCash = debitBalance(state.finance.ledger, "cash");
    const cashPortion =
      currentCash > costCents + 25_000_00
        ? costCents
        : currentCash > 40_000_00
          ? Math.min(costCents, Math.round((currentCash - 25_000_00) * 0.5))
          : 0;
    const loanPortion = costCents - cashPortion;

    state.finance.fixedAssets.push({
      id: nextId(state, "fa"),
      name: `${spec.title} — Kasvuinvestointi & Kalusto`,
      kind: "automation",
      cost: costCents,
      salvage: Math.round(costCents * 0.1),
      usefulLifeDays: 1080,
      acquiredTick: tick,
      accumulatedDepreciation: 0,
      linked: {
        kind: "work_center",
        id: state.operations.workCenters[0]?.id ?? "wc_0",
      },
    });

    if (cashPortion > 0) {
      postJournal(state, {
        memo: `Kasvuinvestointi (${spec.title}) — Käteisosuus`,
        source: "action:scale_stage_cash",
        cashFlow: "investing",
        lines: [
          { account: "ppe_gross", amount: cashPortion },
          { account: "cash", amount: -cashPortion },
        ],
      });
    }

    if (loanPortion > 0) {
      state.finance.debts.push({
        id: nextId(state, "debt"),
        kind: "term",
        lender: `${state.company.name} — Kasvu- & Laajennuslaina (Vaihe ${nextStageNum})`,
        limit: loanPortion,
        principal: loanPortion,
        spreadBps: 290,
        monthlyAmortization: Math.round(loanPortion / 36),
        maturityTick: tick + 1080,
        covenants: [],
        status: "active",
        consecutiveBreaches: 0,
      });
      postJournal(state, {
        memo: `Kasvuinvestointi (${spec.title}) — Kasvulaina`,
        source: "action:scale_stage_loan",
        lines: [
          { account: "ppe_gross", amount: loanPortion },
          { account: "term_debt", amount: -loanPortion },
        ],
      });
    }
  }

  state.company.ventureStage = nextStageNum;
  state.company.tagline = `${spec.title} • ${spec.subtitle}`;

  // 1. Expand Facility / Warehouse
  const wh = state.warehouses.sites[0];
  if (wh) {
    wh.name = spec.newFacilityName;
    wh.receivingUnitsPerDay = Math.round(wh.receivingUnitsPerDay * 2.1);
    wh.pickPackUnitsPerDay = Math.round(wh.pickPackUnitsPerDay * 2.1);
    wh.automationLevel = clamp(wh.automationLevel + 0.16, 0, 0.96);
    for (const z of wh.zones) {
      z.capacityM3 = Math.round(z.capacityM3 * 2.2);
    }
  }

  // 2. Expand Work Center & Production Policy
  const wc = state.operations.workCenters[0];
  if (wc) {
    wc.name = spec.newWorkCenterName;
    wc.machineHoursPerDay = Math.round(wc.machineHoursPerDay * 2.1);
    wc.laborHoursPerDay = Math.round(wc.laborHoursPerDay * 2.1);
    wc.condition = Math.max(wc.condition, 0.95);
  }
  if (state.operations.policies[0]) {
    state.operations.policies[0].targetStockUnits = Math.round(
      state.operations.policies[0].targetStockUnits * 1.8,
    );
    state.operations.policies[0].maxBatchesPerDay = Math.round(
      state.operations.policies[0].maxBatchesPerDay * 1.8,
    );
  }

  // 3. Expand Channels & Customer Segments
  if (state.commercial.channels[1]) {
    state.commercial.channels[1].name = spec.newChannelName;
    if (nextStageNum >= 3) {
      state.commercial.channels[1].paymentTermsDays = 21;
    }
  } else if (state.commercial.channels[0]) {
    state.commercial.channels[0].name = spec.newChannelName;
  }

  state.market.segments.forEach((seg, idx) => {
    if (idx === 1) {
      seg.name = spec.newSegmentName;
    }
    seg.baseDailyDemand = Math.max(8, Math.round(seg.baseDailyDemand * 1.75));
    seg.wtpMean = Math.round(seg.wtpMean * 1.06);
  });
  state.market.presence.forEach((pres) => {
    pres.awareness = clamp(pres.awareness + 0.12, 0.05, 0.98);
    pres.brandEquity = clamp(pres.brandEquity + 0.1, 0.05, 0.98);
    pres.potentialToday = Math.round(pres.potentialToday * 1.75);
  });

  // 4. Improve Supplier Bargaining Terms (Volume discount & better reliability)
  state.supply.suppliers.forEach((sup) => {
    sup.reliability = clamp(sup.reliability + 0.03, 0.5, 0.99);
    sup.relationship = clamp(sup.relationship + 0.12, 0.1, 0.99);
    sup.offers.forEach((off) => {
      off.unitPrice = Math.max(15, Math.round(off.unitPrice * 0.93));
    });
  });

  // 5. Add New Stage Role & Headcount
  const newRoleId = `role_stage_${nextStageNum}`;
  if (!state.org.roles.some((r) => r.id === newRoleId)) {
    const deptId = state.org.departments[0]?.id ?? "dept_0";
    const salary = nextStageNum === 2 ? 42_000_00 : nextStageNum === 3 ? 62_000_00 : 88_000_00;
    state.org.roles.push({
      id: newRoleId,
      title: spec.newRoleTitle,
      departmentId: deptId,
      tier: nextStageNum >= 3 ? "executive" : "specialist",
      reportsToRoleId: state.org.roles[0]?.id,
      annualSalary: salary,
      marketSalary: salary,
      benefitsLoad: 0.2,
      hoursPerDay: 8,
      isManager: nextStageNum >= 3,
      idealSpan: 6,
      isDirectLabor: nextStageNum === 2,
      rampDays: 14,
      recruitingLeadDays: { kind: "fixed", value: 7 },
      recruitingCost: 1_500_00,
      severanceWeeks: 2,
    });
    state.org.positions.push({
      roleId: newRoleId,
      cohorts: [{ count: 1, hiredTick: tick }],
      pendingHires: [],
      morale: 0.9,
      proficiency: 0.92,
      fatigue: 0.05,
      overtimeHoursPerPerson: 0,
      attritionYtd: 0,
      laborHoursAvailable: 8,
      laborHoursUsed: 0,
    });
  }

  pushNotification(state, {
    severity: "info",
    category: "strategy",
    message: `🚀 Yritys skaalattu tasolle ${spec.title}! Kapasiteetti, jakelukanavat (${spec.newChannelName}) ja tiimi (${spec.newRoleTitle}) päivitetty.`,
  });

  return {
    ok: true,
    stage: nextStageNum,
    title: spec.title,
    summary: `Yritys skaalattu tasolle ${spec.title}! Toimitila (${spec.newFacilityName}), valmistus (${spec.newWorkCenterName}) ja jakelu (${spec.newChannelName}) ovat nyt käynnissä.`,
  };
}

export interface GameTheoryAnalysis {
  regimeName: string;
  regimeDescription: string;
  playerAvgPriceCents: number;
  competitorAvgPriceCents: number;
  priceRatio: number;
  priceWarRiskPct: number;
  buyerPowerPct: number;
  supplierDependencyWarning: string;
  payoffMatrix: {
    differentiateHold: { title: string; playerOutcome: string; compOutcome: string; tag: string };
    differentiateCut: { title: string; playerOutcome: string; compOutcome: string; tag: string };
    undercutHold: { title: string; playerOutcome: string; compOutcome: string; tag: string };
    undercutWar: { title: string; playerOutcome: string; compOutcome: string; tag: string };
  };
}

export function computeGameTheoryAnalysis(state: WorldState): GameTheoryAnalysis {
  const stage = state.company.ventureStage ?? 1;
  const off0 = state.commercial.offerings[0];
  const ost0 = state.commercial.offeringStates[0];
  const playerPrice =
    ost0?.lastPrice ??
    (off0?.pricing.kind === "value_based" ? off0.pricing.listPrice : 10_00);

  const compPrices = state.market.competitors
    .map((c) => c.offerings[0]?.price ?? playerPrice)
    .filter((p) => p > 0);
  const compAvgPrice =
    compPrices.length > 0
      ? Math.round(compPrices.reduce((a, b) => a + b, 0) / compPrices.length)
      : playerPrice;

  const priceRatio = compAvgPrice > 0 ? playerPrice / compAvgPrice : 1;
  const avgBrand =
    state.market.presence.length > 0
      ? state.market.presence.reduce((s, p) => s + p.brandEquity, 0) / state.market.presence.length
      : 0.35;

  const priceWarRiskPct = Math.round(
    clamp((1.05 - priceRatio) * 140 + (0.45 - avgBrand) * 50, 8, 92),
  );
  const buyerPowerPct = Math.round(
    clamp(22 + (stage - 1) * 22 + state.supply.suppliers.length * 8, 15, 95),
  );

  let regimeName = "Hotellingin Sijainti- & Palvelupeli (Paikallinen Kilpailu)";
  let regimeDescription =
    "Asiakkaat valitsevat ostospaikan sijainnin, jonotusajan ja mielikuvan perusteella. Hinnan laskeminen alle kilpailijoiden käynnistää helposti turhan hintasodan (Vangin dilemma), kun taas nopeampi palvelu ja näkyvyys kasvattavat myyntiä täydellä katteella.";

  if (stage === 2) {
    regimeName = "Nash-Erilaistumispeli (Monipisteverkosto & Oma Brändi)";
    regimeDescription =
      "Oma valmistus ja useampi toimipiste erottavat sinut peruskilpailijoista. Kun pidät laadun ja tunnettuuden korkealla, kilpailijoiden hinnanalennukset eivät vie kanta-asiakkaitasi.";
  } else if (stage === 3) {
    regimeName = "Stackelberg-Kanavapeli & Neuvotteluvoima (Keskusliikkeet & B2B)";
    regimeDescription =
      "Volyymisi antaa sinulle neuvotteluvoimaa tavarantoimittajien suuntaan (alhaisempi yksikkökustannus), mutta suuret jakelukanavat vaativat toimitusvarmuutta (SLA) ja maksuaikaa.";
  } else if (stage >= 4) {
    regimeName = "Oligopolistinen Markkinapeli (Cournot & Bertrand -tasapaino)";
    regimeDescription =
      "Toimit suuren mittakaavan markkinajohtajana. Kilpailijat seuraavat hinnoitteluasi ja kapasiteettiasi (Tit-for-Tat): hallitset markkinaa skaalaedulla ja brändipääomalla.";
  }

  const supplierDependencyWarning =
    buyerPowerPct < 45
      ? "Korkea toimittajariippuvuus: Pienen volyymin vuoksi tukuilla on hinnoitteluvoima. Kasvata tilausmääriä, neuvottele maksuaikaa tai skaalaa Vaiheeseen 2 saadaksesi volyymialennukset (-7% .. -15%)."
      : "Vahva ostajan neuvotteluasema (Buyer Power): Suuri volyymisi pakottaa tavarantoimittajat kilpailemaan sopimuksestasi ja myöntämään alennuksia sekä maksuaikaa.";

  return {
    regimeName,
    regimeDescription,
    playerAvgPriceCents: playerPrice,
    competitorAvgPriceCents: compAvgPrice,
    priceRatio,
    priceWarRiskPct,
    buyerPowerPct,
    supplierDependencyWarning,
    payoffMatrix: {
      differentiateHold: {
        title: "Nash-tasapaino (Suositus): Laatu + Vahva Kate",
        playerOutcome: "Sinä: Korkea myyntikate, uskollinen asiakasvirta (+markkinaosuus)",
        compOutcome: "Kilpailijat: Pysyvät omalla hintatasollaan, ei hintasotaa",
        tag: "PARAS YHTEISTULOS",
      },
      differentiateCut: {
        title: "Laatuerilaistuminen vs. Kilpailijan Alekampanja",
        playerOutcome: "Sinä: Säilytät laatutietoiset asiakkaat ja terveen katteen",
        compOutcome: "Kilpailijat: Voittavat vain hintaherkimmät ostajat heikolla katteella",
        tag: "SUOJATTU KATE",
      },
      undercutHold: {
        title: "Lyhytaikainen Hintaryöstö (Ennen vastareaktiota)",
        playerOutcome: "Sinä: Hetkellinen volyymipiikki, mutta matalampi kate/annos",
        compOutcome: "Kilpailijat: Menettävät myyntiä ja valmistelevat vastaiskua",
        tag: "LYHYTAIKAINEN ETU",
      },
      undercutWar: {
        title: "Vangin Dilemma (Hintasota): Molemmat laskevat hintaa",
        playerOutcome: "Sinä: Myyntikate sulaa, kassavirta heikkenee",
        compOutcome: "Kilpailijat: Nokittavat hinnalla alas — molemmat häviävät",
        tag: "VÄLTÄ HINTASOTAA",
      },
    },
  };
}

function synthesizeCustomBusinessState(
  prompt: string,
  seed: number,
  explicitArchetype?: IndustryArchetype,
): WorldState {
  const archetype = explicitArchetype ?? classifyPromptArchetype(prompt);

  const base =
    archetype === "B2B_ENTERPRISE_SERVICES"
      ? buildColdChainLogisticsScenario(seed)
      : archetype === "ASSET_HEAVY_MANUFACTURING"
        ? buildCustomEbikeScenario(seed)
        : buildVerticalFarmScenario(seed);

  const specDomain = resolveEndToEndDomain(prompt, archetype, seed);
  const domainUi = deriveDomainUiFromSpec(specDomain, archetype);
  if (!domainUi.evolutionStages || domainUi.evolutionStages.length < 4) {
    domainUi.evolutionStages = buildEvolutionStagesForNameAndIndustry(
      specDomain.companyName,
      specDomain.industry,
      specDomain.facility.name,
      specDomain.workCenter.name,
      specDomain.channel1.name,
    );
  }

  base.company.id = `comp_${Math.abs(seed % 100000)}`;
  base.company.name = specDomain.companyName;
  base.company.industry = specDomain.industry;
  base.company.archetype = archetype;
  base.company.tagline = specDomain.tagline;
  base.company.currency = "USD";
  base.company.prompt = prompt;
  base.company.ventureStage = 1;
  base.company.domainUi = domainUi;

  // 1. Suppliers
  if (base.supply.suppliers[0]) {
    base.supply.suppliers[0].name = specDomain.supplier1.name;
    base.supply.suppliers[0].region = specDomain.supplier1.region;
    base.supply.suppliers[0].leadTimeDays = { kind: "fixed", value: specDomain.supplier1.leadTimeDays };
    base.supply.suppliers[0].offers = [
      {
        itemId: "item_raw_1",
        unitPrice: specDomain.supplier1.itemCostCents,
        moq: computeSensibleMoq(specDomain.supplier1.itemCostCents),
        priceBreaks: [],
      },
    ];
  }
  if (base.supply.suppliers[1]) {
    base.supply.suppliers[1].name = specDomain.supplier2.name;
    base.supply.suppliers[1].region = specDomain.supplier2.region;
    base.supply.suppliers[1].leadTimeDays = { kind: "fixed", value: specDomain.supplier2.leadTimeDays };
    base.supply.suppliers[1].offers = [
      {
        itemId: "item_raw_2",
        unitPrice: specDomain.supplier2.itemCostCents,
        moq: computeSensibleMoq(specDomain.supplier2.itemCostCents),
        priceBreaks: [],
      },
    ];
  }

  // 2. Lanes (Trim to single inbound freight lane for the synthesized domain)
  if (base.supply.lanes[0]) {
    base.supply.lanes[0].name = specDomain.inboundLane.name;
    base.supply.lanes[0].mode = specDomain.inboundLane.mode;
    base.supply.lanes = [base.supply.lanes[0]];
  }

  // 3. Departments, Roles & Positions (Completely rebuilt from specDomain.roles with 4 clear growth roles)
  const paddedRoleSpecs = [...specDomain.roles];
  if (paddedRoleSpecs.length < 3) {
    paddedRoleSpecs.push({
      name: "Myynti- & Markkinointivastaava (CRO)",
      department: "Myynti & Markkinointi",
      salary: 33_000_00,
    });
  }
  if (paddedRoleSpecs.length < 4) {
    paddedRoleSpecs.push({
      name: "Talous- & Hallintovastaava (CFO)",
      department: "Talous & Hallinto",
      salary: 36_000_00,
    });
  }

  const builtDepts = paddedRoleSpecs.map((rSpec, idx) => ({
    id: `dept_${idx}`,
    name: rSpec.department,
    headRoleId: `role_${idx}`,
  }));
  const builtRoles = paddedRoleSpecs.map((rSpec, idx) => ({
    id: `role_${idx}`,
    title: rSpec.name,
    departmentId: `dept_${idx}`,
    tier: (idx === 0 ? "executive" : idx === 1 ? "specialist" : "frontline") as
      | "executive"
      | "management"
      | "specialist"
      | "frontline",
    reportsToRoleId: idx === 0 ? undefined : "role_0",
    annualSalary: rSpec.salary,
    marketSalary: rSpec.salary,
    benefitsLoad: 0.2,
    hoursPerDay: 8,
    isManager: idx === 0,
    idealSpan: idx === 0 ? 6 : 0,
    isDirectLabor: idx === 1 || idx === 0,
    rampDays: 14,
    recruitingLeadDays: { kind: "fixed" as const, value: 7 },
    recruitingCost: Math.max(500_00, Math.round(rSpec.salary * 0.05)),
    severanceWeeks: 2,
    sales:
      idx === 0 || idx === 2
        ? {
            leadsPerDay: 0.5,
            maxOpenOpportunities: 12,
            segmentIds: base.market.segments.map((s) => s.id),
          }
        : undefined,
  }));
  const builtPositions = builtRoles.map((r, idx) => ({
    roleId: r.id,
    cohorts: idx < specDomain.roles.length ? [{ count: 1, hiredTick: 0 }] : [],
    pendingHires: [],
    morale: 0.88,
    proficiency: 0.9,
    fatigue: 0.08,
    overtimeHoursPerPerson: 0,
    attritionYtd: 0,
    laborHoursAvailable: idx < specDomain.roles.length ? 8 : 0,
    laborHoursUsed: 0,
  }));

  base.org.departments = builtDepts;
  base.org.roles = builtRoles;
  base.org.positions = builtPositions;

  // 3b. Capabilities & Processes (Completely rebuilt from domainUi.canvasConfig.capabilities)
  const opRoleId = builtRoles[1]?.id ?? builtRoles[0].id;
  const builtCaps = domainUi.canvasConfig.capabilities.map((cSpec, idx) => ({
    id: `cap_${idx}`,
    name: cSpec.title,
    level: 2 as const,
    description: cSpec.sub,
    maturity: 3.5,
    requiredMaturity: 3.4,
    dailyInvestment: Math.max(15_00, Math.round(specDomain.facility.rentPerDay * 0.25)),
    maintenanceSpendPerDay: Math.max(10_00, Math.round(specDomain.facility.rentPerDay * 0.18)),
    costPerMaturityPoint: 12_000_00,
    decayPerDay: 0.003,
    ownerRoleId: builtRoles[idx % specDomain.roles.length].id,
    pillars: { people: 0.4, process: 0.35, technology: 0.25 },
    sourcing: "insourced" as const,
  }));
  base.operations.capabilities = builtCaps;

  base.org.processes = [
    {
      id: "proc_core_ops",
      name: `${specDomain.workCenter.name} — Laatu & Toimitusvarmuus`,
      capabilityId: builtCaps[0]?.id,
      accountableRoleId: builtRoles[0].id,
      responsibleRoleIds: [opRoleId],
      consultedRoleIds: [],
      informedRoleIds: [],
      criticality: 4,
      complianceCritical: true,
      fineCents: Math.max(1_000_00, specDomain.facility.rentPerDay * 15),
    },
    {
      id: "proc_commercial",
      name: `${specDomain.channel1.name} — Asiakaspalvelu & Laskutus`,
      capabilityId: builtCaps[2]?.id ?? builtCaps[0]?.id,
      accountableRoleId: builtRoles[0].id,
      responsibleRoleIds: [builtRoles[Math.min(specDomain.roles.length - 1, builtRoles.length - 1)].id],
      consultedRoleIds: [],
      informedRoleIds: [],
      criticality: 3,
      complianceCritical: false,
      fineCents: 0,
    },
  ];
  base.org.governance = {
    drift: 0,
    unownedProcessIds: [],
    coordinationTax: {},
  };

  // 4. Facility (Warehouse / Store / Office / Datacenter)
  if (base.warehouses.sites[0]) {
    base.warehouses.sites[0].name = specDomain.facility.name;
    base.warehouses.sites[0].rentPerDay = specDomain.facility.rentPerDay;
    base.warehouses.sites[0].capabilityId = builtCaps[1]?.id ?? builtCaps[0]?.id;
    base.warehouses.sites[0].laborRoleId = opRoleId;
    base.warehouses.sites[0].zones = [
      {
        handling: specDomain.facility.handling,
        capacityM3: Math.max(20, specDomain.facility.cubeM3),
      },
    ];
    base.warehouses.sites[0].telemetry = {
      ...base.warehouses.sites[0].telemetry,
      utilization: 0.35,
      pickUtilization: 0.32,
      receivingBacklogUnits: 0,
      pickBacklogUnits: 0,
      spoiledUnitsToday: 0,
    };
  }

  // 5. Work Center
  if (base.operations.workCenters[0]) {
    base.operations.workCenters[0].name = specDomain.workCenter.name;
    base.operations.workCenters[0].capabilityId = builtCaps[0]?.id;
    base.operations.workCenters[0].laborRoleId = opRoleId;
    base.operations.workCenters[0].machineHoursPerDay = specDomain.workCenter.machineHoursPerDay;
    base.operations.workCenters[0].laborHoursPerDay = specDomain.workCenter.laborHoursPerDay;
    if (specDomain.workCenter.varCostPerHour !== undefined) {
      base.operations.workCenters[0].variableCostPerHour = specDomain.workCenter.varCostPerHour;
    }
    base.operations.workCenters[0].telemetry = {
      ...base.operations.workCenters[0].telemetry,
      utilization: 0.42,
      littlesL: 3,
      avgWaitDays: 0.008,
    };
    if (base.operations.workCenters[0].outsource) {
      base.operations.workCenters[0].outsource.vendorName = `${specDomain.companyName} Alihankintakumppani`;
    }
  }

  // 6. Catalog Items
  const raw1 = {
    id: "item_raw_1",
    name: specDomain.rawItem1.name,
    kind: "raw" as const,
    uom: specDomain.rawItem1.uom,
    unitVolumeM3: specDomain.finishedItem.kind === "service" ? 0 : 0.05,
    handling: specDomain.facility.handling,
    shelfLifeDays: undefined,
    obsolescenceAnnual: 0.05,
    designQuality: 0.9,
    standardCost: specDomain.rawItem1.standardCost,
  };
  const raw2 = {
    id: "item_raw_2",
    name: specDomain.rawItem2.name,
    kind: "raw" as const,
    uom: specDomain.rawItem2.uom,
    unitVolumeM3: specDomain.finishedItem.kind === "service" ? 0 : 0.02,
    handling: specDomain.facility.handling,
    shelfLifeDays: undefined,
    obsolescenceAnnual: 0.02,
    designQuality: 0.9,
    standardCost: specDomain.rawItem2.standardCost,
  };
  const finished = {
    id: "item_finished_main",
    name: specDomain.finishedItem.name,
    kind: specDomain.finishedItem.kind,
    uom: specDomain.finishedItem.uom,
    unitVolumeM3: specDomain.finishedItem.kind === "service" ? 0 : 0.08,
    handling: specDomain.finishedItem.handling,
    shelfLifeDays: specDomain.finishedItem.shelfLifeDays,
    obsolescenceAnnual: specDomain.finishedItem.shelfLifeDays ? 0.3 : 0.05,
    designQuality: 0.92,
    standardCost: specDomain.finishedItem.standardCost,
  };
  base.catalog.items = [raw1, raw2, finished];

  // 7. Recipe
  base.catalog.recipes = [
    {
      id: "rec_main",
      name: specDomain.recipe.name,
      outputItemId: "item_finished_main",
      outputQty: specDomain.recipe.outputQty,
      inputs:
        specDomain.finishedItem.kind === "service"
          ? []
          : [
              { itemId: "item_raw_1", qty: 1 },
              { itemId: "item_raw_2", qty: 1 },
            ],
      workCenterId: base.operations.workCenters[0].id,
      machineHours: specDomain.recipe.machineHours,
      laborHours: specDomain.recipe.laborHours,
      baseDefectRate: 0.01,
    },
  ];

  // 7b. Operations Policies & Orders
  base.operations.policies = [
    {
      recipeId: "rec_main",
      mode: "make_to_stock",
      targetStockUnits: specDomain.finishedItem.kind === "service" ? 50 : 150,
      maxBatchesPerDay: 6,
    },
  ];
  base.operations.orders = [];
  base.operations.serviceCapacityToday = {};

  // 7c. Supply Purchase Orders, Reorder Policies & Usage Stats
  base.supply.purchaseOrders = [];
  if (specDomain.finishedItem.kind === "service") {
    base.supply.reorderPolicies = [];
    base.supply.usageStats = {};
  } else {
    base.supply.reorderPolicies = [
      {
        id: "pol_raw_1",
        warehouseId: base.warehouses.sites[0].id,
        itemId: "item_raw_1",
        supplierId: base.supply.suppliers[0].id,
        laneId: base.supply.lanes[0].id,
        mode: "min_max",
        strategy: "jit",
        safetyStockDays: 4,
        serviceLevelZ: 1.65,
        reviewPeriodDays: 1,
      },
      {
        id: "pol_raw_2",
        warehouseId: base.warehouses.sites[0].id,
        itemId: "item_raw_2",
        supplierId: base.supply.suppliers[1] ? base.supply.suppliers[1].id : base.supply.suppliers[0].id,
        laneId: base.supply.lanes[0].id,
        mode: "min_max",
        strategy: "jit",
        safetyStockDays: 4,
        serviceLevelZ: 1.65,
        reviewPeriodDays: 1,
      },
    ];
    base.supply.usageStats = {
      [`${base.warehouses.sites[0].id}:item_raw_1`]: { ema: 15, varEma: 3 },
      [`${base.warehouses.sites[0].id}:item_raw_2`]: { ema: 25, varEma: 5 },
    };
  }

  // 8. Channels, Offerings, Marketing & Contracts (Zero preset leftovers)
  if (base.commercial.channels[0]) {
    base.commercial.channels[0].name = specDomain.channel1.name;
    base.commercial.channels[0].paymentTermsDays = specDomain.channel1.paymentTermsDays;
    base.commercial.channels[0].outboundLaneId = undefined;
    base.commercial.channels[0].capabilityId = builtCaps[2]?.id ?? builtCaps[0]?.id;
  }
  if (base.commercial.channels[1]) {
    base.commercial.channels[1].name = specDomain.channel2.name;
    base.commercial.channels[1].paymentTermsDays = specDomain.channel2.paymentTermsDays;
    base.commercial.channels[1].outboundLaneId = undefined;
    base.commercial.channels[1].capabilityId = builtCaps[2]?.id ?? builtCaps[0]?.id;
  }
  base.commercial.channels = base.commercial.channels.slice(0, 2);

  base.commercial.offerings = [
    {
      id: "off_main_direct",
      name: specDomain.channel1.name.includes("B2B")
        ? `${specDomain.finishedItem.name} (Direct B2B)`
        : `${specDomain.finishedItem.name} (${specDomain.channel1.name})`,
      itemId: "item_finished_main",
      channelId: base.commercial.channels[0].id,
      segmentId: base.market.segments[0].id,
      pricing: { kind: "value_based", listPrice: specDomain.channel1.listPrice },
      discountPct: 0,
      active: true,
    },
    {
      id: "off_secondary",
      name: specDomain.channel2.pricingKind === "subscription"
        ? `${specDomain.finishedItem.name} (Jatkuva sopimus)`
        : `${specDomain.finishedItem.name} (${specDomain.channel2.name})`,
      itemId: "item_finished_main",
      channelId: base.commercial.channels[1] ? base.commercial.channels[1].id : base.commercial.channels[0].id,
      segmentId: base.market.segments[1] ? base.market.segments[1].id : base.market.segments[0].id,
      pricing:
        specDomain.channel2.pricingKind === "subscription"
          ? { kind: "subscription", monthlyPrice: specDomain.channel2.listPrice, unitsPerMonth: 1, churnMonthly: 0.05 }
          : { kind: "value_based", listPrice: specDomain.channel2.listPrice },
      discountPct: 0,
      active: true,
    },
  ];

  base.commercial.offeringStates = base.commercial.offerings.map((o) => ({
    offeringId: o.id,
    installedBase: 0,
    recurringAccrual: 0,
    deferredBalance: 0,
    qualityScore: 0.9,
    deliveryDaysEma: 2,
    fillRateEma: 0.96,
    unitsSoldMtd: 0,
    revenueMtd: 0,
    lastPrice: o.pricing.kind === "value_based" ? o.pricing.listPrice : o.pricing.monthlyPrice,
  }));

  base.commercial.marketing = [
    {
      id: "mkt_primary",
      name: `${specDomain.segment1.name} — Markkinointi & Näkyvyys`,
      kind: "paid_performance",
      dailyBudget: Math.max(25_00, Math.round(specDomain.facility.rentPerDay * 0.5)),
      halfSaturationSpend: 350_00,
      awarenessGain: 0.008,
      brandGain: 0.004,
      leadYield: 0.3,
      fatigue: 0.05,
      fatigueRate: 0.008,
      targetSegmentIds: [base.market.segments[0].id],
    },
    {
      id: "mkt_secondary",
      name: `${specDomain.segment2.name} — Kumppanuudet & Suositukset`,
      kind: "content_seo",
      dailyBudget: Math.max(15_00, Math.round(specDomain.facility.rentPerDay * 0.3)),
      halfSaturationSpend: 250_00,
      awarenessGain: 0.005,
      brandGain: 0.006,
      leadYield: 0.4,
      fatigue: 0.03,
      fatigueRate: 0.005,
      targetSegmentIds: [base.market.segments[1]?.id ?? base.market.segments[0].id],
    },
  ];
  base.commercial.backlog = [];
  base.commercial.pipeline = [];
  base.commercial.contracts = [];
  base.commercial.pendingReturns = [];

  // 9. Segments & Competitors
  if (base.market.segments[0]) {
    base.market.segments[0].name = specDomain.segment1.name;
    base.market.segments[0].wtpMean = specDomain.segment1.wtpMean;
  }
  if (base.market.segments[1]) {
    base.market.segments[1].name = specDomain.segment2.name;
    base.market.segments[1].wtpMean = specDomain.segment2.wtpMean;
  }

  specDomain.competitors.forEach((cSpec, idx) => {
    if (base.market.competitors[idx]) {
      base.market.competitors[idx].name = cSpec.name;
      base.market.competitors[idx].persona = cSpec.persona as any;
    }
  });

  // 10. Lots (Opening inventory)
  if (specDomain.finishedItem.kind === "service") {
    base.warehouses.lots = [];
  } else {
    base.warehouses.lots = [
      {
        id: "lot_raw_1",
        itemId: "item_raw_1",
        warehouseId: base.warehouses.sites[0].id,
        qty: 120,
        value: 120 * raw1.standardCost,
        receivedTick: 0,
      },
      {
        id: "lot_raw_2",
        itemId: "item_raw_2",
        warehouseId: base.warehouses.sites[0].id,
        qty: 250,
        value: 250 * raw2.standardCost,
        receivedTick: 0,
      },
      {
        id: "lot_finished_init",
        itemId: "item_finished_main",
        warehouseId: base.warehouses.sites[0].id,
        qty: 30,
        value: 30 * finished.standardCost,
        receivedTick: 0,
        expiryTick: finished.shelfLifeDays ? finished.shelfLifeDays : undefined,
      },
    ];
  }

  // 11. Finance: Clean Debt Lenders, Fixed Assets & Cap Table (Zero preset leftovers)
  if (base.finance.debts[0]) {
    base.finance.debts[0].lender = `${specDomain.companyName} — Yritysluotto & Kassalimiitti`;
  }
  if (base.finance.debts[1]) {
    base.finance.debts[1].lender = `${specDomain.companyName} — Kalusto- & Investointilaina`;
  }
  if (base.finance.fixedAssets[0]) {
    base.finance.fixedAssets[0].name = `${specDomain.facility.name} — Kalusto & Laitteisto`;
    base.finance.fixedAssets[0].linked = {
      kind: "work_center",
      id: base.operations.workCenters[0].id,
    };
  }
  base.finance.equity.capTable = [
    {
      holder: "Perustajat & Yrittäjät",
      shares: 1_000_000,
      invested: 0,
      round: "Perustaminen",
    },
  ];

  return enforceArchetypeSanityBounds(base, archetype);
}

export * from "./presets";
export * from "./assumptions";
