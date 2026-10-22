/**
 * APEX Flow — atomitehtaat ja aloituspohjat (`src/flow/kernel/presets.ts`).
 *
 * Pohjat ovat vain esimerkkejä: jokainen on tavallinen molekyyli, jonka atomeja
 * käyttäjä voi muokata, lisätä tai poistaa. Mitään toimialaa ei ole kovakoodattu
 * laskentaan.
 */
import type {
  AtomKind,
  FixedCost,
  Molecule,
  PhysicalMatterAtom,
  RecurringSubAtom,
  RevenueAtom,
  TimeCapacityAtom,
  TransactionalTradeAtom,
} from "./types.ts";
import { msg, t } from "../i18n/index.ts";

let seq = 0;
export function newId(prefix: string): string {
  seq += 1;
  return `${prefix}-${Date.now().toString(36)}-${seq.toString(36)}`;
}

export const ATOM_KIND_LABELS: Record<AtomKind, { title: string; hint: string }> = {
  TIME_CAPACITY: { title: msg("Myyn aikaa ja osaamista"), hint: msg("Tunnit, projektit, konsultointi, palvelutyö") },
  PHYSICAL_MATTER: { title: msg("Myyn tavaraa varastosta"), hint: msg("Tuotteet, raaka-aineet, verkkokauppa, tukku") },
  RECURRING_SUB: { title: msg("Myyn kuukausitilauksia"), hint: msg("SaaS, jäsenyydet, ylläpitosopimukset") },
  TRANSACTIONAL_TRADE: { title: msg("Myyn tiskiltä ohikulkijoille"), hint: msg("Kioski, kahvila, myymälä, tapahtumat") },
};

export function createAtom(kind: AtomKind): RevenueAtom {
  switch (kind) {
    case "TIME_CAPACITY":
      return {
        id: newId("time"),
        kind,
        label: t("Asiantuntijatyö"),
        enabled: true,
        people: 1,
        hoursPerWeek: 37.5,
        utilization: 0.6,
        hourlyRate: 80,
        demandHoursPerMonth: null,
        salaryPerPersonMonth: 3000,
        sideCostRate: 0,
        variableCostPerHour: 0,
      } satisfies TimeCapacityAtom;
    case "PHYSICAL_MATTER":
      return {
        id: newId("matter"),
        kind,
        label: t("Tuotemyynti"),
        enabled: true,
        unitsPerMonth: 300,
        unitPrice: 30,
        unitCost: 12,
        spoilageRate: 0.02,
        stockCoverDays: 30,
        capacityUnitsPerMonth: null,
      } satisfies PhysicalMatterAtom;
    case "RECURRING_SUB":
      return {
        id: newId("sub"),
        kind,
        label: t("Kuukausitilaukset"),
        enabled: true,
        startingSubscribers: 0,
        newPerMonth: 20,
        churnRateMonthly: 0.04,
        pricePerMonth: 29,
        costPerSubscriberMonth: 3,
        cacPerNew: 60,
      } satisfies RecurringSubAtom;
    case "TRANSACTIONAL_TRADE":
      return {
        id: newId("trade"),
        kind,
        label: t("Tiskimyynti"),
        enabled: true,
        visitorsPerDay: 400,
        conversionRate: 0.1,
        averageTicket: 8,
        costPerSale: 3,
        openDaysPerMonth: 26,
        capacityPerDay: null,
      } satisfies TransactionalTradeAtom;
  }
}

export function fixedCost(
  label: string,
  amountPerMonth: number,
  category: FixedCost["category"],
  dayOfMonth = 1,
  source: FixedCost["source"] = "preset",
): FixedCost {
  return { id: newId("fc"), label, amountPerMonth, dayOfMonth, category, source };
}

export function emptyMolecule(name = t("Uusi yritys")): Molecule {
  return {
    id: newId("mol"),
    name,
    atoms: [],
    credit: { openingCash: 5000, customerTermsDays: 30, supplierTermsDays: 14 },
    fixedCosts: [],
    payrollDay: 15,
    horizonMonths: 12,
  };
}

export type PresetId = "it_consultant" | "food_kiosk" | "saas_hybrid" | "webshop";

export const PRESET_LABELS: Record<PresetId, { title: string; hint: string }> = {
  it_consultant: { title: msg("IT-konsultti (yksinyrittäjä)"), hint: msg("Tuntityö, laskut 30 pv maksuajalla") },
  food_kiosk: { title: msg("Ruokakioski"), hint: msg("Tiskimyynti, kortti- ja käteismaksut") },
  saas_hybrid: { title: msg("Ohjelmistoyritys"), hint: msg("Kuukausitilaukset + konsultointitunnit") },
  webshop: { title: msg("Verkkokauppa"), hint: msg("Varasto, hävikki, sitoutunut raha") },
};

export function createPreset(id: PresetId): Molecule {
  const m = emptyMolecule(t(PRESET_LABELS[id].title));
  switch (id) {
    case "it_consultant": {
      const time = createAtom("TIME_CAPACITY") as TimeCapacityAtom;
      time.label = t("Konsultointitunnit");
      time.hourlyRate = 85;
      time.utilization = 0.6;
      time.salaryPerPersonMonth = 3500;
      m.atoms = [time];
      m.credit = { openingCash: 5000, customerTermsDays: 30, supplierTermsDays: 14 };
      m.fixedCosts = [
        fixedCost(t("Ohjelmistot ja laitteet"), 150, "software", 1),
        fixedCost(t("Työtila"), 250, "rent", 1),
      ];
      return m;
    }
    case "food_kiosk": {
      const trade = createAtom("TRANSACTIONAL_TRADE") as TransactionalTradeAtom;
      trade.label = t("Annosmyynti");
      trade.visitorsPerDay = 600;
      trade.conversionRate = 0.08;
      trade.averageTicket = 9;
      trade.costPerSale = 3.2;
      trade.openDaysPerMonth = 26;
      trade.capacityPerDay = 60;
      m.atoms = [trade];
      m.credit = { openingCash: 8000, customerTermsDays: 0, supplierTermsDays: 14 };
      m.fixedCosts = [
        fixedCost(t("Paikkavuokra"), 900, "rent", 1),
        fixedCost(t("Sähkö ja vesi"), 250, "other", 10),
        fixedCost(t("Oma palkka (nosto)"), 2200, "other", 15),
      ];
      return m;
    }
    case "saas_hybrid": {
      const sub = createAtom("RECURRING_SUB") as RecurringSubAtom;
      sub.label = t("Ohjelmistolisenssit");
      sub.startingSubscribers = 10;
      sub.newPerMonth = 8;
      sub.churnRateMonthly = 0.03;
      sub.pricePerMonth = 149;
      sub.costPerSubscriberMonth = 12;
      sub.cacPerNew = 400;
      const time = createAtom("TIME_CAPACITY") as TimeCapacityAtom;
      time.label = t("Käyttöönottokonsultointi");
      time.people = 2;
      time.utilization = 0.35;
      time.hourlyRate = 110;
      time.salaryPerPersonMonth = 4200;
      time.sideCostRate = 0.21;
      m.atoms = [sub, time];
      m.credit = { openingCash: 40000, customerTermsDays: 21, supplierTermsDays: 14 };
      m.fixedCosts = [
        fixedCost(t("Pilvipalvelut (pohja)"), 600, "software", 1),
        fixedCost(t("Toimisto"), 1200, "rent", 1),
        fixedCost(t("Kirjanpito"), 250, "admin", 5),
      ];
      return m;
    }
    case "webshop": {
      const matter = createAtom("PHYSICAL_MATTER") as PhysicalMatterAtom;
      matter.label = t("Tuotteet");
      matter.unitsPerMonth = 400;
      matter.unitPrice = 39;
      matter.unitCost = 15;
      matter.spoilageRate = 0.03;
      matter.stockCoverDays = 45;
      matter.paymentTermsDays = 2;
      m.atoms = [matter];
      m.credit = { openingCash: 10000, customerTermsDays: 14, supplierTermsDays: 30 };
      m.fixedCosts = [
        fixedCost(t("Verkkokauppa-alusta"), 120, "software", 1),
        fixedCost(t("Varastotila"), 500, "rent", 1),
        fixedCost(t("Mainonta"), 1500, "marketing", 1),
        fixedCost(t("Oma palkka (nosto)"), 2500, "other", 15),
      ];
      return m;
    }
  }
}
