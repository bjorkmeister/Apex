/**
 * Sub-Engine 4.6: Corporate Finance, Working Capital Trap, Treasury, Debt Covenants & Month-End Close.
 *
 * Enforces:
 *  - Straight-line daily depreciation on PP&E (`depreciation` -> `accumulated_depreciation`).
 *  - Daily debt interest accrual (`interest_expense` -> `accrued_interest`) at `macro.baseRateBps + facility.spreadBps`.
 *  - Customer Accounts Receivable (AR) collection with stochastic payment slippage and bad-debt write-offs.
 *  - Bi-weekly Payroll disbursement (days 15 & 30), auto-drawing on an active revolver if cash is short;
 *    if cash + revolver cannot cover payroll, records a missed payroll shock.
 *  - Priority-ordered Accounts Payable (AP) & Taxes Payable settlement; unpaid overdue supplier AP
 *    triggers supplier credit holds after 15 days overdue.
 *  - Monthly debt interest payment, scheduled principal amortization, corporate income tax accrual
 *    (with net operating loss carryforward), financial covenant testing, and nominal ledger close.
 *  - Working Capital Conversion Cycle ($\text{CCC} = \text{DIO} + \text{DSO} - \text{DPO}$) & Telemetry snapshots.
 */
import type { Cents, DailyKpi, DebtFacility, MonthlyReport, WorldState } from "../schema";
import {
  buildBalanceSheet,
  buildFinancialStatements,
  buildIncomeStatement,
  closeNominalAccounts,
  creditBalance,
  debitBalance,
  postJournal,
} from "./ledger";
import { applyModifiers, nextId, pushNotification } from "./modifiers";
import { totalHeadcount } from "./org";
import { clamp, type SeededRng } from "./rng";

export function runFinanceAndTreasuryTick(state: WorldState, rng: SeededRng): void {
  const tick = state.calendar.tick;
  const dayOfMonth = state.calendar.dayOfMonth;

  // 1. Daily fixed-asset depreciation
  let depToday: Cents = 0;
  for (const fa of state.finance.fixedAssets) {
    const depreciable = Math.max(0, fa.cost - fa.salvage);
    const remaining = Math.max(0, depreciable - fa.accumulatedDepreciation);
    if (remaining <= 0) continue;
    const dailyDep = Math.min(remaining, Math.max(1, Math.round(depreciable / fa.usefulLifeDays)));
    fa.accumulatedDepreciation += dailyDep;
    depToday += dailyDep;
  }
  if (depToday > 0) {
    postJournal(state, {
      memo: "Daily PP&E straight-line depreciation",
      source: "finance:depreciation",
      lines: [
        { account: "depreciation", amount: depToday },
        { account: "accumulated_depreciation", amount: -depToday },
      ],
    });
  }

  // 2. Daily interest accrual on active debt facilities
  const baseBps = applyModifiers(state, "macro.baseRateBps", state.market.macro.baseRateBps);
  let interestToday: Cents = 0;
  for (const d of state.finance.debts) {
    if (d.principal <= 0 || d.status === "repaid") continue;
    const penaltyBps = d.status === "breach" ? 300 : d.status === "default" ? 600 : 0;
    const annualRate = Math.max(0, (baseBps + d.spreadBps + penaltyBps) / 10_000);
    const dailyInt = Math.round((d.principal * annualRate) / 360);
    interestToday += dailyInt;
  }
  if (interestToday > 0) {
    postJournal(state, {
      memo: "Daily debt interest accrual",
      source: "finance:interest_accrual",
      lines: [
        { account: "interest_expense", amount: interestToday },
        { account: "accrued_interest", amount: -interestToday },
      ],
    });
  }

  // 3. Accounts Receivable (AR) collections, payment slippage & bad-debt write-offs
  let collectedAr: Cents = 0;
  let writtenOffAr: Cents = 0;
  const remainingAr: WorldState["finance"]["receivables"] = [];

  for (const ar of state.finance.receivables) {
    if (tick < ar.dueTick) {
      remainingAr.push(ar);
      continue;
    }
    // Customer may slip payment once by 5-15 days
    if (!ar.slipped && rng.chance(0.12)) {
      ar.slipped = true;
      ar.dueTick = tick + rng.int(5, 15);
      remainingAr.push(ar);
      continue;
    }
    if (rng.chance(ar.defaultProb)) {
      writtenOffAr += ar.amount;
    } else {
      collectedAr += ar.amount;
    }
  }
  state.finance.receivables = remainingAr;

  if (collectedAr > 0) {
    postJournal(state, {
      memo: "Customer Accounts Receivable collections",
      source: "finance:ar_collect",
      cashFlow: "operating",
      lines: [
        { account: "cash", amount: collectedAr },
        { account: "accounts_receivable", amount: -collectedAr },
      ],
    });
  }
  if (writtenOffAr > 0) {
    postJournal(state, {
      memo: "Bad debt write-off on defaulted receivables",
      source: "finance:bad_debt",
      lines: [
        { account: "opex_bad_debt", amount: writtenOffAr },
        { account: "accounts_receivable", amount: -writtenOffAr },
      ],
    });
  }

  // 4. Bi-weekly Payroll disbursement (days 15 and 30)
  if (dayOfMonth === 15 || dayOfMonth === 30) {
    settleAccruedPayroll(state);
  }

  // 5. Monthly interest payment & principal amortization (day 30)
  if (dayOfMonth === 30) {
    settleMonthlyDebtService(state);
  }

  // 6. Settle due Accounts Payable & Taxes Payable in priority order
  settleDuePayables(state);

  // 7. Evaluate daily balance-sheet loan covenants (min_cash, current_ratio)
  evaluateDailyLoanCovenants(state);

  // 8. Update supplier credit holds & working-capital insolvency triggers
  updateOverdueAndBankruptcyStatus(state);
}

/** Auto-draw from an active revolving credit facility when operating cash is short. */
export function tryAutoDrawRevolver(state: WorldState, neededCash: Cents): Cents {
  if (neededCash <= 0) return 0;
  let totalDrawn: Cents = 0;

  for (const d of state.finance.debts) {
    if (d.kind !== "revolver" || d.status !== "active") continue;
    const effLimit = Math.max(
      0,
      Math.round(applyModifiers(state, "revolver.limit", d.limit, d.id)),
    );
    const avail = Math.max(0, effLimit - d.principal);
    if (avail <= 0) continue;

    const draw = Math.min(avail, neededCash - totalDrawn);
    if (draw > 0) {
      d.principal += draw;
      totalDrawn += draw;
      postJournal(state, {
        memo: `Auto-draw on revolving credit line (${d.lender})`,
        source: "finance:revolver_draw",
        cashFlow: "financing",
        lines: [
          { account: "cash", amount: draw },
          { account: "revolver", amount: -draw },
        ],
      });
    }
    if (totalDrawn >= neededCash) break;
  }

  return totalDrawn;
}

function settleAccruedPayroll(state: WorldState): void {
  const accrued = creditBalance(state.finance.ledger, "accrued_payroll");
  if (accrued <= 0) return;

  let cash = debitBalance(state.finance.ledger, "cash");
  if (cash < accrued) {
    tryAutoDrawRevolver(state, accrued - cash);
    cash = debitBalance(state.finance.ledger, "cash");
  }

  const paid = Math.min(cash, accrued);
  if (paid > 0) {
    postJournal(state, {
      memo: "Bi-weekly payroll disbursement",
      source: "finance:payroll_pay",
      cashFlow: "operating",
      lines: [
        { account: "accrued_payroll", amount: paid },
        { account: "cash", amount: -paid },
      ],
    });
  }

  if (paid < accrued) {
    state.finance.missedPayrolls += 1;
    state.org.governance.lastMissedPayrollTick = state.calendar.tick;
    pushNotification(
      state,
      "critical",
      "finance",
      `Payroll shortfall! Unpaid accrued wages of $${((accrued - paid) / 100).toFixed(0)} (missed payroll #${state.finance.missedPayrolls}).`,
    );
  }
}

function settleMonthlyDebtService(state: WorldState): void {
  // Pay accrued interest
  const accruedInt = creditBalance(state.finance.ledger, "accrued_interest");
  if (accruedInt > 0) {
    let cash = debitBalance(state.finance.ledger, "cash");
    if (cash < accruedInt) {
      tryAutoDrawRevolver(state, accruedInt - cash);
      cash = debitBalance(state.finance.ledger, "cash");
    }
    const payInt = Math.min(cash, accruedInt);
    if (payInt > 0) {
      postJournal(state, {
        memo: "Monthly interest payment",
        source: "finance:interest_pay",
        cashFlow: "operating",
        lines: [
          { account: "accrued_interest", amount: payInt },
          { account: "cash", amount: -payInt },
        ],
      });
    }
  }

  // Pay scheduled monthly principal amortization on term loans
  for (const d of state.finance.debts) {
    if (d.kind === "revolver" || d.principal <= 0 || d.monthlyAmortization <= 0) continue;
    const duePrincipal = Math.min(d.principal, d.monthlyAmortization);
    let cash = debitBalance(state.finance.ledger, "cash");
    if (cash < duePrincipal) {
      tryAutoDrawRevolver(state, duePrincipal - cash);
      cash = debitBalance(state.finance.ledger, "cash");
    }
    const paidPrincipal = Math.min(cash, duePrincipal);
    if (paidPrincipal > 0) {
      d.principal -= paidPrincipal;
      if (d.principal === 0) d.status = "repaid";
      postJournal(state, {
        memo: `Scheduled principal amortization — ${d.lender}`,
        source: "finance:debt_amort",
        cashFlow: "financing",
        lines: [
          { account: "term_debt", amount: paidPrincipal },
          { account: "cash", amount: -paidPrincipal },
        ],
      });
    }
    if (paidPrincipal < duePrincipal) {
      d.status = "breach";
      d.consecutiveBreaches += 1;
      pushNotification(
        state,
        "critical",
        "finance",
        `Missed scheduled debt principal payment to ${d.lender}!`,
      );
    }
  }
}

function settleDuePayables(state: WorldState): void {
  const tick = state.calendar.tick;
  state.finance.payables.sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    return a.dueTick - b.dueTick;
  });

  const stillOpen: WorldState["finance"]["payables"] = [];

  for (const ap of state.finance.payables) {
    if (tick < ap.dueTick) {
      stillOpen.push(ap);
      continue;
    }

    let cash = debitBalance(state.finance.ledger, "cash");
    if (cash < ap.amount && ap.priority <= 2) {
      tryAutoDrawRevolver(state, ap.amount - cash);
      cash = debitBalance(state.finance.ledger, "cash");
    }

    const payAmt = Math.min(cash, ap.amount);
    if (payAmt > 0) {
      postJournal(state, {
        memo: `Paid ${ap.counterparty} (${ap.kind})`,
        source: "finance:ap_pay",
        cashFlow: "operating",
        lines: [
          { account: ap.account, amount: payAmt },
          { account: "cash", amount: -payAmt },
        ],
      });
      ap.amount -= payAmt;
    }

    if (ap.amount > 0) {
      stillOpen.push(ap);
    }
  }

  state.finance.payables = stillOpen;
}

function updateOverdueAndBankruptcyStatus(state: WorldState): void {
  const tick = state.calendar.tick;
  const overduePayables = state.finance.payables.filter((p) => tick > p.dueTick);
  const overdueSum = overduePayables.reduce((s, p) => s + p.amount, 0);
  state.finance.overdueTotal = overdueSum;

  if (overdueSum > 0) {
    if (state.finance.overdueSinceTick === undefined) {
      state.finance.overdueSinceTick = tick;
    }
  } else {
    state.finance.overdueSinceTick = undefined;
  }

  // Supplier credit hold when supplier AP is > 15 days past due
  for (const sup of state.supply.suppliers) {
    const supOverdue = overduePayables.filter(
      (p) => p.supplierId === sup.id && tick - p.dueTick > 15,
    );
    if (supOverdue.length > 0) {
      if (!sup.creditHold) {
        sup.creditHold = true;
        sup.overdueSinceTick = tick;
        pushNotification(
          state,
          "critical",
          "supply",
          `${sup.name} placed account on CREDIT HOLD due to invoices >15 days past due.`,
        );
      }
    } else if (sup.creditHold) {
      const anyDue = overduePayables.some((p) => p.supplierId === sup.id);
      if (!anyDue) {
        sup.creditHold = false;
        sup.overdueSinceTick = undefined;
        pushNotification(state, "info", "supply", `${sup.name} lifted credit hold.`);
      }
    }
  }

  // Bankruptcy / Insolvency checks (The Working Capital Trap)
  if (state.finance.missedPayrolls >= 2) {
    state.status = "bankrupt";
    state.bankruptcyReason =
      "Insolvency: missed two bi-weekly payroll disbursements with exhausted cash and credit lines.";
    pushNotification(state, "critical", "finance", state.bankruptcyReason);
    return;
  }

  if (
    state.finance.overdueSinceTick !== undefined &&
    tick - state.finance.overdueSinceTick > 60 &&
    debitBalance(state.finance.ledger, "cash") < 100_00
  ) {
    state.status = "bankrupt";
    state.bankruptcyReason =
      "Working Capital Trap Insolvency: trade payables remained unpaid >60 days past due with zero liquidity.";
    pushNotification(state, "critical", "finance", state.bankruptcyReason);
    return;
  }

  const defaultedDebt = state.finance.debts.find((d) => d.status === "default");
  if (defaultedDebt) {
    state.status = "bankrupt";
    state.bankruptcyReason = `Lender Acceleration & Default: ${defaultedDebt.lender} called loan after repeated covenant breaches.`;
    pushNotification(state, "critical", "finance", state.bankruptcyReason);
  }
}

/**
 * Compute daily KPI telemetry & Working Capital Conversion Cycle ($\text{CCC} = \text{DIO} + \text{DSO} - \text{DPO}$).
 */
export function recordDailyTelemetry(
  state: WorldState,
  stats: {
    prevNetRevenue: Cents;
    prevCogs: Cents;
    prevOpex: Cents;
    prevNetIncome: Cents;
    prevCash: Cents;
    purchasesToday: Cents;
    unitsDemanded: number;
    unitsShipped: number;
    unitsLost: number;
  },
): DailyKpi {
  const is = buildIncomeStatement(state.finance.ledger);
  const bs = buildBalanceSheet(state.finance.ledger);

  const netRevenueToday = is.netRevenue - stats.prevNetRevenue;
  const cogsToday = is.cogs.total - stats.prevCogs;
  const grossProfitToday = netRevenueToday - cogsToday;
  const opexToday = is.opex.total - stats.prevOpex;
  const netIncomeToday = is.netIncome - stats.prevNetIncome;
  const netCashFlowToday = bs.assets.cash - stats.prevCash;

  const inventoryValue =
    bs.assets.inventoryRaw + bs.assets.inventoryWip + bs.assets.inventoryFinished;

  // Rolling 30-day window for CCC (DIO, DSO, DPO) and cash burn runway
  const recent = state.telemetry.daily.slice(-29);
  const windowDays = recent.length + 1;
  const sumRev = recent.reduce((s, d) => s + d.netRevenue, 0) + netRevenueToday;
  const sumCogs = recent.reduce((s, d) => s + d.cogs, 0) + cogsToday;
  const sumPurch =
    recent.reduce((s, d) => s + d.purchases, 0) +
    (stats.purchasesToday > 0 ? stats.purchasesToday : cogsToday);
  const sumNetCf = recent.reduce((s, d) => s + d.netCashFlow, 0) + netCashFlowToday;

  const avgDailyRev = Math.max(100, sumRev / windowDays);
  const avgDailyCogs = Math.max(100, sumCogs / windowDays);
  const avgDailyPurch = Math.max(100, sumPurch / windowDays);

  const dso = clamp(bs.assets.accountsReceivable / avgDailyRev, 0, 360);
  const dio = clamp(inventoryValue / avgDailyCogs, 0, 360);
  const dpo = clamp(bs.liabilities.accountsPayable / avgDailyPurch, 0, 360);
  const ccc = dio + dso - dpo;

  const avgDailyBurn = sumNetCf < 0 ? -sumNetCf / windowDays : 0;
  const runwayDays =
    avgDailyBurn > 100 ? Math.round(bs.assets.cash / avgDailyBurn) : null;

  const backlogUnits = state.commercial.backlog.reduce(
    (s, b) => s + Math.max(0, b.qty - b.shippedQty),
    0,
  );

  const totalAttempted = stats.unitsShipped + stats.unitsLost + backlogUnits;
  const fillRate =
    totalAttempted > 0 ? clamp(stats.unitsShipped / totalAttempted, 0, 1) : 1;

  const whUtil =
    state.warehouses.sites.length > 0
      ? state.warehouses.sites.reduce((s, w) => s + w.telemetry.utilization, 0) /
        state.warehouses.sites.length
      : 0;
  const prodUtil =
    state.operations.workCenters.length > 0
      ? state.operations.workCenters.reduce((s, w) => s + w.telemetry.utilization, 0) /
        state.operations.workCenters.length
      : 0;

  const hc = totalHeadcount(state);
  const avgMorale =
    state.org.positions.length > 0
      ? state.org.positions.reduce((s, p) => s + p.morale, 0) / state.org.positions.length
      : 0.75;
  const avgShare =
    state.market.presence.length > 0
      ? state.market.presence.reduce((s, p) => s + p.marketShare, 0) /
        state.market.presence.length
      : 0;
  const avgAwareness =
    state.market.presence.length > 0
      ? state.market.presence.reduce((s, p) => s + p.awareness, 0) /
        state.market.presence.length
      : 0;

  const kpi: DailyKpi = {
    tick: state.calendar.tick,
    cash: bs.assets.cash,
    netRevenue: netRevenueToday,
    cogs: cogsToday,
    grossProfit: grossProfitToday,
    opex: opexToday,
    netIncome: netIncomeToday,
    purchases: stats.purchasesToday,
    netCashFlow: netCashFlowToday,
    unitsDemanded: stats.unitsDemanded,
    unitsShipped: stats.unitsShipped,
    unitsLost: stats.unitsLost,
    backlogUnits,
    fillRate,
    inventoryValue,
    accountsReceivable: bs.assets.accountsReceivable,
    accountsPayable: bs.liabilities.accountsPayable,
    debt: bs.liabilities.revolver + bs.liabilities.termDebt,
    runwayDays,
    dso,
    dio,
    dpo,
    ccc,
    warehouseUtilization: whUtil,
    productionUtilization: prodUtil,
    headcount: hc,
    morale: avgMorale,
    marketShare: avgShare,
    awareness: avgAwareness,
    governanceDrift: state.org.governance.drift,
  };

  state.telemetry.daily.push(kpi);
  if (state.telemetry.daily.length > 1080) {
    state.telemetry.daily.splice(0, state.telemetry.daily.length - 1080);
  }

  return kpi;
}

/**
 * Month-end close (runs on Day 30 of every 30-day month):
 *  1. Accrue corporate income tax on positive EBT (after applying NOL carryforward).
 *  2. Test debt covenants against monthly statements.
 *  3. Snapshot auditable `MonthlyReport` (Income Statement, Balance Sheet, Cash Flow, CCC, LTV:CAC, ROIC).
 *  4. Close nominal P&L accounts into `retained_earnings` and reset MTD counters.
 */
export function runMonthEndClose(state: WorldState, lastDaily: DailyKpi): MonthlyReport {
  const tick = state.calendar.tick;

  // 1. Corporate income tax accrual
  const preTaxIs = buildIncomeStatement(state.finance.ledger);
  if (preTaxIs.ebt > 0) {
    const nolUsed = Math.min(state.finance.tax.lossCarryforward, preTaxIs.ebt);
    state.finance.tax.lossCarryforward -= nolUsed;
    const taxableIncome = preTaxIs.ebt - nolUsed;
    const taxDue = Math.round(taxableIncome * state.finance.tax.rate);
    if (taxDue > 0) {
      postJournal(state, {
        memo: `Month ${state.calendar.monthIndex} corporate income tax accrual`,
        source: "finance:tax_accrual",
        lines: [
          { account: "income_tax", amount: taxDue },
          { account: "taxes_payable", amount: -taxDue },
        ],
      });
      state.finance.payables.push({
        id: nextId(state, "tax"),
        counterparty: "Tax Authority",
        kind: "tax",
        account: "taxes_payable",
        amount: taxDue,
        createdTick: tick,
        dueTick: tick + 15,
        priority: 1,
      });
    }
  } else if (preTaxIs.ebt < 0) {
    state.finance.tax.lossCarryforward += -preTaxIs.ebt;
  }

  const statements = buildFinancialStatements(state);
  const { incomeStatement: is, balanceSheet: bs, cashFlow: cf } = statements;

  state.finance.ytdNetIncome += is.netIncome;

  // 2. Test Debt Covenants
  testDebtCovenants(state, is, bs);

  // 3. Build Monthly Executive KPIs
  const prevReport = state.telemetry.monthly[state.telemetry.monthly.length - 1];
  const revenueGrowthMoM =
    prevReport && prevReport.statements.incomeStatement.netRevenue > 0
      ? (is.netRevenue - prevReport.statements.incomeStatement.netRevenue) /
        prevReport.statements.incomeStatement.netRevenue
      : null;

  const grossMargin = is.netRevenue > 0 ? is.grossProfit / is.netRevenue : 0;
  const ebitdaMargin = is.netRevenue > 0 ? is.ebitda / is.netRevenue : 0;
  const netMargin = is.netRevenue > 0 ? is.netIncome / is.netRevenue : 0;

  const invTotal =
    bs.assets.inventoryRaw + bs.assets.inventoryWip + bs.assets.inventoryFinished;
  const inventoryTurns = invTotal > 0 ? (is.cogs.total * 12) / invTotal : 0;

  const mtd = state.telemetry.mtd;
  const cac =
    mtd.newCustomers > 0 ? mtd.marketingSpend / mtd.newCustomers : null;

  const totalCustomers = state.market.presence.reduce((s, p) => s + p.customers, 0);
  const monthlyGpPerCustomer =
    totalCustomers > 0 ? Math.max(0, is.grossProfit) / totalCustomers : 0;
  const ltv = monthlyGpPerCustomer > 0 ? monthlyGpPerCustomer * 18 : null;
  const ltvToCac =
    ltv !== null && cac !== null && cac > 0 ? ltv / cac : null;

  const investedCapital =
    bs.equity.total + bs.liabilities.revolver + bs.liabilities.termDebt - bs.assets.cash;
  const nopatAnnualized = is.ebit * 12 * (1 - state.finance.tax.rate);
  const roic =
    investedCapital > 100_00 ? nopatAnnualized / investedCapital : null;

  const burnRate = cf.netChange < 0 ? -cf.netChange : 0;
  const runwayMonths =
    burnRate > 100 ? bs.assets.cash / burnRate : null;

  const fillRate =
    mtd.unitsDemanded > 0 ? clamp(mtd.unitsSold / mtd.unitsDemanded, 0, 1) : 1;

  const report: MonthlyReport = {
    monthIndex: state.calendar.monthIndex,
    startTick: Math.max(1, tick - 29),
    endTick: tick,
    statements,
    activity: { ...mtd },
    kpis: {
      grossMargin,
      ebitdaMargin,
      netMargin,
      revenueGrowthMoM,
      dso: lastDaily.dso,
      dio: lastDaily.dio,
      dpo: lastDaily.dpo,
      ccc: lastDaily.ccc,
      inventoryTurns,
      cac,
      ltv,
      ltvToCac,
      roic,
      fillRate,
      burnRate,
      runwayMonths,
      headcount: lastDaily.headcount,
    },
  };

  state.telemetry.monthly.push(report);

  // 4. Close nominal P&L accounts into retained earnings & reset MTD counters
  closeNominalAccounts(state);
  state.telemetry.mtd = {
    marketingSpend: 0,
    newCustomers: 0,
    unitsSold: 0,
    unitsDemanded: 0,
    unitsLost: 0,
    purchases: 0,
    contractsWon: 0,
  };
  for (const ost of state.commercial.offeringStates) {
    ost.unitsSoldMtd = 0;
    ost.revenueMtd = 0;
  }

  return report;
}

function testDebtCovenants(
  state: WorldState,
  is: ReturnType<typeof buildIncomeStatement>,
  bs: ReturnType<typeof buildBalanceSheet>,
): void {
  const results: NonNullable<WorldState["finance"]["lastCovenantCheck"]> = [];

  for (const d of state.finance.debts) {
    if (d.status === "repaid" || (d.kind !== "revolver" && d.principal <= 0)) continue;
    let anyBreach = false;

    for (const cov of d.covenants) {
      let val = 0;
      if (cov.metric === "min_cash") {
        val = bs.assets.cash;
      } else if (cov.metric === "current_ratio") {
        val =
          bs.liabilities.currentLiabilities > 0
            ? bs.assets.currentAssets / bs.liabilities.currentLiabilities
            : 10;
      } else if (cov.metric === "interest_coverage") {
        val = is.interestExpense > 0 ? is.ebitda / is.interestExpense : 10;
      } else if (cov.metric === "debt_to_ebitda") {
        const totalDebt = bs.liabilities.revolver + bs.liabilities.termDebt;
        const annualEbitda = is.ebitda * 12;
        val = annualEbitda > 0 ? totalDebt / annualEbitda : 99;
      }

      const ok = cov.comparator === "gte" ? val >= cov.threshold : val <= cov.threshold;
      results.push({ debtId: d.id, metric: cov.metric, value: val, threshold: cov.threshold, ok });
      if (!ok) anyBreach = true;
    }

    if (anyBreach) {
      d.consecutiveBreaches += 1;
      d.status = d.consecutiveBreaches >= 3 ? "default" : "breach";
      pushNotification(
        state,
        "critical",
        "finance",
        `Debt covenant breach on ${d.lender} (${d.kind}) — consecutive breach #${d.consecutiveBreaches}.`,
      );
    } else if (d.status === "breach") {
      d.consecutiveBreaches = 0;
      d.status = "active";
    }
  }

  state.finance.lastCovenantCheck = results;
}

/**
 * Daily balance-sheet covenant check (`min_cash`, `current_ratio`) executed during Step 7 (Treasury).
 * Flags `d.status = "breach"` immediately if cash or current ratio drops below covenant floor.
 */
export function evaluateDailyLoanCovenants(state: WorldState): void {
  const bs = buildBalanceSheet(state.finance.ledger);
  const is = buildIncomeStatement(state.finance.ledger);
  const results: NonNullable<WorldState["finance"]["lastCovenantCheck"]> = [];

  for (const d of state.finance.debts) {
    if (d.status === "repaid" || (d.kind !== "revolver" && d.principal <= 0)) continue;
    let dailyBreach = false;

    for (const cov of d.covenants) {
      let val = 0;
      if (cov.metric === "min_cash") {
        val = bs.assets.cash;
      } else if (cov.metric === "current_ratio") {
        val =
          bs.liabilities.currentLiabilities > 0
            ? bs.assets.currentAssets / bs.liabilities.currentLiabilities
            : 10;
      } else if (cov.metric === "interest_coverage") {
        val = is.interestExpense > 0 ? is.ebitda / is.interestExpense : 10;
      } else if (cov.metric === "debt_to_ebitda") {
        const totalDebt = bs.liabilities.revolver + bs.liabilities.termDebt;
        const annualEbitda = is.ebitda * 12;
        val = annualEbitda > 0 ? totalDebt / annualEbitda : 99;
      }

      const ok = cov.comparator === "gte" ? val >= cov.threshold : val <= cov.threshold;
      results.push({ debtId: d.id, metric: cov.metric, value: val, threshold: cov.threshold, ok });
      if (!ok && (cov.metric === "min_cash" || cov.metric === "current_ratio")) {
        dailyBreach = true;
      }
    }

    if (dailyBreach && d.status === "active") {
      d.status = "breach";
      pushNotification(
        state,
        "critical",
        "finance",
        `Intra-month debt covenant breach on ${d.lender} (${d.kind}).`,
      );
    }
  }

  if (results.length > 0) {
    state.finance.lastCovenantCheck = results;
  }
}

export type { DebtFacility };
