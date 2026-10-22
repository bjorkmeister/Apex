/**
 * APEX Flow — perustajan muistilistan testit (vaihe C).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createPreset, simulate, totalFixedCostsPerMonth } from "../src/flow/kernel/index.ts";
import { buildView } from "../src/flow/model/view.ts";
import {
  checklistView,
  emptyChecklist,
  setItemParam,
  toggleItem,
  yelMonthly,
} from "../src/flow/model/launchpad.ts";

const close = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `odotettiin ${b}, saatiin ${a}`);

describe("APEX Flow — perustamislista", () => {
  it("1. YEL-ruksi lisää kuukausikulun ja ruksin poisto palauttaa mallin täsmälleen", () => {
    const m = createPreset("it_consultant");
    const before = totalFixedCostsPerMonth(m);
    const on = toggleItem(m, emptyChecklist(), "yel", true);
    close(totalFixedCostsPerMonth(on.molecule) - before, yelMonthly(15000, 24.4, 22));
    const off = toggleItem(on.molecule, on.checklist, "yel", false);
    assert.deepEqual(off.molecule, m);
  });

  it("2. Parametrin muutos päivittää ruksatun kohdan vaikutuksen eikä tuplaa kulua", () => {
    const m = createPreset("it_consultant");
    let r = toggleItem(m, emptyChecklist(), "yel", true);
    r = setItemParam(r.molecule, r.checklist, "yel", "income", 30000);
    const yel = r.molecule.fixedCosts.filter((c) => c.label === "YEL-vakuutus");
    assert.equal(yel.length, 1);
    close(yel[0].amountPerMonth, yelMonthly(30000, 24.4, 22));
  });

  it("3. Perustamismaksu pienentää alkukassaa ja palautuu", () => {
    const m = createPreset("it_consultant");
    let r = toggleItem(m, emptyChecklist(), "company-form", true);
    assert.equal(r.molecule.credit.openingCash, 5000 - 75);
    r = setItemParam(r.molecule, r.checklist, "company-form", "fee", 380);
    assert.equal(r.molecule.credit.openingCash, 5000 - 380);
    r = toggleItem(r.molecule, r.checklist, "company-form", false);
    assert.equal(r.molecule.credit.openingCash, 5000);
  });

  it("4. 14 pv maksuehto pelastaa konsultin kassan ja ruksin poisto palauttaa 30 pv", () => {
    const m = createPreset("it_consultant");
    assert.notEqual(simulate(m).cashOutDay, null);
    const on = toggleItem(m, emptyChecklist(), "terms", true);
    assert.equal(on.molecule.credit.customerTermsDays, 14);
    assert.equal(simulate(on.molecule).cashOutDay, null);
    const off = toggleItem(on.molecule, on.checklist, "terms", false);
    assert.equal(off.molecule.credit.customerTermsDays, 30);
  });

  it("5. Automaattiset kohdat luetaan mallista, eikä niitä voi ruksata käsin", () => {
    const m = createPreset("it_consultant");
    const v = buildView(m);
    const cl = checklistView(m, v, emptyChecklist());
    const buffer = cl.items.find((i) => i.def.id === "buffer")!;
    assert.equal(buffer.status, "attention", "kassa loppuu → huomio");
    const salary = cl.items.find((i) => i.def.id === "own-salary")!;
    assert.equal(salary.status, "done");
    const untouched = toggleItem(m, emptyChecklist(), "buffer", true);
    assert.equal(untouched.molecule, m);
  });

  it("6. Kioskilla ei näytetä maksuehtokohtaa, ja ALV-raja huomautetaan", () => {
    const m = createPreset("food_kiosk");
    const cl = checklistView(m, buildView(m), emptyChecklist());
    assert.ok(!cl.items.some((i) => i.def.id === "terms"));
    const vat = cl.items.find((i) => i.def.id === "vat")!;
    assert.equal(vat.status, "attention");
    assert.match(vat.note ?? "", /ALV/);
    assert.ok(cl.next !== null);
  });
});
