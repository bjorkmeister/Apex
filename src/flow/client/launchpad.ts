/**
 * APEX Studio — perustajan muistilistan paneeli (`src/flow/client/launchpad.ts`).
 */
import { STEP_TITLES, VAT_THRESHOLD_EUR, type ChecklistView, type ItemView, type LaunchStep } from "../model/launchpad.ts";
import { esc, int } from "../model/format.ts";
import { t } from "../i18n/index.ts";
import { drawerHeader } from "./drawer.ts";

function itemHtml(i: ItemView): string {
  const id = esc(i.def.id);
  const icon = i.status === "done" ? "✓" : i.status === "attention" ? "!" : "";
  const title = t(i.def.title);
  const control =
    i.def.mode === "manual"
      ? `<input type="checkbox" class="lp-check" data-lp-toggle="${id}" ${i.checked ? "checked" : ""} aria-label="${esc(title)}"/>`
      : `<span class="lp-auto st-${i.status}" title="${esc(t("APEX tarkistaa tämän mallista automaattisesti"))}">${icon || "○"}</span>`;
  const params = (i.def.params ?? [])
    .map(
      (p) => `<label class="lp-param">${esc(t(p.label))}
        <span class="fd-input"><input type="number" step="${p.step}" data-lp-param="${id}:${esc(p.key)}" value="${i.params[p.key]}"/><em>${esc(t(p.unit))}</em></span>
      </label>`,
    )
    .join("");
  return `<li class="lp-item st-${i.status}">
    <div class="lp-row">
      ${control}
      <div class="lp-text">
        <div class="lp-title">${esc(title)}${i.def.mode === "auto" ? `<span class="lp-tag">${esc(t("tarkistetaan mallista"))}</span>` : ""}</div>
        <div class="lp-why">${esc(t(i.def.why, { threshold: int(VAT_THRESHOLD_EUR) }))}</div>
        ${i.effect ? `<div class="lp-effect">${esc(t("Vaikutus malliin:"))} <b>${esc(i.effect)}</b></div>` : ""}
        ${i.note ? `<div class="lp-note">${esc(i.note)}</div>` : ""}
        ${params ? `<div class="lp-params">${params}</div>` : ""}
        ${i.def.source ? `<div class="lp-source">${esc(t("Tarkista:"))} ${esc(t(i.def.source))}</div>` : ""}
        ${i.def.open && i.status !== "done" ? `<button class="fd-chip small" data-action="open" data-node="${esc(i.def.open)}">${esc(t("Tee tämä mallissa ›"))}</button>` : ""}
      </div>
    </div>
  </li>`;
}

export function renderLaunchpad(view: ChecklistView): string {
  const steps = ([1, 2, 3, 4, 5] as LaunchStep[])
    .map((s) => {
      const items = view.items.filter((i) => i.def.step === s);
      if (items.length === 0) return "";
      const done = items.filter((i) => i.status === "done").length;
      return `<section class="fd-section">
        <h4>${s}. ${esc(t(STEP_TITLES[s]))} <span class="lp-count">${done}/${items.length}</span></h4>
        <ul class="lp-list">${items.map(itemHtml).join("")}</ul>
      </section>`;
    })
    .join("");
  const pctDone = view.total > 0 ? Math.round((view.done / view.total) * 100) : 0;
  return `${drawerHeader(t("Perustamislista"))}
  <div class="fd-body">
    <section class="fd-section">
      <div class="lp-progress"><div style="width:${pctDone}%"></div></div>
      <p class="fd-note">${esc(t("{done} / {total} valmiina. Kohdat, joilla on rahavaikutus, päivittävät mallin heti – näet vaikutuksen kassaan ja kannattavuuteen. Ruksin poisto peruu vaikutuksen.", { done: view.done, total: view.total }))}</p>
    </section>
    ${steps}
    <p class="fd-note">${esc(t("Viranomaismaksut ja -prosentit ovat muokattavia arvioita. Tarkista ajantasaiset luvut mainituista lähteistä ennen päätöksiä."))}</p>
  </div>`;
}
