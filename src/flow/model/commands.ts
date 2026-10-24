/**
 * APEX Studio — mallin muutoskomennot (`src/flow/model/commands.ts`).
 *
 * Tämä on "In-Flight Mutation" -sopimus: valmentaja, keskusteleva tekoäly,
 * liikeidean tulkki, neuvonantajat, markkinatieto ja tiliotteen tuonti muuttavat
 * mallia vain näillä komennoilla. Jokainen komento validoidaan ennen käyttöä,
 * joten kielimallin vastaus ei voi rikkoa mallia tai kirjoittaa sallittujen
 * kenttien ulkopuolelle. Muutettujen lukujen alkuperä tallennetaan.
 */
import type { AtomKind, FixedCostCategory, Molecule, Provenance, ProvenanceSource } from "../kernel/types.ts";
import type {
  EnterpriseGraph,
  EntityURI,
  GraphCommand,
  UniversalEnterpriseNode,
} from "../graph/types.ts";
import { ATOM_KIND_LABELS, newId } from "../kernel/presets.ts";
import type { StressInput } from "../kernel/sensitivity.ts";
import { addAtom, addFixedCost, isEditableField, removeAtom, removeFixedCost, renameMolecule, setAtomField } from "./edit.ts";
import { toggleItem, CHECKLIST, type ChecklistState } from "./launchpad.ts";
import { provKey, pruneProvenance, withProvenance } from "./provenance.ts";
import type { NodeId } from "./view.ts";
import { msg, t } from "../i18n/index.ts";

export type PanelId =
  | NodeId
  | "launchpad"
  | "coach"
  | "import"
  | "widgets"
  | "scenarios"
  | "advisors"
  | "market"
  | "seasons"
  | "founder"
  | "goals"
  | "report"
  | "actuals"
  | "tasks";

export const PANELS: PanelId[] = [
  "demand", "capacity", "receivables", "cash", "costs", "launchpad", "coach", "import", "widgets",
  "scenarios", "advisors", "market", "seasons", "founder", "goals", "report", "actuals", "tasks",
];

export interface EventPayload {
  title: string;
  startMonth: number;
  durationMonths: number;
  volumeChange?: number;
  priceChange?: number;
  variableCostChange?: number;
  fixedCostChange?: number;
  oneOffCost?: number;
  libraryId?: string;
}

export type FlowCommand =
  | { type: "set_atom_field"; atomId: string; field: string; value: number | null }
  | { type: "scale_atom_field"; atomId: string; field: string; factor: number }
  | { type: "set_credit"; field: "customerTermsDays" | "supplierTermsDays" | "openingCash"; value: number }
  | { type: "add_atom"; kind: AtomKind; label?: string; params?: Record<string, number | null> }
  | { type: "remove_atom"; atomId: string }
  | { type: "add_fixed_cost"; label: string; amountPerMonth: number; dayOfMonth?: number; category?: FixedCostCategory }
  | { type: "remove_fixed_cost"; id: string }
  | { type: "checklist"; id: string; checked: boolean }
  | { type: "open_panel"; panel: PanelId }
  | { type: "stress"; stress: StressInput }
  | { type: "set_name"; name: string }
  | { type: "add_event"; event: EventPayload }
  | { type: "remove_event"; id: string }
  | { type: "set_seasonality"; factors: number[] }
  | { type: "set_start_month"; month: number }
  | { type: "set_founder"; weeklyHours?: number; livingCostsPerMonth?: number };

const KINDS: AtomKind[] = ["TIME_CAPACITY", "PHYSICAL_MATTER", "RECURRING_SUB", "TRANSACTIONAL_TRADE"];
const CREDIT_FIELDS = ["customerTermsDays", "supplierTermsDays", "openingCash"] as const;
const CATEGORIES: FixedCostCategory[] = ["rent", "admin", "insurance", "pension", "software", "marketing", "other"];

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
const isNum = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
const isStr = (x: unknown, max = 80): x is string => typeof x === "string" && x.trim().length > 0 && x.length <= max;
const ratio = (x: unknown, lo = -1, hi = 10): number | undefined => (isNum(x) && x >= lo && x <= hi ? x : undefined);

function validateEvent(raw: unknown): EventPayload | null {
  if (!isObj(raw) || !isStr(raw.title, 80)) return null;
  const start = isNum(raw.startMonth) ? Math.round(raw.startMonth) : 0;
  const dur = isNum(raw.durationMonths) ? Math.round(raw.durationMonths) : 1;
  if (start < 0 || start > 11 || dur < 1 || dur > 12) return null;
  const e: EventPayload = {
    title: raw.title.trim(),
    startMonth: start,
    durationMonths: dur,
    volumeChange: ratio(raw.volumeChange, -1, 5),
    priceChange: ratio(raw.priceChange, -0.9, 5),
    variableCostChange: ratio(raw.variableCostChange, -0.9, 5),
    fixedCostChange: ratio(raw.fixedCostChange, -0.9, 5),
    oneOffCost: isNum(raw.oneOffCost) && raw.oneOffCost >= 0 && raw.oneOffCost <= 1e7 ? raw.oneOffCost : undefined,
    libraryId: typeof raw.libraryId === "string" ? raw.libraryId.slice(0, 40) : undefined,
  };
  const hasEffect = [e.volumeChange, e.priceChange, e.variableCostChange, e.fixedCostChange, e.oneOffCost].some((x) => x !== undefined && x !== 0);
  return hasEffect ? e : null;
}

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
      if (!KINDS.includes(raw.kind as AtomKind) || m.atoms.length >= 12) return null;
      const params: Record<string, number | null> = {};
      if (isObj(raw.params)) {
        for (const [k, v] of Object.entries(raw.params)) {
          if ((isNum(v) || v === null) && isEditableField(raw.kind as AtomKind, k)) params[k] = v;
        }
      }
      return { type: "add_atom", kind: raw.kind as AtomKind, label: isStr(raw.label, 60) ? raw.label.trim() : undefined, params };
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
    case "set_name":
      return isStr(raw.name, 80) ? { type: "set_name", name: raw.name.trim() } : null;
    case "add_event": {
      if ((m.events?.length ?? 0) >= 20) return null;
      const e = validateEvent(raw.event);
      return e ? { type: "add_event", event: e } : null;
    }
    case "remove_event":
      return typeof raw.id === "string" && (m.events ?? []).some((e) => e.id === raw.id) ? { type: "remove_event", id: raw.id } : null;
    case "set_seasonality":
      return Array.isArray(raw.factors) && raw.factors.length === 12 && raw.factors.every((x) => isNum(x) && x >= 0 && x <= 5)
        ? { type: "set_seasonality", factors: raw.factors as number[] }
        : null;
    case "set_start_month":
      return isNum(raw.month) && raw.month >= 0 && raw.month <= 11 ? { type: "set_start_month", month: Math.round(raw.month) } : null;
    case "set_founder": {
      const h = isNum(raw.weeklyHours) && raw.weeklyHours >= 0 && raw.weeklyHours <= 120 ? raw.weeklyHours : undefined;
      const l = isNum(raw.livingCostsPerMonth) && raw.livingCostsPerMonth >= 0 && raw.livingCostsPerMonth <= 1e6 ? raw.livingCostsPerMonth : undefined;
      return h !== undefined || l !== undefined ? { type: "set_founder", weeklyHours: h, livingCostsPerMonth: l } : null;
    }
    default:
      return null;
  }
}

const FIELD_LABELS: Record<string, string> = {
  hourlyRate: msg("tuntihinta"),
  utilization: msg("laskutusaste"),
  people: msg("tekijät"),
  hoursPerWeek: msg("viikkotunnit"),
  demandHoursPerMonth: msg("myyty kysyntä"),
  salaryPerPersonMonth: msg("palkka"),
  sideCostRate: msg("sivukulut"),
  variableCostPerHour: msg("muuttuva kulu / h"),
  unitsPerMonth: msg("myynti kpl / kk"),
  unitPrice: msg("myyntihinta"),
  unitCost: msg("ostohinta"),
  spoilageRate: msg("hävikki"),
  stockCoverDays: msg("varastopäivät"),
  capacityUnitsPerMonth: msg("kapasiteetti"),
  startingSubscribers: msg("asiakkaat alussa"),
  newPerMonth: msg("uudet asiakkaat / kk"),
  churnRateMonthly: msg("poistuma"),
  pricePerMonth: msg("kuukausihinta"),
  costPerSubscriberMonth: msg("kulu / asiakas"),
  cacPerNew: msg("hankintakulu"),
  visitorsPerDay: msg("ohikulkijat / pv"),
  conversionRate: msg("ostoprosentti"),
  averageTicket: msg("keskiostos"),
  costPerSale: msg("kulu / myynti"),
  openDaysPerMonth: msg("aukiolopäivät"),
  capacityPerDay: msg("palvelukyky / pv"),
  paymentTermsDays: msg("maksuaika"),
  customerTermsDays: msg("asiakkaan maksuaika"),
  supplierTermsDays: msg("toimittajan maksuaika"),
  openingCash: msg("alkukassa"),
};

export function fieldLabel(field: string): string {
  return FIELD_LABELS[field] ? t(FIELD_LABELS[field]) : field;
}

/** Selkokielinen kuvaus komennosta (näytetään käyttäjälle muutoksen jälkeen). */
export function describeCommand(c: FlowCommand, m: Molecule): string {
  const atomLabel = (id: string) => m.atoms.find((a) => a.id === id)?.label ?? t("tulovirta");
  switch (c.type) {
    case "set_atom_field":
      return `${atomLabel(c.atomId)}: ${fieldLabel(c.field)} → ${c.value === null ? t("ei rajaa") : Math.round(c.value * 100) / 100}`;
    case "scale_atom_field": {
      const p = Math.round((c.factor - 1) * 1000) / 10;
      return `${atomLabel(c.atomId)}: ${fieldLabel(c.field)} ${p >= 0 ? "+" : ""}${p} %`;
    }
    case "set_credit":
      return `${fieldLabel(c.field)} → ${c.value}${c.field === "openingCash" ? " €" : ` ${t("pv")}`}`;
    case "add_atom":
      return t("Uusi tulovirta: {label}", { label: c.label ?? t(ATOM_KIND_LABELS[c.kind].title) });
    case "remove_atom":
      return t("Poista tulovirta: {label}", { label: atomLabel(c.atomId) });
    case "add_fixed_cost":
      return t("Uusi kiinteä kulu: {label} {amount} € / kk", { label: c.label, amount: Math.round(c.amountPerMonth) });
    case "remove_fixed_cost":
      return t("Poista kulu: {label}", { label: m.fixedCosts.find((f) => f.id === c.id)?.label ?? t("kulu") });
    case "checklist":
      return t("Perustamislista: {title}", { title: t(CHECKLIST.find((d) => d.id === c.id)?.title ?? c.id) }) + (c.checked ? " ✓" : " ✗");
    case "open_panel":
      return t("Avaa paneeli");
    case "stress":
      return t("Stressitesti");
    case "set_name":
      return t("Yrityksen nimi: {name}", { name: c.name });
    case "add_event":
      return t("Uusi tapahtuma: {title}", { title: c.event.title });
    case "remove_event":
      return t("Poista tapahtuma: {title}", { title: (m.events ?? []).find((e) => e.id === c.id)?.title ?? "" });
    case "set_seasonality":
      return t("Kausivaihtelu päivitetty");
    case "set_start_month":
      return t("Aloituskuukausi päivitetty");
    case "set_founder":
      return t("Yrittäjän tiedot päivitetty");
  }
}

export interface CommandResult {
  molecule: Molecule;
  checklist: ChecklistState;
  openPanel: PanelId | null;
  stress: StressInput | null;
  applied: string[];
  rejected: number;
  /** Muuttuiko mallin rakenne – käyttöliittymä piirtää vivut uudelleen. */
  structural: boolean;
}

export interface ApplyOptions {
  source?: ProvenanceSource;
  note?: string;
  url?: string;
}

/** Validoi ja soveltaa komennot järjestyksessä. Kelvottomat komennot ohitetaan. */
export function applyCommands(m: Molecule, cl: ChecklistState, raw: unknown[], opts: ApplyOptions = {}): CommandResult {
  const source = opts.source ?? "coach";
  const prov = { note: opts.note, url: opts.url };
  let molecule = m;
  let checklist = cl;
  let openPanel: PanelId | null = null;
  let stress: StressInput | null = null;
  const applied: string[] = [];
  let rejected = 0;
  let structural = false;
  for (const r of raw.slice(0, 20)) {
    const c = validateCommand(r, molecule);
    if (!c) {
      rejected += 1;
      continue;
    }
    const before = molecule;
    const description = describeCommand(c, molecule);
    let silent = false;
    switch (c.type) {
      case "set_atom_field":
        molecule = withProvenance(setAtomField(molecule, c.atomId, c.field, c.value), [provKey(c.atomId, c.field)], source, prov);
        break;
      case "scale_atom_field": {
        const atom = molecule.atoms.find((a) => a.id === c.atomId) as unknown as Record<string, unknown> | undefined;
        const cur = atom?.[c.field];
        if (typeof cur === "number") {
          const next = c.field === "people" ? Math.max(1, Math.round(cur * c.factor)) : cur * c.factor;
          molecule = withProvenance(setAtomField(molecule, c.atomId, c.field, next), [provKey(c.atomId, c.field)], source, prov);
        }
        break;
      }
      case "set_credit":
        molecule = withProvenance({ ...molecule, credit: { ...molecule.credit, [c.field]: c.value } }, [provKey("credit", c.field)], source, prov);
        structural = true;
        break;
      case "add_atom": {
        molecule = addAtom(molecule, c.kind, c.label);
        const added = molecule.atoms[molecule.atoms.length - 1];
        const keys: string[] = [];
        for (const [k, v] of Object.entries(c.params ?? {})) {
          molecule = setAtomField(molecule, added.id, k, v);
          keys.push(provKey(added.id, k));
        }
        molecule = withProvenance(molecule, keys, source, prov);
        structural = true;
        break;
      }
      case "remove_atom":
        molecule = pruneProvenance(removeAtom(molecule, c.atomId));
        structural = true;
        break;
      case "add_fixed_cost":
        molecule = addFixedCost(molecule, {
          label: c.label,
          amountPerMonth: c.amountPerMonth,
          dayOfMonth: c.dayOfMonth,
          category: c.category,
          source: source === "import" ? "import" : source === "launchpad" ? "launchpad" : "coach",
        });
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
        silent = true;
        break;
      case "stress":
        stress = c.stress;
        openPanel = "cash";
        silent = true;
        break;
      case "set_name":
        molecule = renameMolecule(molecule, c.name);
        break;
      case "add_event":
        molecule = { ...molecule, events: [...(molecule.events ?? []), { id: newId("ev"), ...c.event }] };
        break;
      case "remove_event":
        molecule = { ...molecule, events: (molecule.events ?? []).filter((e) => e.id !== c.id) };
        break;
      case "set_seasonality":
        molecule = { ...molecule, seasonality: [...c.factors] };
        break;
      case "set_start_month":
        molecule = { ...molecule, startMonth: c.month };
        break;
      case "set_founder": {
        const f = molecule.founder ?? { weeklyHours: 40, livingCostsPerMonth: 1800 };
        molecule = {
          ...molecule,
          founder: { weeklyHours: c.weeklyHours ?? f.weeklyHours, livingCostsPerMonth: c.livingCostsPerMonth ?? f.livingCostsPerMonth },
        };
        break;
      }
    }
    if (silent) continue;
    if (molecule === before && c.type !== "checklist") continue;
    applied.push(description);
  }
  return { molecule, checklist, openPanel, stress, applied, rejected, structural };
}

/**
 * Muuntaa vanhan `FlowCommand`-komennon vastaaviksi `GraphCommand`-operaatioiksi
 * `EnterpriseGraph`-metagraafin päällä (TSD 4.3 & 8).
 */
export function flowCommandToGraphCommands(
  cmd: FlowCommand,
  graph: EnterpriseGraph,
  provenance: Provenance = { source: "coach" },
): GraphCommand[] {
  const sanitize = (s: string) => s.replace(/[^A-Za-z0-9_-]/g, "_");
  switch (cmd.type) {
    case "set_atom_field": {
      const fUri = `apex://factor/${sanitize(cmd.atomId)}_${sanitize(cmd.field)}` as EntityURI;
      return [{ type: "set_factor", uri: fUri, value: cmd.value ?? -1, provenance }];
    }
    case "scale_atom_field": {
      const fUri = `apex://factor/${sanitize(cmd.atomId)}_${sanitize(cmd.field)}` as EntityURI;
      const cur = graph.factors[fUri]?.value ?? 100;
      const next = cmd.field === "people" ? Math.max(1, Math.round(cur * cmd.factor)) : cur * cmd.factor;
      return [{ type: "set_factor", uri: fUri, value: next, provenance }];
    }
    case "set_credit": {
      if (cmd.field === "openingCash") {
        const fUri = "apex://factor/credit_openingCash" as EntityURI;
        return [{ type: "set_factor", uri: fUri, value: cmd.value, provenance }];
      }
      const fUri = `apex://factor/credit_${cmd.field}` as EntityURI;
      return [{ type: "set_factor", uri: fUri, value: cmd.value, provenance }];
    }
    case "add_atom": {
      const id = newId("atom");
      const nodeUri = `apex://node/${id}` as EntityURI;
      const atomMap: Record<AtomKind, "time_capacity" | "physical_matter" | "recurring_subscription" | "transactional_trade"> = {
        TIME_CAPACITY: "time_capacity",
        PHYSICAL_MATTER: "physical_matter",
        RECURRING_SUB: "recurring_subscription",
        TRANSACTIONAL_TRADE: "transactional_trade",
      };
      const newNode: UniversalEnterpriseNode = {
        uri: nodeUri,
        name: cmd.label ?? t(ATOM_KIND_LABELS[cmd.kind].title),
        apqcCategory: 3.0,
        level: 1,
        band: "value_stream",
        tags: [`atom:${cmd.kind}`],
        parent: graph.root,
        children: [],
        definition: "defined",
        ports: [
          { id: "in", name: "Input", side: "I", unit: "apex://unit/items", ratio: { const: 1 } },
          { id: "out", name: "Output", side: "O", unit: "apex://unit/items", ratio: { const: 1 }, role: "primary" },
        ],
        physics: [
          {
            atom: atomMap[cmd.kind],
            params: {
              capacityPerTick: { const: 20 },
              cycleTicks: { const: 1 },
              firstPassYield: { const: 1 },
              unitPrice: { const: cmd.params?.hourlyRate ?? cmd.params?.unitPrice ?? cmd.params?.pricePerMonth ?? cmd.params?.averageTicket ?? 100 },
              variableCost: { const: 25 },
              fixedCostPerTick: { const: 10 },
            },
          },
        ],
        mechanisms: [],
        ledgerBindings: [],
        kpis: [],
      };
      return [{ type: "add_node", node: newNode }];
    }
    case "remove_atom": {
      const nUri = `apex://node/${sanitize(cmd.atomId)}` as EntityURI;
      return graph.nodes[nUri] ? [{ type: "remove_node", uri: nUri }] : [];
    }
    case "add_fixed_cost": {
      const id = newId("fc");
      const fUri = `apex://factor/fc_${id}_amountPerMonth` as EntityURI;
      return [{ type: "set_factor", uri: fUri, value: cmd.amountPerMonth, provenance }];
    }
    case "add_event": {
      return [
        {
          type: "add_event",
          event: {
            id: newId("ev"),
            title: cmd.event.title,
            startTick: cmd.event.startMonth * 30,
            durationTicks: cmd.event.durationMonths * 30,
            volumeChange: cmd.event.volumeChange,
            priceChange: cmd.event.priceChange,
            variableCostChange: cmd.event.variableCostChange,
            fixedCostChange: cmd.event.fixedCostChange,
            oneOffCost: cmd.event.oneOffCost,
          },
        },
      ];
    }
    default:
      return [];
  }
}
