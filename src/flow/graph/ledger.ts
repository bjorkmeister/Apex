/**
 * APEX Studio v3.2 — Double-Entry General Ledger & Three-Statement Engine (`src/flow/graph/ledger.ts`).
 *
 * Extracted from `src/core/engine/ledger.ts` and decoupled from `WorldState`.
 *
 * Conventions:
 * - Every account balance is stored signed in `ledger.balances[account]` (Debit > 0, Credit < 0).
 * - Every `postJournal` call enforces balanced debits and credits (`sum(lines.amount) === 0`).
 * - Consequently `sum(Object.values(ledger.balances)) === 0` holds at every tick.
 * - `buildBalanceSheet` includes unclosed current-period `netIncome` inside `retainedEarnings`
 *   so `Assets === Liabilities + Equity` holds on every tick, not only at month-end close.
 */
import type { AccountType, EntityURI, LedgerAccount } from "./types.ts";

export type CashFlowCategory = "operating" | "investing" | "financing";

export interface JournalLine {
  account: string;
  amount: number;
}

export interface JournalEntry {
  id: number;
  tick: number;
  memo: string;
  source: string;
  lines: JournalLine[];
  debitTotal: number;
  creditTotal: number;
  cashFlow?: CashFlowCategory;
}

export interface GraphLedger {
  balances: Record<string, number>;
  journal: JournalEntry[];
  nextEntryId: number;
  periodStartCash: number;
  periodCashFlow: {
    operating: number;
    investing: number;
    financing: number;
  };
  cumulativeDebits: number;
  cumulativeCredits: number;
}

export interface IncomeStatement {
  grossRevenue: number;
  returnsAndAllowances: number;
  netRevenue: number;
  cogs: {
    product: number;
    directLabor: number;
    freightOut: number;
    spoilageShrink: number;
    outsourcing: number;
    total: number;
  };
  grossProfit: number;
  opex: {
    payroll: number;
    marketing: number;
    warehousing: number;
    rent: number;
    capability: number;
    maintenance: number;
    channelFees: number;
    recruiting: number;
    fines: number;
    badDebt: number;
    other: number;
    total: number;
  };
  ebitda: number;
  depreciation: number;
  ebit: number;
  interestExpense: number;
  otherIncome: number;
  ebt: number;
  incomeTax: number;
  netIncome: number;
}

export interface BalanceSheet {
  assets: {
    cash: number;
    accountsReceivable: number;
    inventoryRaw: number;
    inventoryWip: number;
    inventoryFinished: number;
    prepaid: number;
    currentAssets: number;
    ppeNet: number;
    total: number;
  };
  liabilities: {
    accountsPayable: number;
    accruedPayroll: number;
    accruedInterest: number;
    taxesPayable: number;
    deferredRevenue: number;
    revolver: number;
    currentLiabilities: number;
    termDebt: number;
    total: number;
  };
  equity: {
    paidInCapital: number;
    retainedEarnings: number;
    total: number;
  };
  balanced: boolean;
}

export interface CashFlowStatement {
  beginCash: number;
  operating: number;
  investing: number;
  financing: number;
  netChange: number;
  endCash: number;
  reconciles: boolean;
}

export interface FinancialStatements {
  incomeStatement: IncomeStatement;
  balanceSheet: BalanceSheet;
  cashFlow: CashFlowStatement;
}

export const STANDARD_ACCOUNT_DEFS: readonly { code: string; name: string; type: AccountType }[] = [
  { code: "cash", name: "Cash", type: "asset" },
  { code: "accounts_receivable", name: "Accounts Receivable", type: "asset" },
  { code: "inventory_raw", name: "Raw Materials Inventory", type: "asset" },
  { code: "inventory_wip", name: "Work in Progress Inventory", type: "asset" },
  { code: "inventory_finished", name: "Finished Goods Inventory", type: "asset" },
  { code: "prepaid", name: "Prepaid Expenses", type: "asset" },
  { code: "ppe_gross", name: "Property, Plant & Equipment (Gross)", type: "asset" },
  { code: "accumulated_depreciation", name: "Accumulated Depreciation", type: "asset" },
  { code: "accounts_payable", name: "Accounts Payable", type: "liability" },
  { code: "accrued_payroll", name: "Accrued Payroll", type: "liability" },
  { code: "accrued_interest", name: "Accrued Interest", type: "liability" },
  { code: "taxes_payable", name: "Taxes Payable", type: "liability" },
  { code: "deferred_revenue", name: "Deferred Revenue", type: "liability" },
  { code: "revolver", name: "Revolving Credit Line", type: "liability" },
  { code: "term_debt", name: "Term Debt", type: "liability" },
  { code: "paid_in_capital", name: "Paid-In Capital", type: "equity" },
  { code: "retained_earnings", name: "Retained Earnings", type: "equity" },
  { code: "revenue_product", name: "Product Revenue", type: "revenue" },
  { code: "revenue_service", name: "Service Revenue", type: "revenue" },
  { code: "revenue_subscription", name: "Recurring Revenue", type: "revenue" },
  { code: "contra_revenue_returns", name: "Returns & Allowances", type: "revenue" },
  { code: "cogs_product", name: "Cost of Goods Sold - Direct", type: "expense" },
  { code: "cogs_direct_labor", name: "Cost of Goods Sold - Direct Labor", type: "expense" },
  { code: "cogs_freight_out", name: "Cost of Goods Sold - Outbound Logistics", type: "expense" },
  { code: "cogs_spoilage_shrink", name: "Cost of Goods Sold - Spoilage & Shrinkage", type: "expense" },
  { code: "cogs_outsourcing", name: "Cost of Goods Sold - External Capacity", type: "expense" },
  { code: "opex_payroll", name: "Operating Expense - Payroll", type: "expense" },
  { code: "opex_marketing", name: "Operating Expense - Demand Generation", type: "expense" },
  { code: "opex_warehousing", name: "Operating Expense - Buffer & Storage", type: "expense" },
  { code: "opex_rent", name: "Operating Expense - Facilities", type: "expense" },
  { code: "opex_capability", name: "Operating Expense - Systems & Tools", type: "expense" },
  { code: "opex_maintenance", name: "Operating Expense - Asset Maintenance", type: "expense" },
  { code: "opex_channel_fees", name: "Operating Expense - Channel Fees", type: "expense" },
  { code: "opex_recruiting", name: "Operating Expense - Onboarding", type: "expense" },
  { code: "opex_fines", name: "Operating Expense - SLA Penalties", type: "expense" },
  { code: "opex_bad_debt", name: "Operating Expense - Credit Losses", type: "expense" },
  { code: "opex_other", name: "Operating Expense - General & Admin", type: "expense" },
  { code: "depreciation", name: "Depreciation Expense", type: "expense" },
  { code: "interest_expense", name: "Interest Expense", type: "expense" },
  { code: "other_income", name: "Other Non-Operating Income", type: "revenue" },
  { code: "income_tax", name: "Income Tax Expense", type: "expense" },
];

export const NOMINAL_ACCOUNTS: readonly string[] = STANDARD_ACCOUNT_DEFS.filter(
  (a) => a.type === "revenue" || a.type === "expense",
).map((a) => a.code);

const STANDARD_CODES = new Set(STANDARD_ACCOUNT_DEFS.map((a) => a.code));

export function createDefaultAccounts(): Record<string, LedgerAccount> {
  const out: Record<string, LedgerAccount> = {};
  for (const def of STANDARD_ACCOUNT_DEFS) {
    const uri: EntityURI = `apex://account/${def.code}`;
    out[uri] = {
      uri,
      code: def.code,
      name: def.name,
      type: def.type,
    };
  }
  return out;
}

/** Normalize an account reference (URI or code) to a canonical ledger key. */
export function resolveAccountCode(
  accountRef: string,
  accounts?: Record<string, LedgerAccount>,
): string {
  if (accounts && accounts[accountRef]) {
    return accounts[accountRef].code;
  }
  if (accountRef.startsWith("apex://account/")) {
    return accountRef.slice("apex://account/".length);
  }
  return accountRef;
}

export function createEmptyLedger(
  accounts?: Record<string, LedgerAccount>,
  openingCash = 0,
  openingBalances: Record<string, number> = {},
): GraphLedger {
  const balances: Record<string, number> = {};
  for (const def of STANDARD_ACCOUNT_DEFS) {
    balances[def.code] = 0;
  }
  if (accounts) {
    for (const acc of Object.values(accounts)) {
      if (!(acc.code in balances)) balances[acc.code] = 0;
    }
  }

  const ledger: GraphLedger = {
    balances,
    journal: [],
    nextEntryId: 1,
    periodStartCash: 0,
    periodCashFlow: { operating: 0, investing: 0, financing: 0 },
    cumulativeDebits: 0,
    cumulativeCredits: 0,
  };

  // Book opening balances via balanced journal entry against paid_in_capital.
  const initLines: JournalLine[] = [];
  let netDebit = 0;
  if (Number.isFinite(openingCash) && openingCash !== 0) {
    initLines.push({ account: "cash", amount: openingCash });
    netDebit += openingCash;
  }
  for (const [rawKey, val] of Object.entries(openingBalances)) {
    if (!Number.isFinite(val) || val === 0) continue;
    const code = resolveAccountCode(rawKey, accounts);
    if (code === "cash" && openingCash !== 0) continue;
    initLines.push({ account: code, amount: val });
    netDebit += val;
  }
  if (initLines.length > 0) {
    if (Math.abs(netDebit) > 1e-9) {
      initLines.push({ account: "paid_in_capital", amount: -netDebit });
    }
    postJournal(
      ledger,
      {
        tick: 0,
        memo: "Opening balance sheet initialization",
        source: "ledger:opening",
        lines: initLines,
        cashFlow: "financing",
      },
      accounts,
    );
    ledger.periodStartCash = debitBalance(ledger, "cash");
    ledger.periodCashFlow = { operating: 0, investing: 0, financing: 0 };
  }

  return ledger;
}

/** Raw signed balance (Debit > 0, Credit < 0). */
export function rawBalance(ledger: GraphLedger, account: string): number {
  const code = account.startsWith("apex://account/") ? account.slice("apex://account/".length) : account;
  return ledger.balances[code] ?? 0;
}

/** Debit-normal balance (Assets, COGS, OpEx, Contra-Revenue). */
export function debitBalance(ledger: GraphLedger, account: string): number {
  return rawBalance(ledger, account);
}

/** Credit-normal balance (Liabilities, Equity, Revenue, Accumulated Depreciation). */
export function creditBalance(ledger: GraphLedger, account: string): number {
  return -rawBalance(ledger, account);
}

/**
 * Post a balanced double-entry journal entry.
 * Enforces `Math.abs(sum(lines.amount)) <= 1e-6` so `debet === kredit` holds at all times.
 */
export function postJournal(
  ledger: GraphLedger,
  opts: {
    tick: number;
    memo: string;
    source: string;
    lines: JournalLine[];
    cashFlow?: CashFlowCategory;
  },
  accounts?: Record<string, LedgerAccount>,
): JournalEntry | null {
  const normalized: JournalLine[] = [];
  for (const l of opts.lines) {
    if (!Number.isFinite(l.amount) || Math.abs(l.amount) < 1e-12) continue;
    normalized.push({
      account: resolveAccountCode(l.account, accounts),
      amount: l.amount,
    });
  }
  if (normalized.length === 0) return null;

  let sum = 0;
  for (const l of normalized) {
    sum += l.amount;
  }
  if (Math.abs(sum) > 1e-6) {
    throw new Error(`Unbalanced journal entry (sum=${sum}): ${opts.memo}`);
  }
  // Absorb any sub-picocent IEEE-754 residue on the last line so sum is strictly 0.
  if (sum !== 0 && normalized.length > 0) {
    normalized[normalized.length - 1].amount -= sum;
  }

  let debitTotal = 0;
  let creditTotal = 0;
  let cashDelta = 0;

  for (const l of normalized) {
    if (l.amount > 0) debitTotal += l.amount;
    else creditTotal += -l.amount;
    ledger.balances[l.account] = (ledger.balances[l.account] ?? 0) + l.amount;
    if (l.account === "cash") cashDelta += l.amount;
  }

  ledger.cumulativeDebits += debitTotal;
  ledger.cumulativeCredits += creditTotal;

  if (cashDelta !== 0) {
    const cat: CashFlowCategory = opts.cashFlow ?? "operating";
    ledger.periodCashFlow[cat] += cashDelta;
  }

  const entry: JournalEntry = {
    id: ledger.nextEntryId++,
    tick: opts.tick,
    memo: opts.memo,
    source: opts.source,
    lines: normalized,
    debitTotal,
    creditTotal,
    cashFlow: opts.cashFlow,
  };
  ledger.journal.push(entry);

  if (ledger.journal.length > 4000) {
    ledger.journal = ledger.journal.slice(-2000);
  }
  return entry;
}

/** Build the Income Statement from current nominal account balances. */
export function buildIncomeStatement(
  ledger: GraphLedger,
  accounts?: Record<string, LedgerAccount>,
): IncomeStatement {
  const revProd = creditBalance(ledger, "revenue_product");
  const revServ = creditBalance(ledger, "revenue_service");
  const revSub = creditBalance(ledger, "revenue_subscription");
  let customRevenue = 0;
  let customExpense = 0;

  if (accounts) {
    for (const acc of Object.values(accounts)) {
      if (STANDARD_CODES.has(acc.code)) continue;
      if (acc.type === "revenue") customRevenue += creditBalance(ledger, acc.code);
      else if (acc.type === "expense") customExpense += debitBalance(ledger, acc.code);
    }
  }

  const grossRevenue = revProd + revServ + revSub + customRevenue;
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
  const opexOther = debitBalance(ledger, "opex_other") + customExpense;
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
 * so `Assets === Liabilities + Equity` holds on every single tick.
 */
export function buildBalanceSheet(
  ledger: GraphLedger,
  accounts?: Record<string, LedgerAccount>,
): BalanceSheet {
  const is = buildIncomeStatement(ledger, accounts);

  let customAsset = 0;
  let customLiability = 0;
  let customEquity = 0;
  if (accounts) {
    for (const acc of Object.values(accounts)) {
      if (STANDARD_CODES.has(acc.code)) continue;
      if (acc.type === "asset") customAsset += debitBalance(ledger, acc.code);
      else if (acc.type === "liability") customLiability += creditBalance(ledger, acc.code);
      else if (acc.type === "equity") customEquity += creditBalance(ledger, acc.code);
    }
  }

  const cash = debitBalance(ledger, "cash");
  const accountsReceivable = debitBalance(ledger, "accounts_receivable");
  const inventoryRaw = debitBalance(ledger, "inventory_raw");
  const inventoryWip = debitBalance(ledger, "inventory_wip");
  const inventoryFinished = debitBalance(ledger, "inventory_finished");
  const prepaid = debitBalance(ledger, "prepaid") + customAsset;
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
  const deferredRevenue = creditBalance(ledger, "deferred_revenue") + customLiability;
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

  const paidInCapital = creditBalance(ledger, "paid_in_capital") + customEquity;
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
    balanced: Math.abs(totalAssets - (totalLiabilities + totalEquity)) <= 1e-6,
  };
}

export function buildCashFlowStatement(ledger: GraphLedger): CashFlowStatement {
  const beginCash = ledger.periodStartCash;
  const { operating, investing, financing } = ledger.periodCashFlow;
  const netChange = operating + investing + financing;
  const endCash = debitBalance(ledger, "cash");
  return {
    beginCash,
    operating,
    investing,
    financing,
    netChange,
    endCash,
    reconciles: Math.abs(beginCash + netChange - endCash) <= 1e-6,
  };
}

export function buildFinancialStatements(
  ledger: GraphLedger,
  accounts?: Record<string, LedgerAccount>,
): FinancialStatements {
  return {
    incomeStatement: buildIncomeStatement(ledger, accounts),
    balanceSheet: buildBalanceSheet(ledger, accounts),
    cashFlow: buildCashFlowStatement(ledger),
  };
}

/**
 * Close all nominal (P&L) accounts into `retained_earnings` at period-end and reset cash-flow buckets.
 */
export function closeNominalAccounts(
  ledger: GraphLedger,
  tick: number,
  monthIndex: number,
  accounts?: Record<string, LedgerAccount>,
): void {
  const nominalCodes = new Set<string>(NOMINAL_ACCOUNTS);
  if (accounts) {
    for (const acc of Object.values(accounts)) {
      if (acc.type === "revenue" || acc.type === "expense") {
        nominalCodes.add(acc.code);
      }
    }
  }

  const lines: JournalLine[] = [];
  let netOffset = 0;
  for (const acc of nominalCodes) {
    const bal = rawBalance(ledger, acc);
    if (Math.abs(bal) > 1e-12) {
      lines.push({ account: acc, amount: -bal });
      netOffset += bal;
    }
  }
  if (lines.length > 0) {
    lines.push({ account: "retained_earnings", amount: netOffset });
    postJournal(
      ledger,
      {
        tick,
        memo: `Month ${monthIndex} closing entry`,
        source: "ledger:close",
        lines,
      },
      accounts,
    );
  }
  ledger.periodStartCash = debitBalance(ledger, "cash");
  ledger.periodCashFlow = { operating: 0, investing: 0, financing: 0 };
}

/** Verify trial balance === 0, Debit === Credit, Balance Sheet balance, and Cash Flow reconciliation. */
export function verifyLedgerInvariants(
  ledger: GraphLedger,
  accounts?: Record<string, LedgerAccount>,
): string[] {
  const errors: string[] = [];
  let sum = 0;
  for (const [acc, val] of Object.entries(ledger.balances)) {
    if (!Number.isFinite(val)) errors.push(`Non-finite balance on ${acc}: ${val}`);
    sum += val;
  }
  if (Math.abs(sum) > 1e-6) {
    errors.push(`Trial balance non-zero: ${sum}`);
  }
  if (Math.abs(ledger.cumulativeDebits - ledger.cumulativeCredits) > 1e-6) {
    errors.push(
      `Cumulative debit/credit mismatch: debits=${ledger.cumulativeDebits} vs credits=${ledger.cumulativeCredits}`,
    );
  }

  const bs = buildBalanceSheet(ledger, accounts);
  if (!bs.balanced) {
    errors.push(
      `Balance sheet mismatch: A=${bs.assets.total} vs L+E=${bs.liabilities.total + bs.equity.total}`,
    );
  }

  const cf = buildCashFlowStatement(ledger);
  if (!cf.reconciles) {
    errors.push(
      `Cash flow mismatch: begin(${cf.beginCash}) + net(${cf.netChange}) != end(${cf.endCash})`,
    );
  }

  return errors;
}
