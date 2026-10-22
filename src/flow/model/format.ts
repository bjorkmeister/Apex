/**
 * APEX Flow — suomenkieliset muotoilut (`src/flow/model/format.ts`).
 */
const eurFmt = new Intl.NumberFormat("fi-FI", { maximumFractionDigits: 0 });
const numFmt1 = new Intl.NumberFormat("fi-FI", { maximumFractionDigits: 1 });
const numFmt2 = new Intl.NumberFormat("fi-FI", { maximumFractionDigits: 2 });

/** "12 345 €". Pienet summat (< 100 €) näytetään sentin tarkkuudella, jos niissä on desimaaleja. */
export function eur(n: number): string {
  if (!Number.isFinite(n)) return "–";
  const abs = Math.abs(n);
  if (abs > 0 && abs < 100 && Math.round(n) !== n) return `${numFmt2.format(n)} €`;
  return `${eurFmt.format(Math.round(n))} €`;
}

/** Saldot ja summat: aina täysinä euroina ("−76 €", ei "−75,92 €"). */
export function money(n: number): string {
  if (!Number.isFinite(n)) return "–";
  const r = Math.round(n);
  return `${eurFmt.format(r === 0 ? 0 : r)} €`;
}

export function signedEur(n: number): string {
  if (!Number.isFinite(n)) return "–";
  return `${n > 0 ? "+" : ""}${money(n)}`;
}

export function pct(ratio: number, digits = 0): string {
  if (!Number.isFinite(ratio)) return "–";
  const f = new Intl.NumberFormat("fi-FI", { maximumFractionDigits: digits, minimumFractionDigits: 0 });
  return `${f.format(ratio * 100)} %`;
}

export function num(n: number, digits = 1): string {
  if (!Number.isFinite(n)) return "–";
  return digits <= 1 ? numFmt1.format(n) : numFmt2.format(n);
}

export function int(n: number): string {
  if (!Number.isFinite(n)) return "–";
  return eurFmt.format(Math.round(n));
}

/** Päivänumero (0-pohjainen) → "kk 2, pv 15". */
export function dayLabel(day: number): string {
  const m = Math.floor(day / 30) + 1;
  const d = (day % 30) + 1;
  return `kk ${m}, pv ${d}`;
}

/** HTML-erikoismerkkien suojaus käyttäjän syöttämille teksteille. */
export function esc(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
