/**
 * APEX Studio — syventävät paneelit (`src/flow/client/drawer.ts`).
 *
 * Päänäkymä näyttää vain olennaisen. Kun käyttäjä klikkaa solmua, tämä paneeli
 * avaa yksityiskohdat, kaavat ja solmukohtaiset kokeilut.
 */
import type { AtomEconomics, FixedCost, Molecule, RevenueAtom, TimeCapacityAtom } from "../kernel/types.ts";
import { ATOM_KIND_LABELS } from "../kernel/presets.ts";
import { timePayrollPerMonth } from "../kernel/atoms.ts";
import { atomPriceTolerance, customerTermsImpact, hireBreakEven, type StressResult } from "../kernel/sensitivity.ts";
import { unit, type FlowView, type NodeId } from "../model/view.ts";
import { esc, eur, int, money, monthName, num, pct, signedEur } from "../model/format.ts";
import { t } from "../i18n/index.ts";

export interface DrawerContext {
  view: FlowView;
  stress: StressResult | null;
}

export const KIND_ICON: Record<RevenueAtom["kind"], string> = {
  TIME_CAPACITY: "⏱",
  PHYSICAL_MATTER: "📦",
  RECURRING_SUB: "🔁",
  TRANSACTIONAL_TRADE: "🛒",
};

export function numberInput(attr: string, value: number | null | undefined, opts: { step?: number; placeholder?: string; suffix?: string } = {}): string {
  const v = value === null || value === undefined ? "" : String(Math.round(value * 1000) / 1000);
  return `<span class="fd-input"><input type="number" inputmode="decimal" ${attr} value="${esc(v)}" step="${opts.step ?? "any"}" placeholder="${esc(opts.placeholder ?? "")}"/>${opts.suffix ? `<em>${esc(opts.suffix)}</em>` : ""}</span>`;
}

export function formula(text: string): string {
  return `<div class="fd-formula"><span>${esc(t("Kaava"))}</span>${esc(text)}</div>`;
}

export function drawerHeader(title: string): string {
  return `<div class="fd-header"><h2>${esc(title)}</h2><button class="fd-close" data-action="close-drawer" aria-label="${esc(t("Sulje"))}">✕</button></div>`;
}

function atomHeader(a: RevenueAtom, m: Molecule): string {
  const canRemove = m.atoms.length > 1;
  return `<div class="fd-atom-head">
    <span class="fd-atom-icon">${KIND_ICON[a.kind]}</span>
    <input class="fd-atom-name" data-rename-atom="${esc(a.id)}" value="${esc(a.label)}" aria-label="${esc(t("Tulovirran nimi"))}"/>
    ${canRemove ? `<button class="fd-link-danger" data-action="remove-atom" data-atom="${esc(a.id)}">${esc(t("Poista"))}</button>` : ""}
  </div>
  <div class="fd-atom-kind">${esc(t(ATOM_KIND_LABELS[a.kind].title))}</div>`;
}

function toleranceTable(e: AtomEconomics): string {
  const rows = [-0.2, -0.1, 0.1, 0.2]
    .map((r) => {
      const tol = atomPriceTolerance(e, r);
      let verdict: string;
      if (tol.impossible) verdict = `<span class="bad">${esc(t("Hinta alle muuttuvan kulun – ei kannata millään määrällä"))}</span>`;
      else if (tol.maxVolumeLoss !== null)
        verdict = esc(e.volumeUnit === "h" ? t("Saat menettää enintään {pct} tunneista", { pct: pct(tol.maxVolumeLoss) }) : t("Saat menettää enintään {pct} myynnistä", { pct: pct(tol.maxVolumeLoss) }));
      else verdict = esc(t("Tarvitset {pct} lisää myyntiä", { pct: pct(tol.requiredVolumeGain ?? 0) }));
      return `<tr><td>${r > 0 ? "+" : ""}${pct(r)}</td><td>${eur(tol.newPrice)}</td><td>${verdict}</td></tr>`;
    })
    .join("");
  return `<table class="fd-table"><thead><tr><th>${esc(t("Hinta"))}</th><th>${esc(t("Uusi hinta"))}</th><th>${esc(t("Jotta kate pysyy ennallaan"))}</th></tr></thead><tbody>${rows}</tbody></table>
  ${formula(t("sallittu määrä = (hinta − muuttuva kulu) / (uusi hinta − muuttuva kulu)"))}
  <p class="fd-note">${esc(t("APEX ei arvaa, miten asiakkaasi reagoivat. Se laskee kipurajan – arvion siitä, onko se realistinen, teet sinä."))}</p>`;
}

function demandDrawer(ctx: DrawerContext): string {
  const { view } = ctx;
  const m = view.molecule;
  const blocks = m.atoms
    .filter((a) => a.enabled)
    .map((a) => {
      const e = view.econ.find((x) => x.atomId === a.id);
      if (!e) return "";
      let inputs = "";
      let f = "";
      switch (a.kind) {
        case "TIME_CAPACITY":
          inputs = `<label>${esc(t("Myyty kysyntä"))} ${numberInput(`data-atom-field="${a.id}:demandHoursPerMonth"`, a.demandHoursPerMonth, { placeholder: t("riittää kaikelle"), suffix: t("h / kk") })}</label>`;
          f = t("myynti = laskutetut tunnit × tuntihinta");
          break;
        case "PHYSICAL_MATTER":
          f = t("myynti = myydyt kpl × myyntihinta");
          break;
        case "RECURRING_SUB":
          f = t("asiakkaat(kk) = asiakkaat(edellinen kk) × (1 − poistuma) + uudet");
          break;
        case "TRANSACTIONAL_TRADE":
          f = t("myynnit = ohikulkijat × ostoprosentti × aukiolopäivät");
          break;
      }
      return `<section class="fd-section">
        ${atomHeader(a, m)}
        <div class="fd-kpis">
          <div><span>${esc(t("Määrä"))}</span><b>${int(e.volume)} ${esc(unit(e))} / ${esc(t("kk"))}</b></div>
          <div><span>${esc(t("Hinta"))}</span><b>${eur(e.unitPrice)}</b></div>
          <div><span>${esc(t("Myynti"))}</span><b>${esc(t("{amount} / kk", { amount: money(e.revenuePerMonth) }))}</b></div>
          <div><span>${esc(t("Myyntikate"))}</span><b>${pct(e.contributionMarginRatio)}</b></div>
        </div>
        ${inputs ? `<div class="fd-inputs">${inputs}</div>` : ""}
        ${formula(f)}
        <h4>${esc(t("Mitä jos muutan hintaa?"))}</h4>
        ${toleranceTable(e)}
      </section>`;
    })
    .join("");
  const addButtons = (Object.keys(ATOM_KIND_LABELS) as RevenueAtom["kind"][])
    .map((k) => `<button class="fd-chip" data-action="add-atom" data-kind="${k}">${KIND_ICON[k]} ${esc(t(ATOM_KIND_LABELS[k].title))}</button>`)
    .join("");
  return `${blocks}
  <section class="fd-section">
    <h4>${esc(t("Lisää tulovirta"))}</h4>
    <p class="fd-note">${esc(t("Yrityksesi voi myydä monella tavalla yhtä aikaa. Jokainen tulovirta tuo omat vipunsa päänäkymään."))}</p>
    <div class="fd-chips">${addButtons}</div>
  </section>`;
}

function capacityDrawer(ctx: DrawerContext): string {
  const { view } = ctx;
  const m = view.molecule;
  return m.atoms
    .filter((a) => a.enabled)
    .map((a) => {
      const e = view.econ.find((x) => x.atomId === a.id);
      if (!e) return "";
      const cap = e.capacity;
      const u = unit(e);
      const bar =
        cap === null
          ? `<p class="fd-note">${esc(t("Kapasiteettia ei ole rajattu. Jos toimituskykysi on rajallinen, aseta raja alla."))}</p>`
          : `<div class="fd-bar" role="img" aria-label="${esc(t("Kysyntä suhteessa kapasiteettiin"))}">
              <div class="fd-bar-fill ${e.lostDemand > 0 ? "over" : ""}" style="width:${Math.min(100, (e.demand / Math.max(1e-9, cap)) * 100).toFixed(1)}%"></div>
            </div>
            <div class="fd-bar-legend"><span>${esc(t("Kysyntä {n} {unit}", { n: num(e.demand), unit: u }))}</span><span>${esc(t("Kapasiteetti {n} {unit}", { n: num(cap), unit: u }))}</span></div>
            ${e.lostDemand > 0 ? `<p class="fd-warn">${esc(t("Pullonkaula: {n} {unit} kysynnästä jää palvelematta kuukaudessa ({amount} myyntiä).", { n: num(e.lostDemand), unit: u, amount: money(e.lostDemand * e.unitPrice) }))}</p>` : ""}
            ${e.idleCapacity > 0 && a.kind === "TIME_CAPACITY" && !e.demandAssumed ? `<p class="fd-note">${esc(t("Laskuttamatonta aikaa {n} h / kk. Myymätön tunti ei palaa koskaan – se on asiantuntijatyön hävikkiä.", { n: num(e.idleCapacity) }))}</p>` : ""}`;
      let extra = "";
      if (a.kind === "TIME_CAPACITY") {
        const ta = a as TimeCapacityAtom;
        const salary = ta.salaryPerPersonMonth || 3200;
        const side = ta.sideCostRate || 0.21;
        const hire = hireBreakEven(ta, salary, side);
        extra = `<h4>${esc(t("Kannattaako palkata uusi tekijä?"))}</h4>
          <div class="fd-kpis">
            <div><span>${esc(t("Kustannus / kk"))}</span><b>${money(hire.monthlyCost)}</b></div>
            <div><span>${esc(t("Tarvittavat lisätunnit"))}</span><b>${hire.hoursNeededPerMonth === null ? "–" : esc(t("{n} h / kk", { n: num(hire.hoursNeededPerMonth) }))}</b></div>
            <div><span>${esc(t("Osuus uuden kapasiteetista"))}</span><b>${hire.shareOfNewCapacity === null ? "–" : pct(hire.shareOfNewCapacity)}</b></div>
          </div>
          ${formula(t("lisätunnit = (palkka × (1 + sivukulut)) / (tuntihinta − muuttuva kulu / h)"))}
          <p class="fd-note">${esc(t("Laskelma olettaa uudelle tekijälle palkan {salary} ja sivukulut {side}. Jos lisätunteja ei ole myytävissä, rekry syö kassaa.", { salary: money(salary), side: pct(side) }))}</p>
          ${formula(t("kapasiteetti = tekijät × tunnit / vko × 52/12 × laskutusaste"))}`;
      } else if (a.kind === "PHYSICAL_MATTER") {
        extra = `<div class="fd-inputs"><label>${esc(t("Kapasiteetti"))} ${numberInput(`data-atom-field="${a.id}:capacityUnitsPerMonth"`, a.capacityUnitsPerMonth, { placeholder: t("ei rajaa"), suffix: t("kpl / kk") })}</label></div>`;
      } else if (a.kind === "TRANSACTIONAL_TRADE") {
        extra = `<div class="fd-inputs"><label>${esc(t("Palvelukyky"))} ${numberInput(`data-atom-field="${a.id}:capacityPerDay"`, a.capacityPerDay, { placeholder: t("ei rajaa"), suffix: t("myyntiä / pv") })}</label></div>`;
      } else {
        extra = `<p class="fd-note">${esc(t("Tilauspalvelussa kapasiteetti on yleensä palvelinkulua ({amount} / asiakas / kk), ei kiinteä raja.", { amount: eur(a.costPerSubscriberMonth) }))}</p>`;
      }
      return `<section class="fd-section">${atomHeader(a, m)}${bar}${extra}</section>`;
    })
    .join("");
}

function receivablesDrawer(ctx: DrawerContext): string {
  const { view } = ctx;
  const m = view.molecule;
  const rows = customerTermsImpact(m, [0, 14, 30, 45, 60])
    .map((s) => {
      const current = s.customerTermsDays === m.credit.customerTermsDays;
      return `<tr class="${current ? "current" : ""}">
        <td>${esc(t("{n} pv", { n: s.customerTermsDays }))}${current ? ` (${esc(t("nyt"))})` : ""}</td>
        <td class="${s.minCash < 0 ? "bad" : ""}">${money(s.minCash)}</td>
        <td>${s.cashOutDay === null ? `<span class="good">${esc(t("Riittää"))}</span>` : `<span class="bad">${esc(t("Loppuu päivänä {day}", { day: s.cashOutDay + 1 }))}</span>`}</td>
        <td><button class="fd-chip small" data-action="set-terms" data-days="${s.customerTermsDays}">${esc(t("Kokeile"))}</button></td>
      </tr>`;
    })
    .join("");
  const perAtom = m.atoms
    .filter((a) => a.enabled)
    .map((a) => {
      const e = view.econ.find((x) => x.atomId === a.id);
      return `<label>${esc(a.label)} ${numberInput(`data-atom-field="${a.id}:paymentTermsDays"`, a.paymentTermsDays ?? null, { placeholder: t("oletus {n}", { n: e?.paymentTermsDays ?? 0 }), suffix: t("pv") })}</label>`;
    })
    .join("");
  return `<section class="fd-section">
    <h3>${esc(t("Myynti ei ole vielä rahaa"))}</h3>
    <p>${esc(t("Kun lähetät laskun, raha lähtee matkaan. Se saapuu kassaan vasta maksuajan päästä – mutta palkat, vuokrat ja muut kulut maksetaan omana päivänään. Tämä viive on yleisin syy siihen, että kannattava yritys ajautuu kassakriisiin."))}</p>
    <h4>${esc(t("Asiakkaan maksuaika ja kassan pohja"))}</h4>
    <table class="fd-table"><thead><tr><th>${esc(t("Maksuaika"))}</th><th>${esc(t("Kassan pohja"))}</th><th>${esc(t("Tilanne"))}</th><th></th></tr></thead><tbody>${rows}</tbody></table>
    <p class="fd-note">${esc(t("Maksuaika ei muuta tulosta euroakaan – se vain siirtää rahaa myöhemmäksi."))}</p>
  </section>
  <section class="fd-section">
    <h4>${esc(t("Maksuaika tulovirroittain"))}</h4>
    <div class="fd-inputs">${perAtom}</div>
    <p class="fd-note">${esc(t("Jätä tyhjäksi käyttääksesi oletusta. Korttimaksut tilitetään yleensä 1–2 päivässä."))}</p>
  </section>`;
}

function cashDrawer(ctx: DrawerContext): string {
  const { view, stress } = ctx;
  const m = view.molecule;
  const rows = view.sim.months
    .map(
      (mo) => `<tr>
      <td>${view.varies ? `${mo.month + 1} <span class="fd-dim">${esc(monthName(mo.calendarMonth))}</span>` : mo.month + 1}${mo.activeEvents.length ? ` <span title="${esc(mo.activeEvents.join(", "))}">⚡</span>` : ""}</td>
      <td>${money(mo.revenue)}</td><td>${money(mo.variableCosts + mo.fixedCosts)}</td>
      <td class="${mo.operatingProfit < 0 ? "bad" : ""}">${signedEur(mo.operatingProfit)}</td>
      <td class="${mo.endCash < 0 ? "bad" : ""}">${money(mo.endCash)}</td></tr>`,
    )
    .join("");
  const cashOutText = (d: number | null) => (d === null ? t("kassa riittää") : t("loppuu pv {day}", { day: d + 1 }));
  const stressBlock = stress
    ? `<div class="fd-stress">
        <div><span>${esc(t("Ennen"))}</span><b>${money(stress.base.endCash)}</b><em>${esc(cashOutText(stress.base.cashOutDay))}</em></div>
        <div><span>${esc(t("Stressissä"))}</span><b class="${stress.stressed.endCash < 0 ? "bad" : ""}">${money(stress.stressed.endCash)}</b><em>${esc(cashOutText(stress.stressed.cashOutDay))}</em></div>
      </div>`
    : "";
  return `<section class="fd-section">
    <div class="fd-inputs"><label>${esc(t("Alkukassa"))} ${numberInput(`data-credit-field="openingCash"`, m.credit.openingCash, { step: 100, suffix: "€" })}</label></div>
    <button class="fd-chip" data-action="import-open">📄 ${esc(t("Tuo tiliote (CSV)"))}</button>
    <h4>${esc(t("Kuukausi kuukaudelta"))}</h4>
    <table class="fd-table fd-table-compact"><thead><tr><th>${esc(t("kk"))}</th><th>${esc(t("Myynti"))}</th><th>${esc(t("Kulut"))}</th><th>${esc(t("Tulos"))}</th><th>${esc(t("Kassa lopussa"))}</th></tr></thead><tbody>${rows}</tbody></table>
    <p class="fd-note">${esc(t("Luvut ilman arvonlisäveroa. Tuloveroja ja lainojen korkoja ei ole mallinnettu. Kirjanpidon täsmäytysero: {amount}.", { amount: money(view.sim.reconciliationError) }))}</p>
  </section>
  <section class="fd-section">
    <h4>${esc(t("Stressitesti"))}</h4>
    <p class="fd-note">${esc(t("Kestääkö kassa, jos jokin menee pieleen?"))}</p>
    <div class="fd-chips">
      <button class="fd-chip" data-action="stress" data-volume="-0.1">${esc(t("Myynti −10 %"))}</button>
      <button class="fd-chip" data-action="stress" data-volume="-0.25">${esc(t("Myynti −25 %"))}</button>
      <button class="fd-chip" data-action="stress" data-fixed="0.15">${esc(t("Kiinteät kulut +15 %"))}</button>
      <button class="fd-chip" data-action="stress" data-variable="0.2">${esc(t("Ostohinnat +20 %"))}</button>
    </div>
    ${stressBlock}
  </section>`;
}

function fixedCostRow(c: FixedCost): string {
  return `<div class="fd-cost-row">
    <input class="fd-cost-label" data-fc-field="${esc(c.id)}:label" value="${esc(c.label)}" aria-label="${esc(t("Kulun nimi"))}"/>
    ${numberInput(`data-fc-field="${esc(c.id)}:amountPerMonth"`, c.amountPerMonth, { step: 10, suffix: t("€ / kk") })}
    ${numberInput(`data-fc-field="${esc(c.id)}:dayOfMonth"`, c.dayOfMonth, { step: 1, suffix: t(". pv") })}
    <button class="fd-icon-btn" data-action="remove-fc" data-id="${esc(c.id)}" aria-label="${esc(t("Poista kulu"))}">✕</button>
  </div>`;
}

function costsDrawer(ctx: DrawerContext): string {
  const { view } = ctx;
  const m = view.molecule;
  const payroll = m.atoms
    .filter((a): a is TimeCapacityAtom => a.enabled && a.kind === "TIME_CAPACITY")
    .map(
      (a) =>
        `<li>${esc(t("{label}: {people} × {salary} × (1 + {side}) = {total} / kk, maksupäivä {day}.", {
          label: a.label,
          people: a.people,
          salary: money(a.salaryPerPersonMonth),
          side: pct(a.sideCostRate),
          total: money(timePayrollPerMonth(a)),
          day: m.payrollDay,
        }))}</li>`,
    )
    .join("");
  const variable = view.econ.map((e) => `<li>${esc(`${e.label}: ${int(e.volume)} ${unit(e)} × ${eur(e.unitVariableCost)} = ${t("{amount} / kk", { amount: money(e.variableCostPerMonth) })}`)}</li>`).join("");
  return `<section class="fd-section">
    <h4>${esc(t("Kiinteät kulut"))}</h4>
    <p class="fd-note">${esc(t("Nämä maksetaan joka kuukausi myynnistä riippumatta, merkittynä päivänä."))}</p>
    <div class="fd-costs">${m.fixedCosts.map(fixedCostRow).join("") || `<p class="fd-note">${esc(t("Ei kiinteitä kuluja vielä."))}</p>`}</div>
    <div class="fd-chips"><button class="fd-chip" data-action="add-fc">+ ${esc(t("Lisää kulu"))}</button><button class="fd-chip" data-action="import-open">📄 ${esc(t("Tuo kulut tiliotteelta (CSV)"))}</button></div>
    ${payroll ? `<h4>${esc(t("Palkat"))}</h4><ul class="fd-list">${payroll}</ul>
      <div class="fd-inputs"><label>${esc(t("Palkanmaksupäivä"))} ${numberInput(`data-payroll-day`, m.payrollDay, { step: 1, suffix: t(". pv") })}</label></div>` : ""}
  </section>
  <section class="fd-section">
    <h4>${esc(t("Muuttuvat kulut"))}</h4>
    <ul class="fd-list">${variable || `<li>${esc(t("Ei muuttuvia kuluja."))}</li>`}</ul>
    ${formula(t("tulos = myynti − muuttuvat kulut − kiinteät kulut"))}
  </section>`;
}

export function renderDrawer(node: NodeId, ctx: DrawerContext): string {
  const titles: Record<NodeId, string> = {
    demand: t("Kysyntä ja hinnoittelu"),
    capacity: t("Toimituskyky ja pullonkaulat"),
    receivables: t("Rahat matkalla"),
    cash: t("Kassa"),
    costs: t("Kulut"),
  };
  const body = { demand: demandDrawer, capacity: capacityDrawer, receivables: receivablesDrawer, cash: cashDrawer, costs: costsDrawer }[node](ctx);
  return `${drawerHeader(titles[node])}<div class="fd-body">${body}</div>`;
}
