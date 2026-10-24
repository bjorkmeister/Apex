/**
 * APEX Studio — liikeidea omin sanoin, Fast-Track & 8-vaiheinen `UniversalGenesisSpec` (`src/flow/model/genesis.ts`).
 *
 * Toteuttaa TSD v3.2 luvun 4.1, 4.2, 4.4 ja 4.5 (Invariantti A2):
 * - Sääntöpohjainen Fast-Track-tulkki (`ideaToMolecule`, `ideaToGenesisSpec`, `statementToGenesisSpec`),
 *   joka luo täyden 8-vaiheisen `UniversalGenesisSpec`-rakenteen < 50 ms vasteajalla.
 * - Erottaa tiliotteesta tuodun datan (`provenance: "import"`) ja arvoiden pohjalta
 *   johdetut luvut (`provenance: "genesis"`).
 * - Sekä Fast-Track (`compileFastTrack`) että Architect Mode (`compileArchitectSpec`)
 *   kutsuvat samaa determinististä `compileGenesisSpec`-kääntäjää, jolloin sama syöte
 *   tuottaa aina identtisen `EnterpriseGraph`-rakenteen.
 */
import type {
  AtomKind,
  Molecule,
  PhysicalMatterAtom,
  ProvenanceSource,
  RecurringSubAtom,
  TimeCapacityAtom,
  TransactionalTradeAtom,
} from "../kernel/types.ts";
import { emptyMolecule, fixedCost } from "../kernel/presets.ts";
import { addAtom, setAtomField } from "./edit.ts";
import { parseIntent } from "./intent.ts";
import { applyCommands } from "./commands.ts";
import { emptyChecklist } from "./launchpad.ts";
import { SEASON_PROFILES, type SeasonProfileId } from "./seasons.ts";
import { withProvenance, provKey } from "./provenance.ts";
import type { StatementAnalysis } from "./importer.ts";
import {
  compileGenesisSpec,
  type GenesisCompilationResult,
  type GenesisOfferingSpec,
  type UniversalGenesisSpec,
} from "../graph/compiler.ts";
import type { AtomKind as GraphAtomKind, VentureMaturity } from "../graph/types.ts";
import { t } from "../i18n/index.ts";

const KIND_PATTERNS: Record<AtomKind, RegExp> = {
  TIME_CAPACITY:
    /konsult|suunnittel|koodaa|ohjelmoi|kirjanpit|lakimie|lakiasia|valmenta|parturi|kampaamo|hieroja|hieronta|siivo|remont|valokuva|kääntä|opetta|tutor|design|graafi|toimisto|freelanc|asiantunti|osaamis|tunti|consult|hairdress|barber|massage|cleaning|photograph|developer|agency|lawyer|accountant|coach|trainer|tutoring|renovat|translat|hourly/,
  PHYSICAL_MATTER:
    /verkkokaup|tuotte|tuote|käsityö|valmista|tukku|vaate|kosmetiik|koru|kirjoja myy|tavara|webshop|e-?commerce|online store|products?|handmade|manufactur|wholesale|clothing|cosmetics|jewel|merch/,
  RECURRING_SUB:
    /saas|ohjelmisto|sovellus|jäsen|kuukausimaks|kuukausitila|tilaus|abonnem|kuntosali|ylläpitosopim|retainer|software|subscription|membership|\bapp\b|gym|platform|alusta/,
  TRANSACTIONAL_TRADE:
    /kahvila|kioski|ravintola|grilli|nakki|jäätelö|ruokarek|food ?truck|myymälä|baari|pizzer|lounas|leipomo|lähikauppa|kivijalka|café|cafe|kiosk|restaurant|\bbar\b|\bshop\b|ice cream|bakery|street food|hot dog/,
};

const SEASON_PATTERNS: [SeasonProfileId, RegExp][] = [
  ["summer", /jäätelö|terassi|kesä|ranta|mökki|matkailu|ice cream|summer|terrace|beach|tourism/],
  ["christmas", /joulu|lahja|christmas|gift/],
  ["winter", /hiihto|laskettelu|talvi|ski|winter|snow/],
];

export interface GenesisResult {
  molecule: Molecule;
  kinds: AtomKind[];
  notes: string[];
}

function nameFromIdea(idea: string): string {
  const clean = idea
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(minä |mä )?(haluan|aion|ajattelin|suunnittelen|meinaan)\s+/i, "")
    .replace(/^(perustaa|perustan|aloittaa|aloitan|avata|avaan|käynnistää)\s+/i, "")
    .replace(/^(i (want|plan|would like|'d like) to|i'm going to|let's)\s+/i, "")
    .replace(/^(start|open|launch|run|build)\s+(a|an|my)?\s*/i, "");
  const first = clean.split(/[.,!?;\n]/)[0].trim();
  const short = first.length > 40 ? `${first.slice(0, 38).trim()}…` : first;
  return short ? short.charAt(0).toUpperCase() + short.slice(1) : t("Oma yritys");
}

export function detectKinds(idea: string): AtomKind[] {
  const text = idea.toLowerCase();
  return (Object.keys(KIND_PATTERNS) as AtomKind[]).filter((k) => KIND_PATTERNS[k].test(text));
}

export function ideaToMolecule(idea: string): GenesisResult {
  const text = idea.toLowerCase();
  const notes: string[] = [];
  let kinds = detectKinds(idea);
  if (kinds.length === 0) {
    kinds = ["TIME_CAPACITY"];
    notes.push(t("En tunnistanut toimialaa, joten aloitin asiantuntijatyöstä. Lisää tai vaihda tulovirtoja Kysyntä-paneelissa."));
  }
  let m = emptyMolecule(nameFromIdea(idea));
  for (const k of kinds) m = addAtom(m, k);

  const time = m.atoms.find((a) => a.kind === "TIME_CAPACITY");
  const costs = [fixedCost(t("Kirjanpito"), 150, "admin", 5)];
  if (!time) costs.push(fixedCost(t("Oma palkka (nosto)"), 2500, "other", 15));
  if (kinds.includes("TRANSACTIONAL_TRADE")) costs.push(fixedCost(t("Toimitila tai paikkavuokra"), 900, "rent", 1));
  if (kinds.includes("PHYSICAL_MATTER")) costs.push(fixedCost(t("Varasto ja verkkokauppa-alusta"), 400, "rent", 1), fixedCost(t("Mainonta"), 500, "marketing", 1));
  if (kinds.includes("RECURRING_SUB")) costs.push(fixedCost(t("Pilvipalvelut"), 200, "software", 1), fixedCost(t("Markkinointi"), 800, "marketing", 1));
  if (time && kinds.length === 1) costs.push(fixedCost(t("Ohjelmistot ja laitteet"), 120, "software", 1));
  m = { ...m, fixedCosts: costs };

  // Rahat tulevat heti, jos laskutettavia virtoja ei ole.
  if (!m.atoms.some((a) => a.kind === "TIME_CAPACITY" || a.kind === "PHYSICAL_MATTER")) {
    m = { ...m, credit: { ...m.credit, customerTermsDays: 0 } };
  }
  if (time && /parturi|kampaamo|hieroja|hieronta|hairdress|barber|massage/.test(text)) {
    m = setAtomField(m, time.id, "paymentTermsDays", 1);
    notes.push(t("Palvelu maksetaan paikan päällä, joten maksuaika on 1 päivä."));
  }

  // Kausivaihtelu tekstin perusteella.
  for (const [profile, re] of SEASON_PATTERNS) {
    if (re.test(text)) {
      m = { ...m, seasonality: [...SEASON_PROFILES[profile].factors], startMonth: new Date().getMonth() };
      notes.push(t("Lisäsin kausivaihtelun: {profile}.", { profile: t(SEASON_PROFILES[profile].title) }));
      break;
    }
  }

  // Alkupääoma: "alkupääoma 10 000 €", "starting capital €10,000".
  const capital = /(alkupääom\w*|säästö\w*|pääom\w*|starting capital|savings|capital)[^0-9]{0,15}(\d[\d\s.,]*)\s*(k\b|t\b|tuhatta|thousand)?/.exec(text);
  if (capital) {
    let v = Number(capital[2].replace(/[\s.]/g, "").replace(",", "."));
    if (capital[3]) v *= 1000;
    if (Number.isFinite(v) && v > 0 && v < 1e8) {
      m = withProvenance({ ...m, credit: { ...m.credit, openingCash: v } }, [provKey("credit", "openingCash")], "genesis");
      notes.push(t("Alkukassa: {amount} €.", { amount: Math.round(v) }));
    }
  }

  // Hinnat ja maksuajat tekstistä samalla tulkilla kuin keskustelussa.
  const intent = parseIntent(idea, m).commands.filter((c) => c.type === "set_atom_field" || c.type === "scale_atom_field" || c.type === "set_credit");
  if (intent.length > 0) m = applyCommands(m, emptyChecklist(), intent, { source: "genesis" }).molecule;

  return { molecule: m, kinds, notes };
}

/**
 * Muuntaa `Molecule`-mallin 8-vaiheiseksi `UniversalGenesisSpec`-spesifikaatioksi.
 */
export function moleculeToGenesisSpec(
  molecule: Molecule,
  maturity: VentureMaturity = 3,
  provenance: ProvenanceSource = "genesis",
): UniversalGenesisSpec {
  const offerings: GenesisOfferingSpec[] = [];
  let totalPeople = 0;
  let avgMonthlySalary = 3400;

  for (const a of molecule.atoms) {
    if (!a.enabled) continue;
    let atomKind: GraphAtomKind = "time_capacity";
    let params: Record<string, number> = {};
    let outputUnitSlug = "items";

    switch (a.kind) {
      case "TIME_CAPACITY": {
        const tc = a as TimeCapacityAtom;
        atomKind = "time_capacity";
        outputUnitSlug = "hours";
        totalPeople += tc.people;
        avgMonthlySalary = tc.salaryPerPersonMonth || avgMonthlySalary;
        params = {
          people: tc.people,
          hoursPerWeek: tc.hoursPerWeek,
          utilization: tc.utilization,
          hourlyRate: tc.hourlyRate,
          demandHoursPerMonth: tc.demandHoursPerMonth === null ? -1 : tc.demandHoursPerMonth,
          salaryPerPersonMonth: tc.salaryPerPersonMonth,
          sideCostRate: tc.sideCostRate,
          variableCostPerHour: tc.variableCostPerHour,
        };
        break;
      }
      case "PHYSICAL_MATTER": {
        const pm = a as PhysicalMatterAtom;
        atomKind = "physical_matter";
        outputUnitSlug = "items";
        totalPeople += 1;
        params = {
          unitsPerMonth: pm.unitsPerMonth,
          unitPrice: pm.unitPrice,
          unitCost: pm.unitCost,
          spoilageRate: pm.spoilageRate,
          stockCoverDays: pm.stockCoverDays,
          capacityUnitsPerMonth: pm.capacityUnitsPerMonth === null ? -1 : pm.capacityUnitsPerMonth,
        };
        break;
      }
      case "RECURRING_SUB": {
        const rs = a as RecurringSubAtom;
        atomKind = "recurring_subscription";
        outputUnitSlug = "subscribers";
        totalPeople += 1;
        params = {
          startingSubscribers: rs.startingSubscribers,
          newPerMonth: rs.newPerMonth,
          churnRateMonthly: rs.churnRateMonthly,
          pricePerMonth: rs.pricePerMonth,
          costPerSubscriberMonth: rs.costPerSubscriberMonth,
          cacPerNew: rs.cacPerNew,
        };
        break;
      }
      case "TRANSACTIONAL_TRADE": {
        const tt = a as TransactionalTradeAtom;
        atomKind = "transactional_trade";
        outputUnitSlug = "transactions";
        totalPeople += 1;
        params = {
          visitorsPerDay: tt.visitorsPerDay,
          conversionRate: tt.conversionRate,
          averageTicket: tt.averageTicket,
          costPerSale: tt.costPerSale,
          openDaysPerMonth: tt.openDaysPerMonth,
          capacityPerDay: tt.capacityPerDay === null ? -1 : tt.capacityPerDay,
        };
        break;
      }
    }

    offerings.push({
      slug: a.id,
      name: a.label,
      atom: atomKind,
      outputUnitSlug,
      inputUnitSlug: outputUnitSlug,
      params,
      definition: "defined",
    });
  }

  const hasPhysical = molecule.atoms.some((a) => a.kind === "PHYSICAL_MATTER");
  const hasRecurring = molecule.atoms.some((a) => a.kind === "RECURRING_SUB");
  const capabilityTemplateId = hasPhysical
    ? "physical_product_brand"
    : hasRecurring
      ? "recurring_digital_service"
      : "expert_knowledge_service";

  return {
    step1Mission: {
      name: molecule.name,
      mission: t("Tuottaa mitattavaa asiakasarvoa ja kestävää kassavirtaa"),
    },
    step2Recipes: {
      offerings,
    },
    step3Market: {
      ...(molecule.seasonality && molecule.seasonality.length === 12
        ? { monthlyMultipliers: [...molecule.seasonality] }
        : {}),
    },
    step4Channels: {
      stages: [],
    },
    step5Sourcing: {
      enabled: hasPhysical,
      suppliers: [],
    },
    step6BusinessModel: {
      customerTermsDays: molecule.credit.customerTermsDays,
      supplierTermsDays: molecule.credit.supplierTermsDays,
      badDebtRate: molecule.credit.badDebtRate,
      fixedCosts: molecule.fixedCosts.map((fc) => ({
        slug: fc.id,
        name: fc.label,
        amountPerMonth: fc.amountPerMonth,
        category: fc.category,
      })),
    },
    step7Capabilities: {
      roles: [
        {
          slug: "core_delivery_team",
          name: t("Tuotanto- ja toimitustiimi"),
          fte: Math.max(1, totalPeople),
          monthlyCostPerFte: avgMonthlySalary,
          hoursPerFtePerTick: 7.5,
          proficiency: 0.92,
        },
      ],
      systems: [
        {
          slug: "core_workflow_platform",
          name: t("Toiminnanohjaus ja työnkulku"),
          layer: "workflow",
          fixedCostPerMonth: 180,
          availability: 0.995,
        },
        {
          slug: "financial_ledger_system",
          name: t("Laskutus- ja talousjärjestelmä"),
          layer: "record",
          fixedCostPerMonth: 120,
          availability: 0.999,
        },
      ],
      capabilityTemplateId,
    },
    step8Topology: {
      maturity,
      openingCash: molecule.credit.openingCash,
      horizonTicks: (molecule.horizonMonths || 12) * 30,
      tickResolution: "day",
      payrollDayOfMonth: molecule.payrollDay || 15,
      provenance,
    },
  };
}

/**
 * Fast-Track: muuntaa vapaan tekstikuvauksen 8-vaiheiseksi `UniversalGenesisSpec`-rakenteeksi (`provenance: "genesis"`).
 */
export function ideaToGenesisSpec(
  idea: string,
  maturity: VentureMaturity = 3,
): UniversalGenesisSpec {
  const { molecule } = ideaToMolecule(idea);
  return moleculeToGenesisSpec(molecule, maturity, "genesis");
}

/**
 * Fast-Track (Tiliote): muuntaa pankkitiliotteen analyysin 8-vaiheiseksi `UniversalGenesisSpec`-rakenteeksi
 * merkitsemällä tiliotteesta johdetut luvut `provenance: "import"`.
 */
export function statementToGenesisSpec(
  analysis: StatementAnalysis,
  name = t("Tuotu organisaatio"),
  maturity: VentureMaturity = 3,
): UniversalGenesisSpec {
  const avgIncome = Math.max(1000, Math.round(analysis.avgMonthlyIncome || 4000));
  const openingCash =
    analysis.lastBalance !== null && Number.isFinite(analysis.lastBalance)
      ? Math.max(0, Math.round(analysis.lastBalance))
      : 5000;

  return {
    step1Mission: {
      name,
      mission: t("Tiliotteesta kalibroitu toimintamalli"),
      targetMonthlyRevenue: avgIncome,
    },
    step2Recipes: {
      offerings: [
        {
          slug: "imported_primary_stream",
          name: t("Pääasiallinen myyntivirta (tiliote)"),
          atom: "transactional_trade",
          outputUnitSlug: "transactions",
          inputUnitSlug: "transactions",
          params: {
            visitorsPerDay: 20,
            conversionRate: 0.5,
            averageTicket: Math.max(10, Math.round(avgIncome / 300)),
            costPerSale: Math.max(2, Math.round((avgIncome / 300) * 0.25)),
            openDaysPerMonth: 30,
            capacityPerDay: -1,
          },
          definition: "defined",
        },
      ],
    },
    step3Market: {},
    step4Channels: { stages: [] },
    step5Sourcing: { enabled: false, suppliers: [] },
    step6BusinessModel: {
      customerTermsDays: 14,
      supplierTermsDays: 14,
      badDebtRate: 0,
      fixedCosts: analysis.recurring.map((rc, idx) => ({
        slug: `imp_fc_${idx + 1}`,
        name: rc.label,
        amountPerMonth: Math.round(rc.monthlyAmount),
        category: rc.category,
      })),
    },
    step7Capabilities: {
      roles: [
        {
          slug: "core_delivery_team",
          name: t("Tuotanto- ja toimitustiimi"),
          fte: 1,
          monthlyCostPerFte: 3200,
        },
      ],
      systems: [
        {
          slug: "financial_ledger_system",
          name: t("Laskutus- ja talousjärjestelmä"),
          layer: "record",
          fixedCostPerMonth: 120,
        },
      ],
      capabilityTemplateId: "expert_knowledge_service",
    },
    step8Topology: {
      maturity,
      openingCash,
      horizonTicks: 360,
      tickResolution: "day",
      payrollDayOfMonth: 15,
      provenance: "import",
    },
  };
}

/**
 * Fast-Track -käännös: luo `UniversalGenesisSpec`:n yhdestä lauseesta tai tilioteanalyysistä
 * ja kääntää sen deterministisesti `EnterpriseGraph`-rakenteeksi.
 */
export function compileFastTrack(input: {
  idea?: string;
  statement?: StatementAnalysis;
  name?: string;
  maturity?: VentureMaturity;
}): GenesisCompilationResult & { spec: UniversalGenesisSpec } {
  const maturity: VentureMaturity = input.maturity ?? 3;
  const spec = input.statement
    ? statementToGenesisSpec(input.statement, input.name ?? t("Tuotu organisaatio"), maturity)
    : ideaToGenesisSpec(input.idea ?? t("Uusi organisaatio"), maturity);
  const compiled = compileGenesisSpec(spec);
  return { ...compiled, spec };
}

/**
 * Architect Mode -käännös: ottaa suoraan 8-vaiheisen `UniversalGenesisSpec`-spesifikaation
 * ja kääntää sen täsmälleen samalla deterministisellä `compileGenesisSpec`-putkella (Invariantti A2).
 */
export function compileArchitectSpec(
  spec: UniversalGenesisSpec,
): GenesisCompilationResult & { spec: UniversalGenesisSpec } {
  const compiled = compileGenesisSpec(spec);
  return { ...compiled, spec };
}
