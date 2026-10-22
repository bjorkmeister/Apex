/**
 * APEX Flow — mallin muutoskomennot (`src/flow/model/commands.ts`).
 *
 * Tämä on "In-Flight Mutation" -sopimus: valmentaja, keskusteleva tekoäly ja
 * sääntöpohjainen komentotulkki muuttavat mallia vain näillä komennoilla.
 * Jokainen komento validoidaan ennen käyttöä, joten kielimallin vastaus ei voi
 * rikkoa mallia tai kirjoittaa sallittujen kenttien ulkopuolelle.
 */
import type { AtomKind, FixedCostCategory, Molecule } from "../kernel/types.ts";
import { ATOM_KIND_LABELS } from "../kernel/presets.ts";
import type { StressInput } from "../kernel/sensitivity.ts";
import { addAtom, addFixedCost, isEditableField, removeAtom, removeFixedCost, setAtomField } from "./edit.ts";
import { toggleItem, CHECKLIST, type ChecklistState } from "./launchpad.ts";
import type { NodeId } from "./view.ts";

export type PanelId = NodeId | "launchpad" | "coach" | "import";

export type FlowCommand =
  | { type: "set_atom_field"; atomId: string; field: string; value: number | null }
  | { type: "scale_atom_field"; atomId: string; field: string; factor: number }
  | { type: "set_credit"; field: "customerTermsDays" | "supplierTermsDays" | "openingCash"; value: number }
  | { type: "add_atom"; kind: AtomKind; label?: string; params?: Record<string, number> }
  | { type: "remove_atom"; atomId: string }
  | { type: "add_fixed_cost"; label: string; amountPerMonth: number; dayOfMonth?: number; category?: FixedCostCategory }
  | { type: "remove_fixed_cost"; id: string }
  | { type: "checklist"; id: string; checked: boolean }
  | { type: "open_panel"; panel: PanelId }
  | { type: "stress"; stress: StressInput };

const KINDS: AtomKind[] = ["TIME_CAPACITY", "PHYSICAL_MATTER", "RECURRING_SUB", "TRANSACTIONAL_TRADE"];
const CREDIT_FIELDS = ["customerTermsDays", "supplierTermsDays", "openingCash"] as const;
const CATEGORIES: FixedCostCategory[] = ["rent", "admin", "insurance", "pension", "software", "marketing", "other"];
const PANELS: PanelId[] = ["demand", "capacity", "receivables", "cash", "costs", "launchpad", "coach"];

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
const isNum = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
const isStr = (x: unknown, max = 80): x is string => typeof x === "string" && x.trim().length > 0 && x.length <= max;
const ratio = (x: unknown): number | undefined => (isNum(x) && x > -1 && x < 10 ? x : undefined);

/** Validoi tuntemattoman syötteen (esim. kielimallin JSON) komennoksi. Palauttaa `null`, jos komento ei kelpaa. */
export function validateCommand(raw: unknown, m: Molecule): FlowCommand | null {
  if (!isObj(raw) || typeof raw.type !== "string") return null;
  const atom = typeof raw.atomId === "string" ? m.atoms.find((a) => a.id === raw.atomId) : undefined;
  switch (raw.type) {
    case "set_atom_field":
      if (!atom || typeof raw.field !== "string" || !isEditableField(atom.kind, raw.field)) return null;
      if (raw.value !== null && !isNum(raw.value)) return null;
      return { type: "set_atom_field", atomId: atom.id, field: raw.field, value: raw.value as number | null };
    case "scale_atom_field":
      if (!atom || typeof raw.field !== "string" || !isEditableField(atom.kind, raw.field)) return null;
      if (!isNum(raw.factor) || raw.factor <= 0 || raw.factor > 10) return null;
      return { type: "scale_atom_field", atomId: atom.id, field: raw.field, factor: raw.factor };
    case "set_credit":
      if (!CREDIT_FIELDS.includes(raw.field as (typeof CREDIT_FIELDS)[number]) || !isNum(raw.value) || raw.value < 0) return null;
      if (raw.field !== "openingCash" && raw.value > 365) return null;
      return { type: "set_credit", field: raw.field as (typeof CREDIT_FIELDS)[number], value: raw.value };
    case "add_atom": {
      if (!KINDS.includes(raw.kind as AtomKind)) return null;
      const params: Record<string, number> = {};
      if (isObj(raw.params)) {
        for (const [k, v] of Object.entries(raw.params)) {
          if (isNum(v) && isEditableField(raw.kind as AtomKind, k)) params[k] = v;
        }
      }
      return {
        type: "add_atom",
        kind: raw.kind as AtomKind,
        label: isStr(raw.label, 60) ? raw.label.trim() : undefined,
        params,
      };
    }
    case "remove_atom":
      return atom && m.atoms.length > 1 ? { type: "remove_atom", atomId: atom.id } : null;
    case "add_fixed_cost":
      if (!isStr(raw.label, 60) || !isNum(raw.amountPerMonth) || raw.amountPerMonth < 0 || raw.amountPerMonth > 1e8) return null;
      return {
        type: "add_fixed_cost",
        label: raw.label.trim(),
        amountPerMonth: raw.amountPerMonth,
        dayOfMonth: isNum(raw.dayOfMonth) ? raw.dayOfMonth : undefined,
        category: CATEGORIES.includes(raw.category as FixedCostCategory) ? (raw.category as FixedCostCategory) : undefined,
      };
    case "remove_fixed_cost":
      return typeof raw.id === "string" && m.fixedCosts.some((c) => c.id === raw.id) ? { type: "remove_fixed_cost", id: raw.id } : null;
    case "checklist":
      return typeof raw.id === "string" && typeof raw.checked === "boolean" && CHECKLIST.some((d) => d.id === raw.id && d.mode === "manual")
        ? { type: "checklist", id: raw.id, checked: raw.checked }
        : null;
    case "open_panel":
      return PANELS.includes(raw.panel as PanelId) ? { type: "open_panel", panel: raw.panel as PanelId } : null;
    case "stress": {
      const s = isObj(raw.stress) ? raw.stress : {};
      const stress: StressInput = {
        volumeChange: ratio(s.volumeChange),
        priceChange: ratio(s.priceChange),
        variableCostChange: ratio(s.variableCostChange),
        fixedCostChange: ratio(s.fixedCostChange),
      };
      return Object.values(stress).some((v) => v !== undefined) ? { type: "stress", stress } : null;
    }
    default:
      return null;
  }
}

const FIELD_LABELS: Record<string, string> = {
  hourlyRate: "tuntihinta",
  utilization: "laskutusaste",
  people: "tekijät",
  hoursPerWeek: "viikkotunnit",
  demandHoursPerMonth: "myyty kysyntä",
  salaryPerPersonMonth: "palkka",
  sideCostRate: "sivukulut",
  variableCostPerHour: "muuttuva kulu / h",
  unitsPerMonth: "myynti kpl / kk",
  unitPrice: "myyntihinta",
  unitCost: "ostohinta",
  spoilageRate: "hävikki",
  stockCoverDays: "varastopäivät",
  capacityUnitsPerMonth: "kapasiteetti",
  startingSubscribers: "asiakkaat alussa",
  newPerMonth: "uudet asiakkaat / kk",
  churnRateMonthly: "poistuma",
  pricePerMonth: "kuukausihinta",
  costPerSubscriberMonth: "kulu / asiakas",
  cacPerNew: "hankintakulu",
  visitorsPerDay: "ohikulkijat / pv",
  conversionRate: "ostoprosentti",
  averageTicket: "keskiostos",
  costPerSale: "kulu / myynti",
  openDaysPerMonth: "aukiolopäivät",
  capacityPerDay: "palvelukyky / pv",
  paymentTermsDays: "maksuaika",
  customerTermsDays: "asiakkaan maksuaika",
  supplierTermsDays: "toimittajan maksuaika",
  openingCash: "alkukassa",
};

export function fieldLabel(field: string): string {
  return FIELD_LABELS[field] ?? field;
}

/** Selkokielinen kuvaus komennosta (näytetään käyttäjälle ennen ja jälkeen muutoksen). */
export function describeCommand(c: FlowCommand, m: Molecule): string {
  const atomLabel = (id: string) => m.atoms.find((a) => a.id === id)?.label ?? "tulovirta";
  switch (c.type) {
    case "set_atom_field":
      return `${atomLabel(c.atomId)}: ${fieldLabel(c.field)} → ${c.value === null ? "ei rajaa" : Math.round(c.value * 100) / 100}`;
    case "scale_atom_field": {
      const pct = Math.round((c.factor - 1) * 1000) / 10;
      return `${atomLabel(c.atomId)}: ${fieldLabel(c.field)} ${pct >= 0 ? "+" : ""}${pct} %`;
    }
    case "set_credit":
      return `${fieldLabel(c.field)} → ${c.value}${c.field === "openingCash" ? " €" : " pv"}`;
    case "add_atom":
      return `Uusi tulovirta: ${c.label ?? ATOM_KIND_LABELS[c.kind].title}`;
    case "remove_atom":
      return `Poista tulovirta: ${atomLabel(c.atomId)}`;
    case "add_fixed_cost":
      return `Uusi kiinteä kulu: ${c.label} ${Math.round(c.amountPerMonth)} € / kk`;
    case "remove_fixed_cost":
      return `Poista kulu: ${m.fixedCosts.find((f) => f.id === c.id)?.label ?? "kulu"}`;
    case "checklist":
      return `Perustamislista: ${CHECKLIST.find((d) => d.id === c.id)?.title ?? c.id} ${c.checked ? "✓" : "✗"}`;
    case "open_panel":
      return "Avaa paneeli";
    case "stress":
      return "Stressitesti";
  }
}

export interface CommandResult {
  molecule: Molecule;
  checklist: ChecklistState;
  openPanel: PanelId | null;
  stress: StressInput | null;
  applied: string[];
  rejected: number;
  /** Muuttuiko mallin rakenne (atomit lisätty/poistettu) – käyttöliittymä piirtää vivut uudelleen. */
  structural: boolean;
}

/** Validoi ja soveltaa komennot järjestyksessä. Kelvottomat komennot ohitetaan. */
export function applyCommands(m: Molecule, cl: ChecklistState, raw: unknown[]): CommandResult {
  let molecule = m;
  let checklist = cl;
  let openPanel: PanelId | null = null;
  let stress: StressInput | null = null;
  const applied: string[] = [];
  let rejected = 0;
  let structural = false;
  for (const r of raw.slice(0, 12)) {
    const c = validateCommand(r, molecule);
    if (!c) {
      rejected += 1;
      continue;
    }
    const before = molecule;
    applied.push(describeCommand(c, molecule));
    switch (c.type) {
      case "set_atom_field":
        molecule = setAtomField(molecule, c.atomId, c.field, c.value);
        break;
      case "scale_atom_field": {
        const atom = molecule.atoms.find((a) => a.id === c.atomId) as unknown as Record<string, unknown> | undefined;
        const cur = atom?.[c.field];
        if (typeof cur === "number") {
          const next = c.field === "people" ? Math.max(1, Math.round(cur * c.factor)) : cur * c.factor;
          molecule = setAtomField(molecule, c.atomId, c.field, next);
        }
        break;
      }
      case "set_credit":
        molecule = { ...molecule, credit: { ...molecule.credit, [c.field]: c.value } };
        structural = true;
        break;
      case "add_atom": {
        molecule = addAtom(molecule, c.kind, c.label);
        const added = molecule.atoms[molecule.atoms.length - 1];
        for (const [k, v] of Object.entries(c.params ?? {})) molecule = setAtomField(molecule, added.id, k, v);
        structural = true;
        break;
      }
      case "remove_atom":
        molecule = removeAtom(molecule, c.atomId);
        structural = true;
        break;
      case "add_fixed_cost":
        molecule = addFixedCost(molecule, { label: c.label, amountPerMonth: c.amountPerMonth, dayOfMonth: c.dayOfMonth, category: c.category, source: "coach" });
        break;
      case "remove_fixed_cost":
        molecule = removeFixedCost(molecule, c.id);
        break;
      case "checklist": {
        const res = toggleItem(molecule, checklist, c.id, c.checked);
        molecule = res.molecule;
        checklist = res.checklist;
        structural = true;
        break;
      }
      case "open_panel":
        openPanel = c.panel;
        applied.pop();
        break;
      case "stress":
        stress = c.stress;
        openPanel = "cash";
        applied.pop();
        break;
    }
    if (molecule === before && c.type !== "open_panel" && c.type !== "stress" && c.type !== "checklist") applied.pop();
  }
  return { molecule, checklist, openPanel, stress, applied, rejected, structural };
}
