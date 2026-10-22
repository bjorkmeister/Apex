/**
 * Engine B Multi-Provider LLM & Cognitive Orchestrator Module.
 */
export * from "./types";
export * from "./client";
export * from "./orchestrator";
export * from "./market-research";

// Backward-compatible aliases for legacy imports
import {
  ensureEnvLoaded,
  getActiveLlmConfig,
  isLlmConfigured,
  callGeminiRawJson,
} from "./client";
import {
  generateBusinessDnaPatchWithLlm,
  generateWarRoomBriefingWithLlm,
} from "./orchestrator";
import type { LlmCallMetadata, LlmConfig } from "./types";
import type { WorldState } from "../schema";

export type GeminiCallMetadata = LlmCallMetadata;

export function getGeminiApiKey(): string | undefined {
  const cfg = getActiveLlmConfig();
  return cfg.provider === "gemini" ? cfg.apiKey : process.env.GEMINI_API_KEY;
}

export function getGeminiModel(): string {
  const cfg = getActiveLlmConfig();
  return cfg.provider === "gemini" && cfg.model ? cfg.model : "gemini-2.5-pro";
}

export function isGeminiConfigured(): boolean {
  return Boolean(getGeminiApiKey());
}

export async function callGeminiJson<T>(opts: {
  systemInstruction: string;
  userPrompt: string;
  temperature?: number;
  timeoutMs?: number;
}): Promise<{ data: T | null; meta: LlmCallMetadata }> {
  return callGeminiRawJson<T>({
    ...opts,
    config: {
      provider: "gemini",
      apiKey: getGeminiApiKey(),
      model: getGeminiModel(),
    },
  });
}

export async function generateWarRoomBriefingWithGemini(
  state: WorldState,
) {
  return generateWarRoomBriefingWithLlm(state);
}

export async function generateBusinessDnaPatchWithGemini(
  prompt: string,
  base: WorldState,
) {
  return generateBusinessDnaPatchWithLlm(prompt, base);
}
