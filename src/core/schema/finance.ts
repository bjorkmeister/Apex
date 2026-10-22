/**
 * Corporate finance: chart of accounts, double-entry ledger, sub-ledgers (AR/AP), debt, equity,
 * fixed assets, tax, and the three financial statements.
 */
import { z } from "zod";
import { Cents, Id, Ratio, Tick } from "./primitives";

export const AccountCode = z.enum([
  // Assets
  "cash",
  "accounts_receivable",
  "inventory_raw",
  "inventory_wip",
  "inventory_finished",
  "prepaid",
  "ppe_gross",
  "accumulated_depreciation",
  // Liabilities
  "accounts_payable",
  "accrued_payroll",
  "accrued_interest",
  "taxes_payable",
  "deferred_revenue",
  "revolver",
  "term_debt",
  // Equity
  "paid_in_capital",
  "retained_earnings",
  // Revenue
  "revenue_product",
  "revenue_service",
  "revenue_subscription",
  "contra_revenue_returns",
  // COGS
  "cogs_product",
  "cogs_direct_labor",
  "cogs_freight_out",
  "cogs_spoilage_shrink",
  "cogs_outsourcing",
  // OpEx
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
  // Below EBITDA
  "depreciation",
  "interest_expense",
  "other_income",
  "income_tax",
]);
export type AccountCode = z.infer<typeof AccountCode>;

export const CashFlowCategory = z.enum(["operating", "investing", "financing"]);
export type CashFlowCategory = z.infer<typeof CashFlowCategory>;

/** Signed line: positive = debit, negative = credit. */
export const JournalLine = z.object({ account: AccountCode, amount: Cents });

export const JournalEntry = z.object({
  id: z.number().int(),
  tick: Tick,
  memo: z.string(),
  source: z.string(),
  lines: z.array(JournalLine),
  cashFlow: CashFlowCategory.optional(),
});
export type JournalEntry = z.infer<typeof JournalEntry>;

export const Ledger = z.object({
  /** Debit-positive balances. Trial balance (sum) must equal exactly 0. */
  balances: z.record(z.string(), Cents),
  /** Rolling audit journal (retention configurable). */
  journal: z.array(JournalEntry),
  nextEntryId: z.number().int(),
});
export type Ledger = z.infer<typeof Ledger>;

export const Receivable = z.object({
  id: Id,
  channelId: Id,
  amount: Cents.positive(),
  dueTick: Tick,
  createdTick: Tick,
  defaultProb: Ratio,
  slipped: z.boolean(),
});
export type Receivable = z.infer<typeof Receivable>;

export const PayableKind = z.enum([
  "supplier",
  "freight",
  "landlord",
  "utilities",
  "maintenance",
  "vendor",
  "3pl",
  "insurance",
  "tax",
  "fine",
  "customer_credit",
  "other",
]);

export const Payable = z.object({
  id: Id,
  counterparty: z.string(),
  kind: PayableKind,
  /** GL control account this payable belongs to. */
  account: z.enum(["accounts_payable", "taxes_payable"]),
  amount: Cents.positive(),
  dueTick: Tick,
  createdTick: Tick,
  supplierId: Id.optional(),
  /** Lower = paid first when cash is scarce. */
  priority: z.number().int(),
});
export type Payable = z.infer<typeof Payable>;

export const Covenant = z.object({
  metric: z.enum(["min_cash", "current_ratio", "interest_coverage", "debt_to_ebitda"]),
  threshold: z.number(),
  comparator: z.enum(["gte", "lte"]),
});
export type Covenant = z.infer<typeof Covenant>;

export const DebtFacility = z.object({
  id: Id,
  kind: z.enum(["revolver", "term_loan", "equipment", "venture_debt"]),
  lender: z.string(),
  /** Revolver commitment (max principal). For term debt = original principal. */
  limit: Cents.min(0),
  principal: Cents.min(0),
  spreadBps: z.number().int(),
  monthlyAmortization: Cents.min(0),
  maturityTick: Tick,
  covenants: z.array(Covenant),
  status: z.enum(["active", "breach", "default", "repaid"]),
  consecutiveBreaches: z.number().int().min(0),
});
export type DebtFacility = z.infer<typeof DebtFacility>;

export const Equity = z.object({
  sharesOutstanding: z.number().int().positive(),
  capTable: z.array(
    z.object({ holder: z.string(), shares: z.number().int().min(0), invested: Cents.min(0), round: z.string() }),
  ),
  rounds: z.array(
    z.object({
      tick: Tick,
      name: z.string(),
      investor: z.string(),
      amount: Cents.positive(),
      preMoney: Cents.positive(),
      postMoney: Cents.positive(),
      sharesIssued: z.number().int().positive(),
      boardSeat: z.boolean(),
    }),
  ),
  boardPressure: Ratio,
});
export type Equity = z.infer<typeof Equity>;

export const FixedAsset = z.object({
  id: Id,
  name: z.string(),
  kind: z.enum(["equipment", "automation", "building_improvement", "vehicle", "software"]),
  cost: Cents.positive(),
  salvage: Cents.min(0),
  usefulLifeDays: z.number().int().positive(),
  acquiredTick: z.number().int(),
  accumulatedDepreciation: Cents.min(0),
  linked: z.object({ kind: z.enum(["work_center", "warehouse"]), id: Id }).optional(),
});
export type FixedAsset = z.infer<typeof FixedAsset>;

export const CashFlowBuckets = z.object({ operating: Cents, investing: Cents, financing: Cents });
export type CashFlowBuckets = z.infer<typeof CashFlowBuckets>;

export const IncomeStatement = z.object({
  grossRevenue: Cents,
  returnsAndAllowances: Cents,
  netRevenue: Cents,
  cogs: z.object({
    product: Cents,
    directLabor: Cents,
    freightOut: Cents,
    spoilageShrink: Cents,
    outsourcing: Cents,
    total: Cents,
  }),
  grossProfit: Cents,
  opex: z.object({
    payroll: Cents,
    marketing: Cents,
    warehousing: Cents,
    rent: Cents,
    capability: Cents,
    maintenance: Cents,
    channelFees: Cents,
    recruiting: Cents,
    fines: Cents,
    badDebt: Cents,
    other: Cents,
    total: Cents,
  }),
  ebitda: Cents,
  depreciation: Cents,
  ebit: Cents,
  interestExpense: Cents,
  otherIncome: Cents,
  ebt: Cents,
  incomeTax: Cents,
  netIncome: Cents,
});
export type IncomeStatement = z.infer<typeof IncomeStatement>;

export const BalanceSheet = z.object({
  assets: z.object({
    cash: Cents,
    accountsReceivable: Cents,
    inventoryRaw: Cents,
    inventoryWip: Cents,
    inventoryFinished: Cents,
    prepaid: Cents,
    currentAssets: Cents,
    ppeNet: Cents,
    total: Cents,
  }),
  liabilities: z.object({
    accountsPayable: Cents,
    accruedPayroll: Cents,
    accruedInterest: Cents,
    taxesPayable: Cents,
    deferredRevenue: Cents,
    revolver: Cents,
    currentLiabilities: Cents,
    termDebt: Cents,
    total: Cents,
  }),
  equity: z.object({ paidInCapital: Cents, retainedEarnings: Cents, total: Cents }),
  balanced: z.boolean(),
});
export type BalanceSheet = z.infer<typeof BalanceSheet>;

export const CashFlowStatement = z.object({
  beginCash: Cents,
  operating: Cents,
  investing: Cents,
  financing: Cents,
  netChange: Cents,
  endCash: Cents,
  reconciles: z.boolean(),
});
export type CashFlowStatement = z.infer<typeof CashFlowStatement>;

export const FinancialStatements = z.object({
  incomeStatement: IncomeStatement,
  balanceSheet: BalanceSheet,
  cashFlow: CashFlowStatement,
});
export type FinancialStatements = z.infer<typeof FinancialStatements>;

export const TaxState = z.object({ rate: Ratio, lossCarryforward: Cents.min(0) });

export const FinanceState = z.object({
  ledger: Ledger,
  receivables: z.array(Receivable),
  payables: z.array(Payable),
  debts: z.array(DebtFacility),
  equity: Equity,
  fixedAssets: z.array(FixedAsset),
  tax: TaxState,
  periodCashFlow: CashFlowBuckets,
  periodStartCash: Cents,
  missedPayrolls: z.number().int().min(0),
  overdueSinceTick: Tick.optional(),
  /** Overdue payables total at end of last tick (for telemetry). */
  overdueTotal: Cents.min(0),
  lastCovenantCheck: z
    .array(z.object({ debtId: Id, metric: z.string(), value: z.number(), threshold: z.number(), ok: z.boolean() }))
    .optional(),
  ytdNetIncome: Cents,
});
export type FinanceState = z.infer<typeof FinanceState>;
