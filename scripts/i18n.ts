/**
 * APEX Studio — käännöstyökalu (`scripts/i18n.ts`).
 *
 *   npm run i18n               → tarkistus: puuttuvat ja vanhentuneet englanninkieliset tekstit
 *   npm run i18n -- --strict   → sama, mutta päättyy virheeseen, jos käännöksiä puuttuu
 *   npm run i18n:translate     → kääntää puuttuvat tekstit kielimallilla (oma API-avain .env:ssä)
 *   npm run i18n:translate -- --prune  → poistaa lisäksi käännökset, joita koodi ei enää käytä
 *
 * Lähdekieli on suomi: jokainen `t("…")`- ja `msg("…")`-kutsun teksti on käännösavain.
 */
import fs from "node:fs";
import path from "node:path";
import { EN } from "../src/flow/i18n/en.ts";
import { GLOSSARY } from "../src/flow/i18n/glossary.ts";
import { placeholders } from "../src/flow/i18n/index.ts";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const SRC = path.join(ROOT, "src/flow");
const EN_FILE = path.join(SRC, "i18n/en.ts");

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? walk(path.join(dir, d.name)) : d.name.endsWith(".ts") ? [path.join(dir, d.name)] : []));
}

/** Kaikki käännösavaimet lähdekoodista. */
export function extractKeys(): Map<string, string[]> {
  const keys = new Map<string, string[]>();
  for (const file of walk(SRC)) {
    if (file.includes(`${path.sep}i18n${path.sep}`)) continue;
    const src = fs.readFileSync(file, "utf-8");
    for (const m of src.matchAll(/\b(?:t|msg)\(\s*"((?:[^"\\\n]|\\.)*)"/g)) {
      const key = JSON.parse(`"${m[1]}"`) as string;
      const rel = path.relative(ROOT, file);
      keys.set(key, [...(keys.get(key) ?? []), rel]);
    }
  }
  return keys;
}

function writeEn(entries: Record<string, string>): void {
  const sorted = Object.keys(entries).sort((a, b) => a.localeCompare(b, "fi"));
  const body = sorted.map((k) => `  ${JSON.stringify(k)}: ${JSON.stringify(entries[k])},`).join("\n");
  fs.writeFileSync(
    EN_FILE,
    `/**
 * APEX Studio — englanninkieliset käännökset (\`src/flow/i18n/en.ts\`).
 *
 * Avain on suomenkielinen lähdeteksti. Tiedosto päivitetään työkalulla
 * (\`npm run i18n:translate\`); käsin muokkaus on sallittua.
 */
export const EN: Record<string, string> = {
${body}
};
`,
  );
}

async function translate(missing: string[]): Promise<Record<string, string>> {
  const { callLlmJson, ensureEnvLoaded, isLlmConfigured } = await import("../src/core/llm/client.ts");
  ensureEnvLoaded();
  if (!isLlmConfigured()) throw new Error("Kielimallia ei ole määritetty (.env: API-avain).");
  const out: Record<string, string> = {};
  const glossary = Object.entries(GLOSSARY).map(([fi, en]) => `${fi} = ${en}`).join("\n");
  for (let i = 0; i < missing.length; i += 50) {
    const batch = missing.slice(i, i + 50);
    process.stdout.write(`Käännetään ${i + 1}–${i + batch.length} / ${missing.length}… `);
    const res = await callLlmJson<Record<string, unknown>>({
      systemInstruction: `You translate the UI of APEX Studio, a Finnish business simulator and coach, from Finnish to clear, friendly British English.
Rules:
- Keep every {placeholder} exactly as is (same names, same count). Do not translate placeholder names.
- Keep emoji, arrows (→ ↔ ↶), symbols (€, %, ×, −) and markdown as they are. Do not add a currency symbol that is not in the source.
- Keep it short; these are UI labels and sentences. Plain language, no jargon.
- Finnish abbreviations: "kk" = month (use "mo" in compact labels like "/ kk" → "/ mo"), "pv" = days/day (use "d" in compact labels, "days" in sentences), "h" stays "h", "kpl" = "pcs".
- Finnish legal/authority terms stay recognisable: e.g. "YEL" → "YEL (Finnish entrepreneur's pension insurance)" the first time it appears in a sentence, otherwise "YEL".
- Use this glossary consistently:
${glossary}
Return only JSON: an object mapping each Finnish source string (exactly as given) to its English translation.`,
      userPrompt: JSON.stringify(batch),
      temperature: 0,
      timeoutMs: 90000,
      taskLabelFi: "APEX Studio: käännös",
    });
    let ok = 0;
    for (const key of batch) {
      const val = res.data?.[key];
      if (typeof val !== "string" || !val.trim()) continue;
      if (placeholders(val).join(",") !== placeholders(key).join(",")) {
        console.warn(`\n  ⚠ paikkamerkit eivät täsmää, ohitetaan: ${key}`);
        continue;
      }
      out[key] = val;
      ok += 1;
    }
    console.log(`${ok}/${batch.length}${res.meta.error ? ` (${res.meta.error})` : ""}`);
  }
  return out;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const keys = extractKeys();
  const missing = [...keys.keys()].filter((k) => !(k in EN));
  const obsolete = Object.keys(EN).filter((k) => !keys.has(k));
  console.log(`Käännösavaimia koodissa: ${keys.size}`);
  console.log(`Englanninkielisiä käännöksiä: ${Object.keys(EN).length}`);
  console.log(`Puuttuu: ${missing.length} · Vanhentuneita: ${obsolete.length}`);
  if (args.includes("translate")) {
    const next: Record<string, string> = { ...EN };
    if (missing.length > 0) Object.assign(next, await translate(missing));
    if (args.includes("--prune")) for (const k of obsolete) delete next[k];
    writeEn(next);
    const still = [...keys.keys()].filter((k) => !(k in next));
    console.log(`Valmis. Puuttuu edelleen: ${still.length}. Tarkista käännökset: ${path.relative(ROOT, EN_FILE)}`);
    return;
  }
  if (missing.length) {
    console.log("\nPuuttuvat (ensimmäiset 40):");
    for (const k of missing.slice(0, 40)) console.log(`  - ${k}   [${keys.get(k)![0]}]`);
  }
  if (args.includes("--strict") && missing.length > 0) process.exit(1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
