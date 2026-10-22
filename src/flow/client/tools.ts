/**
 * APEX Studio — työkalupaneelit (`src/flow/client/tools.ts`).
 *
 * Skenaariot ja vaihteluvälit, yrittäjän tilanne, tavoitteet, sesongit ja kriisit,
 * raportti, toteuma, harjoitustehtävät, markkinatieto ja neuvonantajat.
 */
import type { Molecule } from "../kernel/types.ts";
import type { MonteCarloResult, UncertaintyRanges } from "../kernel/sensitivity.ts";
import type { FlowView } from "../model/view.ts";
import { compareScenarios, SCENARIO_COLORS, type Scenario } from "../model/scenarios.ts";
import { founderStats, hoursLevelLabel, SUSTAINABLE_HOURS, HEAVY_HOURS } from "../model/founder.ts";
import { evaluateGoals, GOAL_METRICS, type Goal, type GoalMetric } from "../model/goals.ts";
import { LENS_LABELS, type LensId } from "../model/personas.ts";
import { CRISIS_LIBRARY, SEASON_PROFILES, describeEventEffects, type SeasonProfileId } from "../model/seasons.ts";
import { compareActuals } from "../model/actuals.ts";
import type { MonthlyActual } from "../model/importer.ts";
import { TASKS } from "../model/tasks.ts";
import { ADVISORS, type AdvisorView, type AdvisorRole } from "../model/advisors.ts";
import { fieldLabel, type FlowCommand } from "../model/commands.ts";
import { esc, money, monthName, num, pct, signedEur } from "../model/format.ts";
import { t } from "../i18n/index.ts";
import { drawerHeader, numberInput } from "./drawer.ts";

// ---------------------------------------------------------------------------
// Skenaariot ja vaihteluvälit
// ---------------------------------------------------------------------------

export function renderScenarios(m: Molecule, scenarios: Scenario[], mc: MonteCarloResult | null, ranges: UncertaintyRanges): string {
  const rows = compareScenarios(m, t("Nykyinen"), scenarios)
    .map((s, i) => {
      const color = i === 0 ? "#38bdf8" : SCENARIO_COLORS[(i - 1) % SCENARIO_COLORS.length];
      return `<tr><td><i class="sc-dot" style="background:${color}"></i>${esc(s.name)}</td><td>${money(s.firstMonthProfit)}</td><td>${money(s.totalProfit)}</td>
        <td class="${s.minCash < 0 ? "bad" : ""}">${money(s.minCash)}</td><td>${money(s.endCash)}</td>
        <td>${s.cashOutDay === null ? esc(t("ei")) : esc(t("pv {day}", { day: s.cashOutDay + 1 }))}</td></tr>`;
    })
    .join("");
  const list = scenarios
    .map(
      (s, i) => `<div class="sc-row">
      <label class="wg-switch" title="${esc(t("Näytä aikajanalla"))}"><input type="checkbox" data-scenario-compare="${esc(s.id)}" ${s.compare ? "checked" : ""}/><span></span></label>
      <i class="sc-dot" style="background:${SCENARIO_COLORS[i % SCENARIO_COLORS.length]}"></i><b>${esc(s.name)}</b>
      <span class="fd-note">${esc(new Date(s.createdAt).toLocaleString())}</span>
      <span class="sc-actions"><button class="fd-chip small" data-action="scenario-load" data-id="${esc(s.id)}">${esc(t("Palaa tähän"))}</button>
      <button class="fd-icon-btn" data-action="scenario-delete" data-id="${esc(s.id)}" aria-label="${esc(t("Poista"))}">✕</button></span>
    </div>`,
    )
    .join("");
  const rangeInput = (key: keyof UncertaintyRanges, label: string) =>
    `<label>${esc(label)} ${numberInput(`data-mc-range="${key}"`, Math.round(ranges[key] * 100), { step: 5, suffix: "± %" })}</label>`;
  const p = (x: { p10: number; p50: number; p90: number }) => `${money(x.p10)} · <b>${money(x.p50)}</b> · ${money(x.p90)}`;
  const mcBlock = mc
    ? `<table class="fd-table"><thead><tr><th></th><th>${esc(t("huono (10 %) · tyypillinen · hyvä (90 %)"))}</th></tr></thead><tbody>
        <tr><td>${esc(t("Kassa vuoden lopussa"))}</td><td>${p(mc.endCash)}</td></tr>
        <tr><td>${esc(t("Kassan pohja"))}</td><td>${p(mc.minCash)}</td></tr>
        <tr><td>${esc(t("Tulos 12 kk"))}</td><td>${p(mc.totalProfit)}</td></tr>
      </tbody></table>
      <div class="fd-kpis"><div><span>${esc(t("Kassa loppuu"))}</span><b class="${mc.cashOutProbability > 0.1 ? "bad" : ""}">${pct(mc.cashOutProbability)} ${esc(t("ajoista"))}</b></div>
      <div><span>${esc(t("Vuosi tappiollinen"))}</span><b class="${mc.lossProbability > 0.1 ? "bad" : ""}">${pct(mc.lossProbability)} ${esc(t("ajoista"))}</b></div></div>
      <p class="fd-note">${esc(t("{n} simulaatiota. Jokainen tekijä vaihteli antamallasi välillä; todennäköisimmin nykyarvossa.", { n: mc.runs }))}</p>`
    : "";
  return `${drawerHeader(t("Skenaariot ja aikakone"))}
  <div class="fd-body">
    <section class="fd-section">
      <p class="fd-note">${esc(t("Tallenna nykyinen malli skenaarioksi ja jatka kokeilemista. Valitut skenaariot piirretään aikajanalle nykyisen mallin rinnalle."))}</p>
      <div class="co-form"><input id="sc-name" maxlength="60" placeholder="${esc(t("Skenaarion nimi, esim. Palkkaan heti"))}"/><button class="fl-btn primary" data-action="scenario-save">${esc(t("Tallenna"))}</button></div>
      ${list ? `<div class="sc-list">${list}</div>` : ""}
    </section>
    <section class="fd-section">
      <h4>${esc(t("Vertailu"))}</h4>
      <table class="fd-table fd-table-compact"><thead><tr><th>${esc(t("Skenaario"))}</th><th>${esc(t("Tulos 1. kk"))}</th><th>${esc(t("Tulos 12 kk"))}</th><th>${esc(t("Kassan pohja"))}</th><th>${esc(t("Kassa lopussa"))}</th><th>${esc(t("Kassa loppuu"))}</th></tr></thead><tbody>${rows}</tbody></table>
    </section>
    <section class="fd-section">
      <h4>${esc(t("Vaihteluvälit"))}</h4>
      <p class="fd-note">${esc(t("Kuinka varma olet luvuistasi? Anna kullekin vaihteluväli, niin APEX ajaa satoja simulaatioita ja kertoo, kuinka todennäköisesti kassa riittää. Epävarmuutta ei arvata – sen annat sinä."))}</p>
      <div class="fd-inputs">
        ${rangeInput("volume", t("Myyntimäärä"))}
        ${rangeInput("price", t("Hinnat"))}
        ${rangeInput("variableCost", t("Muuttuvat kulut"))}
        ${rangeInput("fixedCost", t("Kiinteät kulut"))}
      </div>
      <button class="fl-btn primary" data-action="mc-run">${esc(t("Laske vaihteluvälit"))}</button>
      ${mcBlock}
    </section>
  </div>`;
}

// ---------------------------------------------------------------------------
// Yrittäjän tilanne
// ---------------------------------------------------------------------------

export function renderFounder(m: Molecule): string {
  const f = founderStats(m);
  const source = f.salarySource === "fixed-cost" ? t("kiinteistä kuluista") : f.salarySource === "time-atom" ? t("aika-atomin palkasta") : t("ei löytynyt");
  return `${drawerHeader(t("Yrittäjän tilanne"))}
  <div class="fd-body">
    <section class="fd-section">
      <div class="fd-inputs">
        <label>${esc(t("Viikkotunnit"))} ${numberInput(`data-founder="weeklyHours"`, f.weeklyHours, { step: 1, suffix: t("h / vko") })}</label>
        <label>${esc(t("Elinkustannukset"))} ${numberInput(`data-founder="livingCostsPerMonth"`, f.livingCosts, { step: 50, suffix: t("€ / kk") })}</label>
      </div>
      <div class="fd-kpis">
        <div><span>${esc(t("Oma palkka"))}</span><b>${esc(t("{amount} / kk", { amount: money(f.ownSalary) }))}</b><em class="fd-dim">${esc(source)}</em></div>
        <div><span>${esc(t("Tuntipalkka"))}</span><b>${money(f.hourlyWage)}</b></div>
        <div><span>${esc(t("Palkka − elinkustannukset"))}</span><b class="${f.personalMargin < 0 ? "bad" : "good"}">${signedEur(f.personalMargin)}</b></div>
        <div><span>${esc(t("Työtahti"))}</span><b class="${f.hoursLevel === "unsustainable" ? "bad" : f.hoursLevel === "heavy" ? "warn" : "good"}">${esc(hoursLevelLabel(f.hoursLevel))}</b></div>
      </div>
      <p class="fd-note">${esc(t("Nyrkkisääntö: enintään {a} h viikossa on kestävä, {a}–{b} h raskas, yli {b} h ei kestä pitkään. APEX ei arvaa väsymyksen vaikutusta myyntiin – se kertoo vain, missä mennään.", { a: SUSTAINABLE_HOURS, b: HEAVY_HOURS }))}</p>
      <p class="fd-note">${esc(t("Palkka on ennen veroja. Oma palkka luetaan kulusta, jonka nimessä on \"palkka\" tai \"nosto\", tai aika-atomin palkasta."))}</p>
    </section>
  </div>`;
}

// ---------------------------------------------------------------------------
// Tavoitteet
// ---------------------------------------------------------------------------

export function renderGoals(v: FlowView, goals: Goal[]): string {
  const statuses = evaluateGoals(v, goals);
  const list = statuses
    .map((s) => {
      const def = GOAL_METRICS[s.goal.metric];
      const shown = def.format === "pct" ? Math.round(s.goal.value * 100) : Math.round(s.goal.value);
      return `<div class="sc-row">
        <span class="lp-auto st-${s.ok === null ? "todo" : s.ok ? "done" : "attention"}">${s.ok ? "✓" : s.ok === false ? "!" : "○"}</span>
        <b>${esc(t(def.label))}</b> <span>${s.goal.op === "gte" ? "≥" : "≤"}</span>
        ${numberInput(`data-goal-value="${esc(s.goal.id)}"`, shown, { step: def.format === "pct" ? 1 : 100, suffix: def.format === "pct" ? "%" : "€" })}
        <span class="fd-note">${esc(t("nyt {v}", { v: s.actual === null ? "–" : def.format === "pct" ? pct(s.actual) : money(s.actual) }))} · ${esc(t(LENS_LABELS[s.goal.lens]))}</span>
        <button class="fd-icon-btn" data-action="goal-delete" data-id="${esc(s.goal.id)}" aria-label="${esc(t("Poista"))}">✕</button>
      </div>`;
    })
    .join("");
  const byLens = (["sales", "operations", "finance"] as LensId[])
    .map(
      (lens) => `<div><div class="lv-group-title">${esc(t(LENS_LABELS[lens]))}</div><div class="fd-chips">${(Object.keys(GOAL_METRICS) as GoalMetric[])
        .filter((k) => GOAL_METRICS[k].lens === lens)
        .map((k) => `<button class="fd-chip small" data-action="goal-add" data-metric="${k}">+ ${esc(t(GOAL_METRICS[k].label))}</button>`)
        .join("")}</div></div>`,
    )
    .join("");
  return `${drawerHeader(t("Tavoitteet"))}
  <div class="fd-body">
    <section class="fd-section">
      <p class="fd-note">${esc(t("Aseta osa-alueellesi tavoitteet. Ne näkyvät näkymän yläreunassa, ja rikkoutunut tavoite näkyy varoituksena."))}</p>
      ${list || `<p class="fd-note">${esc(t("Ei tavoitteita vielä."))}</p>`}
    </section>
    <section class="fd-section"><h4>${esc(t("Lisää tavoite"))}</h4>${byLens}</section>
  </div>`;
}

// ---------------------------------------------------------------------------
// Sesongit ja kriisit
// ---------------------------------------------------------------------------

export function renderSeasons(m: Molecule, v: FlowView): string {
  const factors = m.seasonality && m.seasonality.length === 12 ? m.seasonality : SEASON_PROFILES.flat.factors;
  const maxF = Math.max(1, ...factors);
  const bars = factors
    .map((f, i) => `<div class="ss-col"><div class="ss-bar" style="height:${Math.round((f / maxF) * 60)}px"></div>${numberInput(`data-season-month="${i}"`, f, { step: 0.05 })}<span>${esc(monthName(i))}</span></div>`)
    .join("");
  const profiles = (Object.keys(SEASON_PROFILES) as SeasonProfileId[])
    .map((id) => `<button class="wg-tpl" data-action="season-profile" data-id="${id}"><b>${esc(t(SEASON_PROFILES[id].title))}</b><span>${esc(t(SEASON_PROFILES[id].hint))}</span></button>`)
    .join("");
  const startOptions = Array.from({ length: 12 }, (_, i) => `<option value="${i}" ${(m.startMonth ?? 0) === i ? "selected" : ""}>${esc(monthName(i))}</option>`).join("");
  const events = (m.events ?? [])
    .map((e) => {
      const months = v.sim.months.filter((mo) => mo.activeEvents.includes(e.title));
      const profit = months.reduce((s, mo) => s + mo.operatingProfit, 0);
      return `<div class="sc-row"><b>⚡ ${esc(e.title)}</b><span class="fd-note">${esc(e.durationMonths > 1 ? t("kk {start}–{end}", { start: e.startMonth + 1, end: e.startMonth + e.durationMonths }) : t("kk {start}", { start: e.startMonth + 1 }))} · ${esc(describeEventEffects(e))} · ${esc(t("tulos jaksolla {amount}", { amount: money(profit) }))}</span>
        <button class="fd-icon-btn" data-action="event-remove" data-id="${esc(e.id)}" aria-label="${esc(t("Poista"))}">✕</button></div>`;
    })
    .join("");
  const monthOptions = Array.from({ length: 12 }, (_, i) => `<option value="${i}">${esc(t("kuukausi {n}", { n: i + 1 }))}${v.varies || m.startMonth ? ` (${esc(monthName(((m.startMonth ?? 0) + i) % 12))})` : ""}</option>`).join("");
  const cards = CRISIS_LIBRARY.map(
    (c) => `<div class="cr-card"><b>${esc(t(c.title))}</b><span>${esc(t(c.description))}</span><em>${esc(describeEventEffects(c))} · ${esc(t("{n} kk", { n: c.durationMonths }))}</em>
      <button class="fd-chip small" data-action="event-add" data-id="${esc(c.id)}">${esc(t("Lisää malliin"))}</button></div>`,
  ).join("");
  return `${drawerHeader(t("Sesongit ja kriisit"))}
  <div class="fd-body">
    <section class="fd-section">
      <h4>${esc(t("Kausivaihtelu"))}</h4>
      <p class="fd-note">${esc(t("Kerroin kertoo kysynnän suhteessa tavalliseen kuukauteen (1 = tavallinen, 2 = kaksinkertainen). Toimituskyky rajoittaa edelleen."))}</p>
      <div class="wg-tpls">${profiles}</div>
      <div class="ss-grid">${bars}</div>
      <div class="fd-inputs"><label>${esc(t("Simulaatio alkaa"))} <select data-start-month>${startOptions}</select></label></div>
    </section>
    <section class="fd-section">
      <h4>${esc(t("Tapahtumat mallissa"))}</h4>
      ${events || `<p class="fd-note">${esc(t("Ei tapahtumia. Lisää kriisi alta tai kokeile satunnaista."))}</p>`}
      <button class="fd-chip" data-action="event-random">🎲 ${esc(t("Satunnainen kriisi"))}</button>
    </section>
    <section class="fd-section">
      <h4>${esc(t("Kriisikortit"))}</h4>
      <div class="fd-inputs"><label>${esc(t("Alkaa"))} <select id="ev-month">${monthOptions.replace('value="2"', 'value="2" selected')}</select></label></div>
      <div class="cr-grid">${cards}</div>
      <p class="fd-note">${esc(t("Vaikutukset ovat esimerkkejä, eivät ennusteita. Valmentaja ehdottaa vastatoimia, kun tapahtuma on lisätty."))}</p>
    </section>
  </div>`;
}

// ---------------------------------------------------------------------------
// Raportti
// ---------------------------------------------------------------------------

/** Pieni Markdown → HTML -muunnin raportin esikatseluun (otsikot, listat, taulukot, lihavointi). */
export function markdownToHtml(md: string): string {
  const inline = (s: string) =>
    esc(s)
      .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
      .replace(/\*(.+?)\*/g, "<i>$1</i>")
      .replace(/\[(.+?)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  const out: string[] = [];
  const lines = md.split("\n");
  let i = 0;
  while (i < lines.length) {
    const l = lines[i];
    if (l.startsWith("|")) {
      const rows: string[] = [];
      while (i < lines.length && lines[i].startsWith("|")) rows.push(lines[i++]);
      const cells = (r: string) => r.split("|").slice(1, -1).map((c) => c.trim());
      out.push(`<table class="fd-table"><thead><tr>${cells(rows[0]).map((c) => `<th>${inline(c)}</th>`).join("")}</tr></thead><tbody>${rows
        .slice(2)
        .map((r) => `<tr>${cells(r).map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`)
        .join("")}</tbody></table>`);
      continue;
    }
    if (l.startsWith("- ")) {
      const items: string[] = [];
      while (i < lines.length && lines[i].startsWith("- ")) items.push(lines[i++].slice(2));
      out.push(`<ul>${items.map((x) => `<li>${inline(x.replace(/^\[( |x)\] /, (_m, c: string) => (c === "x" ? "☑ " : "☐ ")))}</li>`).join("")}</ul>`);
      continue;
    }
    const h = /^(#{1,3}) (.*)$/.exec(l);
    if (h) out.push(`<h${h[1].length + 1}>${inline(h[2])}</h${h[1].length + 1}>`);
    else if (l.trim()) out.push(`<p>${inline(l)}</p>`);
    i += 1;
  }
  return out.join("\n");
}

export function renderReport(md: string): string {
  return `${drawerHeader(t("Raportti"))}
  <div class="fd-body">
    <section class="fd-section">
      <div class="fd-chips">
        <button class="fl-btn primary" data-action="report-download">⬇ ${esc(t("Lataa (.md)"))}</button>
        <button class="fl-btn" data-action="report-copy">${esc(t("Kopioi"))}</button>
        <button class="fl-btn" data-action="report-print">🖨 ${esc(t("Tulostettava versio"))}</button>
      </div>
      <p class="fd-note">${esc(t("Raportti päivittyy mallin mukana. Markdown-tiedoston voi avata esim. Wordissa, Google Docsissa tai Notionissa."))}</p>
    </section>
    <section class="fd-section rp-preview">${markdownToHtml(md)}</section>
  </div>`;
}

// ---------------------------------------------------------------------------
// Toteuma vs. suunnitelma
// ---------------------------------------------------------------------------

export function renderActuals(v: FlowView, actuals: MonthlyActual[]): string {
  if (actuals.length === 0) {
    return `${drawerHeader(t("Toteuma vs. suunnitelma"))}
    <div class="fd-body"><section class="fd-section">
      <p>${esc(t("Tuo tiliote, niin APEX vertaa toteutuneita tuloja ja menoja suunnitelmaasi kuukausittain."))}</p>
      <button class="fl-btn primary" data-action="import-open">📄 ${esc(t("Tuo tiliote (CSV)"))}</button>
    </section></div>`;
  }
  const c = compareActuals(v.sim, actuals);
  const rows = c.rows
    .map(
      (r) => `<tr><td>${esc(r.month)}</td><td>${money(r.plannedRevenue)}</td><td>${money(r.actualRevenue)}</td>
      <td class="${r.revenueDiff < 0 ? "bad" : "good"}">${signedEur(r.revenueDiff)}${r.revenueDiffRatio !== null ? ` (${pct(r.revenueDiffRatio)})` : ""}</td>
      <td>${money(r.plannedCosts)}</td><td>${money(r.actualCosts)}</td><td class="${r.actualProfit < 0 ? "bad" : ""}">${money(r.actualProfit)}</td></tr>`,
    )
    .join("");
  return `${drawerHeader(t("Toteuma vs. suunnitelma"))}
  <div class="fd-body">
    <section class="fd-section">
      <div class="fd-kpis">
        <div><span>${esc(t("Myynti: suunnitelma"))}</span><b>${money(c.totalPlannedRevenue)}</b></div>
        <div><span>${esc(t("Myynti: toteuma"))}</span><b>${money(c.totalActualRevenue)}</b></div>
        <div><span>${esc(t("Tulos: suunnitelma"))}</span><b>${money(c.totalPlannedProfit)}</b></div>
        <div><span>${esc(t("Tulos: toteuma"))}</span><b class="${c.totalActualProfit < 0 ? "bad" : ""}">${money(c.totalActualProfit)}</b></div>
      </div>
      <table class="fd-table fd-table-compact"><thead><tr><th>${esc(t("kk"))}</th><th>${esc(t("Myynti suunn."))}</th><th>${esc(t("Myynti tot."))}</th><th>${esc(t("Ero"))}</th><th>${esc(t("Kulut suunn."))}</th><th>${esc(t("Kulut tot."))}</th><th>${esc(t("Tulos tot."))}</th></tr></thead><tbody>${rows}</tbody></table>
      <p class="fd-note">${esc(t("Mallin kuukausi 1 rinnastetaan tiliotteen ensimmäiseen kuukauteen. Toteuman menoista on poistettu verot, omat siirrot ja nostot."))}</p>
      <div class="fd-chips"><button class="fd-chip" data-action="import-open">📄 ${esc(t("Päivitä tiliotteella"))}</button><button class="fd-chip" data-action="actuals-clear">${esc(t("Poista toteuma"))}</button></div>
    </section>
  </div>`;
}

// ---------------------------------------------------------------------------
// Harjoitustehtävät
// ---------------------------------------------------------------------------

export interface TaskState {
  id: string;
  start: Molecule;
}

export function renderTasks(active: TaskState | null, completed: string[], progress: { done: boolean; progress: string } | null): string {
  const list = TASKS.map((d) => {
    const isActive = active?.id === d.id;
    const done = completed.includes(d.id);
    return `<div class="tk-card ${isActive ? "active" : ""}">
      <div class="tk-head"><b>${done ? "✅ " : ""}${esc(t(d.title))}</b>${isActive ? `<span class="lp-tag">${esc(t("käynnissä"))}</span>` : ""}</div>
      <p>${esc(t(d.brief))}</p>
      <p><b>${esc(t("Tavoite:"))}</b> ${esc(t(d.goal))}</p>
      ${isActive && progress ? `<p class="${progress.done ? "good" : "fd-warn"}">${esc(progress.progress)}</p><details><summary>${esc(t("Vihje"))}</summary><p>${esc(t(d.hint))}</p></details>` : ""}
      ${done || isActive ? `<p class="fd-note">${esc(t("Opit: {learn}", { learn: t(d.learn) }))}</p>` : ""}
      <button class="fd-chip small" data-action="task-start" data-id="${esc(d.id)}">${esc(isActive ? t("Aloita alusta") : t("Aloita"))}</button>
    </div>`;
  }).join("");
  return `${drawerHeader(t("Harjoitustehtävät"))}
  <div class="fd-body">
    <section class="fd-section">
      <p class="fd-note">${esc(t("Jokaisessa tehtävässä on valmis lähtötilanne ja tavoite. Ratkaise se vivuilla, paneeleilla tai valmentajan avulla – tapoja on useita. Tehtävän aloitus korvaa nykyisen mallin (voit tallentaa sen ensin skenaarioksi)."))}</p>
      <div class="tk-list">${list}</div>
    </section>
  </div>`;
}

export function renderTaskBanner(active: TaskState | null, progress: { done: boolean; progress: string } | null): string {
  if (!active || !progress) return "";
  const def = TASKS.find((d) => d.id === active.id);
  if (!def) return "";
  return `<div class="tk-banner ${progress.done ? "done" : ""}">
    <b>${progress.done ? "🎉 " + esc(t("Tehtävä ratkaistu!")) : "🎯 " + esc(t(def.title))}</b>
    <span>${esc(t(def.goal))}</span><span class="tk-progress">${esc(progress.progress)}</span>
    <button class="fd-chip small" data-action="open" data-node="tasks">${esc(t("Tehtävät"))}</button>
    <button class="fd-chip small" data-action="task-exit">${esc(t("Lopeta tehtävä"))}</button>
  </div>`;
}

// ---------------------------------------------------------------------------
// Markkinatieto
// ---------------------------------------------------------------------------

export interface MarketState {
  busy: boolean;
  error: string | null;
  query: string;
  result: {
    signals: { title: string; url: string; snippet: string }[];
    suggestions: { atomId: string; field: string; value: number; current: number | null; rationale: string; source: { title: string; url: string } | null }[];
    summary: string;
  } | null;
}

export function renderMarket(m: Molecule, st: MarketState, llm: boolean): string {
  const r = st.result;
  const sugg = r
    ? r.suggestions
        .map((s, i) => {
          const atom = m.atoms.find((a) => a.id === s.atomId);
          return `<div class="mk-row">
            <div><b>${esc(atom?.label ?? "")}: ${esc(fieldLabel(s.field))}</b> ${s.current !== null ? `${esc(num(s.current, 2))} → ` : ""}<b>${esc(num(s.value, 2))}</b></div>
            <div class="fd-note">${esc(s.rationale)}</div>
            <div class="fd-note">${s.source ? `${esc(t("Lähde:"))} <a href="${esc(s.source.url)}" target="_blank" rel="noopener">${esc(s.source.title)}</a>` : `<span class="fd-warn">${esc(t("Kielimallin arvio – ei lähdettä, tarkista itse"))}</span>`}</div>
            <button class="fd-chip small" data-action="market-apply" data-idx="${i}">${esc(t("Käytä tätä arvoa"))}</button>
          </div>`;
        })
        .join("")
    : "";
  const signals = r && r.signals.length
    ? `<h4>${esc(t("Haetut lähteet"))}</h4><ul class="fd-list">${r.signals.map((s) => `<li><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title)}</a> – ${esc(s.snippet.slice(0, 160))}</li>`).join("")}</ul>`
    : "";
  return `${drawerHeader(t("Markkinatieto"))}
  <div class="fd-body">
    <section class="fd-section">
      <p class="fd-note">${esc(t("Hae tietoa toimialastasi. Kielimalli arvioi oletustesi realistisuutta ja ehdottaa korjauksia. Lähteeksi merkitään vain oikeasti haettu sivu; muut ehdotukset merkitään arvioiksi."))}</p>
      <div class="co-form"><input id="mk-query" maxlength="120" value="${esc(st.query || m.name)}"/><button class="fl-btn primary" data-action="market-run" ${st.busy ? "disabled" : ""}>${st.busy ? "…" : esc(t("Hae"))}</button></div>
      ${!llm ? `<p class="fd-note">${esc(t("Lukujen ehdottaminen vaatii kielimallin (oma API-avain). Ilman sitä näytetään vain haetut lähteet."))}</p>` : ""}
      ${st.error ? `<p class="fd-warn">${esc(st.error)}</p>` : ""}
    </section>
    ${r ? `<section class="fd-section">${r.summary ? `<p>${esc(r.summary)}</p>` : ""}${sugg || `<p class="fd-note">${esc(t("Ei korjausehdotuksia."))}</p>`}${signals}</section>` : ""}
  </div>`;
}

// ---------------------------------------------------------------------------
// Neuvonantajat
// ---------------------------------------------------------------------------

export interface AdvisorsState {
  busy: boolean;
  question: string;
  result: { statements: { role: AdvisorRole; text: string }[]; consensus: string; proposals: { label: string; commands: FlowCommand[] }[]; source: "llm" | "rules"; note?: string } | null;
}

export function renderAdvisors(rule: AdvisorView[], st: AdvisorsState, llm: boolean): string {
  const stanceIcon = { ok: "🟢", concern: "🟡", alarm: "🔴" } as const;
  const cards = rule
    .map(
      (a) => `<article class="ad-card stance-${a.stance}">
      <div class="ad-head"><span>${ADVISORS[a.role].icon}</span><b>${esc(t(ADVISORS[a.role].title))}</b><span>${stanceIcon[a.stance]}</span></div>
      ${a.summary ? `<div class="co-title">${esc(a.summary)}</div>` : ""}
      <ul class="fd-list">${a.points.slice(0, 4).map((p) => `<li>${esc(p)}</li>`).join("")}</ul>
      ${a.actions.length ? `<div class="co-actions">${a.actions.map((ac, i) => `<button class="fd-chip small" data-action="adv-rule-act" data-role="${a.role}" data-idx="${i}">${esc(ac.label)}</button>`).join("")}</div>` : ""}
    </article>`,
    )
    .join("");
  const r = st.result;
  const debate = r
    ? `<section class="fd-section">
        <h4>${esc(r.source === "llm" ? t("Neuvonantajien keskustelu") : t("Neuvonantajien näkemykset"))}</h4>
        ${r.statements.map((s) => `<div class="co-msg coach"><b>${ADVISORS[s.role].icon} ${esc(t(ADVISORS[s.role].title))}:</b> ${esc(s.text)}</div>`).join("")}
        ${r.consensus ? `<p><b>${esc(t("Yhteinen näkemys:"))}</b> ${esc(r.consensus)}</p>` : ""}
        ${r.proposals.length ? `<div class="co-actions">${r.proposals.map((p, i) => `<button class="fd-chip" data-action="adv-apply" data-idx="${i}">${esc(p.label)}</button>`).join("")}</div>` : ""}
        ${r.note ? `<p class="co-note">${esc(r.note)}</p>` : ""}
      </section>`
    : "";
  return `${drawerHeader(t("Neuvonantajat"))}
  <div class="fd-body">
    <section class="fd-section">
      <p class="fd-note">${esc(t("Neljä neuvonantajaa katsoo samaa mallia oman roolinsa silmin. Ehdotukset kulkevat samojen tarkistusten läpi kuin valmentajan muutokset, ja ne voi kumota."))}</p>
      <div class="ad-grid">${cards}</div>
    </section>
    <section class="fd-section">
      <h4>${esc(t("Kysy neuvonantajilta"))}</h4>
      <div class="co-form"><input id="adv-q" maxlength="600" value="${esc(st.question)}" placeholder="${esc(t("Esim. Kannattaako palkata toinen työntekijä nyt?"))}"/><button class="fl-btn primary" data-action="adv-ask" ${st.busy ? "disabled" : ""}>${st.busy ? "…" : esc(t("Kysy"))}</button></div>
      ${!llm ? `<p class="fd-note">${esc(t("Ilman kielimallia neuvonantajat vastaavat sääntöpohjaisesti mallin luvuilla."))}</p>` : ""}
    </section>
    ${debate}
  </div>`;
}

