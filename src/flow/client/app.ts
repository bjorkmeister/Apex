/**
 * APEX Flow — selainsovellus (`src/flow/client/app.ts`).
 *
 * Tila elää selaimessa ja tallentuu localStorageen. Laskenta ajetaan samalla
 * atomiytimellä kuin testit, joten liukusäätimet päivittävät virrat heti ilman
 * palvelinkutsua.
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
import { esc, eur, int, num, pct } from "../model/format.ts";
import { FlowCanvas, renderTimeline } from "./canvas.ts";
import { renderDrawer } from "./drawer.ts";

const STORAGE_KEY = "apex.flow.v1";

interface PersistedState {
  version: 1;
  molecule: Molecule | null;
}

interface AppState {
  molecule: Molecule | null;
  view: FlowView | null;
  drawer: NodeId | null;
  stress: StressResult | null;
  showAllLevers: boolean;
  day: number;
  playing: boolean;
  onboardingKinds: Set<AtomKind>;
  onboardingName: string;
}

const state: AppState = {
  molecule: null,
  view: null,
  drawer: null,
  stress: null,
  showAllLevers: false,
  day: 0,
  playing: false,
  onboardingKinds: new Set(),
  onboardingName: "",
};

let canvas: FlowCanvas | null = null;
let playRaf = 0;

const root = document.getElementById("flow-root") as HTMLElement;
const $ = <T extends Element = HTMLElement>(sel: string): T | null => root.querySelector<T>(sel);

// ---------------------------------------------------------------------------
// Tallennus
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
    if (parsed && parsed.version === 1 && isMolecule(parsed.molecule)) state.molecule = parsed.molecule;
  } catch {
    // Rikkinäinen tallenne: aloitetaan puhtaalta pöydältä.
  }
}

function save(): void {
  try {
    const data: PersistedState = { version: 1, molecule: state.molecule };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // Selaimen tallennustila täynnä tai estetty: sovellus toimii silti istunnon ajan.
  }
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
    <h1>Mitä yrityksesi myy?</h1>
    <p class="ob-lead">Valitse yksi tai useampi. Moni yritys myy usean tavan yhdistelmää – esimerkiksi tunteja ja kuukausitilauksia.</p>
    <label class="ob-name">Yrityksen nimi <input id="ob-name" value="${esc(state.onboardingName)}" placeholder="esim. Oma konsultointi"/></label>
    <div class="ob-cards">${kinds}</div>
    <button class="ob-start" data-action="start" ${state.onboardingKinds.size === 0 ? "disabled" : ""}>Rakenna yritykseni →</button>
    <h2>Tai aloita esimerkistä</h2>
    <div class="ob-presets">${presets}</div>
    <p class="ob-foot">Kaikki luvut ovat muokattavia oletuksia. Laskelmat ilman arvonlisäveroa.</p>
  </main>`;
}

function renderShell(): void {
  const m = state.molecule!;
  root.innerHTML = `
  <header class="fl-header">
    <a href="/" class="fl-back">← APEX</a>
    <div class="fl-brand">APEX <b>Flow</b> <span class="fl-beta">beta</span></div>
    <input class="fl-name" data-rename-molecule value="${esc(m.name)}" aria-label="Yrityksen nimi"/>
    <div class="fl-header-actions">
      <button class="fl-btn ghost" data-action="reset">Aloita alusta</button>
    </div>
  </header>
  <main class="fl-main">
    <section class="fl-stage">
      <div class="fl-headlines" id="fl-headlines"></div>
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
  <div id="fl-drawer-backdrop" class="fl-drawer-backdrop" data-action="close-drawer" hidden></div>
  <aside id="fl-drawer" class="fl-drawer" aria-hidden="true"></aside>`;
  canvas?.destroy();
  canvas = new FlowCanvas($("#fl-canvas")!, (id) => openDrawer(id));
}

function renderHeadlines(v: FlowView): void {
  const target: NodeId[] = ["costs", "cash", "demand"];
  $("#fl-headlines")!.innerHTML = v.headlines
    .map(
      (h, i) => `<button class="fl-headline st-${h.status}" data-action="open" data-node="${target[i]}">
        <span class="fl-hl-label">${esc(h.label)}</span>
        <span class="fl-hl-value">${esc(h.value)}</span>
        <span class="fl-hl-sub">${esc(h.sub)}</span>
      </button>`,
    )
    .join("");
}

function renderLevers(): void {
  const m = state.molecule!;
  const levers = leversFor(m);
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
  $("#fl-levers")!.innerHTML = `${html}${
    hidden > 0
      ? `<button class="fl-btn ghost wide" data-action="toggle-levers">${state.showAllLevers ? "Näytä vain tärkeimmät" : `Lisää vipuja (${hidden})`}</button>`
      : ""
  }`;
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
    for (const attr of Array.from(active.attributes)) {
      if (attr.name.startsWith("data-")) {
        selector = `[${attr.name}="${CSS.escape(attr.value)}"]`;
        break;
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
  if (!state.drawer || !state.view) {
    drawer.classList.remove("open");
    drawer.setAttribute("aria-hidden", "true");
    backdrop.hidden = true;
    return;
  }
  withPreservedFocus(drawer, () => {
    drawer.innerHTML = renderDrawer(state.drawer!, { view: state.view!, stress: state.stress });
  });
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
  renderHeadlines(state.view);
  canvas?.update(state.view);
  renderTimelineNow();
  if (opts.levers) renderLevers();
  else updateLeverOutputs();
  if (state.drawer) renderDrawerNow();
  if (opts.persist) save();
}

function updateLeverOutputs(): void {
  if (!state.molecule) return;
  for (const l of leversFor(state.molecule)) {
    const out = root.querySelector(`#lvo-${CSS.escape(l.id)}`);
    if (out) out.textContent = formatLever(l, l.value);
  }
}

function openDrawer(id: NodeId): void {
  state.drawer = id;
  state.stress = null;
  renderDrawerNow();
}

function closeDrawer(): void {
  state.drawer = null;
  state.stress = null;
  renderDrawerNow();
}

function setMolecule(m: Molecule, structural = false): void {
  state.molecule = m;
  state.stress = null;
  refresh({ levers: structural, persist: true });
}

function startMolecule(m: Molecule): void {
  state.molecule = m;
  state.day = 0;
  save();
  renderShell();
  refresh({ levers: true });
  play();
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
      if (!confirm("Aloitetaanko alusta? Nykyinen malli poistetaan tästä selaimesta.")) return;
      stop();
      state.molecule = null;
      state.drawer = null;
      save();
      renderOnboarding();
      return;
    case "open":
      openDrawer(target.dataset.node as NodeId);
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
    case "stress": {
      const s: StressInput = {
        volumeChange: target.dataset.volume ? Number(target.dataset.volume) : undefined,
        fixedCostChange: target.dataset.fixed ? Number(target.dataset.fixed) : undefined,
        variableCostChange: target.dataset.variable ? Number(target.dataset.variable) : undefined,
      };
      state.stress = stressTest(m, s);
      renderDrawerNow();
      return;
    }
  }
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
    state.molecule = applyLever(state.molecule, leverId, Number(t.value));
    state.stress = null;
    refresh();
  }
});

root.addEventListener("change", (ev) => {
  const t = ev.target as HTMLInputElement;
  const m = state.molecule;
  if (!m) return;
  if (t.dataset.lever) {
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
});

// ---------------------------------------------------------------------------
// Käynnistys
// ---------------------------------------------------------------------------

load();
// Jaettavat esimerkkilinkit: /flow?preset=it_consultant (&open=receivables avaa paneelin).
const params = new URLSearchParams(location.search);
const presetParam = params.get("preset");
const openParam = params.get("open") as NodeId | null;
if (presetParam && presetParam in PRESET_LABELS) {
  state.molecule = createPreset(presetParam as PresetId);
  save();
  history.replaceState(null, "", location.pathname);
}
if (state.molecule) {
  renderShell();
  refresh({ levers: true });
  if (openParam && ["demand", "capacity", "receivables", "cash", "costs"].includes(openParam)) openDrawer(openParam);
  else play();
} else {
  renderOnboarding();
}
