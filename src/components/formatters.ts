/**
 * Formatting helpers for the APEX War Room UI.
 */
import type { Cents } from "../core/schema";

export function fmtCurrency(cents: Cents, compact = false, symbol = "€"): string {
  const units = cents / 100;
  const sign = units < 0 ? "-" : "";
  const abs = Math.abs(units);
  if (compact) {
    if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(1)}M ${symbol}`;
    if (abs >= 10_000) return `${sign}${(abs / 1_000).toFixed(0)}k ${symbol}`;
  }
  if (symbol === "$") {
    return `${sign}$${abs.toLocaleString("en-US", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    })}`;
  }
  return `${sign}${abs.toLocaleString("fi-FI", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })} ${symbol}`;
}

export function fmtCurrencyPrecise(cents: Cents, symbol = "€"): string {
  const units = cents / 100;
  const sign = units < 0 ? "-" : "";
  const abs = Math.abs(units);
  if (symbol === "$") {
    return `${sign}$${abs.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  }
  return `${sign}${abs.toLocaleString("fi-FI", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} ${symbol}`;
}

export function fmtPct(ratio: number, digits = 1): string {
  return `${(ratio * 100).toFixed(digits)}%`;
}

export function fmtNum(n: number, digits = 0): string {
  return n.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function escapeHtml(raw: string | undefined | null): string {
  return String(raw ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function statusColorClass(ratio: number, invert = false): string {
  const val = invert ? 1 - ratio : ratio;
  if (val >= 0.88) return "status-crit";
  if (val >= 0.72) return "status-warn";
  return "status-ok";
}
