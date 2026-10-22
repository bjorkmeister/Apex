/**
 * Double-Entry General Ledger & Three-Statement Financial Engine.
 *
 * Conventions:
 *  - Every account is stored signed in `ledger.balances[account]` (Debit > 0, Credit < 0).
 *  - Every `postJournal` call enforces `sum(lines.amount) === 0` in integer cents.
 *  - Therefore `sum(Object.values(ledger.balances)) === 0` is an unbreakable invariant at all times.
 *  - At month-end (every 30 ticks), nominal (Revenue, COGS, OpEx, Below-EBITDA) accounts are
 *    closed into `retained_earnings`, resetting P&L accounts for the next month.
 */
import {
  AccountCode,
  type BalanceSheet,
  type CashFlowCategory,
  type CashFlowStatement,
  type Cents,
  type FinancialStatements,
  type IncomeStatement,
  type JournalLine,
  type Ledger,
  type Payable,
  type WorldState,
} from "../schema";
import { nextId } from "./modifiers";

const ALL_ACCOUNTS = AccountCode.options;

export const NOMINAL_ACCOUNTS: AccountCode[] = [
  "revenue_product",
  "revenue_service",
  "revenue_subscription",
  "contra_revenue_returns",
  "cogs_product",
  "cogs_direct_labor",
  "cogs_freight_out",
  "cogs_spoilage_shrink",
  "cogs_outsourcing",
  "opex_payroll",
  "opex_marketing",
  "opex_warehousing",
  "opex_rent",
  "opex_capability",
  "opex_maintenance",
  "opex_channel_fees",
  "opex_recruiting",
  "opex_fines",
  "opex_bad_debt",
  "opex_other",
  "depreciation",
  "interest_expense",
  "other_income",
  "income_tax",
];

export function createEmptyLedger(): Ledger {
  const balances: Record<string, Cents> = {};
  for (const acc of ALL_ACCOUNTS) {
    balances[acc] = 0;
  }
  return {
    balances,
    journal: [],
    nextEntryId: 1,
  };
}

/** Raw signed balance (Debit > 0, Credit < 0). */
export function rawBalance(ledger: Ledger, account: AccountCode): Cents {
  return ledger.balances[account] ?? 0;
}

/** Debit-normal balance (Assets, COGS, OpEx, Contra-Revenue). */
export function debitBalance(ledger: Ledger, account: AccountCode): Cents {
  return ledger.balances[account] ?? 0;
}

/** Credit-normal balance (Liabilities, Equity, Revenue, Accumulated Depreciation). */
export function creditBalance(ledger: Ledger, account: AccountCode): Cents {
  return -(ledger.balances[account] ?? 0);
}

/**
 * Post a balanced double-entry journal entry.
 * Throws if lines do not sum to 0 or if any amount is non-integer.
 */
export function postJournal(
  state: WorldState,
  opts: {
    memo: string;
    source: string;
    lines: JournalLine[];
    cashFlow?: CashFlowCategory;
  },
): void {
  const nonZero = opts.lines.filter((l) => l.amount !== 0);
  if (nonZero.length === 0) return;

  let sum = 0;
  let cashDelta = 0;
  for (const l of nonZero) {
    if (!Number.isInteger(l.amount)) {
      throw new Error(`Non-integer journal line on ${l.account}: ${l.amount} (${opts.memo})`);
    }
    sum += l.amount;
    if (l.account === "cash") cashDelta += l.amount;
  }
  if (sum !== 0) {
    throw new Error(`Unbalanced journal entry (sum=${sum}): ${opts.memo}`);
  }

  for (const l of nonZero) {
    state.finance.ledger.balances[l.account] =
      (state.finance.ledger.balances[l.account] ?? 0) + l.amount;
  }

  if (cashDelta !== 0) {
    const cat: CashFlowCategory = opts.cashFlow ?? "operating";
    state.finance.periodCashFlow[cat] += cashDelta;
  }

  const entryId = state.finance.ledger.nextEntryId++;
  state.finance.ledger.journal.push({
    id: entryId,
    tick: state.calendar.tick,
    memo: opts.memo,
    source: opts.source,
    lines: nonZero,
    cashFlow: opts.cashFlow,
  });

  if (state.finance.ledger.journal.length > 600) {
    state.finance.ledger.journal.splice(0, state.finance.ledger.journal.length - 600);
  }
}

/**
 * Spend operating cash if available; otherwise book an Accounts Payable item.
 * Preserves hard conservation of cash: cash never drops below 0.
 */
export function payOrQueuePayable(
  state: WorldState,
  opts: {
    debitAccount: AccountCode;
    amount: Cents;
    memo: string;
    source: string;
    counterparty: string;
    kind: Payable["kind"];
    dueOffsetDays?: number;
    priority?: number;
    supplierId?: string;
    cashFlow?: CashFlowCategory;
  },
): { paidCash: Cents; queuedAp: Cents } {
  const amt = Math.round(opts.amount);
  if (amt <= 0) return { paidCash: 0, queuedAp: 0 };

  const dueOffset = opts.dueOffsetDays ?? 0;
  const availableCash = Math.max(0, debitBalance(state.finance.ledger, "cash"));

  if (dueOffset === 0 && availableCash >= amt) {
    postJournal(state, {
      memo: opts.memo,
      source: opts.source,
      cashFlow: opts.cashFlow ?? "operating",
      lines: [
        { account: opts.debitAccount, amount: amt },
        { account: "cash", amount: -amt },
      ],
    });
    return { paidCash: amt, queuedAp: 0 };
  }

  const paidCash = dueOffset === 0 ? availableCash : 0;
  const queuedAp = amt - paidCash;

  const lines: JournalLine[] = [{ account: opts.debitAccount, amount: amt }];
  if (paidCash > 0) lines.push({ account: "cash", amount: -paidCash });
  if (queuedAp > 0) lines.push({ account: "accounts_payable", amount: -queuedAp });

  postJournal(state, {
    memo: opts.memo,
    source: opts.source,
    cashFlow: opts.cashFlow ?? "operating",
    lines,
  });

  if (queuedAp > 0) {
    state.finance.payables.push({
      id: nextId(state, "ap"),
      counterparty: opts.counterparty,
      kind: opts.kind,
      account: "accounts_payable",
      amount: queuedAp,
      createdTick: state.calendar.tick,
      dueTick: state.calendar.tick + dueOffset,
      supplierId: opts.supplierId,
      priority: opts.priority ?? 5,
    });
  }

  return { paidCash, queuedAp };
}

/** Build the Income Statement from current nominal account balances. */
export function buildIncomeStatement(ledger: Ledger): IncomeStatement {
  const revProd = creditBalance(ledger, "revenue_product");
  const revServ = creditBalance(ledger, "revenue_service");
  const revSub = creditBalance(ledger, "revenue_subscription");
  const grossRevenue = revProd + revServ + revSub;
  const returnsAndAllowances = debitBalance(ledger, "contra_revenue_returns");
  const netRevenue = grossRevenue - returnsAndAllowances;

  const cogsProduct = debitBalance(ledger, "cogs_product");
  const cogsDirectLabor = debitBalance(ledger, "cogs_direct_labor");
  const cogsFreightOut = debitBalance(ledger, "cogs_freight_out");
  const cogsSpoilageShrink = debitBalance(ledger, "cogs_spoilage_shrink");
  const cogsOutsourcing = debitBalance(ledger, "cogs_outsourcing");
  const totalCogs =
    cogsProduct + cogsDirectLabor + cogsFreightOut + cogsSpoilageShrink + cogsOutsourcing;

  const grossProfit = netRevenue - totalCogs;

  const opexPayroll = debitBalance(ledger, "opex_payroll");
  const opexMarketing = debitBalance(ledger, "opex_marketing");
  const opexWarehousing = debitBalance(ledger, "opex_warehousing");
  const opexRent = debitBalance(ledger, "opex_rent");
  const opexCapability = debitBalance(ledger, "opex_capability");
  const opexMaintenance = debitBalance(ledger, "opex_maintenance");
  const opexChannelFees = debitBalance(ledger, "opex_channel_fees");
  const opexRecruiting = debitBalance(ledger, "opex_recruiting");
  const opexFines = debitBalance(ledger, "opex_fines");
  const opexBadDebt = debitBalance(ledger, "opex_bad_debt");
  const opexOther = debitBalance(ledger, "opex_other");
  const totalOpex =
    opexPayroll +
    opexMarketing +
    opexWarehousing +
    opexRent +
    opexCapability +
    opexMaintenance +
    opexChannelFees +
    opexRecruiting +
    opexFines +
    opexBadDebt +
    opexOther;

  const ebitda = grossProfit - totalOpex;
  const depreciation = debitBalance(ledger, "depreciation");
  const ebit = ebitda - depreciation;
  const interestExpense = debitBalance(ledger, "interest_expense");
  const otherIncome = creditBalance(ledger, "other_income");
  const ebt = ebit - interestExpense + otherIncome;
  const incomeTax = debitBalance(ledger, "income_tax");
  const netIncome = ebt - incomeTax;

  return {
    grossRevenue,
    returnsAndAllowances,
    netRevenue,
    cogs: {
      product: cogsProduct,
      directLabor: cogsDirectLabor,
      freightOut: cogsFreightOut,
      spoilageShrink: cogsSpoilageShrink,
      outsourcing: cogsOutsourcing,
      total: totalCogs,
    },
    grossProfit,
    opex: {
      payroll: opexPayroll,
      marketing: opexMarketing,
      warehousing: opexWarehousing,
      rent: opexRent,
      capability: opexCapability,
      maintenance: opexMaintenance,
      channelFees: opexChannelFees,
      recruiting: opexRecruiting,
      fines: opexFines,
      badDebt: opexBadDebt,
      other: opexOther,
      total: totalOpex,
    },
    ebitda,
    depreciation,
    ebit,
    interestExpense,
    otherIncome,
    ebt,
    incomeTax,
    netIncome,
  };
}

/**
 * Build the Balance Sheet. Includes unclosed current-period `netIncome` inside `retainedEarnings`
 * so `Assets === Liabilities + Equity` holds on every single tick, not just at month-end close.
 */
export function buildBalanceSheet(ledger: Ledger): BalanceSheet {
  const is = buildIncomeStatement(ledger);

  const cash = debitBalance(ledger, "cash");
  const accountsReceivable = debitBalance(ledger, "accounts_receivable");
  const inventoryRaw = debitBalance(ledger, "inventory_raw");
  const inventoryWip = debitBalance(ledger, "inventory_wip");
  const inventoryFinished = debitBalance(ledger, "inventory_finished");
  const prepaid = debitBalance(ledger, "prepaid");
  const currentAssets =
    cash + accountsReceivable + inventoryRaw + inventoryWip + inventoryFinished + prepaid;

  const ppeGross = debitBalance(ledger, "ppe_gross");
  const accumDep = creditBalance(ledger, "accumulated_depreciation");
  const ppeNet = ppeGross - accumDep;
  const totalAssets = currentAssets + ppeNet;

  const accountsPayable = creditBalance(ledger, "accounts_payable");
  const accruedPayroll = creditBalance(ledger, "accrued_payroll");
  const accruedInterest = creditBalance(ledger, "accrued_interest");
  const taxesPayable = creditBalance(ledger, "taxes_payable");
  const deferredRevenue = creditBalance(ledger, "deferred_revenue");
  const revolver = creditBalance(ledger, "revolver");
  const currentLiabilities =
    accountsPayable +
    accruedPayroll +
    accruedInterest +
    taxesPayable +
    deferredRevenue +
    revolver;

  const termDebt = creditBalance(ledger, "term_debt");
  const totalLiabilities = currentLiabilities + termDebt;

  const paidInCapital = creditBalance(ledger, "paid_in_capital");
  const retainedEarnings = creditBalance(ledger, "retained_earnings") + is.netIncome;
  const totalEquity = paidInCapital + retainedEarnings;

  return {
    assets: {
      cash,
      accountsReceivable,
      inventoryRaw,
      inventoryWip,
      inventoryFinished,
      prepaid,
      currentAssets,
      ppeNet,
      total: totalAssets,
    },
    liabilities: {
      accountsPayable,
      accruedPayroll,
      accruedInterest,
      taxesPayable,
      deferredRevenue,
      revolver,
      currentLiabilities,
      termDebt,
      total: totalLiabilities,
    },
    equity: {
      paidInCapital,
      retainedEarnings,
      total: totalEquity,
    },
    balanced: totalAssets === totalLiabilities + totalEquity,
  };
}

export function buildCashFlowStatement(state: WorldState): CashFlowStatement {
  const beginCash = state.finance.periodStartCash;
  const { operating, investing, financing } = state.finance.periodCashFlow;
  const netChange = operating + investing + financing;
  const endCash = debitBalance(state.finance.ledger, "cash");
  return {
    beginCash,
    operating,
    investing,
    financing,
    netChange,
    endCash,
    reconciles: beginCash + netChange === endCash,
  };
}

export function buildFinancialStatements(state: WorldState): FinancialStatements {
  return {
    incomeStatement: buildIncomeStatement(state.finance.ledger),
    balanceSheet: buildBalanceSheet(state.finance.ledger),
    cashFlow: buildCashFlowStatement(state),
  };
}

/**
 * Close all nominal (P&L) accounts into `retained_earnings` at month-end and reset cash-flow buckets.
 */
export function closeNominalAccounts(state: WorldState): void {
  const lines: JournalLine[] = [];
  let netOffset = 0;
  for (const acc of NOMINAL_ACCOUNTS) {
    const bal = rawBalance(state.finance.ledger, acc);
    if (bal !== 0) {
      lines.push({ account: acc, amount: -bal });
      netOffset += bal;
    }
  }
  if (lines.length > 0) {
    lines.push({ account: "retained_earnings", amount: netOffset });
    postJournal(state, {
      memo: `Month ${state.calendar.monthIndex} closing entry`,
      source: "ledger:close",
      lines,
    });
  }
  state.finance.periodStartCash = debitBalance(state.finance.ledger, "cash");
  state.finance.periodCashFlow = { operating: 0, investing: 0, financing: 0 };
}

/** Verify trial balance === 0 and sub-ledger reconciliations. */
export function verifyAccountingInvariants(state: WorldState): string[] {
  const errors: string[] = [];
  let sum = 0;
  for (const [acc, val] of Object.entries(state.finance.ledger.balances)) {
    if (!Number.isInteger(val)) errors.push(`Non-integer balance on ${acc}: ${val}`);
    sum += val;
  }
  if (sum !== 0) errors.push(`Trial balance non-zero: ${sum}`);

  const bs = buildBalanceSheet(state.finance.ledger);
  if (!bs.balanced) {
    errors.push(
      `Balance sheet mismatch: A=${bs.assets.total} vs L+E=${bs.liabilities.total + bs.equity.total}`,
    );
  }

  const cf = buildCashFlowStatement(state);
  if (!cf.reconciles) {
    errors.push(
      `Cash flow mismatch: begin(${cf.beginCash}) + net(${cf.netChange}) != end(${cf.endCash})`,
    );
  }

  const cash = debitBalance(state.finance.ledger, "cash");
  if (cash < 0) errors.push(`Negative cash balance: ${cash}`);

  // Inventory sub-ledger reconciliation (lots vs GL)
  let rawLotsVal = 0;
  let finLotsVal = 0;
  for (const lot of state.warehouses.lots) {
    const item = state.catalog.items.find((i) => i.id === lot.itemId);
    if (item?.kind === "finished") finLotsVal += lot.value;
    else rawLotsVal += lot.value;
  }
  const glRaw = debitBalance(state.finance.ledger, "inventory_raw");
  const glFin = debitBalance(state.finance.ledger, "inventory_finished");
  if (rawLotsVal !== glRaw) {
    errors.push(`Raw inventory lot/GL mismatch: lots=${rawLotsVal} vs GL=${glRaw}`);
  }
  if (finLotsVal !== glFin) {
    errors.push(`Finished inventory lot/GL mismatch: lots=${finLotsVal} vs GL=${glFin}`);
  }

  // WIP sub-ledger reconciliation
  const wipOrdersVal = state.operations.orders.reduce((s, o) => s + o.wipValue, 0);
  const glWip = debitBalance(state.finance.ledger, "inventory_wip");
  if (wipOrdersVal !== glWip) {
    errors.push(`WIP order/GL mismatch: orders=${wipOrdersVal} vs GL=${glWip}`);
  }

  // AR sub-ledger reconciliation
  const arSub = state.finance.receivables.reduce((s, r) => s + r.amount, 0);
  const glAr = debitBalance(state.finance.ledger, "accounts_receivable");
  if (arSub !== glAr) {
    errors.push(`AR sub-ledger/GL mismatch: sub=${arSub} vs GL=${glAr}`);
  }

  // AP & Taxes Payable sub-ledger reconciliation
  const apSub = state.finance.payables
    .filter((p) => p.account === "accounts_payable")
    .reduce((s, p) => s + p.amount, 0);
  const glAp = creditBalance(state.finance.ledger, "accounts_payable");
  if (apSub !== glAp) {
    errors.push(`AP sub-ledger/GL mismatch: sub=${apSub} vs GL=${glAp}`);
  }

  const taxSub = state.finance.payables
    .filter((p) => p.account === "taxes_payable")
    .reduce((s, p) => s + p.amount, 0);
  const glTax = creditBalance(state.finance.ledger, "taxes_payable");
  if (taxSub !== glTax) {
    errors.push(`Taxes payable sub-ledger/GL mismatch: sub=${taxSub} vs GL=${glTax}`);
  }

  return errors;
}
