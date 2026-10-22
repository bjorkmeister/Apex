# Suunnitelma: yksi APEX, kaksi kieltä ja päivitetty tiekartta

> [!NOTE]
> **Päätökset tehty 22.10.2026:** nimi on **APEX Studio**, pilottia ei tehdä (rakennetaan pitkälle, testataan itse) ja vaiheet 9–14 ovat työn alla. Kielituen toteutustapa on kuvattu luvussa 2.

---

## 1. War Roomin ja Flow'n yhdistäminen

### Arkkitehtuuripäätös: Flow'n malli on pohja, War Roomin hyvät osat siirretään sen päälle

Kahden moottorin yhdistäminen yhdeksi olisi kallista ja säilyttäisi juuri sen ongelman, josta lähdimme liikkeelle. Luontevin tapa on kuristajaviikuna-malli (*strangler fig*): uusi rakenne kasvaa vanhan ympärille, ja vanha poistetaan pala kerrallaan, kun uusi vastaa sitä.

| | War Room (nykyinen) | Flow (uusi) |
| :-- | :-- | :-- |
| Laskentamalli | Rakennettu tehtaan ehdoilla: toimittajat, varastoerät, tuotantolinjat (noin 20 000 riviä) | Toimialasta riippumattomat atomit, noin 5 000 riviä |
| Tila | **Yksi yhteinen istunto palvelimella**: kaikki käyttäjät jakaisivat saman yrityksen | Jokaisella käyttäjällä oma malli selaimessa: sopii suoraan monikäyttäjäpalveluun |
| Vaste | Jokainen muutos on palvelinkutsu | Liukusäädin päivittää näkymän alle millisekunnissa |
| Vahvuudet, jotka kannattaa säilyttää | Liikeidea omin sanoin, tekoälyneuvonantajat, markkinatieto, skenaariohaarat, Monte Carlo, kriisit, raportin vienti | Virtakuva, kipurajat, perustamislista, valmentaja, roolit, tiliotteen tuonti |

**Johtopäätös:** Flow'n atomimalli on ainoa laskentamalli. War Roomin arvokkaat ominaisuudet kirjoitetaan uudelleen atomimallin päälle moduuleiksi, jotka avautuvat klikkaamalla. War Room poistetaan, kun vastaavat ominaisuudet ovat valmiit.

### Nimi: ehdotukset War Roomin tilalle

Koko tuote on **APEX**. "War Room" poistuu, ja sen osat nimetään neutraalisti. Nimien pitää toimia sekä suomeksi että englanniksi.

| Vaihtoehto | Mitä se kuvaa | Arvio |
| :-- | :-- | :-- |
| **APEX Studio** *(suositus)* | Yksi työtila, jossa rakennetaan ja kokeillaan | Sama sana suomeksi ja englanniksi, neutraali ja luova sävy |
| APEX Työpöytä / Workspace | Arkinen työväline | Selkeä, mutta käännös vaihtuu |
| APEX Ohjaamo / Cockpit | Hallinnan tunne | Vähän dramaattinen, mutta paljon War Roomia lievempi |

War Roomin osien uudet nimet (suomi / englanti):

| War Room | Uusi nimi | Mihin se tulee |
| :-- | :-- | :-- |
| Genesis | **Aloitus / Start** | aloitussivun teksti "Kerro liikeideasi" |
| War Room Briefing | **Tilannekatsaus / Briefing** | valmentajan paneeli |
| Debate Panel (tekoälyjohtoryhmä) | **Neuvonantajat / Advisors** | oma paneeli |
| Timeline Branches, Monte Carlo | **Skenaariot / Scenarios** | oma näkymä |
| Market Research | **Markkinatieto / Market data** | paneeli, joka kalibroi oletuksia lähteineen |
| Executive Export | **Raportti / Report** | vienti |

### Vaiheet

```mermaid
flowchart LR
  U0["U0 Nimet ja reitit"] --> U1["U1 Liikeidea omin sanoin"]
  U1 --> U2["U2 Skenaariot"]
  U1 --> U3["U3 Neuvonantajat"]
  U1 --> U4["U4 Markkinatieto ja lähteet"]
  U2 --> U5["U5 Sesongit ja kriisit"]
  U4 --> U6["U6 Raportti"]
  U5 --> U8["U8 War Roomin poisto"]
  U6 --> U8
  U3 --> U8
  U7["U7 Toimitusketjumoduuli: päätös myöhemmin"] -.-> U8
```

| Vaihe | Sisältö | Mistä War Roomista |
| :-- | :-- | :-- |
| **U0** | `/` avaa APEX Studion (nykyinen Flow). War Room siirtyy osoitteeseen `/classic` nimellä "Klassinen näkymä (poistumassa)". Koodin War Room -nimet vaihdetaan. | reitit, nimet |
| **U1** | Aloitussivulle "Kerro liikeideasi omin sanoin". Kielimalli palauttaa **samat tarkistetut komennot**, joilla valmentaja jo muuttaa mallia (tulovirrat, kulut, maksuehdot). Ilman kielimallia avainsanat ohjaavat sopivaan esimerkkipohjaan. War Roomin järkevyystarkistus (*sense check*) muuttuu valmentajan havainnoiksi. | Genesis, kääntäjä, sense check |
| **U2** | Skenaariot: mallista voi haarauttaa versiot A ja B, joiden kassakäyrät näkyvät rinnakkain. Monte Carlo laskee vaihteluvälit, jotka **käyttäjä itse antaa** (esim. myynti 80–120 %); epävarmuutta ei arvata. Tämä on samalla tiekartan aikakone. | Timeline Branches, Monte Carlo |
| **U3** | Neuvonantajat: tekoälyjohtoryhmä (talous, myynti, toimitus, henkilöstö) keskustelee mallin oikeista luvuista. Ilman kielimallia valmentajan havainnot jaetaan rooleittain. | Debate Panel, agents |
| **U4** | Markkinatieto: haku kalibroi oletuksia **lähdeviitteineen**. Jokaisella luvulla näkyy alkuperä: *oma arvio / tiliote / markkinatieto / valmentaja / perustamislista*. Tämä toteuttaa War Roomin `*`-merkinnät. | Market Research, oletusten `*` |
| **U5** | Malliin kuukausittaiset kertoimet: sesongit (jäätelökioskin kesä) ja kriisit, joissa käyttäjä tekee päätöksen. | Crisis cards, living world |
| **U6** | Liiketoimintasuunnitelma tai raportti mallista (Markdown, myöhemmin PDF) rahoittajalle tai pankille. | Executive Export |
| **U7** | Toimitusketju- ja varastoerämoduuli valmistaville yrityksille: **päätetään oman testauksen perusteella**. Suositus: ei siirretä etukäteen. | warehouse, supply |
| **U8** | War Room ja sen testit poistetaan, kun kaikelle siirretylle on vastaavat testit Flow'n puolella. | koko `src/app`, `src/core` |

---

## 2. Kieli: suomi ja englanti ilman kaksinkertaista työtä

### Periaate: kirjoita kerran, käännä työkalulla
Tekstit kirjoitetaan **vain suomeksi**, ja suomi on lähdekieli. Englanti tuotetaan työkalulla ja tarkistetaan ihmisen toimesta. Kukaan ei kirjoita samaa tekstiä kahteen kertaan, eikä englanti koskaan estä julkaisua.

```mermaid
flowchart LR
  A["Suomenkielinen teksti koodissa: fi.ts"] --> B["Käännöstyökalu: npm run i18n"]
  B --> C["en.ts: vain puuttuvat ja muuttuneet avaimet"]
  C --> D["Ihminen tarkistaa merkityt"]
  D --> E["Julkaisu"]
  A -.->|"englannin puuttuessa"| F["Käyttäjä näkee suomen, ei virhettä"]
```

| Osa | Miten |
| :-- | :-- |
| **Lähde** | `fi.ts` on ainoa paikka, jonne tekstit kirjoitetaan. Koodissa ei ole kovakoodattuja tekstejä (testi tarkistaa tämän). |
| **Käännös** | Työkalu vertaa suomen tiivisteitä (hash) englantiin ja kääntää vain **uudet ja muuttuneet** avaimet käyttäjän omalla API-avaimella (sama BYOK kuin muualla). Käännökset merkitään *"tarkistamatta"*, kunnes joku hyväksyy ne. |
| **Sanasto** | Yksi sanastotiedosto pitää termit yhtenäisinä: kate = *contribution margin*, kannattavuusraja = *break-even point*, myyntisaaminen = *accounts receivable*, YEL = *YEL (Finnish entrepreneur's pension insurance)*. Työkalu saa sanaston mukaan, ja siksi talouden termit eivät vaihtele. |
| **Varakieli** | Jos englanninkielinen teksti puuttuu tai on tarkistamatta, käyttäjä näkee suomen eikä sovellus kaadu. Englanti voi valmistua vähitellen. |
| **Muuttuva sisältö** | Valmentajan lauseet rakennetaan **mallipohjista ja luvuista**, ei valmiista lauseista. Näin jokainen lause käännetään kerran, ja luvut ja päivämäärät muotoillaan kielen mukaan (`1 234 €` vs `€1,234`). |
| **Käyttäjän oma sisältö** | Yrityksen nimi, tulovirtojen nimet ja keskustelu pysyvät käyttäjän kielellä, joten niitä ei käännetä. Kielimalli vastaa käyttäjän kielellä yhdellä lisäohjeella. |
| **Maa erillään kielestä** | Perustamislistan viranomaisasiat (YEL, PRH, ALV) ovat Suomen **maapaketti**. Englanninkielinen käyttäjä voi perustaa yrityksen Suomeen, ja maapaketin selitykset käännetään samalla työkalulla. |

### Mitä emme tee
- **Emme käännä sovellusta lennossa kielimallilla jokaiselle käyttäjälle:** se maksaisi tokeneita jokaisella käynnillä, tulos vaihtelisi ja talouden termit kääntyisivät väärin.
- **Emme käännä War Roomia:** se poistetaan.
- **Emme pidä englantia suomen kanssa samanaikaisena vaatimuksena:** englanti saa jäädä jälkeen, ja se ei estä uutta ominaisuutta.

### Milloin tämä kannattaa tehdä: heti, mutta kevyesti
Tekstejä on nyt noin 400, ja jokainen uusi ominaisuus lisää niitä. Mitä myöhemmin tekstit siirretään käännöstiedostoon, sitä enemmän siirrettävää on. Pullonkaulaa ei synny, koska englanti on jälkijättöinen.

| Vaihe | Sisältö | Estääkö julkaisun? |
| :-- | :-- | :-: |
| **I1 Perusta** | käännösfunktio `t()`, luku- ja päivämäärämuodot, kielivalinta, tarkistustesti "ei kovakoodattuja tekstejä", sanasto, käännöstyökalu | Ei |
| **I2 Tekstien siirto** | kaikki nykyiset suomenkieliset tekstit siirretään `fi.ts`:ään. Työ on mekaaninen eikä muuta toimintaa. **Tämä on ainoa kertakustannus.** | Ei |
| **I3 Englanti** | työkalu kääntää, ihminen tarkistaa näkyvimmät kohdat (aloitus, pääkortit, valmentaja). Komentotulkkiin lisätään englanninkieliset muodot ("raise prices 10%"). | Ei |
| **Jatkuva** | uusi teksti kirjoitetaan suomeksi `fi.ts`:ään. Työkalu tuottaa englannin, ja tarkistus on osa julkaisua, mutta ei sen este. | Ei |

**Oma testaus voidaan tehdä suomeksi.** Englannin tarkistus ja käyttöohje tulevat julkaisulle ennen kansainvälistä jakelua. Perusta (I1–I2) tehdään silti ennen yhdistämistä, jotta War Roomista siirretty koodi kirjoitetaan heti `t()`-kutsuilla.

## 3. Miten roolit vaikuttavat tällä hetkellä

**Rehellinen vastaus: kevyesti.** Rooli ei muuta laskentaa, eikä se lukitse tai avaa toimintoja. Se muuttaa sen, mitä näytetään ja korostetaan.

| Rooli | Näkökulman valinta | Stressitestit päänäkymässä | Perustamislista korostettuna | *Opi:*-selitykset | Muuta |
| :-- | :-: | :-: | :-: | :-: | :-- |
| Opiskelen | – | – | – | ✓ | Seuraava askel -ehdotukset; kysyntäoletuksesta ei huomauteta |
| Perustan yritystä | – | – | ✓ | ✓ | Seuraava askel -ehdotukset |
| Pyöritän yritystä | – | ✓ | – | – | |
| Johdan osa-aluetta | ✓ (oletus Myynti) | – | – | – | |
| Johdan yritystä | ✓ | ✓ | – | – | |
| Neuvon asiakkaita | ✓ | ✓ | ✓ | ✓ | |
| Arvioin rahoitusta | ✓ (oletus Talous) | ✓ | – | – | |

**Näkökulma** (Myynti / Toimitus / Talous) on roolien näkyvin vaikutus: vivut, pääkortit, himmennetyt solmut ja rajapintaviestit vaihtuvat.

**Puutteet:**
- *Pyöritän yritystä* ja *Johdan yritystä* eroavat toisistaan vain näkökulman valinnan osalta.
- Opiskelija ei saa tehtäviä eikä tavoitteita, vain selityksiä.
- Neuvojalla ei ole asiakkaita (useita malleja), ja rahoittajalla ei ole raporttia.
- Paneelit ovat kaikille samat.

**Ehdotetut parannukset tiekarttaan:**

| Rooli | Parannus | Vaihe |
| :-- | :-- | :-- |
| Opiskelija | **Tehtävät:** esim. "Pelasta kassa", "Löydä kannattavuusraja", "Kestä −25 % myynti". Tavoite ja tarkistus. Myöhemmin opettajatila. | 11 |
| Perustaja | Liikeidea omin sanoin (U1) | 10 |
| Yrittäjä | Toteutuma vs. suunnitelma: tiliote rinnakkain mallin kanssa | 14 |
| Osa-aluejohtaja | Tavoitteet näkökulmalle (esim. myyntikate ≥ 40 %), ja rajapinta varoittaa, jos ne rikkoutuvat | 13 |
| Toimitusjohtaja | Skenaariovertailu ja neuvonantajat (U2, U3) | 13–14 |
| Neuvoja | Useita asiakasmalleja ja jaettava linkki (vaatii pilven) | 16 |
| Rahoittaja | Stressiruudukko, vaihteluvälit ja raportti (U2, U6) | 13–14 |

---

## 4. Tiekartta (hyväksytty 22.10.2026)

| Vaihe | Nimi | Tila |
| :-: | :-- | :-- |
| 1–7 | Virtanäkymä, paneelit, kipurajat, atomimalli, tiliotteen tuonti, perustamislista, roolit | ✅ Valmis |
| 8 | Valmentaja ja keskustelu, joka muuttaa mallia tarkistetuilla komennoilla | ✅ Valmis |
| 9 | Kielituki FI / EN: suomi lähteenä, englanti työkalulla, varakielenä suomi | ✅ Valmis |
| 10 | APEX Studio: yksi sovellus, nimet ja reitit, liikeidea omin sanoin → malli | ✅ Valmis |
| 11 | Prompt-to-widget: omat widgetit omalla API-avaimella, päälle/pois-kytkimet, kuvauspohjainen (ei ajettavaa koodia) | ✅ Valmis |
| 12 | Skenaariot ja aikakone (A/B, vaihteluvälit), yrittäjän jaksaminen, osa-alueiden tavoitteet, opiskelijan tehtävät | ✅ Valmis |
| 13 | Neuvonantajat, markkinatieto lähteineen, lukujen alkuperä, raportti, toteuma vs. suunnitelma | ✅ Valmis |
| 14 | Sesongit ja kriisit | ✅ Valmis |
| 15 | Pilvi, käyttäjätilit ja pysyvä muisti, neuvojan asiakasmallit | |
| 16 | War Roomin poisto, päätös toimitusketjumoduulista | |
| 17 | Kirjanpitorajapinnat (Procountor, Netvisor) | |
| – | Kaupallistaminen | myöhemmin; sitä ennen omaa ja tuttujen testausta jatkuvasti |

### Vaihe 11: Prompt-to-widget

Käyttäjä pyytää omin sanoin uutta toimintoa, ja kielimalli palauttaa **widgetin kuvauksen** (JSON), ei ohjelmakoodia. Kuvauksen piirtää meidän oma tarkistettu koodimme valmiista palikoista. Näin kielimallin virhe tai manipulointi ei pääse käsiksi käyttäjän tietoihin tai API-avaimeen.

| Palikka | Esimerkki |
| :-- | :-- |
| Luku tai kortti | "Suurimman asiakkaan osuus myynnistä" |
| Laskukaava | tuntikate = (tuntihinta − muuttuva kulu) × laskutusaste. Lasketaan omalla pienellä tulkilla, joka tuntee vain mallin luvut ja peruslaskutoimitukset. |
| "Mitä jos" -vipu | oma liukusäädin mallin lukuun |
| Hälytyssääntö | "varoita, jos kassa < 2 kk kuluja" |
| Kuvaaja tai taulukko | kassa kuukausittain |

- **Hallinta:** päälle/pois-kytkin, muokkaus, poisto ja merkintä *"tekoälyn luoma, pyyntö: …"*. Widgetit tallentuvat mallin mukana, ja luomisen voi kumota.
- **Kustannus:** käyttäjän omat tokenit (nykyinen BYOK-avain). Ilman avainta ovat käytössä valmiit mallipohjat ja jo luodut widgetit.
- **Rajaus:** aidosti uutta laskentalogiikkaa (jota malli ei tunne) tämä ei kata. Se vaatisi erillisen eristetyn ratkaisun, ja siitä päätetään myöhemmin.



---

## 5. Päätökset

| Päätös | Tulos |
| :-- | :-- |
| Nimi War Roomin tilalle | **APEX Studio** ✅ |
| Pilotti | **Poistettu** tiekartasta: rakennetaan mahdollisimman pitkälle, testataan itse ja tuttujen kesken, kaupallistetaan myöhemmin ✅ |
| Prompt-to-widget | **Vaihe 11** ✅ |
| Kielituen toteutustapa | Kirjoita kerran suomeksi, englanti työkalulla, varakieli suomi. Odottaa hyväksyntääsi. |

Seuraava askel on vaihe 9 (kielituki), kun hyväksyt kielituen toteutustavan ja annat luvan aloittaa koodauksen.
