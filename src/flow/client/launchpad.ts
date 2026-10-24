/**
 * APEX Studio v3.2 — On-Canvas Launchpad, Kypsyystasojen 0–1 Aukkoanalyysi & 8-vaiheinen Architect Mode
 * (`src/flow/client/launchpad.ts`).
 *
 * Toteuttaa TSD v3.2 luvun 4.1, 4.4 ja 4.5 (Override 2 / Invariantti A2):
 * - Kypsyystasoilla 0–1 tehtävälista johdetaan suoraan `analyzeGaps(graph)`-aukkoanalyysistä.
 * - Kypsyystasoilla 2–3 jokainen rasti näyttää kohde-URI:n ja ICOM-porttikytkennän (`C` / `M`)
 *   ja päivittää graafin paikallisesti (< 16 ms) kumottavasti.
 * - Sisältää myös 8-vaiheisen `UniversalGenesisSpec` Architect Mode -näkymän.
 */
import {
  STEP_TITLES,
  VAT_THRESHOLD_EUR,
  type ChecklistView,
  type GraphLaunchpadView,
  type ItemView,
  type LaunchStep,
  type LaunchpadBindingTarget,
} from "../model/launchpad.ts";
import { CAPABILITY_TEMPLATE_LIST } from "../graph/gaps.ts";
import type { UniversalGenesisSpec } from "../graph/compiler.ts";
import { esc, int, money } from "../model/format.ts";
import { t } from "../i18n/index.ts";
import { drawerHeader } from "./drawer.ts";

function itemHtml(i: ItemView, binding?: LaunchpadBindingTarget): string {
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
  const bindingHtml = binding
    ? `<div class="lp-binding-badge">
        <span class="icom-badge icom-${binding.portSide}">${binding.portSide}</span>
        <span class="uri-mini">${esc(binding.targetUri)}</span>
        <span>${esc(binding.description)}</span>
      </div>`
    : "";
  return `<li class="lp-item st-${i.status}">
    <div class="lp-row">
      ${control}
      <div class="lp-text">
        <div class="lp-title">${esc(title)}${i.def.mode === "auto" ? `<span class="lp-tag">${esc(t("tarkistetaan mallista"))}</span>` : ""}</div>
        <div class="lp-why">${esc(t(i.def.why, { threshold: int(VAT_THRESHOLD_EUR) }))}</div>
        ${bindingHtml}
        ${i.effect ? `<div class="lp-effect">${esc(t("Vaikutus malliin:"))} <b>${esc(i.effect)}</b></div>` : ""}
        ${i.note ? `<div class="lp-note">${esc(i.note)}</div>` : ""}
        ${params ? `<div class="lp-params">${params}</div>` : ""}
        ${i.def.source ? `<div class="lp-source">${esc(t("Tarkista:"))} ${esc(t(i.def.source))}</div>` : ""}
        ${i.def.open && i.status !== "done" ? `<button class="fd-chip small" data-action="open" data-node="${esc(i.def.open)}">${esc(t("Tee tämä mallissa ›"))}</button>` : ""}
      </div>
    </div>
  </li>`;
}

export function renderGapDrivenLaunchpadSection(
  graphLp: GraphLaunchpadView,
  activeTemplateId?: string,
): string {
  const { gapReport, gapItems } = graphLp;
  const tplButtons = CAPABILITY_TEMPLATE_LIST.map(
    (tpl) => `<button
      type="button"
      class="fd-chip small ${ (activeTemplateId ?? gapReport.templateId) === tpl.id ? "on" : "" }"
      data-action="select-cap-template"
      data-template-id="${esc(tpl.id)}"
      title="${esc(t(tpl.description))}"
    >${esc(t(tpl.name))}</button>`,
  ).join("");

  return `
    <section class="fd-section lp-gap-section" data-launchpad-mode="${esc(graphLp.mode)}">
      <div class="ins-section-head-row">
        <h4>${esc(t("Aukkoanalyysi ja kyvykkyysvalmius (Taso 0–1)"))}</h4>
        <span class="uri-pill">${esc(t("Valmiusaste"))} ${int(gapReport.readinessScore)} %</span>
      </div>
      <p class="fd-note">${esc(t(gapReport.summaryText))}</p>
      <div class="lp-template-bar" style="display:flex;gap:6px;flex-wrap:wrap;margin:8px 0">
        ${tplButtons}
      </div>
      <div class="teach-callout" style="margin:8px 0">
        <strong>${esc(t("Seuraava askel:"))}</strong> ${esc(t(gapReport.advanceRecommendation))}
      </div>
      ${
        gapReport.stubWarnings.length > 0
          ? `<div class="st-banner-crit" style="padding:8px 10px;border-radius:8px;margin:8px 0">
              <strong>${esc(t("Katkenneet ylävirran virrat (Override 4):"))}</strong>
              <ul style="margin:4px 0 0 16px">
                ${gapReport.stubWarnings
                  .map(
                    (sw) =>
                      `<li>${esc(t(sw.fromNodeName))} → ${esc(t(sw.toNodeName))}: <em>${esc(t(sw.reason))}</em></li>`,
                  )
                  .join("")}
              </ul>
            </div>`
          : ""
      }
      <ul class="lp-list">
        ${gapItems
          .map(
            (g) => `
          <li class="lp-item ${g.checked ? "st-done" : g.status === "missing" ? "st-attention" : "st-todo"}">
            <div class="lp-row">
              <input
                type="checkbox"
                class="lp-check"
                data-lp-gap="gap:${esc(g.uri)}"
                ${g.checked ? "checked" : ""}
                aria-label="${esc(t(g.name))}"
              />
              <div class="lp-text">
                <div class="lp-title">
                  ${esc(t(g.name))}
                  <span class="lp-tag">${esc(g.status === "missing" ? t("Puuttuu") : t("Epäselvä"))}</span>
                </div>
                <div class="lp-why">${esc(t(g.rationale))}</div>
                <div class="lp-note"><strong>${esc(t("Seuraus jos puuttuu:"))}</strong> ${esc(t(g.consequence))}</div>
                ${
                  g.estimatedMonthlyCost > 0
                    ? `<div class="lp-effect">${esc(t("Alustava kuluvaikutus:"))} <b>${money(g.estimatedMonthlyCost)} / ${esc(t("kk"))}</b></div>`
                    : ""
                }
                ${
                  g.openQuestions.length > 0
                    ? `<div class="lp-source">${esc(t("Avoin kysymys:"))} ${esc(t(g.openQuestions[0]!))}</div>`
                    : ""
                }
              </div>
            </div>
          </li>`,
          )
          .join("")}
      </ul>
      <p class="fd-note" style="font-size:11px;opacity:0.8">
        ${esc(t("Lähde:"))} ${esc(t(gapReport.source))} (${esc(gapReport.updatedAt)}) · ${esc(t(gapReport.disclaimer))}
      </p>
    </section>
  `;
}

export function renderArchitectModeSection(spec: UniversalGenesisSpec): string {
  const numVal = (v: number | { const: number } | { factor: string } | undefined, fb = 0): number => {
    if (v === undefined) return fb;
    if (typeof v === "number") return v;
    if ("const" in v) return v.const;
    return fb;
  };

  return `
    <details class="fd-section architect-mode-section" open>
      <summary style="cursor:pointer;font-weight:600">
        🏗 ${esc(t("Architect Mode · 8-vaiheinen UniversalGenesisSpec-määrittely"))}
      </summary>
      <p class="fd-note" style="margin-top:6px">
        ${esc(
          t("Muokkaa suoraan mitä tahansa 8 Genesis-vaiheesta ja käännä deterministinen graafi uudelleen (Fast-Track === Architect Mode, Invariantti A2)."),
        )}
      </p>
      <div class="architect-steps-grid" style="display:grid;gap:10px;margin-top:10px">
        <div class="ins-muted-box">
          <strong>${esc(t("1. Ongelma ja tehtävä (L0-juuri)"))}</strong>
          <label class="lp-param" style="margin-top:4px">${esc(t("Organisaation nimi"))}
            <span class="fd-input"><input id="arch-s1-name" type="text" value="${esc(spec.step1Mission.name)}" /></span>
          </label>
        </div>

        <div class="ins-muted-box">
          <strong>${esc(t("2. Ratkaisu ja reseptit (FlowUnit & Fysiikkamoduulit)"))}</strong>
          <div class="fd-note">${esc(t("Arvovirtasolmuja:"))} <b>${spec.step2Recipes.offerings.length}</b> (${spec.step2Recipes.offerings.map((o) => esc(t(o.name))).join(", ") || "–"})</div>
        </div>

        <div class="ins-muted-box">
          <strong>${esc(t("3. Markkina ja aikadynamiikka (C-portit)"))}</strong>
          <label class="lp-param" style="margin-top:4px">${esc(t("Markkinakatto (yks/pv)"))}
            <span class="fd-input"><input id="arch-s3-cap" type="number" step="10" value="${numVal(spec.step3Market.demandCapPerTick, 500)}" /></span>
          </label>
        </div>

        <div class="ins-muted-box">
          <strong>${esc(t("4. Asiakkaat ja kanavat"))}</strong>
          <label class="lp-param" style="margin-top:4px">${esc(t("Jonotoleranssi (pv)"))}
            <span class="fd-input"><input id="arch-s4-queue" type="number" step="1" value="${numVal(spec.step4Channels.queueToleranceTicks, 7)}" /></span>
          </label>
        </div>

        <div class="ins-muted-box">
          <strong>${esc(t("5. Hankinta ja toimittajat (valinnainen)"))}</strong>
          <label class="lp-param" style="margin-top:4px">
            <input id="arch-s5-enabled" type="checkbox" ${spec.step5Sourcing?.enabled ? "checked" : ""} />
            ${esc(t("Kytke ylävirran hankinta- ja puskurisolmu"))}
          </label>
        </div>

        <div class="ins-muted-box">
          <strong>${esc(t("6. Liiketoimintamalli ja käyttöpääoma"))}</strong>
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:4px">
            <label class="lp-param">${esc(t("Myyntisaamiset DSO (pv)"))}
              <span class="fd-input"><input id="arch-s6-dso" type="number" step="1" value="${numVal(spec.step6BusinessModel.customerTermsDays, 14)}" /></span>
            </label>
            <label class="lp-param">${esc(t("Ostovelat DPO (pv)"))}
              <span class="fd-input"><input id="arch-s6-dpo" type="number" step="1" value="${numVal(spec.step6BusinessModel.supplierTermsDays, 14)}" /></span>
            </label>
          </div>
        </div>

        <div class="ins-muted-box">
          <strong>${esc(t("7. Kyvykkyydet (Roolit, IT-kerrokset ja kalusto M-portteihin)"))}</strong>
          <div class="fd-note">
            ${esc(t("Roolit:"))} <b>${spec.step7Capabilities.roles.length}</b> ·
            ${esc(t("Järjestelmät:"))} <b>${spec.step7Capabilities.systems.length}</b> (${spec.step7Capabilities.systems.map((s) => s.layer).join(", ")})
          </div>
        </div>

        <div class="ins-muted-box">
          <strong>${esc(t("8. Topologia, kypsyystaso ja avaava tase"))}</strong>
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:4px">
            <label class="lp-param">${esc(t("Alkukassa (€)"))}
              <span class="fd-input"><input id="arch-s8-cash" type="number" step="500" value="${numVal(spec.step8Topology.openingCash, 10000)}" /></span>
            </label>
            <label class="lp-param">${esc(t("Kypsyystaso (0–3)"))}
              <span class="fd-input"><input id="arch-s8-maturity" type="number" min="0" max="3" step="1" value="${spec.step8Topology.maturity}" /></span>
            </label>
          </div>
        </div>
      </div>
      <div style="margin-top:10px;display:flex;gap:8px">
        <button type="button" class="fl-btn primary" data-action="architect-compile">
          ${esc(t("Käännä 8-vaiheinen graafi (Architect Mode) →"))}
        </button>
      </div>
    </details>
  `;
}

export function renderLaunchpad(
  view: ChecklistView,
  opts?: {
    graphLp?: GraphLaunchpadView;
    architectSpec?: UniversalGenesisSpec;
    activeTemplateId?: string;
  },
): string {
  const bindings = opts?.graphLp?.bindings ?? {};
  const steps = ([1, 2, 3, 4, 5] as LaunchStep[])
    .map((s) => {
      const items = view.items.filter((i) => i.def.step === s);
      if (items.length === 0) return "";
      const done = items.filter((i) => i.status === "done").length;
      return `<section class="fd-section">
        <h4>${s}. ${esc(t(STEP_TITLES[s]))} <span class="lp-count">${done}/${items.length}</span></h4>
        <ul class="lp-list">${items.map((it) => itemHtml(it, bindings[it.def.id])).join("")}</ul>
      </section>`;
    })
    .join("");
  const pctDone = view.total > 0 ? Math.round((view.done / view.total) * 100) : 0;
  const gapSectionHtml = opts?.graphLp
    ? renderGapDrivenLaunchpadSection(opts.graphLp, opts.activeTemplateId)
    : "";
  const architectSectionHtml = opts?.architectSpec
    ? renderArchitectModeSection(opts.architectSpec)
    : "";

  return `${drawerHeader(t("Perustamislista"))}
  <div class="fd-body">
    <section class="fd-section">
      <div class="lp-progress"><div style="width:${pctDone}%"></div></div>
      <p class="fd-note">${esc(t("{done} / {total} valmiina. Kohdat, joilla on rahavaikutus, päivittävät mallin heti – näet vaikutuksen kassaan ja kannattavuuteen. Ruksin poisto peruu vaikutuksen.", { done: view.done, total: view.total }))}</p>
    </section>
    ${gapSectionHtml}
    ${steps}
    ${architectSectionHtml}
    <p class="fd-note">${esc(t("Viranomaismaksut ja -prosentit ovat muokattavia arvioita. Tarkista ajantasaiset luvut mainituista lähteistä ennen päätöksiä."))}</p>
  </div>`;
}
