/**
 * APEX Flow — atomiytimen testit (vaihe A: atomimalli + kipurajamoottori).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  applyStress,
  atomEconomics,
  breakEven,
  createAtom,
  createPreset,
  customerTermsImpact,
  emptyMolecule,
  hireBreakEven,
  moleculeEconomics,
  priceChangeTolerance,
  simulate,
  steadyStateSubscribers,
  subscribersAtMonth,
  timeCapacityHours,
  type Molecule,
  type PresetId,
  type RecurringSubAtom,
  type TimeCapacityAtom,
  WEEKS_PER_MONTH,
} from "../src/flow/kernel/index.ts";

const close = (a: number, b: number, eps = 1e-6) =>
  assert.ok(Math.abs(a - b) <= eps, `odotettiin ${b}, saatiin ${a}`);

describe("APEX Flow — atomiydin", () => {
  it("1. Aika-atomi: kapasiteetti, laskutus ja bench-aika lasketaan tunteina", () => {
    const m = createPreset("it_consultant");
    const time = m.atoms[0] as TimeCapacityAtom;
    const cap = 37.5 * WEEKS_PER_MONTH * 0.6;
    close(timeCapacityHours(time), cap);
    const e = atomEconomics(time, m);
    close(e.revenuePerMonth, cap * 85);
    assert.equal(e.volumeUnit, "h");
    assert.equal(e.lostDemand, 0);

    time.demandHoursPerMonth = 50;
    const e2 = atomEconomics(time, m);
    close(e2.volume, 50);
    close(e2.idleCapacity, cap - 50);
    assert.ok(e2.bottleneckRatio! < 1);

    time.demandHoursPerMonth = 200;
    const e3 = atomEconomics(time, m);
    close(e3.volume, cap);
    close(e3.lostDemand, 200 - cap);
    assert.ok(e3.bottleneckRatio! > 1, "kysyntä ylittää kapasiteetin = pullonkaula");
  });

  it("2. Asiantuntijayrityksessä ei ole varastoa eikä hävikkiä", () => {
    const r = simulate(createPreset("it_consultant"));
    assert.ok(r.days.every((d) => d.inventory === 0));
  });

  it("3. Maksuaikaloukku: 30 pv maksuaika kuivattaa kassan ennen ensimmäistä suoritusta, 14 pv ei", () => {
    const m = createPreset("it_consultant");
    const r30 = simulate(m);
    assert.notEqual(r30.cashOutDay, null, "30 pv maksuajalla kassan pitää loppua");
    // Ensimmäinen lasku lähtee päivänä 29 ja maksetaan päivänä 59; toinen palkka maksetaan päivänä 44.
    assert.ok(r30.cashOutDay! < 59);

    const scenarios = customerTermsImpact(m, [14, 30, 60]);
    assert.equal(scenarios[0].cashOutDay, null, "14 pv maksuajalla kassa riittää");
    assert.ok(scenarios[1].minCash > scenarios[2].minCash, "pidempi maksuaika = syvempi kassakuoppa");
    // Tulos on sama maksuajasta riippumatta: maksuaika siirtää rahaa, ei luo sitä.
    const p14 = simulate({ ...m, credit: { ...m.credit, customerTermsDays: 14 } }).totals.operatingProfit;
    close(p14, r30.totals.operatingProfit, 1e-6);
  });

  it("4. Kirjanpito täsmää kaikilla pohjilla ja atomiyhdistelmillä", () => {
    const ids: PresetId[] = ["it_consultant", "food_kiosk", "saas_hybrid", "webshop"];
    for (const id of ids) {
      const r = simulate(createPreset(id));
      close(r.reconciliationError, 0, 1e-6);
      assert.equal(r.months.length, 12);
      assert.equal(r.days.length, 360);
    }
    // Hybridi: kaikki neljä tuloatomia samassa yrityksessä.
    const hybrid = emptyMolecule("Hybridi");
    hybrid.atoms = [
      createAtom("TIME_CAPACITY"),
      createAtom("PHYSICAL_MATTER"),
      createAtom("RECURRING_SUB"),
      createAtom("TRANSACTIONAL_TRADE"),
    ];
    const rh = simulate(hybrid);
    close(rh.reconciliationError, 0, 1e-6);
    assert.equal(Object.keys(rh.months[0].byAtom).length, 4);
  });

  it("5. Fyysinen atomi: hävikki nostaa kpl-kulua ja aloitusvarasto sitoo kassaa", () => {
    const m = createPreset("webshop");
    const r = simulate(m);
    const e = moleculeEconomics(m)[0];
    close(e.unitVariableCost, 15 / (1 - 0.03));
    assert.ok(r.days[0].inventory > 0);
    // Varasto pysyy vakiona (täydennetään myynnin tahdissa).
    assert.equal(r.days[0].inventory, r.days[359].inventory);
  });

  it("6. Tilausatomi: tilaajamäärä hakeutuu tasapainoon uudet / poistuma", () => {
    const sub = createAtom("RECURRING_SUB") as RecurringSubAtom;
    sub.startingSubscribers = 0;
    sub.newPerMonth = 10;
    sub.churnRateMonthly = 0.1;
    close(subscribersAtMonth(sub, 0), 10);
    close(subscribersAtMonth(sub, 1), 19);
    close(steadyStateSubscribers(sub)!, 100);
    assert.ok(subscribersAtMonth(sub, 200) > 99.9);
  });

  it("7. Kipuraja: +20 % hinnalla saa menettää tarkalleen (P−v)/(P'−v):n verran määrää", () => {
    // Hinta 100, muuttuva kulu 40 → kate 60. Uusi hinta 120 → kate 80. Saa menettää 25 %.
    const t = priceChangeTolerance(100, 40, 0.2);
    close(t.maxVolumeLoss!, 0.25);
    assert.equal(t.requiredVolumeGain, null);
    // Hinnan lasku −10 % → kate 50 → tarvitaan 20 % lisää määrää.
    const d = priceChangeTolerance(100, 40, -0.1);
    close(d.requiredVolumeGain!, 0.2);
    // Hinta alle muuttuvan kulun → mahdoton.
    assert.equal(priceChangeTolerance(100, 40, -0.7).impossible, true);
  });

  it("8. Kannattavuusraja ja rekryn takaisinmaksu", () => {
    const m = createPreset("it_consultant");
    const be = breakEven(m);
    close(be.fixedCostsPerMonth, 3500 + 150 + 250);
    close(be.breakEvenVolume!.volume, 3900 / 85);
    assert.equal(be.breakEvenVolume!.unit, "h");
    assert.equal(be.breakEvenWithinCapacity, true);
    assert.ok(be.marginOfSafety! > 0);

    const hire = hireBreakEven(m.atoms[0] as TimeCapacityAtom, 3200, 0.21);
    close(hire.monthlyCost, 3200 * 1.21);
    close(hire.hoursNeededPerMonth!, (3200 * 1.21) / 85);
  });

  it("9. Stressitesti: −25 % määrä heikentää tulosta mutta ei riko täsmäytystä", () => {
    const m: Molecule = createPreset("food_kiosk");
    const stressed = simulate(applyStress(m, { volumeChange: -0.25 }));
    const base = simulate(m);
    assert.ok(stressed.totals.operatingProfit < base.totals.operatingProfit);
    close(stressed.reconciliationError, 0, 1e-6);
  });

  it("10. Simulaatio on deterministinen ja nopea (alle 16 ms liukusäätimen vasteeseen)", () => {
    const m = createPreset("saas_hybrid");
    const a = simulate(m);
    const t0 = performance.now();
    for (let i = 0; i < 50; i += 1) simulate(m);
    const per = (performance.now() - t0) / 50;
    assert.deepEqual(simulate(m).endCash, a.endCash);
    assert.ok(per < 16, `simulaatio kesti ${per.toFixed(2)} ms`);
  });
});
