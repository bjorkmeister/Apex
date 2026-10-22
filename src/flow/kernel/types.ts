/**
 * APEX Flow — atomiydin: tietomalli (`src/flow/kernel/types.ts`).
 *
 * Liiketoiminta mallinnetaan "molekyylinä", joka koostuu vapaasti yhdisteltävistä
 * tuloatomeista (aika, aine, tilaus, kauppatapahtuma) sekä yhdestä maksuaika-atomista
 * (kassa, asiakkaiden ja toimittajien maksuehdot).
 *
 * Tämä tiedosto ajetaan sekä Node.js:ssä (testit, palvelin) että selaimessa
 * (palvelin riisuu tyypit `stripTypeScriptTypes`-funktiolla). Siksi tässä hakemistossa
 * käytetään vain poistettavaa TypeScript-syntaksia: ei enumeja, ei namespaceja,
 * ja tyyppituonnit tehdään aina `import type` -muodossa.
 *
 * Yksinkertaistukset (näytetään myös käyttäjälle):
 * - Kuukausi = 30 päivää. Viikkoja kuukaudessa = 52 / 12.
 * - Kaikki summat ilman arvonlisäveroa. Tuloveroja ei mallinneta.
 * - Kysyntää ei arvata: määrät ovat käyttäjän syötteitä, ja herkkyysmoottori
 *   laskee kipurajat niiden pohjalta.
 */

export const DAYS_PER_MONTH = 30;
export const WEEKS_PER_MONTH = 52 / 12;

export type AtomKind =
  | "TIME_CAPACITY"
  | "PHYSICAL_MATTER"
  | "RECURRING_SUB"
  | "TRANSACTIONAL_TRADE";

interface AtomBase {
  id: string;
  kind: AtomKind;
  /** Käyttäjälle näkyvä nimi, esim. "Konsultointitunnit". */
  label: string;
  enabled: boolean;
  /**
   * Asiakkaan maksuaika tälle tulovirralle päivinä. Jos puuttuu, käytetään lajikohtaista
   * oletusta (laskutettavat virrat: `credit.customerTermsDays`, korttimaksut: 0–1 pv).
   */
  paymentTermsDays?: number;
}

/** Aika ja osaaminen: myydään työtunteja. Varasto = kalenteri, hävikki = myymätön tunti. */
export interface TimeCapacityAtom extends AtomBase {
  kind: "TIME_CAPACITY";
  people: number;
  hoursPerWeek: number;
  /** Laskutusaste 0..1: osuus työajasta, joka voidaan laskuttaa. */
  utilization: number;
  hourlyRate: number;
  /** Myyty kysyntä tunteina kuukaudessa. `null` = kysyntää riittää koko kapasiteetille. */
  demandHoursPerMonth: number | null;
  /** Palkka henkilöä kohden kuukaudessa (yksinyrittäjällä oma nosto). */
  salaryPerPersonMonth: number;
  /** Työnantajan sivukulut palkan päälle, 0..1. */
  sideCostRate: number;
  /** Tuntikohtainen muuttuva kulu (esim. alihankinta, lisenssi per tunti). */
  variableCostPerHour: number;
}

/** Fyysinen tavara varastosta: raaka-aineet, hävikki ja varastoon sitoutunut raha. */
export interface PhysicalMatterAtom extends AtomBase {
  kind: "PHYSICAL_MATTER";
  unitsPerMonth: number;
  unitPrice: number;
  unitCost: number;
  /** Osuus ostetuista kappaleista, joka pilaantuu tai hävitään, 0..<1. */
  spoilageRate: number;
  /** Kuinka monen päivän ostot pidetään varastossa. */
  stockCoverDays: number;
  /** Valmistus- tai myyntikapasiteetti kpl/kk. `null` = ei rajoitetta. */
  capacityUnitsPerMonth: number | null;
}

/** Jatkuva tilaus: kuukausimaksu, asiakaspoistuma ja asiakashankinnan kulu. */
export interface RecurringSubAtom extends AtomBase {
  kind: "RECURRING_SUB";
  startingSubscribers: number;
  newPerMonth: number;
  /** Kuukausittainen poistuma 0..1. */
  churnRateMonthly: number;
  pricePerMonth: number;
  costPerSubscriberMonth: number;
  /** Markkinointikulu uutta asiakasta kohden (maksetaan heti). */
  cacPerNew: number;
}

/** Kauppatapahtuma tiskillä: kävijät × ostoprosentti × keskiostos. */
export interface TransactionalTradeAtom extends AtomBase {
  kind: "TRANSACTIONAL_TRADE";
  visitorsPerDay: number;
  conversionRate: number;
  averageTicket: number;
  costPerSale: number;
  openDaysPerMonth: number;
  /** Palvelukapasiteetti myyntejä per aukiolopäivä. `null` = ei rajoitetta. */
  capacityPerDay: number | null;
}

export type RevenueAtom =
  | TimeCapacityAtom
  | PhysicalMatterAtom
  | RecurringSubAtom
  | TransactionalTradeAtom;

/** Maksuaika-atomi: kassa ja maksuehdot. Yksi per molekyyli. */
export interface CreditAtom {
  openingCash: number;
  /** Oletusmaksuaika laskutettaville asiakkaille. */
  customerTermsDays: number;
  /** Maksuaika toimittajille muuttuvista kuluista. */
  supplierTermsDays: number;
}

export type FixedCostCategory =
  | "rent"
  | "admin"
  | "insurance"
  | "pension"
  | "software"
  | "marketing"
  | "other";

export type FixedCostSource = "user" | "preset" | "launchpad" | "import" | "coach";

export interface FixedCost {
  id: string;
  label: string;
  amountPerMonth: number;
  /** Maksupäivä kuukaudessa, 1..30. */
  dayOfMonth: number;
  category: FixedCostCategory;
  source: FixedCostSource;
}

export interface Molecule {
  id: string;
  name: string;
  atoms: RevenueAtom[];
  credit: CreditAtom;
  fixedCosts: FixedCost[];
  /** Palkanmaksupäivä aika-atomien palkoille, 1..30. */
  payrollDay: number;
  horizonMonths: number;
}

/** Atomin staattinen kuukausitalous (ensimmäisen kuukauden tasolla). */
export interface AtomEconomics {
  atomId: string;
  kind: AtomKind;
  label: string;
  /** Myyty määrä kuukaudessa. */
  volume: number;
  /** Määrän yksikkö suomeksi: "h", "kpl", "asiakasta", "myyntiä". */
  volumeUnit: string;
  /** Kysyntä kuukaudessa (sama yksikkö). */
  demand: number;
  /** Kapasiteetti kuukaudessa. `null` = ei rajoitetta. */
  capacity: number | null;
  /** Kysyntä, jota ei pystytä palvelemaan kapasiteetin takia. */
  lostDemand: number;
  /** Käyttämätön kapasiteetti (aika-atomilla laskuttamaton "bench"-aika). */
  idleCapacity: number;
  /** Kysyntä / kapasiteetti. ≥ 1 tarkoittaa, että kapasiteetti on pullonkaula. */
  bottleneckRatio: number | null;
  unitPrice: number;
  unitVariableCost: number;
  revenuePerMonth: number;
  variableCostPerMonth: number;
  contributionPerMonth: number;
  /** Myyntikateprosentti 0..1. */
  contributionMarginRatio: number;
  /** Atomiin sidotut kiinteät kulut kuukaudessa (aika-atomin palkat sivukuluineen). */
  attachedFixedCostPerMonth: number;
  paymentTermsDays: number;
}

export interface DayPoint {
  day: number;
  cash: number;
  receivables: number;
  payables: number;
  inventory: number;
}

export interface AtomMonthStats {
  revenue: number;
  variableCosts: number;
  volume: number;
}

export interface MonthResult {
  month: number;
  revenue: number;
  variableCosts: number;
  grossMargin: number;
  fixedCosts: number;
  operatingProfit: number;
  endCash: number;
  endReceivables: number;
  endPayables: number;
  inventory: number;
  byAtom: Record<string, AtomMonthStats>;
}

export interface SimulationResult {
  horizonDays: number;
  days: DayPoint[];
  months: MonthResult[];
  openingCash: number;
  endCash: number;
  minCash: number;
  minCashDay: number;
  /** Ensimmäinen päivä, jolloin kassa on miinuksella. `null` = ei tapahdu tarkasteluaikana. */
  cashOutDay: number | null;
  totals: {
    revenue: number;
    variableCosts: number;
    fixedCosts: number;
    operatingProfit: number;
  };
  /**
   * Kirjanpidon täsmäytys: (loppukassa − alkukassa) − (tulos − saamiset + ostovelat − varasto).
   * Pitää olla nolla pyöristysvirhettä lukuun ottamatta.
   */
  reconciliationError: number;
}
