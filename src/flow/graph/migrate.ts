/**
 * APEX Studio v3.2 — Molecule-to-Graph Migration (`src/flow/graph/migrate.ts`).
 *
 * Implements Override 1 (Invariant A1, TSD 6.3):
 * Converts legacy `Molecule` models into canonical `EnterpriseGraph` structures where:
 * - `UniversalEnterpriseNode` is the sole node type,
 * - Every enabled revenue atom and fixed-cost group is a leaf node with `PhysicsModule`s,
 * - All parameters are stored as `FactorNode` entities preserving `Provenance`,
 * - Zero industry-specific assumptions exist in the converter.
 */
import type {
  FixedCost,
  Molecule,
  PhysicalMatterAtom,
  Provenance,
  RecurringSubAtom,
  RevenueAtom,
  TimeCapacityAtom,
  TransactionalTradeAtom,
} from "../kernel/types.ts";
import { resolvePaymentTerms } from "../kernel/atoms.ts";
import type {
  EnterpriseGraph,
  EntityURI,
  FactorNode,
  FlowUnit,
  HierarchicalStreamEdge,
  PhysicsModule,
  Port,
  UniversalEnterpriseNode,
} from "./types.ts";
import { createDefaultAccounts } from "./ledger.ts";

const sanitizeId = (raw: string): string => raw.replace(/[^A-Za-z0-9_-]/g, "_");

function unitUriForAtomKind(kind: RevenueAtom["kind"]): EntityURI {
  switch (kind) {
    case "TIME_CAPACITY":
      return "apex://unit/hours";
    case "PHYSICAL_MATTER":
      return "apex://unit/items";
    case "RECURRING_SUB":
      return "apex://unit/subscribers";
    case "TRANSACTIONAL_TRADE":
      return "apex://unit/transactions";
  }
}

function createStandardUnits(): Record<string, FlowUnit> {
  const units: FlowUnit[] = [
    {
      uri: "apex://unit/monetary",
      name: "Monetary Value",
      nature: "monetary",
      measure: "EUR",
      decayPerTick: { const: 0 },
    },
    {
      uri: "apex://unit/hours",
      name: "Service Capacity Hours",
      nature: "capacity",
      measure: "h",
      decayPerTick: { const: 0 },
    },
    {
      uri: "apex://unit/items",
      name: "Physical Units",
      nature: "discrete",
      measure: "pcs",
      decayPerTick: { const: 0 },
    },
    {
      uri: "apex://unit/subscribers",
      name: "Active Subscriptions",
      nature: "agent",
      measure: "sub",
      decayPerTick: { const: 0 },
    },
    {
      uri: "apex://unit/transactions",
      name: "Completed Transactions",
      nature: "discrete",
      measure: "tx",
      decayPerTick: { const: 0 },
    },
  ];
  const out: Record<string, FlowUnit> = {};
  for (const u of units) out[u.uri] = u;
  return out;
}

/** Convert a v2 `Molecule` into a v3.2 `EnterpriseGraph`. */
export function migrateMoleculeToGraph(molecule: Molecule): EnterpriseGraph {
  const accounts = createDefaultAccounts();
  const units = createStandardUnits();
  const factors: Record<string, FactorNode> = {};
  const nodes: Record<string, UniversalEnterpriseNode> = {};
  const streams: Record<string, HierarchicalStreamEdge> = {};

  const provMap = molecule.provenance ?? {};
  const addFactor = (
    id: string,
    name: string,
    value: number,
    unit: string,
    alias?: string,
    provKey?: string,
    monthlyMultipliers?: number[],
  ): EntityURI => {
    const uri: EntityURI = `apex://factor/${sanitizeId(id)}`;
    const prov: Provenance | undefined = provKey ? provMap[provKey] : undefined;
    factors[uri] = {
      uri,
      name,
      alias,
      kind: "lever",
      value: Number.isFinite(value) ? value : 0,
      unit,
      ...(monthlyMultipliers ? { monthlyMultipliers: [...monthlyMultipliers] } : {}),
      ...(prov ? { provenance: prov } : {}),
    };
    return uri;
  };

  // Global credit & seasonality factors
  const custTermsUri = addFactor(
    "credit_customerTermsDays",
    "Customer Payment Terms",
    Math.max(0, Math.round(molecule.credit.customerTermsDays)),
    "d",
    "credit.customerTermsDays",
    "credit:customerTermsDays",
  );
  const suppTermsUri = addFactor(
    "credit_supplierTermsDays",
    "Supplier Payment Terms",
    Math.max(0, Math.round(molecule.credit.supplierTermsDays)),
    "d",
    "credit.supplierTermsDays",
    "credit:supplierTermsDays",
  );

  if (Array.isArray(molecule.seasonality) && molecule.seasonality.length === 12) {
    addFactor(
      "global_seasonality",
      "Seasonal Demand Profile",
      1,
      "ratio",
      "seasonality",
      undefined,
      molecule.seasonality,
    );
  }

  const rootUri: EntityURI = "apex://node/root";
  const childUris: EntityURI[] = [];

  for (const atom of molecule.atoms) {
    const safeId = sanitizeId(atom.id);
    const nodeUri: EntityURI = `apex://node/${safeId}`;
    childUris.push(nodeUri);

    const flowUnitUri = unitUriForAtomKind(atom.kind);
    const resolvedTerms = resolvePaymentTerms(atom, molecule);
    const atomTermsUri =
      typeof atom.paymentTermsDays === "number" && atom.paymentTermsDays >= 0
        ? addFactor(
            `${safeId}_paymentTermsDays`,
            `${atom.label} Payment Terms`,
            Math.round(atom.paymentTermsDays),
            "d",
            `${atom.id}.paymentTermsDays`,
            `${atom.id}:paymentTermsDays`,
          )
        : atom.kind === "TIME_CAPACITY" || atom.kind === "PHYSICAL_MATTER"
          ? custTermsUri
          : addFactor(
              `${safeId}_paymentTermsDays`,
              `${atom.label} Payment Terms`,
              resolvedTerms,
              "d",
              `${atom.id}.paymentTermsDays`,
            );

    const { revenueModule, priceFactorUri } = buildAtomPhysicsModule(atom, safeId, addFactor);
    const creditModule: PhysicsModule = {
      atom: "credit_working_capital",
      params: {
        customerTermsDays: { factor: atomTermsUri },
        supplierTermsDays: { factor: suppTermsUri },
      },
    };

    const ports: Port[] = [
      {
        id: "in",
        name: "Input Demand",
        side: "I",
        unit: flowUnitUri,
        ratio: { const: 1 },
      },
      {
        id: "out",
        name: "Delivered Output",
        side: "O",
        unit: flowUnitUri,
        ratio: { const: 1 },
        role: "primary",
      },
      {
        id: "revenue_posting",
        name: "Revenue Posting",
        side: "O",
        unit: "apex://unit/monetary",
        ratio: { factor: priceFactorUri },
        role: "posting",
      },
    ];

    nodes[nodeUri] = {
      uri: nodeUri,
      name: atom.label,
      level: 1,
      band: "value_stream",
      definition: atom.enabled ? "defined" : "named",
      tags: [`atomId:${atom.id}`, `atomKind:${atom.kind}`],
      parent: rootUri,
      children: [],
      ports,
      physics: [revenueModule, creditModule],
      mechanisms: [],
      ledgerBindings: [],
      kpis: [],
    };
  }

  // Fixed costs leaf node (also ensures empty molecules have at least one defined leaf node with PhysicsModule)
  const hasEnabledAtoms = molecule.atoms.some((a) => a.enabled);
  if (molecule.fixedCosts.length > 0 || !hasEnabledAtoms) {
    const fixedNodeUri: EntityURI = "apex://node/enabling_fixed_costs";
    childUris.push(fixedNodeUri);
    const fixedModules: PhysicsModule[] =
      molecule.fixedCosts.length > 0
        ? molecule.fixedCosts.map((fc: FixedCost) => {
            const safeFc = sanitizeId(fc.id);
            const amtUri = addFactor(
              `fc_${safeFc}_amount`,
              fc.label,
              fc.amountPerMonth,
              "EUR/mo",
              `fixed.${fc.id}.amountPerMonth`,
              `fixed:${fc.id}`,
            );
            const dayUri = addFactor(
              `fc_${safeFc}_day`,
              `${fc.label} Day`,
              fc.dayOfMonth,
              "d",
              `fixed.${fc.id}.dayOfMonth`,
            );
            return {
              atom: "credit_working_capital",
              params: {
                fixedCostPerMonth: { factor: amtUri },
                dayOfMonth: { factor: dayUri },
              },
            };
          })
        : [
            {
              atom: "credit_working_capital",
              params: {
                fixedCostPerMonth: { const: 0 },
                dayOfMonth: { const: 1 },
              },
            },
          ];

    nodes[fixedNodeUri] = {
      uri: fixedNodeUri,
      name: "Operating Overhead",
      level: 1,
      band: "enabling",
      definition: "defined",
      tags: ["fixed_costs"],
      parent: rootUri,
      children: [],
      ports: [
        {
          id: "cost_posting",
          name: "Fixed Cost Outflow",
          side: "O",
          unit: "apex://unit/monetary",
          ratio: { const: 1 },
          role: "posting",
        },
      ],
      physics: fixedModules,
      mechanisms: [],
      ledgerBindings: [],
      kpis: [],
    };
  }

  const firstChild = childUris[0];
  nodes[rootUri] = {
    uri: rootUri,
    name: molecule.name,
    level: 0,
    band: "value_stream",
    definition: childUris.length > 0 ? "defined" : "incomplete",
    tags: ["root"],
    parent: null,
    children: childUris,
    ports: firstChild
      ? [
          {
            id: "root_out",
            name: "Enterprise Output",
            side: "O",
            unit: "apex://unit/monetary",
            ratio: { const: 1 },
            role: "primary",
            delegatesTo: { node: firstChild, port: "revenue_posting" },
          },
        ]
      : [],
    mechanisms: [],
    ledgerBindings: [],
    kpis: [],
  };

  const horizonMonths = Math.max(1, Math.round(molecule.horizonMonths ?? 12));
  const events = (molecule.events ?? []).map((e) => ({
    id: e.id,
    title: e.title,
    libraryId: e.libraryId,
    startTick: Math.max(0, Math.round(e.startMonth)) * 30,
    durationTicks: Math.max(1, Math.round(e.durationMonths || 1)) * 30,
    volumeChange: e.volumeChange,
    priceChange: e.priceChange,
    variableCostChange: e.variableCostChange,
    fixedCostChange: e.fixedCostChange,
    oneOffCost: e.oneOffCost,
  }));

  return {
    version: 3,
    maturity: 3,
    id: molecule.id,
    name: molecule.name,
    root: rootUri,
    tick: {
      resolution: "day",
      horizon: horizonMonths * 30,
      startCalendarMonth: molecule.startMonth ?? 0,
      payrollDayOfMonth: Math.min(30, Math.max(1, Math.round(molecule.payrollDay || 15))),
    },
    currency: "EUR",
    nodes,
    streams,
    units,
    factors,
    capabilities: {},
    businessCapabilities: {},
    accounts,
    opening: {
      cash: Number.isFinite(molecule.credit.openingCash) ? molecule.credit.openingCash : 0,
      balances: {},
    },
    events,
  };
}

function buildAtomPhysicsModule(
  atom: RevenueAtom,
  safeId: string,
  addFactor: (
    id: string,
    name: string,
    value: number,
    unit: string,
    alias?: string,
    provKey?: string,
  ) => EntityURI,
): { revenueModule: PhysicsModule; priceFactorUri: EntityURI } {
  switch (atom.kind) {
    case "TIME_CAPACITY": {
      const a = atom as TimeCapacityAtom;
      const people = addFactor(`${safeId}_people`, "Team Size", a.people, "fte", `${a.id}.people`, `${a.id}:people`);
      const hoursPerWeek = addFactor(
        `${safeId}_hoursPerWeek`,
        "Hours Per Week",
        a.hoursPerWeek,
        "h/wk",
        `${a.id}.hoursPerWeek`,
        `${a.id}:hoursPerWeek`,
      );
      const utilization = addFactor(
        `${safeId}_utilization`,
        "Utilization",
        a.utilization,
        "ratio",
        `${a.id}.utilization`,
        `${a.id}:utilization`,
      );
      const hourlyRate = addFactor(
        `${safeId}_hourlyRate`,
        "Hourly Rate",
        a.hourlyRate,
        "EUR/h",
        `${a.id}.hourlyRate`,
        `${a.id}:hourlyRate`,
      );
      const demandHoursPerMonth = addFactor(
        `${safeId}_demandHoursPerMonth`,
        "Demand Hours Per Month",
        a.demandHoursPerMonth === null ? -1 : a.demandHoursPerMonth,
        "h/mo",
        `${a.id}.demandHoursPerMonth`,
        `${a.id}:demandHoursPerMonth`,
      );
      const salaryPerPersonMonth = addFactor(
        `${safeId}_salaryPerPersonMonth`,
        "Monthly Compensation Per Person",
        a.salaryPerPersonMonth,
        "EUR/mo",
        `${a.id}.salaryPerPersonMonth`,
        `${a.id}:salaryPerPersonMonth`,
      );
      const sideCostRate = addFactor(
        `${safeId}_sideCostRate`,
        "Employer Side Cost Rate",
        a.sideCostRate,
        "ratio",
        `${a.id}.sideCostRate`,
        `${a.id}:sideCostRate`,
      );
      const variableCostPerHour = addFactor(
        `${safeId}_variableCostPerHour`,
        "Variable Cost Per Hour",
        a.variableCostPerHour,
        "EUR/h",
        `${a.id}.variableCostPerHour`,
        `${a.id}:variableCostPerHour`,
      );
      return {
        priceFactorUri: hourlyRate,
        revenueModule: {
          atom: "time_capacity",
          params: {
            people: { factor: people },
            hoursPerWeek: { factor: hoursPerWeek },
            utilization: { factor: utilization },
            hourlyRate: { factor: hourlyRate },
            demandHoursPerMonth: { factor: demandHoursPerMonth },
            salaryPerPersonMonth: { factor: salaryPerPersonMonth },
            sideCostRate: { factor: sideCostRate },
            variableCostPerHour: { factor: variableCostPerHour },
          },
        },
      };
    }
    case "PHYSICAL_MATTER": {
      const a = atom as PhysicalMatterAtom;
      const unitsPerMonth = addFactor(
        `${safeId}_unitsPerMonth`,
        "Units Per Month",
        a.unitsPerMonth,
        "pcs/mo",
        `${a.id}.unitsPerMonth`,
        `${a.id}:unitsPerMonth`,
      );
      const unitPrice = addFactor(
        `${safeId}_unitPrice`,
        "Unit Price",
        a.unitPrice,
        "EUR/pcs",
        `${a.id}.unitPrice`,
        `${a.id}:unitPrice`,
      );
      const unitCost = addFactor(
        `${safeId}_unitCost`,
        "Unit Cost",
        a.unitCost,
        "EUR/pcs",
        `${a.id}.unitCost`,
        `${a.id}:unitCost`,
      );
      const spoilageRate = addFactor(
        `${safeId}_spoilageRate`,
        "Spoilage Rate",
        a.spoilageRate,
        "ratio",
        `${a.id}.spoilageRate`,
        `${a.id}:spoilageRate`,
      );
      const stockCoverDays = addFactor(
        `${safeId}_stockCoverDays`,
        "Stock Cover Days",
        a.stockCoverDays,
        "d",
        `${a.id}.stockCoverDays`,
        `${a.id}:stockCoverDays`,
      );
      const capacityUnitsPerMonth = addFactor(
        `${safeId}_capacityUnitsPerMonth`,
        "Capacity Units Per Month",
        a.capacityUnitsPerMonth === null ? -1 : a.capacityUnitsPerMonth,
        "pcs/mo",
        `${a.id}.capacityUnitsPerMonth`,
        `${a.id}:capacityUnitsPerMonth`,
      );
      return {
        priceFactorUri: unitPrice,
        revenueModule: {
          atom: "physical_matter",
          params: {
            unitsPerMonth: { factor: unitsPerMonth },
            unitPrice: { factor: unitPrice },
            unitCost: { factor: unitCost },
            spoilageRate: { factor: spoilageRate },
            stockCoverDays: { factor: stockCoverDays },
            capacityUnitsPerMonth: { factor: capacityUnitsPerMonth },
          },
        },
      };
    }
    case "RECURRING_SUB": {
      const a = atom as RecurringSubAtom;
      const startingSubscribers = addFactor(
        `${safeId}_startingSubscribers`,
        "Starting Subscribers",
        a.startingSubscribers,
        "sub",
        `${a.id}.startingSubscribers`,
        `${a.id}:startingSubscribers`,
      );
      const newPerMonth = addFactor(
        `${safeId}_newPerMonth`,
        "New Subscribers Per Month",
        a.newPerMonth,
        "sub/mo",
        `${a.id}.newPerMonth`,
        `${a.id}:newPerMonth`,
      );
      const churnRateMonthly = addFactor(
        `${safeId}_churnRateMonthly`,
        "Monthly Churn Rate",
        a.churnRateMonthly,
        "ratio",
        `${a.id}.churnRateMonthly`,
        `${a.id}:churnRateMonthly`,
      );
      const pricePerMonth = addFactor(
        `${safeId}_pricePerMonth`,
        "Price Per Month",
        a.pricePerMonth,
        "EUR/mo",
        `${a.id}.pricePerMonth`,
        `${a.id}:pricePerMonth`,
      );
      const costPerSubscriberMonth = addFactor(
        `${safeId}_costPerSubscriberMonth`,
        "Cost Per Subscriber Month",
        a.costPerSubscriberMonth,
        "EUR/mo",
        `${a.id}.costPerSubscriberMonth`,
        `${a.id}:costPerSubscriberMonth`,
      );
      const cacPerNew = addFactor(
        `${safeId}_cacPerNew`,
        "Acquisition Cost Per New Subscriber",
        a.cacPerNew,
        "EUR/sub",
        `${a.id}.cacPerNew`,
        `${a.id}:cacPerNew`,
      );
      return {
        priceFactorUri: pricePerMonth,
        revenueModule: {
          atom: "recurring_subscription",
          params: {
            startingSubscribers: { factor: startingSubscribers },
            newPerMonth: { factor: newPerMonth },
            churnRateMonthly: { factor: churnRateMonthly },
            pricePerMonth: { factor: pricePerMonth },
            costPerSubscriberMonth: { factor: costPerSubscriberMonth },
            cacPerNew: { factor: cacPerNew },
          },
        },
      };
    }
    case "TRANSACTIONAL_TRADE": {
      const a = atom as TransactionalTradeAtom;
      const visitorsPerDay = addFactor(
        `${safeId}_visitorsPerDay`,
        "Visitors Per Day",
        a.visitorsPerDay,
        "visitors/d",
        `${a.id}.visitorsPerDay`,
        `${a.id}:visitorsPerDay`,
      );
      const conversionRate = addFactor(
        `${safeId}_conversionRate`,
        "Conversion Rate",
        a.conversionRate,
        "ratio",
        `${a.id}.conversionRate`,
        `${a.id}:conversionRate`,
      );
      const averageTicket = addFactor(
        `${safeId}_averageTicket`,
        "Average Transaction Value",
        a.averageTicket,
        "EUR/tx",
        `${a.id}.averageTicket`,
        `${a.id}:averageTicket`,
      );
      const costPerSale = addFactor(
        `${safeId}_costPerSale`,
        "Variable Cost Per Transaction",
        a.costPerSale,
        "EUR/tx",
        `${a.id}.costPerSale`,
        `${a.id}:costPerSale`,
      );
      const openDaysPerMonth = addFactor(
        `${safeId}_openDaysPerMonth`,
        "Operating Days Per Month",
        a.openDaysPerMonth,
        "d/mo",
        `${a.id}.openDaysPerMonth`,
        `${a.id}:openDaysPerMonth`,
      );
      const capacityPerDay = addFactor(
        `${safeId}_capacityPerDay`,
        "Capacity Per Day",
        a.capacityPerDay === null ? -1 : a.capacityPerDay,
        "tx/d",
        `${a.id}.capacityPerDay`,
        `${a.id}:capacityPerDay`,
      );
      return {
        priceFactorUri: averageTicket,
        revenueModule: {
          atom: "transactional_trade",
          params: {
            visitorsPerDay: { factor: visitorsPerDay },
            conversionRate: { factor: conversionRate },
            averageTicket: { factor: averageTicket },
            costPerSale: { factor: costPerSale },
            openDaysPerMonth: { factor: openDaysPerMonth },
            capacityPerDay: { factor: capacityPerDay },
          },
        },
      };
    }
  }
}
