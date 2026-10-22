/**
 * APEX Flow — syventävät paneelit (`src/flow/client/drawer.ts`).
 *
 * Päänäkymä näyttää vain olennaisen. Kun käyttäjä klikkaa solmua, tämä paneeli
 * avaa yksityiskohdat, kaavat ja solmukohtaiset kokeilut.
 */
import type { AtomEconomics, FixedCost, Molecule, RevenueAtom, TimeCapacityAtom } from "../kernel/types.ts";
import { ATOM_KIND_LABELS } from "../kernel/presets.ts";
import { timePayrollPerMonth } from "../kernel/atoms.ts";
import {
  atomPriceTolerance,
  customerTermsImpact,
  hireBreakEven,
  type StressResult,
} from "../kernel/sensitivity.ts";
import type { FlowView, NodeId } from "../model/view.ts";
import { esc, eur, int, money, num, pct, signedEur } from "../model/format.ts";

export interface DrawerContext {
  view: FlowView;
  stress: StressResult | null;
}

const KIND_ICON: Record<RevenueAtom["kind"], string> = {
  TIME_CAPACITY: "⏱",
  PHYSICAL_MATTER: "📦",
  RECURRING_SUB: "🔁",
  TRANSACTIONAL_TRADE: "🛒",
};

function numberInput(attr: string, value: number | null | undefined, opts: { step?: number; placeholder?: string; suffix?: string } = {}): string {
  const v = value === null || value === undefined ? "" : String(Math.round(value * 1000) / 1000);
  return `<span class="fd-input"><input type="number" inputmode="decimal" ${attr} value="${esc(v)}" step="${opts.step ?? "any"}" placeholder="${esc(opts.placeholder ?? "")}"/>${opts.suffix ? `<em>${esc(opts.suffix)}</em>` : ""}</span>`;
}

function formula(text: string): string {
  return `<div class="fd-formula"><span>Kaava</span>${esc(text)}</div>`;
}

function atomHeader(a: RevenueAtom, m: Molecule): string {
  const canRemove = m.atoms.length > 1;
  return `<div class="fd-atom-head">
    <span class="fd-atom-icon">${KIND_ICON[a.kind]}</span>
    <input class="fd-atom-name" data-rename-atom="${esc(a.id)}" value="${esc(a.label)}" aria-label="Tulovirran nimi"/>
    ${canRemove ? `<button class="fd-link-danger" data-action="remove-atom" data-atom="${esc(a.id)}" title="Poista tulovirta">Poista</button>` : ""}
  </div>
  <div class="fd-atom-kind">${esc(ATOM_KIND_LABELS[a.kind].title)}</div>`;
}

function toleranceTable(e: AtomEconomics): string {
  const rows = [-0.2, -0.1, 0.1, 0.2]
    .map((r) => {
      const t = atomPriceTolerance(e, r);
      let verdict: string;
      if (t.impossible) verdict = `<span class="bad">Hinta alle muuttuvan kulun – ei kannata millään määrällä</span>`;
      else if (t.maxVolumeLoss !== null) verdict = `Saat menettää enintään <b>${pct(t.maxVolumeLoss)}</b> ${esc(e.volumeUnit === "h" ? "tunneista" : "myynnistä")}`;
      else verdict = `Tarvitset <b>${pct(t.requiredVolumeGain ?? 0)}</b> lisää myyntiä`;
      return `<tr><td>${r > 0 ? "+" : ""}${pct(r)}</td><td>${eur(t.newPrice)}</td><td>${verdict}</td></tr>`;
    })
    .join("");
  return `<table class="fd-table"><thead><tr><th>Hinta</th><th>Uusi hinta</th><th>Jotta kate pysyy ennallaan</th></tr></thead><tbody>${rows}</tbody></table>
  ${formula("sallittu määrä = (hinta − muuttuva kulu) / (uusi hinta − muuttuva kulu)")}
  <p class="fd-note">APEX ei arvaa, miten asiakkaasi reagoivat. Se laskee kipurajan – arvion siitä, onko se realistinen, teet sinä.</p>`;
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
          inputs = `<label>Myyty kysyntä ${numberInput(`data-atom-field="${a.id}:demandHoursPerMonth"`, a.demandHoursPerMonth, { placeholder: "riittää kaikelle", suffix: "h / kk" })}</label>`;
          f = "myynti = laskutetut tunnit × tuntihinta";
          break;
        case "PHYSICAL_MATTER":
          f = "myynti = myydyt kpl × myyntihinta";
          break;
        case "RECURRING_SUB":
          f = "asiakkaat(kk) = asiakkaat(edellinen kk) × (1 − poistuma) + uudet";
          break;
        case "TRANSACTIONAL_TRADE":
          f = "myynnit = ohikulkijat × ostoprosentti × aukiolopäivät";
          break;
      }
      return `<section class="fd-section">
        ${atomHeader(a, m)}
        <div class="fd-kpis">
          <div><span>Määrä</span><b>${int(e.volume)} ${esc(e.volumeUnit)} / kk</b></div>
          <div><span>Hinta</span><b>${eur(e.unitPrice)}</b></div>
          <div><span>Myynti</span><b>${money(e.revenuePerMonth)} / kk</b></div>
          <div><span>Myyntikate</span><b>${pct(e.contributionMarginRatio)}</b></div>
        </div>
        ${inputs ? `<div class="fd-inputs">${inputs}</div>` : ""}
        ${formula(f)}
        <h4>Mitä jos muutan hintaa?</h4>
        ${toleranceTable(e)}
      </section>`;
    })
    .join("");
  const addButtons = (Object.keys(ATOM_KIND_LABELS) as RevenueAtom["kind"][])
    .map((k) => `<button class="fd-chip" data-action="add-atom" data-kind="${k}">${KIND_ICON[k]} ${esc(ATOM_KIND_LABELS[k].title)}</button>`)
    .join("");
  return `${blocks}
  <section class="fd-section">
    <h4>Lisää tulovirta</h4>
    <p class="fd-note">Yrityksesi voi myydä monella tavalla yhtä aikaa. Jokainen tulovirta tuo omat vipunsa päänäkymään.</p>
    <div class="fd-chips">${addButtons}</div>
  </section>`;
}

function capacityDrawer(ctx: DrawerContext): string {
  const { view } = ctx;
  const m = view.molecule;
  const blocks = m.atoms
    .filter((a) => a.enabled)
    .map((a) => {
      const e = view.econ.find((x) => x.atomId === a.id);
      if (!e) return "";
      const cap = e.capacity;
      const bar =
        cap === null
          ? `<p class="fd-note">Kapasiteettia ei ole rajattu. Jos toimituskykysi on rajallinen, aseta raja alla.</p>`
          : `<div class="fd-bar" role="img" aria-label="Kysyntä suhteessa kapasiteettiin">
              <div class="fd-bar-fill ${e.lostDemand > 0 ? "over" : ""}" style="width:${Math.min(100, (e.demand / Math.max(1e-9, cap)) * 100).toFixed(1)}%"></div>
            </div>
            <div class="fd-bar-legend"><span>Kysyntä ${num(e.demand)} ${esc(e.volumeUnit)}</span><span>Kapasiteetti ${num(cap)} ${esc(e.volumeUnit)}</span></div>
            ${e.lostDemand > 0 ? `<p class="fd-warn">Pullonkaula: ${num(e.lostDemand)} ${esc(e.volumeUnit)} kysynnästä jää palvelematta kuukaudessa (${money(e.lostDemand * e.unitPrice)} myyntiä).</p>` : ""}
            ${e.idleCapacity > 0 && a.kind === "TIME_CAPACITY" ? `<p class="fd-note">Laskuttamatonta aikaa ${num(e.idleCapacity)} h / kk. Myymätön tunti ei palaa koskaan – se on asiantuntijatyön hävikkiä.</p>` : ""}`;
      let extra = "";
      if (a.kind === "TIME_CAPACITY") {
        const t = a as TimeCapacityAtom;
        const hire = hireBreakEven(t, t.salaryPerPersonMonth || 3200, t.sideCostRate || 0.21);
        extra = `<h4>Kannattaako palkata uusi tekijä?</h4>
          <div class="fd-kpis">
            <div><span>Kustannus / kk</span><b>${money(hire.monthlyCost)}</b></div>
            <div><span>Tarvittavat lisätunnit</span><b>${hire.hoursNeededPerMonth === null ? "–" : `${num(hire.hoursNeededPerMonth)} h / kk`}</b></div>
            <div><span>Osuus uuden kapasiteetista</span><b>${hire.shareOfNewCapacity === null ? "–" : pct(hire.shareOfNewCapacity)}</b></div>
          </div>
          ${formula("lisätunnit = (palkka × (1 + sivukulut)) / (tuntihinta − muuttuva kulu / h)")}
          <p class="fd-note">Laskelma olettaa uudelle tekijälle palkan ${eur(t.salaryPerPersonMonth || 3200)} ja sivukulut ${pct(t.sideCostRate || 0.21)}. Jos lisätunteja ei ole myytävissä, rekry syö kassaa.</p>`;
        extra += formula("kapasiteetti = tekijät × tunnit / vko × 52/12 × laskutusaste");
      } else if (a.kind === "PHYSICAL_MATTER") {
        extra = `<div class="fd-inputs"><label>Kapasiteetti ${numberInput(`data-atom-field="${a.id}:capacityUnitsPerMonth"`, a.capacityUnitsPerMonth, { placeholder: "ei rajaa", suffix: "kpl / kk" })}</label></div>`;
      } else if (a.kind === "TRANSACTIONAL_TRADE") {
        extra = `<div class="fd-inputs"><label>Palvelukyky ${numberInput(`data-atom-field="${a.id}:capacityPerDay"`, a.capacityPerDay, { placeholder: "ei rajaa", suffix: "myyntiä / pv" })}</label></div>`;
      } else {
        extra = `<p class="fd-note">Tilauspalvelussa kapasiteetti on yleensä palvelinkulua (${eur(a.costPerSubscriberMonth)} / asiakas / kk), ei kiinteä raja.</p>`;
      }
      return `<section class="fd-section">${atomHeader(a, m)}${bar}${extra}</section>`;
    })
    .join("");
  return blocks;
}

function receivablesDrawer(ctx: DrawerContext): string {
  const { view } = ctx;
  const m = view.molecule;
  const scenarios = customerTermsImpact(m, [0, 14, 30, 45, 60]);
  const rows = scenarios
    .map((s) => {
      const current = s.customerTermsDays === m.credit.customerTermsDays;
      return `<tr class="${current ? "current" : ""}">
        <td>${s.customerTermsDays} pv${current ? " (nyt)" : ""}</td>
        <td class="${s.minCash < 0 ? "bad" : ""}">${money(s.minCash)}</td>
        <td>${s.cashOutDay === null ? `<span class="good">Riittää</span>` : `<span class="bad">Loppuu päivänä ${s.cashOutDay + 1}</span>`}</td>
        <td><button class="fd-chip small" data-action="set-terms" data-days="${s.customerTermsDays}">Kokeile</button></td>
      </tr>`;
    })
    .join("");
  const perAtom = m.atoms
    .filter((a) => a.enabled)
    .map((a) => {
      const e = view.econ.find((x) => x.atomId === a.id);
      return `<label>${esc(a.label)} ${numberInput(`data-atom-field="${a.id}:paymentTermsDays"`, a.paymentTermsDays ?? null, { placeholder: `oletus ${e?.paymentTermsDays ?? 0}`, suffix: "pv" })}</label>`;
    })
    .join("");
  return `<section class="fd-section">
    <h3>Myynti ei ole vielä rahaa</h3>
    <p>Kun lähetät laskun, raha lähtee matkaan. Se saapuu kassaan vasta maksuajan päästä – mutta palkat, vuokrat ja muut kulut maksetaan omana päivänään. Tämä viive on yleisin syy siihen, että kannattava yritys ajautuu kassakriisiin.</p>
    <h4>Asiakkaan maksuaika ja kassan pohja</h4>
    <table class="fd-table"><thead><tr><th>Maksuaika</th><th>Kassan pohja</th><th>Tilanne</th><th></th></tr></thead><tbody>${rows}</tbody></table>
    <p class="fd-note">Maksuaika ei muuta tulosta euroakaan – se vain siirtää rahaa myöhemmäksi.</p>
  </section>
  <section class="fd-section">
    <h4>Maksuaika tulovirroittain</h4>
    <div class="fd-inputs">${perAtom}</div>
    <p class="fd-note">Jätä tyhjäksi käyttääksesi oletusta. Korttimaksut tilitetään yleensä 1–2 päivässä.</p>
  </section>`;
}

function cashDrawer(ctx: DrawerContext): string {
  const { view, stress } = ctx;
  const m = view.molecule;
  const rows = view.sim.months
    .map(
      (mo) => `<tr>
      <td>${mo.month + 1}</td><td>${money(mo.revenue)}</td><td>${money(mo.variableCosts + mo.fixedCosts)}</td>
      <td class="${mo.operatingProfit < 0 ? "bad" : ""}">${signedEur(mo.operatingProfit)}</td>
      <td class="${mo.endCash < 0 ? "bad" : ""}">${money(mo.endCash)}</td></tr>`,
    )
    .join("");
  const stressBlock = stress
    ? `<div class="fd-stress">
        <div><span>Ennen</span><b>${money(stress.base.endCash)}</b><em>${stress.base.cashOutDay === null ? "kassa riittää" : `loppuu pv ${stress.base.cashOutDay + 1}`}</em></div>
        <div><span>Stressissä</span><b class="${stress.stressed.endCash < 0 ? "bad" : ""}">${money(stress.stressed.endCash)}</b><em>${stress.stressed.cashOutDay === null ? "kassa riittää" : `loppuu pv ${stress.stressed.cashOutDay + 1}`}</em></div>
      </div>`
    : "";
  return `<section class="fd-section">
    <div class="fd-inputs"><label>Alkukassa ${numberInput(`data-credit-field="openingCash"`, m.credit.openingCash, { step: 100, suffix: "€" })}</label></div>
    <h4>Kuukausi kuukaudelta</h4>
    <table class="fd-table fd-table-compact"><thead><tr><th>kk</th><th>Myynti</th><th>Kulut</th><th>Tulos</th><th>Kassa lopussa</th></tr></thead><tbody>${rows}</tbody></table>
    <p class="fd-note">Luvut ilman arvonlisäveroa. Tuloveroja ja lainojen korkoja ei ole mallinnettu. Kirjanpidon täsmäytysero: ${money(view.sim.reconciliationError)}.</p>
  </section>
  <section class="fd-section">
    <h4>Stressitesti</h4>
    <p class="fd-note">Kestääkö kassa, jos jokin menee pieleen?</p>
    <div class="fd-chips">
      <button class="fd-chip" data-action="stress" data-volume="-0.1">Myynti −10 %</button>
      <button class="fd-chip" data-action="stress" data-volume="-0.25">Myynti −25 %</button>
      <button class="fd-chip" data-action="stress" data-fixed="0.15">Kiinteät kulut +15 %</button>
      <button class="fd-chip" data-action="stress" data-variable="0.2">Ostohinnat +20 %</button>
    </div>
    ${stressBlock}
  </section>`;
}

function fixedCostRow(c: FixedCost): string {
  return `<div class="fd-cost-row">
    <input class="fd-cost-label" data-fc-field="${esc(c.id)}:label" value="${esc(c.label)}" aria-label="Kulun nimi"/>
    ${numberInput(`data-fc-field="${esc(c.id)}:amountPerMonth"`, c.amountPerMonth, { step: 10, suffix: "€ / kk" })}
    ${numberInput(`data-fc-field="${esc(c.id)}:dayOfMonth"`, c.dayOfMonth, { step: 1, suffix: ". pv" })}
    <button class="fd-icon-btn" data-action="remove-fc" data-id="${esc(c.id)}" title="Poista kulu" aria-label="Poista kulu">✕</button>
  </div>`;
}

function costsDrawer(ctx: DrawerContext): string {
  const { view } = ctx;
  const m = view.molecule;
  const payroll = m.atoms
    .filter((a): a is TimeCapacityAtom => a.enabled && a.kind === "TIME_CAPACITY")
    .map((a) => `<li>${esc(a.label)}: ${a.people} × ${eur(a.salaryPerPersonMonth)} × (1 + ${pct(a.sideCostRate)}) = <b>${money(timePayrollPerMonth(a))}</b> / kk, maksupäivä ${m.payrollDay}.</li>`)
    .join("");
  const variable = view.econ
    .map((e) => `<li>${esc(e.label)}: ${int(e.volume)} ${esc(e.volumeUnit)} × ${eur(e.unitVariableCost)} = <b>${money(e.variableCostPerMonth)}</b> / kk</li>`)
    .join("");
  return `<section class="fd-section">
    <h4>Kiinteät kulut</h4>
    <p class="fd-note">Nämä maksetaan joka kuukausi myynnistä riippumatta, merkittynä päivänä.</p>
    <div class="fd-costs">${m.fixedCosts.map(fixedCostRow).join("") || `<p class="fd-note">Ei kiinteitä kuluja vielä.</p>`}</div>
    <button class="fd-chip" data-action="add-fc">+ Lisää kulu</button>
    ${payroll ? `<h4>Palkat</h4><ul class="fd-list">${payroll}</ul>
      <div class="fd-inputs"><label>Palkanmaksupäivä ${numberInput(`data-payroll-day`, m.payrollDay, { step: 1, suffix: ". pv" })}</label></div>` : ""}
  </section>
  <section class="fd-section">
    <h4>Muuttuvat kulut</h4>
    <ul class="fd-list">${variable || "<li>Ei muuttuvia kuluja.</li>"}</ul>
    ${formula("tulos = myynti − muuttuvat kulut − kiinteät kulut")}
  </section>`;
}

const TITLES: Record<NodeId, string> = {
  demand: "Kysyntä ja hinnoittelu",
  capacity: "Toimituskyky ja pullonkaulat",
  receivables: "Rahat matkalla",
  cash: "Kassa",
  costs: "Kulut",
};

export function renderDrawer(node: NodeId, ctx: DrawerContext): string {
  let body = "";
  switch (node) {
    case "demand":
      body = demandDrawer(ctx);
      break;
    case "capacity":
      body = capacityDrawer(ctx);
      break;
    case "receivables":
      body = receivablesDrawer(ctx);
      break;
    case "cash":
      body = cashDrawer(ctx);
      break;
    case "costs":
      body = costsDrawer(ctx);
      break;
  }
  return `<div class="fd-header"><h2>${esc(TITLES[node])}</h2><button class="fd-close" data-action="close-drawer" aria-label="Sulje">✕</button></div><div class="fd-body">${body}</div>`;
}
