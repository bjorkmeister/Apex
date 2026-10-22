/**
 * APEX Flow — valmentajan näkymät (`src/flow/client/coach.ts`).
 */
import type { CoachInsight } from "../model/coach.ts";
import { RULE_EXAMPLES } from "../model/intent.ts";
import { esc } from "../model/format.ts";

export interface ChatMessage {
  role: "user" | "coach";
  text: string;
  applied?: string[];
  note?: string;
  source?: "llm" | "rules";
  pending?: boolean;
}

const ICON: Record<CoachInsight["severity"], string> = { alert: "⚠️", warn: "🟡", tip: "💡", good: "✅" };

function insightCard(i: CoachInsight, teach: boolean, compact: boolean): string {
  const actions = i.actions
    .map((a, idx) => `<button class="fd-chip small" data-action="coach-act" data-insight="${esc(i.id)}" data-idx="${idx}">${esc(a.label)}</button>`)
    .join("");
  return `<article class="co-card sev-${i.severity}${compact ? " compact" : ""}">
    <div class="co-title"><span aria-hidden="true">${ICON[i.severity]}</span> ${esc(i.title)}</div>
    <div class="co-body">${esc(i.body)}</div>
    ${teach && i.learn ? `<div class="co-learn"><b>Opi:</b> ${esc(i.learn)}</div>` : ""}
    ${actions ? `<div class="co-actions">${actions}</div>` : ""}
  </article>`;
}

/** Päänäkymän valmentajakaista: enintään kaksi tärkeintä havaintoa. */
export function renderCoachStrip(insights: CoachInsight[], teach: boolean): string {
  const top = insights.slice(0, 2);
  const more = insights.length - top.length;
  return `<div class="co-strip">
    ${top.map((i) => insightCard(i, teach, true)).join("")}
    <button class="co-open" data-action="open" data-node="coach">💬 Kysy valmentajalta${more > 0 ? ` · ${more} havaintoa lisää` : ""} ›</button>
  </div>`;
}

function messageHtml(m: ChatMessage): string {
  if (m.role === "user") return `<div class="co-msg user"><div class="co-text">${esc(m.text)}</div></div>`;
  const parts = [
    `<div class="co-text">${esc(m.text)}</div>`,
    m.applied && m.applied.length ? `<ul class="co-applied">${m.applied.map((a) => `<li>✓ ${esc(a)}</li>`).join("")}</ul>` : "",
    m.note ? `<div class="co-note">${esc(m.note)}</div>` : "",
    m.source ? `<div class="co-source">${m.source === "llm" ? "kielimalli" : "sääntöpohjainen tulkki"}</div>` : "",
  ];
  return `<div class="co-msg coach${m.pending ? " pending" : ""}">${parts.join("")}</div>`;
}

export function renderCoachPanel(insights: CoachInsight[], chat: ChatMessage[], teach: boolean, busy: boolean): string {
  const log = chat.length
    ? chat.slice(-30).map(messageHtml).join("")
    : `<div class="co-msg coach">Hei! Voit pyytää muutoksia omin sanoin, esimerkiksi:
        <div class="fd-chips">${RULE_EXAMPLES.slice(0, 5).map((e) => `<button class="fd-chip small" data-action="chat-example" data-text="${esc(e)}">${esc(e)}</button>`).join("")}</div>
      </div>`;
  return `<div class="fd-header"><h2>Valmentaja</h2><button class="fd-close" data-action="close-drawer" aria-label="Sulje">✕</button></div>
  <div class="fd-body">
    <section class="fd-section">
      <div class="co-log" id="co-log">${log}</div>
      <form class="co-form" id="co-form">
        <input id="co-input" autocomplete="off" placeholder="Esim. Lisää kuukausisopimukset 300 € / kk" maxlength="2000" ${busy ? "disabled" : ""}/>
        <button class="fl-btn primary" type="submit" ${busy ? "disabled" : ""}>${busy ? "…" : "Lähetä"}</button>
      </form>
      <p class="fd-note">Valmentaja muuttaa mallia vain tarkistetuilla komennoilla. Voit perua jokaisen muutoksen ↶ Kumoa -napista.</p>
    </section>
    <section class="fd-section">
      <h4>Havainnot mallistasi</h4>
      ${insights.map((i) => insightCard(i, teach, false)).join("") || `<p class="fd-note">Ei havaintoja.</p>`}
    </section>
  </div>`;
}
