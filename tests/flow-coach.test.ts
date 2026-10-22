/**
 * APEX Flow — valmentajan, komentojen, persoonien ja komentotulkin testit (vaihe D).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createPreset, simulate, type TimeCapacityAtom } from "../src/flow/kernel/index.ts";
import { buildView } from "../src/flow/model/view.ts";
import { checklistView, emptyChecklist } from "../src/flow/model/launchpad.ts";
import { applyCommands, validateCommand } from "../src/flow/model/commands.ts";
import { coachInsights } from "../src/flow/model/coach.ts";
import { parseIntent } from "../src/flow/model/intent.ts";
import { boundaryMessages, lensHeadlines, leversForLens } from "../src/flow/model/personas.ts";
import { leversFor } from "../src/flow/model/levers.ts";
import { handleChat } from "../src/flow/server/chat.ts";

const insightsFor = (m = createPreset("it_consultant"), persona: "founder" | "owner" | "student" = "founder") => {
  const v = buildView(m);
  return coachInsights(m, v, checklistView(m, v, emptyChecklist()), persona);
};

describe("APEX Flow — komennot (In-Flight Mutation)", () => {
  it("1. Kelvottomat komennot hylätään: tuntematon atomi, kenttä, tyyppi tai arvo", () => {
    const m = createPreset("it_consultant");
    const id = m.atoms[0].id;
    assert.equal(validateCommand({ type: "set_atom_field", atomId: "nope", field: "hourlyRate", value: 1 }, m), null);
    assert.equal(validateCommand({ type: "set_atom_field", atomId: id, field: "unitPrice", value: 1 }, m), null, "väärän atomityypin kenttä");
    assert.equal(validateCommand({ type: "set_atom_field", atomId: id, field: "hourlyRate", value: "100" }, m), null);
    assert.equal(validateCommand({ type: "eval", code: "x" }, m), null);
    assert.equal(validateCommand({ type: "set_credit", field: "customerTermsDays", value: 9999 }, m), null);
    assert.equal(validateCommand({ type: "remove_atom", atomId: id }, m), null, "viimeistä tulovirtaa ei voi poistaa");
    assert.equal(validateCommand({ type: "checklist", id: "buffer", checked: true }, m), null, "automaattista kohtaa ei voi ruksata");
    assert.ok(validateCommand({ type: "set_atom_field", atomId: id, field: "hourlyRate", value: 99 }, m));
  });

  it("2. Komennot soveltuvat järjestyksessä ja säilyttävät kirjanpidon täsmäytyksen", () => {
    const m = createPreset("food_kiosk");
    const r = applyCommands(m, emptyChecklist(), [
      { type: "add_atom", kind: "TRANSACTIONAL_TRADE", label: "Wolt-kotiinkuljetus", params: { visitorsPerDay: 200, conversionRate: 0.05, averageTicket: 14, costPerSale: 3.2 + 0.3 * 14, capacityPerDay: null } },
      { type: "add_fixed_cost", label: "Pakkausmateriaalit", amountPerMonth: 120 },
      { type: "bogus" },
      { type: "checklist", id: "yel", checked: true },
    ]);
    assert.equal(r.molecule.atoms.length, 2);
    assert.equal(r.molecule.atoms[1].label, "Wolt-kotiinkuljetus");
    assert.equal(r.rejected, 1);
    assert.equal(r.applied.length, 3);
    assert.equal(r.checklist.items.yel?.checked, true);
    assert.ok(Math.abs(simulate(r.molecule).reconciliationError) < 1e-6);
  });
});

describe("APEX Flow — valmentaja", () => {
  it("3. Konsultille valmentaja nostaa kassakriisin ensimmäiseksi ja tarjoaa toimivan maksuajan", () => {
    const list = insightsFor();
    assert.equal(list[0].id, "cash-out");
    const termsAction = list[0].actions.find((a) => a.commands[0].type === "set_credit" && (a.commands[0] as { field: string }).field === "customerTermsDays");
    assert.ok(termsAction, "maksuaikaehdotus puuttuu");
    const m = createPreset("it_consultant");
    const r = applyCommands(m, emptyChecklist(), termsAction!.commands);
    assert.equal(simulate(r.molecule).cashOutDay, null, "ehdotettu maksuaika pelastaa kassan");
  });

  it("4. Pullonkaula ja rekry: kun kysyntä ylittää kapasiteetin selvästi, valmentaja ehdottaa palkkausta", () => {
    const m = createPreset("it_consultant");
    (m.atoms[0] as TimeCapacityAtom).demandHoursPerMonth = 200;
    const b = insightsFor(m).find((i) => i.id === "bottleneck");
    assert.ok(b);
    assert.ok(b!.actions.some((a) => a.label.includes("Palkkaa")));
  });

  it("5. Terveelle mallille annetaan positiivinen palaute ja stressitestiehdotus", () => {
    const m = createPreset("webshop");
    const list = insightsFor(m, "owner");
    assert.ok(list.some((i) => i.severity === "good"));
  });

  it("6. Tilausliiketoiminnan yksikkötalous tarkistetaan", () => {
    const m = createPreset("saas_hybrid");
    const list = insightsFor(m, "owner");
    // 149 − 12 = 137 €/kk kate, CAC 400 → takaisinmaksu ~2,9 kk ja LTV/CAC > 3 → ei varoitusta.
    assert.ok(!list.some((i) => i.id === "unit-economics"));
    const sub = m.atoms[0] as { cacPerNew: number };
    sub.cacPerNew = 3000;
    assert.ok(insightsFor(m, "owner").some((i) => i.id === "unit-economics"));
  });
});

describe("APEX Flow — komentotulkki ilman kielimallia", () => {
  const m = createPreset("it_consultant");
  it("7. Ymmärtää hinnan, maksuajan, rekryn, kulun, uuden tulovirran ja stressitestin", () => {
    const price = parseIntent("Nosta hintaa 10 %", m);
    assert.equal(price.commands[0].type, "scale_atom_field");
    const abs = parseIntent("tuntihinta 95 €", m);
    assert.deepEqual(abs.commands[0], { type: "set_atom_field", atomId: m.atoms[0].id, field: "hourlyRate", value: 95 });
    assert.deepEqual(parseIntent("Maksuaika 14 päivää", m).commands[0], { type: "set_credit", field: "customerTermsDays", value: 14 });
    assert.equal(parseIntent("Palkkaa uusi työntekijä", m).commands[0].type, "set_atom_field");
    const cost = parseIntent("Lisää kulu toimisto 600 €", m).commands[0];
    assert.equal(cost.type, "add_fixed_cost");
    const sub = parseIntent("Lisää kuukausisopimukset 300 € / kk", m).commands[0];
    assert.equal(sub.type, "add_atom");
    assert.equal((sub as { params: Record<string, number> }).params.pricePerMonth, 300);
    assert.equal(parseIntent("Mitä jos myynti putoaa 20 %?", m).commands[0].type, "stress");
    assert.equal(parseIntent("kerro vitsi", m).understood, false);
  });

  it("8. Palvelimen chat hylkää virheellisen pyynnön ilman kielimallikutsua", async () => {
    const r = await handleChat({ message: "", molecule: m });
    assert.equal(r.commands.length, 0);
    const r2 = await handleChat({ message: "hei", molecule: { atoms: "x" } });
    assert.equal(r2.commands.length, 0);
  });
});

describe("APEX Flow — persoonat ja osa-alueet", () => {
  it("9. Myynnin näkökulma näyttää vain myynnin vivut ja kertoo rajapinnan seuraukset", () => {
    const m = createPreset("it_consultant");
    (m.atoms[0] as TimeCapacityAtom).demandHoursPerMonth = 150;
    const v = buildView(m);
    const sales = leversForLens(leversFor(m), "sales").map((l) => l.field);
    assert.ok(sales.includes("hourlyRate"));
    assert.ok(!sales.includes("utilization"), "laskutusaste kuuluu toimitukselle");
    const heads = lensHeadlines(v, "sales");
    assert.equal(heads[2].status, "alert", "kysyntää jää myymättä");
    const msgs = boundaryMessages(v, "sales");
    assert.ok(msgs.some((t) => t.startsWith("Toimitus:")));
    assert.ok(boundaryMessages(v, "all").length === 0);
  });
});
