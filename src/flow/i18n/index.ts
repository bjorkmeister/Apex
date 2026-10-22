/**
 * APEX Studio — kielituki (`src/flow/i18n/index.ts`).
 *
 * Periaate: "kirjoita kerran". Lähdekieli on suomi, ja suomenkielinen teksti on
 * itsessään käännösavain: `t("Kassa loppuu päivänä {day}", { day })`.
 * Englanti haetaan tiedostosta `en.ts`. Jos käännös puuttuu, näytetään suomi
 * (sovellus ei koskaan kaadu puuttuvaan käännökseen).
 *
 * - `t(teksti, arvot)` kääntää ja täyttää {paikkamerkit}.
 * - `msg(teksti)` merkitsee tekstin käännettäväksi ilman kääntämistä (taulukot,
 *   joiden tekstit käännetään vasta näytettäessä `t(arvo)`-kutsulla).
 * - `npm run i18n` listaa puuttuvat ja vanhentuneet käännökset ja kääntää ne
 *   kielimallilla sanaston avulla (scripts/i18n.ts).
 */
import { EN } from "./en.ts";

export type Locale = "fi" | "en";
export const LOCALES: Locale[] = ["fi", "en"];

let current: Locale = "fi";

export function isLocale(x: unknown): x is Locale {
  return x === "fi" || x === "en";
}

export function setLocale(l: Locale): void {
  current = l;
}

export function getLocale(): Locale {
  return current;
}

/** Ajaa funktion annetulla kielellä (palvelin: yksi pyyntö kerrallaan). */
export function withLocale<T>(l: Locale, fn: () => T): T {
  const prev = current;
  current = l;
  try {
    return fn();
  } finally {
    current = prev;
  }
}

/** Merkitsee tekstin käännettäväksi. Palauttaa tekstin sellaisenaan. */
export function msg(s: string): string {
  return s;
}

export type Params = Record<string, string | number>;

function fill(s: string, params?: Params): string {
  if (!params) return s;
  return s.replace(/\{(\w+)\}/g, (m, k: string) => (Object.prototype.hasOwnProperty.call(params, k) ? String(params[k]) : m));
}

export function t(source: string, params?: Params): string {
  const text = current === "en" ? EN[source] ?? source : source;
  return fill(text, params);
}

/** Intl-kielitunniste lukujen muotoiluun. */
export function intlLocale(): string {
  return current === "en" ? "en-GB" : "fi-FI";
}

/** Paikkamerkit tekstistä (testit ja käännöstyökalu). */
export function placeholders(s: string): string[] {
  return [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
}
