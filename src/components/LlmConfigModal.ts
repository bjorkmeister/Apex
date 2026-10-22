/**
 * Master Bring-Your-Own-Key (BYOK) Configuration Modal (`/src/components/LlmConfigModal.ts`).
 *
 * Allows the user to dynamically configure their API key and model for:
 *  - Google Gemini (Gemini 2.5 Pro, Flash, Vertex Express `AQ.` keys & Google AI Studio `AIza` keys)
 *  - OpenAI (GPT-4o, GPT-4o-mini, o3-mini)
 *  - Anthropic Claude (Claude 3.7 Sonnet, Claude 3.5 Sonnet, Claude 3.5 Haiku)
 *  - Deterministic Fallback (Offline / No Key required)
 */
import { getLlmSessionTelemetry } from "../core/llm/client";
import {
  type MaskedLlmConfig,
  PROVIDER_PRESETS,
} from "../core/llm/types";
import { escapeHtml, fmtNum } from "./formatters";

export function renderLlmConfigModal(maskedConfig: MaskedLlmConfig): string {
  const currentProvider = maskedConfig.provider;
  const currentPreset = PROVIDER_PRESETS[currentProvider] ?? PROVIDER_PRESETS.deterministic;
  const tel = getLlmSessionTelemetry();

  const quotaColor =
    tel.quotaStatus === "active"
      ? "tag-green"
      : tel.quotaStatus === "rate_limited"
        ? "tag-red"
        : tel.quotaStatus === "unconfigured"
          ? "tag-amber"
          : "tag-cyan";

  const activityRows = tel.recentActivities
    .slice(0, 6)
    .map((act) => {
      const icon =
        act.actor === "llm"
          ? "🤖"
          : act.actor === "web"
            ? "🌍"
            : act.actor === "player"
              ? "👤"
              : "⚙️";
      return `
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;padding:5px 8px;background:#090e1a;border:1px solid ${act.ok ? "#1e293b" : "#7f1d1d"};border-radius:6px;font-size:11px">
          <div>
            <strong style="color:#f8fafc">${icon} ${escapeHtml(act.title)}</strong>
            <span style="color:#94a3b8;display:block;font-size:10.5px">${escapeHtml(act.detail)}</span>
          </div>
          <div class="mono" style="text-align:right;white-space:nowrap;font-size:10px;color:#64748b">
            <div>${escapeHtml(act.timestamp)}</div>
            ${act.durationMs ? `<div style="color:#38bdf8">${act.durationMs}ms</div>` : ""}
          </div>
        </div>
      `;
    })
    .join("");

  return `
    <div id="llm-modal-backdrop" class="modal-backdrop" style="display:none;">
      <div class="modal-card llm-config-modal" style="max-width:740px">
        <div class="modal-header">
          <div class="modal-title-cluster">
            <span class="tag tag-cyan mono">ENGINE B • TEKOÄLY &amp; API-TELEMETRIA</span>
            <h2>Tekoälymoottori (BYOK), API-Kutsut &amp; Käyttötilanne</h2>
          </div>
          <button type="button" class="btn btn-xs btn-secondary" id="btn-close-llm-modal">✕ Sulje</button>
        </div>

        <!-- LIVE API CALL COUNTER, QUOTA/TIER STATUS & TOKEN TELEMETRY -->
        <div style="padding:10px 12px;background:#090e1a;border:1px solid #1e3a8a;border-radius:8px;margin-bottom:12px">
          <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:8px">
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
              <span class="tag ${quotaColor} mono" style="font-size:10.5px">📡 ${escapeHtml(tel.quotaLabelFi)}</span>
              <span class="sub" style="font-size:11px;color:#cbd5e1">${escapeHtml(tel.tierNoteFi)}</span>
            </div>
            ${
              tel.rateLimitRemainingRequests || tel.rateLimitRemainingTokens
                ? `<span class="tag tag-blue mono" style="font-size:10px">Kiintiö jäljellä: ${escapeHtml(tel.rateLimitRemainingRequests ?? "—")} req / ${escapeHtml(tel.rateLimitRemainingTokens ?? "—")} tok</span>`
                : ""
            }
          </div>
          <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;text-align:center">
            <div style="padding:6px;background:#0f172a;border:1px solid #1e293b;border-radius:6px">
              <div style="font-size:10px;color:#94a3b8;text-transform:uppercase">API-Kutsuja yhteensä</div>
              <strong class="mono" style="font-size:15px;color:#38bdf8">${tel.totalCalls} kpl</strong>
              <div style="font-size:10px;color:#64748b">${tel.successfulCalls} ok / ${tel.failedCalls} virhe</div>
            </div>
            <div style="padding:6px;background:#0f172a;border:1px solid #1e293b;border-radius:6px">
              <div style="font-size:10px;color:#94a3b8;text-transform:uppercase">Token-kulutus (Arvio)</div>
              <strong class="mono" style="font-size:15px;color:#10b981">~${fmtNum(tel.totalTokens)} tok</strong>
              <div style="font-size:10px;color:#64748b">In ${fmtNum(tel.totalPromptTokens)} / Out ${fmtNum(tel.totalCompletionTokens)}</div>
            </div>
            <div style="padding:6px;background:#0f172a;border:1px solid #1e293b;border-radius:6px">
              <div style="font-size:10px;color:#94a3b8;text-transform:uppercase">Viimeisin viive</div>
              <strong class="mono" style="font-size:15px;color:#f8fafc">${tel.lastLatencyMs > 0 ? `${tel.lastLatencyMs} ms` : "0 ms"}</strong>
              <div style="font-size:10px;color:#64748b">${tel.lastCallAt ? `Klo ${escapeHtml(tel.lastCallAt)}` : "Ei kutsuja vielä"}</div>
            </div>
            <div style="padding:6px;background:#0f172a;border:1px solid #1e293b;border-radius:6px">
              <div style="font-size:10px;color:#94a3b8;text-transform:uppercase">API-Taso / Tila</div>
              <strong class="mono" style="font-size:12px;color:#fbbf24">${escapeHtml(tel.quotaLabelFi)}</strong>
              <div style="font-size:10px;color:#64748b">${maskedConfig.isKeySet ? "Oma API-avain (BYOK)" : "Paikallinen moottori"}</div>
            </div>
          </div>
          ${
            activityRows
              ? `<details style="margin-top:8px">
                  <summary style="cursor:pointer;font-size:11px;font-weight:700;color:#38bdf8">📋 Näytä viimeisimmät AI- ja moottoritapahtumat (${tel.recentActivities.length}) ▾</summary>
                  <div style="display:flex;flex-direction:column;gap:4px;margin-top:6px;max-height:150px;overflow-y:auto">
                    ${activityRows}
                  </div>
                </details>`
              : ""
          }
        </div>

        <p class="modal-subtitle">
          Syötä oma API-avaimesi (BYOK) aktivoidaksesi live-tekoälyn (Gemini, OpenAI, Claude) liike-idean generointiin, markkinatutkimukseen ja johtoryhmän väittelyihin. Ilman avainta APEX toimii 100 % paikallisella deterministisellä moottorilla (0 € API-kuluja).
        </p>

        <!-- PROVIDER SELECTOR PILLS -->
        <div class="provider-pill-grid">
          ${(Object.keys(PROVIDER_PRESETS) as Array<keyof typeof PROVIDER_PRESETS>)
            .map((provKey) => {
              const p = PROVIDER_PRESETS[provKey];
              const isSelected = provKey === currentProvider;
              return `
                <button
                  type="button"
                  class="provider-pill ${isSelected ? "selected" : ""}"
                  data-select-provider="${p.id}"
                >
                  <div class="provider-pill-top">
                    <strong>${escapeHtml(p.name)}</strong>
                    ${isSelected ? `<span class="tag tag-green tag-xs">ACTIVE</span>` : ""}
                  </div>
                  <span class="provider-pill-sub">${escapeHtml(p.tagline)}</span>
                </button>
              `;
            })
            .join("")}
        </div>

        <!-- FORM CONTROLS -->
        <form id="llm-config-form" class="llm-config-form">
          <input type="hidden" id="llm-form-provider" value="${escapeHtml(currentProvider)}" />

          <!-- API KEY INPUT GROUP -->
          <div class="form-group" id="llm-key-group" style="${currentProvider === "deterministic" ? "display:none;" : ""}">
            <div class="form-label-row">
              <label for="llm-api-key-input">API Key for <span id="llm-provider-name-label">${escapeHtml(currentPreset.name)}</span>:</label>
              ${
                maskedConfig.isKeySet
                  ? `<span class="tag tag-green tag-xs mono" id="llm-key-status">Key Configured (${escapeHtml(maskedConfig.maskedKey || "Set")})</span>`
                  : `<span class="tag tag-amber tag-xs mono" id="llm-key-status">No Key Configured</span>`
              }
            </div>

            <div class="key-input-wrapper">
              <input
                type="password"
                id="llm-api-key-input"
                class="form-input mono"
                placeholder="${escapeHtml(currentPreset.keyPlaceholder)}"
                autocomplete="off"
                spellcheck="false"
              />
              <button type="button" class="btn btn-xs btn-secondary" id="btn-toggle-key-visibility" title="Show/Hide Key">👁 Show</button>
              <button type="button" class="btn btn-xs btn-secondary" id="btn-clear-key" title="Clear API Key">Clear</button>
            </div>
            <div class="form-help-row">
              <span class="sub" id="llm-key-help">Stored safely in runtime memory / browser localStorage. Never logged or committed to git.</span>
              <a
                href="${escapeHtml(currentPreset.keyDocUrl)}"
                target="_blank"
                rel="noreferrer"
                class="link-help"
                id="llm-key-doc-link"
                style="${currentPreset.keyDocUrl ? "" : "display:none;"}"
              >
                Get API Key ↗
              </a>
            </div>
          </div>

          <!-- MODEL SELECTOR GROUP -->
          <div class="form-group" id="llm-model-group" style="${currentProvider === "deterministic" ? "display:none;" : ""}">
            <div class="form-label-row">
              <label for="llm-model-select">Target Model:</label>
              <span class="sub">Choose a recommended model or type a custom model ID</span>
            </div>
            <div class="model-select-wrapper">
              <select id="llm-model-select" class="form-select mono">
                ${currentPreset.models
                  .map(
                    (m) => `
                  <option value="${escapeHtml(m)}" ${m === maskedConfig.model ? "selected" : ""}>
                    ${escapeHtml(m)} ${m === currentPreset.defaultModel ? "(Default)" : ""}
                  </option>
                `,
                  )
                  .join("")}
                <option value="__custom__">Custom Model ID...</option>
              </select>
              <input
                type="text"
                id="llm-custom-model-input"
                class="form-input mono"
                placeholder="Enter custom model ID (e.g. gemini-2.5-flash)"
                style="display:none;"
                value=""
              />
            </div>
          </div>

          <!-- TEST CONNECTION FEEDBACK BANNER -->
          <div id="llm-test-banner" class="test-banner" style="display:none;"></div>

          <!-- MODAL ACTIONS -->
          <div class="modal-actions-row">
            <button type="button" class="btn btn-secondary" id="btn-test-llm-connection">
              ⚡ Test Connection
            </button>
            <div class="actions-right">
              <button type="button" class="btn btn-secondary" id="btn-cancel-llm-modal">Cancel</button>
              <button type="submit" class="btn btn-primary" id="btn-save-llm-config">
                Save &amp; Activate
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  `;
}
