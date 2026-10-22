/**
 * Master War Room Shell Renderer (`/src/app/war-room-view.ts`).
 * Combines the Top Command Bar, Zero-to-Ontology Archetype-Bounded Business Compiler Bar,
 * Tiered Tick-Clock & Two-Phase Commit Status Strip, 6-Card Executive KPI Ribbon,
 * Interactive Value Chain Node Canvas, Tabbed Telemetry Drawers, C-Suite Multi-Agent War Room Panel,
 * and Director AI Crisis Modal.
 */
import type { NegotiationOutcome, WarRoomBriefing } from "../core/agents";
import {
  ARCHETYPE_BASELINES,
  type AssumptionKey,
  buildAssumptionDependencyGraph,
  computeGameTheoryAnalysis,
  getEvolutionStagesForState,
  markTag,
  SCENARIO_PRESETS,
} from "../core/compiler";
import { buildBalanceSheet, buildIncomeStatement } from "../core/engine/ledger";
import { totalHeadcount } from "../core/engine/org";
import type { MonteCarloSummary } from "../core/engine/tick";
import type {
  LlmCallMetadata,
  MaskedLlmConfig,
} from "../core/llm";
import {
  buildDefaultMarketIntelligence,
  getLlmSessionTelemetry,
  getMaskedLlmConfig,
  PROVIDER_PRESETS,
} from "../core/llm";
import {
  type ActionDiagnostic,
  IndustryArchetype,
  type TimelineBranch,
  type TriggerAlert,
  type WorldState,
} from "../core/schema";
import {
  escapeHtml,
  fmtCurrency,
  fmtCurrencyPrecise,
  fmtNum,
  fmtPct,
  renderCrisisModal,
  renderFinancialTelemetryDrawer,
  renderLlmConfigModal,
  renderNodeInspector,
  renderOrgAndCapabilityDrawer,
  renderTimelineAndMonteCarloDrawer,
  renderValueChainSvg,
  renderWarehouseAndOpsDrawer,
  renderWarRoomDebatePanel,
  type ClarityMode,
  type SelectedNode,
} from "../components";

export type WarRoomTab = "financials" | "operations" | "org" | "branches";
export type WorkspaceViewMode = "daily" | "assumptions" | "market" | "growth" | "erp" | "all";

export interface TwoPhaseActionFeedback {
  ok: boolean;
  actionType: string;
  issuedBy: string;
  tick: number;
  summary: string;
  diagnostics: ActionDiagnostic[];
}

export interface WarRoomViewState {
  state: WorldState;
  branches: TimelineBranch[];
  activeBranchId: string;
  briefing: WarRoomBriefing;
  activeTab: WarRoomTab;
  workspaceView?: WorkspaceViewMode;
  clarityMode?: ClarityMode;
  selectedNode?: SelectedNode | null;
  selectedAssumption?: AssumptionKey | null;
  drawerExpanded?: boolean;
  mcSummary?: MonteCarloSummary | null;
  lastNegotiation?: NegotiationOutcome | null;
  exportedMarkdown?: string | null;
  lastActionFeedback?: TwoPhaseActionFeedback | null;
  lastMacroStepSummary?: {
    ticksExecuted: number;
    yielded: boolean;
    triggers: TriggerAlert[];
  } | null;
  llmMeta?: LlmCallMetadata | null;
  llmConfig?: MaskedLlmConfig | null;
  geminiConfigured?: boolean;
}

function renderAssumptionDependencyExplorer(
  state: WorldState,
  selectedKey?: AssumptionKey | null,
): string {
  const graph = buildAssumptionDependencyGraph(state);
  const allKeys: AssumptionKey[] = [
    "selling_price",
    "raw_cost_1",
    "raw_cost_2",
    "facility_rent",
    "daily_demand",
    "customer_wtp",
    "marketing_budget",
    "service_capacity",
    "founder_salary",
    "competitor_price",
  ];
  const activeKey: AssumptionKey =
    selectedKey && graph[selectedKey] ? selectedKey : "selling_price";
  const activeNode = graph[activeKey];

  const assumedCount = allKeys.filter((k) => graph[k].isAssumed).length;
  const customizedCount = allKeys.length - assumedCount;

  const pillBar = allKeys
    .map((k) => {
      const node = graph[k];
      const isSelected = k === activeKey;
      const shortName =
        k === "selling_price"
          ? "Myyntihinta"
          : k === "raw_cost_1"
            ? "1. Raaka-aine"
            : k === "raw_cost_2"
              ? "2. Tarvike"
              : k === "facility_rent"
                ? "Tilavuokra"
                : k === "daily_demand"
                  ? "Asiakasvirta"
                  : k === "customer_wtp"
                    ? "Maksuhalukkuus"
                    : k === "marketing_budget"
                      ? "Markkinointi"
                      : k === "service_capacity"
                        ? "Aukiolo/pv"
                        : k === "founder_salary"
                          ? "Palkka/kk"
                          : "Kilpailijat";
      return `
        <button
          type="button"
          class="assumption-pill ${isSelected ? "assumption-pill-active" : ""} ${node.isAssumed ? "assumption-pill-assumed" : "assumption-pill-verified"}"
          data-assumption-key="${k}"
          title="${escapeHtml(node.label)} — Klikkaa tutkiaksesi sidonnaisuuksia ja muokataksesi lukua"
        >
          <span>${escapeHtml(shortName)}:</span>
          <strong>${escapeHtml(node.displayValue)}</strong>
        </button>
      `;
    })
    .join("");

  const upstreamHtml =
    activeNode.upstreamDependencies.length > 0
      ? activeNode.upstreamDependencies
          .map(
            (dep) => `
          <div class="fm-dep-item" data-assumption-key="${dep.key}" style="cursor:pointer" title="Klikkaa siirtyäksesi tähän tietoon">
            <div style="display:flex;justify-content:space-between;align-items:center;gap:6px">
              <strong style="color:#f8fafc;font-size:12px">⬅️ ${escapeHtml(dep.label)}</strong>
              <span class="assumption-pill assumption-pill-inline" data-assumption-key="${dep.key}">${escapeHtml(dep.currentDisplay)}</span>
            </div>
            <span class="sub" style="display:block;font-size:11px;color:#94a3b8;margin-top:2px">${escapeHtml(dep.relation)}</span>
          </div>
        `,
          )
          .join("")
      : `<div class="sub">Ei suoria ylävirran syötteitä — tämä on perustason lähtöoletus.</div>`;

  const downstreamHtml = activeNode.downstreamImpacts
    .map(
      (imp) => `
      <div class="fm-dep-item" ${imp.key ? `data-assumption-key="${imp.key}" style="cursor:pointer" title="Klikkaa tutkiaksesi tätä sidonnaisuutta"` : ""}>
        <div style="display:flex;justify-content:space-between;align-items:center;gap:6px">
          <strong style="color:#f8fafc;font-size:12px">➡️ ${escapeHtml(imp.label)}</strong>
          <span class="mono" style="font-size:11.5px;color:#10b981;font-weight:700">${escapeHtml(imp.currentDisplay)}</span>
        </div>
        <span class="sub" style="display:block;font-size:11px;color:#94a3b8;margin-top:2px">${escapeHtml(imp.impactDescription)}</span>
      </div>
    `,
    )
    .join("");

  return `
    <div id="assumption-inspector-panel" class="panel-card fm-dependency-panel" style="margin-bottom:12px">
      <div class="card-header" style="margin-bottom:8px">
        <div>
          <span class="tag tag-amber">★ TIEDON ALKUPERÄ, SIDONNAISUUDET &amp; MUOKKAUS (FOOTBALL MANAGER DRILL-DOWN)</span>
          <h3 style="margin-top:2px">
            Jokainen keksitty oletus on merkitty tähdellä <b style="color:#fbbf24">*</b> (${assumedCount} oletusta*, ${customizedCount} vahvistettu ✓) — klikkaa mitä tahansa lukua tutkiaksesi sen ketjua ja muokataksesi sitä
          </h3>
        </div>
      </div>

      <!-- ALL 10 ASSUMPTIONS QUICK PILL BAR -->
      <div class="assumption-pill-bar">
        ${pillBar}
      </div>

      <!-- ACTIVE ASSUMPTION INSPECTOR & INLINE EDITOR -->
      <div class="fm-inspector-body">
        <div class="fm-inspector-col fm-inspector-edit-col">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:4px">
            <span class="tag ${activeNode.isAssumed ? "tag-amber" : "tag-green"}">
              ${activeNode.isAssumed ? "★ KEKSITTY / MALLINNETTU OLETUS (*)" : "✓ KÄYTTÄJÄN VAHVISTAMA TIETO"}
            </span>
            <span class="mono" style="font-size:11px;color:#94a3b8">Yksikkö: ${escapeHtml(activeNode.unit)}</span>
          </div>
          <h4 style="font-size:14px;color:#f8fafc;margin:2px 0 4px 0">${escapeHtml(activeNode.label)}</h4>
          <p class="sub" style="font-size:11.5px;color:#cbd5e1;line-height:1.4;margin-bottom:6px">
            ${escapeHtml(activeNode.originExplanation)}
          </p>
          <div style="padding:6px 8px;background:#090e1a;border:1px solid #1e293b;border-radius:6px;font-size:11.5px;color:#38bdf8;margin-bottom:8px" class="mono">
            📐 ${escapeHtml(activeNode.formulaSummary)}
          </div>

          <form id="assumption-edit-form" style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
            <input type="hidden" id="assumption-key-input" value="${activeNode.key}" />
            <label for="assumption-value-input" style="font-size:11.5px;font-weight:700;color:#e2e8f0">Uusi arvo (${escapeHtml(activeNode.unit)}):</label>
            <input
              type="number"
              id="assumption-value-input"
              class="compiler-input mono"
              style="width:110px;padding:4px 8px;font-size:13px;font-weight:700"
              step="${activeNode.step}"
              min="${activeNode.min}"
              max="${activeNode.max}"
              value="${activeNode.currentValue}"
            />
            <button type="submit" class="btn btn-sm btn-primary">
              💾 Päivitä tieto &amp; Laske ketju
            </button>
            <button type="button" class="btn btn-xs btn-secondary" data-assumption-nudge="${activeNode.key}:${Number((activeNode.currentValue * 0.9).toFixed(2))}">
              -10%
            </button>
            <button type="button" class="btn btn-xs btn-secondary" data-assumption-nudge="${activeNode.key}:${Number((activeNode.currentValue * 1.1).toFixed(2))}">
              +10%
            </button>
          </form>
        </div>

        <!-- UPSTREAM DEPENDENCIES -->
        <div class="fm-inspector-col">
          <div class="fm-col-title">⬅️ YLÄVIRRAN SIDONNAISUUDET (Mistä tämä luku riippuu)</div>
          <div class="fm-dep-list">
            ${upstreamHtml}
          </div>
        </div>

          <!-- DOWNSTREAM IMPACTS -->
        <div class="fm-inspector-col">
          <div class="fm-col-title">➡️ ALAVIRRAN VAIKUTUKSET (Mihin kaikkeen tämä vaikuttaa)</div>
          <div class="fm-dep-list">
            ${downstreamHtml}
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderMarketIntelligenceAndPlaysPanel(
  state: WorldState,
  clarityMode: ClarityMode,
): string {
  const report =
    state.company.marketIntelligence ?? buildDefaultMarketIntelligence(state);
  const graph = buildAssumptionDependencyGraph(state);

  const playsHtml = report.strategicPlays
    .map((play) => {
      const catLabel =
        play.category === "growth"
          ? "🚀 KASVU & MARKKINA"
          : play.category === "supply_chain"
            ? "📦 HANKINTAKETJU & KULUT"
            : play.category === "pricing"
              ? "💎 HINNOITTELU & KATE"
              : play.category === "capacity"
                ? "⚡ KAPASITEETTI"
                : "🏢 YRITYSJÄRJESTELY (M&A)";
      const catColor =
        play.category === "growth"
          ? "tag-green"
          : play.category === "supply_chain"
            ? "tag-cyan"
            : play.category === "pricing"
              ? "tag-amber"
              : "tag-blue";

      const patchPills = play.assumptionPatches
        .map((p) => {
          const node = graph[p.key as AssumptionKey];
          const label = node ? node.label.split("(")[0].trim() : p.key;
          const unit = node ? node.unit : "";
          return `<button type="button" class="assumption-pill assumption-pill-inline" data-assumption-key="${escapeHtml(p.key)}" title="${escapeHtml(p.reason)}">🎯 ${escapeHtml(label)} ➔ ${p.targetValue} ${escapeHtml(unit)}</button>`;
        })
        .join(" ");

      return `
        <div style="padding:10px 12px;background:#090e1a;border:1px solid ${play.executed ? "#10b981" : "#1e3a8a"};border-radius:8px;display:flex;flex-direction:column;justify-content:space-between;gap:8px">
          <div>
            <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;margin-bottom:4px">
              <span class="tag ${catColor}" style="font-size:10px">${catLabel}</span>
              <span class="mono" style="font-size:11px;color:${play.executed ? "#10b981" : "#38bdf8"}">
                ${play.executed ? "✓ TOTEUTETTU" : `Investointi: ${fmtNum(play.costEuros)} €`}
              </span>
            </div>
            <strong style="font-size:12.5px;color:#f8fafc;display:block;margin-bottom:4px">${escapeHtml(play.title)}</strong>
            <p class="sub" style="font-size:11.5px;color:#cbd5e1;line-height:1.4;margin:0 0 6px 0">${escapeHtml(play.description)}</p>
            <div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:6px">
              ${patchPills}
            </div>
            <div style="font-size:11px;color:#94a3b8;background:rgba(15,23,42,0.7);padding:5px 7px;border-radius:5px;border-left:2px solid #f59e0b">
              ⚔️ <b>Peliteoreettinen vastareaktio:</b> ${escapeHtml(play.competitorReaction)}
            </div>
          </div>
          <div style="display:flex;justify-content:space-between;align-items:center;padding-top:4px;border-top:1px solid #1e293b">
            <span class="sub" style="font-size:10.5px;color:#94a3b8">${escapeHtml(play.expectedImpactSummary)}</span>
            ${
              play.executed
                ? `<span class="tag tag-green">✓ Voimassa</span>`
                : `<button type="button" class="btn btn-xs btn-primary" data-execute-play="${escapeHtml(play.id)}">
                    ⚡ Toteuta peliliike (-${fmtNum(play.costEuros)} €)
                  </button>`
            }
          </div>
        </div>
      `;
    })
    .join("");

  const benchmarksHtml = report.benchmarks
    .map((b) => {
      const k = b.assumptionKey as AssumptionKey;
      const node = graph[k];
      const curVal = node ? node.displayValue : "—";
      return `
        <tr>
          <td>
            <strong style="color:#f8fafc;cursor:pointer" data-assumption-key="${escapeHtml(b.assumptionKey)}">${escapeHtml(b.label)}</strong>
            <span class="sub" style="display:block;font-size:10.5px">${escapeHtml(b.rationale)}</span>
          </td>
          <td class="mono">${b.marketLow} ${escapeHtml(b.unit)}</td>
          <td class="mono" style="color:#38bdf8;font-weight:600">${b.marketTypical} ${escapeHtml(b.unit)}</td>
          <td class="mono">${b.marketHigh} ${escapeHtml(b.unit)}</td>
          <td>
            <button type="button" class="assumption-pill assumption-pill-inline" data-assumption-key="${escapeHtml(b.assumptionKey)}">
              ${escapeHtml(curVal)}
            </button>
          </td>
        </tr>
      `;
    })
    .join("");

  const sourcesHtml =
    report.webSources.length > 0
      ? `<div style="margin-top:8px;padding-top:8px;border-top:1px solid #1e293b;font-size:11px;color:#94a3b8">
          <strong style="color:#cbd5e1">🌐 Web-Grounding &amp; Markkinalähteet:</strong>
          <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:4px">
            ${report.webSources
              .map(
                (w) =>
                  `<a href="${escapeHtml(w.url)}" target="_blank" rel="noopener noreferrer" style="color:#38bdf8;text-decoration:none;background:#090e1a;padding:3px 8px;border-radius:4px;border:1px solid #1e293b" title="${escapeHtml(w.snippet)}">🔗 ${escapeHtml(w.title)}</a>`,
              )
              .join("")}
          </div>
        </div>`
      : "";

  return `
    <div class="panel-card" style="margin-bottom:12px;border:1px solid #1e3a8a;background:linear-gradient(180deg,#0b1324 0%,#080d1a 100%)">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:10px">
        <div>
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
            <span class="tag ${report.usedLiveLlm ? "tag-green" : "tag-cyan"}">🌍 AAA AI-MARKKINATUTKIMUS, WEB-GROUNDING &amp; PELILIIKKEET</span>
            <span class="tag tag-slate mono" style="font-size:10.5px">Lähde: ${escapeHtml(report.providerLabel)} • Päivä ${report.lastUpdatedTick}</span>
          </div>
          <h3 style="margin:4px 0 2px 0;font-size:14px;color:#f8fafc">Elävä markkinadata, kilpailijoiden peliteoria &amp; strategiset peliliikkeet</h3>
          <p class="sub" style="margin:0;font-size:11.5px;color:#94a3b8">${escapeHtml(report.executiveSummary)}</p>
        </div>

        <form id="market-research-form" style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
          <input
            type="text"
            id="market-research-query"
            class="compiler-input"
            style="min-width:250px;font-size:12px;padding:5px 9px"
            placeholder="Mitä tutkitaan? (esim. 'Jäätelökioski Helsingin kauppatori hinnat')"
            value="${escapeHtml(report.researchQuery)}"
          />
          <button type="submit" id="btn-run-market-research" class="btn btn-xs btn-primary" style="padding:6px 11px;font-weight:700">
            🌍 Tee Live-Markkinatutkimus &amp; Kalibroi *-Muuttujat (LLM + Web)
          </button>
        </form>
      </div>

      <!-- 3 EXECUTABLE STRATEGIC PLAYS -->
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:8px">
        ${playsHtml}
      </div>

      <!-- PROGRESSIVE DRAWER FOR BENCHMARKS & WEB SOURCES -->
      <details class="fm-progressive-drawer" ${report.usedLiveLlm || report.usedWebSearch || clarityMode === "expert" ? "open" : ""}>
        <summary class="fm-progressive-summary" style="padding:6px 10px">
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
            <span class="tag tag-blue" style="font-size:10px">📊 MARKKINAVERTAILU &amp; LÄHTEET</span>
            <strong style="font-size:12px;color:#e2e8f0">Katso toimialan hintahaarukat (Benchmarkit), markkinapotentiaali ja Web-lähteet ▾</strong>
          </div>
          <span class="sub" style="font-size:11px">${escapeHtml(report.marketSizingNote)}</span>
        </summary>
        <div style="padding:10px;background:#070b14;border-top:1px solid #1e293b">
          <table class="data-table" style="font-size:11.5px">
            <thead>
              <tr>
                <th>Muuttuja &amp; Selitys (Klikkaa avataksesi sidonnaisuudet)</th>
                <th>Markkinan alaraja</th>
                <th>Markkinan keskitaso</th>
                <th>Markkinan huipputaso</th>
                <th>Sinun arvosi nyt (* / ✓)</th>
              </tr>
            </thead>
            <tbody>
              ${benchmarksHtml}
            </tbody>
          </table>
          ${sourcesHtml}
        </div>
      </details>
    </div>
  `;
}

function renderTeamAndRolesQuickBar(state: WorldState, clarityMode: ClarityMode): string {
  const hc = totalHeadcount(state);
  const isSolo = hc <= 1;
  const fSalaryMark = markTag(state, "founder_salary");

  const roleCards = state.org.roles
    .slice(0, 4)
    .map((role, idx) => {
      const pos = state.org.positions.find((p) => p.roleId === role.id);
      const count = pos?.headcount ?? 0;
      const monthlyWage = role.baseWagePerDay * 30;
      const areaLabel =
        idx === 0
          ? "👑 Johto & Kokonaisvastuu"
          : idx === 1
            ? "⚙️ Tuotanto, Tiski & Ostot"
            : idx === 2
              ? "📣 Myynti & Asiakashankinta"
              : "💶 Talous & Kirjanpito";
      const statusBadge =
        count > 0
          ? `<span class="tag tag-green" style="font-size:9.5px">✓ ${count} hlö palkattu</span>`
          : `<span class="tag tag-amber" style="font-size:9.5px">👑 Hoidat itse (0 palkattua)</span>`;

      return `
        <div style="padding:7px 9px;background:#090e1a;border:1px solid ${count > 0 ? "#1e3a8a" : "#334155"};border-radius:7px;display:flex;flex-direction:column;justify-content:space-between;gap:5px">
          <div>
            <div style="display:flex;justify-content:space-between;align-items:center;gap:4px">
              <span style="font-size:10px;font-weight:700;color:#38bdf8">${areaLabel}</span>
              ${statusBadge}
            </div>
            <strong style="font-size:12px;color:#f8fafc;display:block;margin-top:2px">${escapeHtml(role.title)}</strong>
            <span class="sub" style="font-size:10.5px;color:#94a3b8">
              Palkka: ${idx === 0 ? `<button type="button" class="assumption-pill assumption-pill-inline" data-assumption-key="founder_salary">${fmtCurrency(monthlyWage)}/kk${fSalaryMark}</button>` : `${fmtCurrency(monthlyWage)}/kk (${fmtCurrency(role.baseWagePerDay)}/pv)`}
            </span>
          </div>
          <div style="display:flex;gap:4px;justify-content:flex-end;margin-top:2px">
            <button
              type="button"
              class="btn btn-xs btn-primary"
              data-action='{"type":"HIRE_TERMINATE","roleId":"${escapeHtml(role.id)}","delta":1}'
              title="Palkkaa +1 henkilö tähän vastuualueeseen (avaa samalla roolin oman näkökulman ja kasvattaa kapasiteettia)"
            >
              + Palkkaa (${fmtCurrency(role.hiringFee, true)})
            </button>
            ${
              count > 0 && !(idx === 0 && hc <= 1)
                ? `<button
                    type="button"
                    class="btn btn-xs btn-secondary"
                    data-action='{"type":"HIRE_TERMINATE","roleId":"${escapeHtml(role.id)}","delta":-1}'
                    title="Vähennä 1 henkilö tästä roolista"
                  >
                    −1
                  </button>`
                : ""
            }
          </div>
        </div>
      `;
    })
    .join("");

  return `
    <details class="fm-progressive-drawer" style="margin-bottom:10px" ${isSolo ? "" : "open"}>
      <summary class="fm-progressive-summary" style="padding:7px 12px">
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
          <span class="tag ${isSolo ? "tag-amber" : "tag-cyan"}">👥 TIIMI, ROOLIT &amp; VASTUUALUEIDEN AVAAMINEN (${hc} ${hc === 1 ? "HENKILÖ — YKSINYRITTÄJÄ" : "HENKILÖÄ TIIMISSÄ"})</span>
          <strong style="font-size:12.5px;color:#f8fafc">
            ${
              isSolo
                ? "Pyörität yritystä nyt yksin — klikkaa tästä palkataksesi apukäsiä tiskille, myyntiin tai talouteen ▾"
                : `Tiimissäsi on ${hc} hlöä — vastuualueet skaalautuvat palkattujen roolien mukaan ▾`
            }
          </strong>
        </div>
        <button type="button" class="btn btn-xs btn-secondary" data-tab="org">
          ${clarityMode === "simple" ? "Tiimin yksityiskohdat →" : "Full Org & RACI →"}
        </button>
      </summary>
      <div style="padding:10px;background:#070c18;border:1px solid #1e293b;border-top:none;border-radius:0 0 8px 8px">
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px">
          ${roleCards}
        </div>
      </div>
    </details>
  `;
}

function renderEvolutionStagesPanel(
  state: WorldState,
  clarityMode: ClarityMode,
): string {
  const stages = getEvolutionStagesForState(state);
  const currentStage = state.company.ventureStage ?? 1;
  const activeStageSpec = stages.find((s) => s.stage === currentStage) ?? stages[0];
  const nextStageSpec = stages.find((s) => s.stage === currentStage + 1);

  return `
    <details class="fm-progressive-drawer" style="margin-bottom:12px" open>
      <summary class="fm-progressive-summary">
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
          <span class="tag tag-cyan">🚀 YRITYKSEN KASVUPOLKU &amp; SKAALAUTUMINEN (VAIHE ${currentStage} / 4)</span>
          <strong style="font-size:13px;color:#f8fafc">${escapeHtml(activeStageSpec?.title ?? state.company.name)}</strong>
          <span class="sub" style="font-size:12px">— Nakkikiskasta / Kioskista monikansalliseksi pörssiyhtiöksi (${clarityMode === "simple" ? "Yrittäjäpolku" : "M&A Evolution"}) ▾</span>
        </div>
        <div>
          ${
            nextStageSpec
              ? `<button type="button" class="btn btn-xs btn-primary" data-scale-venture="true" title="${escapeHtml(nextStageSpec.subtitle)}">
                  🚀 Skaalaa: ${escapeHtml(nextStageSpec.title)} (Investointi ${fmtCurrency(nextStageSpec.unlockCostEuros * 100, true)})
                </button>`
              : `<span class="tag tag-green">🏆 VAIHE 4 SAAVUTETTU: MONIKANSALLINEN MARKKINAJOHTAJA</span>`
          }
        </div>
      </summary>
      <div class="panel-card" style="margin-top:6px;border:1px solid #1e3a8a;background:linear-gradient(135deg,#0f172a 0%,#0b1528 100%)">
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px">
          ${stages
            .map((st) => {
              const isCurrent = st.stage === currentStage;
              const isUnlocked = st.stage <= currentStage;
              return `
                <div style="padding:8px 10px;border-radius:8px;border:1px solid ${
                  isCurrent ? "#38bdf8" : isUnlocked ? "#10b981" : "#1e293b"
                };background:${isCurrent ? "rgba(56,189,248,0.10)" : isUnlocked ? "rgba(16,185,129,0.06)" : "#090e1a"}">
                  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:3px">
                    <span class="tag ${isCurrent ? "tag-cyan" : isUnlocked ? "tag-green" : "tag-slate"}" style="font-size:9.5px">
                      ${isCurrent ? "NYKYINEN VAIHE" : isUnlocked ? "✓ AVATTU" : `VAIHE ${st.stage}`}
                    </span>
                    <span class="mono" style="font-size:10.5px;color:#94a3b8">${
                      st.unlockCostEuros > 0 ? `${fmtNum(st.unlockCostEuros)} €` : "Aloitustaso"
                    }</span>
                  </div>
                  <strong style="display:block;font-size:12px;color:${isUnlocked ? "#f8fafc" : "#94a3b8"}">${escapeHtml(st.title)}</strong>
                  <span class="sub" style="display:block;font-size:11px;line-height:1.35;margin-top:2px">${escapeHtml(st.subtitle)}</span>
                </div>
              `;
            })
            .join("")}
        </div>
      </div>
    </details>
  `;
}

function renderContextualBusinessCommandGrid(
  state: WorldState,
  clarityMode: ClarityMode,
  selectedAssumption?: AssumptionKey | null,
): string {
  const wh0 = state.warehouses.sites[0];
  const lane0 = state.supply.lanes[0];
  const off0 = state.commercial.offerings[0];
  const ost0 = off0
    ? state.commercial.offeringStates.find((s) => s.offeringId === off0.id)
    : undefined;
  const seg0 = state.market.segments[0];
  const pres0 = seg0
    ? state.market.presence.find((p) => p.segmentId === seg0.id)
    : undefined;
  const mkt0 = state.commercial.marketing[0];
  const gt = computeGameTheoryAnalysis(state);
  const stages = getEvolutionStagesForState(state);
  const currentStage = state.company.ventureStage ?? 1;
  const activeStageSpec = stages.find((s) => s.stage === currentStage) ?? stages[0];
  const nextStageSpec = stages.find((s) => s.stage === currentStage + 1);

  const curPrice = ost0?.lastPrice ?? 100_00;
  const mainItem = off0 ? state.catalog.items.find((i) => i.id === off0.itemId) : undefined;
  const unitCost = mainItem?.standardCost ?? Math.round(curPrice * 0.35);
  const unitProfit = curPrice - unitCost;

  const mPrice = markTag(state, "selling_price");
  const mRaw1 = markTag(state, "raw_cost_1");
  const mRent = markTag(state, "facility_rent");
  const mDemand = markTag(state, "daily_demand");
  const mMkt = markTag(state, "marketing_budget");
  const mComp = markTag(state, "competitor_price");
  const mWtp = markTag(state, "customer_wtp");

  // Gather supplier items
  const supplyRows = state.supply.suppliers
    .map((sup, idx) => {
      const offer = sup.offers[0];
      if (!offer) return "";
      const it = state.catalog.items.find((i) => i.id === offer.itemId);
      const onHand = state.warehouses.lots
        .filter((l) => l.itemId === offer.itemId)
        .reduce((s, l) => s + l.qty, 0);
      const batchCost = offer.unitPrice * offer.moq;
      const aKey: AssumptionKey = idx === 1 ? "raw_cost_2" : "raw_cost_1";
      const aMark = markTag(state, aKey);
      return `
        <div style="display:flex;justify-content:space-between;align-items:center;padding:6px 8px;background:#090e1a;border:1px solid #1e293b;border-radius:6px;margin-top:5px;gap:6px">
          <div>
            <strong style="font-size:12px;color:#f8fafc;cursor:pointer" data-node-kind="supplier" data-node-id="${escapeHtml(sup.id)}" title="Klikkaa tutkiaksesi toimittajaa">📦 ${escapeHtml(it?.name ?? offer.itemId)}</strong>
            <span class="sub" style="display:block;font-size:11px;color:#94a3b8">
              ${escapeHtml(sup.name)} • Varastossa: <b style="color:${onHand < offer.moq * 0.5 ? "#ef4444" : "#38bdf8"}">${fmtNum(onHand)} ${escapeHtml(it?.uom ?? "kpl")}</b> •
              <button type="button" class="assumption-pill assumption-pill-inline" data-assumption-key="${aKey}" title="Keksitty/mallinnettu yksikköhinta — klikkaa tutkiaksesi sidonnaisuuksia tai muokataksesi">${fmtCurrencyPrecise(offer.unitPrice)}/${escapeHtml(it?.uom ?? "kpl")}${aMark}</button>
            </span>
          </div>
          ${
            wh0 && lane0
              ? `<button class="btn btn-xs btn-primary" data-action='{"type":"PLACE_PURCHASE_ORDER","supplierId":"${sup.id}","itemId":"${offer.itemId}","qty":${offer.moq},"warehouseId":"${wh0.id}","laneId":"${lane0.id}"}'>
                  🛒 Osta +${offer.moq} (${fmtCurrency(batchCost)})
                </button>`
              : ""
          }
        </div>
      `;
    })
    .join("");

  const facilityRows = state.warehouses.sites
    .map((wh) => {
      const dailyRent = wh.rentPerDay ?? 0;
      const monthlyRent = dailyRent * 30;
      return `
        <div style="display:flex;justify-content:space-between;align-items:center;padding:6px 8px;background:#090e1a;border:1px solid #1e293b;border-radius:6px;margin-top:5px;gap:6px">
          <div>
            <strong style="font-size:12px;color:#f8fafc;cursor:pointer" data-node-kind="warehouse" data-node-id="${escapeHtml(wh.id)}" title="Klikkaa tutkiaksesi tilaa ja varastoa">🏪 ${escapeHtml(wh.name)}</strong>
            <span class="sub" style="display:block;font-size:11px;color:#94a3b8">
              ${dailyRent > 0 ? `<button type="button" class="assumption-pill assumption-pill-inline" data-assumption-key="facility_rent" title="Klikkaa muokataksesi tilavuokraa">Vuokra ${fmtCurrency(dailyRent)}/pv (${fmtCurrency(monthlyRent)}/kk)${mRent}</button>` : "Oma toimipiste"} • Täyttöaste ${fmtPct(wh.telemetry.utilization, 0)} • Laitetaso ${fmtPct(wh.automationLevel, 0)}
            </span>
          </div>
          <button class="btn btn-xs btn-secondary" data-action='{"type":"CAPEX_UPGRADE","targetKind":"warehouse","targetId":"${wh.id}","upgrade":"capacity","amount":4000000,"financing":"cash"}'>
            +Laajenna
          </button>
        </div>
      `;
    })
    .join("");

  const totalPotential = state.market.segments.reduce((s, seg) => {
    const pr = state.market.presence.find((p) => p.segmentId === seg.id);
    return s + Math.round(pr?.potentialToday ?? seg.baseDailyDemand);
  }, 0);
  const totalBuyers = state.market.segments.reduce((s, seg) => {
    const pr = state.market.presence.find((p) => p.segmentId === seg.id);
    const pot = pr?.potentialToday ?? seg.baseDailyDemand;
    return s + Math.round(pot * (pr?.marketShare ?? 0.25));
  }, 0);

  return `
    <!-- CONTEXT-SPECIFIC OPERATIONAL COMMAND GRID (4 PILLARS WITH * ASSUMPTIONS) -->
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:10px">
      <!-- 1. Ostot, Raaka-aineet & Kupit/Tarvikkeet -->
      <div class="panel-card" style="padding:10px 12px">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <span class="tag tag-cyan">1. RAAKA-AINEET & TARVIKKEET</span>
          <button class="btn btn-xs btn-secondary" data-tab="operations">${clarityMode === "simple" ? "Varasto →" : "Inventory →"}</button>
        </div>
        <h4 style="margin:6px 0 2px 0;font-size:13px">Mistä ja mitä ostetaan sisään</h4>
        ${supplyRows}
      </div>

      <!-- 2. Koju / Toimitila, Vuokra & Kalusto -->
      <div class="panel-card" style="padding:10px 12px">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <span class="tag tag-blue">2. TOIMITILA, KOJU & VUOKRA</span>
          <button class="btn btn-xs btn-secondary" data-node-kind="workCenter" data-node-id="${escapeHtml(state.operations.workCenters[0]?.id ?? "")}">Tiski & Työ →</button>
        </div>
        <h4 style="margin:6px 0 2px 0;font-size:13px">Toimipisteet (${state.warehouses.sites.length} kpl) & Kalusto</h4>
        ${facilityRows}
      </div>

      <!-- 3. Asiakasvirta, Markkinointi & Myyntihinta -->
      <div class="panel-card" style="padding:10px 12px">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <span class="tag tag-green">3. ASIAKASVIRTA & MYYNTI</span>
          <button class="btn btn-xs btn-secondary" data-node-kind="segment" data-node-id="${escapeHtml(seg0?.id ?? "")}">Asiakkaat →</button>
        </div>
        <h4 style="margin:6px 0 2px 0;font-size:13px">Ohikulkijoista maksaviksi asiakkaiksi</h4>
        <div style="padding:6px 8px;background:#090e1a;border:1px solid #1e293b;border-radius:6px;margin-top:5px;font-size:11.5px;color:#cbd5e1">
          <div>👥 <b>Asiakasvirta:</b> <button type="button" class="assumption-pill assumption-pill-inline" data-assumption-key="daily_demand" title="Klikkaa muokataksesi päivittäistä asiakasvirtaa">${fmtNum(totalPotential)} ohikulkijaa/pv${mDemand}</button> ➔ <b class="text-cyan">~${fmtNum(totalBuyers)} ostajaa/pv</b> (${fmtPct(pres0?.marketShare ?? 0.25, 0)} osuus)</div>
          <div style="margin-top:3px">💶 <b>Yksikkötalous:</b> Myyntihinta <button type="button" class="assumption-pill assumption-pill-inline" data-assumption-key="selling_price" title="Klikkaa muokataksesi myyntihintaa">${fmtCurrencyPrecise(curPrice)}${mPrice}</button> − Kulu <button type="button" class="assumption-pill assumption-pill-inline" data-assumption-key="raw_cost_1" title="Klikkaa muokataksesi raaka-ainekulua">${fmtCurrencyPrecise(unitCost)}${mRaw1}</button> = Kate <b class="text-green">+${fmtCurrencyPrecise(unitProfit)}</b></div>
          <div style="margin-top:3px">📣 <b>Markkinointi:</b> ${escapeHtml(mkt0?.name ?? "Paikallismainonta")} (<button type="button" class="assumption-pill assumption-pill-inline" data-assumption-key="marketing_budget" title="Klikkaa muokataksesi markkinointibudjettia">${fmtCurrency(mkt0?.dailyBudget ?? 0)}/pv${mMkt}</button> • Tunnettuus ${fmtPct(pres0?.awareness ?? 0, 0)})</div>
        </div>
        <div style="display:flex;gap:6px;margin-top:6px;flex-wrap:wrap">
          ${
            off0
              ? `<button class="btn btn-xs btn-primary" data-price-shift="${off0.id}:1.06">📈 Hinta +6%</button>
                 <button class="btn btn-xs btn-secondary" data-price-shift="${off0.id}:0.94">📉 Hinta -6%</button>`
              : ""
          }
          ${
            mkt0
              ? `<button class="btn btn-xs btn-primary" data-action='{"type":"SET_MARKETING_BUDGET","channelId":"${mkt0.id}","dailyBudget":${Math.round(mkt0.dailyBudget * 1.35)}}'>📣 Mainonta +35%</button>`
              : ""
          }
        </div>
      </div>

      <!-- 4. Peliteoria & Kilpailijoiden Vastasiirrot -->
      <div class="panel-card" style="padding:10px 12px">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <span class="tag tag-amber">4. PELITEORIA & KILPAILU</span>
          <span class="mono" style="font-size:11px;color:#38bdf8">Neuvotteluvoima ${gt.buyerPowerPct}%</span>
        </div>
        <h4 style="margin:6px 0 2px 0;font-size:13px">${escapeHtml(gt.regimeName)}</h4>
        <div style="padding:6px 8px;background:#090e1a;border:1px solid #1e293b;border-radius:6px;margin-top:5px;font-size:11.5px;color:#cbd5e1;line-height:1.4">
          <div>⚖️ Oma hinta <button type="button" class="assumption-pill assumption-pill-inline" data-assumption-key="selling_price">${fmtCurrencyPrecise(gt.playerAvgPriceCents)}${mPrice}</button> vs. kilpailijat <button type="button" class="assumption-pill assumption-pill-inline" data-assumption-key="competitor_price">${fmtCurrencyPrecise(gt.competitorAvgPriceCents)}${mComp}</button> (Maksuhalukkuus <button type="button" class="assumption-pill assumption-pill-inline" data-assumption-key="customer_wtp">${fmtCurrencyPrecise(seg0?.wtpMean ?? gt.playerAvgPriceCents)}${mWtp}</button>).</div>
          <div style="margin-top:3px;color:#94a3b8">${escapeHtml(activeStageSpec?.gameTheoryNote ?? gt.supplierDependencyWarning)}</div>
        </div>
        <div style="display:flex;gap:6px;margin-top:6px;flex-wrap:wrap">
          ${
            state.supply.suppliers[0]
              ? `<button class="btn btn-xs btn-secondary" data-negotiate-supplier="${state.supply.suppliers[0].id}">🤝 Kilpailuta tukku</button>`
              : ""
          }
          ${
            nextStageSpec
              ? `<button class="btn btn-xs btn-primary" data-scale-venture="true">🚀 Kasvata Vaiheeseen ${nextStageSpec.stage}</button>`
              : ""
          }
        </div>
      </div>
    </div>

    ${renderTeamAndRolesQuickBar(state, clarityMode)}
  `;
}

export function renderWarRoomDashboard(view: WarRoomViewState): string {
  const { state, branches, activeBranchId, briefing, activeTab, selectedNode } = view;
  const clarityMode: ClarityMode = view.clarityMode ?? "simple";
  const wsView: WorkspaceViewMode =
    view.workspaceView ?? (clarityMode === "expert" ? "all" : "daily");
  const is = buildIncomeStatement(state.finance.ledger);
  const bs = buildBalanceSheet(state.finance.ledger);
  const lastDaily = state.telemetry.daily[state.telemetry.daily.length - 1];

  const grossMargin = is.netRevenue > 0 ? is.grossProfit / is.netRevenue : 0;
  const dio = lastDaily?.dio ?? 0;
  const dso = lastDaily?.dso ?? 0;
  const dpo = lastDaily?.dpo ?? 0;
  const ccc = lastDaily?.ccc ?? dio + dso - dpo;
  const fillRate = lastDaily?.fillRate ?? 1;
  const backlogUnits = state.commercial.backlog.reduce(
    (s, b) => s + Math.max(0, b.qty - b.shippedQty),
    0,
  );
  const revolver = state.finance.debts.find((d) => d.kind === "revolver");
  const revAvail = revolver ? Math.max(0, revolver.limit - revolver.principal) : 0;
  const wc0 = state.operations.workCenters[0];
  const hc = totalHeadcount(state);
  const avgMorale =
    state.org.positions.length > 0
      ? state.org.positions.reduce((s, p) => s + p.morale, 0) / state.org.positions.length
      : 0.8;

  const activeArchetype: IndustryArchetype =
    state.company.archetype ?? "ASSET_HEAVY_MANUFACTURING";
  const archSpec = ARCHETYPE_BASELINES[activeArchetype];
  const activeTriggers = state.lastTriggers ?? [];

  let drawerContent = "";
  if (activeTab === "financials") {
    drawerContent = renderFinancialTelemetryDrawer(state, clarityMode);
  } else if (activeTab === "operations") {
    drawerContent = renderWarehouseAndOpsDrawer(state, clarityMode);
  } else if (activeTab === "org") {
    drawerContent = renderOrgAndCapabilityDrawer(state, clarityMode);
  } else {
    drawerContent = renderTimelineAndMonteCarloDrawer(
      state,
      branches,
      activeBranchId,
      view.mcSummary,
      view.exportedMarkdown,
    );
  }

  const statusTagClass =
    state.status === "running"
      ? "tag-green"
      : state.status === "paused_decision"
        ? "tag-amber"
        : "tag-red";

  const maskedCfg = view.llmConfig ?? getMaskedLlmConfig();
  const providerSpec = PROVIDER_PRESETS[maskedCfg.provider] ?? PROVIDER_PRESETS.deterministic;
  const providerLabel = providerSpec.name.toUpperCase();
  const tel = getLlmSessionTelemetry();

  let llmTagClass = "tag-slate";
  let llmTagText = `NEURAL ENGINE B: DETERMINISTIC (OFFLINE)`;

  if (view.llmMeta?.live) {
    llmTagClass = "tag-green";
    llmTagText = `NEURAL ENGINE B: ${providerLabel} LIVE (${escapeHtml(view.llmMeta.model)} • ${view.llmMeta.latencyMs}ms)`;
  } else if (maskedCfg.isKeySet) {
    llmTagClass = "tag-cyan";
    llmTagText = `NEURAL ENGINE B: ${providerLabel} ARMED (${escapeHtml(maskedCfg.model)})`;
  } else if (maskedCfg.provider !== "deterministic") {
    llmTagClass = "tag-amber";
    llmTagText = `NEURAL ENGINE B: ${providerLabel} (NO KEY - CLICK TO CONFIGURE)`;
  }

  const llmTag = `
    <button
      type="button"
      id="btn-open-llm-modal"
      class="btn-llm-pill ${llmTagClass} mono"
      title="Klikkaa avataksesi API-asetukset, kutsumäärän, token-kulutuksen ja tapahtumalokin"
    >
      ⚙ ${llmTagText} • 📡 API: ${tel.totalCalls} kutsua (~${fmtNum(tel.totalTokens)} tok • ${escapeHtml(tel.quotaLabelFi)})
    </button>
  `;

  const latestAct = tel.recentActivities[0];
  const latestActIcon =
    latestAct?.actor === "llm"
      ? "🤖"
      : latestAct?.actor === "web"
        ? "🌍"
        : latestAct?.actor === "player"
          ? "👤"
          : "⚙️";

  const estKpiWaitMins =
    wc0 && wc0.telemetry.avgWaitDays <= 0.08
      ? Math.max(1, Math.round(wc0.telemetry.avgWaitDays * 12 * 60))
      : Math.max(1, Math.min(45, Math.round((wc0?.telemetry.utilization ?? 0.2) * 18)));

  const graph = buildAssumptionDependencyGraph(state);
  const assumedCount = (Object.keys(graph) as AssumptionKey[]).filter(
    (k) => graph[k].isAssumed,
  ).length;
  const currentStage = state.company.ventureStage ?? 1;

  return `
    <div class="war-room-shell">
      <!-- TOP COMMAND BAR -->
      <header class="topbar">
        <div class="brand-cluster">
          <div class="apex-logo">▲ APEX</div>
          <div>
            <div class="company-title-row">
              <h1>${escapeHtml(state.company.name)}</h1>
              <span class="tag tag-cyan">${escapeHtml(state.company.industry)}</span>
              <span class="tag tag-blue mono" title="Archetype Bounds: GM ${(archSpec.grossMarginBand[0] * 100).toFixed(0)}–${(archSpec.grossMarginBand[1] * 100).toFixed(0)}% • DSO ${archSpec.dsoBandDays[0]}–${archSpec.dsoBandDays[1]}d • DPO ${archSpec.dpoBandDays[0]}–${archSpec.dpoBandDays[1]}d">
                ARCHETYPE: ${escapeHtml(activeArchetype)}
              </span>
              ${llmTag}
              <span class="tag ${statusTagClass}">${state.status === "running" ? "KÄYNNISSÄ" : state.status === "paused_decision" ? "PÄÄTÖS ODOTTAA" : state.status.toUpperCase()}</span>
            </div>
            <p class="company-tagline">${escapeHtml(state.company.tagline)}</p>
          </div>
        </div>

        <!-- SIMULATION CLOCK & TIERED TICK-CLOCK CONTROLS -->
        <div class="clock-controls">
          <div class="clock-readout">
            <span class="clock-label" title="TIERED TICK-CLOCK (30/360)">${clarityMode === "simple" ? "AIKAJANA • TIERED TICK-CLOCK" : "TIERED TICK-CLOCK (30/360)"}</span>
            <strong class="mono">${clarityMode === "simple" ? `PÄIVÄ ${state.calendar.tick} • V${state.calendar.year} Q${state.calendar.quarter} KK${state.calendar.monthOfYear}` : `DAY ${state.calendar.tick} • Y${state.calendar.year} Q${state.calendar.quarter} M${state.calendar.monthOfYear} D${state.calendar.dayOfMonth}`}</strong>
          </div>
          <div class="speed-buttons">
            <button class="btn btn-sm btn-secondary" id="btn-return-genesis" title="Palaa liike-idean ja alkupääoman suunnitteluun">🌱 Uusi yritys</button>
            <button class="btn btn-sm btn-secondary" id="btn-play-toggle" data-speed="0">▶ Play 1x</button>
            <button class="btn btn-sm btn-secondary" id="btn-fast-toggle" data-speed="5">⏩ 5x</button>
            <button class="btn btn-sm btn-primary" data-step-ticks="1">+1 Päivä (1d)</button>
            <button class="btn btn-sm btn-primary" data-step-macro="true" title="Simuloi eteenpäin seuraavaan viikkokatsaukseen tai tärkeään tapahtumaan asti">
              ⚡ Next Trigger / Briefing
            </button>
            <button class="btn btn-sm btn-secondary" data-step-ticks="7">+1 Viikko (7d)</button>
            <button class="btn btn-sm btn-secondary" data-step-ticks="30">+1 Kuukausi (30d)</button>
          </div>
        </div>
      </header>

      <!-- LIVE AI & ENGINE ACTIVITY TICKER + LOADING PROGRESS BANNER -->
      <div id="live-activity-ticker" style="display:flex;justify-content:space-between;align-items:center;gap:10px;padding:5px 14px;background:#070c18;border-bottom:1px solid #1e293b;font-size:11.5px;flex-wrap:wrap">
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
          <span class="tag tag-cyan mono" style="font-size:10px">📡 MITÄ SOVELLUS &amp; TEKOÄLY TEKEE NYT</span>
          <span id="live-activity-status-text" style="color:#e2e8f0">
            ${
              latestAct
                ? `${latestActIcon} <b>${escapeHtml(latestAct.title)}:</b> <span style="color:#94a3b8">${escapeHtml(latestAct.detail)}</span> <span class="mono" style="color:#38bdf8;font-size:10.5px">(${latestAct.durationMs ? `${latestAct.durationMs}ms • ` : ""}klo ${escapeHtml(latestAct.timestamp)})</span>`
                : `⚙️ <b>Simulaatiomoottori valmiina:</b> <span style="color:#94a3b8">Päivä ${state.calendar.tick} laskettu (Kassa ${fmtCurrency(bs.assets.cash)}, Tiimi ${hc} hlö). Klikkaa mitä tahansa toimintoa.</span>`
            }
          </span>
        </div>
        <div style="display:flex;align-items:center;gap:8px">
          <span class="mono" style="font-size:10.5px;color:#94a3b8">
            API-kutsut: <b style="color:#38bdf8">${tel.totalCalls}</b> • Tokenit: <b style="color:#10b981">~${fmtNum(tel.totalTokens)}</b> • Tila: <b style="color:#fbbf24">${escapeHtml(tel.quotaLabelFi)}</b>
          </span>
          <button type="button" class="btn btn-xs btn-secondary" id="btn-open-llm-modal-ticker" onclick="document.getElementById('btn-open-llm-modal')?.click()" style="font-size:10.5px;padding:2px 7px">
            📋 Tapahtumaloki &amp; API-tila
          </button>
        </div>
      </div>

      <!-- COLLAPSIBLE ENGINE HOOD DRAWER FOR PRESETS, ZERO-TO-ONTOLOGY COMPILER & 8-STEP PIPELINE -->
      <details class="fm-progressive-drawer" style="margin:6px 14px 4px 14px" ${view.lastActionFeedback || activeTriggers.length > 0 || clarityMode === "expert" ? "open" : ""}>
        <summary class="fm-progressive-summary" style="padding:5px 10px">
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
            <span class="tag tag-slate mono" style="font-size:10px">🛠️ KONEHUONE, PIKASKENAARIOT &amp; 8-VAIHEINEN LASKENTAKETJU</span>
            <span class="sub" style="font-size:11px">
              ${
                view.lastActionFeedback
                  ? `<b style="color:${view.lastActionFeedback.ok ? "#10b981" : "#ef4444"}">${escapeHtml(view.lastActionFeedback.summary)}</b>`
                  : activeTriggers.length > 0
                    ? `<b style="color:#fbbf24">⚡ ${activeTriggers.length} aktiivista hälytystä</b>`
                    : "✓ Kaikki 8 laskentavaihetta ja taseen tarkistukset kunnossa — klikkaa avataksesi skenaariovaihtajan tai konehuoneen ▾"
              }
            </span>
          </div>
          <div class="clarity-mode-switch" style="display:inline-flex;background:#0f172a;border:1px solid #334155;border-radius:6px;padding:2px;gap:2px">
            <button type="button" class="btn btn-xs ${clarityMode === "simple" ? "btn-primary" : "btn-secondary"}" data-set-clarity="simple" style="font-weight:600;padding:2px 8px;">
              🟢 Selkokieli (Yrittäjätila)
            </button>
            <button type="button" class="btn btn-xs ${clarityMode === "expert" ? "btn-primary" : "btn-secondary"}" data-set-clarity="expert" style="font-weight:600;padding:2px 8px;">
              🔬 Controller &amp; M&amp;A (ERP)
            </button>
          </div>
        </summary>

        <!-- ARCHETYPE-BOUNDED ZERO-TO-ONTOLOGY COMPILER & SCENARIO SWITCHER BAR -->
        <section class="compiler-bar">
          <div class="preset-buttons">
            <span class="compiler-label">STARTER PRESETS:</span>
            ${SCENARIO_PRESETS.map(
              (p) => `
                <button class="btn btn-xs ${state.company.name === p.name ? "btn-primary" : "btn-secondary"}" data-load-preset="${p.id}">
                  ${escapeHtml(p.name)}
                </button>
              `,
            ).join("")}
          </div>
          <form id="compiler-form" class="compiler-form">
            <select id="compiler-archetype-select" class="compiler-select" title="Anchor compilation to an explicit baseline industry archetype (or Auto-Classify)">
              <option value="">Auto-Classify Archetype (5 Baselines)</option>
              ${IndustryArchetype.options
                .map(
                  (arch) => `
                <option value="${arch}">${arch} (${ARCHETYPE_BASELINES[arch].grossMarginBand[0] * 100}–${ARCHETYPE_BASELINES[arch].grossMarginBand[1] * 100}% GM)</option>
              `,
                )
                .join("")}
            </select>
            <input
              type="text"
              id="compiler-prompt-input"
              class="compiler-input"
              placeholder="Zero-to-Ontology Compiler: Kirjoita mikä tahansa uusi liike-idea lennosta..."
              value=""
            />
            <button type="submit" class="btn btn-xs btn-primary">Compile Business DNA</button>
          </form>
        </section>

        <!-- 8-STEP PIPELINE & TIERED TICK-CLOCK INTERRUPT / TWO-PHASE COMMIT STATUS BAR -->
        <section class="pipeline-status-strip">
          <div class="pipeline-steps-row">
            <span class="compiler-label">8-STEP DETERMINISTIC PIPELINE:</span>
            <span class="pipeline-pill">${clarityMode === "simple" ? "1. Hankinnat" : "1. Inbound"}</span>
            <span class="pipeline-arrow">→</span>
            <span class="pipeline-pill">${clarityMode === "simple" ? "2. Varasto / Kioski" : "2. Warehouse"}</span>
            <span class="pipeline-arrow">→</span>
            <span class="pipeline-pill">${clarityMode === "simple" ? "3. Valmistus &amp; Tiski" : "3. Production (L=λW)"}</span>
            <span class="pipeline-arrow">→</span>
            <span class="pipeline-pill">${clarityMode === "simple" ? "4. Kysyntä" : "4. Demand"}</span>
            <span class="pipeline-arrow">→</span>
            <span class="pipeline-pill">${clarityMode === "simple" ? "5. Myynti &amp; Kassa" : "5. Outbound &amp; A/R"}</span>
            <span class="pipeline-arrow">→</span>
            <span class="pipeline-pill">${clarityMode === "simple" ? "6. Tiimi &amp; Roolit" : "6. Workforce &amp; RACI"}</span>
            <span class="pipeline-arrow">→</span>
            <span class="pipeline-pill">${clarityMode === "simple" ? "7. Kassa &amp; Tulos" : "7. Treasury &amp; 3-Stmt"}</span>
            <span class="pipeline-arrow">→</span>
            <span class="pipeline-pill">${clarityMode === "simple" ? "8. Hälytykset" : "8. Trigger Monitor"}</span>
          </div>

          <div class="trigger-badges-row">
            ${
              activeTriggers.length > 0
                ? activeTriggers
                  .map(
                    (t) => `
                  <span class="tag ${t.severity === "critical" ? "tag-red" : t.severity === "warning" ? "tag-amber" : "tag-cyan"}" title="${escapeHtml(t.message)}">
                    ⚡ ${escapeHtml(t.kind)}: ${escapeHtml(t.message)}
                  </span>
                `,
                  )
                  .join("")
                : `<span class="tag tag-green">${clarityMode === "simple" ? "✓ KAIKKI JÄRJESTELMÄT KUNNOSSA" : "✓ TRIGGER MONITOR CLEAR (MICRO-TICK LOOP NOMINAL)"}</span>`
            }
            ${
              view.lastActionFeedback
                ? `
                <span class="tag ${view.lastActionFeedback.ok ? "tag-green" : "tag-red"} mono" title="${escapeHtml(view.lastActionFeedback.summary)}">
                  ${
                    view.lastActionFeedback.ok
                      ? `2PC COMMITTED [${escapeHtml(view.lastActionFeedback.actionType)}]: ${escapeHtml(view.lastActionFeedback.summary)}`
                      : `2PC REJECTED [${escapeHtml(view.lastActionFeedback.actionType)}]: ${escapeHtml(
                          view.lastActionFeedback.diagnostics
                            .map((d) => `${d.code}: ${d.message}`)
                            .join(" | "),
                        )}`
                  }
                </span>
              `
                : ""
            }
          </div>
        </section>
      </details>

      <!-- 6-CARD EXECUTIVE KPI RIBBON (CLICKABLE DRILL-DOWN CARDS) -->
      <section class="kpi-ribbon">
        <div class="kpi-card" data-kpi-drilldown="cash" style="cursor:pointer" title="Klikkaa avataksesi kassan, lainojen ja maksuvalmiuden syväluotauksen">
          <label>${clarityMode === "simple" ? "KASSA &amp; RAHOITUS ↗" : "CASH &amp; LIQUIDITY ↗"}</label>
          <strong class="mono text-cyan">${fmtCurrency(bs.assets.cash)}</strong>
          <span class="sub">${clarityMode === "simple" ? "Luottolimiitti" : "Revolver Avail"}: ${fmtCurrency(revAvail, true)} • ${clarityMode === "simple" ? "Kiitotie" : "Runway"}: ${lastDaily?.runwayDays ? `${lastDaily.runwayDays} ${clarityMode === "simple" ? "pv" : "d"}` : (clarityMode === "simple" ? "Kassapositiivinen" : "Cash-Positive")}</span>
        </div>
        <div class="kpi-card" data-kpi-drilldown="margin" style="cursor:pointer" title="Klikkaa avataksesi myynnin, hinnoittelun ja tuloslaskelman">
          <label>${clarityMode === "simple" ? "KUUKAUDEN MYYNTI &amp; KATE ↗" : "MTD NET REVENUE &amp; GM% ↗"}</label>
          <strong class="mono">${fmtCurrency(is.netRevenue)} <small>(${fmtPct(grossMargin, 1)})</small></strong>
          <span class="sub">${clarityMode === "simple" ? "Käyttökate (EBITDA)" : "MTD EBITDA"}: <b class="${is.ebitda >= 0 ? "text-green" : "text-red"}">${fmtCurrency(is.ebitda)}</b></span>
        </div>
        <div class="kpi-card" data-kpi-drilldown="ccc" style="cursor:pointer" title="Klikkaa tutkiaksesi tukkuostoja, maksuaikoja ja käyttöpääomaa">
          <label>${clarityMode === "simple" ? "KASSASYKLI &amp; MAKSUAJAT ↗" : "WORKING CAPITAL CYCLE (CCC) ↗"}</label>
          <strong class="mono ${ccc > 45 ? "text-amber" : "text-green"}">${ccc.toFixed(1)} ${clarityMode === "simple" ? "pv" : "days"}</strong>
          <span class="sub">${clarityMode === "simple" ? `Varasto ${dio.toFixed(0)}pv + Saamiset ${dso.toFixed(0)}pv − Velat ${dpo.toFixed(0)}pv` : `DIO ${dio.toFixed(0)}d + DSO ${dso.toFixed(0)}d − DPO ${dpo.toFixed(0)}d`}</span>
        </div>
        <div class="kpi-card" data-kpi-drilldown="fill" style="cursor:pointer" title="Klikkaa tutkiaksesi asiakasvirtaa, kysyntää ja markkinointia">
          <label>${clarityMode === "simple" ? "TOIMITUSVARMUUS &amp; ASIAKKAAT ↗" : "ORDER FILL RATE &amp; BACKLOG ↗"}</label>
          <strong class="mono ${fillRate < 0.8 ? "text-red" : "text-green"}">${fmtPct(fillRate, 1)}</strong>
          <span class="sub">${clarityMode === "simple" ? `Toimitusjono: ${fmtNum(backlogUnits)} kpl • Sopimukset: ${state.commercial.contracts.filter((c) => c.status === "active").length}` : `Unshipped Backlog: ${fmtNum(backlogUnits)}u • Contracts: ${state.commercial.contracts.filter((c) => c.status === "active").length}`}</span>
        </div>
        <div class="kpi-card" data-kpi-drilldown="queue" style="cursor:pointer" title="Klikkaa tutkiaksesi valmistusta, tiskiä ja kapasiteettia">
          <label>${clarityMode === "simple" ? "VALMISTUS &amp; ASIAKASPALVELU ↗" : "PRODUCTION QUEUE (L = λW) ↗"}</label>
          <strong class="mono ${wc0 && wc0.telemetry.utilization > 0.85 ? "text-red" : ""}">${clarityMode === "simple" ? `Ruuhka ${fmtPct(wc0?.telemetry.utilization ?? 0, 0)} • Jono ~${Math.round(wc0?.telemetry.littlesL ?? 0)} kpl` : `ρ = ${fmtPct(wc0?.telemetry.utilization ?? 0, 0)} • L = ${(wc0?.telemetry.littlesL ?? 0).toFixed(1)}`}</strong>
          <span class="sub">${clarityMode === "simple" ? `Odotus ${wc0 && wc0.telemetry.utilization > 0.12 ? `~${estKpiWaitMins} min` : "Alle 1 min"} • Laitteisto ${fmtPct(wc0?.condition ?? 1, 0)}` : `Wait W = ${(wc0?.telemetry.avgWaitDays ?? 1).toFixed(1)}d • Cond ${fmtPct(wc0?.condition ?? 1, 0)}`}</span>
        </div>
        <div class="kpi-card" data-kpi-drilldown="team" style="cursor:pointer" title="Klikkaa avataksesi tiimin, palkat ja roolit">
          <label>${clarityMode === "simple" ? "HENKILÖSTÖ &amp; TIIMI ↗" : "ORG &amp; RACI GOVERNANCE ↗"}</label>
          <strong class="mono">${clarityMode === "simple" ? `${hc} ${hc === 1 ? "Henkilö (Yksin)" : "Henkilöä"} • Vire ${fmtPct(avgMorale, 0)}` : `${hc} Staff • ${fmtPct(avgMorale, 0)} Morale`}</strong>
          <span class="sub">${clarityMode === "simple" ? `Roolien selkeys: ${fmtPct(1 - state.org.governance.drift, 0)}` : `Governance Drift: ${fmtPct(state.org.governance.drift, 1)} • Macro: ${state.market.macro.cyclePhase.toUpperCase()}`}</span>
        </div>
      </section>

      <!-- MAIN WAR ROOM SPLIT WORKSPACE -->
      <main class="workspace-grid">
        <!-- LEFT / CENTER COLUMN: WORKSPACE TABS + FOCUSED SECTIONS -->
        <div class="main-stage">
          <!-- CLEAN WORKSPACE VIEW TABS (PREVENTS INFORMATION OVERLOAD WHILE KEEPING ALL TOOLS 1 CLICK AWAY) -->
          <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;padding:8px 10px;background:#090e1a;border:1px solid #1e3a8a;border-radius:8px;margin-bottom:10px">
            <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">
              <span style="font-size:10.5px;font-weight:700;color:#94a3b8;text-transform:uppercase;margin-right:4px">Näkymä:</span>
              <button type="button" class="btn btn-xs ${wsView === "daily" ? "btn-primary" : "btn-secondary"}" data-ws-view="daily" style="padding:5px 10px;font-weight:700">
                🏪 1. Päivittäinen Arki, Ketju &amp; Tiimi
              </button>
              <button type="button" class="btn btn-xs ${wsView === "assumptions" ? "btn-primary" : "btn-secondary"}" data-ws-view="assumptions" style="padding:5px 10px;font-weight:700">
                ★ 2. Oletukset (*) &amp; Sidonnaisuudet (${assumedCount}*)
              </button>
              <button type="button" class="btn btn-xs ${wsView === "market" ? "btn-primary" : "btn-secondary"}" data-ws-view="market" style="padding:5px 10px;font-weight:700">
                🌍 3. Markkinatutkimus &amp; Peliliikkeet
              </button>
              <button type="button" class="btn btn-xs ${wsView === "growth" ? "btn-primary" : "btn-secondary"}" data-ws-view="growth" style="padding:5px 10px;font-weight:700">
                🚀 4. Kasvupolku (Vaihe ${currentStage}/4)
              </button>
              <button type="button" class="btn btn-xs ${wsView === "erp" ? "btn-primary" : "btn-secondary"}" data-ws-view="erp" style="padding:5px 10px;font-weight:700">
                📊 5. Tarkka Kirjanpito &amp; ERP
              </button>
            </div>
            <button type="button" class="btn btn-xs ${wsView === "all" ? "btn-primary" : "btn-secondary"}" data-ws-view="${wsView === "all" ? "daily" : "all"}" title="Näytä kaikki osiot allekkain yhdellä sivulla tai tiivistä välilehdille">
              ${wsView === "all" ? "📐 Tiivistä välilehdille" : "👁 Näytä kaikki kerralla"}
            </button>
          </div>

          <!-- SECTION 1: DAILY OPERATIONS + VALUE CHAIN -->
          <div class="ws-section" data-ws-section="daily" style="${wsView === "daily" || wsView === "all" ? "" : "display:none;"}">
            ${renderContextualBusinessCommandGrid(state, clarityMode, view.selectedAssumption)}

            <div class="panel-card vc-panel">
              <div class="card-header">
                <div>
                  <span class="tag tag-cyan">${clarityMode === "simple" ? "LIIKETOIMINNAN KOKONAISKETJU" : "LIVE VALUE CHAIN TOPOLOGY &amp; NODE TELEMETRY"}</span>
                  <h3>${clarityMode === "simple" ? "Tukuista ja raaka-aineista asiakkaille (Klikkaa mitä tahansa laatikkoa)" : "End-to-End Enterprise Flow (Click Any Node to Inspect &amp; Act)"}</h3>
                </div>
                <div style="display:flex;gap:8px;align-items:center">
                  <span class="legend-dot dot-ok"></span><span class="sub">${clarityMode === "simple" ? "Normaali" : "Nominal"}</span>
                  <span class="legend-dot dot-warn"></span><span class="sub">${clarityMode === "simple" ? "Kiirettä" : "72–88% Load"}</span>
                  <span class="legend-dot dot-crit"></span><span class="sub">${clarityMode === "simple" ? "Ruuhka" : "&gt;88% Bottleneck"}</span>
                </div>
              </div>
              <div class="vc-canvas-wrap">
                ${renderValueChainSvg(state, selectedNode, clarityMode)}
              </div>
              <div class="vc-inspector-wrap">
                ${renderNodeInspector(state, selectedNode, clarityMode)}
              </div>
            </div>
          </div>

          <!-- SECTION 2: FOOTBALL MANAGER ASSUMPTION (*) & DEPENDENCY NETWORK EXPLORER -->
          <div class="ws-section" data-ws-section="assumptions" style="${wsView === "assumptions" || wsView === "all" ? "" : "display:none;"}">
            ${renderAssumptionDependencyExplorer(state, view.selectedAssumption)}
          </div>

          <!-- SECTION 3: AAA AI MARKET RESEARCH, WEB-GROUNDING & STRATEGIC PLAYS -->
          <div class="ws-section" data-ws-section="market" style="${wsView === "market" || wsView === "all" ? "" : "display:none;"}">
            ${renderMarketIntelligenceAndPlaysPanel(state, clarityMode)}
          </div>

          <!-- SECTION 4: 4-STAGE VENTURE EVOLUTION BAR -->
          <div class="ws-section" data-ws-section="growth" style="${wsView === "growth" || wsView === "all" ? "" : "display:none;"}">
            ${renderEvolutionStagesPanel(state, clarityMode)}
          </div>

          <!-- SECTION 5: DEEP-DIVE TELEMETRY DRAWERS (ERP / ACCOUNTING / INVENTORY / ORG / MONTE CARLO) -->
          <div class="ws-section" data-ws-section="erp" style="${wsView === "erp" || wsView === "all" || view.drawerExpanded ? "" : "display:none;"}">
            <details id="fm-deep-dive-drawer" class="fm-progressive-drawer" style="margin-top:8px" open>
              <summary class="fm-progressive-summary">
                <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
                  <span class="tag tag-blue">📂 TAUSTALASKENTA, KIRJANPITO &amp; ERP-SYVÄLUOTAUS</span>
                  <strong style="font-size:13px;color:#f8fafc">Tarkat tulos- ja taselaskelmat, varastoerät (FEFO), RACI-vastuutaulukko ja Monte Carlo -skenaariot ▾</strong>
                </div>
              </summary>

              <!-- TAB BAR FOR DEEP-DIVE DRAWERS -->
              <div class="drawer-tabs" style="margin-top:8px">
                <button class="tab-btn ${activeTab === "financials" ? "active" : ""}" data-tab="financials">
                  ${clarityMode === "simple" ? "💰 1. Kassa, Tulot &amp; Menot" : "1. 3-Statement Financials, CCC &amp; Treasury"}
                </button>
                <button class="tab-btn ${activeTab === "operations" ? "active" : ""}" data-tab="operations">
                  ${clarityMode === "simple" ? "📦 2. Varasto, Kioski &amp; Laitteet" : "2. Warehouse Physics, EOQ/JIT &amp; Little's Law"}
                </button>
                <button class="tab-btn ${activeTab === "org" ? "active" : ""}" data-tab="org">
                  ${clarityMode === "simple" ? "👥 3. Tiimi, Roolit &amp; Palkat" : "3. Capabilities (L1–L3), Org &amp; RACI Matrix"}
                </button>
                <button class="tab-btn ${activeTab === "branches" ? "active" : ""}" data-tab="branches">
                  ${clarityMode === "simple" ? "🔮 4. Skenaariot &amp; Ennusteet" : "4. Timeline Branches (\"Git\"), Monte Carlo &amp; Export"}
                </button>
              </div>

              <div class="drawer-body">
                ${drawerContent}
              </div>
            </details>
          </div>
        </div>

        <!-- RIGHT DOCK: MULTI-AGENT C-SUITE WAR ROOM / SOLO ENTREPRENEUR CHECKLIST & LIVE EVENT LOG -->
        <aside class="right-dock">
          ${renderWarRoomDebatePanel(state, briefing, view.lastNegotiation, clarityMode)}

          <div class="panel-card" style="margin-top:10px">
            <div class="card-header">
              <div>
                <span class="tag tag-slate">${clarityMode === "simple" ? "TAPAHTUMALOKI &amp; PÄÄTÖKSET" : "LIVE TELEMETRY STREAM"}</span>
                <h3>${clarityMode === "simple" ? "Viimeisimmät tapahtumat &amp; siirrot" : "Operational &amp; Financial Event Feed"}</h3>
              </div>
            </div>
            <div class="event-feed">
              ${state.events.notifications
                .slice(-10)
                .reverse()
                .map(
                  (n) => `
                  <div class="feed-item feed-${n.severity}">
                    <span class="mono">[D${n.tick}]</span>
                    <strong>${escapeHtml(n.category.toUpperCase())}:</strong>
                    <span>${escapeHtml(n.message)}</span>
                  </div>
                `,
                )
                .join("")}
            </div>
          </div>
        </aside>
      </main>

      ${renderLlmConfigModal(maskedCfg)}
      ${renderCrisisModal(state)}
    </div>
  `;
}

