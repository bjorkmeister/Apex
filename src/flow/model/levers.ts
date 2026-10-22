/**
 * APEX Flow — vivut eli liukusäätimet (`src/flow/model/levers.ts`).
 *
 * Vivut johdetaan suoraan molekyylin atomeista. Uutta atomia lisättäessä sen vivut
 * ilmestyvät automaattisesti, eikä käyttöliittymään tarvita toimialakohtaista koodia.
 */
import type { AtomKind, Molecule, RevenueAtom } from "../kernel/types.ts";

export type LeverFormat = "eur" | "pct" | "int" | "num" | "days";

export interface Lever {
  id: string;
  atomId: string | null;
  field: string;
  label: string;
  hint: string;
  format: LeverFormat;
  min: number;
  max: number;
  step: number;
  value: number;
  /** Ensisijaiset vivut näytetään päänäkymässä, muut avautuvat "Lisää vipuja" -kohdasta. */
  primary: boolean;
  group: string;
}

interface FieldSpec {
  field: string;
  label: string;
  hint: string;
  format: LeverFormat;
  min: number;
  max: (v: number) => number;
  step: number;
  primary: boolean;
}

const grow = (floor: number) => (v: number) => Math.max(floor, Math.ceil((v * 3) / floor) * floor);

const SPECS: Record<AtomKind, FieldSpec[]> = {
  TIME_CAPACITY: [
    { field: "hourlyRate", label: "Tuntihinta", hint: "Laskutettava hinta tunnilta (alv 0 %)", format: "eur", min: 10, max: grow(50), step: 1, primary: true },
    { field: "utilization", label: "Laskutusaste", hint: "Osuus työajasta, jonka saat laskutettua", format: "pct", min: 0.05, max: () => 1, step: 0.01, primary: true },
    { field: "people", label: "Tekijöitä", hint: "Laskuttavat henkilöt", format: "int", min: 1, max: grow(10), step: 1, primary: true },
    { field: "salaryPerPersonMonth", label: "Palkka / hlö / kk", hint: "Yksinyrittäjällä oma nosto", format: "eur", min: 0, max: grow(2000), step: 50, primary: false },
    { field: "sideCostRate", label: "Sivukulut", hint: "Työnantajan sivukulut palkan päälle", format: "pct", min: 0, max: () => 0.4, step: 0.01, primary: false },
    { field: "hoursPerWeek", label: "Työtunnit / viikko", hint: "Henkilön kokonaistyöaika", format: "num", min: 5, max: () => 70, step: 0.5, primary: false },
    { field: "variableCostPerHour", label: "Muuttuva kulu / h", hint: "Esim. alihankinta tai lisenssi tunnilta", format: "eur", min: 0, max: grow(50), step: 1, primary: false },
  ],
  PHYSICAL_MATTER: [
    { field: "unitPrice", label: "Myyntihinta / kpl", hint: "Hinta asiakkaalle (alv 0 %)", format: "eur", min: 0.5, max: grow(50), step: 0.5, primary: true },
    { field: "unitsPerMonth", label: "Myynti kpl / kk", hint: "Arviosi myyntimäärästä", format: "int", min: 0, max: grow(500), step: 10, primary: true },
    { field: "unitCost", label: "Ostohinta / kpl", hint: "Mitä yksi kappale maksaa sinulle", format: "eur", min: 0, max: grow(50), step: 0.5, primary: true },
    { field: "spoilageRate", label: "Hävikki", hint: "Osuus ostetuista, joka pilaantuu tai katoaa", format: "pct", min: 0, max: () => 0.5, step: 0.01, primary: false },
    { field: "stockCoverDays", label: "Varasto päivinä", hint: "Kuinka monen päivän tavarat pidät varastossa", format: "days", min: 0, max: () => 180, step: 1, primary: false },
  ],
  RECURRING_SUB: [
    { field: "pricePerMonth", label: "Hinta / kk", hint: "Kuukausimaksu asiakkaalle (alv 0 %)", format: "eur", min: 1, max: grow(100), step: 1, primary: true },
    { field: "newPerMonth", label: "Uusia asiakkaita / kk", hint: "Arviosi uusista tilaajista", format: "int", min: 0, max: grow(50), step: 1, primary: true },
    { field: "churnRateMonthly", label: "Poistuma / kk", hint: "Osuus asiakkaista, jotka lopettavat kuukaudessa", format: "pct", min: 0, max: () => 0.3, step: 0.005, primary: true },
    { field: "cacPerNew", label: "Hankintakulu / asiakas", hint: "Markkinointi ja myynti yhtä uutta asiakasta kohden", format: "eur", min: 0, max: grow(500), step: 5, primary: false },
    { field: "costPerSubscriberMonth", label: "Kulu / asiakas / kk", hint: "Palvelimet, tuki", format: "eur", min: 0, max: grow(50), step: 0.5, primary: false },
    { field: "startingSubscribers", label: "Asiakkaita alussa", hint: "Nykyiset tilaajat", format: "int", min: 0, max: grow(100), step: 1, primary: false },
  ],
  TRANSACTIONAL_TRADE: [
    { field: "averageTicket", label: "Keskiostos", hint: "Keskimääräinen ostos (alv 0 %)", format: "eur", min: 0.5, max: grow(20), step: 0.1, primary: true },
    { field: "visitorsPerDay", label: "Ohikulkijat / pv", hint: "Ihmisiä, jotka näkevät myyntipisteesi", format: "int", min: 0, max: grow(500), step: 10, primary: true },
    { field: "conversionRate", label: "Ostoprosentti", hint: "Osuus ohikulkijoista, joka ostaa", format: "pct", min: 0, max: () => 0.6, step: 0.005, primary: true },
    { field: "costPerSale", label: "Raaka-aineet / myynti", hint: "Muuttuva kulu yhtä myyntiä kohden", format: "eur", min: 0, max: grow(20), step: 0.1, primary: false },
    { field: "openDaysPerMonth", label: "Aukiolopäivät / kk", hint: "", format: "int", min: 1, max: () => 30, step: 1, primary: false },
  ],
};

const CREDIT_SPECS: FieldSpec[] = [
  { field: "customerTermsDays", label: "Asiakkaan maksuaika", hint: "Kuinka monen päivän päästä laskusi maksetaan", format: "days", min: 0, max: () => 90, step: 1, primary: true },
  { field: "openingCash", label: "Alkukassa", hint: "Rahaa tilillä aloitushetkellä", format: "eur", min: 0, max: grow(10000), step: 100, primary: false },
  { field: "supplierTermsDays", label: "Toimittajan maksuaika", hint: "Kuinka pian maksat ostolaskusi", format: "days", min: 0, max: () => 90, step: 1, primary: false },
];

/** Onko molekyylissä laskutettavia virtoja, joihin asiakkaan maksuaika vaikuttaa. */
export function hasInvoicedStreams(m: Molecule): boolean {
  return m.atoms.some(
    (a) => a.enabled && (a.kind === "TIME_CAPACITY" || a.kind === "PHYSICAL_MATTER") && a.paymentTermsDays === undefined,
  );
}

function specToLever(spec: FieldSpec, atomId: string | null, value: number, group: string, primaryOverride?: boolean): Lever {
  const max = Math.max(spec.max(value), value);
  return {
    id: `${atomId ?? "credit"}:${spec.field}`,
    atomId,
    field: spec.field,
    label: spec.label,
    hint: spec.hint,
    format: spec.format,
    min: Math.min(spec.min, value),
    max,
    step: spec.step,
    value,
    primary: primaryOverride ?? spec.primary,
    group,
  };
}

export function leversFor(m: Molecule): Lever[] {
  const out: Lever[] = [];
  for (const atom of m.atoms) {
    if (!atom.enabled) continue;
    const rec = atom as unknown as Record<string, number | null>;
    for (const spec of SPECS[atom.kind]) {
      const v = rec[spec.field];
      if (typeof v !== "number") continue;
      out.push(specToLever(spec, atom.id, v, atom.label));
    }
  }
  const invoiced = hasInvoicedStreams(m);
  for (const spec of CREDIT_SPECS) {
    const v = (m.credit as unknown as Record<string, number>)[spec.field];
    const primary = spec.field === "customerTermsDays" ? invoiced : spec.primary;
    if (spec.field === "customerTermsDays" && !invoiced) continue;
    out.push(specToLever(spec, null, v, "Kassa ja maksuajat", primary));
  }
  return out;
}

/** Palauttaa uuden molekyylin, jossa vivun arvo on muutettu. Alkuperäistä ei muuteta. */
export function applyLever(m: Molecule, leverId: string, value: number): Molecule {
  if (!Number.isFinite(value)) return m;
  const [scope, field] = leverId.split(":");
  if (!field) return m;
  if (scope === "credit") {
    if (!CREDIT_SPECS.some((s) => s.field === field)) return m;
    return { ...m, credit: { ...m.credit, [field]: value } };
  }
  return {
    ...m,
    atoms: m.atoms.map((a): RevenueAtom => {
      if (a.id !== scope) return a;
      if (!SPECS[a.kind].some((s) => s.field === field)) return a;
      return { ...a, [field]: value } as RevenueAtom;
    }),
  };
}
