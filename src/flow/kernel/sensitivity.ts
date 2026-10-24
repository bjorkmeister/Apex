/**
 * APEX Flow — herkkyys- ja kipurajamoottori (`src/flow/kernel/sensitivity.ts`).
 *
 * Periaate: moottori ei koskaan arvaa, miten asiakkaat reagoivat hintaan.
 * Se laskee täsmällisesti, kuinka paljon määrää saa menettää (tai pitää saada lisää),
 * jotta tulos pysyy ennallaan. Arvion siitä, onko se realistista, tekee käyttäjä.
 */
import type { AtomEconomics, Molecule, SimulationResult, TimeCapacityAtom } from "./types.ts";
import type { EnterpriseGraph, EntityURI } from "../graph/types.ts";
import { applyGraphCommand } from "../graph/commands.ts";
import { simulateGraph, type SimulationRun } from "../graph/simulate.ts";
import { moleculeEconomics, timeCapacityHours, totalFixedCostsPerMonth } from "./atoms.ts";
import { simulate } from "./simulate.ts";
import { applyStress, type StressInput } from "./stress.ts";

export { applyStress, combineStress, stressAtom, isNeutralStress, type StressInput } from "./stress.ts";

export interface PriceChangeTolerance {
  currentPrice: number;
  newPrice: number;
  unitVariableCost: number;
  currentUnitMargin: number;
  newUnitMargin: number;
  /** Uusi määrä / nykyinen määrä, jolla katetta jää euroina täsmälleen yhtä paljon. */
  breakEvenVolumeRatio: number | null;
  /** Hinnan nostossa: kuinka monta % määrästä voi menettää ennen kuin kate pienenee (0..1). */
  maxVolumeLoss: number | null;
  /** Hinnan laskussa: kuinka monta % lisää määrää tarvitaan, jotta kate pysyy ennallaan. */
  requiredVolumeGain: number | null;
  /** Tosi, jos uusi hinta ei kata edes muuttuvaa kulua: mikään määrä ei pelasta katetta. */
  impossible: boolean;
}

/**
 * Hinnanmuutoksen kipuraja.
 *
 * Kate ennen: (P − v) · Q. Kate jälkeen: (P' − v) · Q'.
 * Sama kate, kun Q' / Q = (P − v) / (P' − v).
 */
export function priceChangeTolerance(
  price: number,
  unitVariableCost: number,
  priceChangeRatio: number,
): PriceChangeTolerance {
  const newPrice = price * (1 + priceChangeRatio);
  const m0 = price - unitVariableCost;
  const m1 = newPrice - unitVariableCost;
  const base = {
    currentPrice: price,
    newPrice,
    unitVariableCost,
    currentUnitMargin: m0,
    newUnitMargin: m1,
  };
  if (m1 <= 0) {
    return { ...base, breakEvenVolumeRatio: null, maxVolumeLoss: null, requiredVolumeGain: null, impossible: true };
  }
  if (m0 <= 0) {
    // Nykyhinnalla jokainen myynti on tappiollinen: mikä tahansa myynti uudella hinnalla parantaa katetta.
    return { ...base, breakEvenVolumeRatio: 0, maxVolumeLoss: 1, requiredVolumeGain: null, impossible: false };
  }
  const ratio = m0 / m1;
  return {
    ...base,
    breakEvenVolumeRatio: ratio,
    maxVolumeLoss: ratio <= 1 ? 1 - ratio : null,
    requiredVolumeGain: ratio > 1 ? ratio - 1 : null,
    impossible: false,
  };
}

export function atomPriceTolerance(e: AtomEconomics, priceChangeRatio: number): PriceChangeTolerance {
  return priceChangeTolerance(e.unitPrice, e.unitVariableCost, priceChangeRatio);
}

export interface BreakEvenResult {
  fixedCostsPerMonth: number;
  revenuePerMonth: number;
  contributionPerMonth: number;
  /** Painotettu myyntikateprosentti nykyisellä myyntijakaumalla. */
  contributionMarginRatio: number;
  /** Liikevaihto, jolla kate kattaa kiinteät kulut. `null` jos kate ≤ 0. */
  breakEvenRevenuePerMonth: number | null;
  /** (Liikevaihto − kannattavuusraja) / liikevaihto. Negatiivinen = tappiolla. */
  marginOfSafety: number | null;
  /** Yksittäisen tuloatomin tapauksessa kannattavuusraja omassa yksikössään (h, kpl, ...). */
  breakEvenVolume: { volume: number; unit: string; atomId: string } | null;
  /** Mahtuuko kannattavuusrajan määrä kapasiteettiin (yksittäinen atomi). */
  breakEvenWithinCapacity: boolean | null;
}

/** Kuukausitason kannattavuusraja nykyisellä myyntijakaumalla. */
export function breakEven(molecule: Molecule): BreakEvenResult {
  const econ = moleculeEconomics(molecule);
  const fixed = totalFixedCostsPerMonth(molecule);
  const revenue = econ.reduce((s, e) => s + e.revenuePerMonth, 0);
  const contribution = econ.reduce((s, e) => s + e.contributionPerMonth, 0);
  const cmr = revenue > 0 ? contribution / revenue : 0;
  const beRevenue = cmr > 0 ? fixed / cmr : null;
  let beVolume: BreakEvenResult["breakEvenVolume"] = null;
  let withinCapacity: boolean | null = null;
  if (econ.length === 1) {
    const e = econ[0];
    const unitMargin = e.unitPrice - e.unitVariableCost;
    if (unitMargin > 0) {
      const v = fixed / unitMargin;
      beVolume = { volume: v, unit: e.volumeUnit, atomId: e.atomId };
      withinCapacity = e.capacity === null ? true : v <= e.capacity + 1e-9;
    }
  }
  return {
    fixedCostsPerMonth: fixed,
    revenuePerMonth: revenue,
    contributionPerMonth: contribution,
    contributionMarginRatio: cmr,
    breakEvenRevenuePerMonth: beRevenue,
    marginOfSafety: beRevenue !== null && revenue > 0 ? (revenue - beRevenue) / revenue : null,
    breakEvenVolume: beVolume,
    breakEvenWithinCapacity: withinCapacity,
  };
}

export interface HireBreakEven {
  monthlyCost: number;
  unitMargin: number;
  /** Laskutettavia lisätunteja kuukaudessa, jotta rekry maksaa itsensä. `null` jos tuntikate ≤ 0. */
  hoursNeededPerMonth: number | null;
  /** Uuden henkilön laskutettava kapasiteetti samalla laskutusasteella. */
  newPersonCapacityHours: number;
  /** Tarvittavat tunnit / uuden henkilön kapasiteetti. */
  shareOfNewCapacity: number | null;
}

/** Kuinka paljon lisää laskutusta yksi uusi henkilö vaatii, jotta hän maksaa itsensä. */
export function hireBreakEven(
  atom: TimeCapacityAtom,
  salaryPerMonth: number = atom.salaryPerPersonMonth,
  sideCostRate: number = atom.sideCostRate,
): HireBreakEven {
  const monthlyCost = Math.max(0, salaryPerMonth) * (1 + Math.max(0, sideCostRate));
  const unitMargin = atom.hourlyRate - atom.variableCostPerHour;
  const capacity = timeCapacityHours({ ...atom, people: 1 });
  const hours = unitMargin > 0 ? monthlyCost / unitMargin : null;
  return {
    monthlyCost,
    unitMargin,
    hoursNeededPerMonth: hours,
    newPersonCapacityHours: capacity,
    shareOfNewCapacity: hours !== null && capacity > 0 ? hours / capacity : null,
  };
}

/** Palauttaa molekyylin kopion, jossa asiakkaiden oletusmaksuaika ja laskutettavien atomien maksuaika on vaihdettu. */
export function withCustomerTerms(molecule: Molecule, days: number): Molecule {
  return {
    ...molecule,
    credit: { ...molecule.credit, customerTermsDays: days },
    atoms: molecule.atoms.map((a) =>
      a.kind === "TIME_CAPACITY" || a.kind === "PHYSICAL_MATTER" ? { ...a, paymentTermsDays: undefined } : a,
    ),
  };
}

export interface TermsScenario {
  customerTermsDays: number;
  minCash: number;
  minCashDay: number;
  cashOutDay: number | null;
  endCash: number;
}

/** Ajaa simulaation eri asiakasmaksuajoilla ja vertaa kassan pohjaa. */
export function customerTermsImpact(molecule: Molecule, options: number[] = [0, 14, 30, 45, 60]): TermsScenario[] {
  return options.map((days) => {
    const r = simulate(withCustomerTerms(molecule, days));
    return { customerTermsDays: days, minCash: r.minCash, minCashDay: r.minCashDay, cashOutDay: r.cashOutDay, endCash: r.endCash };
  });
}

export interface StressResult {
  input: StressInput;
  base: SimulationResult;
  stressed: SimulationResult;
}

export function stressTest(molecule: Molecule, s: StressInput): StressResult {
  return { input: s, base: simulate(molecule), stressed: simulate(applyStress(molecule, s)) };
}

// ---------------------------------------------------------------------------
// Vaihteluvälit (Monte Carlo): epävarmuuden antaa käyttäjä, sitä ei arvata.
// ---------------------------------------------------------------------------

/** Käyttäjän arvioima vaihteluväli kullekin tekijälle (±osuus, esim. 0.2 = ±20 %). */
export interface UncertaintyRanges {
  volume: number;
  price: number;
  variableCost: number;
  fixedCost: number;
}

export interface Percentiles {
  p10: number;
  p50: number;
  p90: number;
}

export interface MonteCarloResult {
  runs: number;
  ranges: UncertaintyRanges;
  endCash: Percentiles;
  minCash: Percentiles;
  totalProfit: Percentiles;
  /** Osuus ajoista, joissa kassa menee miinukselle tarkasteluaikana. */
  cashOutProbability: number;
  /** Osuus ajoista, joissa vuoden tulos on tappiollinen. */
  lossProbability: number;
}

/** Toistettava satunnaislukugeneraattori (mulberry32). */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function percentiles(values: number[]): Percentiles {
  const s = [...values].sort((x, y) => x - y);
  const at = (q: number) => s[Math.min(s.length - 1, Math.max(0, Math.round(q * (s.length - 1))))];
  return { p10: at(0.1), p50: at(0.5), p90: at(0.9) };
}

/**
 * Ajaa simulaation monta kertaa niin, että jokainen tekijä vaihtelee käyttäjän
 * antamalla välillä (kolmiojakauma: todennäköisimmin nykyarvo).
 */
export function monteCarlo(molecule: Molecule, ranges: UncertaintyRanges, runs = 300, seed = 1): MonteCarloResult {
  const rnd = seededRandom(seed);
  const tri = (r: number) => (rnd() + rnd() - 1) * Math.max(0, r);
  const end: number[] = [];
  const min: number[] = [];
  const profit: number[] = [];
  let cashOut = 0;
  let loss = 0;
  const n = Math.max(10, Math.min(2000, Math.round(runs)));
  for (let i = 0; i < n; i += 1) {
    const r = simulate(
      applyStress(molecule, {
        volumeChange: tri(ranges.volume),
        priceChange: tri(ranges.price),
        variableCostChange: tri(ranges.variableCost),
        fixedCostChange: tri(ranges.fixedCost),
      }),
    );
    end.push(r.endCash);
    min.push(r.minCash);
    profit.push(r.totals.operatingProfit);
    if (r.cashOutDay !== null) cashOut += 1;
    if (r.totals.operatingProfit < 0) loss += 1;
  }
  return {
    runs: n,
    ranges,
    endCash: percentiles(end),
    minCash: percentiles(min),
    totalProfit: percentiles(profit),
    cashOutProbability: cashOut / n,
    lossProbability: loss / n,
  };
}

// ---------------------------------------------------------------------------
// EnterpriseGraph-tason herkkyys-, kipuraja-, stressitesti- ja Monte Carlo -analyysi (TSD 7)
// ---------------------------------------------------------------------------

export interface GraphFactorTolerance {
  factorUri: EntityURI;
  currentValue: number;
  newValue: number;
  deltaRatio: number;
  baseProfit: number;
  newProfit: number;
  profitDelta: number;
  baseEndCash: number;
  newEndCash: number;
  cashDelta: number;
  /** Jos faktori on hinta tai katekomponentti, kuinka paljon volyymi saa muuttua jotta liikevoitto säilyy. */
  breakEvenVolumeRatio: number | null;
  maxVolumeLoss: number | null;
  requiredVolumeGain: number | null;
}

export interface GraphStressResult {
  factorDeltas: Record<EntityURI, number>;
  base: SimulationRun;
  stressed: SimulationRun;
  cashDelta: number;
  profitDelta: number;
}

export interface GraphMonteCarloResult {
  runs: number;
  factorRanges: Record<EntityURI, number>;
  endCash: Percentiles;
  minCash: Percentiles;
  totalProfit: Percentiles;
  cashOutProbability: number;
  lossProbability: number;
}

/** Muuttaa yksittäisen FactorNode-faktorin arvoa suhteellisesti (deltaRatio) ja synkronoi sen graafiin. */
export function perturbGraphFactor(graph: EnterpriseGraph, factorUri: EntityURI, deltaRatio: number): EnterpriseGraph {
  const factor = graph.factors[factorUri];
  if (!factor) return graph;
  const newValue = factor.value * (1 + deltaRatio);
  const next = applyGraphCommand(graph, { type: "set_factor", uri: factorUri, value: newValue });
  if (factorUri === "apex://factor/credit_openingCash") {
    next.opening = { ...next.opening, cash: newValue };
  }
  return next;
}

/** Yleinen kipurajalaskenta mille tahansa EnterpriseGraph-graafin FactorNode-faktorille (EntityURI). */
export function breakEvenTolerance(
  graph: EnterpriseGraph,
  factorUri: EntityURI,
  deltaRatio: number,
): GraphFactorTolerance {
  const factor = graph.factors[factorUri];
  const currentValue = factor?.value ?? 0;
  const newValue = currentValue * (1 + deltaRatio);
  const baseRun = simulateGraph(graph);
  const perturbedGraph = perturbGraphFactor(graph, factorUri, deltaRatio);
  const newRun = simulateGraph(perturbedGraph);

  const baseProfit = baseRun.totals.operatingProfit;
  const newProfit = newRun.totals.operatingProfit;
  const profitDelta = newProfit - baseProfit;
  const baseEndCash = baseRun.endCash;
  const newEndCash = newRun.endCash;
  const cashDelta = newEndCash - baseEndCash;

  const baseRev = baseRun.totals.revenue;
  const newRev = newRun.totals.revenue;
  let breakEvenVolumeRatio: number | null = null;
  let maxVolumeLoss: number | null = null;
  let requiredVolumeGain: number | null = null;

  if (baseRev > 0 && newRev > 0) {
    const baseContrib = baseRev - baseRun.totals.variableCosts;
    const newContrib = newRev - newRun.totals.variableCosts;
    if (baseContrib > 0 && newContrib > 0) {
      breakEvenVolumeRatio = baseContrib / newContrib;
      maxVolumeLoss = breakEvenVolumeRatio <= 1 ? 1 - breakEvenVolumeRatio : null;
      requiredVolumeGain = breakEvenVolumeRatio > 1 ? breakEvenVolumeRatio - 1 : null;
    }
  }

  return {
    factorUri,
    currentValue,
    newValue,
    deltaRatio,
    baseProfit,
    newProfit,
    profitDelta,
    baseEndCash,
    newEndCash,
    cashDelta,
    breakEvenVolumeRatio,
    maxVolumeLoss,
    requiredVolumeGain,
  };
}

export const graphFactorTolerance = breakEvenTolerance;

/** Ajaa stressitestin mielivaltaisille EnterpriseGraph-faktorimuutoksille (Record<EntityURI, number>). */
export function graphStressTest(
  graph: EnterpriseGraph,
  factorDeltas: Record<EntityURI, number>,
): GraphStressResult {
  const base = simulateGraph(graph);
  let stressedGraph = graph;
  for (const [uri, delta] of Object.entries(factorDeltas) as [EntityURI, number][]) {
    if (Number.isFinite(delta) && delta !== 0) {
      stressedGraph = perturbGraphFactor(stressedGraph, uri, delta);
    }
  }
  const stressed = simulateGraph(stressedGraph);
  return {
    factorDeltas,
    base,
    stressed,
    cashDelta: stressed.endCash - base.endCash,
    profitDelta: stressed.totals.operatingProfit - base.totals.operatingProfit,
  };
}

/** Ajaa Monte Carlo -simulaation mille tahansa EnterpriseGraph-graafin FactorNode-joukolle (Record<EntityURI, number>). */
export function graphMonteCarlo(
  graph: EnterpriseGraph,
  factorRanges: Record<EntityURI, number>,
  runs = 100,
  seed = 1,
): GraphMonteCarloResult {
  const rnd = seededRandom(seed);
  const tri = (r: number) => (rnd() + rnd() - 1) * Math.max(0, r);
  const end: number[] = [];
  const min: number[] = [];
  const profit: number[] = [];
  let cashOut = 0;
  let loss = 0;
  const n = Math.max(10, Math.min(1000, Math.round(runs)));
  const entries = Object.entries(factorRanges) as [EntityURI, number][];

  for (let i = 0; i < n; i += 1) {
    let g = graph;
    for (const [uri, range] of entries) {
      if (range > 0) {
        g = perturbGraphFactor(g, uri, tri(range));
      }
    }
    const r = simulateGraph(g);
    end.push(r.endCash);
    min.push(r.minCash);
    profit.push(r.totals.operatingProfit);
    if (r.cashOutDay !== null) cashOut += 1;
    if (r.totals.operatingProfit < 0) loss += 1;
  }

  return {
    runs: n,
    factorRanges,
    endCash: percentiles(end),
    minCash: percentiles(min),
    totalProfit: percentiles(profit),
    cashOutProbability: cashOut / n,
    lossProbability: loss / n,
  };
}
