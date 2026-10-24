/**
 * APEX Flow — perustajan muistilista (`src/flow/model/launchpad.ts`).
 *
 * Muistilista ei ole irrallinen tehtävälista: kohdat, joilla on rahavaikutus,
 * muuttavat simulaatiota heti (esim. YEL lisää kuukausikulun, perustamismaksu
 * pienentää alkukassaa, 14 päivän maksuehto lyhentää maksuaikaputkea).
 * Jokainen vaikutus on peruttavissa: ruksin poisto palauttaa mallin ennalleen.
 *
 * Viranomaismaksut ja -prosentit ovat arvioita, ja ne on merkitty muokattaviksi.
 * Käyttäjää ohjataan tarkistamaan ajantasaiset luvut lähteestä.
 */
import type { Molecule } from "../kernel/types.ts";
import type { EnterpriseGraph, EntityURI, PortSide } from "../graph/types.ts";
import { analyzeGaps, type GapAnalysisReport, type GapItem } from "../graph/gaps.ts";
import { addFixedCost, removeFixedCost } from "./edit.ts";
import { withCustomerTerms } from "../kernel/sensitivity.ts";
import type { FlowView, NodeId } from "./view.ts";
import { msg, t } from "../i18n/index.ts";
import { provKey, withProvenance } from "./provenance.ts";

export type LaunchStep = 1 | 2 | 3 | 4 | 5;

export const STEP_TITLES: Record<LaunchStep, string> = {
  1: msg("Liikeidea"),
  2: msg("Hinnoittelu ja kannattavuus"),
  3: msg("Hallinto ja lakisääteiset asiat"),
  4: msg("Asiakkaat ja maksuehdot"),
  5: msg("Valmis käynnistykseen"),
};

export interface ParamDef {
  key: string;
  label: string;
  unit: string;
  default: number;
  step: number;
}

export interface ItemDef {
  id: string;
  step: LaunchStep;
  title: string;
  /** Miksi tämä on tärkeää, selkokielellä. */
  why: string;
  /** "manual" = käyttäjä ruksaa, "auto" = APEX tarkistaa mallista. */
  mode: "manual" | "auto";
  params?: ParamDef[];
  /** Lähde, josta ajantasainen tieto tarkistetaan. */
  source?: string;
  /** Avaa tämän paneelin, kun käyttäjä haluaa tehdä asian. */
  open?: NodeId;
  /** Näytetäänkö kohta tälle mallille. */
  relevant?: (m: Molecule, v: FlowView) => boolean;
}

export interface ItemState {
  checked: boolean;
  params?: Record<string, number>;
  /** Tallennettu tieto peruutusta varten (esim. aiempi maksuaika). */
  undo?: Record<string, number>;
  /** Tallennettu EnterpriseGraph-tila (JSON) tarkkaa kumoa-palautusta varten (Invariantti A2). */
  undoGraphJson?: string;
}

export interface ChecklistState {
  items: Record<string, ItemState>;
}

export const emptyChecklist = (): ChecklistState => ({ items: {} });

const invoiced = (m: Molecule) =>
  m.atoms.some((a) => a.enabled && (a.kind === "TIME_CAPACITY" || a.kind === "PHYSICAL_MATTER"));
const hasTimeAtom = (m: Molecule) => m.atoms.some((a) => a.enabled && a.kind === "TIME_CAPACITY");

/** Arvonlisäverovelvollisuuden alaraja (liikevaihto / tilikausi). Tarkista ajantasainen raja Verohallinnosta. */
export const VAT_THRESHOLD_EUR = 15000;

export const CHECKLIST: ItemDef[] = [
  {
    id: "idea",
    step: 1,
    title: msg("Kuvaa, mitä myyt ja kenelle"),
    why: msg("Kun tiedät, kuka maksaa ja mistä, tiedät myös mitä virtoja mallissa tarvitaan."),
    mode: "auto",
    open: "demand",
  },
  {
    id: "own-salary",
    step: 2,
    title: msg("Päätä oma palkkasi"),
    why: msg("Yritys, joka ei maksa tekijälleen palkkaa, ei ole vielä kannattava – se vain näyttää siltä."),
    mode: "auto",
    open: "costs",
  },
  {
    id: "break-even",
    step: 2,
    title: msg("Hinnoittele niin, että kannattavuusraja jää selvästi alle myynnin"),
    why: msg("Vähintään 20 %:n pelivara tarkoittaa, että yksi huono kuukausi ei kaada yritystä."),
    mode: "auto",
    open: "demand",
  },
  {
    id: "company-form",
    step: 3,
    title: msg("Valitse yritysmuoto ja tee perustamisilmoitus (Y-tunnus)"),
    why: msg("Toiminimi on nopein aloittaa, osakeyhtiö erottaa omat ja yrityksen rahat. Perustamismaksu maksetaan heti, joten se pienentää alkukassaa."),
    mode: "manual",
    params: [{ key: "fee", label: msg("Perustamismaksu"), unit: msg("€"), default: 75, step: 5 }],
    source: msg("PRH / YTJ: ajantasaiset käsittelymaksut (toiminimi ja osakeyhtiö eroavat)"),
  },
  {
    id: "yel",
    step: 3,
    title: msg("Ota yrittäjän eläkevakuutus (YEL)"),
    why: msg("YEL on pakollinen, kun työtulosi ylittää alarajan. Se on myös sosiaaliturvasi perusta: sairauspäiväraha ja eläke lasketaan YEL-työtulosta."),
    mode: "manual",
    params: [
      { key: "income", label: msg("YEL-työtulo"), unit: msg("€ / v"), default: 15000, step: 500 },
      { key: "rate", label: msg("Maksuprosentti"), unit: msg("%"), default: 24.4, step: 0.1 },
      { key: "discount", label: msg("Aloittavan alennus"), unit: msg("%"), default: 22, step: 1 },
    ],
    source: msg("Eläkeyhtiö tai Työeläke.fi: vuoden maksuprosentti ja alkavan yrittäjän alennus (48 kk)"),
  },
  {
    id: "accounting",
    step: 3,
    title: msg("Järjestä kirjanpito"),
    why: msg("Kirjanpito on lakisääteinen. Tilitoimisto maksaa, mutta säästää aikaa ja virheitä."),
    mode: "manual",
    params: [{ key: "amount", label: msg("Kirjanpito"), unit: msg("€ / kk"), default: 150, step: 10 }],
  },
  {
    id: "insurance",
    step: 3,
    title: msg("Hanki yritysvakuutukset"),
    why: msg("Vastuuvakuutus suojaa, jos työssäsi sattuu virhe. Monet asiakkaat vaativat sen."),
    mode: "manual",
    params: [{ key: "amount", label: msg("Vakuutukset"), unit: msg("€ / kk"), default: 40, step: 5 }],
  },
  {
    id: "vat",
    step: 3,
    title: msg("Selvitä arvonlisäverovelvollisuus"),
    why: msg("Jos liikevaihtosi ylittää {threshold} € tilikaudessa, rekisteröidy ALV-velvolliseksi. APEX laskee hinnat ilman arvonlisäveroa: muista lisätä vero asiakkaan hintaan."),
    mode: "manual",
    source: msg("Verohallinto: ALV-velvollisuuden alaraja ja ilmoitusaikataulu"),
  },
  {
    id: "bank",
    step: 3,
    title: msg("Avaa yritykselle oma pankkitili"),
    why: msg("Erillinen tili pitää yrityksen ja omat rahat erillään – ja kassan seuranta helpottuu."),
    mode: "manual",
  },
  {
    id: "terms",
    step: 4,
    title: msg("Sovi lyhyt maksuehto (14 pv)"),
    why: msg("Lyhyt maksuaika tuo rahat kassaan ennen kuin omat laskusi erääntyvät."),
    mode: "manual",
    relevant: (m) => invoiced(m),
    open: "receivables",
  },
  {
    id: "first-customers",
    step: 4,
    title: msg("Varmista ensimmäiset asiakkaat"),
    why: msg("Arvio kysynnästä muuttuu todeksi vasta, kun joku sitoutuu ostamaan. Syötä varmistettu kysyntä malliin."),
    mode: "auto",
    open: "demand",
  },
  {
    id: "buffer",
    step: 5,
    title: msg("Varmista kassapuskuri: kassa ei mene miinukselle"),
    why: msg("Kun kassa riittää koko vuoden ja pohjallakin on vähintään kuukauden kiinteät kulut, yritys kestää yllätyksiä."),
    mode: "auto",
    open: "cash",
  },
];

/** Molekyylissä on vähintään yksi kiinteä kulu tai palkka, joka kuvaa omaa palkkaa. */
function hasOwnSalary(m: Molecule): boolean {
  const time = m.atoms.some((a) => a.enabled && a.kind === "TIME_CAPACITY" && a.salaryPerPersonMonth > 0);
  const listed = m.fixedCosts.some((c) => /palkka|nosto|salary|draw/i.test(c.label) && c.amountPerMonth > 0);
  return time || listed;
}

/** Automaattisten kohtien tila suoraan mallista. */
export function autoCheck(id: string, m: Molecule, v: FlowView): boolean {
  switch (id) {
    case "idea":
      return m.atoms.some((a) => a.enabled) && m.name.trim().length > 0 && v.monthlyRevenue > 0;
    case "own-salary":
      return hasOwnSalary(m);
    case "break-even":
      return (v.be.marginOfSafety ?? -1) >= 0.2;
    case "first-customers":
      return v.econ.length > 0 && v.econ.every((e) => !e.demandAssumed);
    case "buffer":
      return v.sim.cashOutDay === null && v.sim.minCash >= v.monthlyFixed;
    default:
      return false;
  }
}

function paramsOf(def: ItemDef, st: ItemState | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of def.params ?? []) out[p.key] = st?.params?.[p.key] ?? p.default;
  return out;
}

/** YEL-kuukausimaksu: työtulo × maksuprosentti × (1 − alennus) / 12. */
export function yelMonthly(income: number, ratePct: number, discountPct: number): number {
  return (Math.max(0, income) * Math.max(0, ratePct) / 100 * (1 - Math.min(100, Math.max(0, discountPct)) / 100)) / 12;
}

/** Kohdan rahavaikutus kuvauksena (näytetään käyttäjälle ennen ruksausta). */
export function effectLabel(id: string, params: Record<string, number>): string | null {
  switch (id) {
    case "company-form":
      return t("alkukassa −{amount} €", { amount: Math.round(params.fee) });
    case "yel":
      return t("+{amount} € / kk kuluihin", { amount: Math.round(yelMonthly(params.income, params.rate, params.discount)) });
    case "accounting":
    case "insurance":
      return t("+{amount} € / kk kuluihin", { amount: Math.round(params.amount) });
    case "terms":
      return t("asiakkaan maksuaika 14 pv");
    default:
      return null;
  }
}

const fcId = (id: string) => `lp-${id}`;

function applyEffect(m: Molecule, id: string, params: Record<string, number>, prev: ItemState | undefined): { m: Molecule; undo?: Record<string, number> } {
  switch (id) {
    case "company-form": {
      const fee = Math.max(0, params.fee);
      const already = prev?.undo?.fee ?? 0;
      return { m: withProvenance({ ...m, credit: { ...m.credit, openingCash: m.credit.openingCash + already - fee } }, [provKey("credit", "openingCash")], "launchpad"), undo: { fee } };
    }
    case "yel":
      return {
        m: addFixedCost(m, {
          id: fcId(id),
          label: t("YEL-vakuutus"),
          amountPerMonth: yelMonthly(params.income, params.rate, params.discount),
          category: "pension",
          dayOfMonth: 20,
          source: "launchpad",
        }),
      };
    case "accounting":
      return { m: addFixedCost(m, { id: fcId(id), label: t("Kirjanpito"), amountPerMonth: params.amount, category: "admin", dayOfMonth: 5, source: "launchpad" }) };
    case "insurance":
      return { m: addFixedCost(m, { id: fcId(id), label: t("Yritysvakuutukset"), amountPerMonth: params.amount, category: "insurance", dayOfMonth: 1, source: "launchpad" }) };
    case "terms": {
      const previous = prev?.undo?.terms ?? m.credit.customerTermsDays;
      return { m: withProvenance(withCustomerTerms(m, Math.min(14, previous)), [provKey("credit", "customerTermsDays")], "launchpad"), undo: { terms: previous } };
    }
    default:
      return { m };
  }
}

function revertEffect(m: Molecule, id: string, st: ItemState | undefined): Molecule {
  switch (id) {
    case "company-form":
      return { ...m, credit: { ...m.credit, openingCash: m.credit.openingCash + (st?.undo?.fee ?? 0) } };
    case "yel":
    case "accounting":
    case "insurance":
      return removeFixedCost(m, fcId(id));
    case "terms":
      return st?.undo?.terms !== undefined ? withCustomerTerms(m, st.undo.terms) : m;
    default:
      return m;
  }
}

export interface ChecklistUpdate {
  molecule: Molecule;
  checklist: ChecklistState;
}

/** Ruksaa tai poistaa ruksin. Rahavaikutteiset kohdat muuttavat mallia. */
export function toggleItem(m: Molecule, cl: ChecklistState, id: string, checked: boolean): ChecklistUpdate {
  const def = CHECKLIST.find((d) => d.id === id);
  if (!def || def.mode !== "manual") return { molecule: m, checklist: cl };
  const prev = cl.items[id];
  if (!!prev?.checked === checked) return { molecule: m, checklist: cl };
  if (checked) {
    const { m: next, undo } = applyEffect(m, id, paramsOf(def, prev), undefined);
    return { molecule: next, checklist: { items: { ...cl.items, [id]: { ...prev, checked: true, undo } } } };
  }
  const reverted = revertEffect(m, id, prev);
  return { molecule: reverted, checklist: { items: { ...cl.items, [id]: { ...prev, checked: false, undo: undefined } } } };
}

/** Muuttaa kohdan parametria (esim. YEL-työtuloa). Jos kohta on ruksattu, vaikutus päivitetään heti. */
export function setItemParam(m: Molecule, cl: ChecklistState, id: string, key: string, value: number): ChecklistUpdate {
  const def = CHECKLIST.find((d) => d.id === id);
  if (!def || !def.params?.some((p) => p.key === key) || !Number.isFinite(value)) return { molecule: m, checklist: cl };
  const prev = cl.items[id] ?? { checked: false };
  const nextState: ItemState = { ...prev, params: { ...prev.params, [key]: value } };
  if (!prev.checked) return { molecule: m, checklist: { items: { ...cl.items, [id]: nextState } } };
  const { m: next, undo } = applyEffect(m, id, paramsOf(def, nextState), prev);
  return { molecule: next, checklist: { items: { ...cl.items, [id]: { ...nextState, undo: undo ?? prev.undo } } } };
}

export type ItemStatus = "done" | "todo" | "attention";

export interface ItemView {
  def: ItemDef;
  status: ItemStatus;
  checked: boolean;
  params: Record<string, number>;
  effect: string | null;
  /** Lisähuomio, esim. "liikevaihtosi ylittää ALV-rajan". */
  note: string | null;
}

export interface ChecklistView {
  items: ItemView[];
  done: number;
  total: number;
  /** Ensimmäinen tekemätön kohta: valmentaja ehdottaa tätä seuraavaksi. */
  next: ItemView | null;
}

export function checklistView(m: Molecule, v: FlowView, cl: ChecklistState): ChecklistView {
  const items: ItemView[] = [];
  for (const def of CHECKLIST) {
    if (def.relevant && !def.relevant(m, v)) continue;
    const st = cl.items[def.id];
    const params = paramsOf(def, st);
    const checked = def.mode === "auto" ? autoCheck(def.id, m, v) : !!st?.checked;
    let note: string | null = null;
    let status: ItemStatus = checked ? "done" : "todo";
    if (def.id === "vat" && v.monthlyRevenue * 12 > VAT_THRESHOLD_EUR) {
      note = t("Mallisi vuosimyynti on noin {amount} € – ALV-rekisteröinti on todennäköisesti pakollinen.", { amount: Math.round(v.monthlyRevenue * 12) });
      if (!checked) status = "attention";
    }
    if (def.id === "own-salary" && !checked && !hasTimeAtom(m)) {
      note = t("Lisää kuluihin kiinteä kulu nimeltä \"Oma palkka\".");
    }
    if (def.id === "buffer" && !checked && v.sim.cashOutDay !== null) {
      note = t("Kassa loppuu nyt päivänä {day}.", { day: v.sim.cashOutDay + 1 });
      status = "attention";
    }
    items.push({ def, status, checked, params, effect: def.mode === "manual" ? effectLabel(def.id, params) : null, note });
  }
  const done = items.filter((i) => i.status === "done").length;
  return { items, done, total: items.length, next: items.find((i) => i.status !== "done") ?? null };
}

// ===========================================================================
// v3.2 On-Canvas Graph Launchpad & Maturity 0–1 Gap Integration (Invariantti A2)
// ===========================================================================

export interface LaunchpadBindingTarget {
  id: string;
  targetUri: EntityURI;
  portSide: PortSide;
  mutationKind:
    | "factor_value"
    | "opening_cash"
    | "stream_latency"
    | "mechanism_binding"
    | "business_capability";
  description: string;
}

export interface GraphChecklistUpdate {
  graph: EnterpriseGraph;
  checklist: ChecklistState;
  binding: LaunchpadBindingTarget | null;
  elapsedMs: number;
}

export interface GraphLaunchpadView {
  maturity: 0 | 1 | 2 | 3;
  mode: "gap_driven" | "graph_bindings";
  gapReport: GapAnalysisReport;
  gapItems: (GapItem & { checked: boolean })[];
  bindings: Record<string, LaunchpadBindingTarget>;
}

/**
 * Palauttaa jokaiselle Launchpad-kohdalle sen kohdesolmun/entiteetin ja ICOM-porttikytkennän
 * (`LaunchpadBindingTarget`, TSD 4.5).
 */
export function resolveGraphBindings(graph: EnterpriseGraph): Record<string, LaunchpadBindingTarget> {
  const valueNode =
    Object.values(graph.nodes).find((n) => n.level === 1 && n.band === "value_stream") ??
    graph.nodes[graph.root]!;
  const enablingNode =
    Object.values(graph.nodes).find((n) => n.level === 1 && n.band === "enabling") ??
    valueNode;
  const roleUri =
    (Object.keys(graph.capabilities).find((u) => graph.capabilities[u]?.kind === "role") as EntityURI | undefined) ??
    valueNode.uri;

  return {
    "company-form": {
      id: "company-form",
      targetUri: graph.root,
      portSide: "C",
      mutationKind: "opening_cash",
      description: t("C-portti (Y-tunnus) · Alkukassa −75 €"),
    },
    yel: {
      id: "yel",
      targetUri: roleUri,
      portSide: "M",
      mutationKind: "factor_value",
      description: t("M-portti (Roolikulu) · YEL-eläkevakuutuskerroin"),
    },
    accounting: {
      id: "accounting",
      targetUri: enablingNode.uri,
      portSide: "C",
      mutationKind: "factor_value",
      description: t("C-portti (Taloushallinto) · Kirjanpitokerroin"),
    },
    insurance: {
      id: "insurance",
      targetUri: enablingNode.uri,
      portSide: "C",
      mutationKind: "factor_value",
      description: t("C-portti (Riskienhallinta) · Vakuutuskerroin"),
    },
    terms: {
      id: "terms",
      targetUri: valueNode.uri,
      portSide: "C",
      mutationKind: "stream_latency",
      description: t("C-portti (Maksuehto 14 pv) · Myyntisaamisten viive"),
    },
    "workflow-tool": {
      id: "workflow-tool",
      targetUri: valueNode.uri,
      portSide: "M",
      mutationKind: "mechanism_binding",
      description: t("M-portti (Järjestelmäkytkentä) · Läpimenokerroin +15 %"),
    },
  };
}

/**
 * Muodostaa kypsyystasosta riippuvan Launchpad-näkymän:
 * - Tasoilla 0–1 tehtävät johdetaan suoraan `analyzeGaps(graph)`-aukkoanalyysistä (`mode: "gap_driven"`).
 * - Tasoilla 2–3 tehtävät toimivat suorina ICOM-portti- ja kerroinkytkentöinä (`mode: "graph_bindings"`).
 */
export function buildGraphLaunchpadView(
  graph: EnterpriseGraph,
  cl: ChecklistState,
): GraphLaunchpadView {
  const maturity = graph.maturity ?? 3;
  const gapReport = analyzeGaps(graph);
  const gapItems = gapReport.gaps.map((g) => ({
    ...g,
    checked: !!cl.items[`gap:${g.uri}`]?.checked || graph.businessCapabilities?.[g.uri]?.status === "known",
  }));
  return {
    maturity,
    mode: maturity <= 1 ? "gap_driven" : "graph_bindings",
    gapReport,
    gapItems,
    bindings: resolveGraphBindings(graph),
  };
}

/**
 * Suorittaa kumottavan, paikallisen (< 16 ms) `EnterpriseGraph`-kytkennän Launchpad-rastista (Invariantti A2).
 * Kun rasti poistetaan (`checked = false`), graafi palautuu täsmälleen ruksaa edeltäneeseen tilaan.
 */
export function toggleGraphLaunchpadItem(
  graph: EnterpriseGraph,
  cl: ChecklistState,
  id: string,
  checked: boolean,
): GraphChecklistUpdate {
  const t0 = performance.now();
  const prev = cl.items[id];
  if (!!prev?.checked === checked) {
    return { graph, checklist: cl, binding: null, elapsedMs: performance.now() - t0 };
  }

  // Palautus (unchecked / undo): palautetaan täsmälleen tallennettu graafitila
  if (!checked) {
    const restored: EnterpriseGraph = prev?.undoGraphJson
      ? (JSON.parse(prev.undoGraphJson) as EnterpriseGraph)
      : (JSON.parse(JSON.stringify(graph)) as EnterpriseGraph);
    return {
      graph: restored,
      checklist: {
        items: {
          ...cl.items,
          [id]: { ...prev, checked: false, undoGraphJson: undefined },
        },
      },
      binding: null,
      elapsedMs: performance.now() - t0,
    };
  }

  const undoGraphJson = JSON.stringify(graph);
  const nextGraph = JSON.parse(undoGraphJson) as EnterpriseGraph;
  const bindings = resolveGraphBindings(nextGraph);

  // 1. Kypsyystasojen 0–1 aukkoanalyysirasti (`gap:apex://capability-biz/...`)
  if (id.startsWith("gap:")) {
    const capUri = id.slice(4) as EntityURI;
    if (nextGraph.businessCapabilities?.[capUri]) {
      nextGraph.businessCapabilities[capUri]!.status = "known";
      nextGraph.businessCapabilities[capUri]!.provenance = "user";
    }
    const binding: LaunchpadBindingTarget = {
      id,
      targetUri: capUri,
      portSide: "C",
      mutationKind: "business_capability",
      description: t("Kyvykkyys kuitattu kuntoon (status = known)"),
    };
    return {
      graph: nextGraph,
      checklist: {
        items: {
          ...cl.items,
          [id]: { ...prev, checked: true, undoGraphJson },
        },
      },
      binding,
      elapsedMs: performance.now() - t0,
    };
  }

  // 2. Kypsyystasojen 2–3 ICOM-portti-, kerroin- ja mekanismikytkennät
  const def = CHECKLIST.find((d) => d.id === id);
  const params = def ? paramsOf(def, prev) : {};
  const binding = bindings[id] ?? null;

  switch (id) {
    case "company-form": {
      const fee = Math.max(0, params.fee ?? 75);
      nextGraph.opening.cash -= fee;
      const rootNode = nextGraph.nodes[nextGraph.root];
      if (rootNode && !rootNode.ports.some((p) => p.id === "lp_ctrl_company_form")) {
        rootNode.ports.push({
          id: "lp_ctrl_company_form",
          name: t("Y-tunnus ja rekisteröinti"),
          side: "C",
          unit: "apex://unit/monetary",
          ratio: { const: 1 },
        });
      }
      break;
    }
    case "yel": {
      const monthly = yelMonthly(params.income ?? 15000, params.rate ?? 24.4, params.discount ?? 22);
      const daily = monthly / 30;
      const factorUri: EntityURI = "apex://factor/lp_yel_daily";
      nextGraph.factors[factorUri] = {
        uri: factorUri,
        name: t("YEL-vakuutus / pv"),
        alias: "launchpad.yelDaily",
        kind: "lever",
        value: daily,
        unit: "EUR/d",
        provenance: { source: "launchpad" },
      };
      const roleEntry = Object.values(nextGraph.capabilities).find((c) => c.kind === "role");
      if (roleEntry && roleEntry.kind === "role") {
        const baseVal =
          "const" in roleEntry.costPerFtePerTick
            ? roleEntry.costPerFtePerTick.const
            : (nextGraph.factors[roleEntry.costPerFtePerTick.factor]?.value ?? 100);
        if ("factor" in roleEntry.costPerFtePerTick && nextGraph.factors[roleEntry.costPerFtePerTick.factor]) {
          nextGraph.factors[roleEntry.costPerFtePerTick.factor]!.value = baseVal + daily;
          nextGraph.factors[roleEntry.costPerFtePerTick.factor]!.provenance = { source: "launchpad" };
        } else {
          roleEntry.costPerFtePerTick = { const: baseVal + daily };
        }
      }
      break;
    }
    case "accounting":
    case "insurance": {
      const monthly = params.amount ?? (id === "accounting" ? 150 : 40);
      const daily = monthly / 30;
      const factorUri: EntityURI = `apex://factor/lp_${id}_daily`;
      nextGraph.factors[factorUri] = {
        uri: factorUri,
        name: id === "accounting" ? t("Kirjanpito / pv") : t("Yritysvakuutukset / pv"),
        alias: `launchpad.${id}Daily`,
        kind: "lever",
        value: daily,
        unit: "EUR/d",
        provenance: { source: "launchpad" },
      };
      const targetNode =
        Object.values(nextGraph.nodes).find((n) => n.level === 1 && n.band === "enabling") ??
        Object.values(nextGraph.nodes).find((n) => n.level === 1) ??
        nextGraph.nodes[nextGraph.root];
      if (targetNode) {
        targetNode.ports.push({
          id: `lp_ctrl_${id}`,
          name: id === "accounting" ? t("Lakisääteinen kirjanpito") : t("Vastuuvakuutussuoja"),
          side: "C",
          unit: "apex://unit/monetary",
          ratio: { factor: factorUri },
        });
        if (targetNode.physics && targetNode.physics.length > 0) {
          targetNode.physics.push({
            atom: "time_capacity",
            params: {
              capacityPerTick: { const: 1_000_000 },
              cycleTicks: { const: 0 },
              firstPassYield: { const: 1 },
              variableCost: { const: 0 },
              fixedCostPerTick: { factor: factorUri },
            },
          });
        }
      }
      break;
    }
    case "terms": {
      for (const f of Object.values(nextGraph.factors)) {
        if (f.uri.includes("customerTermsDays") || f.uri.includes("paymentTermsDays")) {
          f.value = Math.min(14, f.value);
          f.provenance = { source: "launchpad" };
        }
      }
      for (const s of Object.values(nextGraph.streams)) {
        s.latencyTicks = { const: 14 };
      }
      const valNode = Object.values(nextGraph.nodes).find((n) => n.level === 1 && n.band === "value_stream");
      if (valNode && !valNode.ports.some((p) => p.id === "lp_ctrl_terms_14d")) {
        valNode.ports.push({
          id: "lp_ctrl_terms_14d",
          name: t("Maksuehto 14 pv"),
          side: "C",
          unit: "apex://unit/monetary",
          ratio: { const: 14 },
        });
      }
      break;
    }
    case "workflow-tool": {
      const sysUri: EntityURI = "apex://system/lp_workflow_automation";
      nextGraph.capabilities[sysUri] = {
        kind: "system",
        uri: sysUri,
        name: t("Automaatio- ja työnkulkuohjelmisto"),
        layer: "workflow",
        fixedCostPerTick: { const: 3 },
        capex: { const: 0 },
        availability: { const: 0.999 },
      };
      const valNode = Object.values(nextGraph.nodes).find((n) => n.level === 1 && n.band === "value_stream");
      if (valNode) {
        valNode.mechanisms.push({
          capability: sysUri,
          capacityContribution: { const: 1_000_000 },
          modifiers: { throughput: { const: 1.15 } },
          critical: false,
          fallbackMultiplier: { const: 1 },
        });
        valNode.ports.push({
          id: "lp_mech_workflow",
          name: t("Työnkulkuautomaatio (+15 %)"),
          side: "M",
          unit: "apex://unit/hours",
          ratio: { const: 1.15 },
        });
      }
      break;
    }
  }

  return {
    graph: nextGraph,
    checklist: {
      items: {
        ...cl.items,
        [id]: { ...prev, checked: true, undoGraphJson },
      },
    },
    binding,
    elapsedMs: performance.now() - t0,
  };
}

