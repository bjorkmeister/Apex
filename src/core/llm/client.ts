/**
 * Multi-Provider LLM Client for Engine B (Cognitive Orchestrator).
 *
 * Implements Bring-Your-Own-Key (BYOK) for:
 *  - Google Gemini
 *  - OpenAI
 *  - Anthropic Claude
 *  - Deterministic Offline Mode
 */
import fs from "node:fs";
import path from "node:path";
import {
  type ActivityLogEntry,
  type LlmCallMetadata,
  type LlmConfig,
  type LlmProvider,
  type LlmSessionTelemetry,
  type MaskedLlmConfig,
  PROVIDER_PRESETS,
} from "./types";

let envLoaded = false;

const sessionTelemetry: LlmSessionTelemetry = {
  totalCalls: 0,
  successfulCalls: 0,
  failedCalls: 0,
  totalPromptTokens: 0,
  totalCompletionTokens: 0,
  totalTokens: 0,
  lastLatencyMs: 0,
  quotaStatus: "offline",
  quotaLabelFi: "Sisäinen moottori (0 API-kutsua)",
  tierNoteFi: "Ei ulkoista API-avainta asetettu — sisäinen fysiikkamoottori aktiivinen",
  recentActivities: [],
};

/** Record an AI or Engine activity entry visible in the War Room & Genesis activity ticker */
export function recordEngineActivity(entry: {
  kind: ActivityLogEntry["kind"];
  titleFi: string;
  detailFi: string;
  latencyMs?: number;
  liveLlm?: boolean;
  provider?: string;
  model?: string;
}): void {
  const item: ActivityLogEntry = {
    id: `act_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    timestampIso: new Date().toLocaleTimeString("fi-FI", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }),
    kind: entry.kind,
    titleFi: entry.titleFi,
    detailFi: entry.detailFi,
    latencyMs: entry.latencyMs,
    liveLlm: entry.liveLlm,
    provider: entry.provider,
    model: entry.model,
  };
  sessionTelemetry.recentActivities.unshift(item);
  if (sessionTelemetry.recentActivities.length > 25) {
    sessionTelemetry.recentActivities.length = 25;
  }
}

export function getLlmSessionTelemetry(): LlmSessionTelemetry {
  const cfg = getActiveLlmConfig();
  const isSet = Boolean(cfg.apiKey && cfg.apiKey.trim().length > 0 && cfg.provider !== "deterministic");
  if (!isSet && sessionTelemetry.totalCalls === 0) {
    sessionTelemetry.quotaStatus = "offline";
    sessionTelemetry.quotaLabelFi = "Ei API-avainta (Sisäinen moottori)";
    sessionTelemetry.tierNoteFi = "Voit lisätä Gemini / OpenAI / Claude API-avaimen yläpalkista (BYOK)";
  } else if (isSet && sessionTelemetry.totalCalls === 0) {
    sessionTelemetry.quotaStatus = "active";
    sessionTelemetry.quotaLabelFi = `${PROVIDER_PRESETS[cfg.provider].name} valmiina`;
    sessionTelemetry.tierNoteFi =
      cfg.provider === "gemini"
        ? "Google AI Studio / Free & Pay-as-you-go Tier"
        : `${PROVIDER_PRESETS[cfg.provider].name} API-avain aktiivinen`;
  }
  return {
    ...sessionTelemetry,
    recentActivities: [...sessionTelemetry.recentActivities],
  };
}

function updateTelemetryFromCall(opts: {
  provider: LlmProvider;
  model: string;
  live: boolean;
  latencyMs: number;
  promptChars: number;
  responseChars: number;
  status?: number;
  headers?: Headers;
  error?: string;
  taskLabelFi?: string;
}): void {
  sessionTelemetry.totalCalls += 1;
  sessionTelemetry.lastLatencyMs = opts.latencyMs;
  sessionTelemetry.lastCallTimestamp = new Date().toLocaleTimeString("fi-FI", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  const estPromptTokens = Math.max(1, Math.round(opts.promptChars / 4));
  const estCompletionTokens = Math.max(0, Math.round(opts.responseChars / 4));
  sessionTelemetry.totalPromptTokens += estPromptTokens;
  sessionTelemetry.totalCompletionTokens += estCompletionTokens;
  sessionTelemetry.totalTokens =
    sessionTelemetry.totalPromptTokens + sessionTelemetry.totalCompletionTokens;

  if (opts.headers) {
    const remReq =
      opts.headers.get("x-ratelimit-remaining-requests") ??
      opts.headers.get("anthropic-ratelimit-requests-remaining");
    const remTok =
      opts.headers.get("x-ratelimit-remaining-tokens") ??
      opts.headers.get("anthropic-ratelimit-tokens-remaining");
    if (remReq) sessionTelemetry.rateLimitRemainingRequests = remReq;
    if (remTok) sessionTelemetry.rateLimitRemainingTokens = remTok;
  }

  if (opts.live) {
    sessionTelemetry.successfulCalls += 1;
    sessionTelemetry.quotaStatus = "active";
    const remBadge = sessionTelemetry.rateLimitRemainingRequests
      ? ` • Jäljellä: ${sessionTelemetry.rateLimitRemainingRequests} kutsua`
      : "";
    sessionTelemetry.quotaLabelFi = `API Aktiivinen (${sessionTelemetry.successfulCalls}/${sessionTelemetry.totalCalls} OK)${remBadge}`;
    sessionTelemetry.tierNoteFi =
      opts.provider === "gemini"
        ? `Gemini API (${opts.model}) • Free / Pay-as-you-go Tier (~${sessionTelemetry.totalTokens.toLocaleString("fi-FI")} tokenia käytetty)`
        : `${PROVIDER_PRESETS[opts.provider].name} (${opts.model}) • ~${sessionTelemetry.totalTokens.toLocaleString("fi-FI")} tokenia`;
    sessionTelemetry.lastError = undefined;
    recordEngineActivity({
      kind: "llm_call",
      titleFi: opts.taskLabelFi || `LLM-analyysi valmis (${opts.model})`,
      detailFi: `Vastausaika ${(opts.latencyMs / 1000).toFixed(1)}s • ~${estPromptTokens + estCompletionTokens} tokenia`,
      latencyMs: opts.latencyMs,
      liveLlm: true,
      provider: opts.provider,
      model: opts.model,
    });
  } else {
    sessionTelemetry.failedCalls += 1;
    sessionTelemetry.lastError = opts.error;
    const isRateLimit =
      opts.status === 429 ||
      Boolean(opts.error && (opts.error.includes("429") || /quota|rate.?limit|exhausted/i.test(opts.error)));
    if (isRateLimit) {
      sessionTelemetry.quotaStatus = "rate_limited";
      sessionTelemetry.quotaLabelFi = "API-kiintiö täynnä (HTTP 429 Rate Limit)";
      sessionTelemetry.tierNoteFi =
        "Ilmaiskiintiö (Free Tier RPM/RPD) tilapäisesti täynnä — APEX käyttää automaattisesti varamoottoria";
    } else {
      sessionTelemetry.quotaStatus = "error";
      sessionTelemetry.quotaLabelFi = `API-virhe (${sessionTelemetry.failedCalls} epäonnistui)`;
      sessionTelemetry.tierNoteFi = opts.error
        ? opts.error.slice(0, 110)
        : "Tarkista API-avain tai verkkoyhteys";
    }
    recordEngineActivity({
      kind: "llm_call",
      titleFi: isRateLimit
        ? `API-kiintiö täynnä (${opts.model}) — vaihdettiin sisäiseen varamoottoriin`
        : `LLM-kutsu epäonnistui (${opts.model}) — käytetään varamoottoria`,
      detailFi: opts.error ? opts.error.slice(0, 120) : "Ei vastausta",
      latencyMs: opts.latencyMs,
      liveLlm: false,
      provider: opts.provider,
      model: opts.model,
    });
  }
}

/** Load `.env` from project root into `process.env`. */
export function ensureEnvLoaded(): void {
  if (envLoaded) return;
  envLoaded = true;
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

/** In-memory active configuration (can be updated at runtime via BYOK UI or API) */
let runtimeConfig: LlmConfig | null = null;

export function getActiveLlmConfig(): LlmConfig {
  ensureEnvLoaded();
  if (runtimeConfig) {
    return { ...runtimeConfig };
  }

  // Auto-detect default provider based on available environment keys
  let defaultProvider: LlmProvider = "deterministic";
  let defaultKey: string | undefined;
  let defaultModel: string | undefined;

  const explicitProvider = process.env.LLM_PROVIDER?.toLowerCase() as LlmProvider | undefined;
  if (explicitProvider && PROVIDER_PRESETS[explicitProvider]) {
    defaultProvider = explicitProvider;
  } else if (process.env.GEMINI_API_KEY?.trim()) {
    defaultProvider = "gemini";
  } else if (process.env.OPENAI_API_KEY?.trim()) {
    defaultProvider = "openai";
  } else if (process.env.ANTHROPIC_API_KEY?.trim()) {
    defaultProvider = "anthropic";
  }

  if (defaultProvider === "gemini") {
    defaultKey = process.env.GEMINI_API_KEY?.trim();
    defaultModel = process.env.GEMINI_MODEL?.trim() || PROVIDER_PRESETS.gemini.defaultModel;
  } else if (defaultProvider === "openai") {
    defaultKey = process.env.OPENAI_API_KEY?.trim();
    defaultModel = process.env.OPENAI_MODEL?.trim() || PROVIDER_PRESETS.openai.defaultModel;
  } else if (defaultProvider === "anthropic") {
    defaultKey = process.env.ANTHROPIC_API_KEY?.trim();
    defaultModel =
      process.env.ANTHROPIC_MODEL?.trim() || PROVIDER_PRESETS.anthropic.defaultModel;
  } else {
    defaultModel = PROVIDER_PRESETS.deterministic.defaultModel;
  }

  runtimeConfig = {
    provider: defaultProvider,
    apiKey: defaultKey,
    model: defaultModel,
  };

  return { ...runtimeConfig };
}

export function setActiveLlmConfig(patch: Partial<LlmConfig>): LlmConfig {
  ensureEnvLoaded();
  const current = getActiveLlmConfig();
  const nextProvider = patch.provider ?? current.provider;
  const nextPreset = PROVIDER_PRESETS[nextProvider] ?? PROVIDER_PRESETS.deterministic;

  let nextKey = patch.apiKey !== undefined ? patch.apiKey.trim() : current.apiKey;
  // If provider changed and no new key was provided, check if an env var exists for that provider
  if (patch.provider && patch.provider !== current.provider && patch.apiKey === undefined) {
    if (nextProvider === "gemini") nextKey = process.env.GEMINI_API_KEY?.trim();
    else if (nextProvider === "openai") nextKey = process.env.OPENAI_API_KEY?.trim();
    else if (nextProvider === "anthropic") nextKey = process.env.ANTHROPIC_API_KEY?.trim();
    else nextKey = undefined;
  }

  const nextModel =
    patch.model?.trim() ||
    (nextProvider === current.provider ? current.model : nextPreset.defaultModel);

  runtimeConfig = {
    provider: nextProvider,
    apiKey: nextKey && nextKey.length > 0 ? nextKey : undefined,
    model: nextModel,
    baseUrl: patch.baseUrl?.trim() || current.baseUrl,
  };

  return { ...runtimeConfig };
}

export function maskApiKey(key?: string): string | undefined {
  if (!key) return undefined;
  const trimmed = key.trim();
  if (trimmed.length <= 8) return "••••••••";
  if (trimmed.startsWith("AQ.")) {
    return `${trimmed.slice(0, 7)}...${trimmed.slice(-4)}`;
  }
  if (trimmed.startsWith("sk-")) {
    return `${trimmed.slice(0, 7)}...${trimmed.slice(-4)}`;
  }
  if (trimmed.startsWith("AIza")) {
    return `${trimmed.slice(0, 6)}...${trimmed.slice(-4)}`;
  }
  return `${trimmed.slice(0, 4)}...${trimmed.slice(-4)}`;
}

export function getMaskedLlmConfig(): MaskedLlmConfig {
  const cfg = getActiveLlmConfig();
  return {
    provider: cfg.provider,
    model: cfg.model || PROVIDER_PRESETS[cfg.provider].defaultModel,
    isKeySet: Boolean(cfg.apiKey && cfg.apiKey.length > 0),
    maskedKey: maskApiKey(cfg.apiKey),
    keyPrefix: cfg.apiKey ? cfg.apiKey.slice(0, 6) : undefined,
    telemetry: getLlmSessionTelemetry(),
  };
}

export function isLlmConfigured(config?: LlmConfig): boolean {
  const cfg = config ?? getActiveLlmConfig();
  if (cfg.provider === "deterministic") return false;
  return Boolean(cfg.apiKey && cfg.apiKey.trim().length > 0);
}

/** Helper to clean raw LLM output text into a valid JSON object */
export function cleanJsonText<T>(raw: string): T {
  const cleaned = raw
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();
  return JSON.parse(cleaned) as T;
}

/**
 * Call Google Gemini with JSON output mode.
 * Supports Vertex AI Express keys (`AQ....`) and Google AI Studio keys (`AIza....`).
 */
export async function callGeminiRawJson<T>(opts: {
  systemInstruction: string;
  userPrompt: string;
  temperature?: number;
  timeoutMs?: number;
  config?: LlmConfig;
}): Promise<{ data: T | null; meta: LlmCallMetadata }> {
  const cfg = opts.config ?? getActiveLlmConfig();
  const apiKey = cfg.apiKey;
  const primaryModel = cfg.model || PROVIDER_PRESETS.gemini.defaultModel;
  const startMs = performance.now();

  if (!apiKey) {
    return {
      data: null,
      meta: {
        provider: "gemini",
        model: primaryModel,
        latencyMs: 0,
        live: false,
        error: "Google Gemini API key not configured",
      },
    };
  }

  const normalizedPrimary =
    primaryModel === "gemini-2.5-flash" ||
    primaryModel === "gemini-2.0-flash" ||
    primaryModel === "gemini-3.8-flash"
      ? "gemini-3.5-flash"
      : primaryModel;
  const candidateModels = Array.from(
    new Set([
      normalizedPrimary,
      "gemini-3.5-flash",
      "gemini-3-flash-preview",
    ]),
  );
  const targetEndpoint = (m: string) =>
    `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${encodeURIComponent(apiKey)}`;

  let lastError = "";
  let activeModel = normalizedPrimary;

  for (let mIdx = 0; mIdx < candidateModels.length; mIdx++) {
    activeModel = candidateModels[mIdx];
    const generationConfig: Record<string, unknown> = {
      temperature: opts.temperature ?? 0.35,
      responseMimeType: "application/json",
    };
    if (activeModel.includes("flash")) {
      generationConfig.thinkingConfig = { thinkingBudget: 0 };
    }

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
      generationConfig,
    };

    const url = targetEndpoint(activeModel);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 5_000);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (!res.ok) {
        const errBody = await res.text();
        lastError = `HTTP ${res.status}: ${errBody.slice(0, 260)}`;
        if (res.status === 400 && errBody.includes("API key not valid")) {
          return {
            data: null,
            meta: {
              provider: "gemini",
              model: activeModel,
              latencyMs: Math.round(performance.now() - startMs),
              live: false,
              error: lastError,
            },
          };
        }
        // If server recommends another model, enqueue it
        const match = errBody.match(/use models\/([a-zA-Z0-9._-]+)/i);
        if (match?.[1] && !candidateModels.includes(match[1])) {
          candidateModels.splice(mIdx + 1, 0, match[1]);
        }
        continue;
      }

      const json = (await res.json()) as {
        candidates?: Array<{
          content?: { parts?: Array<{ text?: string; thought?: boolean }> };
        }>;
      };
      const parts = json.candidates?.[0]?.content?.parts ?? [];
      const text =
        [...parts].reverse().find((p) => p.text && !p.thought)?.text ??
        parts[parts.length - 1]?.text;
      if (!text) {
        lastError = "Empty candidate text from Gemini";
        continue;
      }

      const parsed = cleanJsonText<T>(text);
      return {
        data: parsed,
        meta: {
          provider: "gemini",
          model: activeModel,
          latencyMs: Math.round(performance.now() - startMs),
          live: true,
          endpointUsed: "generativelanguage",
        },
      };
    } catch (err) {
      clearTimeout(timer);
      const isAbort = err instanceof Error && (err.name === "AbortError" || err.message.includes("aborted"));
      lastError = err instanceof Error ? err.message : String(err);
      if (isAbort) {
        // If connection timed out, do not cascade timeouts across remaining models
        break;
      }
    }
  }

  return {
    data: null,
    meta: {
      provider: "gemini",
      model: activeModel,
      latencyMs: Math.round(performance.now() - startMs),
      live: false,
      error: lastError,
    },
  };
}

/**
 * Call OpenAI Chat Completions API with JSON mode.
 * Supports GPT-4o, GPT-4o-mini, o3-mini, etc.
 */
export async function callOpenAiRawJson<T>(opts: {
  systemInstruction: string;
  userPrompt: string;
  temperature?: number;
  timeoutMs?: number;
  config?: LlmConfig;
}): Promise<{ data: T | null; meta: LlmCallMetadata }> {
  const cfg = opts.config ?? getActiveLlmConfig();
  const apiKey = cfg.apiKey;
  const model = cfg.model || PROVIDER_PRESETS.openai.defaultModel;
  const baseUrl = cfg.baseUrl || "https://api.openai.com/v1/chat/completions";
  const startMs = performance.now();

  if (!apiKey) {
    return {
      data: null,
      meta: {
        provider: "openai",
        model,
        latencyMs: 0,
        live: false,
        error: "OpenAI API key not configured",
      },
    };
  }

  const isReasoningModel = model.startsWith("o1") || model.startsWith("o3");
  const payload: Record<string, unknown> = {
    model,
    messages: [
      { role: isReasoningModel ? "user" : "system", content: opts.systemInstruction },
      { role: "user", content: opts.userPrompt + "\nOutput strictly valid JSON and nothing else." },
    ],
  };

  if (!isReasoningModel) {
    payload.temperature = opts.temperature ?? 0.35;
    payload.response_format = { type: "json_object" };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 15_000);

  try {
    const res = await fetch(baseUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!res.ok) {
      const errBody = await res.text();
      return {
        data: null,
        meta: {
          provider: "openai",
          model,
          latencyMs: Math.round(performance.now() - startMs),
          live: false,
          error: `HTTP ${res.status}: ${errBody.slice(0, 260)}`,
        },
      };
    }

    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = json.choices?.[0]?.message?.content;
    if (!content) {
      return {
        data: null,
        meta: {
          provider: "openai",
          model,
          latencyMs: Math.round(performance.now() - startMs),
          live: false,
          error: "Empty completion text from OpenAI",
        },
      };
    }

    const parsed = cleanJsonText<T>(content);
    return {
      data: parsed,
      meta: {
        provider: "openai",
        model,
        latencyMs: Math.round(performance.now() - startMs),
        live: true,
        endpointUsed: "api.openai.com",
      },
    };
  } catch (err) {
    clearTimeout(timer);
    return {
      data: null,
      meta: {
        provider: "openai",
        model,
        latencyMs: Math.round(performance.now() - startMs),
        live: false,
        error: err instanceof Error ? err.message : String(err),
      },
    };
  }
}

/**
 * Call Anthropic Claude Messages API.
 * Supports Claude 3.7 Sonnet, Claude 3.5 Sonnet, Claude 3.5 Haiku.
 */
export async function callAnthropicRawJson<T>(opts: {
  systemInstruction: string;
  userPrompt: string;
  temperature?: number;
  timeoutMs?: number;
  config?: LlmConfig;
}): Promise<{ data: T | null; meta: LlmCallMetadata }> {
  const cfg = opts.config ?? getActiveLlmConfig();
  const apiKey = cfg.apiKey;
  const model = cfg.model || PROVIDER_PRESETS.anthropic.defaultModel;
  const baseUrl = cfg.baseUrl || "https://api.anthropic.com/v1/messages";
  const startMs = performance.now();

  if (!apiKey) {
    return {
      data: null,
      meta: {
        provider: "anthropic",
        model,
        latencyMs: 0,
        live: false,
        error: "Anthropic Claude API key not configured",
      },
    };
  }

  const payload = {
    model,
    max_tokens: 4096,
    system: opts.systemInstruction,
    temperature: opts.temperature ?? 0.35,
    messages: [
      {
        role: "user",
        content: `${opts.userPrompt}\n\nIMPORTANT: Output ONLY valid, parsable JSON matching the requested schema. Do not enclose in markdown blocks.`,
      },
    ],
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 18_000);

  try {
    const res = await fetch(baseUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!res.ok) {
      const errBody = await res.text();
      return {
        data: null,
        meta: {
          provider: "anthropic",
          model,
          latencyMs: Math.round(performance.now() - startMs),
          live: false,
          error: `HTTP ${res.status}: ${errBody.slice(0, 260)}`,
        },
      };
    }

    const json = (await res.json()) as {
      content?: Array<{ type: string; text?: string }>;
    };
    const content = json.content?.find((c) => c.type === "text")?.text;
    if (!content) {
      return {
        data: null,
        meta: {
          provider: "anthropic",
          model,
          latencyMs: Math.round(performance.now() - startMs),
          live: false,
          error: "Empty message text from Anthropic",
        },
      };
    }

    const parsed = cleanJsonText<T>(content);
    return {
      data: parsed,
      meta: {
        provider: "anthropic",
        model,
        latencyMs: Math.round(performance.now() - startMs),
        live: true,
        endpointUsed: "api.anthropic.com",
      },
    };
  } catch (err) {
    clearTimeout(timer);
    return {
      data: null,
      meta: {
        provider: "anthropic",
        model,
        latencyMs: Math.round(performance.now() - startMs),
        live: false,
        error: err instanceof Error ? err.message : String(err),
      },
    };
  }
}

/**
 * Unified Multi-Provider JSON Dispatcher.
 * Dispatches to Gemini, OpenAI, or Anthropic depending on active or passed configuration.
 */
export async function callLlmJson<T>(opts: {
  systemInstruction: string;
  userPrompt: string;
  temperature?: number;
  timeoutMs?: number;
  config?: LlmConfig;
  taskLabelFi?: string;
}): Promise<{ data: T | null; meta: LlmCallMetadata }> {
  const cfg = opts.config ?? getActiveLlmConfig();
  const promptChars = (opts.systemInstruction?.length ?? 0) + (opts.userPrompt?.length ?? 0);

  if (cfg.provider === "gemini" || cfg.provider === "openai" || cfg.provider === "anthropic") {
    const res =
      cfg.provider === "gemini"
        ? await callGeminiRawJson<T>(opts)
        : cfg.provider === "openai"
          ? await callOpenAiRawJson<T>(opts)
          : await callAnthropicRawJson<T>(opts);

    if (cfg.apiKey && cfg.apiKey.trim().length > 0) {
      const responseChars = res.data ? JSON.stringify(res.data).length : 0;
      updateTelemetryFromCall({
        provider: cfg.provider,
        model: res.meta.model,
        live: res.meta.live,
        latencyMs: res.meta.latencyMs,
        promptChars,
        responseChars,
        error: res.meta.error,
        taskLabelFi: opts.taskLabelFi,
      });
    }
    return res;
  }

  // Deterministic mode
  return {
    data: null,
    meta: {
      provider: "deterministic",
      model: PROVIDER_PRESETS.deterministic.defaultModel,
      latencyMs: 0,
      live: false,
      error: "Deterministic engine selected (no external API calls)",
    },
  };
}

/**
 * Live test ping to verify user API key and model connectivity.
 */
export async function testLlmConnection(configOverride?: LlmConfig): Promise<{
  ok: boolean;
  message: string;
  latencyMs: number;
  meta: LlmCallMetadata;
}> {
  const cfg = configOverride ?? getActiveLlmConfig();

  if (cfg.provider === "deterministic") {
    return {
      ok: true,
      message: "Deterministic engine active (no API key required).",
      latencyMs: 0,
      meta: {
        provider: "deterministic",
        model: PROVIDER_PRESETS.deterministic.defaultModel,
        latencyMs: 0,
        live: false,
      },
    };
  }

  if (!cfg.apiKey || cfg.apiKey.trim().length === 0) {
    return {
      ok: false,
      message: `No API key entered for ${PROVIDER_PRESETS[cfg.provider].name}.`,
      latencyMs: 0,
      meta: {
        provider: cfg.provider,
        model: cfg.model || PROVIDER_PRESETS[cfg.provider].defaultModel,
        latencyMs: 0,
        live: false,
        error: "Missing API key",
      },
    };
  }

  const { data, meta } = await callLlmJson<{ status: string; engine: string }>({
    systemInstruction: "You are the APEX test ping agent. Return strictly valid JSON.",
    userPrompt: 'Reply with JSON: {"status":"connected","engine":"APEX"}',
    temperature: 0.1,
    timeoutMs: 9_000,
    config: cfg,
  });

  if (data && meta.live) {
    return {
      ok: true,
      message: `Connected successfully to ${PROVIDER_PRESETS[cfg.provider].name} (${meta.model}) in ${meta.latencyMs}ms.`,
      latencyMs: meta.latencyMs,
      meta,
    };
  }

  return {
    ok: false,
    message: meta.error || `Failed to connect to ${PROVIDER_PRESETS[cfg.provider].name}. Check key and permissions.`,
    latencyMs: meta.latencyMs,
    meta,
  };
}
