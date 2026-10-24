/**
 * APEX Studio — selainsovellus (`src/flow/client/app.ts`).
 *
 * Tila elää selaimessa ja tallentuu localStorageen. Laskenta ajetaan samalla
 * atomiytimellä kuin testit, joten vivut päivittävät näkymän heti ilman
 * palvelinkutsua. Kielimallia käyttävät toiminnot kutsuvat palvelinta, ja
 * jokaisella on sääntöpohjainen varavaihtoehto.
 */
import type { AtomKind, Molecule } from "../kernel/types.ts";
import { ATOM_KIND_LABELS, PRESET_LABELS, createPreset, emptyMolecule, type PresetId } from "../kernel/presets.ts";
import { monteCarlo, stressTest, withCustomerTerms, type MonteCarloResult, type StressInput, type StressResult, type UncertaintyRanges } from "../kernel/sensitivity.ts";
import { simulate } from "../kernel/simulate.ts";
import { buildView, type FlowView, type NodeId } from "../model/view.ts";
import { applyLever, leversFor, type Lever } from "../model/levers.ts";
import { addAtom, addFixedCost, removeAtom, removeFixedCost, renameAtom, renameMolecule, setAtomField, setPayrollDay, updateFixedCost } from "../model/edit.ts";
import {
  buildGraphLaunchpadView,
  checklistView,
  emptyChecklist,
  setItemParam,
  toggleItem,
  type ChecklistState,
} from "../model/launchpad.ts";
import { applyCommands, PANELS, type ApplyOptions, type PanelId } from "../model/commands.ts";
import { coachInsights, type CoachInsight } from "../model/coach.ts";
import {
  ALL_TOOLS,
  LENS_LABELS,
  MATURITY_HINTS,
  MATURITY_LABELS,
  PERSONAS,
  XRAY_LENS_LABELS,
  boundaryMessages,
  defaultMaturityForPersona,
  lensHeadlines,
  lensNodes,
  leversForLens,
  maturityHeadlines,
  personaDef,
  type InspectorTabId,
  type LensId,
  type PersonaId,
  type XRayLensId,
} from "../model/personas.ts";
import type { BusinessCapability, EntityURI, Port, VentureMaturity } from "../graph/types.ts";
import { ideaToMolecule, moleculeToGenesisSpec } from "../model/genesis.ts";
import { getProvenance, sourceLabel, withProvenance } from "../model/provenance.ts";
import { buildScope, validateWidget, widgetFromTemplate, formatWidgetValue, type WidgetFormat, type WidgetSpec } from "../model/widgets.ts";
import { createScenario, SCENARIO_COLORS, type Scenario } from "../model/scenarios.ts";
import { brokenGoalMessages, evaluateGoals, GOAL_METRICS, suggestGoal, type Goal, type GoalMetric } from "../model/goals.ts";
import { CRISIS_LIBRARY, SEASON_PROFILES, eventFromCard, randomCrisis, type SeasonProfileId } from "../model/seasons.ts";
import { TASKS, taskStart } from "../model/tasks.ts";
import { ruleAdvisors, type AdvisorRole } from "../model/advisors.ts";
import { buildReport } from "../model/report.ts";
import { analyzeStatement, defaultSelection, importCommands, parseStatementCsv, type ImportSelection, type MonthlyActual, type StatementAnalysis } from "../model/importer.ts";
import { esc, eur, int, num, pct } from "../model/format.ts";
import { getLocale, isLocale, setLocale, t, type Locale } from "../i18n/index.ts";
import { FlowCanvas, renderIcomProcessOverlayHtml, renderTimeline, zoomLevelForPercent, type TimelineOverlay } from "./canvas.ts";
import {
  buildStudioGraphState,
  renderInspectorZone,
  renderNavigatorZone,
  renderTimelineBranchZone,
  searchEntities,
  type StudioGraphOverrides,
  type StudioGraphState,
} from "./inspector.ts";
import { renderDrawer } from "./drawer.ts";
import { renderLaunchpad } from "./launchpad.ts";
import { renderCoachPanel, renderCoachStrip, type ChatMessage } from "./coach.ts";
import { renderImportPanel } from "./importer.ts";
import { renderWidgetPanel, renderWidgetStrip } from "./widgets.ts";
import {
  markdownToHtml,
  renderActuals,
  renderAdvisors,
  renderFounder,
  renderGoals,
  renderMarket,
  renderReport,
  renderScenarios,
  renderSeasons,
  renderTaskBanner,
  renderTasks,
  type AdvisorsState,
  type MarketState,
  type TaskState,
} from "./tools.ts";

const STORAGE_KEY = "apex.flow.v1";
const UNDO_LIMIT = 30;

interface PersistedState {
  version: 1;
  molecule: Molecule | null;
  checklist?: ChecklistState;
  persona?: PersonaId;
  lens?: LensId;
  chat?: ChatMessage[];
  locale?: Locale;
  widgets?: WidgetSpec[];
  goals?: Goal[];
  scenarios?: Scenario[];
  actuals?: MonthlyActual[];
  task?: TaskState | null;
  completedTasks?: string[];
  mcRanges?: UncertaintyRanges;
}

interface Snapshot {
  molecule: Molecule;
  checklist: ChecklistState;
  widgets: WidgetSpec[];
  goals: Goal[];
}

const state = {
  molecule: null as Molecule | null,
  view: null as FlowView | null,
  graphState: null as StudioGraphState | null,
  checklist: emptyChecklist(),
  persona: "founder" as PersonaId,
  lens: "all" as LensId,
  xrayLens: "ops" as XRayLensId,
  maturity: 3 as VentureMaturity,
  zoomPct: 45,
  selectedUri: "apex://node/root" as EntityURI,
  selectedNodeId: "demand" as NodeId,
  spotlightParentUri: null as EntityURI | null,
  decomposedUris: new Set<EntityURI>(),
  graphOverrides: { customBizCaps: [], bizCapStatuses: {}, customPorts: {} } as StudioGraphOverrides,
  inspectorTab: "physics" as InspectorTabId,
  navigatorCollapsed: false,
  searchQuery: "",
  insights: [] as CoachInsight[],
  chat: [] as ChatMessage[],
  chatBusy: false,
  drawer: null as PanelId | null,
  stress: null as StressResult | null,
  showAllLevers: false,
  day: 0,
  playing: false,
  undo: [] as Snapshot[],
  leverDragging: false,
  importData: null as { analysis: StatementAnalysis | null; selection: ImportSelection; error: string | null } | null,
  widgets: [] as WidgetSpec[],
  widgetPanel: { busy: false, error: null as string | null, lastPrompt: "" },
  goals: [] as Goal[],
  scenarios: [] as Scenario[],
  mc: null as MonteCarloResult | null,
  mcRanges: { volume: 0.2, price: 0.05, variableCost: 0.1, fixedCost: 0.05 } as UncertaintyRanges,
  actuals: [] as MonthlyActual[],
  task: null as TaskState | null,
  completedTasks: [] as string[],
  market: { busy: false, error: null, query: "", result: null } as MarketState,
  advisors: { busy: false, question: "", result: null } as AdvisorsState,
  report: "",
  llm: false,
  onboardingKinds: new Set<AtomKind>(),
  onboardingName: "",
  onboardingIdea: "",
  genesisBusy: false,
  genesisNotes: [] as string[],
};

let canvas: FlowCanvas | null = null;
let playRaf = 0;
let toastTimer = 0;

const root = document.getElementById("flow-root") as HTMLElement;
const $ = <T extends Element = HTMLElement>(sel: string): T | null => root.querySelector<T>(sel);

// ---------------------------------------------------------------------------
// Tallennus ja kumoaminen
// ---------------------------------------------------------------------------

function isMolecule(x: unknown): x is Molecule {
  const m = x as Molecule;
  return !!m && Array.isArray(m.atoms) && typeof m.credit === "object" && Array.isArray(m.fixedCosts);
}

function load(): void {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const p = JSON.parse(raw) as PersistedState;
    if (!p || p.version !== 1) return;
    if (isMolecule(p.molecule)) state.molecule = p.molecule;
    if (p.checklist && typeof p.checklist.items === "object") state.checklist = p.checklist;
    if (p.persona && PERSONAS.some((x) => x.id === p.persona)) state.persona = p.persona;
    if (p.lens && p.lens in LENS_LABELS) state.lens = p.lens;
    if (Array.isArray(p.chat)) state.chat = p.chat.filter((c) => c && typeof c.text === "string" && !c.pending).slice(-50);
    if (isLocale(p.locale)) setLocale(p.locale);
    if (Array.isArray(p.widgets)) state.widgets = p.widgets.filter((w) => w && typeof w.id === "string").slice(0, 40);
    if (Array.isArray(p.goals)) state.goals = p.goals.filter((g) => g && g.metric in GOAL_METRICS);
    if (Array.isArray(p.scenarios)) state.scenarios = p.scenarios.filter((s) => s && isMolecule(s.molecule)).slice(0, 10);
    if (Array.isArray(p.actuals)) state.actuals = p.actuals;
    if (p.task && isMolecule(p.task.start) && TASKS.some((d) => d.id === p.task!.id)) state.task = p.task;
    if (Array.isArray(p.completedTasks)) state.completedTasks = p.completedTasks.filter((x) => typeof x === "string");
    if (p.mcRanges) state.mcRanges = { ...state.mcRanges, ...p.mcRanges };
  } catch {
    // Rikkinäinen tallenne: aloitetaan puhtaalta pöydältä.
  }
}

function save(): void {
  try {
    const data: PersistedState = {
      version: 1,
      molecule: state.molecule,
      checklist: state.checklist,
      persona: state.persona,
      lens: state.lens,
      chat: state.chat.filter((c) => !c.pending).slice(-50),
      locale: getLocale(),
      widgets: state.widgets,
      goals: state.goals,
      scenarios: state.scenarios,
      actuals: state.actuals,
      task: state.task,
      completedTasks: state.completedTasks,
      mcRanges: state.mcRanges,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // Selaimen tallennustila täynnä tai estetty: sovellus toimii silti istunnon ajan.
  }
}

function pushUndo(): void {
  if (!state.molecule) return;
  state.undo.push({ molecule: state.molecule, checklist: state.checklist, widgets: state.widgets, goals: state.goals });
  if (state.undo.length > UNDO_LIMIT) state.undo.shift();
  updateUndoButton();
}

function undo(): void {
  const snap = state.undo.pop();
  if (!snap) return;
  state.molecule = snap.molecule;
  state.checklist = snap.checklist;
  state.widgets = snap.widgets;
  state.goals = snap.goals;
  state.stress = null;
  refresh({ levers: true, persist: true });
  showToast(t("Viimeisin muutos kumottu."));
}

function updateUndoButton(): void {
  const b = $<HTMLButtonElement>("#fl-undo");
  if (b) b.disabled = state.undo.length === 0;
}

function showToast(text: string): void {
  const el = $("#fl-toast");
  if (!el) return;
  el.textContent = text;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el.classList.remove("show"), 3500);
}

// ---------------------------------------------------------------------------
// Renderöinti
// ---------------------------------------------------------------------------

function formatLever(l: Pick<Lever, "format" | "step">, v: number): string {
  switch (l.format) {
    case "eur":
      return eur(v);
    case "pct":
      return pct(v, l.step < 0.01 ? 1 : 0);
    case "int":
      return int(v);
    case "days":
      return t("{n} pv", { n: int(v) });
    default:
      return num(v);
  }
}

const TOOL_LABELS: Record<string, () => string> = {
  tasks: () => `🎯 ${t("Tehtävät")}`,
  scenarios: () => `🔀 ${t("Skenaariot")}`,
  founder: () => `🧑 ${t("Yrittäjä")}`,
  goals: () => `🏁 ${t("Tavoitteet")}`,
  seasons: () => `🌦 ${t("Sesongit ja kriisit")}`,
  advisors: () => `👥 ${t("Neuvonantajat")}`,
  market: () => `🌍 ${t("Markkinatieto")}`,
  widgets: () => `🧩 ${t("Widgetit")}`,
  actuals: () => `📊 ${t("Toteuma")}`,
  report: () => `📄 ${t("Raportti")}`,
};

function langToggle(): string {
  return `<div class="fl-lang" role="group" aria-label="${esc(t("Kieli"))}">${(["fi", "en"] as Locale[])
    .map((l) => `<button class="fl-lang-btn" data-action="set-locale" data-locale="${l}" aria-pressed="${getLocale() === l}">${l.toUpperCase()}</button>`)
    .join("")}</div>`;
}

function presetsDropdownHtml(): string {
  const items = (Object.keys(PRESET_LABELS) as PresetId[])
    .map(
      (p) =>
        `<button data-action="preset" data-preset="${p}" title="${esc(t(PRESET_LABELS[p].hint))}">${esc(
          t(PRESET_LABELS[p].title),
        )}</button>`,
    )
    .join("");
  return `<details class="fl-menu"><summary class="fl-btn ghost">${esc(t("Lataa esimerkkidata"))} ▾</summary><div class="fl-menu-body">${items}</div></details>`;
}

function renderOnboarding(): void {
  canvas?.destroy();
  canvas = null;
  document.documentElement.lang = getLocale();
  const personas = PERSONAS.map(
    (p) => `<button class="ob-persona ${state.persona === p.id ? "on" : ""}" data-action="set-persona" data-persona="${p.id}" aria-pressed="${state.persona === p.id}" title="${esc(t(p.hint))}">${esc(t(p.title))}</button>`,
  ).join("");
  const maturityButtons = ([0, 1, 2, 3] as VentureMaturity[])
    .map(
      (lvl) => `<button
        class="maturity-pill ${state.maturity === lvl ? "active" : ""}"
        data-action="set-onboarding-maturity"
        data-maturity="${lvl}"
        aria-pressed="${state.maturity === lvl}"
        title="${esc(t(MATURITY_HINTS[lvl]))}"
      >${esc(t(MATURITY_LABELS[lvl]))}</button>`,
    )
    .join("");
  const kinds = (Object.keys(ATOM_KIND_LABELS) as AtomKind[])
    .map((k) => {
      const on = state.onboardingKinds.has(k);
      return `<button class="ob-card ${on ? "on" : ""}" data-action="toggle-kind" data-kind="${k}" aria-pressed="${on}">
        <b>${esc(t(ATOM_KIND_LABELS[k].title))}</b><span>${esc(t(ATOM_KIND_LABELS[k].hint))}</span></button>`;
    })
    .join("");
  const tasks = TASKS.map((d) => `<button class="ob-preset" data-action="task-start" data-id="${d.id}"><b>${state.completedTasks.includes(d.id) ? "✅ " : "🎯 "}${esc(t(d.title))}</b><span>${esc(t(d.brief))}</span></button>`).join("");
  root.innerHTML = `
  <header class="fl-header">
    <div class="fl-brand">APEX <b>Studio</b> <span class="v3-badge">v3.2</span></div>
    <div class="fl-header-actions">${langToggle()}${presetsDropdownHtml()}<a href="/classic" class="fl-back">${esc(t("Klassinen näkymä"))}</a></div>
  </header>
  <main class="ob-main">
    <div class="ob-step">${esc(t("1. Rooli ja lähtötilanteen kypsyystaso"))}</div>
    <div class="ob-personas">${personas}</div>
    <div class="ob-row" style="margin:10px 0 18px;gap:10px;flex-wrap:wrap">
      <div class="cmd-maturity-group" role="group" aria-label="${esc(t("Yrityksen kypsyystaso"))}">${maturityButtons}</div>
      <button class="ob-start" data-action="start-blank">${esc(t("Avaa puhdas kanvaasi (Tabula Rasa) →"))}</button>
    </div>
    <h1>${esc(t("2. Tai kuvaile organisaatio, prosessi tai liikeidea omin sanoin"))}</h1>
    <p class="ob-lead">${esc(t("Kuvaile minkä tahansa toimialan organisaatio, yksikkö, tuote tai palveluketju. APEX jäsentää siitä kyvykkyydet ja prosessigraafin."))}</p>
    <textarea id="ob-idea" class="ob-idea" rows="3" maxlength="2000" placeholder="${esc(t("Kuvaile mikä tahansa organisaatio, yksikkö, tuote tai liikeidea omin sanoin — tai aloita suoraan tyhjältä kanvaasilta."))}">${esc(state.onboardingIdea)}</textarea>
    <div class="ob-row">
      <button class="ob-start" data-action="genesis" ${state.genesisBusy ? "disabled" : ""}>${state.genesisBusy ? esc(t("Rakennetaan…")) : esc(t("Rakenna malli →"))}</button>
      <span class="fd-note">${esc(state.llm ? t("Kielimalli käytössä") : t("Ilman kielimallia: tunnistan toimialan avainsanoista"))}</span>
    </div>
    <h2>${esc(t("3. Tai valitse universaalit fysiikkamoduulit"))}</h2>
    <label class="ob-name">${esc(t("Yrityksen nimi"))} <input id="ob-name" value="${esc(state.onboardingName)}" placeholder="${esc(t("esim. Uusi organisaatio tai liiketoimintayksikkö"))}"/></label>
    <div class="ob-cards">${kinds}</div>
    <button class="ob-start secondary" data-action="start" ${state.onboardingKinds.size === 0 ? "disabled" : ""}>${esc(t("Rakenna yritykseni →"))}</button>
    ${
      state.persona === "student"
        ? `<h2>${esc(t("Harjoitustehtävät"))}</h2><div class="ob-presets">${tasks}</div>`
        : `<details style="margin-top:20px"><summary class="fd-note" style="cursor:pointer">${esc(t("Harjoitustehtävät"))} (${TASKS.length})</summary><div class="ob-presets" style="margin-top:10px">${tasks}</div></details>`
    }
    <p class="ob-foot">${esc(t("Kaikki luvut ovat muokattavia oletuksia. Laskelmat ilman arvonlisäveroa. Malli tallentuu vain tähän selaimeen."))}</p>
  </main>`;
}

function renderShell(): void {
  const m = state.molecule!;
  const p = personaDef(state.persona);
  document.documentElement.lang = getLocale();
  const personaOptions = PERSONAS.map((x) => `<option value="${x.id}" ${x.id === state.persona ? "selected" : ""}>${esc(t(x.title))}</option>`).join("");
  const lensButtons = p.lensPicker
    ? `<div class="fl-lens" role="group" aria-label="${esc(t("Näkökulma"))}">${(Object.keys(LENS_LABELS) as LensId[])
        .map((l) => `<button class="fl-lens-btn" data-action="set-lens" data-lens="${l}" aria-pressed="${state.lens === l}">${esc(t(LENS_LABELS[l]))}</button>`)
        .join("")}</div>`
    : "";
  const maturityButtons = ([0, 1, 2, 3] as VentureMaturity[])
    .map(
      (lvl) => `<button
        class="maturity-pill ${state.maturity === lvl ? "active" : ""}"
        data-action="set-maturity"
        data-maturity="${lvl}"
        aria-pressed="${state.maturity === lvl}"
        title="${esc(t(MATURITY_HINTS[lvl]))}"
      >${esc(t(MATURITY_LABELS[lvl]))}</button>`,
    )
    .join("");
  const xrayButtons = (Object.keys(XRAY_LENS_LABELS) as XRayLensId[])
    .map(
      (xl) => `<button
        class="xray-pill ${state.xrayLens === xl ? "active" : ""}"
        data-action="set-xray-lens"
        data-xray="${xl}"
        aria-pressed="${state.xrayLens === xl}"
      >${esc(t(XRAY_LENS_LABELS[xl]))}</button>`,
    )
    .join("");
  const primary = p.tools.filter((x) => ALL_TOOLS.includes(x));
  const rest = ALL_TOOLS.filter((x) => !primary.includes(x));
  const toolBtn = (id: string) => `<button class="fl-tool" data-action="open" data-node="${id}">${esc(TOOL_LABELS[id]())}</button>`;

  root.innerHTML = `
  <header class="fl-header zone-command-bar" aria-label="${esc(t("Zone 1 · Komentopalkki"))}">
    <div class="fl-brand">APEX <b>Studio</b> <span class="v3-badge">v3.2</span></div>
    <input class="fl-name" data-rename-molecule value="${esc(m.name)}" aria-label="${esc(t("Yrityksen nimi"))}"/>

    <div class="cmd-search-wrap">
      <input
        id="fl-entity-search"
        type="search"
        class="cmd-search-input"
        value="${esc(state.searchQuery)}"
        placeholder="${esc(t("Hae apex:// solmuja, kertoimia, rooleja, tilejä…"))}"
        aria-label="${esc(t("Globaali entiteettihaku"))}"
      />
      <div id="fl-search-results" class="cmd-search-dropdown" hidden></div>
    </div>

    <div class="cmd-maturity-group" role="group" aria-label="${esc(t("Yrityksen kypsyystaso"))}">
      ${maturityButtons}
    </div>

    <div class="cmd-xray-group" role="group" aria-label="${esc(t("Röntgenlinssi"))}">
      ${xrayButtons}
    </div>

    <div class="cmd-zoom-group" role="group" aria-label="${esc(t("Semanttinen zoom"))}">
      <button class="zoom-pill ${zoomLevelForPercent(state.zoomPct) === 0 ? "active" : ""}" data-action="set-zoom" data-zoom="15" title="${esc(t("L0 (< 25 %) · Koko yritys"))}">L0</button>
      <button class="zoom-pill ${zoomLevelForPercent(state.zoomPct) === 1 ? "active" : ""}" data-action="set-zoom" data-zoom="45" title="${esc(t("L1 (25–60 %) · Arvovirta ja tuki"))}">L1</button>
      <button class="zoom-pill ${zoomLevelForPercent(state.zoomPct) === 2 ? "active" : ""}" data-action="set-zoom" data-zoom="80" title="${esc(t("L2+ (> 60 %) · Tarkenna solmuun"))}">L2+</button>
    </div>

    <div class="fl-header-actions">
      ${langToggle()}
      <label class="fl-persona">${esc(t("Rooli"))} <select data-persona-select aria-label="${esc(t("Rooli"))}">${personaOptions}</select></label>
      ${presetsDropdownHtml()}
      <button class="fl-btn ghost" data-action="undo" id="fl-undo" title="${esc(t("Kumoa viimeisin muutos"))}" ${state.undo.length ? "" : "disabled"}>↶ ${esc(t("Kumoa"))}</button>
      <button class="fl-btn ${p.launchpad ? "primary" : ""}" data-action="open" data-node="launchpad">🚀 ${esc(t("Perustamislista"))} <span class="fl-badge" id="fl-lp-count"></span></button>
      <details class="fl-menu"><summary class="fl-btn ghost">⋯</summary><div class="fl-menu-body">
        <a href="/classic">${esc(t("Klassinen näkymä"))}</a>
        <button data-action="reset">${esc(t("Aloita alusta"))}</button>
      </div></details>
    </div>
  </header>
  <div class="fl-subheader" id="fl-subheader">${lensButtons}<div class="fl-goals" id="fl-goals"></div><div class="fl-boundary" id="fl-boundary"></div></div>
  <nav class="fl-toolbar" aria-label="${esc(t("Työkalut"))}">${primary.map(toolBtn).join("")}${
    rest.length ? `<details class="fl-menu"><summary class="fl-tool">${esc(t("Lisää työkaluja"))} ▾</summary><div class="fl-menu-body">${rest.map(toolBtn).join("")}</div></details>` : ""
  }</nav>
  <div class="unified-studio-grid">
    <div id="fl-zone-navigator" class="studio-zone-nav"></div>
    <main class="fl-main studio-zone-center">
      <section class="fl-stage" aria-label="${esc(t("Zone 3 · Kanvaasi"))}">
        <div id="fl-task"></div>
        <div class="fl-headlines" id="fl-headlines"></div>
        <div id="fl-coach"></div>
        <div id="fl-widgets"></div>
        ${p.quickStress ? `<div class="fl-quickstress"><span>${esc(t("Stressitesti:"))}</span>
          <button class="fd-chip small" data-action="stress" data-volume="-0.25">${esc(t("Myynti −25 %"))}</button>
          <button class="fd-chip small" data-action="stress" data-price="-0.1">${esc(t("Hinnat −10 %"))}</button>
          <button class="fd-chip small" data-action="stress" data-fixed="0.15">${esc(t("Kiinteät kulut +15 %"))}</button>
          <button class="fd-chip small" data-action="stress" data-variable="0.2">${esc(t("Ostohinnat +20 %"))}</button></div>` : ""}
        <div id="fl-icom-deck" class="icom-canvas-wrap"></div>
        <div class="fl-canvas" id="fl-canvas" ${state.maturity <= 1 ? "hidden" : ""}></div>
      </section>
    </main>
    <aside class="fl-side studio-zone-inspector" aria-label="${esc(t("Zone 4 · Tarkastin"))}">
      <div id="fl-zone-inspector"></div>
      <details class="legacy-levers-accordion">
        <summary>${esc(t("Pikavivut (kaikki virrat)"))}</summary>
        <div id="fl-levers"></div>
      </details>
    </aside>
  </div>
  <div id="fl-zone-timeline" class="studio-zone-timeline"></div>
  <div id="fl-toast" class="fl-toast" role="status" aria-live="polite"></div>
  <input type="file" id="fl-import-file" accept=".csv,text/csv,.txt" hidden/>
  <div id="fl-drawer-backdrop" class="fl-drawer-backdrop" data-action="close-drawer" hidden></div>
  <aside id="fl-drawer" class="fl-drawer" aria-hidden="true"></aside>`;
  canvas?.destroy();
  canvas = new FlowCanvas($("#fl-canvas")!, (id) => {
    state.selectedNodeId = id;
    openDrawer(id);
  });
}

const HEADLINE_TARGETS: Record<LensId, NodeId[]> = {
  all: ["costs", "cash", "demand"],
  finance: ["costs", "cash", "demand"],
  sales: ["demand", "demand", "capacity"],
  operations: ["capacity", "costs", "costs"],
};

function renderHeadlines(v: FlowView): void {
  const targets = HEADLINE_TARGETS[state.lens];
  const headlines =
    state.maturity <= 1 && state.graphState
      ? maturityHeadlines(state.graphState.graph, state.graphState.run)
      : lensHeadlines(v, state.lens);
  $("#fl-headlines")!.innerHTML = headlines
    .map(
      (h, i) => `<button class="fl-headline st-${h.status}" data-action="open" data-node="${targets[i] ?? "demand"}">
        <span class="fl-hl-label">${esc(h.label)}</span>
        <span class="fl-hl-value">${esc(h.value)}</span>
        <span class="fl-hl-sub">${esc(h.sub)}</span>
      </button>`,
    )
    .join("");
  const statuses = evaluateGoals(v, state.goals).filter((s) => state.lens === "all" || s.goal.lens === state.lens);
  const goalsEl = $("#fl-goals");
  if (goalsEl) {
    goalsEl.innerHTML = statuses
      .map((s) => `<button class="fl-goal ${s.ok ? "ok" : s.ok === false ? "bad" : ""}" data-action="open" data-node="goals">${s.ok ? "✓" : s.ok === false ? "✗" : "○"} ${esc(s.label)}</button>`)
      .join("");
  }
  const boundary = $("#fl-boundary");
  if (boundary) {
    const msgs = [...boundaryMessages(v, state.lens), ...brokenGoalMessages(statuses, state.lens)];
    boundary.innerHTML = msgs.map((x) => `<span>↔ ${esc(x)}</span>`).join("");
  }
  const sub = $("#fl-subheader");
  if (sub) sub.hidden = !personaDef(state.persona).lensPicker && statuses.length === 0;
}

function renderLevers(): void {
  const m = state.molecule!;
  const levers = leversForLens(leversFor(m), state.lens);
  const visible = state.showAllLevers ? levers : levers.filter((l) => l.primary);
  const groups = new Map<string, Lever[]>();
  for (const l of visible) {
    if (!groups.has(l.group)) groups.set(l.group, []);
    groups.get(l.group)!.push(l);
  }
  const html = [...groups.entries()]
    .map(
      ([g, ls]) => `<div class="lv-group"><div class="lv-group-title">${esc(g)}</div>${ls
        .map((l) => {
          const prov = getProvenance(m, l.id);
          return `<div class="lv-row">
            <div class="lv-top"><label for="lv-${esc(l.id)}">${esc(t(l.label))} <span class="pv pv-${prov?.source ?? "preset"}" title="${esc(t("Lähde: {source}", { source: sourceLabel(prov) }))}${prov?.note ? esc(` – ${prov.note}`) : ""}">●</span></label><output id="lvo-${esc(l.id)}">${esc(formatLever(l, l.value))}</output></div>
            <input type="range" id="lv-${esc(l.id)}" data-lever="${esc(l.id)}" min="${l.min}" max="${l.max}" step="${l.step}" value="${l.value}"/>
            ${l.hint ? `<div class="lv-hint">${esc(t(l.hint))}</div>` : ""}
          </div>`;
        })
        .join("")}</div>`,
    )
    .join("");
  const hidden = levers.length - levers.filter((l) => l.primary).length;
  $("#fl-levers")!.innerHTML = `${html || `<p class="fd-note">${esc(t("Tällä näkökulmalla ei ole vipuja."))}</p>`}${
    hidden > 0 ? `<button class="fl-btn ghost wide" data-action="toggle-levers">${esc(state.showAllLevers ? t("Näytä vain tärkeimmät") : t("Lisää vipuja ({n})", { n: hidden }))}</button>` : ""
  }
  <p class="fd-note pv-legend"><span class="pv pv-user">●</span> ${esc(t("oma arvio"))} <span class="pv pv-preset">●</span> ${esc(t("oletus"))} <span class="pv pv-coach">●</span> ${esc(t("valmentaja"))} <span class="pv pv-import">●</span> ${esc(t("tiliote"))} <span class="pv pv-market">●</span> ${esc(t("markkinatieto"))}</p>`;
}

function widgetContext() {
  return {
    molecule: state.molecule!,
    view: state.view!,
    scope: buildScope(state.molecule!, state.view!, state.graphState?.graph),
    graph: state.graphState?.graph,
  };
}

function renderWidgetsNow(): void {
  const host = $("#fl-widgets");
  if (!host || !state.molecule || !state.view) return;
  const active = document.activeElement as HTMLInputElement | null;
  if (state.leverDragging && active && host.contains(active)) {
    // Vivun veto käynnissä widgetissä: päivitetään vain luvut, ettei liukusäädin katkea.
    host.querySelectorAll<HTMLOutputElement>("[data-widget-out]").forEach((o) => {
      const input = host.querySelector<HTMLInputElement>(`[data-widget-id="${o.dataset.widgetOut}"]`);
      if (input) o.textContent = formatWidgetValue(Number(input.value), input.dataset.widgetFmt as WidgetFormat);
    });
    return;
  }
  host.innerHTML = renderWidgetStrip(state.widgets, widgetContext());
}

function taskProgress(): { done: boolean; progress: string } | null {
  if (!state.task || !state.molecule || !state.view) return null;
  const def = TASKS.find((d) => d.id === state.task!.id);
  return def ? def.check(state.molecule, state.view, state.task.start) : null;
}

function renderTimelineNow(): void {
  if (!state.view) return;
  const overlays: TimelineOverlay[] = state.scenarios
    .map((s, i) => ({ s, i }))
    .filter(({ s }) => s.compare)
    .map(({ s, i }) => ({ name: s.name, color: SCENARIO_COLORS[i % SCENARIO_COLORS.length], cash: simulate(s.molecule).days.map((d) => d.cash) }));
  const tl = $("#fl-timeline");
  if (tl) tl.innerHTML = renderTimeline(state.view, state.day, overlays);
  const range = $<HTMLInputElement>("#fl-day");
  if (range && Number(range.value) !== state.day) range.value = String(state.day);
  canvas?.setDay(state.day);
}

/** Säilyttää fokuksen ja kursorin, kun paneelin HTML piirretään uudelleen. */
function withPreservedFocus(container: HTMLElement, render: () => void): void {
  const active = document.activeElement as HTMLInputElement | null;
  let selector: string | null = null;
  if (active && container.contains(active)) {
    if (active.id) selector = `#${CSS.escape(active.id)}`;
    else {
      for (const attr of Array.from(active.attributes)) {
        if (attr.name.startsWith("data-")) {
          selector = `[${attr.name}="${CSS.escape(attr.value)}"]`;
          break;
        }
      }
    }
  }
  const sel = active && typeof active.selectionStart === "number" ? active.selectionStart : null;
  const scroll = container.scrollTop;
  render();
  container.scrollTop = scroll;
  if (selector) {
    const el = container.querySelector<HTMLInputElement>(selector);
    if (el) {
      el.focus();
      if (sel !== null && el.type === "text") el.setSelectionRange(sel, sel);
    }
  }
}

function panelHtml(panel: PanelId): string {
  const m = state.molecule!;
  const v = state.view!;
  const teach = personaDef(state.persona).teach;
  switch (panel) {
    case "launchpad":
      return renderLaunchpad(checklistView(m, v, state.checklist), {
        graphLp: state.graphState ? buildGraphLaunchpadView(state.graphState.graph, state.checklist) : undefined,
        architectSpec: moleculeToGenesisSpec(m, state.maturity, "user"),
        activeTemplateId: state.graphOverrides.templateId,
      });
    case "coach":
      return renderCoachPanel(state.insights, state.chat, teach, state.chatBusy);
    case "import": {
      const d = state.importData;
      return renderImportPanel(m, d?.analysis ?? null, d?.selection ?? { costKeys: [], calibrateRevenue: false, useBalance: false, saveActuals: false }, v.monthlyRevenue, d?.analysis ? null : d?.error ?? t("Tiliotetta ei ole valittu."));
    }
    case "widgets":
      return renderWidgetPanel(state.widgets, widgetContext(), { llm: state.llm, ...state.widgetPanel });
    case "scenarios":
      return renderScenarios(m, state.scenarios, state.mc, state.mcRanges);
    case "founder":
      return renderFounder(m);
    case "goals":
      return renderGoals(v, state.goals);
    case "seasons":
      return renderSeasons(m, v);
    case "report":
      state.report = buildReport({
        molecule: m,
        checklist: state.checklist,
        scenarios: state.scenarios,
        graph: state.graphState?.graph,
      });
      return renderReport(state.report);
    case "actuals":
      return renderActuals(v, state.actuals);
    case "tasks":
      return renderTasks(state.task, state.completedTasks, taskProgress());
    case "market":
      return renderMarket(m, state.market, state.llm);
    case "advisors":
      return renderAdvisors(ruleAdvisors(m, v, state.insights), state.advisors, state.llm);
    default:
      return renderDrawer(panel, { view: v, stress: state.stress });
  }
}

function renderDrawerNow(): void {
  const drawer = $("#fl-drawer");
  const backdrop = $("#fl-drawer-backdrop");
  if (!drawer || !backdrop) return;
  if (!state.drawer || !state.view || !state.molecule) {
    drawer.classList.remove("open");
    drawer.setAttribute("aria-hidden", "true");
    backdrop.hidden = true;
    return;
  }
  const panel = state.drawer;
  withPreservedFocus(drawer, () => {
    drawer.innerHTML = panelHtml(panel);
  });
  drawer.classList.toggle("wide", panel === "report" || panel === "scenarios" || panel === "advisors");
  if (panel === "coach") {
    const log = $("#co-log");
    if (log) log.scrollTop = log.scrollHeight;
  }
  drawer.classList.add("open");
  drawer.setAttribute("aria-hidden", "false");
  backdrop.hidden = false;
}

/** Laskee näkymän uudelleen ja päivittää kaikki 5 vyöhykettä (Zones 1–5) < 16 ms vasteajalla. */
function refresh(opts: { levers?: boolean; persist?: boolean } = {}): void {
  if (!state.molecule) {
    renderOnboarding();
    return;
  }
  state.view = buildView(state.molecule);
  state.graphState = buildStudioGraphState(
    state.molecule,
    state.maturity,
    state.decomposedUris,
    state.graphOverrides,
  );
  if (!state.graphState.registry.entities.has(state.selectedUri)) {
    const firstVal = Object.values(state.graphState.graph.nodes).find((n) => n.level === 1 && n.band === "value_stream");
    state.selectedUri = firstVal ? firstVal.uri : state.graphState.graph.root;
  }

  const lp = checklistView(state.molecule, state.view, state.checklist);
  state.insights = coachInsights(state.molecule, state.view, lp, state.persona);
  renderHeadlines(state.view);
  const coach = $("#fl-coach");
  if (coach) coach.innerHTML = renderCoachStrip(state.insights, personaDef(state.persona).teach);
  renderWidgetsNow();
  const progress = taskProgress();
  const taskEl = $("#fl-task");
  if (taskEl) taskEl.innerHTML = renderTaskBanner(state.task, progress);
  if (progress?.done && state.task && !state.completedTasks.includes(state.task.id)) {
    state.completedTasks.push(state.task.id);
    showToast(`🎉 ${t("Tehtävä ratkaistu!")}`);
    opts.persist = true;
  }

  // Zone 2 · Navigaattori
  const navHost = $("#fl-zone-navigator");
  if (navHost) {
    navHost.innerHTML = renderNavigatorZone(state.graphState, {
      selectedUri: state.selectedUri,
      spotlightParentUri: state.spotlightParentUri,
      collapsed: state.navigatorCollapsed,
    });
  }

  // Zone 3 · ICOM / Capability Map + Elävä virtakanvaasi
  const icomHost = $("#fl-icom-deck");
  if (icomHost) {
    icomHost.innerHTML = renderIcomProcessOverlayHtml(state.graphState.graph, state.graphState.run, {
      zoomPct: state.zoomPct,
      xrayLens: state.xrayLens,
      selectedUri: state.selectedUri,
      spotlightParentUri: state.spotlightParentUri,
      scopeRootUri: state.graphOverrides.scopeRootUri ?? null,
    });
  }
  const canvasHost = $("#fl-canvas");
  if (canvasHost) canvasHost.hidden = state.maturity <= 1;

  canvas?.update(state.view);
  canvas?.setFocus(lensNodes(state.lens));

  // Zone 4 · 6-välilehtinen Inspector
  const insHost = $("#fl-zone-inspector");
  if (insHost) {
    withPreservedFocus(insHost, () => {
      insHost.innerHTML = renderInspectorZone(state.graphState!, state.view!, {
        selectedUri: state.selectedUri,
        selectedNodeId: state.selectedNodeId,
        activeTab: state.inspectorTab,
        persona: state.persona,
        lens: state.lens,
        teach: personaDef(state.persona).teach,
      });
    });
  }

  // Zone 5 · Aikajana ja Git-skenaariohaarat
  const tlZone = $("#fl-zone-timeline");
  if (tlZone) {
    tlZone.innerHTML = renderTimelineBranchZone(state.graphState, state.view, {
      hoverDay: state.day,
      scenarios: state.scenarios,
      compareScenarioId: state.scenarios.find((s) => s.compare)?.id ?? null,
    });
  }
  renderTimelineNow();

  if (opts.levers) renderLevers();
  else updateLeverOutputs();
  const badge = $("#fl-lp-count");
  if (badge) badge.textContent = `${lp.done}/${lp.total}`;
  if (state.drawer) renderDrawerNow();
  updateUndoButton();
  if (opts.persist) save();
}

function updateLeverOutputs(): void {
  if (!state.molecule) return;
  for (const l of leversFor(state.molecule)) {
    root.querySelectorAll(`#lvo-${CSS.escape(l.id)}`).forEach((out) => {
      out.textContent = formatLever(l, l.value);
    });
  }
}

function openDrawer(id: PanelId): void {
  state.drawer = id;
  if (id !== "cash") state.stress = null;
  root.querySelectorAll<HTMLDetailsElement>("details.fl-menu[open]").forEach((d) => (d.open = false));
  renderDrawerNow();
  if (id === "coach") $<HTMLInputElement>("#co-input")?.focus();
}

function closeDrawer(): void {
  state.drawer = null;
  state.stress = null;
  renderDrawerNow();
}

function setMolecule(m: Molecule, structural = false): void {
  if (m === state.molecule) return;
  pushUndo();
  state.molecule = m;
  state.stress = null;
  refresh({ levers: structural, persist: true });
}

function startMolecule(m: Molecule, keepTask = false, hasPresetModel = true, explicitMaturity?: VentureMaturity): void {
  const pDef = personaDef(state.persona);
  state.molecule = m;
  state.checklist = emptyChecklist();
  state.undo = [];
  state.chat = [];
  state.mc = null;
  state.market.result = null;
  state.advisors.result = null;
  if (!keepTask) state.task = null;
  state.lens = pDef.defaultLens;
  state.xrayLens = pDef.defaultXRayLens;
  state.maturity = explicitMaturity ?? defaultMaturityForPersona(state.persona, hasPresetModel);
  state.zoomPct = pDef.defaultZoom;
  state.inspectorTab = pDef.inspectorTabs[0] ?? "physics";
  state.spotlightParentUri = null;
  state.decomposedUris.clear();
  state.graphOverrides = { customBizCaps: [], bizCapStatuses: {}, customPorts: {} };
  state.day = 0;
  state.drawer = null;
  save();
  renderShell();
  refresh({ levers: true });
  play();
}

function runStress(s: StressInput): void {
  if (!state.molecule) return;
  state.stress = stressTest(state.molecule, s);
  state.drawer = "cash";
  renderDrawerNow();
}

/** Soveltaa komennot (validoidaan aina uudelleen). */
function runCommands(raw: unknown[], opts: ApplyOptions = {}): string[] {
  if (!state.molecule) return [];
  const r = applyCommands(state.molecule, state.checklist, raw, opts);
  if (r.molecule !== state.molecule || r.checklist !== state.checklist) {
    pushUndo();
    state.molecule = r.molecule;
    state.checklist = r.checklist;
    state.stress = null;
    refresh({ levers: true, persist: true });
  }
  if (r.stress) runStress(r.stress);
  else if (r.openPanel && state.drawer !== "coach") openDrawer(r.openPanel);
  return r.applied;
}

// ---------------------------------------------------------------------------
// Palvelinkutsut
// ---------------------------------------------------------------------------

async function post<T>(url: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, locale: getLocale() }) });
  const data = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `HTTP ${res.status}`);
  return data;
}

async function sendChat(text: string): Promise<void> {
  const message = text.trim();
  if (!message || !state.molecule || state.chatBusy) return;
  const history = state.chat.filter((c) => !c.pending).slice(-10).map((c) => ({ role: c.role, text: c.text }));
  state.chat.push({ role: "user", text: message });
  state.chat.push({ role: "coach", text: t("Mietin…"), pending: true });
  state.chatBusy = true;
  renderDrawerNow();
  let reply: ChatMessage;
  try {
    const data = await post<{ reply: string; commands?: unknown[]; source?: "llm" | "rules"; note?: string }>("/api/flow/chat", {
      message,
      molecule: state.molecule,
      checklist: state.checklist,
      persona: state.persona,
      history,
    });
    const applied = runCommands(Array.isArray(data.commands) ? data.commands : [], { source: "coach" });
    reply = { role: "coach", text: data.reply, applied, note: data.note, source: data.source };
  } catch (err) {
    reply = { role: "coach", text: t("Valmentajaan ei saatu yhteyttä ({error}). Malli ei muuttunut.", { error: (err as Error).message }) };
  }
  state.chat = state.chat.filter((c) => !c.pending);
  state.chat.push(reply);
  state.chatBusy = false;
  save();
  if (state.drawer !== "coach") state.drawer = "coach";
  renderDrawerNow();
  $<HTMLInputElement>("#co-input")?.focus();
}

async function runGenesis(): Promise<void> {
  const idea = state.onboardingIdea.trim();
  if (!idea || state.genesisBusy) return;
  state.genesisBusy = true;
  renderOnboarding();
  let molecule: Molecule;
  let notes: string[] = [];
  try {
    const data = await post<{ molecule: Molecule; notes: string[] }>("/api/flow/genesis", { idea });
    if (!isMolecule(data.molecule)) throw new Error("?");
    molecule = data.molecule;
    notes = data.notes ?? [];
  } catch {
    // Palvelin ei vastannut: sama sääntöpohjainen tulkki toimii myös selaimessa.
    const r = ideaToMolecule(idea);
    molecule = r.molecule;
    notes = r.notes;
  }
  state.genesisBusy = false;
  state.onboardingIdea = "";
  startMolecule(molecule);
  if (notes.length) {
    state.chat.push({ role: "coach", text: `${t("Rakensin mallin liikeideastasi.")} ${notes.join(" ")}` });
    save();
  }
  showToast(t("Malli rakennettu. Säädä luvut omiksesi vivuista."));
}

async function createAiWidget(prompt: string): Promise<void> {
  if (!prompt.trim() || !state.molecule || state.widgetPanel.busy) return;
  state.widgetPanel = { busy: true, error: null, lastPrompt: prompt };
  renderDrawerNow();
  try {
    const data = await post<{ widgets: unknown[]; error: string | null }>("/api/flow/widget", { prompt, molecule: state.molecule });
    // Tarkistetaan uudelleen selaimessa: palvelimen vastaukseenkaan ei luoteta sokeasti.
    const specs = (data.widgets ?? []).map((w) => validateWidget(w, state.molecule!, state.view!, "ai", prompt)).flatMap((v) => (v.spec ? [v.spec] : []));
    if (specs.length === 0) throw new Error(data.error ?? "?");
    pushUndo();
    state.widgets = [...state.widgets, ...specs];
    state.widgetPanel = { busy: false, error: data.error, lastPrompt: "" };
    refresh({ persist: true });
    showToast(t("Widgetti lisätty: {title}", { title: specs.map((x) => x.title).join(", ") }));
  } catch (err) {
    state.widgetPanel = { busy: false, error: (err as Error).message, lastPrompt: prompt };
    renderDrawerNow();
  }
}

async function runMarket(query: string): Promise<void> {
  if (!state.molecule || state.market.busy) return;
  state.market = { ...state.market, busy: true, error: null, query };
  renderDrawerNow();
  try {
    const data = await post<MarketState["result"] & { error?: string }>("/api/flow/market", { query, molecule: state.molecule });
    state.market = { busy: false, error: data?.error ?? null, query, result: data };
  } catch (err) {
    state.market = { busy: false, error: (err as Error).message, query, result: null };
  }
  renderDrawerNow();
}

async function askAdvisors(question: string): Promise<void> {
  if (!state.molecule || state.advisors.busy) return;
  state.advisors = { ...state.advisors, busy: true, question };
  renderDrawerNow();
  try {
    const data = await post<NonNullable<AdvisorsState["result"]>>("/api/flow/advisors", { question, molecule: state.molecule, persona: state.persona });
    state.advisors = { busy: false, question, result: data };
  } catch (err) {
    state.advisors = { busy: false, question, result: { statements: [], consensus: (err as Error).message, proposals: [], source: "rules" } };
  }
  renderDrawerNow();
}

// ---------------------------------------------------------------------------
// Tiliotteen tuonti (käsitellään vain selaimessa)
// ---------------------------------------------------------------------------

async function readStatementFile(file: File): Promise<void> {
  const fail = (error: string) => {
    state.importData = { analysis: null, selection: { costKeys: [], calibrateRevenue: false, useBalance: false, saveActuals: false }, error };
    openDrawer("import");
  };
  if (file.size > 5 * 1024 * 1024) return fail(t("Tiedosto on liian suuri (yli 5 Mt)."));
  if (/\.pdf$/i.test(file.name)) return fail(t("PDF-tiliotteita ei vielä tueta."));
  const buf = await file.arrayBuffer();
  let text = new TextDecoder("utf-8").decode(buf);
  // Monet pankit vievät CSV:n Windows-1252-merkistössä.
  if (text.includes("\uFFFD")) text = new TextDecoder("windows-1252").decode(buf);
  const parsed = parseStatementCsv(text);
  if (parsed.error) return fail(parsed.error);
  const analysis = analyzeStatement(parsed.transactions);
  state.importData = { analysis, selection: defaultSelection(state.molecule!, analysis), error: null };
  openDrawer("import");
}

// ---------------------------------------------------------------------------
// Aikakone: vuoden toisto
// ---------------------------------------------------------------------------

function play(): void {
  if (!state.view) return;
  stop();
  state.playing = true;
  if (state.day >= state.view.sim.days.length - 1) state.day = 0;
  const btn = $("#fl-play");
  if (btn) btn.textContent = `⏸ ${t("Pysäytä")}`;
  let last = 0;
  let acc = state.day;
  const step = (ts: number) => {
    if (!state.playing || !state.view) return;
    const dt = last ? (ts - last) / 1000 : 0;
    last = ts;
    acc += dt * 30;
    const max = state.view.sim.days.length - 1;
    state.day = Math.min(max, Math.floor(acc));
    renderTimelineNow();
    if (state.day >= max) {
      stop();
      return;
    }
    playRaf = requestAnimationFrame(step);
  };
  playRaf = requestAnimationFrame(step);
}

function stop(): void {
  state.playing = false;
  cancelAnimationFrame(playRaf);
  const btn = $("#fl-play");
  if (btn) btn.textContent = `▶ ${t("Toista vuosi")}`;
}

// ---------------------------------------------------------------------------
// Tapahtumat
// ---------------------------------------------------------------------------

function parseNullableNumber(raw: string): number | null {
  const s = raw.trim().replace(",", ".");
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function inputValue(id: string): string {
  return $<HTMLInputElement>(`#${id}`)?.value ?? "";
}

function download(name: string, content: string, type: string): void {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function setLocaleAndRerender(l: Locale): void {
  setLocale(l);
  save();
  if (state.molecule) {
    renderShell();
    refresh({ levers: true });
  } else renderOnboarding();
}

root.addEventListener("click", (ev) => {
  const target = (ev.target as Element).closest<HTMLElement>("[data-action]");
  if (!target) return;
  const action = target.dataset.action;
  const m = state.molecule;
  switch (action) {
    case "set-locale":
      setLocaleAndRerender(target.dataset.locale as Locale);
      return;
    case "set-persona":
      state.persona = target.dataset.persona as PersonaId;
      state.maturity = defaultMaturityForPersona(state.persona, false);
      save();
      renderOnboarding();
      return;
    case "set-onboarding-maturity": {
      const mLvl = Number(target.dataset.maturity) as VentureMaturity;
      if (mLvl === 0 || mLvl === 1 || mLvl === 2 || mLvl === 3) {
        state.maturity = mLvl;
        renderOnboarding();
      }
      return;
    }
    case "start-blank": {
      const mol = emptyMolecule(state.onboardingName.trim() || t("Uusi organisaatio"));
      startMolecule(mol, false, false, state.maturity);
      return;
    }
    case "toggle-kind": {
      const k = target.dataset.kind as AtomKind;
      if (state.onboardingKinds.has(k)) state.onboardingKinds.delete(k);
      else state.onboardingKinds.add(k);
      renderOnboarding();
      return;
    }
    case "genesis":
      void runGenesis();
      return;
    case "start": {
      if (state.onboardingKinds.size === 0) return;
      let mol = emptyMolecule(state.onboardingName.trim() || t("Oma yritys"));
      for (const k of state.onboardingKinds) mol = addAtom(mol, k);
      if (!mol.atoms.some((a) => a.kind === "TIME_CAPACITY" || a.kind === "PHYSICAL_MATTER")) mol = { ...mol, credit: { ...mol.credit, customerTermsDays: 0 } };
      state.onboardingKinds.clear();
      startMolecule(mol);
      return;
    }
    case "preset":
      startMolecule(createPreset(target.dataset.preset as PresetId));
      return;
    case "task-start": {
      const id = target.dataset.id!;
      if (m && !state.task && !confirm(t("Tehtävän aloitus korvaa nykyisen mallin. Jatketaanko?"))) return;
      const start = taskStart(id);
      if (!start) return;
      state.task = { id, start };
      startMolecule(start, true);
      openDrawer("tasks");
      return;
    }
    case "task-exit":
      state.task = null;
      refresh({ persist: true });
      return;
    case "reset":
      if (!confirm(t("Aloitetaanko alusta? Nykyinen malli, muistilista, widgetit, skenaariot ja keskustelu poistetaan tästä selaimesta."))) return;
      stop();
      Object.assign(state, { molecule: null, checklist: emptyChecklist(), chat: [], undo: [], drawer: null, widgets: [], goals: [], scenarios: [], actuals: [], task: null, mc: null });
      save();
      renderOnboarding();
      return;
    case "undo":
      undo();
      return;
    case "set-lens":
      state.lens = target.dataset.lens as LensId;
      root.querySelectorAll<HTMLElement>(".fl-lens-btn").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.lens === state.lens)));
      refresh({ levers: true, persist: true });
      return;
    case "set-maturity": {
      const mLvl = Number(target.dataset.maturity) as VentureMaturity;
      if (mLvl === 0 || mLvl === 1 || mLvl === 2 || mLvl === 3) {
        state.maturity = mLvl;
        if (mLvl === 0) state.spotlightParentUri = null;
        renderShell();
        refresh({ levers: true, persist: true });
      }
      return;
    }
    case "set-xray-lens": {
      const xl = target.dataset.xray as XRayLensId;
      if (xl && xl in XRAY_LENS_LABELS) {
        state.xrayLens = xl;
        root.querySelectorAll<HTMLElement>(".xray-pill").forEach((b) => {
          const active = b.dataset.xray === xl;
          b.classList.toggle("active", active);
          b.setAttribute("aria-pressed", String(active));
        });
        refresh();
      }
      return;
    }
    case "set-zoom": {
      const z = Number(target.dataset.zoom);
      if (Number.isFinite(z)) {
        state.zoomPct = z;
        if (zoomLevelForPercent(z) < 2) {
          state.spotlightParentUri = null;
        } else if (!state.spotlightParentUri && state.graphState) {
          const candidate =
            state.graphState.graph.nodes[state.selectedUri]?.level === 1
              ? state.selectedUri
              : Object.values(state.graphState.graph.nodes).find((n) => n.level === 1 && n.band === "value_stream")?.uri ?? null;
          if (candidate) {
            state.decomposedUris.add(candidate);
            state.spotlightParentUri = candidate;
          }
        }
        root.querySelectorAll<HTMLElement>(".zoom-pill").forEach((b) => {
          b.classList.toggle("active", zoomLevelForPercent(Number(b.dataset.zoom)) === zoomLevelForPercent(state.zoomPct));
        });
        refresh();
      }
      return;
    }
    case "select-entity": {
      const uri = target.dataset.uri as EntityURI | undefined;
      if (uri) {
        state.selectedUri = uri;
        const drop = $("#fl-search-results");
        if (drop) drop.hidden = true;
        refresh();
      }
      return;
    }
    case "spotlight-node": {
      const uri = target.dataset.uri as EntityURI | undefined;
      if (uri) {
        const nodeObj = state.graphState?.graph.nodes[uri];
        // Jos käyttäjä klikkaa Spotlight-painiketta jo avatun alisolmun sisällä tai samassa emosolmussa,
        // toimitaan puhtaana toggle-kytkimenä (poistutaan Spotlightista) luomatta koskaan uusia sisäkkäisiä alisolmuja!
        const effectiveParentUri =
          nodeObj && nodeObj.level >= 2 && nodeObj.parent ? nodeObj.parent : uri;
        if (state.spotlightParentUri === effectiveParentUri) {
          state.spotlightParentUri = null;
          state.zoomPct = 45;
        } else {
          state.decomposedUris.add(effectiveParentUri);
          state.spotlightParentUri = effectiveParentUri;
          state.selectedUri = effectiveParentUri;
          state.zoomPct = 80;
        }
        refresh();
      }
      return;
    }
    case "exit-spotlight":
      state.spotlightParentUri = null;
      state.zoomPct = 45;
      refresh();
      return;
    case "set-root-scope": {
      const uri = target.dataset.uri as EntityURI | undefined;
      if (uri) {
        const rootUri = state.graphState?.graph.root ?? ("apex://node/root" as EntityURI);
        state.graphOverrides.scopeRootUri =
          uri === rootUri || state.graphOverrides.scopeRootUri === uri ? null : uri;
        state.selectedUri = state.graphOverrides.scopeRootUri ?? rootUri;
        refresh();
      }
      return;
    }
    case "rollback-optimistic": {
      const list = state.graphOverrides.optimisticDrafts ?? [];
      if (list.length > 0) {
        list.pop();
        state.graphOverrides.optimisticDrafts = list;
        refresh();
        showToast(t("Luonnossolmu kumottu ja palautettu aiempaan tilaan."));
      }
      return;
    }
    case "select-inspector-tab": {
      const tab = target.dataset.tab as InspectorTabId | undefined;
      if (tab) {
        state.inspectorTab = tab;
        refresh();
      }
      return;
    }
    case "toggle-navigator":
      state.navigatorCollapsed = !state.navigatorCollapsed;
      refresh();
      return;
    case "focus-entity": {
      const uri = target.dataset.uri as EntityURI | undefined;
      if (uri) {
        state.selectedUri = uri;
        showToast(t("Kohdistettu graafiin: {uri}", { uri }));
        refresh();
      }
      return;
    }
    case "cycle-bizcap-status": {
      const uri = target.dataset.uri as EntityURI | undefined;
      if (uri && state.graphState) {
        const cur = state.graphState.graph.businessCapabilities?.[uri]?.status ?? "unclear";
        const next: BusinessCapability["status"] =
          cur === "known" ? "unclear" : cur === "unclear" ? "missing" : "known";
        const stMap = state.graphOverrides.bizCapStatuses ?? (state.graphOverrides.bizCapStatuses = {});
        stMap[uri] = next;
        refresh();
      }
      return;
    }
    case "add-bizcap": {
      const nameInput = $<HTMLInputElement>("#cap-new-name");
      const rawName = nameInput?.value.trim() ?? "";
      if (!rawName) return;
      const customList = state.graphOverrides.customBizCaps ?? (state.graphOverrides.customBizCaps = []);
      const slug = rawName.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || `cap_${Date.now()}`;
      const uri = `apex://capability-biz/custom_${slug}_${customList.length + 1}` as EntityURI;
      customList.push({
        uri,
        name: rawName,
        status: "unclear",
        rationale: t("Käyttäjän lisäämä liiketoimintakyvykkyys"),
        dependsOn: [],
        notes: [],
        canonicalRef: "CUSTOM",
        realizedBy: [],
        provenance: "user",
      });
      if (nameInput) nameInput.value = "";
      state.selectedUri = uri;
      refresh();
      return;
    }
    case "select-cap-template": {
      const tplId = target.dataset.templateId;
      if (tplId) {
        state.graphOverrides.templateId = tplId;
        refresh();
      }
      return;
    }
    case "architect-compile": {
      if (!m) return;
      const s1Name = inputValue("arch-s1-name").trim() || m.name;
      const s6Dso = parseNullableNumber(inputValue("arch-s6-dso")) ?? m.credit.customerTermsDays;
      const s6Dpo = parseNullableNumber(inputValue("arch-s6-dpo")) ?? m.credit.supplierTermsDays;
      const s8Cash = parseNullableNumber(inputValue("arch-s8-cash")) ?? m.credit.openingCash;
      const s8Mat = Math.min(3, Math.max(0, Math.round(parseNullableNumber(inputValue("arch-s8-maturity")) ?? state.maturity))) as VentureMaturity;
      state.maturity = s8Mat;
      pushUndo();
      state.molecule = {
        ...m,
        name: s1Name,
        credit: {
          ...m.credit,
          customerTermsDays: Math.max(0, s6Dso),
          supplierTermsDays: Math.max(0, s6Dpo),
          openingCash: s8Cash,
        },
      };
      renderShell();
      refresh({ levers: true, persist: true });
      showToast(t("8-vaiheinen Architect Mode -spesifikaatio käännetty graafiksi."));
      return;
    }
    case "add-icom-port": {
      const nodeUri = target.dataset.uri as EntityURI | undefined;
      const nameEl = $<HTMLInputElement>("#icom-new-port-name");
      const sideEl = $<HTMLSelectElement>("#icom-new-port-side");
      const portName = nameEl?.value.trim() ?? "";
      const side = (sideEl?.value as Port["side"]) || "I";
      if (!nodeUri || !portName) return;
      const portsMap = state.graphOverrides.customPorts ?? (state.graphOverrides.customPorts = {});
      const list = portsMap[nodeUri] ?? [];
      list.push({
        id: `custom_${side.toLowerCase()}_${list.length + 1}`,
        name: portName,
        side,
        unit: "apex://unit/items",
        ratio: { const: 1 },
      });
      portsMap[nodeUri] = list;
      if (nameEl) nameEl.value = "";
      refresh();
      return;
    }
    case "open": {
      const id = target.dataset.node as PanelId;
      if (PANELS.includes(id)) openDrawer(id);
      return;
    }
    case "close-drawer":
      closeDrawer();
      return;
    case "toggle-levers":
      state.showAllLevers = !state.showAllLevers;
      renderLevers();
      return;
    case "play":
      if (state.playing) stop();
      else play();
      return;
    case "timeline-click": {
      const svg = (ev.target as Element).closest("svg");
      if (!svg || !state.view) return;
      const rect = svg.getBoundingClientRect();
      const ratio = Math.min(1, Math.max(0, (ev.clientX - rect.left) / rect.width));
      stop();
      state.day = Math.round(ratio * (state.view.sim.days.length - 1));
      renderTimelineNow();
      return;
    }
    case "chat-example":
      void sendChat(target.dataset.text ?? "");
      return;
    case "stress":
      runStress({
        volumeChange: target.dataset.volume ? Number(target.dataset.volume) : undefined,
        priceChange: target.dataset.price ? Number(target.dataset.price) : undefined,
        fixedCostChange: target.dataset.fixed ? Number(target.dataset.fixed) : undefined,
        variableCostChange: target.dataset.variable ? Number(target.dataset.variable) : undefined,
      });
      return;
    case "coach-act": {
      const insight = state.insights.find((i) => i.id === target.dataset.insight);
      const act = insight?.actions[Number(target.dataset.idx)];
      if (!act) return;
      const applied = runCommands(act.commands, { source: "coach" });
      if (applied.length) showToast(t("Muutettu: {changes}. Voit kumota ↶", { changes: applied.join(" · ") }));
      return;
    }
    case "import-open":
      $<HTMLInputElement>("#fl-import-file")?.click();
      return;
  }
  if (!m || !state.view) return;
  switch (action) {
    case "add-atom":
      setMolecule(addAtom(m, target.dataset.kind as AtomKind), true);
      return;
    case "remove-atom":
      if (m.atoms.length > 1) setMolecule(removeAtom(m, target.dataset.atom!), true);
      return;
    case "add-fc":
      setMolecule(addFixedCost(m, { label: t("Uusi kulu"), amountPerMonth: 100 }));
      return;
    case "remove-fc":
      setMolecule(removeFixedCost(m, target.dataset.id!));
      return;
    case "set-terms":
      setMolecule(withCustomerTerms(m, Number(target.dataset.days)), true);
      return;
    case "import-apply": {
      const d = state.importData;
      if (!d?.analysis) return;
      const applied = runCommands(importCommands(m, d.analysis, d.selection), { source: "import" });
      if (d.selection.saveActuals) {
        state.actuals = d.analysis.monthly;
        save();
      }
      state.importData = null;
      closeDrawer();
      showToast(applied.length || d.selection.saveActuals ? t("Tiliotteelta lisätty: {n} muutosta. Voit kumota ↶", { n: applied.length }) : t("Ei valittuja muutoksia."));
      return;
    }
    case "actuals-clear":
      state.actuals = [];
      save();
      renderDrawerNow();
      return;
    // --- Widgetit ---
    case "widget-template": {
      const r = widgetFromTemplate(target.dataset.id!, m, state.view);
      if (!r.spec) return showToast(r.error);
      pushUndo();
      state.widgets = [...state.widgets, r.spec];
      refresh({ persist: true });
      return;
    }
    case "widget-toggle":
      pushUndo();
      state.widgets = state.widgets.map((w) => (w.id === target.dataset.id ? { ...w, enabled: !w.enabled } : w));
      refresh({ persist: true });
      return;
    case "widget-delete":
      pushUndo();
      state.widgets = state.widgets.filter((w) => w.id !== target.dataset.id);
      refresh({ persist: true });
      return;
    // --- Skenaariot ---
    case "scenario-save": {
      const name = inputValue("sc-name").trim() || t("Skenaario {n}", { n: state.scenarios.length + 1 });
      state.scenarios = [...state.scenarios, createScenario(name, m)].slice(-10);
      refresh({ persist: true });
      showToast(t("Skenaario tallennettu: {name}", { name }));
      return;
    }
    case "scenario-load": {
      const s = state.scenarios.find((x) => x.id === target.dataset.id);
      if (s) setMolecule(JSON.parse(JSON.stringify(s.molecule)) as Molecule, true);
      return;
    }
    case "scenario-delete":
      state.scenarios = state.scenarios.filter((x) => x.id !== target.dataset.id);
      refresh({ persist: true });
      return;
    case "mc-run":
      state.mc = monteCarlo(m, state.mcRanges, 400, 7);
      renderDrawerNow();
      return;
    // --- Tavoitteet ---
    case "goal-add":
      pushUndo();
      state.goals = [...state.goals, suggestGoal(state.view, target.dataset.metric as GoalMetric)];
      refresh({ persist: true });
      return;
    case "goal-delete":
      pushUndo();
      state.goals = state.goals.filter((g) => g.id !== target.dataset.id);
      refresh({ persist: true });
      return;
    // --- Sesongit ja kriisit ---
    case "season-profile":
      runCommands([{ type: "set_seasonality", factors: SEASON_PROFILES[target.dataset.id as SeasonProfileId].factors }], { source: "user" });
      return;
    case "event-add": {
      const card = CRISIS_LIBRARY.find((c) => c.id === target.dataset.id);
      if (!card) return;
      const month = Number($<HTMLSelectElement>("#ev-month")?.value ?? 2);
      const e = eventFromCard(card, month);
      runCommands([{ type: "add_event", event: { ...e, id: undefined } }], { source: "user" });
      return;
    }
    case "event-random": {
      const r = randomCrisis(Date.now() % 100000);
      const e = eventFromCard(r.card, r.startMonth);
      runCommands([{ type: "add_event", event: { ...e, id: undefined } }], { source: "user" });
      showToast(t("Kriisi: {title}, alkaa kuukautena {month}", { title: e.title, month: e.startMonth + 1 }));
      return;
    }
    case "event-remove":
      runCommands([{ type: "remove_event", id: target.dataset.id }], { source: "user" });
      return;
    // --- Raportti ---
    case "report-download":
      download(`${m.name.replace(/[^\p{L}\p{N}]+/gu, "-").toLowerCase() || "apex"}.md`, state.report || buildReport({ molecule: m, checklist: state.checklist, scenarios: state.scenarios }), "text/markdown;charset=utf-8");
      return;
    case "report-copy":
      void navigator.clipboard?.writeText(state.report).then(() => showToast(t("Raportti kopioitu leikepöydälle.")));
      return;
    case "report-print": {
      const w = window.open("", "_blank");
      if (!w) return;
      w.document.write(`<!DOCTYPE html><html lang="${getLocale()}"><head><meta charset="utf-8"><title>${esc(m.name)}</title><style>body{font:14px/1.5 system-ui,sans-serif;max-width:880px;margin:30px auto;color:#111}table{border-collapse:collapse;width:100%;margin:8px 0}td,th{border:1px solid #ccc;padding:4px 8px;text-align:left}h2{margin-top:28px;border-bottom:2px solid #0e7490}</style></head><body>${markdownToHtml(state.report)}</body></html>`);
      w.document.close();
      w.focus();
      w.print();
      return;
    }
    // --- Markkinatieto ---
    case "market-run":
      void runMarket(inputValue("mk-query"));
      return;
    case "market-apply": {
      const s = state.market.result?.suggestions[Number(target.dataset.idx)];
      if (!s) return;
      const applied = runCommands([{ type: "set_atom_field", atomId: s.atomId, field: s.field, value: s.value }], { source: "market", note: s.rationale, url: s.source?.url });
      if (applied.length) showToast(t("Muutettu: {changes}. Voit kumota ↶", { changes: applied.join(" · ") }));
      return;
    }
    // --- Neuvonantajat ---
    case "adv-ask":
      void askAdvisors(inputValue("adv-q"));
      return;
    case "adv-apply": {
      const p = state.advisors.result?.proposals[Number(target.dataset.idx)];
      if (!p) return;
      const applied = runCommands(p.commands, { source: "coach" });
      if (applied.length) showToast(t("Muutettu: {changes}. Voit kumota ↶", { changes: applied.join(" · ") }));
      return;
    }
    case "adv-rule-act": {
      const adv = ruleAdvisors(m, state.view, state.insights).find((a) => a.role === (target.dataset.role as AdvisorRole));
      const act = adv?.actions[Number(target.dataset.idx)];
      if (act) runCommands(act.commands, { source: "coach" });
      return;
    }
  }
});

root.addEventListener("submit", (ev) => {
  const form = ev.target as HTMLFormElement;
  ev.preventDefault();
  if (form.id === "co-form") {
    const input = $<HTMLInputElement>("#co-input");
    if (!input) return;
    const text = input.value;
    input.value = "";
    void sendChat(text);
  } else if (form.id === "wg-form") {
    void createAiWidget(inputValue("wg-input"));
  }
});

root.addEventListener("input", (ev) => {
  const el = ev.target as HTMLInputElement;
  if (el.id === "ob-name") {
    state.onboardingName = el.value;
    return;
  }
  if (el.id === "ob-idea") {
    state.onboardingIdea = (el as unknown as HTMLTextAreaElement).value;
    return;
  }
  if (el.id === "fl-entity-search") {
    state.searchQuery = el.value;
    const drop = $("#fl-search-results");
    if (!drop || !state.graphState) return;
    const q = el.value.trim();
    if (!q) {
      drop.hidden = true;
      drop.innerHTML = "";
      return;
    }
    const hits = searchEntities(state.graphState.graph, state.graphState.registry, q);
    if (hits.length === 0) {
      drop.innerHTML = `<div class="cmd-search-empty">${esc(t("Ei osumia haulle"))}</div>`;
      drop.hidden = false;
      return;
    }
    drop.innerHTML = hits
      .map(
        (h) => `<button class="cmd-search-item" data-action="select-entity" data-uri="${esc(h.uri)}">
          <span class="csi-kind">${esc(h.kind)}</span>
          <strong class="csi-title">${esc(t(h.title))}</strong>
          <span class="csi-uri">${esc(h.subtitle)}</span>
        </button>`,
      )
      .join("");
    drop.hidden = false;
    return;
  }
  if (el.id === "fl-day") {
    stop();
    state.day = Number(el.value);
    renderTimelineNow();
    return;
  }
  const leverId = el.dataset.lever;
  if (leverId && state.molecule) {
    if (!state.leverDragging) {
      pushUndo();
      state.leverDragging = true;
    }
    state.molecule = withProvenance(applyLever(state.molecule, leverId, Number(el.value)), [leverId], "user");
    state.stress = null;
    refresh();
  }
});

root.addEventListener("keydown", (ev) => {
  const el = ev.target as HTMLElement;
  if (ev.key !== "Enter") return;
  if (el.id === "ob-idea" && (ev.metaKey || ev.ctrlKey)) void runGenesis();
  if (el.id === "sc-name") root.querySelector<HTMLButtonElement>('[data-action="scenario-save"]')?.click();
  if (el.id === "mk-query") void runMarket((el as HTMLInputElement).value);
  if (el.id === "adv-q") void askAdvisors((el as HTMLInputElement).value);
});

root.addEventListener("change", (ev) => {
  const el = ev.target as HTMLInputElement | HTMLSelectElement;
  if (el.hasAttribute("data-persona-select")) {
    state.persona = el.value as PersonaId;
    const pDef = personaDef(state.persona);
    state.lens = pDef.defaultLens;
    state.xrayLens = pDef.defaultXRayLens;
    state.maturity = defaultMaturityForPersona(state.persona, true);
    state.zoomPct = pDef.defaultZoom;
    state.inspectorTab = pDef.inspectorTabs[0] ?? "physics";
    save();
    renderShell();
    refresh({ levers: true });
    return;
  }
  if (el.id === "fl-import-file" && el instanceof HTMLInputElement) {
    const file = el.files?.[0];
    el.value = "";
    if (file) void readStatementFile(file);
    return;
  }
  if (state.importData && el instanceof HTMLInputElement) {
    const sel = state.importData.selection;
    if (el.dataset.importCost) {
      const key = el.dataset.importCost;
      sel.costKeys = el.checked ? [...new Set([...sel.costKeys, key])] : sel.costKeys.filter((k) => k !== key);
      return;
    }
    if (el.hasAttribute("data-import-calibrate")) return void (sel.calibrateRevenue = el.checked);
    if (el.hasAttribute("data-import-balance")) return void (sel.useBalance = el.checked);
    if (el.hasAttribute("data-import-actuals")) return void (sel.saveActuals = el.checked);
  }
  const m = state.molecule;
  if (!m) return;
  if (el.hasAttribute("data-start-month")) {
    runCommands([{ type: "set_start_month", month: Number(el.value) }], { source: "user" });
    return;
  }
  if (!(el instanceof HTMLInputElement)) return;
  const d = el.dataset;
  if (d.lever) {
    state.leverDragging = false;
    refresh({ levers: true, persist: true });
    return;
  }
  if (d.lpGap) {
    const capUri = d.lpGap.slice(4) as EntityURI;
    const stMap = state.graphOverrides.bizCapStatuses ?? (state.graphOverrides.bizCapStatuses = {});
    stMap[capUri] = el.checked ? "known" : "unclear";
    state.checklist = {
      items: {
        ...state.checklist.items,
        [d.lpGap]: { checked: el.checked },
      },
    };
    refresh({ persist: true });
    return;
  }
  if (d.lpToggle || d.lpParam) {
    let r;
    if (d.lpToggle) r = toggleItem(m, state.checklist, d.lpToggle, el.checked);
    else {
      const [id, key] = d.lpParam!.split(":");
      const v = parseNullableNumber(el.value);
      if (v === null) return;
      r = setItemParam(m, state.checklist, id, key, v);
    }
    pushUndo();
    state.checklist = r.checklist;
    state.molecule = r.molecule;
    refresh({ levers: true, persist: true });
    return;
  }
  if (d.widgetEnable) {
    pushUndo();
    state.widgets = state.widgets.map((w) => (w.id === d.widgetEnable ? { ...w, enabled: el.checked } : w));
    refresh({ persist: true });
    return;
  }
  if (d.widgetFormula) {
    pushUndo();
    state.widgets = state.widgets.map((w) =>
      w.id !== d.widgetFormula ? w : w.kind === "metric" ? { ...w, formula: el.value, origin: "user" } : w.kind === "alert" ? { ...w, condition: el.value, origin: "user" } : w,
    );
    refresh({ persist: true });
    return;
  }
  if (d.scenarioCompare) {
    state.scenarios = state.scenarios.map((s) => (s.id === d.scenarioCompare ? { ...s, compare: el.checked } : s));
    refresh({ persist: true });
    return;
  }
  if (d.mcRange) {
    const v = parseNullableNumber(el.value);
    if (v === null) return;
    state.mcRanges = { ...state.mcRanges, [d.mcRange]: Math.max(0, Math.min(90, v)) / 100 };
    state.mc = null;
    save();
    renderDrawerNow();
    return;
  }
  if (d.goalValue) {
    const v = parseNullableNumber(el.value);
    if (v === null) return;
    pushUndo();
    state.goals = state.goals.map((g) => (g.id !== d.goalValue ? g : { ...g, value: GOAL_METRICS[g.metric].format === "pct" ? v / 100 : v }));
    refresh({ persist: true });
    return;
  }
  if (d.seasonMonth !== undefined) {
    const v = parseNullableNumber(el.value);
    if (v === null) return;
    const factors = [...(m.seasonality && m.seasonality.length === 12 ? m.seasonality : SEASON_PROFILES.flat.factors)];
    factors[Number(d.seasonMonth)] = Math.max(0, Math.min(5, v));
    runCommands([{ type: "set_seasonality", factors }], { source: "user" });
    return;
  }
  if (d.founder) {
    const v = parseNullableNumber(el.value);
    if (v !== null) runCommands([{ type: "set_founder", [d.founder]: v }], { source: "user" });
    return;
  }
  if (el.hasAttribute("data-rename-molecule")) return setMolecule(renameMolecule(m, el.value));
  if (d.renameAtom) return setMolecule(renameAtom(m, d.renameAtom, el.value), true);
  if (d.atomField) {
    const [atomId, field] = d.atomField.split(":");
    setMolecule(withProvenance(setAtomField(m, atomId, field, parseNullableNumber(el.value)), [d.atomField], "user"), true);
    return;
  }
  if (d.creditField) {
    const v = parseNullableNumber(el.value);
    if (v !== null) setMolecule(withProvenance({ ...m, credit: { ...m.credit, [d.creditField]: v } }, [`credit:${d.creditField}`], "user"), true);
    return;
  }
  if (d.fcField) {
    const [id, field] = d.fcField.split(":");
    const patch = field === "label" ? { label: el.value } : { [field]: parseNullableNumber(el.value) ?? undefined };
    setMolecule(updateFixedCost(m, id, patch));
    return;
  }
  if (el.hasAttribute("data-payroll-day")) {
    const v = parseNullableNumber(el.value);
    if (v !== null) setMolecule(setPayrollDay(m, v));
  }
});

document.addEventListener("keydown", (ev) => {
  if (ev.key === "Escape") {
    if (state.drawer) closeDrawer();
    else if (state.spotlightParentUri) {
      state.spotlightParentUri = null;
      state.zoomPct = 45;
      refresh();
    }
  }
  if ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === "z" && !(ev.target instanceof HTMLInputElement) && !(ev.target instanceof HTMLTextAreaElement)) {
    ev.preventDefault();
    undo();
  }
});

// ---------------------------------------------------------------------------
// Käynnistys
// ---------------------------------------------------------------------------

load();
const params = new URLSearchParams(location.search);
const langParam = params.get("lang");
if (isLocale(langParam)) setLocale(langParam);
else if (!localStorage.getItem(STORAGE_KEY)) setLocale(navigator.language?.toLowerCase().startsWith("fi") ? "fi" : "en");
// Jaettavat linkit: ?preset=it_consultant&open=receivables&persona=director&lang=en&task=rescue-cash
const presetParam = params.get("preset");
const openParam = params.get("open") as PanelId | null;
const personaParam = params.get("persona") as PersonaId | null;
const taskParam = params.get("task");
if (personaParam && PERSONAS.some((p) => p.id === personaParam)) {
  state.persona = personaParam;
  state.lens = personaDef(personaParam).defaultLens;
}
if (presetParam && presetParam in PRESET_LABELS) {
  Object.assign(state, { molecule: createPreset(presetParam as PresetId), checklist: emptyChecklist(), chat: [], widgets: [], goals: [], scenarios: [], actuals: [], task: null });
  state.lens = personaDef(state.persona).defaultLens;
}
if (taskParam && TASKS.some((d) => d.id === taskParam)) {
  const start = taskStart(taskParam)!;
  Object.assign(state, { molecule: start, checklist: emptyChecklist(), task: { id: taskParam, start } });
}
if (presetParam || personaParam || openParam || langParam || taskParam) history.replaceState(null, "", location.pathname);
save();
void fetch("/api/flow/status")
  .then((r) => r.json())
  .then((s: { llm?: boolean }) => {
    state.llm = !!s.llm;
    if (!state.molecule) renderOnboarding();
  })
  .catch(() => undefined);
if (state.molecule) {
  renderShell();
  refresh({ levers: true });
  if (openParam && PANELS.includes(openParam)) openDrawer(openParam);
  else play();
} else {
  renderOnboarding();
}
