/**
 * APEX Studio — kielen mukaiset muotoilut (`src/flow/model/format.ts`).
 * Suomi: "1 234 €", "12 %". Englanti: "€1,234", "12%".
 */
import { getLocale, intlLocale, t } from "../i18n/index.ts";

const cache = new Map<string, Intl.NumberFormat>();
function nf(maxFrac: number, minFrac = 0): Intl.NumberFormat {
  const key = `${intlLocale()}|${maxFrac}|${minFrac}`;
  let f = cache.get(key);
  if (!f) {
    f = new Intl.NumberFormat(intlLocale(), { maximumFractionDigits: maxFrac, minimumFractionDigits: minFrac });
    cache.set(key, f);
  }
  return f;
}

function withCurrency(abs: string, negative: boolean): string {
  const sign = negative ? "−" : "";
  return getLocale() === "en" ? `${sign}€${abs}` : `${sign}${abs} €`;
}

/** Hinnat: alle 100 € summat sentin tarkkuudella, jos niissä on desimaaleja. */
export function eur(n: number): string {
  if (!Number.isFinite(n)) return "–";
  const abs = Math.abs(n);
  if (abs > 0 && abs < 100 && Math.round(n) !== n) return withCurrency(nf(2).format(abs), n < 0);
  return withCurrency(nf(0).format(Math.round(abs)), Math.round(n) < 0);
}

/** Saldot ja summat: aina täysinä euroina. */
export function money(n: number): string {
  if (!Number.isFinite(n)) return "–";
  const r = Math.round(n);
  return withCurrency(nf(0).format(Math.abs(r)), r < 0);
}

export function signedEur(n: number): string {
  if (!Number.isFinite(n)) return "–";
  return `${Math.round(n) > 0 ? "+" : ""}${money(n)}`;
}

export function pct(ratio: number, digits = 0): string {
  if (!Number.isFinite(ratio)) return "–";
  const v = nf(digits).format(ratio * 100);
  return getLocale() === "en" ? `${v}%` : `${v} %`;
}

export function num(n: number, digits = 1): string {
  if (!Number.isFinite(n)) return "–";
  return nf(Math.max(0, digits)).format(n);
}

export function int(n: number): string {
  if (!Number.isFinite(n)) return "–";
  return nf(0).format(Math.round(n));
}

/** Päivänumero (0-pohjainen) → "kk 2, pv 15". */
export function dayLabel(day: number): string {
  return t("kk {m}, pv {d}", { m: Math.floor(day / 30) + 1, d: (day % 30) + 1 });
}

/** Kalenterikuukauden lyhyt nimi (0 = tammikuu). */
export function monthName(m: number): string {
  const fi = ["tammi", "helmi", "maalis", "huhti", "touko", "kesä", "heinä", "elo", "syys", "loka", "marras", "joulu"];
  const en = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const i = ((Math.round(m) % 12) + 12) % 12;
  return getLocale() === "en" ? en[i] : fi[i];
}

/** Kuukauden koko nimi: "toukokuu" / "May". */
export function monthFull(m: number): string {
  const en = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const i = ((Math.round(m) % 12) + 12) % 12;
  return getLocale() === "en" ? en[i] : `${monthName(i)}kuu`;
}

/** "toukokuun lopussa" / "at the end of May". */
export function monthEnd(m: number): string {
  const i = ((Math.round(m) % 12) + 12) % 12;
  return getLocale() === "en" ? `at the end of ${monthFull(i)}` : `${monthName(i)}kuun lopussa`;
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
