/**
 * APEX Flow — molekyylin muokkaukset (`src/flow/model/edit.ts`).
 *
 * Kaikki muokkaukset ovat puhtaita funktioita: ne palauttavat uuden molekyylin eivätkä
 * muuta alkuperäistä. Samoja funktioita käyttävät käyttöliittymä, muistilista ja valmentaja.
 */
import type { AtomKind, FixedCost, FixedCostCategory, FixedCostSource, Molecule, RevenueAtom } from "../kernel/types.ts";
import { createAtom, newId } from "../kernel/presets.ts";
import { t } from "../i18n/index.ts";

/** Kentät, joita saa muokata atomikohtaisesti. `nullable` = tyhjä arvo tarkoittaa "ei rajaa". */
const EDITABLE: Record<AtomKind, Record<string, { nullable: boolean; min: number; max: number }>> = {
  TIME_CAPACITY: {
    people: { nullable: false, min: 0, max: 10000 },
    hoursPerWeek: { nullable: false, min: 0, max: 100 },
    utilization: { nullable: false, min: 0, max: 1 },
    hourlyRate: { nullable: false, min: 0, max: 100000 },
    demandHoursPerMonth: { nullable: true, min: 0, max: 1e7 },
    salaryPerPersonMonth: { nullable: false, min: 0, max: 1e7 },
    sideCostRate: { nullable: false, min: 0, max: 2 },
    variableCostPerHour: { nullable: false, min: 0, max: 100000 },
    paymentTermsDays: { nullable: true, min: 0, max: 365 },
  },
  PHYSICAL_MATTER: {
    unitsPerMonth: { nullable: false, min: 0, max: 1e9 },
    unitPrice: { nullable: false, min: 0, max: 1e9 },
    unitCost: { nullable: false, min: 0, max: 1e9 },
    spoilageRate: { nullable: false, min: 0, max: 0.95 },
    stockCoverDays: { nullable: false, min: 0, max: 730 },
    capacityUnitsPerMonth: { nullable: true, min: 0, max: 1e9 },
    paymentTermsDays: { nullable: true, min: 0, max: 365 },
  },
  RECURRING_SUB: {
    startingSubscribers: { nullable: false, min: 0, max: 1e9 },
    newPerMonth: { nullable: false, min: 0, max: 1e9 },
    churnRateMonthly: { nullable: false, min: 0, max: 1 },
    pricePerMonth: { nullable: false, min: 0, max: 1e9 },
    costPerSubscriberMonth: { nullable: false, min: 0, max: 1e9 },
    cacPerNew: { nullable: false, min: 0, max: 1e9 },
    paymentTermsDays: { nullable: true, min: 0, max: 365 },
  },
  TRANSACTIONAL_TRADE: {
    visitorsPerDay: { nullable: false, min: 0, max: 1e9 },
    conversionRate: { nullable: false, min: 0, max: 1 },
    averageTicket: { nullable: false, min: 0, max: 1e9 },
    costPerSale: { nullable: false, min: 0, max: 1e9 },
    openDaysPerMonth: { nullable: false, min: 0, max: 30 },
    capacityPerDay: { nullable: true, min: 0, max: 1e9 },
    paymentTermsDays: { nullable: true, min: 0, max: 365 },
  },
};

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

export function isEditableField(kind: AtomKind, field: string): boolean {
  return Object.prototype.hasOwnProperty.call(EDITABLE[kind], field);
}

/** Asettaa atomin kentän. `null` sallitaan vain "ei rajaa" -kentille; maksuajassa `null` = oletus. */
export function setAtomField(m: Molecule, atomId: string, field: string, value: number | null): Molecule {
  return {
    ...m,
    atoms: m.atoms.map((a): RevenueAtom => {
      if (a.id !== atomId) return a;
      const spec = EDITABLE[a.kind][field];
      if (!spec) return a;
      if (value === null || !Number.isFinite(value)) {
        if (!spec.nullable) return a;
        if (field === "paymentTermsDays") {
          const copy = { ...a } as RevenueAtom;
          delete copy.paymentTermsDays;
          return copy;
        }
        return { ...a, [field]: null } as RevenueAtom;
      }
      return { ...a, [field]: clamp(value, spec.min, spec.max) } as RevenueAtom;
    }),
  };
}

export function addAtom(m: Molecule, kind: AtomKind, label?: string): Molecule {
  const atom = createAtom(kind);
  if (label) atom.label = label;
  return { ...m, atoms: [...m.atoms, atom] };
}

export function removeAtom(m: Molecule, atomId: string): Molecule {
  return { ...m, atoms: m.atoms.filter((a) => a.id !== atomId) };
}

export function renameAtom(m: Molecule, atomId: string, label: string): Molecule {
  const clean = label.trim().slice(0, 60);
  if (!clean) return m;
  return { ...m, atoms: m.atoms.map((a) => (a.id === atomId ? { ...a, label: clean } : a)) };
}

export function renameMolecule(m: Molecule, name: string): Molecule {
  const clean = name.trim().slice(0, 80);
  return clean ? { ...m, name: clean } : m;
}

export interface NewFixedCost {
  label: string;
  amountPerMonth: number;
  category?: FixedCostCategory;
  dayOfMonth?: number;
  source?: FixedCostSource;
  /** Vakaa tunniste (muistilista käyttää tätä, jotta kohdan voi myöhemmin poistaa). */
  id?: string;
}

export function addFixedCost(m: Molecule, c: NewFixedCost): Molecule {
  const cost: FixedCost = {
    id: c.id ?? newId("fc"),
    label: c.label.trim().slice(0, 60) || t("Kulu"),
    amountPerMonth: Math.max(0, Number.isFinite(c.amountPerMonth) ? c.amountPerMonth : 0),
    dayOfMonth: clamp(Math.round(c.dayOfMonth ?? 1), 1, 30),
    category: c.category ?? "other",
    source: c.source ?? "user",
  };
  return { ...m, fixedCosts: [...m.fixedCosts.filter((f) => f.id !== cost.id), cost] };
}

export function updateFixedCost(
  m: Molecule,
  id: string,
  patch: Partial<Pick<FixedCost, "label" | "amountPerMonth" | "dayOfMonth">>,
): Molecule {
  return {
    ...m,
    fixedCosts: m.fixedCosts.map((f) => {
      if (f.id !== id) return f;
      const next = { ...f };
      if (typeof patch.label === "string" && patch.label.trim()) next.label = patch.label.trim().slice(0, 60);
      if (typeof patch.amountPerMonth === "number" && Number.isFinite(patch.amountPerMonth)) {
        next.amountPerMonth = Math.max(0, patch.amountPerMonth);
      }
      if (typeof patch.dayOfMonth === "number" && Number.isFinite(patch.dayOfMonth)) {
        next.dayOfMonth = clamp(Math.round(patch.dayOfMonth), 1, 30);
      }
      return next;
    }),
  };
}

export function removeFixedCost(m: Molecule, id: string): Molecule {
  return { ...m, fixedCosts: m.fixedCosts.filter((f) => f.id !== id) };
}

export function setPayrollDay(m: Molecule, day: number): Molecule {
  return Number.isFinite(day) ? { ...m, payrollDay: clamp(Math.round(day), 1, 30) } : m;
}
