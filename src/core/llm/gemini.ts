/**
 * Live Gemini API Client for Engine B (Cognitive Orchestrator) & Module 1 (Business DNA Compiler).
 *
 * Strictly enforces the Hybrid Dual-Engine & Tiered Tick-Clock Architecture:
 *  - Never invoked inside the daily micro-tick loop (`resolveTick`).
 *  - Invoked only on Macro-Intervals, State-Driven Interrupts, On-Demand War Room Briefings,
 *    or Step 0 Business DNA Compilation.
 *  - Every LLM-emitted `ActionPayload` is verified via `validateAction(state, action)` (Two-Phase Commit)
 *    before being surfaced or committed.
 *  - Every LLM-emitted Business DNA patch is clamped via `enforceArchetypeSanityBounds` and
 *    verified via `verifyAccountingInvariants`.
 */
import fs from "node:fs";
import path from "node:path";
import type { WarRoomBriefing } from "../agents";
import { generateWarRoomBriefing } from "../agents";
import { ARCHETYPE_BASELINES } from "../compiler";
import { validateAction } from "../engine/actions";
import { buildBalanceSheet, buildIncomeStatement } from "../engine/ledger";
import { resolveOfferingPrice } from "../engine/market";
import { totalHeadcount } from "../engine/org";
import { unitBookCost } from "../engine/warehouse";
import { ActionPayload, type IndustryArchetype, type WorldState } from "../schema";

let envLoaded = false;

/** Load `.env` from project root if `GEMINI_API_KEY` is not already set in `process.env`. */
export function ensureEnvLoaded(): void {
  if (envLoaded) return;
  envLoaded = true;
  if (process.env.GEMINI_API_KEY) return;
  try {
    const envPath = path.resolve(process.cwd(), ".env");
    if (!fs.existsSync(envPath)) return;
    const raw = fs.readFileSync(envPath, "utf-8");
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx <= 0) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, "");
      if (key && !process.env[key]) {
        process.env[key] = val;
      }
    }
  } catch {
    // Ignore fs errors in restricted environments
  }
}

export function getGeminiApiKey(): string | undefined {
  ensureEnvLoaded();
  const key = process.env.GEMINI_API_KEY?.trim();
  return key && key.length > 0 ? key : undefined;
}

export function getGeminiModel(): string {
  ensureEnvLoaded();
  return process.env.GEMINI_MODEL?.trim() || "gemini-2.5-pro";
}

export function isGeminiConfigured(): boolean {
  return Boolean(getGeminiApiKey());
}

export interface GeminiCallMetadata {
  provider: "gemini-live" | "deterministic-fallback";
  model: string;
  latencyMs: number;
  endpointUsed?: string;
  error?: string;
}

/**
 * Call Gemini `generateContent` with JSON output mode.
 * Supports both Vertex AI Express Mode keys (`AQ....` -> `aiplatform.googleapis.com`)
 * and Google AI Studio keys (`AIza...` -> `generativelanguage.googleapis.com`),
 * automatically trying candidate models and any 404-recommended model before falling back.
 */
export async function callGeminiJson<T>(opts: {
  systemInstruction: string;
  userPrompt: string;
  temperature?: number;
  timeoutMs?: number;
}): Promise<{ data: T | null; meta: GeminiCallMetadata }> {
  const apiKey = getGeminiApiKey();
  const primaryModel = getGeminiModel();
  const startMs = performance.now();

  if (!apiKey) {
    return {
      data: null,
      meta: {
        provider: "deterministic-fallback",
        model: primaryModel,
        latencyMs: 0,
        error: "GEMINI_API_KEY not configured",
      },
    };
  }

  const candidateModels = Array.from(
    new Set([primaryModel, "gemini-2.5-pro", "gemini-2.5-flash-lite"]),
  );
  const isVertexExpressKey = apiKey.startsWith("AQ.");
  const baseEndpoints = isVertexExpressKey
    ? [
        (m: string) =>
          `https://aiplatform.googleapis.com/v1/publishers/google/models/${m}:generateContent?key=${encodeURIComponent(apiKey)}`,
        (m: string) =>
          `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${encodeURIComponent(apiKey)}`,
      ]
    : [
        (m: string) =>
          `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${encodeURIComponent(apiKey)}`,
        (m: string) =>
          `https://aiplatform.googleapis.com/v1/publishers/google/models/${m}:generateContent?key=${encodeURIComponent(apiKey)}`,
      ];

  const payload = {
    systemInstruction: {
      role: "system",
      parts: [{ text: opts.systemInstruction }],
    },
    contents: [
      {
        role: "user",
        parts: [{ text: opts.userPrompt }],
      },
    ],
    generationConfig: {
      temperature: opts.temperature ?? 0.35,
      responseMimeType: "application/json",
    },
  };

  let lastError = "";
  let activeModel = primaryModel;

  for (let mIdx = 0; mIdx < candidateModels.length; mIdx++) {
    activeModel = candidateModels[mIdx];
    for (const buildUrl of baseEndpoints) {
      const url = buildUrl(activeModel);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 12_000);
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });
        clearTimeout(timer);

        if (!res.ok) {
          const errBody = await res.text();
          lastError = `HTTP ${res.status}: ${errBody.slice(0, 260)}`;
          // If 404 recommends a specific model (e.g., "use models/gemini-..."), enqueue it immediately
          const match = errBody.match(/use models\/([a-zA-Z0-9._-]+)/i);
          if (match?.[1] && !candidateModels.includes(match[1])) {
            candidateModels.splice(mIdx + 1, 0, match[1]);
          }
          continue;
        }

        const json = (await res.json()) as {
          candidates?: Array<{
            content?: { parts?: Array<{ text?: string }> };
          }>;
        };
        const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!text) {
          lastError = "Empty candidate text from Gemini";
          continue;
        }

        const cleaned = text
          .trim()
          .replace(/^```json\s*/i, "")
          .replace(/^```\s*/i, "")
          .replace(/```$/i, "")
          .trim();
        const parsed = JSON.parse(cleaned) as T;

        return {
          data: parsed,
          meta: {
            provider: "gemini-live",
            model: activeModel,
            latencyMs: Math.round(performance.now() - startMs),
            endpointUsed: url.includes("aiplatform.googleapis.com")
              ? "vertex-ai-express"
              : "generativelanguage",
          },
        };
      } catch (err) {
        clearTimeout(timer);
        lastError = err instanceof Error ? err.message : String(err);
      }
    }
  }

  return {
    data: null,
    meta: {
      provider: "deterministic-fallback",
      model: activeModel,
      latencyMs: Math.round(performance.now() - startMs),
      error: lastError,
    },
  };
}

interface GeminiDnaSynthesisResponse {
  companyName?: string;
  industry?: string;
  tagline?: string;
  archetype?: IndustryArchetype;
  rawItems?: Array<{ name: string; uom?: string }>;
  finishedItemName?: string;
  recipeName?: string;
  directOfferingName?: string;
  wholesaleOfferingName?: string;
  targetGrossMargin?: number;
  capabilityNames?: string[];
  competitors?: Array<{ name: string; persona: string }>;
}

/**
 * Module 1 Live LLM Generator for `compileBusinessPrompt`:
 * Uses Gemini to synthesize domain-accurate SKU names, BOM components, capabilities,
 * and competitor personas, while keeping all economic parameters inside archetype sanity bounds.
 */
export async function generateBusinessDnaPatchWithGemini(
  prompt: string,
  base: WorldState,
): Promise<{ patch: Partial<WorldState>; meta: GeminiCallMetadata }> {
  const archetype = base.company.archetype ?? "ASSET_HEAVY_MANUFACTURING";
  const spec = ARCHETYPE_BASELINES[archetype];

  const systemInstruction = `You are the APEX Business DNA Compiler (Zero-to-Ontology Architect).
Translate the user's business concept into a structured JSON specification anchored to the "${archetype}" archetype (${spec.label}).
Enforce economic sanity bounds:
- targetGrossMargin must be a decimal between ${spec.grossMarginBand[0]} and ${spec.grossMarginBand[1]} (strictly within [0.20, 0.80]).
- Return ONLY valid JSON matching this schema:
{
  "companyName": "string",
  "industry": "string",
  "tagline": "string (1 concise sentence)",
  "rawItems": [{ "name": "string", "uom": "string" }, { "name": "string", "uom": "string" }],
  "finishedItemName": "string",
  "recipeName": "string",
  "directOfferingName": "string",
  "wholesaleOfferingName": "string",
  "targetGrossMargin": 0.52,
  "capabilityNames": ["string", "string", "string"],
  "competitors": [
    { "name": "string", "persona": "string" },
    { "name": "string", "persona": "string" },
    { "name": "string", "persona": "string" }
  ]
}`;

  const { data, meta } = await callGeminiJson<GeminiDnaSynthesisResponse>({
    systemInstruction,
    userPrompt: `Compile business concept: "${prompt}" (Archetype: ${archetype})`,
    temperature: 0.4,
  });

  if (!data) {
    return { patch: {}, meta };
  }

  const cloned: WorldState = structuredClone(base);

  if (data.companyName) cloned.company.name = data.companyName.slice(0, 60);
  if (data.industry) cloned.company.industry = data.industry.slice(0, 80);
  if (data.tagline) cloned.company.tagline = data.tagline.slice(0, 140);

  // Apply synthesized raw item names
  const rawCatalogItems = cloned.catalog.items.filter(
    (i) => i.kind === "raw" || i.kind === "component",
  );
  if (Array.isArray(data.rawItems)) {
    data.rawItems.forEach((ri, idx) => {
      if (rawCatalogItems[idx] && ri?.name) {
        rawCatalogItems[idx].name = String(ri.name).slice(0, 60);
        if (ri.uom) rawCatalogItems[idx].uom = String(ri.uom).slice(0, 16);
      }
    });
  }

  const mainFinished = cloned.catalog.items.find(
    (i) => i.kind === "finished" || i.kind === "service",
  );
  if (mainFinished && data.finishedItemName) {
    mainFinished.name = String(data.finishedItemName).slice(0, 60);
  }

  if (cloned.catalog.recipes[0] && data.recipeName) {
    cloned.catalog.recipes[0].name = String(data.recipeName).slice(0, 70);
  }

  if (cloned.commercial.offerings[0] && data.directOfferingName) {
    cloned.commercial.offerings[0].name = String(data.directOfferingName).slice(0, 70);
  }
  if (cloned.commercial.offerings[1] && data.wholesaleOfferingName) {
    cloned.commercial.offerings[1].name = String(data.wholesaleOfferingName).slice(0, 70);
  }

  // Apply target gross margin within archetype sanity bounds [0.20, 0.80]
  if (
    typeof data.targetGrossMargin === "number" &&
    Number.isFinite(data.targetGrossMargin)
  ) {
    const gm = Math.max(
      spec.grossMarginBand[0],
      Math.min(spec.grossMarginBand[1], data.targetGrossMargin),
    );
    const off0 = cloned.commercial.offerings[0];
    if (off0) {
      const unitCost = Math.max(100, unitBookCost(cloned, off0.itemId));
      const targetPrice = Math.max(200, Math.round(unitCost / (1 - gm)));
      if (off0.pricing.kind === "value_based") {
        off0.pricing.listPrice = targetPrice;
      } else if (off0.pricing.kind === "subscription") {
        off0.pricing.monthlyPrice = Math.round(
          targetPrice * Math.max(1, off0.pricing.unitsPerMonth),
        );
      }
    }
  }

  if (Array.isArray(data.capabilityNames)) {
    data.capabilityNames.forEach((capName, idx) => {
      if (cloned.operations.capabilities[idx] && capName) {
        cloned.operations.capabilities[idx].name = String(capName).slice(0, 65);
      }
    });
  }

  if (Array.isArray(data.competitors)) {
    data.competitors.forEach((comp, idx) => {
      if (cloned.market.competitors[idx] && comp?.name) {
        cloned.market.competitors[idx].name = String(comp.name).slice(0, 50);
        if (comp.persona) {
          cloned.market.competitors[idx].persona = String(comp.persona).slice(0, 120);
        }
      }
    });
  }

  return { patch: cloned, meta };
}

/**
 * Engine B Live Multi-Agent C-Suite War Room Briefing via Gemini:
 *  - Builds a compact telemetry snapshot from Engine A (`WorldState`).
 *  - Invokes Gemini to generate the executive summary, C-Suite proposals (COO, CFO, CRO, CHRO),
 *    and cross-functional War Room debate transcript.
 *  - Validates every proposed `ActionPayload` via `validateAction(state, action)` (Two-Phase Commit Phase 1);
 *    any invalid action is replaced by the deterministic agent's verified proposal action.
 */
export async function generateWarRoomBriefingWithGemini(
  state: WorldState,
): Promise<{ briefing: WarRoomBriefing; meta: GeminiCallMetadata }> {
  const fallback = generateWarRoomBriefing(state);
  if (!isGeminiConfigured()) {
    return {
      briefing: fallback,
      meta: {
        provider: "deterministic-fallback",
        model: getGeminiModel(),
        latencyMs: 0,
        error: "GEMINI_API_KEY not configured",
      },
    };
  }

  const bs = buildBalanceSheet(state.finance.ledger);
  const is = buildIncomeStatement(state.finance.ledger);
  const lastKpi = state.telemetry.daily[state.telemetry.daily.length - 1];
  const wc0 = state.operations.workCenters[0];
  const wh0 = state.warehouses.sites[0];
  const off0 = state.commercial.offerings[0];
  const off0Price = off0 ? resolveOfferingPrice(state, off0).netUnitPrice : 50_00;

  const stateDigest = {
    company: {
      name: state.company.name,
      industry: state.company.industry,
      archetype: state.company.archetype,
      day: state.calendar.tick,
    },
    financialsDollars: {
      cash: Math.round(bs.assets.cash / 100),
      accountsReceivable: Math.round(bs.assets.accountsReceivable / 100),
      accountsPayable: Math.round(bs.liabilities.accountsPayable / 100),
      mtdNetRevenue: Math.round(is.netRevenue / 100),
      mtdGrossProfit: Math.round(is.grossProfit / 100),
      mtdEbitda: Math.round(is.ebitda / 100),
      runwayDays: lastKpi?.runwayDays ?? "cash-positive",
      cccDays: Number((lastKpi?.ccc ?? 0).toFixed(1)),
      dsoDays: Number((lastKpi?.dso ?? 0).toFixed(1)),
      dioDays: Number((lastKpi?.dio ?? 0).toFixed(1)),
      dpoDays: Number((lastKpi?.dpo ?? 0).toFixed(1)),
    },
    operations: {
      workCenterId: wc0?.id,
      workCenterName: wc0?.name,
      utilizationPct: Number(((wc0?.telemetry.utilization ?? 0) * 100).toFixed(1)),
      littlesLawQueueL: Number((wc0?.telemetry.littlesL ?? 0).toFixed(2)),
      avgWaitDaysW: Number((wc0?.telemetry.avgWaitDays ?? 1).toFixed(2)),
      conditionPct: Number(((wc0?.condition ?? 1) * 100).toFixed(1)),
      warehouseId: wh0?.id,
      warehouseUtilizationPct: Number(((wh0?.telemetry.utilization ?? 0) * 100).toFixed(1)),
      fillRatePct: Number(((lastKpi?.fillRate ?? 1) * 100).toFixed(1)),
    },
    organization: {
      headcount: totalHeadcount(state),
      governanceDriftPct: Number((state.org.governance.drift * 100).toFixed(1)),
      roles: state.org.roles.map((r) => ({ id: r.id, title: r.title })),
    },
    validIds: {
      offeringId: off0?.id,
      currentOfferingPriceCents: off0Price,
      marketingChannelId: state.commercial.marketing[0]?.id,
      salesChannelId: state.commercial.channels[0]?.id,
      workCenterId: wc0?.id,
      warehouseId: wh0?.id,
      capabilityId: state.operations.capabilities[0]?.id,
      supplierId: state.supply.suppliers[0]?.id,
      rawItemId: state.catalog.items[0]?.id,
      laneId: state.supply.lanes[0]?.id,
    },
    activeTriggers: state.lastTriggers ?? [],
  };

  const systemInstruction = `You are Engine B — the Multi-Agent C-Suite Cognitive Orchestrator for APEX.
You simulate 4 executive agents debating strategy over a deterministic double-entry business simulation:
- "coo" (COO / VP of Operations & Supply Chain)
- "cfo" (CFO / Head of Treasury & Corporate Finance)
- "cro" (CRO / VP of Sales, Pricing & Growth)
- "chro" (CHRO / VP of People & Org Governance)

Inspect the provided Engine A telemetry snapshot and return ONLY valid JSON with:
{
  "executiveSummary": "string (concise 1-2 sentence synthesis of Day, Cash, CCC, Little's Law load, and active triggers)",
  "proposals": [
    {
      "agentRole": "coo" | "cfo" | "cro" | "chro",
      "priority": "low" | "medium" | "high" | "critical",
      "headline": "string",
      "diagnosis": "string",
      "tradeOffWarning": "string",
      "kpiFocus": "string"
    }
  ],
  "debateTranscript": [
    {
      "speaker": "cro" | "coo" | "cfo" | "chro",
      "targetRole": "cro" | "coo" | "cfo" | "chro",
      "stance": "propose" | "object" | "support" | "synthesize",
      "message": "string"
    }
  ]
}`;

  const { data, meta } = await callGeminiJson<{
    executiveSummary?: string;
    proposals?: Array<{
      agentRole?: "coo" | "cfo" | "cro" | "chro";
      priority?: "low" | "medium" | "high" | "critical";
      headline?: string;
      diagnosis?: string;
      tradeOffWarning?: string;
      kpiFocus?: string;
      actions?: unknown[];
    }>;
    debateTranscript?: Array<{
      speaker?: "coo" | "cfo" | "cro" | "chro";
      targetRole?: "coo" | "cfo" | "cro" | "chro";
      stance?: "propose" | "object" | "support" | "synthesize";
      message?: string;
    }>;
  }>({
    systemInstruction,
    userPrompt: JSON.stringify(stateDigest),
    temperature: 0.35,
  });

  if (!data) {
    return { briefing: fallback, meta };
  }

  // Merge Gemini's C-Suite reasoning with Two-Phase Commit validated actions
  const mergedProposals = fallback.proposals.map((fbProp) => {
    const llmProp = data.proposals?.find((p) => p.agentRole === fbProp.agentRole);
    if (!llmProp) return fbProp;

    // Validate any LLM-provided actions through Two-Phase Commit Phase 1 (`validateAction`);
    // fall back to the deterministic verified actions if none pass
    const validatedActions: ActionPayload[] = [];
    if (Array.isArray(llmProp.actions)) {
      for (const rawAct of llmProp.actions) {
        const parsedAct = ActionPayload.safeParse(rawAct);
        if (parsedAct.success) {
          const v = validateAction(state, parsedAct.data);
          if (v.valid) {
            validatedActions.push(parsedAct.data);
          }
        }
      }
    }

    return {
      ...fbProp,
      priority:
        llmProp.priority && ["low", "medium", "high", "critical"].includes(llmProp.priority)
          ? llmProp.priority
          : fbProp.priority,
      headline: llmProp.headline ? String(llmProp.headline).slice(0, 140) : fbProp.headline,
      diagnosis: llmProp.diagnosis
        ? String(llmProp.diagnosis).slice(0, 320)
        : fbProp.diagnosis,
      tradeOffWarning: llmProp.tradeOffWarning
        ? String(llmProp.tradeOffWarning).slice(0, 260)
        : fbProp.tradeOffWarning,
      kpiFocus: llmProp.kpiFocus ? String(llmProp.kpiFocus).slice(0, 100) : fbProp.kpiFocus,
      actions: validatedActions.length > 0 ? validatedActions : fbProp.actions,
    };
  });

  const titleByRole: Record<"coo" | "cfo" | "cro" | "chro", string> = {
    coo: "COO / VP of Operations & Supply Chain",
    cfo: "CFO / Head of Treasury & Corporate Finance",
    cro: "CRO / VP of Sales, Pricing & Growth",
    chro: "CHRO / VP of People & Org Governance",
  };

  const mergedDebate =
    Array.isArray(data.debateTranscript) && data.debateTranscript.length >= 2
      ? data.debateTranscript
          .filter(
            (t): t is NonNullable<typeof t> & { speaker: "coo" | "cfo" | "cro" | "chro" } =>
              Boolean(
                t &&
                  t.speaker &&
                  ["coo", "cfo", "cro", "chro"].includes(t.speaker) &&
                  t.message,
              ),
          )
          .slice(0, 6)
          .map((t) => ({
            speaker: t.speaker,
            speakerTitle: titleByRole[t.speaker],
            targetRole:
              t.targetRole && ["coo", "cfo", "cro", "chro"].includes(t.targetRole)
                ? t.targetRole
                : undefined,
            stance:
              t.stance && ["propose", "object", "support", "synthesize"].includes(t.stance)
                ? t.stance
                : ("synthesize" as const),
            message: String(t.message).slice(0, 340),
          }))
      : fallback.debateTranscript;

  return {
    briefing: {
      tick: state.calendar.tick,
      executiveSummary: data.executiveSummary
        ? `[GEMINI LIVE] ${String(data.executiveSummary).slice(0, 300)}`
        : fallback.executiveSummary,
      proposals: mergedProposals,
      debateTranscript: mergedDebate.length > 0 ? mergedDebate : fallback.debateTranscript,
    },
    meta,
  };
}
