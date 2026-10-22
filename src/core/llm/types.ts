/**
 * Multi-Provider LLM Types for Engine B (Cognitive Orchestrator) & Module 1 (Business DNA Compiler).
 *
 * Supports BYOK (Bring Your Own Key) for:
 *  - Google Gemini (Gemini 2.5 Pro, Flash, Vertex AI Express `AQ.` keys & Google AI Studio `AIza` keys)
 *  - OpenAI (GPT-4o, GPT-4o-mini, o3-mini)
 *  - Anthropic Claude (Claude 3.7 Sonnet, Claude 3.5 Sonnet, Claude 3.5 Haiku)
 *  - Deterministic Fallback (Offline / No Key, 100% playable with 0 external dependencies)
 */
export type LlmProvider = "gemini" | "openai" | "anthropic" | "deterministic";

export interface LlmConfig {
  provider: LlmProvider;
  apiKey?: string;
  model?: string;
  baseUrl?: string;
}

export interface MaskedLlmConfig {
  provider: LlmProvider;
  model: string;
  isKeySet: boolean;
  maskedKey?: string;
  keyPrefix?: string;
}

export interface LlmCallMetadata {
  provider: LlmProvider;
  model: string;
  latencyMs: number;
  live: boolean;
  endpointUsed?: string;
  error?: string;
  promptTokens?: number;
  completionTokens?: number;
}

export interface ActivityLogEntry {
  id: number;
  timestamp: string;
  actor: "llm" | "engine" | "web" | "player";
  title: string;
  detail: string;
  durationMs?: number;
  tokensUsed?: number;
  ok: boolean;
}

export interface LlmSessionTelemetry {
  totalCalls: number;
  successfulCalls: number;
  failedCalls: number;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalTokens: number;
  lastLatencyMs: number;
  lastCallAt?: string;
  quotaStatus: "active" | "rate_limited" | "offline" | "unconfigured";
  quotaLabelFi: string;
  tierNoteFi: string;
  rateLimitRemainingRequests?: string;
  rateLimitRemainingTokens?: string;
  recentActivities: ActivityLogEntry[];
}

export interface ProviderPreset {
  id: LlmProvider;
  name: string;
  tagline: string;
  defaultModel: string;
  models: string[];
  keyPlaceholder: string;
  keyDocUrl: string;
  requiresKey: boolean;
}

export const PROVIDER_PRESETS: Record<LlmProvider, ProviderPreset> = {
  gemini: {
    id: "gemini",
    name: "Google Gemini",
    tagline: "Ultra-fast multimodal reasoning & Vertex AI / Google AI Studio support",
    defaultModel: "gemini-3.5-flash",
    models: ["gemini-3.5-flash", "gemini-3-flash-preview", "gemini-2.5-pro", "gemini-3.5-pro"],
    keyPlaceholder: "AIzaSy... or AQ.Ab8R... (Vertex Express)",
    keyDocUrl: "https://aistudio.google.com/app/apikey",
    requiresKey: true,
  },
  openai: {
    id: "openai",
    name: "OpenAI",
    tagline: "Industry-standard GPT-4o & reasoning models with structured JSON mode",
    defaultModel: "gpt-4o",
    models: ["gpt-4o", "gpt-4o-mini", "o3-mini", "gpt-4-turbo"],
    keyPlaceholder: "sk-proj-...",
    keyDocUrl: "https://platform.openai.com/api-keys",
    requiresKey: true,
  },
  anthropic: {
    id: "anthropic",
    name: "Anthropic Claude",
    tagline: "Nuanced executive strategy debates & deep systems reasoning",
    defaultModel: "claude-3-7-sonnet-latest",
    models: [
      "claude-3-7-sonnet-latest",
      "claude-3-5-sonnet-latest",
      "claude-3-5-haiku-latest",
    ],
    keyPlaceholder: "sk-ant-api03-...",
    keyDocUrl: "https://console.anthropic.com/settings/keys",
    requiresKey: true,
  },
  deterministic: {
    id: "deterministic",
    name: "Deterministic (Offline)",
    tagline: "Zero external network calls; instant double-entry verified fallback agents",
    defaultModel: "deterministic-engine",
    models: ["deterministic-engine"],
    keyPlaceholder: "No API key required",
    keyDocUrl: "",
    requiresKey: false,
  },
};
