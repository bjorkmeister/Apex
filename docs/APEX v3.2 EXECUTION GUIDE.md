# TEHTÄVÄ: Toteuta APEX Studio v3.2 -arkkitehtuuri (Vaiheet V1–V6)

Olet johtava järjestelmäarkkitehti ja pääkehittäjä. Tehtäväsi on toteuttaa **APEX Studio v3.2** -arkkitehtuuri vaiheittain, deterministisesti ja ilman regressioita. Nykyinen v2-perusta (vaiheet 1–14, 85/85 testiä) on valmis ja toimiva[cite: 2, 3, 4].

ÄLÄ arvaa, älä oio mutkia äläkä kirjoita koodia ennen kuin olet lukenut kontekstiankkurit ja muodostanut vaihekohtaisen toteutussuunnitelman (Implementation Plan)[cite: 1, 2, 4].

---

## 1. KONTEKSTIANKKURIT (Lue nämä tiedostot ensin)

Ennen ensimmäistäkään koodimuutosta lue ja analysoi seuraavat tiedostot tässä järjestyksessä[cite: 1, 2, 3, 4]:

1. **Arkkitehtuuri- ja määrittelydokumentit:**
   - `docs/APEX_TECHNICAL_SPECIFICATION_DOCUMENT.md` (Ensisijainen totuuslähde: TSD v3.2-PRO-SPEC)[cite: 1, 4]
   - `docs/SUUNNITELMA_JA_TIEKARTTA.md` & `docs/ROADMAP_AND_ARCHITECTURAL_BLUEPRINT.md` (Tiekartta V1–V7 ja roolimatriisi)[cite: 1, 2, 3]
2. **Nykyinen laskentaydin ja lokalisointi (`src/flow/`):**
   - `src/flow/kernel/types.ts`, `src/flow/kernel/atoms.ts`, `src/flow/kernel/simulate.ts`, `src/flow/kernel/presets.ts`, `src/flow/kernel/sensitivity.ts`, `src/flow/kernel/stress.ts`, `src/flow/kernel/events.ts`[cite: 1, 4]
   - `src/flow/i18n/index.ts`, `src/flow/i18n/en.ts`, `src/flow/i18n/glossary.ts` sekä `scripts/i18n.ts`[cite: 1, 2, 4]
3. **Nykyinen toimialamalli, palvelin ja käyttöliittymä (`src/flow/`):**
   - `src/flow/model/formula.ts`, `src/flow/model/provenance.ts`, `src/flow/model/commands.ts`, `src/flow/model/intent.ts`, `src/flow/model/genesis.ts`, `src/flow/model/launchpad.ts`, `src/flow/model/personas.ts`, `src/flow/model/scenarios.ts`, `src/flow/model/coach.ts`, `src/flow/model/advisors.ts`, `src/flow/model/importer.ts`, `src/flow/model/actuals.ts`, `src/flow/model/widgets.ts`, `src/flow/model/report.ts`[cite: 1, 4]
   - `src/flow/client/app.ts`, `src/flow/client/canvas.ts`, `src/flow/client/drawer.ts`, `src/flow/client/tools.ts`, `src/flow/client/coach.ts`, `src/flow/client/launchpad.ts`, `src/flow/client/widgets.ts`, `src/flow/client/importer.ts`[cite: 1, 4]
   - `src/flow/server/page.ts`, `src/flow/server/routes.ts`, `src/flow/server/ai.ts`, `src/flow/server/chat.ts`[cite: 1, 4]
4. **Classicista siirrettävät viitetoteutukset (`src/app/`, `src/components/`, `src/core/`):**
   - `src/app/styles.ts`, `src/app/war-room-view.ts`, `src/app/server.ts`[cite: 1, 4]
   - `src/components/ValueChainCanvas.ts`, `src/components/FinancialTelemetryDrawer.ts`, `src/components/WarehouseAndOpsDrawer.ts`, `src/components/OrgAndCapabilityDrawer.ts`, `src/components/TimelineBranchBar.ts`, `src/components/WarRoomDebatePanel.ts`, `src/components/CrisisModal.ts`[cite: 1, 4]
   - `src/core/engine/ledger.ts` (pääkirjalogiikka irrotettavaksi) sekä `src/core/llm/client.ts` ja `src/core/llm/orchestrator.ts`[cite: 1, 4]

---

## 2. KANONISET YLIAJOT (Spec Conflict Overrides)

Dokumentaatiossa on muutamia vanhempien versioiden tekstijäänteitä[cite: 2, 4]. Kun kohtaat ristiriidan vanhan taulukkotekstin ja v3.2-invarianttien (TSD luku 1.2 P1–P9, luku 1.3 A1–A4 ja luku 12 #1–17) välillä, **noudata poikkeuksetta näitä seitsemää kanonista sääntöä**[cite: 2, 4]:

1. **Yliajo 1 — Yksi ainoa solmumalli (Invariantti A1 kumoaa TSD 3.1, 7 & 9.1 `atomToSubgraph`-maininnat):**
   - ÄLÄ toteuta `atomToSubgraph`-funktiota äläkä ylläpidä kahta rinnakkaista solmumallia.
   - `UniversalEnterpriseNode` on ainoa solmutyyppi kankaalla ja tallennetussa mallissa[cite: 4].
   - Viisi perusatomia (`time_capacity`, `physical_matter`, `recurring_subscription`, `transactional_trade`, `credit_working_capital`) ovat solmun sisäisiä fysiikkamoduuleita (`node.physics: PhysicsModule[]`), jotka kutsuvat `src/flow/kernel/atoms.ts`:n puhtaita laskentafunktioita[cite: 4].
   - Toteuta `migrateMoleculeToGraph`, joka muuntaa vanhan molekyylimallin `EnterpriseGraph`-muotoon[cite: 4]. Molekyylimalli säilyy vain tuonti- ja migraatiomuotona[cite: 4].
2. **Yliajo 2 — Launchpad on kankaan päällä toimiva valmentaja (Invariantti A2 kumoaa TSD 7 & 9.1 "Genesis 6–8" -maininnat):**
   - ÄLÄ siirrä `launchpad.ts`:ää Genesis-velhon vaiheisiin 6–8 eikä toiseksi aloitusvelhoksi[cite: 4].
   - Launchpad on kankaan päällä toimiva interaktiivinen tarkistuslista ja valmentaja[cite: 4].
   - Tasoilla `maturity: 0 | 1` Launchpadin tehtävät johdetaan suoraan aukkoanalyysistä (`gaps.ts`)[cite: 4]. Tasoilla `maturity: 2 | 3` jokainen Launchpad-valinta on kytkentä, joka ajaa paikallisen, kumottavan `GraphCommand`-komennon (<16 ms) ja muuttaa kohdesolmun/virran ICOM-porttia, `FactorNode`-arvoa, `latencyTicks`-viivettä tai `MechanismBinding`-kytkentää[cite: 4].
3. **Yliajo 3 — Operatiivisen syklin ja maksuajan erottaminen fysiikkamoduuleissa (TSD 6.3 tarkennus):**
   - Kun lehtisolmulla on useita `PhysicsModule`-moduuleita (esim. `time_capacity` + `credit_working_capital`), pidä operatiivinen läpimenoaika (`cycleTicks`) ja kassaviive (`cash[].delayTicks` / DSO) tiukasti erillään[cite: 4].
   - Maksuaika (`credit_working_capital`) EI SAA hidastaa solmun operatiivista kapasiteettia (`capacityPerTick`) eikä kasvattaa fyysistä WIP-jonoa (Littlen laki), vaan se viivästyttää ainoastaan rahavirtaa ja myyntisaamisten/ostovelkojen tilitystä[cite: 4].
4. **Yliajo 4 — Keskeneräisten ja Ghost-solmujen topologinen käsittely (TSD 1.3 A4, 4.4 & 6.5 #6):**
   - Solmuja, joiden `definition` on `"named"` tai `"unknown"` TAI joissa `ghost?.status === "pending"`, EI lasketa simulaatiossa: ne eivät kuluta syötteitä, eivät tuota virtoja, eivät kerrytä kuluja eivätkä tee pääkirjakirjauksia[cite: 4].
   - Niiden lukuja ei koskaan korvata oletusarvoilla eikä niitä lasketa kassaan, pääkirjaan, KPI-nauhaan, kipurajoihin, Monte Carloon tai raporttiin[cite: 4].
   - Jos `defined`-solmuun tuleva virta lähtee `named`-, `unknown`- tai `ghost`-solmusta, merkitse virta katkenneeksi (`stub`) ja nosta se esiin `gaps.ts`-aukkoanalyysissä sekä telemetriassa ("Ei laskettu: odottaa ylävirran määrittelyä"), jotta alavirran solmu ei näytä harhaanjohtavasti nollakysyntää[cite: 4].
5. **Yliajo 5 — Määritelmä ≠ Ajonaikainen tila ≠ Indeksi (TSD 3.2 & 12 #4–5):**
   - `EnterpriseGraph` on ainoa tallennettava, versioitava ja haarautettava tietorakenne[cite: 4].
   - ÄLÄ KOSKAAN tallenna ajonaikaisia jonoja, varastosaldoja, laskettuja odotusaikoja tai käänteisviittauksia (`usedBy`) `EnterpriseGraph`-olioihin[cite: 4].
   - Johda `EntityRegistry` (`buildRegistry(graph)`) ja `SimulationRun` aina deterministisesti määritelmästä[cite: 4].
6. **Yliajo 6 — Tiekartan ensisijaisuus (`SUUNNITELMA_JA_TIEKARTTA.md`):**
   - Luvun 4 taulukko **V1–V7** (identtinen `ROADMAP_AND_ARCHITECTURAL_BLUEPRINT.md` luvun 8 kanssa) on ainoa aktiivinen toteutussuunnitelma[cite: 2, 3]. Luvun 1 vanha U0–U8-taulukko kuvaa jo valmistuneita v2-vaiheita 10–14[cite: 2].
7. **Yliajo 7 — Jaetut LLM-palvelut (`src/core/llm/`):**
   - Vaikka `src/core/engine/`, `src/core/schema/`, `src/core/compiler/` ja `src/core/agents/` poistetaan vaiheessa V6, säilytä `src/core/llm/client.ts` (ja tarvittavat BYOK-apuohjelmat) tai siirrä ne hallitusti jaetuksi kerrokseksi ennen V6-poistoa, sillä Flow ja `scripts/i18n.ts` käyttävät yhteistä kielimalliasiakasta[cite: 1, 2, 4].

---

## 3. EHDOTTOMAT TEKNISET REUNAEHDOT (Strict Constraints)

1. **Type-Stripping -yhteensopivuus (Node & Browser):**
   - Projekti käyttää kevyttä TypeScript-lataajaa (`scripts/ts-loader.mjs`, `scripts/register-loader.mjs`) ja suoraa tyyppien riisuntaa selainkoodissa[cite: 1, 4].
   - ÄLÄ käytä `enum`-, `namespace`- tai konstruktorin `public/private`-parametrimääreitä `src/flow/`-koodissa[cite: 4]. Käytä pelkästään `interface`- ja `type`-unioneita (esim. `export type PortSide = "I" | "C" | "O" | "M";`)[cite: 4].
   - `src/flow/graph/` ei saa tuoda Node.js-spesifejä moduuleita (`fs`, `path`, `crypto`), jotta sama koodi toimii sekä selaimessa (ja Web Workerissa) että Node-testeissä[cite: 4].
2. **Ehdoton toimiala-agnostisuus (P1):**
   - `src/flow/graph/`-skeemoissa, kääntäjässä (`compiler.ts`) ja simulaattorissa (`simulate.ts`) ei saa esiintyä yhtäkään toimialasanaa tai -enumia (esim. `restaurant`, `nakkikioski`, `saas`, `consulting`, `factory`, `pos`, `crm`, `erp`, `summer_peak`)[cite: 4].
   - Kaikki toimialaesimerkit ja kyvykkyyspohjat (`src/flow/graph/capabilities/`) ovat puhdasta dataa[cite: 4]. Kirjoita automaattinen testi, joka skannaa `src/flow/graph/`-logiikkatiedostot kiellettyjen toimialasanojen varalta[cite: 4].
3. **Kielituki ja lokalisointi (P7):**
   - Tarkista `src/flow/i18n/index.ts`, `src/flow/i18n/en.ts` ja `src/flow/i18n/glossary.ts`[cite: 1].
   - Jokainen uusi tai Classicista siirretty käyttöliittymäteksti on vietävä `t()`-käännösfunktion kautta[cite: 2, 4]. Koodissa ei saa olla yhtäkään kovakoodattua käyttöliittymämerkkijonoa[cite: 2, 4].
   - Kun siirrät Classicin paneeleita (`FinancialTelemetryDrawer.ts`, `WarehouseAndOpsDrawer.ts`, `OrgAndCapabilityDrawer.ts`, `TimelineBranchBar.ts`, `WarRoomDebatePanel.ts`, `CrisisModal.ts`), siirrä niiden **visuaalinen rakenne ja CSS-tokenit**, mutta kirjoita datakytkennät ja tekstit uudelleen `t()`-kutsuilla[cite: 1, 4].
4. **Ei uusia npm-riippuvuuksia:**
   - Älä muokkaa `package.json`:n riippuvuuksia äläkä asenna uusia kirjastoja[cite: 1].
5. **Tekoälyn turvaraja (P5):**
   - Kielimalli ei koskaan tuota eikä suorita ohjelmakoodia (`eval`, `new Function`)[cite: 2, 4]. Kaikki kaavat ajetaan oman turvallisen kaavatulkin (`src/flow/model/formula.ts`) läpi ja kaikki mutaatiot validoituina `GraphCommand`-komentoina[cite: 2, 4].

---

## 4. TÄYDELLINEN TIETOMALLI- JA LASKENTASPESIFIKAATIO (`src/flow/graph/`)

### 4.1 Tietorakenteet (`src/flow/graph/types.ts`)
Toteuta tarkalleen TSD v3.2 luvun 3.3 ja 8.1 mukaiset tyypit[cite: 4]:
- `EntityURI = \`apex://${EntityType}/${string}\`` jossa `EntityType = "node" | "stream" | "unit" | "factor" | "role" | "system" | "asset" | "account" | "policy" | "kpi" | "unit-org"` (lisää tarvittaessa `"capability-biz"` `BusinessCapability`-viitteille tai käytä yhtenäistä URI-skeemaa)[cite: 4].
- `FlowNature = "discrete" | "continuous" | "agent" | "signal" | "monetary" | "capacity"`[cite: 4].
- `FlowUnit`, `FactorRef` (`{ const: number } | { factor: EntityURI }`), `FactorNode` (mukaan lukien `formula?: string`, `temporal?: { periodTicks: number; amplitude: number; phaseTicks: number }[]`, `provenance?: Provenance`)[cite: 4].
- `PortSide = "I" | "C" | "O" | "M"` ja `Port` (`id`, `name`, `side`, `unit`, `ratio`, `role?: "primary" | "reject" | "byproduct" | "posting"`, `delegatesTo?: { node: EntityURI; port: string }`)[cite: 4].
- `AtomKind = "time_capacity" | "physical_matter" | "recurring_subscription" | "transactional_trade" | "credit_working_capital"`[cite: 4].
- `PhysicsOutput` ja `PhysicsModule` (`atom: AtomKind`, `params: Record<string, FactorRef>`, `batchSize?: FactorRef`)[cite: 4].
- `UniversalEnterpriseNode`:
  - `level: number` (0 = juuri), `band: "value_stream" | "enabling" | "governance" | "external"`[cite: 4].
  - `definition?: "defined" | "named" | "unknown"` (oletus `"defined"`)[cite: 4].
  - `realizes?: EntityURI[]`, `parent: EntityURI | null`, `children: EntityURI[]`, `ports: Port[]`[cite: 4].
  - `physics?: PhysicsModule[]` (vain lehtisolmuilla; jokaisella `defined`-lehtisolmulla on oltava $\ge 1$ moduuli)[cite: 4].
  - `buffer?: { maxUnits: FactorRef; holdingCostPerUnit: FactorRef; reorder?: { trigger: FactorRef; target: FactorRef; source: EntityURI } }`[cite: 4].
  - `mechanisms: MechanismBinding[]` (`capability`, `capacityContribution`, `modifiers`, `rollout`, `critical`, `fallbackMultiplier`)[cite: 4].
  - `ghost?: { patchId: string; status: "pending" | "hydrated" | "failed"; requestedAt: number }`[cite: 4].
  - `owner?: EntityURI`, `ledgerBindings`, `kpis: EntityURI[]`[cite: 4].
- `HierarchicalStreamEdge`, `Capability` (`role` | `system` | `asset`, jossa järjestelmän `layer` on `"capture" | "workflow" | "record" | "intelligence" | "agent"`), `BusinessCapability` (`status: "known" | "unclear" | "missing"`, `rationale`, `dependsOn`, `notes`, `canonicalRef`, `realizedBy`, `provenance`), `LedgerAccount` ja `EnterpriseGraph` (`version: 3`, `maturity?: 0 | 1 | 2 | 3`)[cite: 4].

### 4.2 Laskentasäännöt ja Simulaattorin Fysiikka (`src/flow/graph/simulate.ts`)

1. **Tekijöiden (`FactorNode`) ratkaisu:**
   - Ratkaise tekijöiden riippuvuusgraafi topologisessa järjestyksessä[cite: 4].
   - Jos `kind === "formula"`, laske arvo `src/flow/model/formula.ts`-tulkilla käyttäen URI-aliaksia[cite: 4].
   - Jos `temporal` on määritelty, sovella jaksollisia kertoimia tickin mukaan: $\text{kerroin}(t) = 1 + \sum_k A_k \sin\left(\frac{2\pi (t - \phi_k)}{P_k}\right)$ (tai vastaava deterministinen jaksofunktio, joka vastaa nykyisen `seasons.ts`:n käyttäytymistä)[cite: 4].
2. **Lehtisolmun `PhysicsModule`-yhdistämissäännöt (TSD 6.3):**
   - Kutsu jokaiselle `node.physics`-moduulille `src/flow/kernel/atoms.ts`:n vastaavaa puhdasta laskentafunktiota[cite: 4].
   - Yhdistä moduulien `PhysicsOutput`-tulokset:
     - $\text{capacityPerTick}_{\text{raw}} = \min_m(\text{module}_m.\text{capacityPerTick})$[cite: 4]
     - $\text{cycleTicks}_{\text{raw}} = \sum_m(\text{module}_m.\text{cycleTicks})$ (Huom: `credit_working_capital`-maksuaika menee vain `cash[].delayTicks`-kenttään, ei `cycleTicks`-summaan!)[cite: 4]
     - $\text{firstPassYield}_{\text{raw}} = \prod_m(\text{module}_m.\text{firstPassYield})$[cite: 4]
     - $\text{variableCost}_{\text{raw}} = \sum_m(\text{module}_m.\text{variableCost})$[cite: 4]
     - $\text{fixedCostPerTick} = \sum_m(\text{module}_m.\text{fixedCostPerTick})$[cite: 4]
     - $\text{cash} = \text{yhdistetty lista kaikista } \text{module}_m.\text{cash}\text{-eristä}$[cite: 4]
3. **Mekanismien (`MechanismBinding`) vaikutus lehtisolmuun (TSD 5):**
   - Roolin kapasiteettikontribuutio: jos `capacityContribution` on annettu tai johdettu roolista ($\text{FTE} \times \text{hoursPerFtePerTick} \times \text{proficiency}$), rajoita kapasiteettia roolien ja fyysisten resurssien (`asset`) mukaan[cite: 4].
   - Käyttöönottonotkahdus (`rollout`): jos $t < \text{startTick} + \text{leadTicks}$, järjestelmän muokkaimet eivät ole vielä voimassa (kerroin 1.0)[cite: 4]. Kun $\text{startTick} + \text{leadTicks} \le t < \text{startTick} + \text{leadTicks} + \text{dipTicks}$, sovella `dipDepth`-alenemaa ennen kuin täysi `modifiers.throughput` astuu voimaan[cite: 4].
   - Kriittisyys (`critical: true`): jos kyvykkyyden `availability` on 0 (esim. järjestelmäkatko-tapahtuma), solmun kapasiteetti putoaa arvoon `fallbackMultiplier ?? 0`[cite: 4].
   - Kokonaiskapasiteetti:
     $$\text{capacityPerTick} = \min(\text{capacityPerTick}_{\text{raw}}, \text{roolikapasiteetti}, \text{resurssikapasiteetti}) \times \prod(\text{IT throughput modifiers}) \times \text{rolloutFactor} \times \text{availabilityFactor}$$[cite: 4]
4. **Tick-syklin 6 vaihetta (TSD 6.1):**
   - **Vaihe 1:** Laske `FactorNode`-arvot ja aktiiviset `GraphEvent`-muokkaimet[cite: 4].
   - **Vaihe 2:** Ulkoiset lähteet (`band === "external"` tai syötesolmut) tuottavat yksiköitä[cite: 4].
   - **Vaihe 3:** Viivelinjat (`HierarchicalStreamEdge`) vapauttavat `latencyTicks`-ajan kulkeneet erät kohdesolmun puskuriin vähennettynä `lossRate`-häviöllä ja kirjaavat `transferCost`-kulun[cite: 4].
   - **Vaihe 4:** Käsittele vain ne lehtisolmut, joissa `definition === "defined"` ja `!node.ghost` (tai `ghost.status === "hydrated"` ja hyväksytty), topologisessa järjestyksessä (takaisinkytkentäsilmukoille 1 tickin viive)[cite: 4]:
     $$\text{suoritukset} = \min\left(\text{capacityPerTick}, \min_{p \in I}\left(\frac{\text{saatavilla}_p}{\text{ratio}_p}\right), \text{kohdepuskurin vapaa tila}\right)$$[cite: 4]
     Kuluta I-porttien syötteet, tuota O-porttien yksiköt jaettuna `firstPassYield`-suhteella (`primary` vs. `reject`) ja `byproduct`-suhteella, laske muuttuvat ja kiinteät kulut ja tee kahdenkertaiset kirjaukset `src/flow/graph/ledger.ts`:ään (`on_complete`, `on_reject`, `per_tick`)[cite: 4].
   - **Vaihe 5:** Laske puskureiden/jonojen vanheneminen (`decayPerTick`, `queueDecayPerTick`), varastointikulut (`holdingCostPerUnit`) ja laukaise `reorder`-täydennyssäännöt (`trigger` $\to$ tilaa `target - current` lähteestä `source`)[cite: 4].
   - **Vaihe 6:** Laske koostesolmujen rollupit alhaalta ylös (TSD 6.2):
     - $\text{Läpäisy} = \text{tuotosporttien virtaus}$[cite: 4]
     - $\text{Kapasiteetti} = \text{virtauspainotettu pullonkaula}$[cite: 4]
     - $\text{Läpimenoaika} = \text{Littlen laki: } \frac{\text{keskimääräinen WIP}}{\text{läpäisy}}$[cite: 4]
     - $\text{Kulut} = \sum(\text{lasten kulut}) + \text{oma kiinteä kulu}$[cite: 4]
     Tunnista kriittisen polun pullonkaula (Theory of Constraints: suurin $\text{kysyntä} \div \text{kapasiteetti}$) ja tarkista kaikki 6 invarianttia (TSD 6.5)[cite: 4].

---

## 5. VAIHEITTAINEN TOTEUTUSOHJELMA (Checkpoints)

Suorita toteutus tarkistuspiste kerrallaan[cite: 2, 3, 4]. Älä siirry seuraavaan vaiheeseen ennen kuin kuluvan vaiheen kaikki testit ja tyyppitarkistukset ovat 100 % vihreinä[cite: 2, 3, 4].

### TARKISTUSPISTE 1 (V2.A & V2.B): Universaali prosessigraafi ja laskentaydin (`src/flow/graph/`)
> **Arkkitehtoninen perustelu:** Toteutamme `src/flow/graph/`-tietomallin, pääkirjan ja migraation ensin, jotta V1:n käyttöliittymäkuori voi käyttää suoraan lopullisia v3.2-tyyppejä (`VentureMaturity`, `BusinessCapability`, `UniversalEnterpriseNode`) ilman kaksinkertaista työtä[cite: 2, 4].

1. **Luo `src/flow/graph/types.ts`:** Kaikki kohdan 4.1 mukaiset tyypit ilman yhtäkään toimialasanaa[cite: 4].
2. **Luo `src/flow/graph/registry.ts`:** `buildRegistry(graph: EnterpriseGraph): EntityRegistry` (URI-hakemisto, johdetut käänteisviittaukset `usedBy`, topologinen järjestys, hierarkkinen rollup-järjestys sekä alias-ratkaisu kaavoille) ja `validateGraph(graph)` (tarkistaa URI-viitteet, hierarkian syklittömyyden, porttien yksikköyhteensopivuuden ja lehtisolmujen `physics`-moduulit)[cite: 4].
3. **Luo `src/flow/graph/ledger.ts`:** Irrota `src/core/engine/ledger.ts`:n kahdenkertainen kirjanpito (`postJournal`, `buildIncomeStatement`, `buildBalanceSheet`, kassavirtalaskelma) täysin riippumattomaksi `WorldState`:sta[cite: 1, 4].
4. **Luo `src/flow/graph/simulate.ts`:** Toteuta kohdan 4.2 mukainen simulaattori, `SimulationRun`-tulostietorakenne, koostevirtojen laskenta lehtivirroista ja TSD 6.5 -invarianttien tarkistaja[cite: 4].
5. **Luo `src/flow/graph/migrate.ts`:** Toteuta `migrateMoleculeToGraph(moleculeModel): EnterpriseGraph`, joka kääntää nykyiset molekyylimallit ja `src/flow/kernel/presets.ts`:n esimerkit v3.2-graafeiksi (`maturity: 3`, kaikki solmut `definition: "defined"`, atomit solmun `physics`-moduuleina)[cite: 1, 4].
6. **Luo `src/flow/graph/index.ts` ja testit `tests/flow-graph.test.ts`:**
   - **Golden-testit:** Aja neljä esimerkkimallia sekä vanhalla `src/flow/kernel/simulate.ts`:llä että uudella `src/flow/graph/simulate.ts`:llä (`migrateMoleculeToGraph`-muunnoksen kautta)[cite: 1, 4]. Kuukausituloksen, kassan ja kassan loppumispäivän eron on oltava $\le 0,5\ \%$[cite: 2, 3, 4].
   - **Invarianttitestit:** Debet === Kredit joka tickillä, kassan muutos === rahavirtojen summa === pääkirjan kassatilin muutos, massatase jokaiselle `FlowUnit`-yksikölle (`nature !== "signal"`), koosteiden täsmäys ($10^{-6}$) ja determinismi[cite: 4].
   - **Keskeneräisyystestit:** Varmista, että `definition: "named" | "unknown"` ja `ghost`-solmut ohitetaan laskennassa ja että alavirran yhteys merkitään `stub`-tilaan[cite: 4].

---

### TARKISTUSPISTE 2 (V1): Unified Studio Shell – 5-vyöhykkeinen käyttöliittymä ja Spotlight
1. **Väri- ja typografiatokenit (`src/flow/server/page.ts` / tyylit):**
   - Tuo `src/app/styles.ts`:n Classic-väritokenit (`--bg-deep: #060b16`, `--bg-panel: #0c1426`, `--bg-card: #111c33`, `--bg-hover: #172544`, `--border: #1e2d4a`, `--border-bright: #38bdf8`, tekstihierarkia, `tabular-nums` monospace-luvuille) sekä TSD 2.2:n semanttiset tilavärit (`--st-healthy`, `--st-warning`, `--st-critical`) ja ArchiMate-domeenivärit (`--dom-demand`, `--dom-value`, `--dom-enabling`, `--dom-application`, `--dom-finance`, `--dom-people`)[cite: 1, 4].
2. **Viiden vyöhykkeen runko (`src/flow/client/app.ts`, `canvas.ts`, `drawer.ts`, `tools.ts`):**
   - **Vyöhyke 1 (Komentopalkki):** Yritys/osasto, globaali `apex://`-haku, Persona HUD & KPI-nauha, X-Ray-linssivalitsin (Ops / Raha / IT / Org), Kypsyystason valitsin (`0 Idea` … `3 Toiminta`), kielivalinta (FI/EN) ja Kumoa-painike[cite: 4].
   - **Vyöhyke 2 (Navigaattori):** Hierarkiapuu (L0 $\to$ L5), murupolku (*breadcrumb*) ja entiteettikirjasto (roolit, IT-järjestelmät, resurssit, tekijät, tilit)[cite: 4].
   - **Vyöhyke 3 (Kanvaasi):** Semanttinen zoom (L0–L5), ICOM-portilliset solmukortit (`ValueChainCanvas.ts`:n visuaalinen tarkkuus + `canvas.ts`:n partikkelivirrat ja nestemäinen kassasäiliö), koostevirtojen niputus ja purku[cite: 1, 4].
   - **Vyöhyke 4 (Inspektori):** Välilehdet (*Fysiikka, Talous, Org, IT, Linkit, Alkuperä*), Classic-tyyliset telemetriapaneelit (`FinancialTelemetryDrawer`, `WarehouseAndOpsDrawer` yleistettynä puskureille, `OrgAndCapabilityDrawer`), valmentaja ja neuvonantajat (`WarRoomDebatePanel`-esitystapa) sekä widgetit[cite: 1, 4].
   - **Vyöhyke 5 (Aikajana):** Git-tyylinen haarapalkki (`TimelineBranchBar`-ulkoasu), aikaliukusäädin, toisto ja skenaarioiden/Monte Carlon vaihteluvälien vertailu[cite: 1, 4].
   - Responsiivisuus: kapealla näytöllä vyöhykkeet 2 ja 4 toimivat liukupaneelina ja vyöhyke 5 tiivistyy yhdeksi riviksi[cite: 4].
3. **Kypsyystasot ja persoonien oletukset (TSD 2.5 & 4.4):**
   - Kytke persoonan valinta oletuskypsyystasoon: Liikeideaa suunnitteleva / perustaja = `0`, Opiskelija = `3` (valmiilla esimerkillä) tai `0` (alusta), Yrittäjä / Osa-aluejohtaja / COO / TJ / Neuvoja / Rahoittaja = `3`[cite: 2, 3, 4].
   - Tasoilla `0–1` kanvaasin päänäkymä on **kyvykkyyskartta** (`BusinessCapability`-solmut tilaväreineen `known` / `unclear` / `missing`), ei prosessiketju[cite: 4].
4. **Spotlight Viewport Isolation & Natural Capability Zoom (Invariantti A3, TSD 3.5):**
   - Zoom-kynnykset (`< 25 %` $\to$ L0, `25–60 %` $\to$ L1, `> 60 %` tai tuplaklikkaus $\to$ avaa kohdesolmun)[cite: 4].
   - **Spotlight:** Kun L1/L2-solmu avataan, vain valittu solmu ja sen 3–7 lasta (kapasiteettijärjestyksessä; yli 7 menevät ryhmitellään `"+N muuta"` -solmuun) piirretään kirkkaina[cite: 4]. Muu graafi himmenee (`opacity: ~0.15`, `pointer-events: none`, muiden osastojen sisäosia EI renderöidä DOM:iin) ja reunoilla näkyvät tulo- ja lähtöportit koostevirtoineen[cite: 4]. `Esc`, murupolku tai ulkopuolinen klikkaus palauttaa[cite: 4].
   - **Natural Capability Zoom:** Älä piirrä M-portin mekanismikapseleita (roolit, IT, resurssit) tasoilla L0–L1 (näytä puute/ylikuorma vain solmun tilavärinä), vaan paljasta ne solmun alareunan kapseleina vasta tasoilla L2–L4 tai kun IT- tai Org-linssi on valittuna[cite: 4].
5. **Nopeus 1 -takuu (Invariantti A4):**
   - Varmista, että kaikki liukusäätimet, valinnat ja kipurajat lasketaan ja piirretään paikallisesti `< 16 ms` vasteajalla (300 lehtisolmua × 360 tickiä; suuremmat mallit ja 400 ajon Monte Carlo ajetaan Web Workerissa kuukausitason likiarvolla)[cite: 2, 3, 4].
6. **Lokalisointi:**
   - Lisää kaikki uudet suomenkieliset avaimet `src/flow/i18n/`-sanakirjaan ja vastaavat englanninkieliset käännökset `src/flow/i18n/en.ts`:ään[cite: 1, 2, 4].

---

### TARKISTUSPISTE 3 (V3): Genesis-to-Operations, Aukkoanalyysi & Elävä Launchpad
1. **8-vaiheinen `UniversalGenesisSpec` ja 6-portainen kääntäjä (`src/flow/graph/compiler.ts`):**
   - Toteuta TSD 4.1 ja 4.2 mukainen deterministinen kääntäjä[cite: 4]:
     - **Vaihe 0 (Tasoportti):** Jos `maturity` on `0` tai `1`, aja vain vaiheet 1–2 (tekijärekisteri ja L0-juuri) sekä luo `BusinessCapability`-solmut ja aukkoanalyysi — älä luo prosessisolmuja äläkä käynnistä simulaatiota[cite: 4]. Tasolla `2` aja vaiheet 1–5 (sallien `named`/`unknown`-solmut)[cite: 4]. Tasolla `3` aja kaikki vaiheet 1–6 (mukaan lukien kalibrointiajo ja päivän 1 pullonkaulan tunnistus)[cite: 4].
     - Vakaat tunnisteet (deterministinen tiiviste syötteestä): sama `UniversalGenesisSpec` tuottaa aina identtisen `EnterpriseGraph`-rakenteen[cite: 2, 3, 4].
     - Jos L1-ydinarvovirtaan syntyisi yli 8 solmua (tai yli 6 tukikaistaa), kääntäjä tarjoaa/tekee ryhmittelyn yhteisen emosolmun alle (TSD 3.4)[cite: 4].
2. **Aukkoanalyysi ja datapohjaiset kyvykkyysmallit (`src/flow/graph/gaps.ts` & `src/flow/graph/capabilities/`):**
   - Luo yleinen, toimialasta riippumaton kyvykkyysluokitus ja vähintään kolme erilaista puhdasta datapohjaa `src/flow/graph/capabilities/`-hakemistoon (merkitse lähteet, päivämäärät ja `"ei oikeudellista neuvontaa"`)[cite: 2, 3, 4].
   - Toteuta `analyzeGaps(graph, template)` (`gaps.ts`), joka vertaa graafin `BusinessCapability`-karttaa ja katkenneita `stub`-virtoja datapohjaan ja tuottaa selkokielisen yhteenvedon puuttuvista osista, kuluista, uhista ja huomioitavista asioista[cite: 2, 3, 4].
3. **Fast-Track, Architect Mode ja Launchpad-kytkennät (Invariantti A2, TSD 4.5):**
   - **Fast-Track:** Yhden lauseen syöte tai CSV/PDF-tiliotteen pudotus (`importer.ts`) täyttää `UniversalGenesisSpec`:n taustalla ja piirtää graafin välittömästi (ensimmäinen luonnoskuva `< 50 ms` paikallisella heuristiikalla, minkä jälkeen mahdollinen LLM-kutsu hydratoi sen)[cite: 4]. Erota tuotu data (`provenance: "import"`) ja arvio (`provenance: "genesis"`)[cite: 4].
   - **Architect Mode:** Kaikkien 8 vaiheen suora muokkausnäkymä[cite: 2, 3, 4].
   - **On-Canvas Launchpad (`src/flow/model/launchpad.ts` & `src/flow/client/launchpad.ts`):** Kytke jokainen muistilistan rasti (`Y-tunnus`, `YEL`, `ALV`, `maksuehdot`, `työkalut` jne.) ajamaan kumottava `GraphCommand`, joka muuttaa vastaavaa ICOM-porttia, `FactorNode`-arvoa tai `MechanismBinding`-kytkentää `< 16 ms` vasteajalla[cite: 1, 4].

---

### TARKISTUSPISTE 4 (V4): Mekanismit, 4 X-Ray-linssiä, Subsystem Scoping & Optimistinen Ghost-solmu
1. **Neljä X-Ray-linssiä (`src/flow/client/canvas.ts` / `graph-canvas.ts`, TSD 2.3):**
   - **Ops Flow:** Solmun väri kapasiteetin käyttöasteesta (vihreä $\to$ keltainen $> 85\ \%$ $\to$ punainen), virran paksuus yksikköä/tick, pullonkaulan ja jonojen korostus[cite: 4].
   - **Financial Margin (Sankey):** Solmun väri kate-%:sta, virran paksuus €/tick, näyttää missä kate syöpyy (hävikki, logistiikka, hankintakulu)[cite: 4].
   - **IT & Data:** Solmun väri automaatioasteesta (manuaalinen = punainen katkoviiva, taulukko = keltainen, integroitu = syaani), datavirtojen viive ja uudelleensyöttö[cite: 4]. (Tasolla 1 voi näyttää suunnitellut järjestelmätarpeet ilman virtoja)[cite: 4].
   - **Org & Accountability:** Solmun väri omistavan roolin/yksikön mukaan, luovutukset yksiköiden välillä, FTE-ylikuorma ($\text{vaadittu työ} \div \text{kapasiteetti}$) ja RACI-aukot (`owner` puuttuu)[cite: 4].
2. **Subsystem Scoping (`set_root_scope`, TSD 2.5):**
   - Käyttäjä (esim. Osa-aluejohtaja) voi asettaa minkä tahansa solmun näkymän juureksi (`L0 = valittu alipuu`)[cite: 4]. Solmun ICOM-portit piirtyvät ulkoisina rajapintoina muuhun yritykseen, ja Persona HUD näyttää vain kyseisen alipuun tavoitteet ja rajapintojen tilan[cite: 2, 3, 4].
3. **Nopeus 2: Optimistinen luonnossolmu (`src/flow/graph/optimistic.ts` & `src/flow/model/intent.ts`, Invariantti A4, TSD 8.1):**
   - Toteuta `OptimisticNodePatch` (`patchId`, `request`, `localCommands`, `ghostNodes`, `baseVersion`, `status`)[cite: 4].
   - Kun käyttäjä pyytää muutosta chatissa/komentopalkissa, paikallinen `intent.ts` luo `< 50 ms` kuluessa `add_node`-luonnoksen (`definition: "named"`, `ghost: { patchId, status: "pending", requestedAt }`) ja kytkee sen virtaan[cite: 1, 4].
   - Ghost-solmu piirretään katkoviivalla ja merkinnällä *"luonnos, odottaa tarkennusta"* (`t()`-käännettynä), ja partikkelianimaatio kulkee sen läpi vain visuaalisesti[cite: 4].
   - Ghostin lukuja EI lasketa malliin (valinnainen esikatselu ajetaan erillisenä, tallentamattomana `SimulationRun`-varjoajona merkinnällä *"arvaus, oletusarvoilla"*)[cite: 4].

---

### TARKISTUSPISTE 5 (V5): `GraphCommand`-moottori, Asynkroninen LLM-hydraatio & Graafianalyysi
1. **Täydellinen `GraphCommand`-komentokieli (`src/flow/model/commands.ts` / `src/flow/graph/commands.ts`, TSD 8):**
   - Toteuta ja validoi kaikki 16 komentoa: `add_node`, `remove_node`, `decompose_node` (kalibroitu mitoosi: lasten oletusarvot kalibroidaan niin, että kapasiteetti, kulut ja läpimenoaika säilyvät ennen ja jälkeen purun!), `promote_node`, `replicate_subgraph`, `connect_stream`, `split_stream`, `set_factor`, `set_formula`, `attach_capability`, `detach_capability`, `add_capability`, `add_event`, `set_owner`, `bind_ledger`, `set_root_scope` (sekä kypsyystason vaihto)[cite: 4].
   - Jokainen komento on puhdas funktio `(graph, cmd) => newGraph`, kirjaa `Provenance`-alkuperän ja tukee täyttä Undo/Redo-ketjua[cite: 4].
   - Rakenna adapteri vanhoista `FlowCommand`-komennoista `GraphCommand`-komennoiksi, jotta nykyiset testit ja pikakomennot toimivat saumattomasti[cite: 4].
2. **Asynkroninen LLM-hydraatio (`src/flow/server/ai.ts` & orkestrointi, TSD 8.1):**
   - Toteuta `AsyncLLMHydration`: taustalla ajettava kielimallikutsu tuottaa validoidut `GraphCommand[]`-komennot ja hydratoi odottavan `ghost`-solmun palasina (`definition: "named"` $\to$ `"defined"`, `ghost.status: "hydrated"`)[cite: 4].
   - **Käyttäjän muokkaussuoja:** Jos käyttäjä muokkaa ghost-solmun kenttää kesken odotuksen (`provenance: "user"`), LLM-vastaus ei saa ylikirjoittaa käyttäjän arvoa[cite: 4].
   - **Rollback:** Jos kutsu epäonnistuu, aikakatkaistaan, ei läpäise validointia tai käyttäjä peruuttaa sen, palauta graafi versioon `baseVersion` yhdellä tilasiirtymällä[cite: 2, 3, 4].
3. **Analyysityökalut, tuonti ja widgetit graafin päällä (TSD 7 & 9.1):**
   - Yleistä `sensitivity.ts` (kipurajat), `stress.ts` ja Monte Carlo toimimaan mille tahansa graafin `FactorNode`-tekijälle[cite: 1, 4].
   - Päivitä `importer.ts` ja `actuals.ts` kohdistamaan tiliotteen rivit pääkirjatileille (`LedgerAccount`) ja solmuihin[cite: 1, 4].
   - Päivitä `widgets.ts`, `coach.ts`, `advisors.ts` ja `report.ts` (mukaan lukien L1-prosessikartta, IT-kartta, organisaatiokuorma ja lista `named`/`unknown`-solmuista) lukemaan `EntityURI`-viitteitä ja graafin telemetriaa[cite: 1, 4].

---

### TARKISTUSPISTE 6 (V6): Classicin hallittu poisto (Vasta kun V1–V5 testit ovat 100 % vihreinä)
1. Varmista, että jokaiselle `tests/engine.test.ts`:n ja Classic-ominaisuuksien testille on vastaava testi uuden graafimoottorin puolella[cite: 1, 2, 4].
2. Varmista, että jaettu kielimalliasiakas (`client.ts`, `gemini.ts`, `market-research.ts`) on joko siirretty `src/flow/server/`- tai `src/shared/llm/`-kansioon ja että `scripts/i18n.ts` sekä `tests/llm.test.ts` toimivat ilman `src/core/engine/`- tai `src/core/schema/`-riippuvuuksia[cite: 1, 4].
3. Poista `/classic`-reitti sekä hakemistot `src/app/`, `src/components/`, `src/core/schema/`, `src/core/compiler/`, `src/core/engine/`, `src/core/agents/` ja `src/core/export/`[cite: 1, 2, 3, 4].

---

## 6. ITSEVERIFIOINTISILMUKKA (Definition of Done jokaiselle tarkistuspisteelle)

Jokaisen tarkistuspisteen lopussa sinun ON ajettava seuraavat komennot terminaalissa ja korjattava kaikki virheet ennen kuin ilmoitat vaiheen valmiiksi[cite: 1, 2, 4]:

1. **Tyyppitarkistus:**
   `npx tsc --noEmit` (0 virhettä, ei yhtäkään implisiittistä `any`-tyyppiä)
2. **Koko testipatteristo:**
   `npm test` (Kaikkien 85 olemassa olevan testin + uusien V1–V5-testien on mentävä läpi)[cite: 2, 3, 4]
3. **Pakolliset uudet v3.2-verifiointitestit (varmista, että nämä löytyvät `tests/`-kansiosta ja menevät läpi):**
   - **A1-testi:** Kaikki kankaan solmut ovat `UniversalEnterpriseNode`-tyyppiä, jokaisella `defined`-lehtisolmulla on $\ge 1$ `PhysicsModule`, ja `Golden-testit` neljällä esimerkkimallilla täsmäävät $\le 0,5\ \%$ tarkkuudella[cite: 2, 3, 4].
   - **A2-testi:** Fast-Track ja Architect Mode tuottavat samasta syötteestä identtisen graafin; Launchpad-rasti muuttaa porttia/kerrointa ja `undo` palauttaa täsmälleen alkutilan[cite: 2, 3, 4].
   - **A3-testi:** L0–L1-tasolla ei renderöidä M-portin mekanismikapseleita; Spotlight-tilassa muiden osastojen lapsisolmuja ei ole DOM:ssa eikä Spotlight muuta simulaation tulosta[cite: 2, 3, 4].
   - **A4-testi:** Paikallinen säädinpäivitys (300 lehtisolmua × 360 tickiä) suoriutuu `< 16 ms`; `OptimisticNodePatch` luo ghost-solmun `< 50 ms`; simuloidun 5 sekunnin LLM-viiveen aikana säätimet toimivat estotta; peruutus/virhe palauttaa `baseVersion`-tilan; ghost-solmun luvut eivät vaikuta kassaan, KPI-nauhaan tai raporttiin[cite: 2, 3, 4].
   - **P1 Agnostisuustesti:** Automaattinen lähdekooditarkistus varmistaa, että `src/flow/graph/`-kooditiedostoissa (pl. puhtaat esimerkki-/kyvykkyysdatatiedostot) on 0 kiellettyä toimialasanaa[cite: 2, 3, 4].
   - **P7 Lokalisointitesti:** Varmistaa, ettei uusissa tai siirretyissä UI-komponenteissa ole kovakoodattuja tekstejä `t()`-funktion ulkopuolella[cite: 2, 4].
   - **P9 Kypsyystasotesti:** Taso `0` ei sisällä yhtäkään prosessisolmua eikä aja simulaatiota, ja `gaps.ts` tuottaa aukkoyhteenvedon vähintään kolmella eri datapohjalla ilman koodimuutoksia[cite: 2, 3, 4].

Aloita nyt lukemalla kohdan 1 kontekstiankkurit ja tulosta **Tarkistuspisteen 1 (V2.A & V2.B) sekä Tarkistuspisteen 2 (V1) tarkka toteutussuunnitelma (Implementation Plan)**[cite: 2, 4].