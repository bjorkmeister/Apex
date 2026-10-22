/**
 * APEX War Room Interactive Server & API (`/src/app/server.ts`).
 *
 * Launch with:
 *   npm run dev
 */
import http from "node:http";
import {
  type ActionPayload,
  applyAssumptionUpdate,
  applyInitialCapitalAndCommercialModel,
  type AssumptionKey,
  commitAction,
  compileBusinessPrompt,
  createRootBranch,
  debitBalance,
  evolveVentureToNextStage,
  executeStrategicPlay,
  exportExecutiveBusinessCaseMarkdown,
  forkTimelineBranch,
  type LlmCallMetadata,
  type MaskedLlmConfig,
  getMaskedLlmConfig,
  recordEngineActivity,
  setActiveLlmConfig,
  testLlmConnection,
  generateWarRoomBriefing,
  generateWarRoomBriefingWithLlm,
  type IndustryArchetype,
  isLlmConfigured,
  loadScenarioPreset,
  type MonteCarloSummary,
  type NegotiationOutcome,
  negotiateWithCounterparty,
  PROVIDER_PRESETS,
  runMarketResearchAndCalibrateWithLlm,
  runMicroTickLoop,
  runMonteCarloSimulation,
  runTicks,
  type ScenarioPresetId,
  stepLivingWorldDynamics,
  stepTick,
  type TimelineBranch,
  type TriggerAlert,
  validateAction,
  type WarRoomBriefing,
  type WorldState,
} from "../core";
import {
  type SelectedNode,
  renderGenesisCanvas,
  renderGenesisTabulaRasa,
  renderLlmConfigModal,
} from "../components";
import { WAR_ROOM_CSS } from "./styles";
import { handleFlowRequest } from "../flow/server/routes.ts";
import {
  renderWarRoomDashboard,
  type TwoPhaseActionFeedback,
  type WarRoomTab,
  type WarRoomViewState,
  type WorkspaceViewMode,
} from "./war-room-view";

export type AppViewMode = "genesis" | "canvas" | "war_room";

export interface GenesisDraft {
  prompt: string;
  initialCapitalEuros?: number;
  commercialModelNotes?: string;
  archetype?: IndustryArchetype;
  founderRole: "solo_founder" | "commercial" | "product" | "general_manager" | "custom";
  customFounderRole?: string;
  capabilities: {
    production: "in_house" | "outsource";
    warehouse: "in_house" | "outsource";
    logistics: "in_house" | "outsource";
    qa: "in_house" | "outsource";
  };
}

export interface WarRoomSession {
  mode: AppViewMode;
  draft: GenesisDraft;
  branches: TimelineBranch[];
  activeBranchId: string;
  activeTab: WarRoomTab;
  workspaceView: WorkspaceViewMode;
  clarityMode: "simple" | "expert";
  selectedNode: SelectedNode | null;
  selectedAssumption: AssumptionKey | null;
  drawerExpanded: boolean;
  mcSummary: MonteCarloSummary | null;
  lastNegotiation: NegotiationOutcome | null;
  exportedMarkdown: string | null;
  lastActionFeedback: TwoPhaseActionFeedback | null;
  lastMacroStepSummary: {
    ticksExecuted: number;
    yielded: boolean;
    triggers: TriggerAlert[];
  } | null;
  liveBriefing: WarRoomBriefing | null;
  lastLlmMeta: LlmCallMetadata | null;
}

/**
 * Execute an `ActionPayload` against `state` using strict Two-Phase Commit (`validateAction` -> `commitAction`)
 * and record structured diagnostics on `session.lastActionFeedback`.
 */
export function executeTwoPhaseActionOnSession(
  session: WarRoomSession,
  state: WorldState,
  payload: ActionPayload,
  issuedBy: string,
): TwoPhaseActionFeedback {
  const validation = validateAction(state, payload);
  if (!validation.valid || !validation.validatedAction) {
    const feedback: TwoPhaseActionFeedback = {
      ok: false,
      actionType: payload.type,
      issuedBy,
      tick: state.calendar.tick,
      summary: `Rejected by Two-Phase Commit validator (${validation.diagnostics.length} diagnostic error(s))`,
      diagnostics: validation.diagnostics,
    };
    session.lastActionFeedback = feedback;
    recordEngineActivity({
      actor: "engine",
      title: `2PC Hylätty [${payload.type}]`,
      detail: validation.diagnostics.map((d) => `${d.code}: ${d.message}`).join(" | "),
      ok: false,
    });
    return feedback;
  }

  commitAction(state, validation.validatedAction, { issuedBy });
  const lastHistory = state.actionHistory[state.actionHistory.length - 1];
  const summaryText =
    lastHistory?.effects.join("; ") ||
    `${payload.type} validated and committed atomically.`;
  const feedback: TwoPhaseActionFeedback = {
    ok: true,
    actionType: payload.type,
    issuedBy,
    tick: state.calendar.tick,
    summary: summaryText,
    diagnostics: [],
  };
  session.lastActionFeedback = feedback;
  recordEngineActivity({
    actor: "player",
    title: `Toiminto vahvistettu [${payload.type}]`,
    detail: summaryText,
    ok: true,
  });
  return feedback;
}

export function createInitialSession(
  presetId: ScenarioPresetId = "vertical_farm",
  initialMode: AppViewMode = "war_room",
): WarRoomSession {
  const initial = loadScenarioPreset(presetId, 20261016);
  // Step Tick 1 so daily telemetry & market share are live immediately on open
  stepTick(initial, { strictInvariants: true });
  const root = createRootBranch(initial, `main (${initial.company.name})`);
  const isGenesis = initialMode === "genesis";
  return {
    mode: initialMode,
    draft: {
      prompt: isGenesis ? "" : (initial.company.prompt || initial.company.tagline || ""),
      initialCapitalEuros: isGenesis ? 10_000 : initial.company.initialCapitalEuros,
      commercialModelNotes: isGenesis ? "" : initial.company.commercialModelNotes,
      archetype: initial.company.archetype,
      founderRole: "solo_founder",
      capabilities: {
        production: "in_house",
        warehouse: "in_house",
        logistics: "outsource",
        qa: "in_house",
      },
    },
    branches: [root],
    activeBranchId: root.id,
    activeTab: "financials",
    workspaceView: "daily",
    clarityMode: "simple",
    selectedNode: {
      kind: "workCenter",
      id: initial.operations.workCenters[0]?.id ?? "",
    },
    selectedAssumption: "selling_price",
    drawerExpanded: false,
    mcSummary: null,
    lastNegotiation: null,
    exportedMarkdown: null,
    lastActionFeedback: null,
    lastMacroStepSummary: null,
    liveBriefing: null,
    lastLlmMeta: null,
  };
}

function getActiveBranch(session: WarRoomSession): TimelineBranch {
  return (
    session.branches.find((b) => b.id === session.activeBranchId) ?? session.branches[0]
  );
}

export function buildViewPayload(session: WarRoomSession): {
  html: string;
  mode: AppViewMode;
  status: string;
  tick: number;
  companyName: string;
  archetype: string;
  triggers: TriggerAlert[];
  lastActionFeedback: TwoPhaseActionFeedback | null;
  llmMeta: LlmCallMetadata | null;
  llmConfig: MaskedLlmConfig;
  exportedMarkdown: string | null;
} {
  const branch = getActiveBranch(session);
  const state = branch.head;
  const maskedConfig = getMaskedLlmConfig();

  // Mode 0: Tabula Rasa (Clean Slate Idea Prompt)
  if (session.mode === "genesis") {
    const html =
      renderGenesisTabulaRasa({
        mode: "genesis",
        draftPrompt: session.draft.prompt,
        initialCapitalEuros: session.draft.initialCapitalEuros,
        commercialModelNotes: session.draft.commercialModelNotes,
        state,
        founderRole: session.draft.founderRole,
        capabilities: session.draft.capabilities,
        llmConfig: maskedConfig,
      }) + renderLlmConfigModal(maskedConfig);

    return {
      html,
      mode: session.mode,
      status: state.status,
      tick: state.calendar.tick,
      companyName: state.company.name,
      archetype: state.company.archetype ?? "ASSET_HEAVY_MANUFACTURING",
      triggers: state.lastTriggers ?? [],
      lastActionFeedback: session.lastActionFeedback,
      llmMeta: session.lastLlmMeta,
      llmConfig: maskedConfig,
      exportedMarkdown: session.exportedMarkdown,
    };
  }

  // Mode 1: Business Idea Canvas (Team, Sense Check & Capability Setup)
  if (session.mode === "canvas") {
    const html =
      renderGenesisCanvas({
        mode: "canvas",
        draftPrompt: session.draft.prompt,
        initialCapitalEuros:
          session.draft.initialCapitalEuros ?? state.company.initialCapitalEuros,
        commercialModelNotes:
          session.draft.commercialModelNotes ?? state.company.commercialModelNotes,
        state,
        founderRole: session.draft.founderRole,
        customFounderRole: session.draft.customFounderRole,
        capabilities: session.draft.capabilities,
        llmConfig: maskedConfig,
      }) + renderLlmConfigModal(maskedConfig);

    return {
      html,
      mode: session.mode,
      status: state.status,
      tick: state.calendar.tick,
      companyName: state.company.name,
      archetype: state.company.archetype ?? "ASSET_HEAVY_MANUFACTURING",
      triggers: state.lastTriggers ?? [],
      lastActionFeedback: session.lastActionFeedback,
      llmMeta: session.lastLlmMeta,
      llmConfig: maskedConfig,
      exportedMarkdown: session.exportedMarkdown,
    };
  }

  // Mode 2: The War Room (Mission Control)
  const briefing =
    session.liveBriefing && session.liveBriefing.tick === state.calendar.tick
      ? session.liveBriefing
      : generateWarRoomBriefing(state);

  const viewState: WarRoomViewState = {
    state,
    branches: session.branches,
    activeBranchId: session.activeBranchId,
    briefing,
    activeTab: session.activeTab,
    workspaceView: session.workspaceView ?? "daily",
    clarityMode: session.clarityMode ?? "simple",
    selectedNode: session.selectedNode,
    selectedAssumption: session.selectedAssumption ?? "selling_price",
    drawerExpanded: session.drawerExpanded ?? false,
    mcSummary: session.mcSummary,
    lastNegotiation: session.lastNegotiation,
    exportedMarkdown: session.exportedMarkdown,
    lastActionFeedback: session.lastActionFeedback,
    lastMacroStepSummary: session.lastMacroStepSummary,
    llmMeta: session.lastLlmMeta,
    llmConfig: maskedConfig,
    geminiConfigured: isLlmConfigured(),
  };

  return {
    html: renderWarRoomDashboard(viewState),
    mode: session.mode,
    status: state.status,
    tick: state.calendar.tick,
    companyName: state.company.name,
    archetype: state.company.archetype ?? "ASSET_HEAVY_MANUFACTURING",
    triggers: state.lastTriggers ?? [],
    lastActionFeedback: session.lastActionFeedback,
    llmMeta: session.lastLlmMeta,
    llmConfig: maskedConfig,
    exportedMarkdown: session.exportedMarkdown,
  };
}

const CLIENT_BOOTSTRAP_JS = `
(() => {
  let playTimer = null;
  let currentSpeed = 0;
  const PRESET_DATA = ${JSON.stringify(PROVIDER_PRESETS)};

  function openLlmModal() {
    const backdrop = document.getElementById("llm-modal-backdrop");
    if (backdrop) backdrop.style.display = "flex";
  }

  function closeLlmModal() {
    const backdrop = document.getElementById("llm-modal-backdrop");
    if (backdrop) backdrop.style.display = "none";
  }

  function setProviderUI(provId) {
    const prov = PRESET_DATA[provId] || PRESET_DATA.deterministic;
    const hiddenInput = document.getElementById("llm-form-provider");
    if (hiddenInput) hiddenInput.value = prov.id;

    document.querySelectorAll("[data-select-provider]").forEach((el) => {
      if (el.getAttribute("data-select-provider") === prov.id) {
        el.classList.add("selected");
      } else {
        el.classList.remove("selected");
      }
    });

    const keyGroup = document.getElementById("llm-key-group");
    const modelGroup = document.getElementById("llm-model-group");
    if (keyGroup) keyGroup.style.display = prov.requiresKey ? "" : "none";
    if (modelGroup) modelGroup.style.display = prov.requiresKey ? "" : "none";

    const nameLabel = document.getElementById("llm-provider-name-label");
    if (nameLabel) nameLabel.textContent = prov.name;

    const keyInput = document.getElementById("llm-api-key-input");
    if (keyInput) keyInput.placeholder = prov.keyPlaceholder;

    const docLink = document.getElementById("llm-key-doc-link");
    if (docLink) {
      if (prov.keyDocUrl) {
        docLink.href = prov.keyDocUrl;
        docLink.style.display = "";
      } else {
        docLink.style.display = "none";
      }
    }

    const modelSelect = document.getElementById("llm-model-select");
    if (modelSelect) {
      modelSelect.innerHTML = prov.models
        .map((m) => '<option value="' + m + '">' + m + (m === prov.defaultModel ? " (Default)" : "") + '</option>')
        .join("") + '<option value="__custom__">Custom Model ID...</option>';
    }

    const customInput = document.getElementById("llm-custom-model-input");
    if (customInput) customInput.style.display = "none";

    const banner = document.getElementById("llm-test-banner");
    if (banner) banner.style.display = "none";
  }

  // Restore saved key from localStorage if available
  try {
    const savedProvider = localStorage.getItem("apex_llm_provider");
    const savedKey = localStorage.getItem("apex_llm_key");
    const savedModel = localStorage.getItem("apex_llm_model");
    if (savedProvider || savedKey || savedModel) {
      fetch("/api/llm/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: savedProvider || undefined,
          apiKey: savedKey || undefined,
          model: savedModel || undefined,
        }),
      });
    }
  } catch (_) {}

  let activeTimerInterval = null;
  let activeTimerStartTime = 0;

  function showLiveActivityBanner(label) {
    const statusText = document.getElementById("live-activity-status-text");
    if (statusText) {
      statusText.innerHTML = '⏳ <b style="color:#38bdf8">Suoritetaan nyt:</b> <span>' + label + '</span>';
    }
    const genBanner = document.getElementById("genesis-live-activity-banner");
    const genTitle = document.getElementById("genesis-live-activity-title");
    const genSub = document.getElementById("genesis-live-activity-sub");
    if (genBanner) {
      genBanner.style.display = "block";
      if (genTitle) genTitle.textContent = label;
      if (genSub) {
        genSub.textContent = "Kutsutaan tekoälymoottoria ja lasketaan alkutilan arvoketju...";
      }
    }
    const canBanner = document.getElementById("canvas-live-activity-banner");
    const canText = document.getElementById("canvas-live-activity-text");
    if (canBanner) {
      canBanner.style.display = "block";
      if (canText) canText.textContent = label;
    }

    if (activeTimerInterval) {
      clearInterval(activeTimerInterval);
    }
    activeTimerStartTime = Date.now();
    activeTimerInterval = setInterval(() => {
      const elapsedSec = ((Date.now() - activeTimerStartTime) / 1000).toFixed(1) + "s";
      const genTimer = document.getElementById("genesis-live-activity-timer");
      if (genTimer) genTimer.textContent = elapsedSec;
      const canTimer = document.getElementById("canvas-live-activity-timer");
      if (canTimer) canTimer.textContent = elapsedSec;
    }, 100);
  }

  function hideLiveActivityBanner() {
    if (activeTimerInterval) {
      clearInterval(activeTimerInterval);
      activeTimerInterval = null;
    }
    const genBanner = document.getElementById("genesis-live-activity-banner");
    if (genBanner) genBanner.style.display = "none";
    const canBanner = document.getElementById("canvas-live-activity-banner");
    if (canBanner) canBanner.style.display = "none";
  }

  async function apiCall(path, body = {}, activityLabel = "") {
    if (activityLabel) {
      showLiveActivityBanner(activityLabel);
    }
    try {
      const res = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      hideLiveActivityBanner();
      if (!res.ok) {
        const errText = await res.text();
        console.error("API Error:", errText);
        let parsedErrMsg = errText;
        try {
          const errObj = JSON.parse(errText);
          parsedErrMsg = errObj.error || errText;
        } catch (_) {}
        alert(["⚠️ Virhe toiminnon suorittamisessa (" + res.status + "):", "", parsedErrMsg.slice(0, 350)].join(String.fromCharCode(10)));
        return null;
      }
      const data = await res.json();
      if (data && data.html) {
        const root = document.getElementById("war-room-root");
        if (root) root.innerHTML = data.html;
        syncPlayButtons();
      }
      if (data && data.status !== "running" && playTimer) {
        stopAutoPlay();
      }
      return data;
    } catch (e) {
      hideLiveActivityBanner();
      console.error("Network/API Exception:", e);
      alert(["⚠️ Yhteysvirhe simulaatiopalvelimeen:", "", (e.message || String(e))].join(String.fromCharCode(10)));
      return null;
    }
  }

  function stopAutoPlay() {
    if (playTimer) {
      clearInterval(playTimer);
      playTimer = null;
    }
    currentSpeed = 0;
    syncPlayButtons();
  }

  function startAutoPlay(speed) {
    stopAutoPlay();
    currentSpeed = speed;
    const intervalMs = speed >= 5 ? 320 : 950;
    playTimer = setInterval(() => {
      apiCall("/api/step", { ticks: 1 }, "Simuloidaan seuraavaa päivää (+1 pv)...");
    }, intervalMs);
    syncPlayButtons();
  }

  function syncPlayButtons() {
    const playBtn = document.getElementById("btn-play-toggle");
    const fastBtn = document.getElementById("btn-fast-toggle");
    if (playBtn) {
      playBtn.textContent = currentSpeed === 1 ? "⏸ Pause (1x)" : "▶ Play 1x";
      playBtn.className = "btn btn-sm " + (currentSpeed === 1 ? "btn-primary" : "btn-secondary");
    }
    if (fastBtn) {
      fastBtn.textContent = currentSpeed === 5 ? "⏸ Pause (5x)" : "⏩ 5x";
      fastBtn.className = "btn btn-sm " + (currentSpeed === 5 ? "btn-primary" : "btn-secondary");
    }
  }

  document.addEventListener("click", async (e) => {
    const target = e.target;
    if (!(target instanceof Element)) return;

    // 0. Football Manager Assumption (*) Pill or Dependency Card click -> open/focus Assumption Explorer
    const assumptionEl = target.closest("[data-assumption-key]");
    if (assumptionEl) {
      const aKey = assumptionEl.getAttribute("data-assumption-key");
      if (aKey) {
        await apiCall("/api/assumption", { selectKey: aKey }, "Avataan muuttujan " + aKey + " sidonnaisuusketju...");
        const panel = document.getElementById("assumption-inspector-panel");
        if (panel) panel.scrollIntoView({ behavior: "smooth", block: "nearest" });
        const valInp = document.getElementById("assumption-value-input");
        if (valInp instanceof HTMLInputElement) {
          valInp.focus();
          valInp.select();
        }
      }
      return;
    }

    // 0b. Assumption quick nudge (-10% / +10%)
    const nudgeEl = target.closest("[data-assumption-nudge]");
    if (nudgeEl) {
      const rawNudge = nudgeEl.getAttribute("data-assumption-nudge");
      if (rawNudge) {
        const [aKey, valStr] = rawNudge.split(":");
        await apiCall("/api/assumption", { key: aKey, value: Number(valStr) }, "Päivitetään oletusarvo ja lasketaan vaikutusketju...");
      }
      return;
    }

    // 0c. Workspace View Tab click (Daily / Assumptions / Market / Growth / ERP / All)
    const wsBtn = target.closest("[data-ws-view]");
    if (wsBtn) {
      const wsView = wsBtn.getAttribute("data-ws-view");
      if (wsView) {
        await apiCall("/api/ui", { workspaceView: wsView });
      }
      return;
    }

    // 1. Value Chain SVG Node click (excluding buttons inside command cards)
    const vcNode = target.closest("[data-node-kind]");
    if (vcNode && !target.closest("button[data-action]")) {
      const kind = vcNode.getAttribute("data-node-kind");
      const id = vcNode.getAttribute("data-node-id");
      await apiCall("/api/ui", { selectedNode: { kind, id }, workspaceView: "daily" });
      const insp = document.querySelector(".vc-inspector-wrap");
      if (insp) insp.scrollIntoView({ behavior: "smooth", block: "nearest" });
      return;
    }

    // 1b. KPI Card click -> drill down to relevant node & drawer tab
    const kpiCard = target.closest("[data-kpi-drilldown]");
    if (kpiCard) {
      const kpi = kpiCard.getAttribute("data-kpi-drilldown");
      await apiCall("/api/ui", { kpiDrilldown: kpi, workspaceView: "erp" });
      const drawer = document.getElementById("fm-deep-dive-drawer") || document.querySelector(".drawer-tabs");
      if (drawer) drawer.scrollIntoView({ behavior: "smooth", block: "nearest" });
      return;
    }

    const btn = target.closest("button");
    if (!btn) return;

    // 1c. Scale Venture to Next Evolution Stage (Stage 1 -> 2 -> 3 -> 4)
    if (btn.getAttribute("data-scale-venture") === "true") {
      e.preventDefault();
      stopAutoPlay();
      btn.textContent = "🚀 Skaalataan liiketoimintaa...";
      btn.disabled = true;
      await apiCall("/api/scale", {}, "Skaalataan yritystä seuraavaan kasvuvaiheeseen...");
      return;
    }

    // 1d. Execute Strategic Play ("Peliliike")
    const playId = btn.getAttribute("data-execute-play");
    if (playId) {
      e.preventDefault();
      stopAutoPlay();
      btn.textContent = "⚡ Toteutetaan peliliike...";
      btn.disabled = true;
      await apiCall("/api/play", { playId }, "Toteutetaan strateginen peliliike ja lasketaan kilpailijoiden vastareaktio...");
      return;
    }

    // 2. Play / 5x toggle
    if (btn.id === "btn-play-toggle") {
      if (currentSpeed === 1) stopAutoPlay();
      else startAutoPlay(1);
      return;
    }
    if (btn.id === "btn-fast-toggle") {
      if (currentSpeed === 5) stopAutoPlay();
      else startAutoPlay(5);
      return;
    }

    // 3. Step until next Tiered Tick-Clock Trigger / Macro Briefing
    if (btn.getAttribute("data-step-macro") === "true") {
      stopAutoPlay();
      await apiCall("/api/step", { macro: true }, "Simuloidaan päiviä seuraavaan katsaukseen tai hälytykseen asti...");
      return;
    }

    // 4. Step N ticks
    const stepTicks = btn.getAttribute("data-step-ticks");
    if (stepTicks) {
      stopAutoPlay();
      await apiCall("/api/step", { ticks: Number(stepTicks) }, "Simuloidaan +" + stepTicks + " pv eteenpäin (8-vaiheinen moottori)...");
      return;
    }

    // 5. Load Preset
    const presetId = btn.getAttribute("data-load-preset");
    if (presetId) {
      stopAutoPlay();
      await apiCall("/api/preset", { presetId }, "Ladataan yritysskenaario...");
      return;
    }

    // 6. Switch Drawer Tab
    const tab = btn.getAttribute("data-tab");
    if (tab) {
      await apiCall("/api/ui", { activeTab: tab, workspaceView: "erp" });
      const drawer = document.querySelector(".drawer-tabs");
      if (drawer) drawer.scrollIntoView({ behavior: "smooth", block: "nearest" });
      return;
    }

    // 6b. Switch Clarity Mode (Selkokieli vs Controller & M&A)
    const clarity = btn.getAttribute("data-set-clarity");
    if (clarity) {
      await apiCall("/api/ui", { clarityMode: clarity });
      return;
    }

    // 7. Direct ActionPayload button (routed via Two-Phase Commit)
    const rawAction = btn.getAttribute("data-action");
    if (rawAction) {
      try {
        const action = JSON.parse(rawAction);
        await apiCall("/api/action", { action }, "Suoritetaan päätös (" + action.type + ") Two-Phase Commit -tarkistuksella...");
      } catch (err) {
        console.error(err);
      }
      return;
    }

    // 8. Price shift button
    const priceShift = btn.getAttribute("data-price-shift");
    if (priceShift) {
      const [offeringId, multStr] = priceShift.split(":");
      await apiCall("/api/action", { priceShift: { offeringId, multiplier: Number(multStr) } }, "Päivitetään myyntihintaa ja lasketaan kysyntäjousto...");
      return;
    }

    // 9. Execute C-Suite Agent Proposal
    const propIdx = btn.getAttribute("data-agent-proposal-idx");
    if (propIdx !== null) {
      await apiCall("/api/action", { agentProposalIndex: Number(propIdx) }, "Toteutetaan suositeltu toimenpide...");
      return;
    }

    // 10. Resolve Crisis Decision Card
    const resolveDec = btn.getAttribute("data-resolve-decision");
    if (resolveDec) {
      const [decisionId, optionId] = resolveDec.split(":");
      await apiCall("/api/action", {
        action: { type: "RESOLVE_DECISION", decisionId, optionId },
        stepAfter: true,
      }, "Ratkaistaan tilannepäätös ja jatketaan simulaatiota...");
      return;
    }

    // 11. Counterparty Negotiation
    const negSup = btn.getAttribute("data-negotiate-supplier");
    if (negSup) {
      await apiCall("/api/negotiate", { counterpartyKind: "supplier", counterpartyId: negSup }, "Neuvotellaan tavarantoimittajan kanssa...");
      return;
    }
    const negInv = btn.getAttribute("data-negotiate-investor");
    if (negInv) {
      await apiCall("/api/negotiate", { counterpartyKind: "investor", counterpartyId: negInv }, "Neuvotellaan rahoittajan kanssa...");
      return;
    }

    // 12. Timeline Branching ("Git for Business Strategy")
    if (btn.id === "btn-fork-branch") {
      const branchName = prompt("Anna nimi uudelle rinnakkaiselle skenaariohaaralle:", "Skenaario-" + Math.floor(Math.random() * 900 + 100));
      if (branchName) {
        await apiCall("/api/branch", { op: "fork", name: branchName });
      }
      return;
    }
    const switchBranchId = btn.getAttribute("data-switch-branch");
    if (switchBranchId) {
      stopAutoPlay();
      await apiCall("/api/branch", { op: "checkout", branchId: switchBranchId });
      return;
    }

    // 13. Monte Carlo Simulator
    if (btn.id === "btn-run-montecarlo") {
      btn.textContent = "Lasketaan 12×60 pv...";
      await apiCall("/api/montecarlo", { runs: 12, horizonDays: 60 }, "Ajetaan 12×60 päivän stokastinen Monte Carlo -simulaatio...");
      return;
    }

    // 14. Executive Business Case Export
    if (btn.id === "btn-generate-export") {
      await apiCall("/api/export", {}, "Luodaan liiketoimintasuunnitelma ja tulosraportti...");
      return;
    }
    if (btn.id === "btn-download-export") {
      const pre = document.querySelector(".markdown-preview");
      if (pre) {
        const blob = new Blob([pre.textContent || ""], { type: "text/markdown;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "APEX-Executive-Business-Case.md";
        a.click();
        URL.revokeObjectURL(url);
      }
      return;
    }

    if (btn.id === "btn-refresh-briefing") {
      btn.textContent = "Päivitetään tilannekuva...";
      await apiCall("/api/briefing", {}, "Tekoäly analysoi yrityksen tilannetta ja päivittää muistilistan...");
      return;
    }

    // 15. LLM BYOK Modal triggers
    if (btn.id === "btn-open-llm-modal") {
      openLlmModal();
      return;
    }
    if (btn.id === "btn-close-llm-modal" || btn.id === "btn-cancel-llm-modal") {
      closeLlmModal();
      return;
    }
    const provChoice = btn.closest("[data-select-provider]");
    if (provChoice) {
      const provId = provChoice.getAttribute("data-select-provider");
      if (provId) setProviderUI(provId);
      return;
    }
    if (btn.id === "btn-toggle-key-visibility") {
      const inp = document.getElementById("llm-api-key-input");
      if (inp) {
        if (inp.type === "password") {
          inp.type = "text";
          btn.textContent = "🙈 Hide";
        } else {
          inp.type = "password";
          btn.textContent = "👁 Show";
        }
      }
      return;
    }
    if (btn.id === "btn-clear-key") {
      const inp = document.getElementById("llm-api-key-input");
      if (inp) inp.value = "";
      try {
        localStorage.removeItem("apex_llm_key");
      } catch (_) {}
      await apiCall("/api/llm/config", { apiKey: "" });
      closeLlmModal();
      return;
    }
    if (btn.id === "btn-test-llm-connection") {
      const prov = document.getElementById("llm-form-provider")?.value || "deterministic";
      const key = document.getElementById("llm-api-key-input")?.value || "";
      const sel = document.getElementById("llm-model-select");
      let model = sel?.value || "";
      if (model === "__custom__") {
        model = document.getElementById("llm-custom-model-input")?.value || "";
      }
      const banner = document.getElementById("llm-test-banner");
      if (banner) {
        banner.style.display = "flex";
        banner.className = "test-banner test-banner-loading";
        banner.textContent = "Testing connection to " + (PRESET_DATA[prov]?.name || prov) + "...";
      }
      const testRes = await fetch("/api/llm/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config: { provider: prov, apiKey: key || undefined, model } }),
      }).then((r) => r.json()).catch((err) => ({ ok: false, message: String(err) }));

      if (banner) {
        if (testRes && testRes.ok) {
          banner.className = "test-banner test-banner-ok";
          banner.textContent = "✓ " + testRes.message;
        } else {
          banner.className = "test-banner test-banner-err";
          banner.textContent = "✕ " + (testRes ? testRes.message : "Connection failed");
        }
      }
      return;
    }

    // 16. Genesis Phase 0 & Phase 1 triggers
    const capQuickBtn = target.closest("[data-set-genesis-capital]");
    if (capQuickBtn) {
      const capVal = capQuickBtn.getAttribute("data-set-genesis-capital");
      const capInp = document.getElementById("genesis-capital-input");
      if (capInp instanceof HTMLInputElement && capVal) {
        capInp.value = capVal;
      }
      document.querySelectorAll("[data-set-genesis-capital]").forEach((el) => {
        if (el.getAttribute("data-set-genesis-capital") === capVal) {
          el.classList.remove("btn-secondary");
          el.classList.add("btn-primary");
        } else {
          el.classList.remove("btn-primary");
          el.classList.add("btn-secondary");
        }
      });
      return;
    }

    const promptPill = target.closest("[data-fill-prompt]");
    if (promptPill) {
      const text = promptPill.getAttribute("data-fill-prompt");
      const capVal = promptPill.getAttribute("data-fill-capital");
      const notesVal = promptPill.getAttribute("data-fill-notes");
      const inp = document.getElementById("genesis-prompt-input");
      if ((inp instanceof HTMLInputElement || inp instanceof HTMLTextAreaElement) && text) {
        inp.value = text;
        inp.focus();
      }
      const capInp = document.getElementById("genesis-capital-input");
      if ((capInp instanceof HTMLInputElement || capInp instanceof HTMLTextAreaElement) && capVal) {
        capInp.value = capVal;
      }
      const notesInp = document.getElementById("genesis-commercial-notes");
      if ((notesInp instanceof HTMLInputElement || notesInp instanceof HTMLTextAreaElement) && notesVal !== null) {
        notesInp.value = notesVal;
      }
      return;
    }

    const senseSuggestBtn = target.closest("[data-sensecheck-suggest]");
    if (senseSuggestBtn) {
      const rawSuggest = senseSuggestBtn.getAttribute("data-sensecheck-suggest");
      if (rawSuggest) {
        const [sKey, sValStr] = rawSuggest.split(":");
        senseSuggestBtn.textContent = "⏳ Päivitetään laskelma...";
        senseSuggestBtn.disabled = true;
        await apiCall(
          "/api/genesis/sensecheck-adjust",
          { key: sKey, value: Number(sValStr) },
          "Päivitetään Sense Check -laskelmaa ja kannattavuutta...",
        );
      }
      return;
    }

    const sandboxCard = target.closest("[data-launch-sandbox]");
    if (sandboxCard) {
      const presetId = sandboxCard.getAttribute("data-launch-sandbox");
      if (presetId) {
        await apiCall("/api/genesis/sandbox", { presetId }, "Avataan valmis esimerkkiliiketoiminta...");
      }
      return;
    }

    if (
      btn.id === "btn-back-to-spark" ||
      btn.id === "btn-back-to-spark-bottom" ||
      btn.id === "btn-return-genesis"
    ) {
      stopAutoPlay();
      await apiCall("/api/genesis/reset", {});
      return;
    }

    const capBtn = target.closest("[data-set-cap]");
    if (capBtn) {
      const capAttr = capBtn.getAttribute("data-set-cap");
      if (capAttr) {
        const [capability, mode] = capAttr.split(":");
        await apiCall("/api/genesis/config", { capability, mode });
      }
      return;
    }

    if (
      btn.id === "btn-launch-mission-control" ||
      btn.id === "btn-launch-mission-control-top" ||
      btn.id === "btn-launch-mission-control-banner"
    ) {
      btn.textContent = "🚀 Käynnistetään simulaatio...";
      btn.disabled = true;
      await apiCall(
        "/api/genesis/launch",
        {},
        "Käynnistetään simulaatio ja avataan yrityksen ohjaamo (Päivä 1)...",
      );
      return;
    }

    if (btn.id === "btn-submit-spark") {
      e.preventDefault();
      triggerGenesisSpark();
      return;
    }
  });

  async function triggerGenesisSpark() {
    const inp = document.getElementById("genesis-prompt-input");
    const capInp = document.getElementById("genesis-capital-input");
    const notesInp = document.getElementById("genesis-commercial-notes");
    const prompt =
      (inp && "value" in inp) ? String(inp.value).trim() : "";
    const initialCapitalEuros =
      (capInp && "value" in capInp && capInp.value)
        ? Number(capInp.value)
        : undefined;
    const commercialModelNotes =
      (notesInp && "value" in notesInp) ? String(notesInp.value).trim() : "";
    const submitBtn = document.getElementById("btn-submit-spark");
    const prevBtnText = submitBtn ? submitBtn.textContent : "";
    if (submitBtn instanceof HTMLButtonElement) {
      submitBtn.textContent = "⏳ Luodaan liiketoimintamallia & Sense Checkiä...";
      submitBtn.disabled = true;
    }
    try {
      const res = await apiCall(
        "/api/genesis/spark",
        { prompt, initialCapitalEuros, commercialModelNotes },
        "Tekoäly & Business Compiler rakentavat yrityksen tuotteet, tukun, kulurakenteen ja Sense Check -riskianalyysin...",
      );
      if (!res && submitBtn instanceof HTMLButtonElement) {
        submitBtn.disabled = false;
        if (prevBtnText) submitBtn.textContent = prevBtnText;
      }
    } catch (_) {
      if (submitBtn instanceof HTMLButtonElement) {
        submitBtn.disabled = false;
        if (prevBtnText) submitBtn.textContent = prevBtnText;
      }
    }
  }

  // Close modal when clicking on backdrop
  document.addEventListener("click", (e) => {
    if (e.target && e.target.id === "llm-modal-backdrop") {
      closeLlmModal();
    }
  });

  // Radio button and select changes
  document.addEventListener("change", async (e) => {
    if (e.target && e.target instanceof HTMLInputElement && e.target.name === "founder_role") {
      await apiCall("/api/genesis/config", { founderRole: e.target.value });
      return;
    }
    if (e.target && e.target instanceof HTMLInputElement && e.target.id === "custom-founder-role-input") {
      await fetch("/api/genesis/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ founderRole: "custom", customFounderRole: e.target.value }),
      });
      return;
    }
    if (e.target && e.target.id === "llm-model-select") {
      const customInput = document.getElementById("llm-custom-model-input");
      if (customInput) {
        customInput.style.display = e.target.value === "__custom__" ? "" : "none";
      }
    }
  });

  // Track live typing into custom founder role input without triggering full HTML re-render
  document.addEventListener("input", (e) => {
    if (e.target && e.target instanceof HTMLInputElement && e.target.id === "custom-founder-role-input") {
      const customRadio = document.querySelector('input[name="founder_role"][value="custom"]');
      if (customRadio && !customRadio.checked) {
        customRadio.checked = true;
      }
      fetch("/api/genesis/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ founderRole: "custom", customFounderRole: e.target.value }),
      });
    }
  });

  // Form submissions: Genesis Spark, Compiler & LLM BYOK
  document.addEventListener("submit", async (e) => {
    const form = e.target;
    if (!(form instanceof HTMLFormElement)) return;

    if (form.id === "genesis-spark-form") {
      e.preventDefault();
      triggerGenesisSpark();
      return;
    }

    if (form.id === "llm-config-form") {
      e.preventDefault();
      const prov = document.getElementById("llm-form-provider")?.value || "deterministic";
      const key = document.getElementById("llm-api-key-input")?.value || "";
      const sel = document.getElementById("llm-model-select");
      let model = sel?.value || "";
      if (model === "__custom__") {
        model = document.getElementById("llm-custom-model-input")?.value || "";
      }
      try {
        localStorage.setItem("apex_llm_provider", prov);
        if (key) localStorage.setItem("apex_llm_key", key);
        if (model) localStorage.setItem("apex_llm_model", model);
      } catch (_) {}
      await apiCall("/api/llm/config", {
        provider: prov,
        apiKey: key || undefined,
        model: model || undefined,
      });
      closeLlmModal();
      return;
    }

    if (form.id === "market-research-form") {
      e.preventDefault();
      stopAutoPlay();
      const qInput = document.getElementById("market-research-query");
      const query = qInput instanceof HTMLInputElement ? qInput.value.trim() : "";
      const btn = document.getElementById("btn-run-market-research");
      if (btn instanceof HTMLButtonElement) {
        btn.textContent = "🌍 Haetaan web-dataa & kalibroidaan *-muuttujia...";
        btn.disabled = true;
      }
      await apiCall(
        "/api/research",
        { query },
        "Haetaan live-markkinadataa ja kalibroidaan *-oletuksia...",
      );
      return;
    }

    if (form.id === "assumption-edit-form") {
      e.preventDefault();
      const keyInput = document.getElementById("assumption-key-input");
      const valInput = document.getElementById("assumption-value-input");
      const key = keyInput instanceof HTMLInputElement ? keyInput.value : "";
      const val = valInput instanceof HTMLInputElement ? Number(valInput.value) : NaN;
      if (key && Number.isFinite(val)) {
        await apiCall(
          "/api/assumption",
          { key, value: val },
          "Päivitetään muuttuja " + key + " ja lasketaan vaikutusketju...",
        );
      }
      return;
    }

    if (form.id === "compiler-form") {
      e.preventDefault();
      stopAutoPlay();
      const input = document.getElementById("compiler-prompt-input");
      const select = document.getElementById("compiler-archetype-select");
      const promptText = input instanceof HTMLInputElement ? input.value.trim() : "";
      const archetype = select instanceof HTMLSelectElement && select.value ? select.value : undefined;
      if (!promptText && !archetype) return;
      await apiCall(
        "/api/compile",
        {
          prompt: promptText || "Autonomous Enterprise Venture",
          archetype,
        },
        "Käännetään uusi liike-idea yritysmalliksi...",
      );
      return;
    }
  });

  // Keyboard shortcuts: Space (Play/Pause), S (+1 Day)
  document.addEventListener("keydown", (e) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
    if (e.code === "Space") {
      e.preventDefault();
      if (currentSpeed > 0) stopAutoPlay();
      else startAutoPlay(1);
    } else if (e.key === "s" || e.key === "S") {
      stopAutoPlay();
      apiCall("/api/step", { ticks: 1 }, "Simuloidaan +1 päivä eteenpäin...");
    }
  });
})();
`;

export function createApexWarRoomServer(
  initialPreset: ScenarioPresetId = "vertical_farm",
  initialMode: AppViewMode = "genesis",
) {
  let session = createInitialSession(initialPreset, initialMode);

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");

      if (handleFlowRequest(req, res, url.pathname)) return;

      if (req.method === "GET" && url.pathname === "/classic") {
        const payload = buildViewPayload(session);
        const page = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>APEX — klassinen näkymä</title>
  <style>${WAR_ROOM_CSS}</style>
</head>
<body>
  <div id="war-room-root">${payload.html}</div>
  <script>${CLIENT_BOOTSTRAP_JS}</script>
</body>
</html>`;
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(page);
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/view") {
        const payload = buildViewPayload(session);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(payload));
        return;
      }

      if (req.method === "POST") {
        const chunks: Buffer[] = [];
        for await (const chunk of req) {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        }
        const rawBody = Buffer.concat(chunks).toString("utf-8");
        const body = rawBody ? JSON.parse(rawBody) : {};
        const branch = getActiveBranch(session);
        const state = branch.head;

        if (url.pathname === "/api/step") {
          const t0 = Date.now();
          if (body.macro) {
            const loopRes = runMicroTickLoop(state, 30, {
              strictInvariants: true,
              pauseOnMacroIntervals: true,
            });
            stepLivingWorldDynamics(state);
            session.lastMacroStepSummary = {
              ticksExecuted: loopRes.ticksExecuted,
              yielded: loopRes.yielded,
              triggers: loopRes.activeTriggers,
            };
            recordEngineActivity({
              actor: "engine",
              title: `Simuloitu +${loopRes.ticksExecuted} pv (Päivä ${state.calendar.tick})`,
              detail:
                loopRes.activeTriggers.length > 0
                  ? `Pysäytetty hälytykseen: ${loopRes.activeTriggers[0].message}`
                  : "Saavutettiin viikko-/kuukausikatsaus, tase täsmää.",
              durationMs: Date.now() - t0,
              ok: true,
            });
            if (loopRes.yielded && isLlmConfigured()) {
              const llmRes = await generateWarRoomBriefingWithLlm(state);
              session.liveBriefing = llmRes.briefing;
              session.lastLlmMeta = llmRes.meta;
            }
          } else {
            const ticks = Math.max(1, Math.min(180, Number(body.ticks ?? 1)));
            if (ticks === 1) {
              stepTick(state, { strictInvariants: true });
            } else {
              runTicks(state, ticks, { strictInvariants: true });
            }
            stepLivingWorldDynamics(state);
            recordEngineActivity({
              actor: "engine",
              title: `Simuloitu +${ticks} pv ➔ Päivä ${state.calendar.tick}`,
              detail: `8-vaiheinen päivälaskenta (hankinnat, varasto, valmistus, kysyntä, kassa) suoritettu.`,
              durationMs: Date.now() - t0,
              ok: true,
            });
          }
        } else if (url.pathname === "/api/research") {
          const query = typeof body.query === "string" ? body.query.trim() : undefined;
          const resResearch = await runMarketResearchAndCalibrateWithLlm(state, query);
          session.workspaceView = "market";
          session.lastActionFeedback = {
            ok: resResearch.ok,
            actionType: "AI_MARKET_RESEARCH_GROUNDING",
            issuedBy: resResearch.usedLiveLlm ? "agent:llm_economist" : "engine:market_db",
            tick: state.calendar.tick,
            summary: resResearch.summary,
            diagnostics: [],
          };
        } else if (url.pathname === "/api/play") {
          const playId = String(body.playId ?? "");
          const resPlay = executeStrategicPlay(state, playId);
          session.lastActionFeedback = {
            ok: resPlay.ok,
            actionType: `STRATEGIC_PLAY:${playId.toUpperCase()}`,
            issuedBy: "player:ceo",
            tick: state.calendar.tick,
            summary: resPlay.summary,
            diagnostics: resPlay.ok
              ? []
              : [{ code: "PLAY_ERROR", message: resPlay.summary }],
          };
          recordEngineActivity({
            actor: "player",
            title: `Peliliike [${playId}]`,
            detail: resPlay.summary,
            ok: resPlay.ok,
          });
        } else if (url.pathname === "/api/briefing") {
          const llmRes = await generateWarRoomBriefingWithLlm(state);
          session.liveBriefing = llmRes.briefing;
          session.lastLlmMeta = llmRes.meta;
        } else if (url.pathname === "/api/llm/config") {
          if (body.provider || body.apiKey !== undefined || body.model) {
            setActiveLlmConfig({
              provider: body.provider,
              apiKey: body.apiKey,
              model: body.model,
            });
            session.lastLlmMeta = null;
          }
        } else if (url.pathname === "/api/llm/test") {
          const cfg = body.config
            ? {
                provider: body.config.provider,
                apiKey: body.config.apiKey,
                model: body.config.model,
              }
            : undefined;
          const testRes = await testLlmConnection(cfg);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(testRes));
          return;
        } else if (url.pathname === "/api/genesis/spark") {
          const promptText =
            String(body.prompt ?? "").trim() ||
            "Perinteinen suomalainen nakkikioski ja iltagrilli torilla";
          const initialCapitalEuros =
            body.initialCapitalEuros !== undefined &&
            Number.isFinite(Number(body.initialCapitalEuros)) &&
            Number(body.initialCapitalEuros) > 0
              ? Number(body.initialCapitalEuros)
              : undefined;
          const commercialModelNotes =
            typeof body.commercialModelNotes === "string"
              ? body.commercialModelNotes.trim()
              : undefined;

          const compiled = await compileBusinessPrompt(promptText, {
            seed: Date.now() & 0x7fffffff,
            useLiveLlm: true,
            initialCapitalEuros,
            commercialModelNotes,
          });
          const root = createRootBranch(compiled, `main (${compiled.company.name})`);
          session.branches = [root];
          session.activeBranchId = root.id;
          session.draft.prompt = promptText;
          session.draft.initialCapitalEuros = compiled.company.initialCapitalEuros;
          session.draft.commercialModelNotes = compiled.company.commercialModelNotes;
          session.draft.archetype = compiled.company.archetype;
          const isSmallCap = (compiled.company.initialCapitalEuros ?? 25_000) <= 35_000;
          session.draft.founderRole = isSmallCap ? "solo_founder" : "commercial";
          session.mode = "canvas";
          session.liveBriefing = null;
        } else if (url.pathname === "/api/genesis/sensecheck-adjust") {
          const sKey = String(body.key ?? "");
          const sVal = Number(body.value);
          if (sKey === "initial_capital" && Number.isFinite(sVal) && sVal > 0) {
            applyInitialCapitalAndCommercialModel(
              state,
              sVal,
              state.company.commercialModelNotes,
            );
            session.draft.initialCapitalEuros = sVal;
            recordEngineActivity({
              actor: "player",
              title: `Sense Check: Alkupääoma nostettu ➔ ${sVal} €`,
              detail: `Aloituskassa ja puskuri päivitetty arvoon ${sVal} € ennen simulaation aloitusta.`,
              ok: true,
            });
          } else if (sKey && Number.isFinite(sVal)) {
            const resUpd = applyAssumptionUpdate(state, sKey as AssumptionKey, sVal);
            recordEngineActivity({
              actor: "player",
              title: `Sense Check -optimointi [${sKey}]`,
              detail: resUpd.summary,
              ok: resUpd.ok,
            });
          }
        } else if (url.pathname === "/api/genesis/config") {
          if (body.founderRole) {
            session.draft.founderRole = body.founderRole;
          }
          if (typeof body.customFounderRole === "string") {
            session.draft.customFounderRole = body.customFounderRole;
          }
          if (body.capability && body.mode) {
            const capKey = body.capability as keyof GenesisDraft["capabilities"];
            if (session.draft.capabilities[capKey] !== undefined) {
              session.draft.capabilities[capKey] = body.mode;
            }
          }
        } else if (url.pathname === "/api/genesis/launch") {
          session.mode = "war_room";
          session.workspaceView = "daily";
          const fRole = session.draft.founderRole;
          const customRoleName = session.draft.customFounderRole?.trim();
          if (state.org.roles.length > 0) {
            if (fRole === "solo_founder") {
              state.org.roles[0].title = "👑 Yrittäjä (Toimitusjohtaja + Myynti + Tiski)";
            } else if (fRole === "custom" && customRoleName) {
              state.org.roles[0].title = `✍️ ${customRoleName}`;
            }
          }
          stepTick(state, { strictInvariants: true });
          recordEngineActivity({
            actor: "engine",
            title: `Simulaatio käynnistetty: ${state.company.name}`,
            detail: `Päivä 1 avattu. Alkupääoma ${state.company.initialCapitalEuros ?? Math.round(debitBalance(state.finance.ledger, "cash") / 100)} €.`,
            ok: true,
          });
          if (isLlmConfigured()) {
            try {
              const llmRes = await Promise.race([
                generateWarRoomBriefingWithLlm(state),
                new Promise<{ briefing: WarRoomBriefing; meta: LlmCallMetadata }>((_, reject) =>
                  setTimeout(() => reject(new Error("LLM briefing timeout")), 3000),
                ),
              ]);
              session.liveBriefing = llmRes.briefing;
              session.lastLlmMeta = llmRes.meta;
            } catch {
              session.liveBriefing = generateWarRoomBriefing(state);
            }
          }
        } else if (url.pathname === "/api/genesis/sandbox") {
          const presetId = (body.presetId as ScenarioPresetId) ?? "vertical_farm";
          session = createInitialSession(presetId, "war_room");
        } else if (url.pathname === "/api/genesis/reset") {
          session.mode = "genesis";
          session.draft.prompt = "";
          session.draft.commercialModelNotes = "";
          session.draft.initialCapitalEuros = 10_000;
          session.liveBriefing = null;
          session.lastActionFeedback = null;
          session.workspaceView = "daily";
        } else if (url.pathname === "/api/preset") {
          const presetId = (body.presetId as ScenarioPresetId) ?? "vertical_farm";
          session = createInitialSession(presetId, "war_room");
        } else if (url.pathname === "/api/compile") {
          const archetype = body.archetype
            ? (String(body.archetype) as IndustryArchetype)
            : undefined;
          const compiled = await compileBusinessPrompt(String(body.prompt ?? ""), {
            seed: Date.now() & 0x7fffffff,
            archetype,
            useLiveLlm: true,
          });
          stepTick(compiled, { strictInvariants: true });
          const llmRes = await generateWarRoomBriefingWithLlm(compiled);
          const root = createRootBranch(compiled, `main (${compiled.company.name})`);
          session = {
            mode: "war_room",
            draft: {
              prompt: String(body.prompt ?? ""),
              initialCapitalEuros: compiled.company.initialCapitalEuros,
              commercialModelNotes: compiled.company.commercialModelNotes,
              archetype: compiled.company.archetype,
              founderRole: "solo_founder",
              capabilities: {
                production: "in_house",
                warehouse: "in_house",
                logistics: "outsource",
                qa: "in_house",
              },
            },
            branches: [root],
            activeBranchId: root.id,
            activeTab: "financials",
            workspaceView: "daily",
            clarityMode: session.clarityMode ?? "simple",
            selectedNode: {
              kind: "workCenter",
              id: compiled.operations.workCenters[0]?.id ?? "",
            },
            selectedAssumption: "selling_price",
            drawerExpanded: false,
            mcSummary: null,
            lastNegotiation: null,
            exportedMarkdown: null,
            lastActionFeedback: null,
            lastMacroStepSummary: null,
            liveBriefing: llmRes.briefing,
            lastLlmMeta: llmRes.meta,
          };
        } else if (url.pathname === "/api/assumption") {
          if (body.selectKey) {
            session.selectedAssumption = String(body.selectKey) as AssumptionKey;
            if (session.workspaceView !== "all") {
              session.workspaceView = "assumptions";
            }
          }
          if (body.key && body.value !== undefined) {
            const aKey = String(body.key) as AssumptionKey;
            session.selectedAssumption = aKey;
            const resUpdate = applyAssumptionUpdate(state, aKey, Number(body.value));
            session.lastActionFeedback = {
              ok: resUpdate.ok,
              actionType: `ASSUMPTION_UPDATE:${aKey.toUpperCase()}`,
              issuedBy: "player:founder",
              tick: state.calendar.tick,
              summary: resUpdate.summary,
              diagnostics: resUpdate.ok
                ? []
                : [{ code: "INVALID_ASSUMPTION", message: resUpdate.summary }],
            };
            recordEngineActivity({
              actor: "player",
              title: `Oletusarvo päivitetty [${aKey}]`,
              detail: resUpdate.summary,
              ok: resUpdate.ok,
            });
          }
        } else if (url.pathname === "/api/ui") {
          if (body.workspaceView) {
            session.workspaceView = body.workspaceView as WorkspaceViewMode;
          }
          if (body.activeTab) {
            session.activeTab = body.activeTab as WarRoomTab;
            session.drawerExpanded = true;
            if (session.workspaceView !== "all") {
              session.workspaceView = "erp";
            }
          }
          if (body.selectedNode) session.selectedNode = body.selectedNode as SelectedNode;
          if (body.clarityMode) {
            session.clarityMode = body.clarityMode as "simple" | "expert";
            if (body.clarityMode === "expert") {
              session.workspaceView = "all";
            }
          }
          if (body.kpiDrilldown) {
            session.drawerExpanded = true;
            if (session.workspaceView !== "all") {
              session.workspaceView = "erp";
            }
            const kpi = String(body.kpiDrilldown);
            if (kpi === "cash" || kpi === "margin") {
              session.activeTab = "financials";
              session.selectedAssumption = "selling_price";
              session.selectedNode = {
                kind: "channel",
                id: state.commercial.channels[0]?.id ?? "",
              };
            } else if (kpi === "ccc") {
              session.activeTab = "financials";
              session.selectedAssumption = "raw_cost_1";
              session.selectedNode = {
                kind: "supplier",
                id: state.supply.suppliers[0]?.id ?? "",
              };
            } else if (kpi === "fill") {
              session.activeTab = "operations";
              session.selectedAssumption = "daily_demand";
              session.selectedNode = {
                kind: "segment",
                id: state.market.segments[0]?.id ?? "",
              };
            } else if (kpi === "queue") {
              session.activeTab = "operations";
              session.selectedAssumption = "service_capacity";
              session.selectedNode = {
                kind: "workCenter",
                id: state.operations.workCenters[0]?.id ?? "",
              };
            } else if (kpi === "team") {
              session.activeTab = "org";
              session.selectedAssumption = "founder_salary";
              session.selectedNode = {
                kind: "workCenter",
                id: state.operations.workCenters[0]?.id ?? "",
              };
            }
          }
        } else if (url.pathname === "/api/scale") {
          const evo = evolveVentureToNextStage(state);
          if (evo.ok) {
            stepTick(state, { strictInvariants: true });
            session.lastActionFeedback = {
              ok: true,
              actionType: "VENTURE_SCALE",
              issuedBy: "player:ceo",
              tick: state.calendar.tick,
              summary: evo.summary,
              diagnostics: [],
            };
            recordEngineActivity({
              actor: "player",
              title: `Yritys skaalattu (Vaihe ${state.company.ventureStage})`,
              detail: evo.summary,
              ok: true,
            });
          } else {
            session.lastActionFeedback = {
              ok: false,
              actionType: "VENTURE_SCALE",
              issuedBy: "player:ceo",
              tick: state.calendar.tick,
              summary: evo.summary,
              diagnostics: [{ code: "MAX_STAGE_REACHED", message: evo.summary }],
            };
          }
        } else if (url.pathname === "/api/action") {
          if (body.action) {
            executeTwoPhaseActionOnSession(
              session,
              state,
              body.action as ActionPayload,
              "player:ceo",
            );
          } else if (body.priceShift) {
            const { offeringId, multiplier } = body.priceShift as {
              offeringId: string;
              multiplier: number;
            };
            const off = state.commercial.offerings.find((o) => o.id === offeringId);
            const ost = state.commercial.offeringStates.find((s) => s.offeringId === offeringId);
            if (off && ost) {
              const newPrice = Math.max(100, Math.round(ost.lastPrice * multiplier));
              executeTwoPhaseActionOnSession(
                session,
                state,
                {
                  type: "SET_PRICING",
                  offeringId: off.id,
                  pricing: { kind: "value_based", listPrice: newPrice },
                  discountPct: off.discountPct,
                },
                "player:ceo",
              );
            }
          } else if (typeof body.agentProposalIndex === "number") {
            const briefing = generateWarRoomBriefing(state);
            const prop = briefing.proposals[body.agentProposalIndex];
            if (prop) {
              for (const act of prop.actions) {
                executeTwoPhaseActionOnSession(
                  session,
                  state,
                  act,
                  `agent:${prop.agentRole}`,
                );
              }
            }
          }
          if (body.stepAfter) {
            stepTick(state, { strictInvariants: true });
          }
        } else if (url.pathname === "/api/negotiate") {
          const kind = body.counterpartyKind === "investor" ? "investor" : "supplier";
          const id = String(body.counterpartyId ?? "");
          const neg = negotiateWithCounterparty(state, {
            counterpartyKind: kind,
            counterpartyId: id,
            requestedValue: kind === "supplier" ? 45 : 200_000_00,
            offeredCommitment: kind === "supplier" ? 800 : 1_800_000_00,
          });
          session.lastNegotiation = neg;
          if (neg.accepted) {
            for (const act of neg.actions) {
              executeTwoPhaseActionOnSession(
                session,
                state,
                act,
                "player:negotiation",
              );
            }
          }
        } else if (url.pathname === "/api/branch") {
          if (body.op === "fork") {
            const forked = forkTimelineBranch(branch, {
              name: String(body.name ?? `Fork-D${state.calendar.tick}`),
            });
            session.branches.push(forked);
            session.activeBranchId = forked.id;
            session.activeTab = "branches";
            session.workspaceView = "erp";
          } else if (body.op === "checkout" && body.branchId) {
            session.activeBranchId = String(body.branchId);
          }
        } else if (url.pathname === "/api/montecarlo") {
          session.mcSummary = runMonteCarloSimulation(state, {
            runs: Number(body.runs ?? 12),
            horizonDays: Number(body.horizonDays ?? 60),
          });
          session.activeTab = "branches";
          session.workspaceView = "erp";
        } else if (url.pathname === "/api/export") {
          session.exportedMarkdown = exportExecutiveBusinessCaseMarkdown(state);
          session.activeTab = "branches";
          session.workspaceView = "erp";
        }

        const payload = buildViewPayload(session);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(payload));
        return;
      }

      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not Found");
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    }
  });

  return server;
}

// Start server when invoked directly via `npm run dev`
if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.PORT ?? 3000);
  const srv = createApexWarRoomServer("vertical_farm", "genesis");
  srv.listen(port, "127.0.0.1", () => {
    console.log(`\n▲ APEX Studio: http://127.0.0.1:${port}  (klassinen näkymä: /classic)\n`);
  });
}
