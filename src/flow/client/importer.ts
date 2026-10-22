/**
 * APEX Studio — tiliotteen tuonnin tarkistuspaneeli (`src/flow/client/importer.ts`).
 */
import type { Molecule } from "../kernel/types.ts";
import { revenueCalibration, similarExistingCost, type ImportSelection, type StatementAnalysis } from "../model/importer.ts";
import { esc, money } from "../model/format.ts";
import { msg, t } from "../i18n/index.ts";
import { drawerHeader } from "./drawer.ts";

const CATEGORY_LABELS: Record<string, string> = {
  rent: msg("tilat"),
  admin: msg("hallinto"),
  insurance: msg("vakuutus"),
  pension: msg("eläkevakuutus"),
  software: msg("ohjelmistot"),
  marketing: msg("markkinointi"),
  other: msg("muu"),
};

export function renderImportPanel(m: Molecule, a: StatementAnalysis | null, sel: ImportSelection, modelMonthlyRevenue: number, error: string | null): string {
  if (error || !a) {
    return `${drawerHeader(t("Tiliotteen tuonti"))}
    <div class="fd-body"><section class="fd-section"><p class="fd-warn">${esc(error ?? "")}</p>
    <p class="fd-note">${esc(t("Vie tiliote verkkopankista CSV-muodossa (tapahtumaluettelo). PDF-tiliotteita ei vielä tueta."))}</p></section></div>`;
  }
  const cal = revenueCalibration(m, a.avgMonthlyIncome);
  const rows = a.recurring
    .map((r) => {
      const dup = similarExistingCost(m, r);
      return `<label class="im-row">
        <input type="checkbox" data-import-cost="${esc(r.key)}" ${sel.costKeys.includes(r.key) ? "checked" : ""}/>
        <span class="im-label">${esc(r.label)}<em>${esc(t(CATEGORY_LABELS[r.category] ?? r.category))} · ${esc(t("{months} kk / {n} maksua · pv {day}", { months: r.months, n: r.occurrences, day: r.dayOfMonth }))}</em>
          ${dup ? `<em class="im-dup">${esc(t("Mallissa on jo vastaava kulu: {label} {amount} / kk – ei valittu oletuksena", { label: dup.label, amount: money(dup.amountPerMonth) }))}</em>` : ""}</span>
        <b>${esc(t("{amount} / kk", { amount: money(r.monthlyAmount) }))}</b>
      </label>`;
    })
    .join("");
  return `${drawerHeader(t("Tiliotteen tuonti"))}
  <div class="fd-body">
    <section class="fd-section">
      <p class="fd-note">🔒 ${esc(t("Tiliote luettiin vain tässä selaimessa – tietoja ei lähetetty minnekään."))}</p>
      <div class="fd-kpis">
        <div><span>${esc(t("Ajanjakso"))}</span><b>${esc(a.from)} – ${esc(a.to)}</b></div>
        <div><span>${esc(t("Tapahtumia"))}</span><b>${a.transactionCount}</b></div>
        <div><span>${esc(t("Tulot keskimäärin"))}</span><b>${esc(t("{amount} / kk", { amount: money(a.avgMonthlyIncome) }))}</b></div>
        <div><span>${esc(t("Maksajia"))}</span><b>${a.distinctPayers}</b></div>
      </div>
    </section>
    <section class="fd-section">
      <h4>${esc(t("Toistuvat kulut"))}</h4>
      ${rows ? `<div class="im-list">${rows}</div>` : `<p class="fd-note">${esc(t("Toistuvia kuluja ei tunnistettu. Pidempi ajanjakso (2–3 kk) parantaa tunnistusta."))}</p>`}
      <p class="fd-note">${esc(t("Kertaluonteisia menoja {oneoff} ja veroja, siirtoja ja nostoja {nonop} ei lisätä kiinteiksi kuluiksi.", { oneoff: money(a.oneOffTotal), nonop: money(a.nonOperatingTotal) }))}</p>
    </section>
    <section class="fd-section">
      <h4>${esc(t("Myynti ja kassa"))}</h4>
      ${
        cal
          ? `<label class="im-row"><input type="checkbox" data-import-calibrate ${sel.calibrateRevenue ? "checked" : ""}/>
              <span class="im-label">${esc(t("Sovita myynti tiliotteeseen"))}<em>${esc(t("mallissa nyt {model} / kk → tiliotteen keskiarvo {actual} / kk ({label} {value})", { model: money(modelMonthlyRevenue), actual: money(a.avgMonthlyIncome), label: cal.label, value: cal.value }))}</em></span></label>`
          : `<p class="fd-note">${esc(t("Myynnin sovitus on käytettävissä, kun mallissa on yksi tulovirta."))}</p>`
      }
      ${
        a.lastBalance !== null
          ? `<label class="im-row"><input type="checkbox" data-import-balance ${sel.useBalance ? "checked" : ""}/>
              <span class="im-label">${esc(t("Käytä viimeistä saldoa alkukassana"))}<em>${money(a.lastBalance)} (${esc(a.to)})</em></span></label>`
          : ""
      }
      ${
        a.monthly.length > 0
          ? `<label class="im-row"><input type="checkbox" data-import-actuals ${sel.saveActuals ? "checked" : ""}/>
              <span class="im-label">${esc(t("Tallenna toteumaksi"))}<em>${esc(t("{n} kuukauden tulot ja menot verrataan suunnitelmaan Toteuma-paneelissa", { n: a.monthly.length }))}</em></span></label>`
          : ""
      }
    </section>
    <section class="fd-section">
      <button class="fl-btn primary" data-action="import-apply">${esc(t("Lisää valitut malliin"))}</button>
      <p class="fd-note">${esc(t("Muutokset voi perua ↶ Kumoa -napista."))}</p>
    </section>
  </div>`;
}
