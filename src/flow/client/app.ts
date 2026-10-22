/**
 * APEX Flow — selainsovellus (`src/flow/client/app.ts`).
 *
 * Tila elää selaimessa ja tallentuu localStorageen. Laskenta ajetaan samalla
 * atomiytimellä kuin testit, joten liukusäätimet päivittävät virrat heti ilman
 * palvelinkutsua. Keskusteleva valmentaja on ainoa toiminto, joka käyttää palvelinta.
 */
import type { AtomKind, Molecule } from "../kernel/types.ts";
import { ATOM_KIND_LABELS, PRESET_LABELS, createPreset, emptyMolecule, type PresetId } from "../kernel/presets.ts";
import { type StressInput, type StressResult, stressTest, withCustomerTerms } from "../kernel/sensitivity.ts";
import { buildView, type FlowView, type NodeId } from "../model/view.ts";
import { applyLever, leversFor, type Lever } from "../model/levers.ts";
import {
  addAtom,
  addFixedCost,
  removeAtom,
  removeFixedCost,
  renameAtom,
  renameMolecule,
  setAtomField,
  setPayrollDay,
  updateFixedCost,
} from "../model/edit.ts";
import { checklistView, emptyChecklist, setItemParam, toggleItem, type ChecklistState } from "../model/launchpad.ts";
import { applyCommands, type PanelId } from "../model/commands.ts";
import { coachInsights, type CoachInsight } from "../model/coach.ts";
import {
  LENS_LABELS,
  PERSONAS,
  boundaryMessages,
  lensHeadlines,
  lensNodes,
  leversForLens,
  personaDef,
  type LensId,
  type PersonaId,
} from "../model/personas.ts";
import { esc, eur, int, num, pct } from "../model/format.ts";
import { FlowCanvas, renderTimeline } from "./canvas.ts";
import { renderDrawer } from "./drawer.ts";
import { renderLaunchpad } from "./launchpad.ts";
import { renderCoachPanel, renderCoachStrip, type ChatMessage } from "./coach.ts";
import { renderImportPanel } from "./importer.ts";
import { analyzeStatement, defaultSelection, importCommands, parseStatementCsv, type ImportSelection, type StatementAnalysis } from "../model/importer.ts";

const STORAGE_KEY = "apex.flow.v1";
const UNDO_LIMIT = 30;

interface PersistedState {
  version: 1;
  molecule: Molecule | null;
  checklist?: ChecklistState;
  persona?: PersonaId;
  lens?: LensId;
  chat?: ChatMessage[];
}

interface Snapshot {
  molecule: Molecule;
  checklist: ChecklistState;
}

interface AppState {
  molecule: Molecule | null;
  view: FlowView | null;
  checklist: ChecklistState;
  persona: PersonaId;
  lens: LensId;
  insights: CoachInsight[];
  chat: ChatMessage[];
  chatBusy: boolean;
  drawer: PanelId | null;
  stress: StressResult | null;
  showAllLevers: boolean;
  day: number;
  playing: boolean;
  undo: Snapshot[];
  leverDragging: boolean;
  toast: string | null;
  importData: { analysis: StatementAnalysis | null; selection: ImportSelection; error: string | null } | null;
  onboardingKinds: Set<AtomKind>;
  onboardingName: string;
}

const state: AppState = {
  molecule: null,
  view: null,
  checklist: emptyChecklist(),
  persona: "founder",
  lens: "all",
  insights: [],
  chat: [],
  chatBusy: false,
  drawer: null,
  stress: null,
  showAllLevers: false,
  day: 0,
  playing: false,
  undo: [],
  leverDragging: false,
  toast: null,
  importData: null,
  onboardingKinds: new Set(),
  onboardingName: "",
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
    const parsed = JSON.parse(raw) as PersistedState;
    if (!parsed || parsed.version !== 1) return;
    if (isMolecule(parsed.molecule)) state.molecule = parsed.molecule;
    if (parsed.checklist && typeof parsed.checklist.items === "object") state.checklist = parsed.checklist;
    if (parsed.persona && PERSONAS.some((p) => p.id === parsed.persona)) state.persona = parsed.persona;
    if (parsed.lens && parsed.lens in LENS_LABELS) state.lens = parsed.lens;
    if (Array.isArray(parsed.chat)) state.chat = parsed.chat.filter((c) => c && typeof c.text === "string" && !c.pending).slice(-50);
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
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // Selaimen tallennustila täynnä tai estetty: sovellus toimii silti istunnon ajan.
  }
}

function pushUndo(): void {
  if (!state.molecule) return;
  state.undo.push({ molecule: state.molecule, checklist: state.checklist });
  if (state.undo.length > UNDO_LIMIT) state.undo.shift();
  updateUndoButton();
}

function undo(): void {
  const snap = state.undo.pop();
  if (!snap) return;
  state.molecule = snap.molecule;
  state.checklist = snap.checklist;
  state.stress = null;
  refresh({ levers: true, persist: true });
  showToast("Viimeisin muutos kumottu.");
}

function updateUndoButton(): void {
  const b = $<HTMLButtonElement>("#fl-undo");
  if (b) b.disabled = state.undo.length === 0;
}

function showToast(text: string): void {
  state.toast = text;
  const el = $("#fl-toast");
  if (!el) return;
  el.textContent = text;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el.classList.remove("show"), 3200);
}

// ---------------------------------------------------------------------------
// Renderöinti
// ---------------------------------------------------------------------------

function formatLever(l: Lever, v: number): string {
  switch (l.format) {
    case "eur":
      return eur(v);
    case "pct":
      return pct(v, l.step < 0.01 ? 1 : 0);
    case "int":
      return int(v);
    case "days":
      return `${int(v)} pv`;
    default:
      return num(v);
  }
}

function renderOnboarding(): void {
  canvas?.destroy();
  canvas = null;
  const personas = PERSONAS.map(
    (p) => `<button class="ob-persona ${state.persona === p.id ? "on" : ""}" data-action="set-persona" data-persona="${p.id}" aria-pressed="${state.persona === p.id}" title="${esc(p.hint)}">${esc(p.title)}</button>`,
  ).join("");
  const kinds = (Object.keys(ATOM_KIND_LABELS) as AtomKind[])
    .map((k) => {
      const on = state.onboardingKinds.has(k);
      return `<button class="ob-card ${on ? "on" : ""}" data-action="toggle-kind" data-kind="${k}" aria-pressed="${on}">
        <b>${esc(ATOM_KIND_LABELS[k].title)}</b><span>${esc(ATOM_KIND_LABELS[k].hint)}</span></button>`;
    })
    .join("");
  const presets = (Object.keys(PRESET_LABELS) as PresetId[])
    .map((p) => `<button class="ob-preset" data-action="preset" data-preset="${p}"><b>${esc(PRESET_LABELS[p].title)}</b><span>${esc(PRESET_LABELS[p].hint)}</span></button>`)
    .join("");
  root.innerHTML = `
  <header class="fl-header">
    <a href="/" class="fl-back">← APEX</a>
    <div class="fl-brand">APEX <b>Flow</b> <span class="fl-beta">beta</span></div>
  </header>
  <main class="ob-main">
    <div class="ob-step">Käytän APEXia, koska…</div>
    <div class="ob-personas">${personas}</div>
    <h1>Mitä yrityksesi myy?</h1>
    <p class="ob-lead">Valitse yksi tai useampi. Moni yritys myy usean tavan yhdistelmää – esimerkiksi tunteja ja kuukausitilauksia.</p>
    <label class="ob-name">Yrityksen nimi <input id="ob-name" value="${esc(state.onboardingName)}" placeholder="esim. Oma konsultointi"/></label>
    <div class="ob-cards">${kinds}</div>
    <button class="ob-start" data-action="start" ${state.onboardingKinds.size === 0 ? "disabled" : ""}>Rakenna yritykseni →</button>
    <h2>Tai aloita esimerkistä</h2>
    <div class="ob-presets">${presets}</div>
    <p class="ob-foot">Kaikki luvut ovat muokattavia oletuksia. Laskelmat ilman arvonlisäveroa. Malli tallentuu vain tähän selaimeen.</p>
  </main>`;
}

function renderShell(): void {
  const m = state.molecule!;
  const p = personaDef(state.persona);
  const personaOptions = PERSONAS.map((x) => `<option value="${x.id}" ${x.id === state.persona ? "selected" : ""}>${esc(x.title)}</option>`).join("");
  const lensButtons = p.lensPicker
    ? `<div class="fl-lens" role="group" aria-label="Näkökulma">${(Object.keys(LENS_LABELS) as LensId[])
        .map((l) => `<button class="fl-lens-btn" data-action="set-lens" data-lens="${l}" aria-pressed="${state.lens === l}">${esc(LENS_LABELS[l])}</button>`)
        .join("")}</div>`
    : "";
  root.innerHTML = `
  <header class="fl-header">
    <a href="/" class="fl-back">← APEX</a>
    <div class="fl-brand">APEX <b>Flow</b> <span class="fl-beta">beta</span></div>
    <input class="fl-name" data-rename-molecule value="${esc(m.name)}" aria-label="Yrityksen nimi"/>
    <div class="fl-header-actions">
      <label class="fl-persona">Rooli <select data-persona-select aria-label="Rooli">${personaOptions}</select></label>
      <button class="fl-btn ghost" data-action="undo" id="fl-undo" title="Kumoa viimeisin muutos" ${state.undo.length ? "" : "disabled"}>↶ Kumoa</button>
      <button class="fl-btn ${p.launchpad ? "primary" : ""}" data-action="open" data-node="launchpad" id="fl-lp-btn">🚀 Perustamislista <span class="fl-badge" id="fl-lp-count"></span></button>
      <button class="fl-btn ghost" data-action="reset">Aloita alusta</button>
    </div>
  </header>
  ${lensButtons ? `<div class="fl-subheader">${lensButtons}<div class="fl-boundary" id="fl-boundary"></div></div>` : ""}
  <main class="fl-main">
    <section class="fl-stage">
      <div class="fl-headlines" id="fl-headlines"></div>
      <div id="fl-coach"></div>
      ${p.quickStress ? `<div class="fl-quickstress"><span>Stressitesti:</span>
        <button class="fd-chip small" data-action="stress" data-volume="-0.25">Myynti −25 %</button>
        <button class="fd-chip small" data-action="stress" data-price="-0.1">Hinnat −10 %</button>
        <button class="fd-chip small" data-action="stress" data-fixed="0.15">Kiinteät kulut +15 %</button>
        <button class="fd-chip small" data-action="stress" data-variable="0.2">Ostohinnat +20 %</button></div>` : ""}
      <div class="fl-canvas" id="fl-canvas"></div>
      <div class="fl-timeline">
        <div class="fl-timeline-bar">
          <button class="fl-btn" data-action="play" id="fl-play">▶ Toista vuosi</button>
          <input type="range" id="fl-day" min="0" max="359" step="1" value="${state.day}" aria-label="Simulaation päivä"/>
        </div>
        <div id="fl-timeline" data-action="timeline-click"></div>
      </div>
    </section>
    <aside class="fl-side">
      <div class="fl-side-head"><h3>Vivut</h3><span>Vedä ja katso mitä tapahtuu</span></div>
      <div id="fl-levers"></div>
    </aside>
  </main>
  <div id="fl-toast" class="fl-toast" role="status" aria-live="polite"></div>
  <input type="file" id="fl-import-file" accept=".csv,text/csv,.txt" hidden/>
  <div id="fl-drawer-backdrop" class="fl-drawer-backdrop" data-action="close-drawer" hidden></div>
  <aside id="fl-drawer" class="fl-drawer" aria-hidden="true"></aside>`;
  canvas?.destroy();
  canvas = new FlowCanvas($("#fl-canvas")!, (id) => openDrawer(id));
}

const HEADLINE_TARGETS: Record<LensId, NodeId[]> = {
  all: ["costs", "cash", "demand"],
  finance: ["costs", "cash", "demand"],
  sales: ["demand", "demand", "capacity"],
  operations: ["capacity", "costs", "costs"],
};

function renderHeadlines(v: FlowView): void {
  const targets = HEADLINE_TARGETS[state.lens];
  $("#fl-headlines")!.innerHTML = lensHeadlines(v, state.lens)
    .map(
      (h, i) => `<button class="fl-headline st-${h.status}" data-action="open" data-node="${targets[i]}">
        <span class="fl-hl-label">${esc(h.label)}</span>
        <span class="fl-hl-value">${esc(h.value)}</span>
        <span class="fl-hl-sub">${esc(h.sub)}</span>
      </button>`,
    )
    .join("");
  const boundary = $("#fl-boundary");
  if (boundary) {
    const msgs = boundaryMessages(v, state.lens);
    boundary.innerHTML = msgs.map((m) => `<span>↔ ${esc(m)}</span>`).join("");
  }
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
        .map(
          (l) => `<div class="lv-row" data-lever-row="${esc(l.id)}">
            <div class="lv-top"><label for="lv-${esc(l.id)}">${esc(l.label)}</label><output id="lvo-${esc(l.id)}">${esc(formatLever(l, l.value))}</output></div>
            <input type="range" id="lv-${esc(l.id)}" data-lever="${esc(l.id)}" min="${l.min}" max="${l.max}" step="${l.step}" value="${l.value}"/>
            ${l.hint ? `<div class="lv-hint">${esc(l.hint)}</div>` : ""}
          </div>`,
        )
        .join("")}</div>`,
    )
    .join("");
  const hidden = levers.length - levers.filter((l) => l.primary).length;
  $("#fl-levers")!.innerHTML = `${html || `<p class="fd-note">Tällä näkökulmalla ei ole vipuja.</p>`}${
    hidden > 0
      ? `<button class="fl-btn ghost wide" data-action="toggle-levers">${state.showAllLevers ? "Näytä vain tärkeimmät" : `Lisää vipuja (${hidden})`}</button>`
      : ""
  }`;
}

function renderCoachNow(): void {
  const host = $("#fl-coach");
  if (!host) return;
  host.innerHTML = renderCoachStrip(state.insights, personaDef(state.persona).teach);
}

function renderTimelineNow(): void {
  if (!state.view) return;
  const tl = $("#fl-timeline");
  if (tl) tl.innerHTML = renderTimeline(state.view, state.day);
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
    if (panel === "launchpad") drawer.innerHTML = renderLaunchpad(checklistView(state.molecule!, state.view!, state.checklist));
    else if (panel === "coach") drawer.innerHTML = renderCoachPanel(state.insights, state.chat, personaDef(state.persona).teach, state.chatBusy);
    else if (panel === "import") {
      const d = state.importData;
      drawer.innerHTML = d && d.analysis
        ? renderImportPanel(state.molecule!, d.analysis, d.selection, state.view!.monthlyRevenue, null)
        : renderImportPanel(state.molecule!, analyzeStatement([]), { costKeys: [], calibrateRevenue: false, useBalance: false }, 0, d?.error ?? "Tiliotetta ei ole valittu.");
    }
    else drawer.innerHTML = renderDrawer(panel, { view: state.view!, stress: state.stress });
  });
  if (panel === "coach") {
    const log = $("#co-log");
    if (log) log.scrollTop = log.scrollHeight;
  }
  drawer.classList.add("open");
  drawer.setAttribute("aria-hidden", "false");
  backdrop.hidden = false;
}

/** Laskee näkymän uudelleen ja päivittää kaikki osat. */
function refresh(opts: { levers?: boolean; persist?: boolean } = {}): void {
  if (!state.molecule) {
    renderOnboarding();
    return;
  }
  state.view = buildView(state.molecule);
  const lp = checklistView(state.molecule, state.view, state.checklist);
  state.insights = coachInsights(state.molecule, state.view, lp, state.persona);
  renderHeadlines(state.view);
  renderCoachNow();
  canvas?.update(state.view);
  canvas?.setFocus(lensNodes(state.lens));
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
    const out = root.querySelector(`#lvo-${CSS.escape(l.id)}`);
    if (out) out.textContent = formatLever(l, l.value);
  }
}

function openDrawer(id: PanelId): void {
  state.drawer = id;
  if (id !== "cash") state.stress = null;
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

function startMolecule(m: Molecule): void {
  state.molecule = m;
  state.checklist = emptyChecklist();
  state.undo = [];
  state.chat = [];
  state.lens = personaDef(state.persona).defaultLens;
  state.day = 0;
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

/** Soveltaa valmentajan tai keskustelun komennot (validoidaan aina uudelleen). */
function runCommands(raw: unknown[]): string[] {
  if (!state.molecule) return [];
  const r = applyCommands(state.molecule, state.checklist, raw);
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
// Keskusteleva valmentaja
// ---------------------------------------------------------------------------

async function sendChat(text: string): Promise<void> {
  const message = text.trim();
  if (!message || !state.molecule || state.chatBusy) return;
  const history = state.chat.filter((c) => !c.pending).slice(-10).map((c) => ({ role: c.role, text: c.text }));
  state.chat.push({ role: "user", text: message });
  state.chat.push({ role: "coach", text: "Mietin…", pending: true });
  state.chatBusy = true;
  renderDrawerNow();
  let reply: ChatMessage;
  try {
    const res = await fetch("/api/flow/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, molecule: state.molecule, checklist: state.checklist, persona: state.persona, history }),
    });
    const data = (await res.json()) as { reply?: string; commands?: unknown[]; source?: "llm" | "rules"; note?: string; error?: string };
    if (!res.ok || typeof data.reply !== "string") throw new Error(data.error ?? `HTTP ${res.status}`);
    const applied = runCommands(Array.isArray(data.commands) ? data.commands : []);
    reply = { role: "coach", text: data.reply, applied, note: data.note, source: data.source };
  } catch (err) {
    reply = { role: "coach", text: `Valmentajaan ei saatu yhteyttä (${(err as Error).message}). Malli ei muuttunut.` };
  }
  state.chat = state.chat.filter((c) => !c.pending);
  state.chat.push(reply);
  state.chatBusy = false;
  save();
  if (state.drawer !== "coach") state.drawer = "coach";
  renderDrawerNow();
  $<HTMLInputElement>("#co-input")?.focus();
}

// ---------------------------------------------------------------------------
// Tiliotteen tuonti (käsitellään vain selaimessa)
// ---------------------------------------------------------------------------

async function readStatementFile(file: File): Promise<void> {
  if (file.size > 5 * 1024 * 1024) {
    state.importData = { analysis: null, selection: { costKeys: [], calibrateRevenue: false, useBalance: false }, error: "Tiedosto on liian suuri (yli 5 Mt)." };
    openDrawer("import");
    return;
  }
  if (/\.pdf$/i.test(file.name)) {
    state.importData = { analysis: null, selection: { costKeys: [], calibrateRevenue: false, useBalance: false }, error: "PDF-tiliotteita ei vielä tueta." };
    openDrawer("import");
    return;
  }
  const buf = await file.arrayBuffer();
  let text = new TextDecoder("utf-8").decode(buf);
  // Monet pankit vievät CSV:n Latin-1/Windows-1252-merkistössä.
  if (text.includes("\uFFFD")) text = new TextDecoder("windows-1252").decode(buf);
  const parsed = parseStatementCsv(text);
  if (parsed.error) {
    state.importData = { analysis: null, selection: { costKeys: [], calibrateRevenue: false, useBalance: false }, error: parsed.error };
  } else {
    const analysis = analyzeStatement(parsed.transactions);
    state.importData = {
      analysis,
      selection: defaultSelection(state.molecule!, analysis),
      error: null,
    };
  }
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
  if (btn) btn.textContent = "⏸ Pysäytä";
  let last = 0;
  let acc = state.day;
  const step = (ts: number) => {
    if (!state.playing || !state.view) return;
    const dt = last ? (ts - last) / 1000 : 0;
    last = ts;
    acc += dt * 30; // 30 päivää sekunnissa → vuosi 12 sekunnissa
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
  if (btn) btn.textContent = "▶ Toista vuosi";
}

// ---------------------------------------------------------------------------
// Tapahtumat
// ---------------------------------------------------------------------------

function parseNullableNumber(raw: string): number | null {
  const t = raw.trim().replace(",", ".");
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

root.addEventListener("click", (ev) => {
  const target = (ev.target as Element).closest<HTMLElement>("[data-action]");
  if (!target) return;
  const action = target.dataset.action;
  const m = state.molecule;
  switch (action) {
    case "set-persona":
      state.persona = target.dataset.persona as PersonaId;
      renderOnboarding();
      return;
    case "toggle-kind": {
      const k = target.dataset.kind as AtomKind;
      if (state.onboardingKinds.has(k)) state.onboardingKinds.delete(k);
      else state.onboardingKinds.add(k);
      renderOnboarding();
      return;
    }
    case "start": {
      if (state.onboardingKinds.size === 0) return;
      let mol = emptyMolecule(state.onboardingName.trim() || "Oma yritys");
      for (const k of state.onboardingKinds) mol = addAtom(mol, k);
      if (!mol.atoms.some((a) => a.kind === "TIME_CAPACITY" || a.kind === "PHYSICAL_MATTER")) {
        mol = { ...mol, credit: { ...mol.credit, customerTermsDays: 0 } };
      }
      state.onboardingKinds.clear();
      startMolecule(mol);
      return;
    }
    case "preset":
      startMolecule(createPreset(target.dataset.preset as PresetId));
      return;
    case "reset":
      if (!confirm("Aloitetaanko alusta? Nykyinen malli, muistilista ja keskustelu poistetaan tästä selaimesta.")) return;
      stop();
      state.molecule = null;
      state.checklist = emptyChecklist();
      state.chat = [];
      state.undo = [];
      state.drawer = null;
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
    case "open":
      openDrawer(target.dataset.node as PanelId);
      return;
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
    case "import-open":
      $<HTMLInputElement>("#fl-import-file")?.click();
      return;
    case "import-apply": {
      const d = state.importData;
      if (!d?.analysis || !state.molecule) return;
      const applied = runCommands(importCommands(state.molecule, d.analysis, d.selection));
      state.importData = null;
      closeDrawer();
      showToast(applied.length ? `Tiliotteelta lisätty: ${applied.length} muutosta. Voit kumota ↶` : "Ei valittuja muutoksia.");
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
      const applied = runCommands(act.commands);
      if (applied.length) showToast(`Muutettu: ${applied.join(" · ")}. Voit kumota ↶`);
      return;
    }
  }
  if (!m) return;
  switch (action) {
    case "add-atom":
      setMolecule(addAtom(m, target.dataset.kind as AtomKind), true);
      return;
    case "remove-atom":
      if (m.atoms.length <= 1) return;
      setMolecule(removeAtom(m, target.dataset.atom!), true);
      return;
    case "add-fc":
      setMolecule(addFixedCost(m, { label: "Uusi kulu", amountPerMonth: 100 }));
      return;
    case "remove-fc":
      setMolecule(removeFixedCost(m, target.dataset.id!));
      return;
    case "set-terms":
      setMolecule(withCustomerTerms(m, Number(target.dataset.days)), true);
      return;
  }
});

root.addEventListener("submit", (ev) => {
  const form = ev.target as HTMLFormElement;
  if (form.id !== "co-form") return;
  ev.preventDefault();
  const input = $<HTMLInputElement>("#co-input");
  if (!input) return;
  const text = input.value;
  input.value = "";
  void sendChat(text);
});

root.addEventListener("input", (ev) => {
  const t = ev.target as HTMLInputElement;
  if (t.id === "ob-name") {
    state.onboardingName = t.value;
    return;
  }
  if (t.id === "fl-day") {
    stop();
    state.day = Number(t.value);
    renderTimelineNow();
    return;
  }
  const leverId = t.dataset.lever;
  if (leverId && state.molecule) {
    if (!state.leverDragging) {
      pushUndo();
      state.leverDragging = true;
    }
    state.molecule = applyLever(state.molecule, leverId, Number(t.value));
    state.stress = null;
    refresh();
  }
});

root.addEventListener("change", (ev) => {
  const t = ev.target as HTMLInputElement | HTMLSelectElement;
  if (t.hasAttribute("data-persona-select")) {
    state.persona = t.value as PersonaId;
    state.lens = personaDef(state.persona).defaultLens;
    save();
    renderShell();
    refresh({ levers: true });
    return;
  }
  if (t.id === "fl-import-file" && t instanceof HTMLInputElement) {
    const file = t.files?.[0];
    t.value = "";
    if (file) void readStatementFile(file);
    return;
  }
  if (state.importData && t instanceof HTMLInputElement) {
    const sel = state.importData.selection;
    if (t.dataset.importCost) {
      const key = t.dataset.importCost;
      sel.costKeys = t.checked ? [...new Set([...sel.costKeys, key])] : sel.costKeys.filter((k) => k !== key);
      return;
    }
    if (t.hasAttribute("data-import-calibrate")) {
      sel.calibrateRevenue = t.checked;
      return;
    }
    if (t.hasAttribute("data-import-balance")) {
      sel.useBalance = t.checked;
      return;
    }
  }
  const m = state.molecule;
  if (!m || !(t instanceof HTMLInputElement)) return;
  if (t.dataset.lever) {
    state.leverDragging = false;
    refresh({ levers: true, persist: true });
    return;
  }
  if (t.dataset.lpToggle) {
    const r = toggleItem(m, state.checklist, t.dataset.lpToggle, t.checked);
    pushUndo();
    state.checklist = r.checklist;
    state.molecule = r.molecule;
    refresh({ levers: true, persist: true });
    return;
  }
  if (t.dataset.lpParam) {
    const [id, key] = t.dataset.lpParam.split(":");
    const v = parseNullableNumber(t.value);
    if (v === null) return;
    const r = setItemParam(m, state.checklist, id, key, v);
    pushUndo();
    state.checklist = r.checklist;
    state.molecule = r.molecule;
    refresh({ levers: true, persist: true });
    return;
  }
  if (t.hasAttribute("data-rename-molecule")) {
    setMolecule(renameMolecule(m, t.value));
    return;
  }
  if (t.dataset.renameAtom) {
    setMolecule(renameAtom(m, t.dataset.renameAtom, t.value), true);
    return;
  }
  if (t.dataset.atomField) {
    const [atomId, field] = t.dataset.atomField.split(":");
    setMolecule(setAtomField(m, atomId, field, parseNullableNumber(t.value)), true);
    return;
  }
  if (t.dataset.creditField) {
    const v = parseNullableNumber(t.value);
    if (v === null) return;
    setMolecule({ ...m, credit: { ...m.credit, [t.dataset.creditField]: v } }, true);
    return;
  }
  if (t.dataset.fcField) {
    const [id, field] = t.dataset.fcField.split(":");
    const patch = field === "label" ? { label: t.value } : { [field]: parseNullableNumber(t.value) ?? undefined };
    setMolecule(updateFixedCost(m, id, patch));
    return;
  }
  if (t.hasAttribute("data-payroll-day")) {
    const v = parseNullableNumber(t.value);
    if (v !== null) setMolecule(setPayrollDay(m, v));
  }
});

document.addEventListener("keydown", (ev) => {
  if (ev.key === "Escape" && state.drawer) closeDrawer();
  if ((ev.metaKey || ev.ctrlKey) && ev.key.toLowerCase() === "z" && !(ev.target instanceof HTMLInputElement)) {
    ev.preventDefault();
    undo();
  }
});

// ---------------------------------------------------------------------------
// Käynnistys
// ---------------------------------------------------------------------------

load();
// Jaettavat esimerkkilinkit: /flow?preset=it_consultant (&open=receivables avaa paneelin, &persona=director).
const params = new URLSearchParams(location.search);
const presetParam = params.get("preset");
const openParam = params.get("open") as PanelId | null;
const personaParam = params.get("persona") as PersonaId | null;
if (personaParam && PERSONAS.some((p) => p.id === personaParam)) {
  state.persona = personaParam;
  state.lens = personaDef(personaParam).defaultLens;
}
if (presetParam && presetParam in PRESET_LABELS) {
  state.molecule = createPreset(presetParam as PresetId);
  state.checklist = emptyChecklist();
  state.chat = [];
  state.lens = personaDef(state.persona).defaultLens;
  save();
}
if (presetParam || personaParam || openParam) history.replaceState(null, "", location.pathname);
if (state.molecule) {
  renderShell();
  refresh({ levers: true });
  const panels: PanelId[] = ["demand", "capacity", "receivables", "cash", "costs", "launchpad", "coach"];
  if (openParam && panels.includes(openParam)) openDrawer(openParam);
  else play();
} else {
  renderOnboarding();
}
