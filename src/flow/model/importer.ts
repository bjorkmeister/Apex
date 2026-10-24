/**
 * APEX Flow — tiliotteen tuonti (`src/flow/model/importer.ts`).
 *
 * Lukee verkkopankista viedyn CSV-tiliotteen (OP, Nordea, S-Pankki, Danske, Aktia,
 * POP ym. sekä yleiset muodot) ja tunnistaa toistuvat kulut ja keskimääräisen myynnin.
 * Tiedosto käsitellään kokonaan selaimessa: tiliotteen tiedot eivät lähde koneelta.
 * Tuonti ei muuta mallia itsestään – se tuottaa ehdotukset, jotka käyttäjä hyväksyy.
 */
import type { FixedCost, FixedCostCategory, Molecule } from "../kernel/types.ts";
import type { EnterpriseGraph, EntityURI, GraphCommand } from "../graph/types.ts";
import { simulateGraph, type SimulationRun } from "../graph/simulate.ts";
import type { FlowCommand } from "./commands.ts";
import { flowCommandToGraphCommands } from "./commands.ts";
import { t } from "../i18n/index.ts";

export interface Transaction {
  date: string; // YYYY-MM-DD
  amount: number; // + tulo, − meno
  counterparty: string;
  message: string;
  balance: number | null;
}

export interface ParseResult {
  transactions: Transaction[];
  skippedRows: number;
  error: string | null;
  columns: { date: string; amount: string; counterparty: string | null; message: string | null; balance: string | null } | null;
}

function detectDelimiter(headerLine: string): string {
  const counts = [";", "\t", ","].map((d) => ({ d, n: headerLine.split(d).length }));
  counts.sort((a, b) => b.n - a.n);
  return counts[0].n > 1 ? counts[0].d : ";";
}

/** CSV-rivin jako lainausmerkit huomioiden. */
export function splitCsvLine(line: string, delim: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delim) {
      out.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

/** "−1 234,56", "1.234,56", "+12,50", "-12.5" → luku. */
export function parseAmount(raw: string): number | null {
  let s = raw.replace(/[\s\u00a0€]/g, "").replace(/^\+/, "").replace(/[−–]/g, "-");
  if (!s) return null;
  if (s.includes(",") && s.includes(".")) {
    s = s.lastIndexOf(",") > s.lastIndexOf(".") ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  } else if (s.includes(",")) {
    s = s.replace(",", ".");
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** "31.12.2025", "31.12.25", "2025-12-31", "2025/12/31" → "2025-12-31". */
export function parseDate(raw: string): string | null {
  const s = raw.trim();
  let m = /^(\d{1,2})\.(\d{1,2})\.(\d{2,4})/.exec(s);
  if (m) {
    const y = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${y}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  }
  m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/.exec(s);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  return null;
}

const findCol = (headers: string[], patterns: RegExp[], exclude: number[] = []): number => {
  for (const p of patterns) {
    const i = headers.findIndex((h, idx) => !exclude.includes(idx) && p.test(h));
    if (i >= 0) return i;
  }
  return -1;
};

export function parseStatementCsv(text: string): ParseResult {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return { transactions: [], skippedRows: 0, error: t("Tiedostossa ei ole tapahtumia."), columns: null };
  // Otsikkorivi: ensimmäinen rivi, jossa on päivämäärä- ja summasarake.
  let headerIdx = -1;
  let delim = ";";
  let headers: string[] = [];
  for (let i = 0; i < Math.min(lines.length, 15); i += 1) {
    const d = detectDelimiter(lines[i]);
    const h = splitCsvLine(lines[i], d).map((x) => x.toLowerCase());
    if (h.some((x) => /päiv|date|pvm/.test(x)) && h.some((x) => /määrä|summa|amount|euro|eur\b|belopp/.test(x))) {
      headerIdx = i;
      delim = d;
      headers = h;
      break;
    }
  }
  if (headerIdx < 0) {
    return { transactions: [], skippedRows: lines.length, error: t("Tiliotteen sarakkeita ei tunnistettu. Tarvitaan ainakin päivämäärä- ja summasarake."), columns: null };
  }
  const dateCol = findCol(headers, [/kirjausp/, /arvop/, /maksup/, /päiv|date|pvm/]);
  const amountCol = findCol(headers, [/määrä/, /summa/, /amount/, /belopp/, /euro|eur\b/]);
  const balanceCol = findCol(headers, [/saldo|balance/], [amountCol]);
  const cpCol = findCol(headers, [/saaja\/maksaja|maksaja\/saaja/, /saajan nimi|maksajan nimi/, /^nimi$|name|vastapuoli/, /saaja|maksaja|payee|recipient/, /selitys|otsikko|description/], [dateCol, amountCol]);
  const msgCol = findCol(headers, [/viesti|message/, /selitys|otsikko|description/], [dateCol, amountCol, cpCol]);
  const transactions: Transaction[] = [];
  let skipped = 0;
  for (const line of lines.slice(headerIdx + 1)) {
    const cells = splitCsvLine(line, delim);
    const date = dateCol >= 0 ? parseDate(cells[dateCol] ?? "") : null;
    const amount = amountCol >= 0 ? parseAmount(cells[amountCol] ?? "") : null;
    if (!date || amount === null) {
      skipped += 1;
      continue;
    }
    transactions.push({
      date,
      amount,
      counterparty: (cpCol >= 0 ? cells[cpCol] : "") || (msgCol >= 0 ? cells[msgCol] : "") || t("Tuntematon"),
      message: msgCol >= 0 ? cells[msgCol] ?? "" : "",
      balance: balanceCol >= 0 ? parseAmount(cells[balanceCol] ?? "") : null,
    });
  }
  transactions.sort((a, b) => a.date.localeCompare(b.date));
  return {
    transactions,
    skippedRows: skipped,
    error: transactions.length === 0 ? t("Tapahtumia ei voitu lukea.") : null,
    columns: {
      date: headers[dateCol],
      amount: headers[amountCol],
      counterparty: cpCol >= 0 ? headers[cpCol] : null,
      message: msgCol >= 0 ? headers[msgCol] : null,
      balance: balanceCol >= 0 ? headers[balanceCol] : null,
    },
  };
}

const CATEGORY_RULES: { re: RegExp; category: FixedCostCategory; label?: string }[] = [
  { re: /vuokra|rent|kiinteistö|toimitila|coworking|workspace/, category: "rent" },
  { re: /ilmarinen|varma|elo\b|veritas|yel|eläke/, category: "pension", label: "YEL" },
  { re: /vakuutus|if vahinko|if p&c|lähitapiola|pohjola vakuutus|fennia|turva|insurance/, category: "insurance" },
  { re: /tilitoimisto|kirjanpito|accountor|procountor|netvisor|holvi|tilipalvelu/, category: "admin" },
  { re: /google ads|facebook|meta platforms|linkedin|mainos|markkinointi|instagram|tiktok/, category: "marketing" },
  { re: /adobe|google|microsoft|slack|zoom|github|atlassian|aws|amazon web|azure|hetzner|digitalocean|elisa|telia|dna|apple\.com|dropbox|notion|figma|openai|anthropic|wix|shopify|zoner|domain/, category: "software" },
];

/** Tapahtumat, joita ei tulkita liiketoiminnan kiinteiksi kuluiksi. */
const NON_OPERATING = /verohallinto|ennakkovero|oma tili|omalle tilille|oma siirto|käteisnosto|automaattinosto|\botto\b|lainan lyhennys|luottokortin/;

export interface RecurringCost {
  key: string;
  label: string;
  monthlyAmount: number;
  dayOfMonth: number;
  occurrences: number;
  months: number;
  category: FixedCostCategory;
}

export interface MonthlyActual {
  /** Kalenterikuukausi muodossa YYYY-MM. */
  month: string;
  income: number;
  /** Liiketoiminnan menot (ilman veroja, omia siirtoja ja nostoja). */
  expenses: number;
  nonOperating: number;
  endBalance: number | null;
}

export interface StatementAnalysis {
  from: string;
  to: string;
  monthsCovered: number;
  transactionCount: number;
  incomeTotal: number;
  avgMonthlyIncome: number;
  distinctPayers: number;
  expenseTotal: number;
  recurring: RecurringCost[];
  oneOffTotal: number;
  nonOperatingTotal: number;
  lastBalance: number | null;
  monthly: MonthlyActual[];
}

const normKey = (s: string) =>
  s.toLowerCase().replace(/[0-9#*/\\.,:;()\-_]+/g, " ").replace(/\b(oy|oyj|ab|ltd|inc|ky|tmi|finland|suomi)\b/g, "").replace(/\s+/g, " ").trim();

function titleCase(s: string): string {
  const t = s.trim().replace(/\s+/g, " ");
  return t.length ? t.charAt(0).toUpperCase() + t.slice(1, 60) : "–";
}

export function analyzeStatement(tx: Transaction[]): StatementAnalysis {
  const months = [...new Set(tx.map((t) => t.date.slice(0, 7)))].sort();
  const span = Math.max(1, months.length);
  const income = tx.filter((t) => t.amount > 0 && !NON_OPERATING.test(`${t.counterparty} ${t.message}`.toLowerCase()));
  const expenses = tx.filter((t) => t.amount < 0);
  const groups = new Map<string, Transaction[]>();
  let nonOperating = 0;
  for (const t of expenses) {
    const text = `${t.counterparty} ${t.message}`.toLowerCase();
    if (NON_OPERATING.test(text)) {
      nonOperating += -t.amount;
      continue;
    }
    const key = normKey(t.counterparty) || normKey(t.message) || "tuntematon";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(t);
  }
  const recurring: RecurringCost[] = [];
  let oneOff = 0;
  for (const [key, list] of groups) {
    const inMonths = new Set(list.map((t) => t.date.slice(0, 7))).size;
    const total = list.reduce((s, t) => s - t.amount, 0);
    const isRecurring = span === 1 ? list.length >= 1 && /vuokra|vakuutus|kirjanpito|ilmarinen|varma|elo|adobe|microsoft|google|telia|elisa|dna/.test(key) : inMonths >= Math.min(2, span) && inMonths >= span * 0.5;
    if (!isRecurring) {
      oneOff += total;
      continue;
    }
    const days = list.map((t) => Number(t.date.slice(8, 10))).sort((a, b) => a - b);
    const text = `${key} ${list[0].message}`.toLowerCase();
    const rule = CATEGORY_RULES.find((r) => r.re.test(text));
    recurring.push({
      key,
      label: rule?.label === "YEL" ? t("YEL-vakuutus") : titleCase(list[0].counterparty || list[0].message),
      monthlyAmount: total / span,
      dayOfMonth: Math.min(30, days[Math.floor(days.length / 2)] || 1),
      occurrences: list.length,
      months: inMonths,
      category: rule?.category ?? "other",
    });
  }
  recurring.sort((a, b) => b.monthlyAmount - a.monthlyAmount);
  const withBalance = tx.filter((t) => t.balance !== null);
  const monthly: MonthlyActual[] = months.map((mo) => {
    const inMonth = tx.filter((x) => x.date.startsWith(mo));
    let income = 0;
    let expenses = 0;
    let nonOp = 0;
    for (const x of inMonth) {
      const nonOperating = NON_OPERATING.test(`${x.counterparty} ${x.message}`.toLowerCase());
      if (nonOperating) nonOp += Math.abs(x.amount);
      else if (x.amount > 0) income += x.amount;
      else expenses += -x.amount;
    }
    const withBal = inMonth.filter((x) => x.balance !== null);
    return { month: mo, income, expenses, nonOperating: nonOp, endBalance: withBal.length ? withBal[withBal.length - 1].balance : null };
  });
  return {
    from: tx[0]?.date ?? "",
    to: tx[tx.length - 1]?.date ?? "",
    monthsCovered: span,
    transactionCount: tx.length,
    incomeTotal: income.reduce((s, t) => s + t.amount, 0),
    avgMonthlyIncome: income.reduce((s, t) => s + t.amount, 0) / span,
    distinctPayers: new Set(income.map((t) => normKey(t.counterparty))).size,
    expenseTotal: expenses.reduce((s, t) => s - t.amount, 0),
    recurring,
    oneOffTotal: oneOff,
    nonOperatingTotal: nonOperating,
    lastBalance: withBalance.length ? withBalance[withBalance.length - 1].balance : null,
    monthly,
  };
}

/**
 * Onko mallissa jo samankaltainen kiinteä kulu (sama luokka tai nimi ja summa ±25 %)?
 * Näin tiliotteen kulua ei lisätä kahteen kertaan esimerkkipohjan oletuskulun päälle.
 */
export function similarExistingCost(m: Molecule, r: RecurringCost): FixedCost | null {
  const key = r.key.split(" ")[0] ?? "";
  for (const c of m.fixedCosts) {
    const close = Math.abs(c.amountPerMonth - r.monthlyAmount) <= Math.max(10, r.monthlyAmount * 0.25);
    const sameName = key.length >= 4 && c.label.toLowerCase().includes(key);
    const sameCategory = c.category === r.category && r.category !== "other";
    if (sameName || (sameCategory && close)) return c;
  }
  return null;
}

/** Oletusvalinta: kaikki toistuvat kulut paitsi ne, joille mallissa on jo vastine. */
export function defaultSelection(m: Molecule, a: StatementAnalysis): ImportSelection {
  return {
    costKeys: a.recurring.filter((r) => !similarExistingCost(m, r)).map((r) => r.key),
    calibrateRevenue: false,
    useBalance: a.lastBalance !== null && a.lastBalance >= 0,
    saveActuals: a.monthly.length > 0,
  };
}

export interface ImportSelection {
  /** Toistuvien kulujen avaimet, jotka lisätään kiinteiksi kuluiksi. */
  costKeys: string[];
  /** Kalibroidaanko suurimman tulovirran määrä vastaamaan tiliotteen keskimyyntiä. */
  calibrateRevenue: boolean;
  /** Asetetaanko alkukassaksi tiliotteen viimeinen saldo. */
  useBalance: boolean;
  /** Tallennetaanko kuukausitoteumat vertailua varten. */
  saveActuals: boolean;
}

/** Kalibroinnin kohde: kenttä ja arvo, jolla mallin myynti vastaa tiliotteen keskimyyntiä. */
export function revenueCalibration(m: Molecule, targetMonthly: number): { atomId: string; field: string; value: number; label: string } | null {
  const atoms = m.atoms.filter((a) => a.enabled);
  if (atoms.length !== 1 || targetMonthly <= 0) return null;
  const a = atoms[0];
  switch (a.kind) {
    case "TIME_CAPACITY":
      return a.hourlyRate > 0 ? { atomId: a.id, field: "demandHoursPerMonth", value: Math.round(targetMonthly / a.hourlyRate), label: t("myyty kysyntä (h / kk)") } : null;
    case "PHYSICAL_MATTER":
      return a.unitPrice > 0 ? { atomId: a.id, field: "unitsPerMonth", value: Math.round(targetMonthly / a.unitPrice), label: t("myynti kpl / kk") } : null;
    case "RECURRING_SUB":
      return a.pricePerMonth > 0 ? { atomId: a.id, field: "startingSubscribers", value: Math.round(targetMonthly / a.pricePerMonth), label: t("asiakkaat alussa") } : null;
    case "TRANSACTIONAL_TRADE": {
      const perVisitor = a.conversionRate * a.averageTicket * a.openDaysPerMonth;
      return perVisitor > 0 ? { atomId: a.id, field: "visitorsPerDay", value: Math.round(targetMonthly / perVisitor), label: t("ohikulkijat / pv") } : null;
    }
  }
}

/** Muuntaa hyväksytyt ehdotukset tavallisiksi, validoitaviksi komennoiksi (kumottavissa). */
export function importCommands(m: Molecule, a: StatementAnalysis, sel: ImportSelection): FlowCommand[] {
  const cmds: FlowCommand[] = [];
  for (const r of a.recurring) {
    if (!sel.costKeys.includes(r.key)) continue;
    cmds.push({ type: "add_fixed_cost", label: r.label, amountPerMonth: Math.round(r.monthlyAmount * 100) / 100, dayOfMonth: r.dayOfMonth, category: r.category });
  }
  if (sel.calibrateRevenue) {
    const c = revenueCalibration(m, a.avgMonthlyIncome);
    if (c) cmds.push({ type: "set_atom_field", atomId: c.atomId, field: c.field, value: c.value });
  }
  if (sel.useBalance && a.lastBalance !== null && a.lastBalance >= 0) {
    cmds.push({ type: "set_credit", field: "openingCash", value: Math.round(a.lastBalance) });
  }
  return cmds;
}

// ---------------------------------------------------------------------------
// EnterpriseGraph-tason tiliotekohdistus ja toteuma vs. suunnitelma (TSD 7.3 & 9.1)
// ---------------------------------------------------------------------------

export interface GraphLedgerLineMapping {
  key: string;
  label: string;
  monthlyAmount: number;
  category: FixedCostCategory;
  debitAccountUri: EntityURI;
  creditAccountUri: EntityURI;
  nodeUri: EntityURI | null;
}

export interface GraphStatementMapping {
  lines: GraphLedgerLineMapping[];
  incomeMapping: {
    avgMonthlyIncome: number;
    debitAccountUri: EntityURI;
    creditAccountUri: EntityURI;
    nodeUri: EntityURI | null;
  };
  commands: GraphCommand[];
}

export interface GraphAccountVariance {
  accountUri: EntityURI;
  accountLabel: string;
  plannedMonthly: number;
  actualMonthly: number;
  variance: number;
  varianceRatio: number | null;
}

export interface GraphNodeVariance {
  nodeUri: EntityURI;
  nodeLabel: string;
  plannedMonthlyRevenue: number;
  actualAllocatedRevenue: number;
  revenueVariance: number;
  plannedMonthlyCost: number;
  actualAllocatedCost: number;
  costVariance: number;
}

export interface GraphMonthlyActualComparison {
  month: string;
  actualIncome: number;
  plannedRevenue: number;
  revenueVariance: number;
  actualExpenses: number;
  plannedExpenses: number;
  expenseVariance: number;
  actualEndBalance: number | null;
  plannedEndCash: number;
}

export interface GraphActualsComparison {
  months: GraphMonthlyActualComparison[];
  accountVariances: GraphAccountVariance[];
  nodeVariances: GraphNodeVariance[];
}

/** Kohdistaa tiliotteen toistuvat kulut ja myynnin EnterpriseGraph-pääkirjatilille (LedgerAccount) ja solmuihin. */
export function mapStatementToGraphLedger(
  graph: EnterpriseGraph,
  analysis: StatementAnalysis,
  sel?: ImportSelection,
): GraphStatementMapping {
  const allNodes = Object.values(graph.nodes);
  const leafNodes = allNodes.filter((n) => n.children.length === 0 && (n.definition ?? "defined") === "defined");
  const primaryRevenueNode =
    leafNodes.find((n) => n.band === "value_stream") ??
    leafNodes[0] ??
    allNodes[0] ??
    null;
  const governanceNode =
    allNodes.find((n) => n.band === "enabling" || n.band === "governance") ??
    primaryRevenueNode;

  const selectedKeys = sel ? new Set(sel.costKeys) : new Set(analysis.recurring.map((r) => r.key));
  const lines: GraphLedgerLineMapping[] = [];
  const commands: GraphCommand[] = [];

  for (const r of analysis.recurring) {
    if (!selectedKeys.has(r.key)) continue;
    const debitAccountUri: EntityURI =
      r.category === "pension" ? "apex://account/payroll_expense" : "apex://account/opex_fixed";
    const creditAccountUri: EntityURI = "apex://account/cash";
    const matchedNode =
      allNodes.find((n) => n.name.toLowerCase().includes(r.key.split(" ")[0] ?? "")) ??
      (r.category === "marketing"
        ? allNodes.find((n) => n.band === "value_stream") ?? governanceNode
        : governanceNode);
    const nodeUri = matchedNode?.uri ?? null;
    lines.push({
      key: r.key,
      label: r.label,
      monthlyAmount: r.monthlyAmount,
      category: r.category,
      debitAccountUri,
      creditAccountUri,
      nodeUri,
    });
    if (nodeUri) {
      commands.push({
        type: "bind_ledger",
        node: nodeUri,
        binding: {
          event: "per_tick",
          debit: debitAccountUri,
          credit: creditAccountUri,
          amount: { const: Math.round((r.monthlyAmount / 30) * 100) / 100 },
        },
      });
    }
    commands.push(
      ...flowCommandToGraphCommands(
        {
          type: "add_fixed_cost",
          label: r.label,
          amountPerMonth: Math.round(r.monthlyAmount * 100) / 100,
          dayOfMonth: r.dayOfMonth,
          category: r.category,
        },
        graph,
        { source: "import", note: r.label },
      ),
    );
  }

  if ((sel?.useBalance ?? true) && analysis.lastBalance !== null && analysis.lastBalance >= 0) {
    commands.push(
      ...flowCommandToGraphCommands(
        { type: "set_credit", field: "openingCash", value: Math.round(analysis.lastBalance) },
        graph,
        { source: "import", note: "Tiliotteen loppusaldo" },
      ),
    );
  }

  return {
    lines,
    incomeMapping: {
      avgMonthlyIncome: analysis.avgMonthlyIncome,
      debitAccountUri: "apex://account/cash",
      creditAccountUri: "apex://account/revenue",
      nodeUri: primaryRevenueNode?.uri ?? null,
    },
    commands,
  };
}

/** Vertaa tiliotteen kuukausitoteumia EnterpriseGraph-simulaation suunnitelmaan kuukausi-, tili- ja solmutasolla. */
export function compareGraphActualsToPlan(
  graph: EnterpriseGraph,
  actuals: MonthlyActual[],
  existingRun?: SimulationRun,
): GraphActualsComparison {
  const run = existingRun ?? simulateGraph(graph);
  const simMonths = run.months ?? [];
  const span = Math.max(1, actuals.length);

  const months: GraphMonthlyActualComparison[] = actuals.map((act, idx) => {
    const plannedMo = simMonths[idx % Math.max(1, simMonths.length)];
    const plannedRevenue = plannedMo ? plannedMo.revenue : run.totals.revenue / 12;
    const plannedExpenses = plannedMo
      ? plannedMo.variableCosts + plannedMo.fixedCosts
      : (run.totals.variableCosts + run.totals.fixedCosts) / 12;
    const plannedEndCash = plannedMo ? plannedMo.endCash : run.endCash;
    return {
      month: act.month,
      actualIncome: act.income,
      plannedRevenue,
      revenueVariance: act.income - plannedRevenue,
      actualExpenses: act.expenses,
      plannedExpenses,
      expenseVariance: act.expenses - plannedExpenses,
      actualEndBalance: act.endBalance,
      plannedEndCash,
    };
  });

  const avgActualIncome = actuals.reduce((s, a) => s + a.income, 0) / span;
  const avgActualExpenses = actuals.reduce((s, a) => s + a.expenses, 0) / span;
  const lastActualBalance =
    [...actuals].reverse().find((a) => a.endBalance !== null)?.endBalance ?? run.endCash;

  const plannedMonthlyRevenue = run.totals.revenue / 12;
  const plannedMonthlyExpenses = (run.totals.variableCosts + run.totals.fixedCosts) / 12;
  const plannedEndCash = months[months.length - 1]?.plannedEndCash ?? run.endCash;

  const accountLabelOf = (uri: EntityURI, fallback: string) =>
    graph.accounts[uri]?.name ?? graph.accounts[uri.replace(/^apex:\/\/account\//, "")]?.name ?? fallback;

  const accountVariances: GraphAccountVariance[] = [
    {
      accountUri: "apex://account/revenue",
      accountLabel: accountLabelOf("apex://account/revenue", "Myyntituotot"),
      plannedMonthly: plannedMonthlyRevenue,
      actualMonthly: avgActualIncome,
      variance: avgActualIncome - plannedMonthlyRevenue,
      varianceRatio: plannedMonthlyRevenue > 0 ? (avgActualIncome - plannedMonthlyRevenue) / plannedMonthlyRevenue : null,
    },
    {
      accountUri: "apex://account/opex_fixed",
      accountLabel: accountLabelOf("apex://account/opex_fixed", "Liiketoiminnan kulut"),
      plannedMonthly: plannedMonthlyExpenses,
      actualMonthly: avgActualExpenses,
      variance: avgActualExpenses - plannedMonthlyExpenses,
      varianceRatio: plannedMonthlyExpenses > 0 ? (avgActualExpenses - plannedMonthlyExpenses) / plannedMonthlyExpenses : null,
    },
    {
      accountUri: "apex://account/cash",
      accountLabel: accountLabelOf("apex://account/cash", "Rahavarat"),
      plannedMonthly: plannedEndCash,
      actualMonthly: lastActualBalance,
      variance: lastActualBalance - plannedEndCash,
      varianceRatio: plannedEndCash !== 0 ? (lastActualBalance - plannedEndCash) / Math.abs(plannedEndCash) : null,
    },
  ];

  // Solmutason kohdistus simuloinnin nodeStates-tilan painotuksella
  const definedLeaves = Object.values(graph.nodes).filter(
    (n) => n.children.length === 0 && (n.definition ?? "defined") === "defined" && n.uri !== graph.root,
  );
  const nodePlanStats = definedLeaves.map((n) => {
    const st = run.nodeStates[n.uri];
    const revPerTick = st ? st.revenue : 0;
    const costPerTick = st ? st.variableCost + st.fixedCost : 0;
    return {
      nodeUri: n.uri,
      nodeLabel: n.name,
      plannedMonthlyRevenue: revPerTick * 30,
      plannedMonthlyCost: costPerTick * 30,
    };
  });

  const totalNodePlannedRev = nodePlanStats.reduce((s, x) => s + x.plannedMonthlyRevenue, 0);
  const totalNodePlannedCost = nodePlanStats.reduce((s, x) => s + x.plannedMonthlyCost, 0);

  const nodeVariances: GraphNodeVariance[] = nodePlanStats.map((np) => {
    const revShare = totalNodePlannedRev > 0 ? np.plannedMonthlyRevenue / totalNodePlannedRev : 1 / Math.max(1, nodePlanStats.length);
    const costShare = totalNodePlannedCost > 0 ? np.plannedMonthlyCost / totalNodePlannedCost : 1 / Math.max(1, nodePlanStats.length);
    const actualAllocatedRevenue = avgActualIncome * revShare;
    const actualAllocatedCost = avgActualExpenses * costShare;
    return {
      nodeUri: np.nodeUri,
      nodeLabel: np.nodeLabel,
      plannedMonthlyRevenue: np.plannedMonthlyRevenue,
      actualAllocatedRevenue,
      revenueVariance: actualAllocatedRevenue - np.plannedMonthlyRevenue,
      plannedMonthlyCost: np.plannedMonthlyCost,
      actualAllocatedCost,
      costVariance: actualAllocatedCost - np.plannedMonthlyCost,
    };
  });

  return {
    months,
    accountVariances,
    nodeVariances,
  };
}
