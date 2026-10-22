/**
 * Module 4.5: Executive Business Case Exporter.
 *
 * Compiles any simulation state / branch into a rigorous real-world deliverable:
 *  - Executive Summary & Unit Economics
 *  - Auditable Monthly Financial Projections (P&L, Balance Sheet, Cash Flow, CCC)
 *  - L1/L2/L3 Capability Maturity & Sourcing Roadmap
 *  - Org Chart, Headcount & RACI Governance Matrix
 *  - Supply Chain, Warehouse Footprint & Risk Register
 */
import { buildFinancialStatements } from "../engine/ledger";
import { resolveOfferingPrice } from "../engine/market";
import { roleHeadcount } from "../engine/org";
import type { WorldState } from "../schema";

const fmtUsd = (cents: number): string =>
  `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

export function exportExecutiveBusinessCaseMarkdown(state: WorldState): string {
  const { incomeStatement: is, balanceSheet: bs, cashFlow: cf } =
    buildFinancialStatements(state);
  const lastKpi = state.telemetry.daily[state.telemetry.daily.length - 1];

  const lines: string[] = [];
  lines.push(`# EXECUTIVE BUSINESS CASE: ${state.company.name.toUpperCase()}`);
  lines.push(`**Industry:** ${state.company.industry}  `);
  lines.push(`**Value Proposition:** ${state.company.tagline}  `);
  lines.push(
    `**Simulation Horizon:** Tick ${state.calendar.tick} (Year ${state.calendar.year}, Month ${state.calendar.monthOfYear}, Day ${state.calendar.dayOfMonth}) | **Status:** \`${state.status.toUpperCase()}\``,
  );
  lines.push("");

  // 1. Current Balance Sheet & Working Capital Snapshot
  lines.push("## 1. Financial Position & Working Capital Conversion Cycle");
  lines.push(
    `- **Cash & Equivalents:** ${fmtUsd(bs.assets.cash)} | **Accounts Receivable:** ${fmtUsd(bs.assets.accountsReceivable)} | **Total Inventory:** ${fmtUsd(bs.assets.inventoryRaw + bs.assets.inventoryWip + bs.assets.inventoryFinished)}`,
  );
  lines.push(
    `- **Total Assets:** ${fmtUsd(bs.assets.total)} | **Total Liabilities:** ${fmtUsd(bs.liabilities.total)} | **Total Equity:** ${fmtUsd(bs.equity.total)} | **Reconciled:** \`${bs.balanced ? "YES (Assets = L + E)" : "MISMATCH"}\``,
  );
  lines.push(
    `- **Cash Conversion Cycle (CCC):** ${(lastKpi?.ccc ?? 0).toFixed(1)} days (DIO ${(lastKpi?.dio ?? 0).toFixed(1)}d + DSO ${(lastKpi?.dso ?? 0).toFixed(1)}d - DPO ${(lastKpi?.dpo ?? 0).toFixed(1)}d)`,
  );
  lines.push(
    `- **Period Cash Flow:** Operating ${fmtUsd(cf.operating)} | Investing ${fmtUsd(cf.investing)} | Financing ${fmtUsd(cf.financing)}`,
  );
  lines.push("");

  // 2. Unit Economics & Pricing Architecture
  lines.push("## 2. Commercial Offerings & Real-Time Unit Economics");
  lines.push("| Offering | Segment | Pricing Model | Net Price | Contribution Margin | Fill Rate |");
  lines.push("| :--- | :--- | :--- | ---: | ---: | ---: |");
  for (const off of state.commercial.offerings) {
    const ost = state.commercial.offeringStates.find((s) => s.offeringId === off.id);
    const { netUnitPrice, contributionMarginPct } = resolveOfferingPrice(state, off, 1);
    lines.push(
      `| ${off.name} | ${off.segmentId} | \`${off.pricing.kind}\` | ${fmtUsd(netUnitPrice)} | ${(contributionMarginPct * 100).toFixed(1)}% | ${((ost?.fillRateEma ?? 1) * 100).toFixed(1)}% |`,
    );
  }
  lines.push("");

  // 3. Monthly Historical / Projected Financial Table
  if (state.telemetry.monthly.length > 0) {
    lines.push("## 3. Monthly Financial Statements & KPI Ledger");
    lines.push("| Month | Net Revenue | Gross Margin | EBITDA | Net Income | Ending Cash | CCC (Days) |");
    lines.push("| :---: | ---: | ---: | ---: | ---: | ---: | ---: |");
    for (const m of state.telemetry.monthly) {
      const mis = m.statements.incomeStatement;
      const mbs = m.statements.balanceSheet;
      lines.push(
        `| M${m.monthIndex} | ${fmtUsd(mis.netRevenue)} | ${(m.kpis.grossMargin * 100).toFixed(1)}% | ${fmtUsd(mis.ebitda)} | ${fmtUsd(mis.netIncome)} | ${fmtUsd(mbs.assets.cash)} | ${m.kpis.ccc.toFixed(1)}d |`,
      );
    }
    lines.push("");
  } else {
    lines.push("## 3. Current Period Income Statement (MTD)");
    lines.push(
      `- **Net Revenue:** ${fmtUsd(is.netRevenue)} | **COGS:** ${fmtUsd(is.cogs.total)} | **Gross Profit:** ${fmtUsd(is.grossProfit)}`,
    );
    lines.push(
      `- **Total OpEx:** ${fmtUsd(is.opex.total)} | **EBITDA:** ${fmtUsd(is.ebitda)} | **Net Income:** ${fmtUsd(is.netIncome)}`,
    );
    lines.push("");
  }

  // 4. Capability Maturity Roadmap
  lines.push("## 4. Enterprise Capability Map (L1/L2/L3)");
  lines.push("| Capability | Sourcing | Maturity | Required | Daily Investment | Owner Role |");
  lines.push("| :--- | :--- | :---: | :---: | ---: | :--- |");
  for (const cap of state.operations.capabilities) {
    lines.push(
      `| ${cap.name} | \`${cap.sourcing}\` | ${cap.maturity.toFixed(2)} / 5.0 | ${cap.requiredMaturity.toFixed(1)} | ${fmtUsd(cap.dailyInvestment)}/day | ${cap.ownerRoleId ?? "Unassigned"} |`,
    );
  }
  lines.push("");

  // 5. Organizational Chart & RACI Governance
  lines.push("## 5. Organization, Headcount & RACI Governance");
  lines.push("| Role Title | Tier | Active Headcount | Pending Hires | Annual Salary | Morale | Fatigue |");
  lines.push("| :--- | :--- | :---: | :---: | ---: | :---: | :---: |");
  for (const role of state.org.roles) {
    const pos = state.org.positions.find((p) => p.roleId === role.id);
    const hc = pos ? roleHeadcount(pos) : 0;
    const pend = pos ? pos.pendingHires.reduce((s, h) => s + h.count, 0) : 0;
    lines.push(
      `| ${role.title} | \`${role.tier}\` | ${hc} | ${pend} | ${fmtUsd(role.annualSalary)} | ${((pos?.morale ?? 0.8) * 100).toFixed(0)}% | ${((pos?.fatigue ?? 0.1) * 100).toFixed(0)}% |`,
    );
  }
  lines.push("");

  // 6. Supply Chain, Warehouses & Risk Register
  lines.push("## 6. Supply Chain Footprint & Risk Register");
  for (const wh of state.warehouses.sites) {
    lines.push(
      `- **Warehouse ${wh.name} (${wh.region}, \`${wh.mode}\`):** Cubic Utilization ${(wh.telemetry.utilization * 100).toFixed(1)}% | Pick-Pack Utilization ${(wh.telemetry.pickUtilization * 100).toFixed(1)}% | Automation ${(wh.automationLevel * 100).toFixed(0)}%`,
    );
  }
  for (const sup of state.supply.suppliers) {
    lines.push(
      `- **Supplier ${sup.name} (${sup.region}):** Reliability ${(sup.reliability * 100).toFixed(0)}% | Terms \`${sup.terms.kind.toUpperCase()} ${sup.terms.days}d\` | Credit Hold: \`${sup.creditHold ? "YES" : "NO"}\``,
    );
  }
  if (state.events.log.length > 0) {
    lines.push("");
    lines.push("### Triggered Crisis & Stress-Test Log");
    for (const ev of state.events.log) {
      lines.push(`- **Day ${ev.tick} (Severity ${ev.severity}/5):** ${ev.title}`);
    }
  }

  return lines.join("\n");
}
