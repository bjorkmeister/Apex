/**
 * APEX Studio — turvallinen kaavakieli (`src/flow/model/formula.ts`).
 *
 * Omien widgettien kaavat lasketaan tällä pienellä tulkilla. Se tuntee vain luvut,
 * nimetyt muuttujat, peruslaskutoimitukset, vertailut ja muutaman funktion.
 * Mitään ohjelmakoodia ei suoriteta, joten kielimallin kirjoittama kaava ei voi
 * päästä käsiksi käyttäjän tietoihin.
 *
 * Esimerkki: `(time.hourlyRate - time.variableCostPerHour) * time.utilization`
 */
import { t } from "../i18n/index.ts";

export type Node =
  | { k: "num"; v: number }
  | { k: "var"; name: string }
  | { k: "un"; op: "-" | "!"; a: Node }
  | { k: "bin"; op: string; a: Node; b: Node }
  | { k: "call"; fn: string; args: Node[] };

export const FUNCTIONS: Record<string, { min: number; max: number }> = {
  min: { min: 1, max: 12 },
  max: { min: 1, max: 12 },
  abs: { min: 1, max: 1 },
  round: { min: 1, max: 2 },
  floor: { min: 1, max: 1 },
  ceil: { min: 1, max: 1 },
  clamp: { min: 3, max: 3 },
  if: { min: 3, max: 3 },
};

const MAX_LEN = 400;
const MAX_DEPTH = 40;

interface Tok {
  t: "num" | "id" | "op" | "(" | ")" | ",";
  v: string;
}

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) {
      i += 1;
      continue;
    }
    if (/[0-9.]/.test(c)) {
      const m = /^[0-9]*\.?[0-9]+(?:e[+-]?[0-9]+)?/i.exec(src.slice(i));
      if (!m) throw new Error(t("Virheellinen luku kohdassa {pos}", { pos: i + 1 }));
      out.push({ t: "num", v: m[0] });
      i += m[0].length;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      const uriMatch = /^apex:\/\/[A-Za-z0-9_./-]+/.exec(src.slice(i));
      if (uriMatch) {
        out.push({ t: "id", v: uriMatch[0] });
        i += uriMatch[0].length;
        continue;
      }
      const m = /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*/.exec(src.slice(i))!;
      const w = m[0];
      if (w === "and") out.push({ t: "op", v: "&&" });
      else if (w === "or") out.push({ t: "op", v: "||" });
      else if (w === "not") out.push({ t: "op", v: "!" });
      else out.push({ t: "id", v: w });
      i += w.length;
      continue;
    }
    const two = src.slice(i, i + 2);
    if (["<=", ">=", "==", "!=", "&&", "||"].includes(two)) {
      out.push({ t: "op", v: two });
      i += 2;
      continue;
    }
    if ("+-*/%<>!^".includes(c)) {
      out.push({ t: "op", v: c });
      i += 1;
      continue;
    }
    if (c === "(" || c === ")" || c === ",") {
      out.push({ t: c, v: c });
      i += 1;
      continue;
    }
    throw new Error(t("Tuntematon merkki \"{c}\"", { c }));
  }
  return out;
}

const PREC: Record<string, number> = { "||": 1, "&&": 2, "==": 3, "!=": 3, "<": 4, ">": 4, "<=": 4, ">=": 4, "+": 5, "-": 5, "*": 6, "/": 6, "%": 6, "^": 7 };

export function parseFormula(src: string): Node {
  if (typeof src !== "string" || !src.trim()) throw new Error(t("Kaava on tyhjä"));
  if (src.length > MAX_LEN) throw new Error(t("Kaava on liian pitkä"));
  const toks = tokenize(src);
  let pos = 0;
  const peek = () => toks[pos];
  const next = () => toks[pos++];

  function primary(depth: number): Node {
    if (depth > MAX_DEPTH) throw new Error(t("Kaava on liian syvä"));
    const tk = next();
    if (!tk) throw new Error(t("Kaava päättyy kesken"));
    if (tk.t === "num") return { k: "num", v: Number(tk.v) };
    if (tk.t === "op" && (tk.v === "-" || tk.v === "!")) return { k: "un", op: tk.v, a: unaryOperand(depth + 1) };
    if (tk.t === "(") {
      const e = expr(0, depth + 1);
      if (next()?.t !== ")") throw new Error(t("Sulkumerkki puuttuu"));
      return e;
    }
    if (tk.t === "id") {
      if (peek()?.t === "(") {
        const spec = FUNCTIONS[tk.v];
        if (!spec) throw new Error(t("Tuntematon funktio \"{name}\"", { name: tk.v }));
        next();
        const args: Node[] = [];
        if (peek()?.t !== ")") {
          for (;;) {
            args.push(expr(0, depth + 1));
            if (peek()?.t === ",") {
              next();
              continue;
            }
            break;
          }
        }
        if (next()?.t !== ")") throw new Error(t("Sulkumerkki puuttuu"));
        if (args.length < spec.min || args.length > spec.max) throw new Error(t("Funktiolle {name} väärä määrä argumentteja", { name: tk.v }));
        return { k: "call", fn: tk.v, args };
      }
      return { k: "var", name: tk.v };
    }
    throw new Error(t("Odottamaton \"{v}\"", { v: tk.v }));
  }

  function unaryOperand(depth: number): Node {
    // Unaarinen miinus sitoo tiukemmin kuin kertolasku mutta löysemmin kuin potenssi.
    const base = primary(depth);
    if (peek()?.t === "op" && peek().v === "^") {
      next();
      return { k: "bin", op: "^", a: base, b: unaryOperand(depth + 1) };
    }
    return base;
  }

  function expr(minPrec: number, depth: number): Node {
    let left = primary(depth);
    for (;;) {
      const tk = peek();
      if (!tk || tk.t !== "op" || !(tk.v in PREC)) break;
      const p = PREC[tk.v];
      if (p < minPrec) break;
      next();
      const right = expr(tk.v === "^" ? p : p + 1, depth + 1);
      left = { k: "bin", op: tk.v, a: left, b: right };
    }
    return left;
  }

  const tree = expr(0, 0);
  if (pos < toks.length) throw new Error(t("Ylimääräinen \"{v}\"", { v: toks[pos].v }));
  return tree;
}

export function variablesOf(n: Node, out = new Set<string>()): Set<string> {
  switch (n.k) {
    case "var":
      out.add(n.name);
      break;
    case "un":
      variablesOf(n.a, out);
      break;
    case "bin":
      variablesOf(n.a, out);
      variablesOf(n.b, out);
      break;
    case "call":
      n.args.forEach((a) => variablesOf(a, out));
      break;
  }
  return out;
}

export type Scope = Record<string, number>;

export function evaluate(n: Node, scope: Scope): number {
  switch (n.k) {
    case "num":
      return n.v;
    case "var": {
      if (!Object.prototype.hasOwnProperty.call(scope, n.name)) throw new Error(t("Tuntematon muuttuja \"{name}\"", { name: n.name }));
      return scope[n.name];
    }
    case "un": {
      const a = evaluate(n.a, scope);
      return n.op === "-" ? -a : a ? 0 : 1;
    }
    case "bin": {
      if (n.op === "&&") return evaluate(n.a, scope) && evaluate(n.b, scope) ? 1 : 0;
      if (n.op === "||") return evaluate(n.a, scope) || evaluate(n.b, scope) ? 1 : 0;
      const a = evaluate(n.a, scope);
      const b = evaluate(n.b, scope);
      switch (n.op) {
        case "+": return a + b;
        case "-": return a - b;
        case "*": return a * b;
        case "/": return b === 0 ? NaN : a / b;
        case "%": return b === 0 ? NaN : a % b;
        case "^": return Math.pow(a, b);
        case "<": return a < b ? 1 : 0;
        case ">": return a > b ? 1 : 0;
        case "<=": return a <= b ? 1 : 0;
        case ">=": return a >= b ? 1 : 0;
        case "==": return Math.abs(a - b) < 1e-9 ? 1 : 0;
        case "!=": return Math.abs(a - b) >= 1e-9 ? 1 : 0;
      }
      return NaN;
    }
    case "call": {
      if (n.fn === "if") return evaluate(n.args[0], scope) ? evaluate(n.args[1], scope) : evaluate(n.args[2], scope);
      const v = n.args.map((a) => evaluate(a, scope));
      switch (n.fn) {
        case "min": return Math.min(...v);
        case "max": return Math.max(...v);
        case "abs": return Math.abs(v[0]);
        case "round": {
          const d = Math.max(0, Math.min(6, Math.round(v[1] ?? 0)));
          const f = Math.pow(10, d);
          return Math.round(v[0] * f) / f;
        }
        case "floor": return Math.floor(v[0]);
        case "ceil": return Math.ceil(v[0]);
        case "clamp": return Math.min(v[2], Math.max(v[1], v[0]));
      }
      return NaN;
    }
  }
}

/** Jäsentää ja laskee kaavan; palauttaa virheen tekstinä kaatumatta. */
export function evalFormula(src: string, scope: Scope): { value: number; error: null } | { value: null; error: string } {
  try {
    const v = evaluate(parseFormula(src), scope);
    return { value: v, error: null };
  } catch (e) {
    return { value: null, error: (e as Error).message };
  }
}
