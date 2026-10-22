/**
 * "Git for Business Strategy" Timeline Branching, Monte Carlo Comparator & Executive Export Drawer.
 */
import { buildBalanceSheet, buildIncomeStatement } from "../core/engine/ledger";
import type { MonteCarloSummary } from "../core/engine/tick";
import type { TimelineBranch, WorldState } from "../core/schema";
import { escapeHtml, fmtCurrency, fmtPct } from "./formatters";

export function renderTimelineAndMonteCarloDrawer(
  state: WorldState,
  branches: TimelineBranch[],
  activeBranchId: string,
  mcSummary?: MonteCarloSummary | null,
  exportedMarkdown?: string | null,
): string {
  return `
    <div class="drawer-grid">
      <!-- 1. Timeline Branching ("Git for Business Cases") -->
      <div class="panel-card">
        <div class="card-header">
          <div>
            <span class="tag tag-cyan">GIT FOR BUSINESS STRATEGY • TIMELINE BRANCHING</span>
            <h3>Counterfactual Strategy Branches (${branches.length})</h3>
          </div>
          <button class="btn btn-xs btn-primary" id="btn-fork-branch">
            ⑂ Fork Current State at Day ${state.calendar.tick}
          </button>
        </div>

        <p class="sub" style="margin-bottom:10px">
          Every branch clones the exact deterministic ledger, warehouse lots, org cohorts, and PRNG state (` +
    "`rngState`" +
    `) at the fork tick so you can A/B test Insourced vs. Outsourced, JIT vs. JIC, or Debt vs. Equity under identical market draws.
        </p>

        <table class="fin-table">
          <thead>
            <tr>
              <th>Branch</th>
              <th>Fork Tick</th>
              <th>Head Tick</th>
              <th>Cash</th>
              <th>MTD Net Rev</th>
              <th>EBITDA</th>
              <th>Switch</th>
            </tr>
          </thead>
          <tbody>
            ${branches
              .map((b) => {
                const bs = buildBalanceSheet(b.head.finance.ledger);
                const is = buildIncomeStatement(b.head.finance.ledger);
                const isCurrent = b.id === activeBranchId;
                return `
                  <tr class="${isCurrent ? "row-highlight" : ""}">
                    <td>
                      <strong>${escapeHtml(b.name)}</strong>
                      ${isCurrent ? `<span class="tag tag-cyan">HEAD</span>` : ""}
                    </td>
                    <td class="mono">Day ${b.forkTick}</td>
                    <td class="mono">Day ${b.head.calendar.tick}</td>
                    <td class="mono text-cyan">${fmtCurrency(bs.assets.cash)}</td>
                    <td class="mono">${fmtCurrency(is.netRevenue)}</td>
                    <td class="mono ${is.ebitda >= 0 ? "text-green" : "text-red"}">${fmtCurrency(is.ebitda)}</td>
                    <td>
                      ${
                        isCurrent
                          ? `<span class="sub">Active</span>`
                          : `<button class="btn btn-xs btn-secondary" data-switch-branch="${b.id}">Checkout</button>`
                      }
                    </td>
                  </tr>
                `;
              })
              .join("")}
          </tbody>
        </table>
      </div>

      <!-- 2. Monte Carlo Stochastic Branch Simulator -->
      <div class="panel-card">
        <div class="card-header">
          <div>
            <span class="tag tag-amber">MONTE CARLO RISK & SURVIVAL ENGINE</span>
            <h3>Stochastic Trajectory Distribution (P10 / P50 / P90)</h3>
          </div>
          <button class="btn btn-xs btn-primary" id="btn-run-montecarlo">
            Run 12×60d Monte Carlo
          </button>
        </div>

        ${
          mcSummary
            ? `
              <div class="ccc-metrics-row" style="margin:10px 0">
                <div class="metric-box ${mcSummary.survivalRate >= 0.9 ? "box-ok" : "box-warn"}">
                  <label>Survival Probability</label>
                  <strong class="mono">${fmtPct(mcSummary.survivalRate, 0)}</strong>
                  <span class="sub">${mcSummary.runs} seeds × ${mcSummary.horizonDays} days</span>
                </div>
                <div class="metric-box">
                  <label>P10 Ending Cash (Downside)</label>
                  <strong class="mono text-amber">${fmtCurrency(mcSummary.endingCashP10)}</strong>
                  <span class="sub">Worst-decile liquidity</span>
                </div>
                <div class="metric-box">
                  <label>P50 Ending Cash (Median)</label>
                  <strong class="mono text-cyan">${fmtCurrency(mcSummary.endingCashP50)}</strong>
                  <span class="sub">Expected median cash</span>
                </div>
                <div class="metric-box">
                  <label>P90 Ending Cash (Upside)</label>
                  <strong class="mono text-green">${fmtCurrency(mcSummary.endingCashP90)}</strong>
                  <span class="sub">90th percentile cash</span>
                </div>
              </div>
              <table class="fin-table">
                <thead>
                  <tr><th>Run</th><th>Seed</th><th>Status</th><th>Ending Cash</th><th>Cum Revenue</th><th>Cum Net Income</th><th>Avg Fill</th></tr>
                </thead>
                <tbody>
                  ${mcSummary.results
                    .slice(0, 8)
                    .map(
                      (r) => `
                      <tr>
                        <td class="mono">#${r.runIndex + 1}</td>
                        <td class="mono">${r.seed}</td>
                        <td><span class="tag ${r.survived ? "tag-green" : "tag-red"}">${r.survived ? "SURVIVED" : "BANKRUPT"}</span></td>
                        <td class="mono">${fmtCurrency(r.endingCash)}</td>
                        <td class="mono">${fmtCurrency(r.cumulativeNetRevenue)}</td>
                        <td class="mono ${r.cumulativeNetIncome >= 0 ? "text-green" : "text-red"}">${fmtCurrency(r.cumulativeNetIncome)}</td>
                        <td class="mono">${fmtPct(r.avgFillRate, 1)}</td>
                      </tr>
                    `,
                    )
                    .join("")}
                </tbody>
              </table>
            `
            : `<div class="empty-hint">Click "Run 12×60d Monte Carlo" to run 12 independent stochastic trajectories from the current Day ${state.calendar.tick} state and compute P10 / P50 / P90 cash & survival distributions.</div>`
        }
      </div>

      <!-- 3. Executive Business Case Exporter -->
      <div class="panel-card span-2">
        <div class="card-header">
          <div>
            <span class="tag tag-green">EXECUTIVE BUSINESS CASE EXPORT</span>
            <h3>Board-Ready Target Operating Model & 3-Statement Financial Pack</h3>
          </div>
          <div style="display:flex;gap:8px">
            <button class="btn btn-xs btn-primary" id="btn-generate-export">Generate Markdown Report</button>
            ${
              exportedMarkdown
                ? `<button class="btn btn-xs btn-secondary" id="btn-download-export">Download .md File</button>`
                : ""
            }
          </div>
        </div>
        ${
          exportedMarkdown
            ? `<pre class="markdown-preview">${escapeHtml(exportedMarkdown)}</pre>`
            : `<div class="empty-hint">Click "Generate Markdown Report" to compile a complete Executive Business Case including BOM topology, L1/L2/L3 capability scorecard, 3-statement financials, working capital conversion cycle, RACI governance, and C-Suite strategic recommendations.</div>`
        }
      </div>
    </div>
  `;
}
