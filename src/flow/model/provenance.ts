/**
 * APEX Studio — lukujen alkuperä (`src/flow/model/provenance.ts`).
 *
 * Jokaisesta muokattavasta luvusta tiedetään, mistä se on peräisin: oma arvio,
 * esimerkkipohja, tiliote, valmentaja, markkinatieto, perustamislista vai
 * tekoälyn rakentama aloitus. Alkuperä näytetään vipujen vieressä ja raportissa.
 */
import type { Molecule, Provenance, ProvenanceSource } from "../kernel/types.ts";
import { msg, t } from "../i18n/index.ts";

export const SOURCE_LABELS: Record<ProvenanceSource, string> = {
  user: msg("oma arvio"),
  preset: msg("oletus"),
  import: msg("tiliote"),
  coach: msg("valmentaja"),
  market: msg("markkinatieto"),
  launchpad: msg("perustamislista"),
  genesis: msg("tekoälyn aloitus"),
  widget: msg("widgetti"),
};

export function provKey(scope: string, field: string): string {
  return `${scope}:${field}`;
}

export function getProvenance(m: Molecule, key: string): Provenance | null {
  return m.provenance?.[key] ?? null;
}

export function sourceLabel(p: Provenance | null): string {
  return t(SOURCE_LABELS[p?.source ?? "preset"]);
}

/** Palauttaa uuden molekyylin, jossa annettujen avainten alkuperä on asetettu. */
export function withProvenance(m: Molecule, keys: string[], source: ProvenanceSource, extra: { note?: string; url?: string } = {}): Molecule {
  if (keys.length === 0) return m;
  const next = { ...(m.provenance ?? {}) };
  const at = Date.now();
  for (const k of keys) next[k] = { source, at, ...(extra.note ? { note: extra.note.slice(0, 300) } : {}), ...(extra.url ? { url: extra.url.slice(0, 500) } : {}) };
  return { ...m, provenance: next };
}

/** Poistaa alkuperät, joiden atomia ei enää ole. */
export function pruneProvenance(m: Molecule): Molecule {
  if (!m.provenance) return m;
  const ids = new Set(m.atoms.map((a) => a.id));
  const next: Record<string, Provenance> = {};
  for (const [k, v] of Object.entries(m.provenance)) {
    const scope = k.split(":")[0];
    if (scope === "credit" || ids.has(scope)) next[k] = v;
  }
  return { ...m, provenance: next };
}
