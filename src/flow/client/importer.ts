/**
 * APEX Flow — tiliotteen tuonnin tarkistuspaneeli (`src/flow/client/importer.ts`).
 */
import type { Molecule } from "../kernel/types.ts";
import { revenueCalibration, similarExistingCost, type ImportSelection, type StatementAnalysis } from "../model/importer.ts";
import { esc, money } from "../model/format.ts";

const CATEGORY_FI: Record<string, string> = {
  rent: "tilat",
  admin: "hallinto",
  insurance: "vakuutus",
  pension: "eläkevakuutus",
  software: "ohjelmistot",
  marketing: "markkinointi",
  other: "muu",
};

export function renderImportPanel(m: Molecule, a: StatementAnalysis, sel: ImportSelection, modelMonthlyRevenue: number, error: string | null): string {
  if (error) {
    return `<div class="fd-header"><h2>Tiliotteen tuonti</h2><button class="fd-close" data-action="close-drawer" aria-label="Sulje">✕</button></div>
    <div class="fd-body"><section class="fd-section"><p class="fd-warn">${esc(error)}</p>
    <p class="fd-note">Vie tiliote verkkopankista CSV-muodossa (tapahtumaluettelo). PDF-tiliotteita ei vielä tueta.</p></section></div>`;
  }
  const cal = revenueCalibration(m, a.avgMonthlyIncome);
  const rows = a.recurring
    .map((r) => {
      const dup = similarExistingCost(m, r);
      return `<label class="im-row">
        <input type="checkbox" data-import-cost="${esc(r.key)}" ${sel.costKeys.includes(r.key) ? "checked" : ""}/>
        <span class="im-label">${esc(r.label)}<em>${esc(CATEGORY_FI[r.category] ?? r.category)} · ${r.months} kk / ${r.occurrences} maksua · pv ${r.dayOfMonth}</em>
          ${dup ? `<em class="im-dup">Mallissa on jo vastaava kulu: ${esc(dup.label)} ${money(dup.amountPerMonth)} / kk – ei valittu oletuksena</em>` : ""}</span>
        <b>${money(r.monthlyAmount)} / kk</b>
      </label>`;
    })
    .join("");
  return `<div class="fd-header"><h2>Tiliotteen tuonti</h2><button class="fd-close" data-action="close-drawer" aria-label="Sulje">✕</button></div>
  <div class="fd-body">
    <section class="fd-section">
      <p class="fd-note">🔒 Tiliote luettiin vain tässä selaimessa – tietoja ei lähetetty minnekään.</p>
      <div class="fd-kpis">
        <div><span>Ajanjakso</span><b>${esc(a.from)} – ${esc(a.to)}</b></div>
        <div><span>Tapahtumia</span><b>${a.transactionCount}</b></div>
        <div><span>Tulot keskimäärin</span><b>${money(a.avgMonthlyIncome)} / kk</b></div>
        <div><span>Maksajia</span><b>${a.distinctPayers}</b></div>
      </div>
    </section>
    <section class="fd-section">
      <h4>Toistuvat kulut</h4>
      ${rows ? `<div class="im-list">${rows}</div>` : `<p class="fd-note">Toistuvia kuluja ei tunnistettu. Pidempi ajanjakso (2–3 kk) parantaa tunnistusta.</p>`}
      <p class="fd-note">Kertaluonteisia menoja ${money(a.oneOffTotal)} ja veroja, siirtoja ja nostoja ${money(a.nonOperatingTotal)} ei lisätä kiinteiksi kuluiksi.</p>
    </section>
    <section class="fd-section">
      <h4>Myynti ja kassa</h4>
      ${
        cal
          ? `<label class="im-row"><input type="checkbox" data-import-calibrate ${sel.calibrateRevenue ? "checked" : ""}/>
              <span class="im-label">Sovita myynti tiliotteeseen<em>mallissa nyt ${money(modelMonthlyRevenue)} / kk → tiliotteen keskiarvo ${money(a.avgMonthlyIncome)} / kk (${esc(cal.label)} ${cal.value})</em></span></label>`
          : `<p class="fd-note">Myynnin sovitus on käytettävissä, kun mallissa on yksi tulovirta.${a.avgMonthlyIncome > 0 ? ` Tiliotteen tulot: ${money(a.avgMonthlyIncome)} / kk.` : ""}</p>`
      }
      ${
        a.lastBalance !== null
          ? `<label class="im-row"><input type="checkbox" data-import-balance ${sel.useBalance ? "checked" : ""}/>
              <span class="im-label">Käytä viimeistä saldoa alkukassana<em>${money(a.lastBalance)} (${esc(a.to)})</em></span></label>`
          : ""
      }
    </section>
    <section class="fd-section">
      <button class="fl-btn primary" data-action="import-apply">Lisää valitut malliin</button>
      <p class="fd-note">Muutokset voi perua ↶ Kumoa -napista.</p>
    </section>
  </div>`;
}
