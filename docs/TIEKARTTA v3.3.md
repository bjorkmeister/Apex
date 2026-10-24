---

### DOKUMENTTI 2: Päivitetty Tiekartta (`docs/SUUNNITELMA_JA_TIEKARTTA.md` -lisäys)

Tämä korvaa vanhan V6-vaiheen nelivaiheisella UX-pelastus- ja viimeistelyohjelmalla (**U-UX1 – U-UX4**):

| Vaihe | Nimi | Sisältö | Hyväksymisehto |
| :-: | :-- | :-- | :-- |
| **U-UX1** | Siivous, Jargon-poisto & 100 % toimivat vivut | Poistetaan vanha v2-alakanvaasi, tuplayläpalkit ja Classicin kuolleet kansiot (V6). Siivotaan kaikki sisäiset kooditermit (`Invariantti A1`, `Littlen laki`, `FACTORNODE`, `LEDGERACCOUNT`, `apex://`-URI:t) käyttöliittymästä. Kytketään jokainen liukusäädin (`slider`), numerokenttä ja vaihevalitsin (`0–3`) suoraan `applyGraphCommand`-moottoriin. | Jokainen vipu päivittää graafin ja kassan `< 16 ms`. UI:ssa 0 kiellettyä kooditermiä (testi). Yksi yläpalkki, yksi kanvaasi. |
| **U-UX2** | Roolivetoinen aloitus & Yrityksen perustietokortti | Toteutetaan `CompanyProfile` (nimi, liikeidea, yritysmuoto, alkukassa, oma pääoma, omistajat/osuudet) ja rauhallinen aloituspolku. Tyhjä yritys alkaa puhtaasta `[Yritys Oy]`-kehyksestä ilman punaisia virhekortteja tai tyhjiä koodilaatikoita. | Uusi yritys tallentaa perustiedot ja omistajuuden, asettaa avaavan taseen oikein ja näyttää puhtaan `[Yritys Oy]`-kehyksen. |
| **U-UX3** | Google Maps -henkinen jatkuva semanttinen zoom | Toteutetaan hiiren rullalla (`wheel`) ja raahaamalla (`pan`) toimiva portaaton zoom-kangas: **Taso 0 (`< 45 %`)** näyttää vain `[Yritys Oy]`-kehyksen ja sen ulkoiset päävirrat; **Taso 1 (`45–110 %`)** avaa yrityksen sisäiset toiminnot ja kassa-akun; **Taso 2+ (`> 110 %`)** sukeltaa valitun toiminnon sisään (Spotlight) näyttäen työvaiheet, ihmiset, työkalut ja *Arkkitehtimuokkauksen*. | Hiiren rulla vaihtaa saumattomasti Taso 0 ↔ Taso 1 ↔ Taso 2+. Arkkitehtitila on suoraan avattavissa jokaisesta solmusta. |
| **U-UX4** | Interaktiivinen rakentaminen & E2E-käytettävyystestit | Yksinkertaistetaan uuden tulovirran, hankinnan, kulun ja henkilön lisääminen yhdellä klikkauksella suoraan `[Yritys Oy]`-kehyksen ympärille ja sisälle. Kattavat DOM- ja vuorovaikutustestit. | Käyttäjä voi rakentaa yrityksen tyhjästä pelkillä klikkauksilla ja liukusäätimillä ilman yhtäkään komentokoodia. |

---

### DOKUMENTTI 3: Master-käsky Antigravitylle (Kopioi ja syötä suoraan agentille)

Tee ensin Gitiin välitallennus Tarkistuspisteestä 5:
`git add . && git commit -m "feat(v5): complete GraphCommand engine, async hydration, and graph analytics (111/111 tests)"`

Tallenna sen jälkeen yllä oleva **Dokumentti 1** tiedostoon `docs/APEX_UX_AND_INTERACTION_SPEC_V3_3.md` ja anna Antigravitylle alla oleva kehote:

```markdown
# TEHTÄVÄ: Toteuta APEX Studio v3.3 UX-uudistus, Google Maps -zoom ja V6-siivous (Vaiheet U-UX1 – U-UX4)

Backend-ydin (`src/flow/graph/*` ja sen 111/111 testiä) on nyt täydellinen ja lukittu. **ÄLÄ riko tai heikennä yhtäkään `src/flow/graph/`-laskentasääntöä tai testiä.**

Käyttäjätestauksessa havaittiin kuitenkin, että nykyinen käyttöliittymä (`src/flow/client/*` ja `src/flow/server/page.ts`) on liian monimutkainen, vuotaa sisäisiä kooditermejä ruudulle, näyttää kaksi eri kanvaasia päällekkäin, eikä hiiren rullalla toimiva Google Maps -zoom tai liukusäätimien kytkentä toimi kunnolla.

Lue välittömästi uusi sitova spesifikaatio:
1. `@docs/APEX_UX_AND_INTERACTION_SPEC_V3_3.md`
2. `@src/flow/client/app.ts`, `@src/flow/client/canvas.ts`, `@src/flow/client/inspector.ts`, `@src/flow/client/drawer.ts`, `@src/flow/client/tools.ts`, `@src/flow/client/launchpad.ts`
3. `@src/flow/server/page.ts`
4. `@src/flow/graph/commands.ts` ja `@src/flow/graph/types.ts`

---

## TOTEUTETTAVAT MUUTOKSET (Suorita huolellisesti ja kattavasti)

### 1. U-UX1: Yhtenäinen asettelu, Jargon-siivous, V6-poisto ja 100 % toimivat vivut
1. **Poista päällekkäiset kanvaasit ja tuplayläpalkit (`app.ts`, `canvas.ts`, `page.ts`):**
   - Keskiruudulla saa olla VAIN YKSI kanvaasi. Poista vanhan molekyylinäkymän ja uuden graafinäkymän tuplarenderöinti, jossa ruudulla näkyy kaksi laatikostoa päällekkäin.
   - Tiivistä yläreunan 3 päällekkäistä palkkia yhdeksi siistiksi komentopalkiksi.
   - **Tallenna kirjanpito pyydettäessä avautuvaksi:** Älä pakota koko oikeaa reunaa täyteen raskasta tuloslaskelma- ja tasetaulukkoa oletuksena, kun käyttäjä vasta aloittaa. Oikeassa paneelissa oletuksena on valitun kohteen **Säätimet & Muokkaus** (tai **Yrityksen perustiedot & Valmentaja**), ja tarkka *Kirjanpito (Tulos & Tase)* on selkeä oma välilehtensä.
2. **Ehdoton Jargon-kielto (UX1):**
   - Siivoa kaikista UI-tiedostoista (`client/*.ts`, `i18n/index.ts`, `i18n/en.ts`) kaikki sisäiset arkkitehtuuritermit:
     - Korvaa tai poista näkyvistä: `Invariantti A1`, `Littlen laki (L = λ · W)`, `Sisäiset fysiikkamoduulit`, `FACTORNODE`, `LEDGERACCOUNT`, `CORE VALUE STREAM · L1`, `ENABLING BAND · L1`, `ZONE 2 · NAVIGAATTORI`, `main · Nykyhetki (HEAD)`, `Operating Overhead` sekä raa'at `apex://...`-URI-osoitteet.
     - Käytä aina luonnollista, ymmärrettävää suomea ja englantia (`t()`): esim. *Yrityksen rakenne*, *Tulovirrat ja tekeminen*, *Kiinteät kulut ja tuki*, *Muuttujat ja luvut*, *Kirjanpidon tilit*.
3. **Korjaa KAIKKI liukusäätimet (sliders) ja numerokentät (UX4):**
   - Varmista, että jokainen liukusäädin (`input[type="range"]`) ja muokkauskenttä kankaalla ja oikeassa paneelissa on kytketty suoraan `EnterpriseGraph`-tilaan: kun säädintä liikutetaan, se kutsuu `executeWithHistory(graph, { kind: "set_factor", factorUri, value })` (tai päivittää solmun fysiikkaparametrin FactorNoden), ajaa `simulateGraph(graph)` ja päivittää välittömästi (`< 16 ms`) yläkortit, kassa-akun ja kanvaasin virrat!
4. **Korjaa 4-portaisen vaihevalitsimen (`maturity: 0 | 1 | 2 | 3`) toiminta:**
   - Nimeä portaat selkeästi: **1. Liikeidea & Perustiedot (`0`)**, **2. Mitä vaaditaan? (`1`)**, **3. Toimintamalli (`2`)**, **4. Simulaatio & Kassa (`3`)**.
   - Kun käyttäjä klikkaa mitä tahansa näistä neljästä portaasta, kutsu `applyGraphCommand(graph, { kind: "set_maturity", maturity })` ja renderöi välittömästi kyseisen vaiheen oma näkymä (älä jätä näkymää muuttumattomaksi!).

---

### 2. U-UX2: Roolivetoinen aloitus, Yrityksen perustietokortti (`CompanyProfile`) ja Tyhjyyden kunnioitus (UX2 & UX5)
1. **Lisää `CompanyProfile` (`src/flow/graph/types.ts` & `commands.ts`):**
   - Lisää `EnterpriseGraph`-tyyppiin valinnainen `profile?: CompanyProfile` (`name`, `businessIdea`, `companyForm`, `initialCash`, `shareCapital`, `owners: { id, name, roleInCompany, ownershipPercent }[]`, `targetMonthlyIncome`) sekä komento `update_company_profile`, joka päivittää myös `graph.name`, `graph.opening.cash` ja oman pääoman alkusaldon.
2. **Rauhallinen Aloitus & Perustietojen syöttö (ei vieraiden esimerkkien pakkosyöttöä):**
   - Kun käyttäjä avaa sovelluksen ilman tallennettua mallia tai klikkaa **"Aloita alusta / Uusi yritys"**, näytä selkeä ja kutsuva **Aloitus- ja Perustietonäkymä** (jonka saa auki myös milloin tahansa klikkaamalla yrityksen nimeä yläpalkissa):
     1. **Valitse roolisi / tavoitteesi:** *Suunnittelen liikeideaa* (`maturity: 0`), *Perustan yritystä* (`maturity: 1`), *Johdan toimivaa yritystä tai yksikköä* (`maturity: 3`) tai *Kokeilen esimerkillä*.
     2. **Yrityksen perustiedot:** Yrityksen nimi (esim. *Yritys Oy*), Liikeidea omin sanoin, Alkukassa (€), Alkupääoma (€) ja Omistajat (nimi + omistus-%).
     3. Kaksi selkeää toimintopainiketta: **"Avaa tyhjä yrityskangas näillä perustiedoilla"** (luo puhtaan `[Yritys Oy]`-kehyksen ilman yhtäkään keksittyä prosessilaatikkoa) TAI **"Jäsennä alkumalli liikeideasta / tiliotteesta"** (käyttää Fast-Track-kääntäjää).
3. **Tyhjyyden kunnioitus (UX5):**
   - Kun yrityksessä ei ole vielä tulovirtoja tai kuluja, älä näytä punaista *"KANNATTAVUUSRAJA: Ei saavutettavissa"* -hälytystä äläkä tyhjää `L1 Operating Overhead` -laatikkoa. Näytä kolmannessa kortissa rauhallinen ohje *"Aloita lisäämällä ensimmäinen tulovirta tai toiminto"*.

---

### 3. U-UX3: Google Maps -henkinen Jatkuva Semanttinen Zoom & näkyvä Arkkitehtitila (UX3)
1. **Interaktiivinen Pan & Wheel-Zoom -kanvaasi (`src/flow/client/canvas.ts`):**
   - Toteuta kankaalle tilamuuttujat `zoomScale` (oletus `0.40` uudelle tyhjälle yritykselle, `0.75` kun toimintoja on lisätty), `panX` ja `panY`.
   - Kytke hiiren rulla (`wheel`-event) muuttamaan `zoomScale`-arvoa portaattomasti (`0.20` – `2.50`) ja hiiren raahaus (`pointerdown`/`pointermove` tyhjällä kankaalla) liikuttamaan `panX`/`panY`-sijaintia. Lisää kanvaasin oikeaan alakulmaan selkeät `[-]` `[Zoom %]` `[+]` `[Keskitä yritys]` -painikkeet.
2. **Kolme semanttista tarkkuustasoa zoomin mukaan:**
   - **Taso 0 (`zoomScale < 0.45` — Ulos zoomattu Yhtiötaso):**
     - Keskellä näkyy vain tyylikäs **`[Yritys Oy]`**-kehys (nimi, liikeidean tiivistelmä, kassa, tulos ja omistajat).
     - Jos yrityksellä ei ole vielä hankintaa tai myyntiä, kehyksestä ei lähde yhtäkään tyhjää putkea — sen sijaan kehyksen vasemmalla puolella on `+ Lisää hankinta / lähde`, keskellä `+ Avaa ja lisää sisäinen toiminto` ja oikealla `+ Lisää myynti / tulovirta`.
     - Jos virtoja on luotu, ne näkyvät `[Yritys Oy]`-kehykseen tulevina ja siitä lähtevinä päävirtoina.
   - **Taso 1 (`0.45 <= zoomScale <= 1.10` — Yrityksen sisäosat & Kassa):**
     - `[Yritys Oy]`-kehys avautuu näyttämään sisällään vain ne toiminnot, joita yritykselle on oikeasti luotu, niiden väliset elävät virrat sekä visuaalisen Kassa-akun.
   - **Taso 2+ (`zoomScale > 1.10` solmun päällä tai solmun tuplaklikkaus — Huoneen sisällä / Spotlight):**
     - Sukeltaa kyseisen toiminnon sisään (Spotlight), himmentää muun yrityksen taustalle ja näyttää toiminnon alavaiheet, sitä pyörittävät ihmiset/roolit ja työkalut/järjestelmät.
3. **Näkyvä ja saavutettava Arkkitehtitila (Architect Mode):**
   - Lisää sekä oikean paneelin solmunäkymään että yläpalkkiin selkeä **"Arkkitehtimuokkaus"** -painike/kytkin, josta kokenut käyttäjä pääsee suoraan muokkaamaan solmun syötteitä (I), ohjaussääntöjä (C), tuotoksia (O), mekanismeja/järjestelmiä (M) sekä koko yrityksen 8-vaiheista rakennetta.

---

### 4. Tarkistuspiste 6 (V6): Classic-jäänteiden siivous
- Varmista, että `src/core/llm/client.ts` (ja tarvittavat LLM-apuohjelmat) ovat käytettävissä ilman `WorldState`-riippuvuutta, ja poista vanha `/classic`-reitti sekä kuolleet Classic-hakemistot (`src/app/`, `src/components/`, `src/core/engine/`, `src/core/schema/`, `src/core/compiler/`, `src/core/agents/`) TSD:n vaiheen V6 mukaisesti, kunhan kaikki korvaavat testit ovat vihreinä.

---

## ITSEVERIFIOINTI (Definition of Done)
1. Kirjoita uudet automaattiset testit (`tests/flow-ux-v33.test.ts` tai `tests/flow-studio.test.ts`):
   - **UX1 Jargon-testi:** Varmistaa, että renderöity sivu ja komponentit eivät sisällä yhtäkään kiellettyä kooditermiä (`Invariantti`, `Littlen laki`, `FACTORNODE`, `LEDGERACCOUNT`, `ENABLING BAND`, `apex://`).
   - **UX2 Yritysprofiilitesti:** `update_company_profile` tallentaa liikeidean, alkukassan, oman pääoman ja omistajat, ja tyhjä yritys renderöityy puhtaana `[Yritys Oy]`-kehyksenä ilman virhekortteja.
   - **UX3 Google Maps Zoom -testi:** `zoomScale < 0.45` renderöi Yhtiökehyksen (L0), `0.45..1.10` renderöi sisäiset toiminnot (L1) ja `> 1.10` aktivoi kohdesolmun Spotlightin (L2+).
   - **UX4 Slider- ja Vaihetesti:** Säätimen muutos päivittää `FactorNode`:n ja simuloidun kassan välittömästi; kypsyystasojen `0`, `1`, `2` ja `3` valinta tuottaa jokaisella tasolla eri näkymän.