/**
 * APEX Studio — vaiheiden 9–14 testit: kielituki, liikeidea → malli, widgetit,
 * skenaariot ja vaihteluvälit, yrittäjä, tavoitteet, tehtävät, neuvonantajat,
 * raportti, toteuma, sesongit ja kriisit.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createPreset, monteCarlo, simulate, type TimeCapacityAtom } from "../src/flow/kernel/index.ts";
import { buildView } from "../src/flow/model/view.ts";
import { applyCommands, validateCommand } from "../src/flow/model/commands.ts";
import { checklistView, emptyChecklist } from "../src/flow/model/launchpad.ts";
import { evaluate, evalFormula, parseFormula } from "../src/flow/model/formula.ts";
import { availableTemplates, buildScope, evaluateWidget, validateWidget, widgetFromTemplate } from "../src/flow/model/widgets.ts";
import { ideaToMolecule } from "../src/flow/model/genesis.ts";
import { compareScenarios, createScenario } from "../src/flow/model/scenarios.ts";
import { founderStats } from "../src/flow/model/founder.ts";
import { evaluateGoals, suggestGoal } from "../src/flow/model/goals.ts";
import { TASKS, taskStart } from "../src/flow/model/tasks.ts";
import { coachInsights } from "../src/flow/model/coach.ts";
import { ruleAdvisors } from "../src/flow/model/advisors.ts";
import { buildReport } from "../src/flow/model/report.ts";
import { compareActuals } from "../src/flow/model/actuals.ts";
import { CRISIS_LIBRARY, SEASON_PROFILES, eventFromCard } from "../src/flow/model/seasons.ts";
import { parseIntent } from "../src/flow/model/intent.ts";
import { getProvenance } from "../src/flow/model/provenance.ts";
import { money, pct } from "../src/flow/model/format.ts";
import { placeholders, setLocale, t, withLocale } from "../src/flow/i18n/index.ts";
import { EN } from "../src/flow/i18n/en.ts";
import { extractKeys } from "../scripts/i18n.ts";

const near = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `odotettiin ${b}, saatiin ${a}`);
const view = (m = createPreset("it_consultant")) => buildView(m);

describe("Vaihe 14 — sesongit ja kriisit simulaatiossa", () => {
  it("1. Kausikerroin muuttaa kuukauden myyntiä ja kirjanpito täsmää", () => {
    const m = { ...createPreset("food_kiosk"), seasonality: [...SEASON_PROFILES.summer.factors], startMonth: 0 };
    const r = simulate(m);
    near(r.reconciliationError, 0);
    assert.ok(r.months[6].revenue > r.months[0].revenue * 2, "heinäkuu selvästi tammikuuta vilkkaampi");
    assert.equal(r.months[6].calendarMonth, 6);
    near(r.months[0].seasonFactor, 0.3);
  });

  it("2. Tapahtuma vaikuttaa vain voimassaolokuukausina, kertakulu maksetaan kerran", () => {
    const base = createPreset("food_kiosk");
    const card = CRISIS_LIBRARY.find((c) => c.id === "equipment")!;
    const withEvent = { ...base, events: [eventFromCard(card, 3)] };
    const a = simulate(base);
    const b = simulate(withEvent);
    near(b.reconciliationError, 0);
    near(a.months[3].fixedCosts + 3000, b.months[3].fixedCosts);
    near(a.months[4].fixedCosts, b.months[4].fixedCosts);
    assert.deepEqual(b.months[3].activeEvents, [t(card.title)]);
    const sick = { ...base, events: [eventFromCard(CRISIS_LIBRARY.find((c) => c.id === "sick")!, 2)] };
    const s = simulate(sick);
    assert.ok(s.months[2].revenue < a.months[2].revenue * 0.3);
    near(s.months[3].revenue, a.months[3].revenue);
  });

  it("3. Tilausten uudet asiakkaat seuraavat kausivaihtelua kuukausi kerrallaan", () => {
    const m = createPreset("saas_hybrid");
    const flat = simulate(m);
    const seasonal = simulate({ ...m, seasonality: [1, 1, 1, 1, 1, 1, 0, 1, 1, 1, 1, 1] });
    near(seasonal.reconciliationError, 0);
    const sub = m.atoms[0].id;
    near(flat.months[5].byAtom[sub].volume, seasonal.months[5].byAtom[sub].volume);
    assert.ok(seasonal.months[6].byAtom[sub].volume < flat.months[6].byAtom[sub].volume, "heinäkuussa ei uusia asiakkaita");
  });

  it("4. Kriisi- ja kausikomennot validoidaan", () => {
    const m = createPreset("food_kiosk");
    assert.equal(validateCommand({ type: "set_seasonality", factors: [1, 2] }, m), null);
    assert.equal(validateCommand({ type: "add_event", event: { title: "x", startMonth: 15, durationMonths: 1, volumeChange: -0.2 } }, m), null);
    assert.equal(validateCommand({ type: "add_event", event: { title: "x", startMonth: 1, durationMonths: 1 } }, m), null, "tapahtumalla pitää olla vaikutus");
    const r = applyCommands(m, emptyChecklist(), [{ type: "add_event", event: { title: "Testi", startMonth: 1, durationMonths: 2, volumeChange: -0.5 } }]);
    assert.equal(r.molecule.events?.length, 1);
    const id = r.molecule.events![0].id;
    const r2 = applyCommands(r.molecule, r.checklist, [{ type: "remove_event", id }]);
    assert.equal(r2.molecule.events?.length, 0);
  });
});

describe("Vaihe 12 — skenaariot, vaihteluvälit, yrittäjä, tavoitteet, tehtävät", () => {
  it("5. Vaihteluvälisimulaatio on toistettava ja nollavälillä täsmälleen perusmallin mukainen", () => {
    const m = createPreset("webshop");
    const a = monteCarlo(m, { volume: 0.2, price: 0.05, variableCost: 0.1, fixedCost: 0.05 }, 200, 3);
    const b = monteCarlo(m, { volume: 0.2, price: 0.05, variableCost: 0.1, fixedCost: 0.05 }, 200, 3);
    assert.deepEqual(a, b);
    assert.ok(a.endCash.p10 <= a.endCash.p50 && a.endCash.p50 <= a.endCash.p90);
    const zero = monteCarlo(m, { volume: 0, price: 0, variableCost: 0, fixedCost: 0 }, 20, 1);
    near(zero.endCash.p10, simulate(m).endCash);
    near(zero.endCash.p90, simulate(m).endCash);
  });

  it("6. Skenaario on irrallinen kopio ja vertailu näyttää erot", () => {
    const m = createPreset("it_consultant");
    const s = createScenario("A", m);
    (m.atoms[0] as TimeCapacityAtom).hourlyRate = 120;
    assert.equal((s.molecule.atoms[0] as TimeCapacityAtom).hourlyRate, 85, "skenaario ei muutu alkuperäisen mukana");
    const rows = compareScenarios(m, "Nyt", [s]);
    assert.ok(rows[0].firstMonthProfit > rows[1].firstMonthProfit);
  });

  it("7. Yrittäjän tilanne: oma palkka, tuntipalkka ja kestävyys", () => {
    const m = createPreset("food_kiosk");
    const f = founderStats({ ...m, founder: { weeklyHours: 60, livingCostsPerMonth: 2500 } });
    assert.equal(f.ownSalary, 2200);
    assert.equal(f.salarySource, "fixed-cost");
    assert.equal(f.hoursLevel, "unsustainable");
    near(f.personalMargin, -300);
    const ins = coachInsights({ ...m, founder: { weeklyHours: 60, livingCostsPerMonth: 2500 } }, view(m), checklistView(m, view(m), emptyChecklist()), "owner");
    assert.ok(ins.some((i) => i.id === "founder-income"));
  });

  it("8. Tavoitteet arvioidaan ja ehdotettu tavoite on nykyistä parempi", () => {
    const v = view(createPreset("food_kiosk"));
    const g = suggestGoal(v, "contributionMargin");
    const [s] = evaluateGoals(v, [g]);
    assert.equal(s.ok, false, "ehdotus on hieman nykyistä parempi taso");
    const [ok] = evaluateGoals(v, [{ ...g, value: 0 }]);
    assert.equal(ok.ok, true);
  });

  it("9. Jokainen harjoitustehtävä alkaa ratkaisemattomana ja on ratkaistavissa", () => {
    const solutions: Record<string, (m: ReturnType<typeof createPreset>) => ReturnType<typeof createPreset>> = {
      "rescue-cash": (m) => ({ ...m, credit: { ...m.credit, customerTermsDays: 14 } }),
      "break-even": (m) => ({ ...m, atoms: m.atoms.map((a) => (a.kind === "TRANSACTIONAL_TRADE" ? { ...a, averageTicket: 7 } : a)) }),
      bottleneck: (m) => ({ ...m, atoms: m.atoms.map((a) => (a.kind === "TIME_CAPACITY" ? { ...a, people: 2, utilization: 0.62 } : a)) }),
      "unit-economics": (m) => ({ ...m, atoms: m.atoms.map((a) => (a.kind === "RECURRING_SUB" ? { ...a, cacPerNew: 1500 } : a)) }),
      "bad-quarter": (m) => ({ ...m, fixedCosts: m.fixedCosts.map((c) => (c.category === "marketing" ? { ...c, amountPerMonth: 600 } : c)), atoms: m.atoms.map((a) => (a.kind === "PHYSICAL_MATTER" ? { ...a, stockCoverDays: 20 } : a)) }),
      seasons: (m) => ({ ...m, fixedCosts: m.fixedCosts.map((c) => (/palkka/i.test(c.label) ? { ...c, amountPerMonth: 1200 } : c.category === "rent" ? { ...c, amountPerMonth: 500 } : c)) }),
    };
    for (const d of TASKS) {
      const start = taskStart(d.id)!;
      assert.equal(d.check(start, buildView(start), start).done, false, `${d.id} ratkesi jo alussa`);
      const solved = solutions[d.id](start);
      const c = d.check(solved, buildView(solved), start);
      assert.equal(c.done, true, `${d.id} ei ratkennut: ${c.progress}`);
    }
  });
});

describe("Vaihe 11 — omat widgetit ja turvallinen kaavakieli", () => {
  it("10. Kaavatulkki: laskujärjestys, funktiot, vertailut", () => {
    const s = { a: 2, b: 3, "time.hourlyRate": 80 };
    assert.equal(evaluate(parseFormula("a + b * 2"), s), 8);
    assert.equal(evaluate(parseFormula("(a + b) * 2"), s), 10);
    assert.equal(evaluate(parseFormula("-a ^ 2"), s), -4);
    assert.equal(evaluate(parseFormula("2 ^ 3 ^ 2"), s), 512);
    assert.equal(evaluate(parseFormula("if(a < b and not (b == 2), max(a, b, 7), 0)"), s), 7);
    assert.equal(evaluate(parseFormula("round(10 / 3, 2)"), s), 3.33);
    assert.equal(evaluate(parseFormula("time.hourlyRate * 1.1"), s), 88);
    assert.ok(Number.isNaN(evaluate(parseFormula("a / 0"), s)));
  });

  it("11. Kaavatulkki ei suorita koodia eikä tunne muita nimiä", () => {
    for (const bad of ["constructor", "__proto__", "process.exit(1)", "a; b", "alert(1)", "a = 1", "`x`", "a[0]", "x => x", "'s'"]) {
      assert.ok(evalFormula(bad, { a: 1, b: 1 }).error, `kaava "${bad}" pitäisi hylätä`);
    }
    assert.ok(evalFormula("1+".repeat(300) + "1", {}).error, "liian pitkä kaava hylätään");
  });

  it("12. Kaikki pohjat toimivat kaikilla esimerkeillä, ja kaaviot laskevat 12 kuukautta", () => {
    for (const id of ["it_consultant", "food_kiosk", "saas_hybrid", "webshop"] as const) {
      const m = createPreset(id);
      const v = buildView(m);
      const ctx = { molecule: m, view: v, scope: buildScope(m, v) };
      for (const tpl of availableTemplates(m)) {
        const r = widgetFromTemplate(tpl.id, m, v);
        assert.ok(r.spec, `${id}/${tpl.id}: ${r.error}`);
        const ev = evaluateWidget(r.spec!, ctx);
        assert.equal(ev.error, null, `${id}/${tpl.id}: ${ev.error}`);
        if (ev.kind === "chart") assert.equal(ev.series[0].values.length, 12);
      }
    }
  });

  it("13. Kielimallin kuvaus hylätään, jos se viittaa tuntemattomaan muuttujaan tai ei-muokattavaan kohteeseen", () => {
    const m = createPreset("it_consultant");
    const v = buildView(m);
    assert.ok(validateWidget({ kind: "metric", title: "x", formula: "goods.unitPrice * 2", format: "eur" }, m, v, "ai").error, "kauppa-atomia ei ole");
    assert.ok(validateWidget({ kind: "lever", title: "x", target: "time.revenue" }, m, v, "ai").error, "laskettu luku ei ole vipu");
    assert.ok(validateWidget({ kind: "chart", title: "x", series: [{ label: "a", formula: "month.profit" }] }, m, v, "ai").spec);
    assert.ok(validateWidget({ kind: "metric", title: "x", formula: "month.profit" }, m, v, "ai").error, "kuukausimuuttuja vain kaavioissa");
    assert.ok(validateWidget({ kind: "script", title: "x", code: "alert(1)" }, m, v, "ai").error);
  });
});

describe("Vaihe 10 — liikeidea omin sanoin", () => {
  it("14. Sääntöpohjainen tulkki tunnistaa tulovirrat, kausivaihtelun, alkupääoman ja hinnan", () => {
    const ice = ideaToMolecule("Avaan jäätelökioskin Helsingin rantaan. Alkupääoma 6 000 €");
    assert.deepEqual(ice.molecule.atoms.map((a) => a.kind), ["TRANSACTIONAL_TRADE"]);
    assert.equal(ice.molecule.credit.openingCash, 6000);
    assert.deepEqual(ice.molecule.seasonality, SEASON_PROFILES.summer.factors);
    assert.equal(getProvenance(ice.molecule, "credit:openingCash")?.source, "genesis");
    const free = ideaToMolecule("Freelance graafinen suunnittelija, tuntihinta 75 €");
    assert.equal((free.molecule.atoms[0] as TimeCapacityAtom).hourlyRate, 75);
    const hybrid = ideaToMolecule("Ohjelmistoyritys: SaaS-sovellus kuntosaleille ja käyttöönottokonsultointi");
    assert.deepEqual(new Set(hybrid.kinds), new Set(["TIME_CAPACITY", "RECURRING_SUB"]));
    const en = ideaToMolecule("I want to open a café in Tampere with savings of 8000");
    assert.equal(en.kinds[0], "TRANSACTIONAL_TRADE");
    assert.equal(en.molecule.credit.openingCash, 8000);
    assert.ok(Math.abs(simulate(hybrid.molecule).reconciliationError) < 1e-6);
    assert.ok(hybrid.molecule.fixedCosts.length >= 2, "kiinteät kulut mukana alusta asti");
  });
});

describe("Vaihe 13 — neuvonantajat, alkuperä, raportti, toteuma", () => {
  it("15. Neljä neuvonantajaa, jokaisella luvuilla perusteltu näkemys", () => {
    const m = createPreset("it_consultant");
    const v = buildView(m);
    const adv = ruleAdvisors(m, v, coachInsights(m, v, checklistView(m, v, emptyChecklist()), "owner"));
    assert.deepEqual(adv.map((a) => a.role), ["cfo", "sales", "ops", "people"]);
    assert.equal(adv[0].stance, "alarm", "kassa loppuu → talousjohtaja hälyttää");
    assert.ok(adv.every((a) => a.points.length > 0));
  });

  it("16. Komennot tallentavat lukujen alkuperän lähdeosoitteineen", () => {
    const m = createPreset("it_consultant");
    const id = m.atoms[0].id;
    const r = applyCommands(m, emptyChecklist(), [{ type: "set_atom_field", atomId: id, field: "hourlyRate", value: 95 }], { source: "market", url: "https://example.org/hinnat", note: "alan keskitaso" });
    const p = getProvenance(r.molecule, `${id}:hourlyRate`);
    assert.equal(p?.source, "market");
    assert.equal(p?.url, "https://example.org/hinnat");
  });

  it("17. Raportti sisältää pääkohdat, oletukset alkuperineen ja rajoitukset", () => {
    const m = { ...createPreset("food_kiosk"), events: [eventFromCard(CRISIS_LIBRARY[0], 2)] };
    const md = buildReport({ molecule: m, checklist: emptyChecklist(), scenarios: [createScenario("B", createPreset("food_kiosk"))] });
    for (const h of ["## Yhteenveto", "## Tulovirrat", "## 12 kuukauden laskelma", "### Stressitestit", "## Kausivaihtelu ja tapahtumat", "## Skenaarioiden vertailu", "## Oletukset ja niiden alkuperä", "## Laskelman rajoitukset"]) {
      assert.ok(md.includes(h), `raportista puuttuu ${h}`);
    }
    assert.equal(md.split("\n").filter((l) => /^\| (1[0-2]|[1-9])( \([^)]*\))? \|/.test(l)).length, 12);
  });

  it("18. Toteuma verrataan suunnitelman kuukausiin", () => {
    const m = createPreset("it_consultant");
    const c = compareActuals(simulate(m), [
      { month: "2026-01", income: 0, expenses: 3900, nonOperating: 0, endBalance: 1100 },
      { month: "2026-02", income: 8000, expenses: 3900, nonOperating: 0, endBalance: 5200 },
    ]);
    assert.equal(c.rows.length, 2);
    assert.ok(c.rows[0].revenueDiff < 0);
    near(c.totalActualProfit, 8000 - 7800);
  });
});

describe("Vaihe 9 — kielituki", () => {
  it("19. Puuttuva käännös näyttää suomen, paikkamerkit täytetään", () => {
    assert.equal(withLocale("en", () => t("Tätä tekstiä ei ole käännetty {n}", { n: 3 })), "Tätä tekstiä ei ole käännetty 3");
    assert.equal(t("Kassa loppuu päivänä {day}.", { day: 45 }), "Kassa loppuu päivänä 45.");
  });

  it("20. Luvut muotoillaan kielen mukaan", () => {
    assert.equal(withLocale("fi", () => money(-2800)), "−2\u00a0800 €");
    assert.equal(withLocale("en", () => money(-2800)), "−€2,800");
    assert.equal(withLocale("en", () => pct(0.25)), "25%");
    assert.equal(withLocale("fi", () => pct(0.25)), "25 %");
  });

  it("21. Englanninkieliset pyynnöt ymmärretään ilman kielimallia", () => {
    const m = createPreset("it_consultant");
    assert.equal(parseIntent("raise prices by 10%", m).commands[0].type, "scale_atom_field");
    assert.deepEqual(parseIntent("payment terms 14 days", m).commands[0], { type: "set_credit", field: "customerTermsDays", value: 14 });
    assert.equal(parseIntent("What if sales drop 20%?", m).commands[0].type, "stress");
    assert.equal(parseIntent("hire a new consultant", m).commands[0].type, "set_atom_field");
    assert.equal(parseIntent("add cost office 600 €", m).commands[0].type, "add_fixed_cost");
    assert.equal(withLocale("en", () => parseIntent("payment terms 14 days", m).reply).includes("päivää"), Object.keys(EN).length === 0);
  });

  it("22. Käännösten paikkamerkit täsmäävät lähdetekstiin", () => {
    for (const [fi, en] of Object.entries(EN)) {
      assert.deepEqual(placeholders(en), placeholders(fi), `paikkamerkit eivät täsmää: ${fi}`);
    }
  });

  it("23. Kaikki käyttöliittymän tekstit on käännetty (englanti saa jäädä jälkeen: puuttuvat merkitään tehtäväksi)", (tc) => {
    const keys = extractKeys();
    const missing = [...keys.keys()].filter((k) => !(k in EN));
    if (missing.length > 0) tc.todo(`${missing.length} tekstiä kääntämättä – aja npm run i18n:translate`);
    assert.ok(keys.size > 500);
  });

  it("24. Käyttöliittymä- ja mallikoodissa ei ole kovakoodattuja suomenkielisiä tekstejä t()-kutsun ulkopuolella", () => {
    const dirs = ["src/flow/client", "src/flow/model", "src/flow/kernel"];
    const allow = new Set(["src/flow/model/format.ts"]);
    const offenders: string[] = [];
    for (const dir of dirs) {
      for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".ts"))) {
        const rel = path.join(dir, f);
        if (allow.has(rel)) continue;
        const src = fs.readFileSync(rel, "utf-8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
        for (const m of src.matchAll(/(["'])((?:(?!\1)[^\\\n]|\\.)*[äöÄÖ](?:(?!\1)[^\\\n]|\\.)*)\1/g)) {
          const before = src.slice(Math.max(0, m.index! - 6), m.index!);
          if (/\b(?:t|msg)\(\s*$/.test(before)) continue;
          offenders.push(`${rel}: ${m[0].slice(0, 60)}`);
        }
      }
    }
    assert.deepEqual(offenders, []);
  });
});

setLocale("fi");
