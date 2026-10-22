/**
 * APEX Flow — tiliotteen tuonnin testit (vaihe E).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createPreset, simulate, totalFixedCostsPerMonth } from "../src/flow/kernel/index.ts";
import { analyzeStatement, defaultSelection, importCommands, parseAmount, parseDate, parseStatementCsv } from "../src/flow/model/importer.ts";
import { applyCommands } from "../src/flow/model/commands.ts";
import { emptyChecklist } from "../src/flow/model/launchpad.ts";

const OP_CSV = `Kirjauspäivä;Arvopäivä;Määrä EUROA;Laji;Selitys;Saaja/Maksaja;Saajan tilinumero;Saajan pankin BIC;Viite;Viesti;Arkistointitunnus
02.01.2026;02.01.2026;-250,00;106;TILISIIRTO;Coworking Hub Oy;FI00;OKOYFIHH;;Tammikuun vuokra;A1
05.01.2026;05.01.2026;-149,90;106;TILISIIRTO;Tilitoimisto Numero Ky;FI00;OKOYFIHH;;Kirjanpito tammikuu;A2
10.01.2026;10.01.2026;-59,99;162;KORTTIOSTO;ADOBE SYSTEMS;;;;;A3
15.01.2026;15.01.2026;+6 800,00;710;TILISIIRTO;Asiakas Alpha Oy;;;;Lasku 1001;A4
20.01.2026;20.01.2026;-1 200,00;106;TILISIIRTO;Verohallinto;;;;Ennakkovero;A5
22.01.2026;22.01.2026;-899,00;162;KORTTIOSTO;Verkkokauppa.com;;;;Näyttö;A6
02.02.2026;02.02.2026;-250,00;106;TILISIIRTO;Coworking Hub Oy;FI00;OKOYFIHH;;Helmikuun vuokra;B1
05.02.2026;05.02.2026;-149,90;106;TILISIIRTO;Tilitoimisto Numero Ky;FI00;OKOYFIHH;;Kirjanpito helmikuu;B2
10.02.2026;10.02.2026;-59,99;162;KORTTIOSTO;ADOBE SYSTEMS;;;;;B3
14.02.2026;14.02.2026;+7 400,00;710;TILISIIRTO;Asiakas Beta Oy;;;;Lasku 1002;B4
20.02.2026;20.02.2026;-1 200,00;106;TILISIIRTO;Verohallinto;;;;Ennakkovero;B5`;

const NORDEA_CSV = `"Kirjauspäivä","Määrä","Maksaja","Maksunsaaja","Nimi","Otsikko","Viitenumero","Valuutta","Saldo"
"2026/03/01","-900,00","","Kiinteistö Oy Torikatu","Kiinteistö Oy Torikatu","Vuokra maaliskuu","","EUR","4 100,00"
"2026/03/03","1 250,50","Kassa","","Korttimaksut","Tilitys","","EUR","5 350,50"
"2026/04/01","-900,00","","Kiinteistö Oy Torikatu","Kiinteistö Oy Torikatu","Vuokra huhtikuu","","EUR","4 450,50"
"2026/04/03","1 100,00","Kassa","","Korttimaksut","Tilitys","","EUR","5 550,50"`;

describe("APEX Flow — tiliotteen tuonti", () => {
  it("1. Suomalaiset summa- ja päivämäärämuodot", () => {
    assert.equal(parseAmount("-1 234,56"), -1234.56);
    assert.equal(parseAmount("+6\u00a0800,00"), 6800);
    assert.equal(parseAmount("1.234,56"), 1234.56);
    assert.equal(parseAmount("−12,5"), -12.5);
    assert.equal(parseAmount(""), null);
    assert.equal(parseDate("5.1.2026"), "2026-01-05");
    assert.equal(parseDate("2026/03/01"), "2026-03-01");
    assert.equal(parseDate("31.12.25"), "2025-12-31");
  });

  it("2. OP-muotoinen tiliote: toistuvat kulut tunnistetaan, verot ja kertaostot jätetään pois", () => {
    const p = parseStatementCsv(OP_CSV);
    assert.equal(p.error, null);
    assert.equal(p.transactions.length, 11);
    const a = analyzeStatement(p.transactions);
    assert.equal(a.monthsCovered, 2);
    assert.equal(a.avgMonthlyIncome, (6800 + 7400) / 2);
    const labels = a.recurring.map((r) => r.label);
    assert.ok(labels.some((l) => /Coworking/.test(l)));
    assert.ok(labels.some((l) => /Tilitoimisto/.test(l)));
    assert.ok(labels.some((l) => /ADOBE/i.test(l)));
    assert.ok(!labels.some((l) => /Verohallinto|Verkkokauppa/.test(l)), "verot ja kertaostot eivät ole kiinteitä kuluja");
    assert.equal(a.recurring.find((r) => /Coworking/.test(r.label))!.category, "rent");
    assert.equal(a.oneOffTotal, 899);
    assert.equal(a.nonOperatingTotal, 2400);
  });

  it("3. Nordea-muoto lainausmerkeillä ja saldolla", () => {
    const p = parseStatementCsv(NORDEA_CSV);
    assert.equal(p.error, null);
    const a = analyzeStatement(p.transactions);
    assert.equal(a.lastBalance, 5550.5);
    assert.equal(a.recurring.length, 1);
    assert.equal(a.recurring[0].monthlyAmount, 900);
  });

  it("4. Hyväksytyt ehdotukset muuttuvat validoiduiksi komennoiksi ja malli täsmää", () => {
    const m = createPreset("it_consultant");
    const a = analyzeStatement(parseStatementCsv(OP_CSV).transactions);
    const cmds = importCommands(m, a, { costKeys: a.recurring.map((r) => r.key), calibrateRevenue: true, useBalance: false, saveActuals: false });
    const r = applyCommands(m, emptyChecklist(), cmds);
    assert.equal(r.rejected, 0);
    assert.ok(totalFixedCostsPerMonth(r.molecule) > totalFixedCostsPerMonth(m));
    const time = r.molecule.atoms[0] as { demandHoursPerMonth: number };
    assert.equal(time.demandHoursPerMonth, Math.round(7100 / 85));
    assert.ok(Math.abs(simulate(r.molecule).reconciliationError) < 1e-6);
  });

  it("5. Mallissa jo olevaa vastaavaa kulua ei valita oletuksena (ei tuplakuluja)", () => {
    const m = createPreset("it_consultant"); // sisältää "Työtila 250 €" (rent)
    const a = analyzeStatement(parseStatementCsv(OP_CSV).transactions);
    const sel = defaultSelection(m, a);
    const coworking = a.recurring.find((r) => /Coworking/.test(r.label))!;
    assert.ok(!sel.costKeys.includes(coworking.key));
    assert.ok(sel.costKeys.length >= 2);
  });

  it("6. Tunnistamaton tiedosto antaa selkeän virheen", () => {
    assert.match(parseStatementCsv("foo,bar\n1,2").error ?? "", /sarakkeita/);
    assert.match(parseStatementCsv("").error ?? "", /tapahtumia/i);
  });
});
