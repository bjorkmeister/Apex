/**
 * APEX Studio — omat widgetit käyttöliittymässä (`src/flow/client/widgets.ts`).
 */
import {
  availableTemplates,
  evaluateWidget,
  formatWidgetValue,
  vocabulary,
  type WidgetContext,
  type WidgetResult,
  type WidgetSpec,
} from "../model/widgets.ts";
import { esc } from "../model/format.ts";
import { msg, t } from "../i18n/index.ts";
import { drawerHeader } from "./drawer.ts";

const SERIES_COLORS = ["#38bdf8", "#f472b6", "#facc15"];

const KIND_LABELS: Record<WidgetSpec["kind"], string> = {
  metric: msg("Mittari"),
  alert: msg("Hälytys"),
  lever: msg("Vipu"),
  chart: msg("Kuvaaja"),
  table: msg("Taulukko"),
};

function miniChart(w: Extract<WidgetSpec, { kind: "chart" }>, r: Extract<WidgetResult, { kind: "chart" }>): string {
  const W = 300;
  const H = 90;
  const pad = 6;
  const all = r.series.flatMap((s) => s.values).filter(Number.isFinite);
  if (all.length === 0) return "";
  const max = Math.max(0, ...all);
  const min = Math.min(0, ...all);
  const span = Math.max(1e-9, max - min);
  const n = Math.max(1, r.series[0]?.values.length ?? 1);
  const x = (i: number) => pad + (i / Math.max(1, n - 1)) * (W - pad * 2);
  const y = (v: number) => pad + ((max - v) / span) * (H - pad * 2);
  const zero = y(0);
  let body = "";
  if (w.style === "bar") {
    const groupW = (W - pad * 2) / n;
    const barW = Math.max(2, (groupW - 4) / r.series.length);
    r.series.forEach((s, si) => {
      s.values.forEach((v, i) => {
        const top = Math.min(y(v), zero);
        body += `<rect x="${(pad + i * groupW + 2 + si * barW).toFixed(1)}" y="${top.toFixed(1)}" width="${barW.toFixed(1)}" height="${Math.abs(y(v) - zero).toFixed(1)}" fill="${v < 0 ? "#f87171" : SERIES_COLORS[si]}"><title>${esc(`${s.label} ${i + 1}: ${formatWidgetValue(v, w.format)}`)}</title></rect>`;
      });
    });
  } else {
    r.series.forEach((s, si) => {
      body += `<polyline fill="none" stroke="${SERIES_COLORS[si]}" stroke-width="2" points="${s.values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ")}"/>`;
    });
  }
  const legend = r.series.length > 1 ? `<div class="wg-legend">${r.series.map((s, i) => `<span><i style="background:${SERIES_COLORS[i]}"></i>${esc(s.label)}</span>`).join("")}</div>` : "";
  return `<svg viewBox="0 0 ${W} ${H}" class="wg-chart" preserveAspectRatio="none"><line x1="0" x2="${W}" y1="${zero}" y2="${zero}" class="tl-zero"/>${body}</svg>
    <div class="wg-range"><span>${esc(formatWidgetValue(min, w.format))}</span><span>${esc(formatWidgetValue(max, w.format))}</span></div>${legend}`;
}

function widgetBody(w: WidgetSpec, r: WidgetResult): string {
  if (r.error) return `<div class="wg-error">⚠ ${esc(r.error)}</div>`;
  switch (w.kind) {
    case "metric":
      return `<div class="wg-value">${esc((r as Extract<WidgetResult, { kind: "metric" }>).text)}</div>`;
    case "alert": {
      const active = (r as Extract<WidgetResult, { kind: "alert" }>).active;
      return active ? `<div class="wg-alert sev-${w.severity}">${esc(w.message)}</div>` : `<div class="wg-ok">✓ ${esc(t("Kunnossa"))}</div>`;
    }
    case "lever": {
      const lr = r as Extract<WidgetResult, { kind: "lever" }>;
      if (!lr.leverId) return "";
      return `<div class="lv-top"><span></span><output data-widget-out="${esc(w.id)}">${esc(formatWidgetValue(lr.value, w.format))}</output></div>
        <input type="range" data-lever="${esc(lr.leverId)}" data-widget-fmt="${esc(w.format)}" data-widget-id="${esc(w.id)}" min="${w.min}" max="${w.max}" step="${w.step}" value="${lr.value}"/>`;
    }
    case "chart":
      return miniChart(w, r as Extract<WidgetResult, { kind: "chart" }>);
    case "table":
      return `<table class="wg-table">${(r as Extract<WidgetResult, { kind: "table" }>).rows.map((row) => `<tr><td>${esc(row.label)}</td><td>${esc(row.text)}</td></tr>`).join("")}</table>`;
  }
}

/** Päänäkymän widgettikaista (vain päällä olevat). */
export function renderWidgetStrip(widgets: WidgetSpec[], ctx: WidgetContext): string {
  const on = widgets.filter((w) => w.enabled);
  if (on.length === 0) return "";
  return `<div class="wg-strip">${on
    .map((w) => {
      const r = evaluateWidget(w, ctx);
      const alertActive = w.kind === "alert" && r.kind === "alert" && r.active;
      return `<article class="wg-card kind-${w.kind}${alertActive ? " active" : ""}" title="${esc(w.description ?? w.prompt ?? "")}">
        <div class="wg-head"><span class="wg-title">${esc(w.title)}</span>${w.origin === "ai" ? `<span class="wg-ai" title="${esc(t("Tekoälyn luoma"))}">✨</span>` : ""}
          <button class="wg-x" data-action="widget-toggle" data-id="${esc(w.id)}" aria-label="${esc(t("Piilota"))}" title="${esc(t("Piilota"))}">✕</button></div>
        ${widgetBody(w, r)}
      </article>`;
    })
    .join("")}</div>`;
}

export interface WidgetPanelState {
  llm: boolean;
  busy: boolean;
  error: string | null;
  lastPrompt: string;
}

export function renderWidgetPanel(widgets: WidgetSpec[], ctx: WidgetContext, st: WidgetPanelState): string {
  const templates = availableTemplates(ctx.molecule)
    .map((tpl) => `<button class="wg-tpl" data-action="widget-template" data-id="${esc(tpl.id)}"><b>${esc(t(tpl.title))}</b><span>${esc(t(tpl.description))}</span></button>`)
    .join("");
  const list = widgets
    .map((w) => {
      const r = evaluateWidget(w, ctx);
      const editable = w.kind === "metric" ? w.formula : w.kind === "alert" ? w.condition : null;
      return `<div class="wg-row">
        <label class="wg-switch"><input type="checkbox" data-widget-enable="${esc(w.id)}" ${w.enabled ? "checked" : ""}/><span></span></label>
        <div class="wg-row-main">
          <div class="wg-row-title">${esc(w.title)} <span class="lp-tag">${esc(t(KIND_LABELS[w.kind]))}</span>${w.origin === "ai" ? ` <span class="lp-tag">✨ ${esc(t("tekoälyn luoma"))}</span>` : ""}</div>
          ${w.prompt ? `<div class="fd-note">${esc(t("Pyyntö: {prompt}", { prompt: w.prompt }))}</div>` : ""}
          ${editable !== null ? `<input class="wg-formula" data-widget-formula="${esc(w.id)}" value="${esc(editable)}" spellcheck="false" aria-label="${esc(t("Kaava"))}"/>` : ""}
          ${r.error ? `<div class="wg-error">⚠ ${esc(r.error)}</div>` : ""}
        </div>
        <button class="fd-icon-btn" data-action="widget-delete" data-id="${esc(w.id)}" aria-label="${esc(t("Poista"))}">✕</button>
      </div>`;
    })
    .join("");
  const vocab = vocabulary(ctx.molecule)
    .map((v) => `<li><code>${esc(v.name)}</code> ${esc(v.description)}</li>`)
    .join("");
  return `${drawerHeader(t("Omat widgetit"))}
  <div class="fd-body">
    <section class="fd-section">
      <h4>✨ ${esc(t("Pyydä uusi widgetti omin sanoin"))}</h4>
      ${
        st.llm
          ? `<form class="co-form" id="wg-form">
              <input id="wg-input" autocomplete="off" maxlength="1000" value="${esc(st.lastPrompt)}" placeholder="${esc(t("Esim. Näytä kate per työtunti ja varoita, jos se on alle 40 €"))}" ${st.busy ? "disabled" : ""}/>
              <button class="fl-btn primary" type="submit" ${st.busy ? "disabled" : ""}>${st.busy ? "…" : esc(t("Luo"))}</button>
            </form>
            <p class="fd-note">${esc(t("Kielimalli kirjoittaa widgetin kuvauksen, ei ohjelmakoodia. Kuvaus tarkistetaan ennen kuin se lisätään. Käyttää omaa API-avaintasi."))}</p>`
          : `<p class="fd-note">${esc(t("Omien widgettien luonti omin sanoin vaatii kielimallin (oma API-avain klassisen näkymän asetuksissa). Valmiit pohjat alla toimivat ilman."))}</p>`
      }
      ${st.error ? `<p class="fd-warn">${esc(st.error)}</p>` : ""}
    </section>
    <section class="fd-section">
      <h4>${esc(t("Valmiit pohjat"))}</h4>
      <div class="wg-tpls">${templates}</div>
    </section>
    <section class="fd-section">
      <h4>${esc(t("Omat widgetit"))}</h4>
      ${list || `<p class="fd-note">${esc(t("Ei vielä widgettejä. Lisää pohjasta tai pyydä omin sanoin."))}</p>`}
    </section>
    <section class="fd-section">
      <details><summary>${esc(t("Kaavoissa käytettävät muuttujat"))}</summary>
        <p class="fd-note">${esc(t("Kaavoissa voi käyttää lukuja, + − × ÷, vertailuja ja funktioita min, max, abs, round, if."))}</p>
        <ul class="wg-vocab">${vocab}</ul>
      </details>
    </section>
  </div>`;
}
