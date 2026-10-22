/**
 * APEX Flow — näkymämallin, vipujen, muokkausten ja selainkäännöksen testit (vaihe B).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { createPreset, emptyMolecule, simulate, type TimeCapacityAtom } from "../src/flow/kernel/index.ts";
import { applyLever, leversFor } from "../src/flow/model/levers.ts";
import { buildView } from "../src/flow/model/view.ts";
import {
  addAtom,
  addFixedCost,
  removeAtom,
  removeFixedCost,
  setAtomField,
  updateFixedCost,
} from "../src/flow/model/edit.ts";
import { transpileFlowModule } from "../src/flow/server/routes.ts";

describe("APEX Flow — näkymä ja vivut", () => {
  it("1. Päänäkymässä on tasan viisi solmua ja kolme pääkuvaa", () => {
    const v = buildView(createPreset("it_consultant"));
    assert.equal(v.nodes.length, 5);
    assert.equal(v.headlines.length, 3);
    assert.equal(v.headlines[1].status, "alert", "30 pv maksuajalla kassa loppuu → hälytys");
    assert.match(v.headlines[1].value, /päivänä/);
  });

  it("2. Vivut syntyvät atomeista: asiantuntijalla ei ole varasto- eikä hävikkivipuja", () => {
    const levers = leversFor(createPreset("it_consultant"));
    const labels = levers.map((l) => l.label);
    assert.ok(labels.includes("Tuntihinta"));
    assert.ok(labels.includes("Asiakkaan maksuaika"));
    assert.ok(!labels.some((l) => /hävikki|varasto/i.test(l)), "ei fyysisiä vipuja asiantuntijalle");
    const shop = leversFor(createPreset("webshop")).map((l) => l.label);
    assert.ok(shop.includes("Hävikki"));
  });

  it("3. Kioskilla ei näytetä asiakkaan maksuaikaa, koska rahat tulevat heti", () => {
    const labels = leversFor(createPreset("food_kiosk")).map((l) => l.label);
    assert.ok(!labels.includes("Asiakkaan maksuaika"));
  });

  it("4. Vivun muutos ei muuta alkuperäistä molekyyliä ja vaikuttaa simulaatioon", () => {
    const m = createPreset("it_consultant");
    const lever = leversFor(m).find((l) => l.label === "Asiakkaan maksuaika")!;
    const m2 = applyLever(m, lever.id, 14);
    assert.equal(m.credit.customerTermsDays, 30);
    assert.equal(m2.credit.customerTermsDays, 14);
    assert.equal(simulate(m2).cashOutDay, null);
    // Tuntemattomat kentät hylätään.
    const proto = applyLever(m, `${m.atoms[0].id}:__proto__`, 1);
    assert.deepEqual(proto.atoms[0], m.atoms[0]);
    const hacked = applyLever(m, `${m.atoms[0].id}:label`, 5);
    assert.equal(hacked.atoms[0].label, "Konsultointitunnit");
  });

  it("5. Muokkaukset: atomin lisäys/poisto, kentät ja kiinteät kulut", () => {
    let m = emptyMolecule();
    m = addAtom(m, "TIME_CAPACITY");
    m = addAtom(m, "RECURRING_SUB");
    assert.equal(m.atoms.length, 2);
    const timeId = m.atoms[0].id;
    m = setAtomField(m, timeId, "demandHoursPerMonth", 40);
    assert.equal((m.atoms[0] as TimeCapacityAtom).demandHoursPerMonth, 40);
    m = setAtomField(m, timeId, "demandHoursPerMonth", null);
    assert.equal((m.atoms[0] as TimeCapacityAtom).demandHoursPerMonth, null);
    m = setAtomField(m, timeId, "utilization", 7);
    assert.equal((m.atoms[0] as TimeCapacityAtom).utilization, 1, "laskutusaste rajataan 0..1");
    m = setAtomField(m, timeId, "paymentTermsDays", 7);
    assert.equal(m.atoms[0].paymentTermsDays, 7);
    m = setAtomField(m, timeId, "paymentTermsDays", null);
    assert.equal("paymentTermsDays" in m.atoms[0], false, "tyhjä maksuaika = oletus");
    m = addFixedCost(m, { label: "Vuokra", amountPerMonth: 800, dayOfMonth: 45, id: "rent" });
    assert.equal(m.fixedCosts[0].dayOfMonth, 30);
    m = updateFixedCost(m, "rent", { amountPerMonth: 900 });
    assert.equal(m.fixedCosts[0].amountPerMonth, 900);
    m = addFixedCost(m, { label: "Vuokra 2", amountPerMonth: 1, id: "rent" });
    assert.equal(m.fixedCosts.length, 1, "sama tunniste korvaa, ei tuplaa");
    m = removeFixedCost(m, "rent");
    assert.equal(m.fixedCosts.length, 0);
    m = removeAtom(m, timeId);
    assert.equal(m.atoms.length, 1);
    assert.equal(simulate(m).reconciliationError.toFixed(6), "0.000000");
  });

  it("6. Tyhjä molekyyli ei kaada näkymää", () => {
    const v = buildView(emptyMolecule());
    assert.equal(v.isEmpty, true);
    assert.equal(v.nodes.length, 5);
  });
});

describe("APEX Flow — selainkäännös", () => {
  const flowDir = path.resolve("src/flow");
  const dirs = ["kernel", "model", "client"];

  it("7. Jokainen selaimelle tarjottava moduuli kääntyy ja on syntaktisesti kelvollista JavaScriptiä", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "apex-flow-"));
    let count = 0;
    for (const dir of dirs) {
      for (const file of fs.readdirSync(path.join(flowDir, dir)).filter((f) => f.endsWith(".ts"))) {
        const js = transpileFlowModule(dir, file);
        assert.ok(js, `${dir}/${file} ei kääntynyt`);
        // Selain ei osaa ratkaista päätteettömiä polkuja: jokaisen suhteellisen tuonnin pitää päättyä .ts ja osoittaa olemassa olevaan tiedostoon.
        for (const match of js!.matchAll(/(?:import|export)[^"'`]*?from\s*["']([^"']+)["']/g)) {
          const spec = match[1];
          assert.ok(spec.startsWith("."), `${dir}/${file}: vain suhteelliset tuonnit sallittu (${spec})`);
          assert.ok(spec.endsWith(".ts"), `${dir}/${file}: tuonnin pitää päättyä .ts (${spec})`);
          const target = path.resolve(flowDir, dir, spec);
          assert.ok(fs.existsSync(target), `${dir}/${file}: tuotua tiedostoa ei ole (${spec})`);
          assert.ok(dirs.includes(path.basename(path.dirname(target))), `${dir}/${file}: tuonti sallitun hakemiston ulkopuolelta (${spec})`);
        }
        const out = path.join(tmp, `${dir}-${file.replace(/\.ts$/, ".mjs")}`);
        fs.writeFileSync(out, js!);
        execFileSync(process.execPath, ["--check", out]);
        count += 1;
      }
    }
    assert.ok(count >= 10);
  });

  it("8. Polun ohitusyritykset hylätään", () => {
    assert.equal(transpileFlowModule("server", "routes.ts"), null);
    assert.equal(transpileFlowModule("kernel", "../server/routes.ts"), null);
    assert.equal(transpileFlowModule("kernel", "nope.ts"), null);
    assert.equal(transpileFlowModule("kernel", "types.js"), null);
  });
});
