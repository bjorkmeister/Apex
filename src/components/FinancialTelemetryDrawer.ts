/**
 * Financial & Working Capital Telemetry Drawer:
 *  - Auditable 3-Statement Financials (Income Statement, Balance Sheet, Cash Flow Statement)
 *  - Live Accounting Invariant Verification Badge (`Assets === Liabilities + Equity`, `Trial Balance === $0.00`)
 *  - Cash Conversion Cycle (CCC = DIO + DSO - DPO) visual decomposition
 *  - Treasury & Capital Structure Controls (Revolver draw/repay, Term Debt, Equity Round negotiation)
 */
import {
  buildBalanceSheet,
  buildCashFlowStatement,
  buildIncomeStatement,
  verifyAccountingInvariants,
} from "../core/engine/ledger";
import type { WorldState } from "../core/schema";
import { escapeHtml, fmtCurrency, fmtNum, fmtPct } from "./formatters";
import type { ClarityMode } from "./ValueChainCanvas";

export function renderFinancialTelemetryDrawer(
  state: WorldState,
  clarityMode: ClarityMode = "simple",
): string {
  const is = buildIncomeStatement(state.finance.ledger);
  const bs = buildBalanceSheet(state.finance.ledger);
  const cf = buildCashFlowStatement(state);
  const invariantErrors = verifyAccountingInvariants(state);

  const lastDaily = state.telemetry.daily[state.telemetry.daily.length - 1];
  const dio = lastDaily?.dio ?? 0;
  const dso = lastDaily?.dso ?? 0;
  const dpo = lastDaily?.dpo ?? 0;
  const ccc = lastDaily?.ccc ?? dio + dso - dpo;

  const grossMargin = is.netRevenue > 0 ? is.grossProfit / is.netRevenue : 0;
  const ebitdaMargin = is.netRevenue > 0 ? is.ebitda / is.netRevenue : 0;
  const netMargin = is.netRevenue > 0 ? is.netIncome / is.netRevenue : 0;

  const revolver = state.finance.debts.find((d) => d.kind === "revolver");
  const revAvail = revolver ? Math.max(0, revolver.limit - revolver.principal) : 0;

  return `
    <div class="drawer-grid">
      <!-- Top Row: Accounting Invariant Banner & Working Capital Trap (CCC) -->
      <div class="panel-card span-2">
        <div class="card-header">
          <div>
            <span class="tag tag-cyan">${
              clarityMode === "simple"
                ? "KASSANKIERTO & KÄYTTÖPÄÄOMA (VARASTO + SAAMISET − OSTOVELAT)"
                : "WORKING CAPITAL CONVERSION CYCLE (CCC = DIO + DSO − DPO)"
            }</span>
            <h3>${
              clarityMode === "simple"
                ? "Kassa, Maksuvalmius & Kahdenkertainen Kirjanpito"
                : "Liquidity, Cash Runway & Double-Entry Audit"
            }</h3>
          </div>
          <span class="tag ${invariantErrors.length === 0 ? "tag-green" : "tag-red"}">
            ${
              invariantErrors.length === 0
                ? clarityMode === "simple"
                  ? "✓ KIRJANPITO TÄSMÄÄ: VARAT = VELAT + OMA PÄÄOMA"
                  : "✓ DOUBLE-ENTRY VERIFIED: ASSETS = LIABILITIES + EQUITY"
                : `⚠ INVARIANT ALERT (${invariantErrors.length})`
            }
          </span>
        </div>

        <div class="ccc-metrics-row">
          <div class="metric-box">
            <label>${clarityMode === "simple" ? "Varaston kiertoaika (DIO)" : "DIO (Inventory Days)"}</label>
            <strong class="mono">${dio.toFixed(1)} ${clarityMode === "simple" ? "pv" : "d"}</strong>
            <span class="sub">${clarityMode === "simple" ? "Varastossa kiinni" : "Stock"}: ${fmtCurrency(bs.assets.inventoryRaw + bs.assets.inventoryWip + bs.assets.inventoryFinished)}</span>
          </div>
          <div class="ccc-op">+</div>
          <div class="metric-box">
            <label>${clarityMode === "simple" ? "Myyntisaamisten maksuaika (DSO)" : "DSO (Receivable Days)"}</label>
            <strong class="mono">${dso.toFixed(1)} ${clarityMode === "simple" ? "pv" : "d"}</strong>
            <span class="sub">${clarityMode === "simple" ? "Asiakkailta saamatta" : "AR"} (${state.finance.receivables.length}): ${fmtCurrency(bs.assets.accountsReceivable)}</span>
          </div>
          <div class="ccc-op">−</div>
          <div class="metric-box">
            <label>${clarityMode === "simple" ? "Ostolaskujen maksuaika (DPO)" : "DPO (Payable Days)"}</label>
            <strong class="mono">${dpo.toFixed(1)} ${clarityMode === "simple" ? "pv" : "d"}</strong>
            <span class="sub">${clarityMode === "simple" ? "Maksamattomat ostot" : "AP"} (${state.finance.payables.length}): ${fmtCurrency(bs.liabilities.accountsPayable)}</span>
          </div>
          <div class="ccc-op">=</div>
          <div class="metric-box ${ccc > 45 ? "box-warn" : "box-ok"}">
            <label>${clarityMode === "simple" ? "Kassasykli (Rahojen kierto)" : "Cash Conversion Cycle"}</label>
            <strong class="mono">${ccc.toFixed(1)} ${clarityMode === "simple" ? "päivää" : "days"}</strong>
            <span class="sub">${
              clarityMode === "simple"
                ? ccc > 45
                  ? "Raha seisoo pitkään varastossa/laskuissa"
                  : "Nopea ja terve kassankierto"
                : ccc > 45
                  ? "High Working Capital Tie-Up"
                  : "Healthy Cash Velocity"
            }</span>
          </div>
        </div>

        <div class="treasury-actions">
          ${
            revolver
              ? `<button class="btn btn-sm btn-primary" data-action='{"type":"DRAW_REVOLVER","facilityId":"${revolver.id}","amount":2500000}' ${revAvail < 2500000 ? "disabled" : ""}>
                  ${clarityMode === "simple" ? `Nosta luottolimiittiä +25 000 € (Vapaana: ${fmtCurrency(revAvail, true)})` : `Draw Revolver +$25k (Avail: ${fmtCurrency(revAvail, true)})`}
                </button>
                <button class="btn btn-sm btn-secondary" data-action='{"type":"REPAY_DEBT","facilityId":"${revolver.id}","amount":2500000}' ${revolver.principal <= 0 ? "disabled" : ""}>
                  ${clarityMode === "simple" ? `Maksa luottolimiittiä -25 000 € (Nostettu: ${fmtCurrency(revolver.principal, true)})` : `Repay Revolver -$25k (Drawn: ${fmtCurrency(revolver.principal, true)})`}
                </button>`
              : ""
          }
          <button class="btn btn-sm btn-secondary" data-action='{"type":"TAKE_TERM_LOAN","kind":"term","lender":"Apex Institutional Credit","amount":7500000,"spreadBps":310,"termMonths":24}'>
            ${clarityMode === "simple" ? "Nosta 75 000 € pankkilaina (24 kk)" : "Raise $75k Term Debt (24m)"}
          </button>
          <button class="btn btn-sm btn-secondary" data-negotiate-investor="vc_growth">
            ${clarityMode === "simple" ? "Neuvottele 200 000 € sijoituskierros" : "Negotiate $200k Equity Round"}
          </button>
        </div>
      </div>

      <!-- Statement 1: Income Statement (Month-to-Date) -->
      <div class="panel-card">
        <div class="card-header">
          <div>
            <span class="tag tag-blue">${clarityMode === "simple" ? "LASKELMA 1 • TULOSLASKELMA (KULUVA KK)" : "STATEMENT 1 • P&L (MTD)"}</span>
            <h3>${clarityMode === "simple" ? "Tulot, Menot & Tulos" : "Income Statement"}</h3>
          </div>
          <span class="tag ${is.netIncome >= 0 ? "tag-green" : "tag-amber"}">${clarityMode === "simple" ? "Nettotulos" : "Net Margin"} ${fmtPct(netMargin, 1)}</span>
        </div>
        <table class="fin-table">
          <tbody>
            <tr class="row-section"><td colspan="2">${clarityMode === "simple" ? "MYYNTITULOT (LIIKEVAIHTO)" : "REVENUE"}</td></tr>
            <tr><td>${clarityMode === "simple" ? "Bruttomyynti (Tuotteet & Palvelut)" : "Gross Revenue (Product, Service & Sub)"}</td><td class="mono">${fmtCurrency(is.grossRevenue)}</td></tr>
            <tr><td>${clarityMode === "simple" ? "Vähennykset: Hyvitykset & alennukset" : "Less: Returns & SLA Penalties"}</td><td class="mono text-red">${is.returnsAndAllowances > 0 ? `(${fmtCurrency(is.returnsAndAllowances)})` : "0 €"}</td></tr>
            <tr class="row-total"><td>${clarityMode === "simple" ? "Liikevaihto yhteensä" : "Net Revenue"}</td><td class="mono">${fmtCurrency(is.netRevenue)}</td></tr>

            <tr class="row-section"><td colspan="2">${clarityMode === "simple" ? "MYYTYJEN TUOTTEIDEN KULUT (RAAKA-AINEET & VALMISTUS)" : "COST OF GOODS SOLD (COGS)"}</td></tr>
            <tr><td>${clarityMode === "simple" ? "Raaka-aineet, tarvikkeet & alihankinta" : "BOM Materials & Production WIP"}</td><td class="mono">${fmtCurrency(is.cogs.product + is.cogs.outsourcing)}</td></tr>
            <tr><td>${clarityMode === "simple" ? "Suora valmistus- ja tiskihenkilöstö" : "Direct Production & Warehouse Labor"}</td><td class="mono">${fmtCurrency(is.cogs.directLabor)}</td></tr>
            <tr><td>${clarityMode === "simple" ? "Kuljetus- ja toimituskulut" : "Outbound Freight & Delivery"}</td><td class="mono">${fmtCurrency(is.cogs.freightOut)}</td></tr>
            <tr><td>${clarityMode === "simple" ? "Hävikki, vanhentuneet erät & hukka" : "Spoilage, Shrinkage & Scrap"}</td><td class="mono">${fmtCurrency(is.cogs.spoilageShrink)}</td></tr>
            <tr class="row-total"><td>${clarityMode === "simple" ? `Myyntikate (${fmtPct(grossMargin, 1)})` : `Gross Profit (${fmtPct(grossMargin, 1)})`}</td><td class="mono">${fmtCurrency(is.grossProfit)}</td></tr>

            <tr class="row-section"><td colspan="2">${clarityMode === "simple" ? "KIINTEÄT LIIKETOIMINNAN KULUT (OPEX)" : "OPERATING EXPENSES (OPEX)"}</td></tr>
            <tr><td>${clarityMode === "simple" ? "Palkat & sosiaalikulut (Hallinto & Myynti)" : "SG&A & Management Payroll"}</td><td class="mono">${fmtCurrency(is.opex.payroll)}</td></tr>
            <tr><td>${clarityMode === "simple" ? "Markkinointi & asiakashankinta" : "Marketing & Demand Gen"}</td><td class="mono">${fmtCurrency(is.opex.marketing)}</td></tr>
            <tr><td>${clarityMode === "simple" ? "Kioskin / Toimitilan vuokra & ylläpito" : "Warehousing, Rent & Demurrage"}</td><td class="mono">${fmtCurrency(is.opex.warehousing + is.opex.rent)}</td></tr>
            <tr><td>${clarityMode === "simple" ? "Osaamisen & prosessien kehitys" : "Capability Investment & R&D"}</td><td class="mono">${fmtCurrency(is.opex.capability)}</td></tr>
            <tr><td>${clarityMode === "simple" ? "Laitehuolto, maksupäätteen kulut & muut" : "Maintenance, Channel Fees & G&A"}</td><td class="mono">${fmtCurrency(is.opex.maintenance + is.opex.channelFees + is.opex.recruiting + is.opex.fines + is.opex.badDebt + is.opex.other)}</td></tr>
            <tr class="row-total"><td>${clarityMode === "simple" ? `Käyttökate / EBITDA (${fmtPct(ebitdaMargin, 1)})` : `EBITDA (${fmtPct(ebitdaMargin, 1)})`}</td><td class="mono">${fmtCurrency(is.ebitda)}</td></tr>
            <tr><td>${clarityMode === "simple" ? "Kaluston & laitteiden poistot" : "PP&E Depreciation"}</td><td class="mono">(${fmtCurrency(is.depreciation)})</td></tr>
            <tr><td>${clarityMode === "simple" ? "Rahoituskulut (Korot) & Verot" : "Interest Expense & Tax"}</td><td class="mono">(${fmtCurrency(is.interestExpense + is.incomeTax)})</td></tr>
            <tr class="row-grand"><td>${clarityMode === "simple" ? "Tilikauden / Kuukauden tulos (Viivan alle)" : "Net Income (MTD)"}</td><td class="mono ${is.netIncome >= 0 ? "text-green" : "text-red"}">${fmtCurrency(is.netIncome)}</td></tr>
          </tbody>
        </table>
      </div>

      <!-- Statement 2 & 3: Balance Sheet & Cash Flow Statement -->
      <div class="panel-card">
        <div class="card-header">
          <div>
            <span class="tag tag-blue">${clarityMode === "simple" ? "LASKELMA 2 & 3 • TASE & KASSAVIRTALASKELMA" : "STATEMENT 2 & 3 • BALANCE SHEET & CASH FLOW"}</span>
            <h3>${clarityMode === "simple" ? "Varat, Velat & Kassavirta" : "Balance Sheet & Cash Flows"}</h3>
          </div>
          <span class="tag ${bs.balanced ? "tag-green" : "tag-red"}">${bs.balanced ? (clarityMode === "simple" ? "Tase täsmää (0,00 €)" : "Balanced ($0.00)") : "Unbalanced"}</span>
        </div>
        <table class="fin-table">
          <tbody>
            <tr class="row-section"><td colspan="2">${clarityMode === "simple" ? "VARAT (MITÄ YRITYKSELLÄ ON)" : "ASSETS"}</td></tr>
            <tr><td>${clarityMode === "simple" ? "Rahat pankkitilillä & kassassa" : "Cash & Equivalents"}</td><td class="mono text-cyan">${fmtCurrency(bs.assets.cash)}</td></tr>
            <tr><td>${clarityMode === "simple" ? "Myyntisaamiset (Laskut asiakkaille)" : "Accounts Receivable (AR)"}</td><td class="mono">${fmtCurrency(bs.assets.accountsReceivable)}</td></tr>
            <tr><td>${clarityMode === "simple" ? "Varaston arvo (Raaka-aineet + Valmiit)" : "Inventory (Raw + WIP + Finished)"}</td><td class="mono">${fmtCurrency(bs.assets.inventoryRaw + bs.assets.inventoryWip + bs.assets.inventoryFinished)}</td></tr>
            <tr><td>${clarityMode === "simple" ? "Ennakkomaksut (Maksetut tilaukset)" : "Prepaid Expenses (CIA Orders)"}</td><td class="mono">${fmtCurrency(bs.assets.prepaid)}</td></tr>
            <tr><td>${clarityMode === "simple" ? "Kojut, koneet, kalusto & toimitilat (Netto)" : "Net PP&E (Fixed Assets less Acc. Dep.)"}</td><td class="mono">${fmtCurrency(bs.assets.ppeNet)}</td></tr>
            <tr class="row-total"><td>${clarityMode === "simple" ? "Varat yhteensä" : "Total Assets"}</td><td class="mono">${fmtCurrency(bs.assets.total)}</td></tr>

            <tr class="row-section"><td colspan="2">${clarityMode === "simple" ? "VELAT & OMA PÄÄOMA (MISTÄ RAHA ON TULLUT)" : "LIABILITIES & EQUITY"}</td></tr>
            <tr><td>${clarityMode === "simple" ? "Ostovelat tukuille (Maksamattomat laskut)" : "Accounts Payable (AP)"}</td><td class="mono">${fmtCurrency(bs.liabilities.accountsPayable)}</td></tr>
            <tr><td>${clarityMode === "simple" ? "Kertyneet palkat, korot & verovelat" : "Accrued Payroll, Interest & Taxes"}</td><td class="mono">${fmtCurrency(bs.liabilities.accruedPayroll + bs.liabilities.accruedInterest + bs.liabilities.taxesPayable + bs.liabilities.deferredRevenue)}</td></tr>
            <tr><td>${clarityMode === "simple" ? "Pankkilainat & luottolimiitti" : "Revolving Credit & Term Debt"}</td><td class="mono">${fmtCurrency(bs.liabilities.revolver + bs.liabilities.termDebt)}</td></tr>
            <tr><td>${clarityMode === "simple" ? "Sijoitettu oma pääoma" : "Paid-In Capital"}</td><td class="mono">${fmtCurrency(bs.equity.paidInCapital)}</td></tr>
            <tr><td>${clarityMode === "simple" ? "Kertyneet voittovarat + Kuluvan kk tulos" : "Retained Earnings + Current P&L"}</td><td class="mono">${fmtCurrency(bs.equity.retainedEarnings)}</td></tr>
            <tr class="row-total"><td>${clarityMode === "simple" ? "Velat + Oma pääoma yhteensä" : "Total Liabilities + Equity"}</td><td class="mono">${fmtCurrency(bs.liabilities.total + bs.equity.total)}</td></tr>

            <tr class="row-section"><td colspan="2">${clarityMode === "simple" ? "KASSAVIRTALASKELMA (MISTÄ RAHA TULI JA MIHIN SE MENI)" : "CASH FLOW STATEMENT (MTD)"}</td></tr>
            <tr><td>${clarityMode === "simple" ? "Liiketoiminnan rahavirta (Myynti − Ostot & Kulut)" : "Operating Cash Flow"}</td><td class="mono ${cf.operating >= 0 ? "text-green" : "text-red"}">${fmtCurrency(cf.operating)}</td></tr>
            <tr><td>${clarityMode === "simple" ? "Investointien rahavirta (Kalusto & Kasvu)" : "Investing Cash Flow (CapEx)"}</td><td class="mono">${fmtCurrency(cf.investing)}</td></tr>
            <tr><td>${clarityMode === "simple" ? "Rahoituksen rahavirta (Lainat & Sijoitukset)" : "Financing Cash Flow (Debt / Equity)"}</td><td class="mono">${fmtCurrency(cf.financing)}</td></tr>
            <tr class="row-grand"><td>${clarityMode === "simple" ? `Kassa lopussa (${fmtCurrency(cf.beginCash, true)} + Δ${fmtCurrency(cf.netChange, true)})` : `Ending Cash (${fmtCurrency(cf.beginCash, true)} + Δ${fmtCurrency(cf.netChange, true)})`}</td><td class="mono text-cyan">${fmtCurrency(cf.endCash)}</td></tr>
          </tbody>
        </table>
      </div>

      <!-- Debt Covenants & Historical Monthly Performance -->
      <div class="panel-card span-2">
        <div class="card-header">
          <div>
            <span class="tag tag-cyan">${clarityMode === "simple" ? "LAINAT, RAHOITUSSOPIMUKSET & KUUKAUSIHISTORIA" : "DEBT FACILITIES, COVENANTS & MONTHLY LEDGER HISTORY"}</span>
            <h3>${clarityMode === "simple" ? `Lainasopimukset & Suljetut kuukausiraportit (${state.telemetry.monthly.length} kk)` : `Credit Facilities & Closed Monthly Reports (${state.telemetry.monthly.length} Closed Months)`}</h3>
          </div>
          <span class="tag tag-blue">${clarityMode === "simple" ? "Osakkeita" : "Shares"}: ${fmtNum(state.finance.equity.sharesOutstanding)}</span>
        </div>
        <div class="covenant-list">
          ${state.finance.debts
            .map(
              (d) => `
              <div class="covenant-item">
                <div>
                  <strong>${escapeHtml(d.lender)} (${d.kind.toUpperCase()})</strong>
                  <span class="sub">${clarityMode === "simple" ? `Nostettu ${fmtCurrency(d.principal)} / Raja ${fmtCurrency(d.limit)} • Korkomarginaali +${(d.spreadBps / 100).toFixed(2)}%` : `Drawn ${fmtCurrency(d.principal)} / Limit ${fmtCurrency(d.limit)} • Spread +${d.spreadBps}bps`}</span>
                </div>
                <div>
                  <span class="tag ${d.status === "active" ? "tag-green" : "tag-red"}">${d.status.toUpperCase()} (${clarityMode === "simple" ? `Huomautukset: ${d.consecutiveBreaches}` : `Breaches: ${d.consecutiveBreaches}`})</span>
                </div>
              </div>`,
            )
            .join("")}
        </div>
        ${
          state.telemetry.monthly.length > 0
            ? `<table class="fin-table" style="margin-top:10px">
                <thead>
                  <tr>
                    <th>${clarityMode === "simple" ? "Kuukausi" : "Month"}</th>
                    <th>${clarityMode === "simple" ? "Liikevaihto" : "Net Revenue"}</th>
                    <th>${clarityMode === "simple" ? "Myyntikate %" : "Gross Margin"}</th>
                    <th>${clarityMode === "simple" ? "Käyttökate" : "EBITDA"}</th>
                    <th>${clarityMode === "simple" ? "Nettotulos" : "Net Income"}</th>
                    <th>${clarityMode === "simple" ? "Kassa lopussa" : "Ending Cash"}</th>
                    <th>${clarityMode === "simple" ? "Kassasykli" : "CCC (DIO/DSO/DPO)"}</th>
                    <th>${clarityMode === "simple" ? "Saatavuus" : "Fill Rate"}</th>
                  </tr>
                </thead>
                <tbody>
                  ${state.telemetry.monthly
                    .map(
                      (m) => `
                      <tr>
                        <td>M${m.monthIndex} (Y${m.year})</td>
                        <td class="mono">${fmtCurrency(m.statements.incomeStatement.netRevenue)}</td>
                        <td class="mono">${fmtPct(m.kpis.grossMargin, 1)}</td>
                        <td class="mono">${fmtCurrency(m.statements.incomeStatement.ebitda)}</td>
                        <td class="mono ${m.statements.incomeStatement.netIncome >= 0 ? "text-green" : "text-red"}">${fmtCurrency(m.statements.incomeStatement.netIncome)}</td>
                        <td class="mono text-cyan">${fmtCurrency(m.statements.balanceSheet.assets.cash)}</td>
                        <td class="mono">${m.kpis.ccc.toFixed(0)}d (${m.kpis.dio.toFixed(0)}/${m.kpis.dso.toFixed(0)}/${m.kpis.dpo.toFixed(0)})</td>
                        <td class="mono">${fmtPct(m.kpis.fillRate, 1)}</td>
                      </tr>`,
                    )
                    .join("")}
                </tbody>
              </table>`
            : `<div class="empty-hint">${clarityMode === "simple" ? "Simuloi Päivään 30 saakka saadaksesi ensimmäisen suljetun kuukausitilinpäätöksen." : "Advance simulation to Day 30 to close Month 1 and generate the first closed Monthly Financial Report."}</div>`
        }
      </div>
    </div>
  `;
}

