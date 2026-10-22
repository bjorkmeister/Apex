/**
 * APEX Flow — tiliotteen tuonti (`src/flow/model/importer.ts`).
 *
 * Lukee verkkopankista viedyn CSV-tiliotteen (OP, Nordea, S-Pankki, Danske, Aktia,
 * POP ym. sekä yleiset muodot) ja tunnistaa toistuvat kulut ja keskimääräisen myynnin.
 * Tiedosto käsitellään kokonaan selaimessa: tiliotteen tiedot eivät lähde koneelta.
 * Tuonti ei muuta mallia itsestään – se tuottaa ehdotukset, jotka käyttäjä hyväksyy.
 */
import type { FixedCost, FixedCostCategory, Molecule } from "../kernel/types.ts";
import type { FlowCommand } from "./commands.ts";

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
  if (lines.length < 2) return { transactions: [], skippedRows: 0, error: "Tiedostossa ei ole tapahtumia.", columns: null };
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
    return { transactions: [], skippedRows: lines.length, error: "Tiliotteen sarakkeita ei tunnistettu. Tarvitaan ainakin päivämäärä- ja summasarake.", columns: null };
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
      counterparty: (cpCol >= 0 ? cells[cpCol] : "") || (msgCol >= 0 ? cells[msgCol] : "") || "Tuntematon",
      message: msgCol >= 0 ? cells[msgCol] ?? "" : "",
      balance: balanceCol >= 0 ? parseAmount(cells[balanceCol] ?? "") : null,
    });
  }
  transactions.sort((a, b) => a.date.localeCompare(b.date));
  return {
    transactions,
    skippedRows: skipped,
    error: transactions.length === 0 ? "Tapahtumia ei voitu lukea." : null,
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
  { re: /ilmarinen|varma|elo\b|veritas|yel|eläke/, category: "pension", label: "YEL-vakuutus" },
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
}

const normKey = (s: string) =>
  s.toLowerCase().replace(/[0-9#*/\\.,:;()\-_]+/g, " ").replace(/\b(oy|oyj|ab|ltd|inc|ky|tmi|finland|suomi)\b/g, "").replace(/\s+/g, " ").trim();

function titleCase(s: string): string {
  const t = s.trim().replace(/\s+/g, " ");
  return t.length ? t.charAt(0).toUpperCase() + t.slice(1, 60) : "Kulu";
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
      label: rule?.label ?? titleCase(list[0].counterparty || list[0].message),
      monthlyAmount: total / span,
      dayOfMonth: Math.min(30, days[Math.floor(days.length / 2)] || 1),
      occurrences: list.length,
      months: inMonths,
      category: rule?.category ?? "other",
    });
  }
  recurring.sort((a, b) => b.monthlyAmount - a.monthlyAmount);
  const withBalance = tx.filter((t) => t.balance !== null);
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
  };
}

export interface ImportSelection {
  /** Toistuvien kulujen avaimet, jotka lisätään kiinteiksi kuluiksi. */
  costKeys: string[];
  /** Kalibroidaanko suurimman tulovirran määrä vastaamaan tiliotteen keskimyyntiä. */
  calibrateRevenue: boolean;
  /** Asetetaanko alkukassaksi tiliotteen viimeinen saldo. */
  useBalance: boolean;
}

/** Kalibroinnin kohde: kenttä ja arvo, jolla mallin myynti vastaa tiliotteen keskimyyntiä. */
export function revenueCalibration(m: Molecule, targetMonthly: number): { atomId: string; field: string; value: number; label: string } | null {
  const atoms = m.atoms.filter((a) => a.enabled);
  if (atoms.length !== 1 || targetMonthly <= 0) return null;
  const a = atoms[0];
  switch (a.kind) {
    case "TIME_CAPACITY":
      return a.hourlyRate > 0 ? { atomId: a.id, field: "demandHoursPerMonth", value: Math.round(targetMonthly / a.hourlyRate), label: "myyty kysyntä (h / kk)" } : null;
    case "PHYSICAL_MATTER":
      return a.unitPrice > 0 ? { atomId: a.id, field: "unitsPerMonth", value: Math.round(targetMonthly / a.unitPrice), label: "myynti kpl / kk" } : null;
    case "RECURRING_SUB":
      return a.pricePerMonth > 0 ? { atomId: a.id, field: "startingSubscribers", value: Math.round(targetMonthly / a.pricePerMonth), label: "asiakkaat alussa" } : null;
    case "TRANSACTIONAL_TRADE": {
      const perVisitor = a.conversionRate * a.averageTicket * a.openDaysPerMonth;
      return perVisitor > 0 ? { atomId: a.id, field: "visitorsPerDay", value: Math.round(targetMonthly / perVisitor), label: "ohikulkijat / pv" } : null;
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
