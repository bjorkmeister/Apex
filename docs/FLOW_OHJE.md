# APEX Flow – käyttöohje

*Versio: beta, lokakuu 2026. Koskee osoitetta `/flow`.*

## 1. Mikä APEX Flow on?

APEX Flow on liiketoiminnan **simulaattori ja valmentaja**. Siinä näet yrityksesi rahavirrat elävinä virtoina: mistä raha tulee, mihin se menee, missä se viipyy ja milloin kassa uhkaa loppua.

Flow'n avulla voit:

- **kokeilla liikeideaa** ennen kuin laitat siihen omia rahojasi,
- **ymmärtää kassavirtaa**: miksi kannattava yritys voi silti ajautua maksuvaikeuksiin,
- **testata päätöksiä turvallisesti**: hinnankorotus, rekry, maksuehdot, uusi myyntikanava,
- **käydä läpi yrityksen perustamisen** muistilistan avulla, jonka kohdat vaikuttavat laskelmiin.

Flow ei ole kirjanpito-ohjelma eikä ennustuskone. Se ei arvaa, miten asiakkaat käyttäytyvät. Se laskee täsmällisesti, mitä antamistasi luvuista seuraa, ja kertoo kipurajat (esim. *"saat menettää 25 % asiakkaista ennen kuin hinnankorotus tulee tappiolliseksi"*).

## 2. Aloittaminen

1. Avaa `http://127.0.0.1:3000/flow`. Etusivulla on myös nappi *🌊 Kokeile APEX Flow (beta)*.
2. Valitse, miksi käytät APEXia (opiskelu, perustaminen, johtaminen…). Valinta vaikuttaa näkymään, ks. luku 8.
3. Valitse, **mitä yrityksesi myy**. Voit valita yhden tai useamman:

   | Valinta | Sopii esimerkiksi | Mitä se mallintaa |
   | :-- | :-- | :-- |
   | Myyn aikaa ja osaamista | konsultti, suunnittelija, parturi, koodari | tunnit, laskutusaste, tuntihinta, palkat |
   | Myyn tavaraa varastosta | verkkokauppa, tukku, valmistaja | kappalemäärät, ostohinta, hävikki, varastoon sitoutunut raha |
   | Myyn kuukausitilauksia | SaaS, jäsenyydet, ylläpitosopimukset | tilaajat, poistuma, asiakashankinnan kulu |
   | Myyn tiskiltä ohikulkijoille | kioski, kahvila, myymälä | kävijät, ostoprosentti, keskiostos |

4. **Tai aloita esimerkistä:** IT-konsultti, ruokakioski, ohjelmistoyritys tai verkkokauppa. Esimerkit ovat vain lähtökohtia, ja kaikki niiden luvut ovat muokattavissa.

> **Vinkki:** tyhjästä aloitetussa mallissa ei ole vielä kiinteitä kuluja, joten se näyttää aluksi liian hyvältä. Valmentaja pyytää lisäämään ainakin oman palkan, tilat ja kirjanpidon.

## 3. Päänäkymä

Päänäkymä on tarkoituksella pelkistetty. Yksityiskohdat avautuvat klikkaamalla.

### Kolme pääkorttia (ylhäällä)
- **Kuussa jää käteen:** myynti miinus kaikki kulut, ennen veroja.
- **Kassa:** riittääkö raha koko vuoden, vai monentenako päivänä se loppuu.
- **Kannattavuusraja:** paljonko pitää myydä, jotta kulut katetaan.

Kortin väri kertoo tilanteen: vihreä = kunnossa, keltainen = huomio, punainen = ongelma. Korttia klikkaamalla avautuu siihen liittyvä paneeli.

### Valmentajan havainnot
Pääkorttien alla näkyy kaksi tärkeintä havaintoa ja niihin valmiit kokeilunapit. *Kysy valmentajalta* avaa kaikki havainnot ja keskustelun.

### Virtakuva
| Solmu | Mitä se näyttää |
| :-- | :-- |
| **Kysyntä** | myynti kuukaudessa ja mistä se syntyy |
| **Toimituskyky** | riittääkö kapasiteetti kysyntään (pullonkaula) |
| **Rahat matkalla** | laskut, jotka on lähetetty mutta joita ei ole vielä maksettu |
| **Kassa** (säiliö) | rahaa tilillä valittuna päivänä |
| **Kulut** | kiinteät ja muuttuvat kulut kuukaudessa |

Liikkuvat pisteet: vihreät ovat asiakkaita, keltaiset laskuja matkalla kassaan ja punaiset kuluja. Jos toimituskyky ei riitä, osa asiakkaista kimpoaa pois punaisina.

### Aikajana
- **▶ Toista vuosi** käy 12 kuukautta läpi 12 sekunnissa, ja säiliö elää mukana.
- Aikajanaa klikkaamalla tai liukusäädintä vetämällä hyppäät mihin tahansa päivään.
- Punainen piste ja teksti *"Kassa loppuu"* näyttävät päivän, jolloin kassa menee miinukselle.

## 4. Vivut (oikea reuna)

Vivut syntyvät automaattisesti valitsemistasi tulovirroista. Asiantuntijayritys ei näe varasto- tai hävikkivipuja, koska niitä ei sille ole olemassa.

Vedä vipua, niin koko näkymä päivittyy heti. *Lisää vipuja* näyttää harvemmin tarvittavat vivut.

| Tulovirta | Päävivut | Lisävivut |
| :-- | :-- | :-- |
| Aika ja osaaminen | Tuntihinta, Laskutusaste, Tekijöitä | Palkka / hlö / kk, Sivukulut, Työtunnit / viikko, Muuttuva kulu / h |
| Tavara varastosta | Myyntihinta / kpl, Myynti kpl / kk, Ostohinta / kpl | Hävikki, Varasto päivinä |
| Kuukausitilaukset | Hinta / kk, Uusia asiakkaita / kk, Poistuma / kk | Hankintakulu / asiakas, Kulu / asiakas / kk, Asiakkaita alussa |
| Tiskimyynti | Keskiostos, Ohikulkijat / pv, Ostoprosentti | Raaka-aineet / myynti, Aukiolopäivät / kk |
| Kassa ja maksuajat | Asiakkaan maksuaika (vain jos lähetät laskuja) | Alkukassa, Toimittajan maksuaika |

## 5. Syventävät paneelit

Klikkaa mitä tahansa solmua tai pääkorttia.

- **Kysyntä ja hinnoittelu:** tulovirtojen luvut, kaavat ja *Mitä jos muutan hintaa?* -taulukko (±10 %, ±20 %): kuinka paljon myyntiä saat menettää tai tarvitset lisää, jotta kate pysyy ennallaan. Täällä voit myös lisätä, poistaa ja nimetä tulovirtoja sekä syöttää varmistetun kysynnän.
- **Toimituskyky:** kysyntä suhteessa kapasiteettiin, menetetty myynti ja laskuttamaton aika. Asiantuntijatyössä: *Kannattaako palkata uusi tekijä?* eli montako laskutettua lisätuntia rekry vaatii.
- **Rahat matkalla:** maksuajan vaikutus kassan pohjaan (0 / 14 / 30 / 45 / 60 pv) ja *Kokeile*-napit sekä tulovirtakohtaiset maksuajat.
- **Kassa:** alkukassa, kuukausitaulukko (myynti, kulut, tulos, kassa) ja stressitesti (myynti −10 % / −25 %, kiinteät kulut +15 %, ostohinnat +20 %).
- **Kulut:** kiinteiden kulujen lisäys, muokkaus ja poisto (nimi, summa, maksupäivä), palkat, palkanmaksupäivä ja muuttuvat kulut.

Kaavat näytetään jokaisessa paneelissa, joten laskelman voi tarkistaa itse.

## 6. Perustamislista 🚀

Ylhäällä oleva *Perustamislista*-nappi avaa 12 kohdan listan viidessä vaiheessa: liikeidea, hinnoittelu, hallinto, asiakkaat, käynnistys.

- **Ruksattavat kohdat, joilla on rahavaikutus,** muuttavat mallia heti:
  - *Yritysmuoto ja perustamisilmoitus:* alkukassa pienenee perustamismaksun verran.
  - *YEL:* lisää kuukausikulun (työtulo × maksuprosentti × (1 − alkavan yrittäjän alennus) / 12).
  - *Kirjanpito* ja *Yritysvakuutukset:* lisäävät kuukausikulun.
  - *14 pv maksuehto:* lyhentää asiakkaan maksuaikaa.
- Ruksin poisto **peruu vaikutuksen** täsmälleen.
- Summat ja prosentit ovat muokattavia. Niiden **oletukset ovat arvioita**, ja jokaisessa kohdassa kerrotaan, mistä ajantasainen tieto tarkistetaan (PRH, eläkeyhtiö, Verohallinto).
- **Automaattiset kohdat** (merkintä *tarkistetaan mallista*) täyttyvät, kun malli on kunnossa: esim. kassa riittää koko vuoden ja pohjalla on vähintään kuukauden kiinteät kulut.
- **ALV:** jos mallin vuosimyynti ylittää ALV-rajan, kohta korostuu.

## 7. Valmentaja ja keskustelu 💬

### Havainnot
Valmentaja lukee mallin jatkuvasti ja nostaa esiin esimerkiksi:
- kassan loppumisen ja maksuajan, joka sen korjaisi,
- tappiollisuuden ja hinnan, jolla tulos olisi nolla,
- pullonkaulan, hinnankorotuksen varan ja sen, maksaako rekry itsensä,
- laskuttamattoman ajan ja ehdotuksen kuukausisopimuksista,
- tilausliiketoiminnan asiakashankinnan kannattavuuden (takaisinmaksuaika, elinkaariarvo),
- hävikin hinnan euroina,
- puuttuvat kiinteät kulut ja oletuksena olevan kysynnän,
- seuraavan askeleen perustamislistalla.

Jokaisessa havainnossa on nappi, jolla ehdotuksen voi kokeilla heti. **Kaiken voi kumota** napilla ↶ Kumoa (tai Cmd/Ctrl + Z).

### Keskustelu
Voit pyytää muutoksia omin sanoin.

- **Kun kielimalli on kytketty** (APEXin etusivun tekoälyasetukset, oma API-avain), valmentaja ymmärtää vapaamuotoisia pyyntöjä, esim. *"Lisää Wolt-kotiinkuljetus 30 % komissiolla"*.
- **Ilman kielimallia** valmentaja ymmärtää ainakin nämä:

  | Pyyntö | Mitä tapahtuu |
  | :-- | :-- |
  | *Nosta hintaa 10 %* / *Laske hintoja 5 %* | hinta muuttuu prosentteina |
  | *Tuntihinta 95 €* | hinta asetetaan |
  | *Maksuaika 14 päivää* | asiakkaan maksuaika muuttuu |
  | *Palkkaa uusi työntekijä* | tekijöitä +1 (tai lisätään palkkakulu) |
  | *Lisää kulu toimisto 600 €* | uusi kiinteä kulu |
  | *Lisää kuukausisopimukset 300 € / kk* | uusi tilaustulovirta |
  | *Mitä jos myynti putoaa 20 %?* | stressitesti |

Valmentaja muuttaa mallia vain tarkistetuilla komennoilla. Kielimallin ehdotukset tarkistetaan ennen käyttöä, eikä virheellinen ehdotus pääse rikkomaan mallia. Viestin alla näkyy, mitä muutettiin ja kumpi vastasi (*kielimalli* vai *sääntöpohjainen tulkki*).

## 8. Roolit ja näkökulmat

Rooli valitaan aloitussivulla tai ylhäältä kohdasta *Rooli*. **Rooli ei muuta laskentaa**, vain sen, mitä näytetään ja korostetaan:

| Rooli | Mitä muuttuu |
| :-- | :-- |
| **Opiskelen** | Valmentaja selittää käsitteitä (*Opi:*-laatikot) ja näyttää perustamislistan seuraavan askeleen. Kysyntäoletuksesta ei huomauteta. |
| **Perustan yritystä** | Perustamislista korostettuna, *Opi:*-selitykset ja seuraavan askeleen ehdotukset. |
| **Pyöritän yritystä** | Stressitestinapit suoraan päänäkymässä. |
| **Johdan osa-aluetta** | Näkökulman valinta: *Myynti / Toimitus / Talous* (oletus Myynti). |
| **Johdan yritystä** | Näkökulman valinta ja stressitestinapit. |
| **Neuvon asiakkaita** | Näkökulmat, stressitestit, perustamislista korostettuna ja *Opi:*-selitykset. |
| **Arvioin rahoitusta** | Näkökulmat (oletus Talous) ja stressitestit. |

**Näkökulma** (osa-alue) muuttaa:
- **vivut:** vain oman alueen vivut (esim. myynnillä hinnat, määrät, poistuma ja maksuaika; toimituksella laskutusaste, tekijät, ostohinnat ja hävikki),
- **pääkortit:** esim. myynnillä *Myynti / Myyntikate / Myymättä jää*, toimituksella *Kapasiteetin käyttö / Muuttuvat kulut / Kiinteät kulut*,
- **virtakuvan:** muut solmut himmennetään,
- **rajapintaviestit:** muu yritys kertoo päätöstesi seuraukset, esim. *"Toimitus: myyntisi ylittää toimituskyvyn 30 %:lla"*.

## 9. Tiliotteen tuonti 📄

Kulut- ja Kassa-paneeleissa on nappi *Tuo tiliote (CSV)*.

1. Vie verkkopankista tilitapahtumat **CSV-muodossa** (OP, Nordea, S-Pankki, Danske ja useimmat muut käyvät). Vähintään 2–3 kuukautta antaa parhaan tuloksen.
2. Valitse tiedosto. **Tiedosto luetaan vain selaimessasi**, eikä sitä lähetetä minnekään.
3. Tarkista ehdotukset:
   - **toistuvat kulut** (nimi, kuukausisumma, maksupäivä, luokka),
   - kulut, joille mallissa on jo vastine, ovat oletuksena valitsematta, jotta niitä ei tule kahteen kertaan,
   - verot, omat siirrot, nostot ja kertaostot jätetään pois,
   - *Sovita myynti tiliotteeseen* (kun mallissa on yksi tulovirta),
   - *Käytä viimeistä saldoa alkukassana* (jos tiliotteessa on saldosarake).
4. *Lisää valitut malliin.* Muutokset voi kumota.

PDF-tiliotteita ei vielä tueta.

## 10. Tallennus, kumoaminen ja pikalinkit

- Malli, perustamislista, rooli ja keskustelu **tallentuvat automaattisesti tähän selaimeen**. Toinen selain tai kone ei näe niitä.
- **↶ Kumoa** peruu viimeisimmän muutoksen (30 viimeisintä muistissa). **Aloita alusta** tyhjentää kaiken.
- **Esc** sulkee avoimen paneelin.
- Pikalinkit esimerkkeihin (korvaavat nykyisen mallin):
  - `/flow?preset=it_consultant` – IT-konsultti
  - `/flow?preset=food_kiosk` – ruokakioski
  - `/flow?preset=saas_hybrid` – ohjelmistoyritys
  - `/flow?preset=webshop` – verkkokauppa
  - lisäparametrit: `&persona=director` (rooli), `&open=launchpad` (avaa paneelin: `demand`, `capacity`, `receivables`, `cash`, `costs`, `launchpad`, `coach`)

## 11. Miten laskenta toimii (lyhyesti)

- Simulaatio laskee **päivä päivältä 12 kuukautta** (kuukausi = 30 päivää).
- Myynti kirjataan saamiseksi, ja raha saapuu kassaan **maksuajan päästä**. Korttimaksut tilitetään 1 päivässä ja tilaukset heti.
- Muuttuvat kulut maksetaan **toimittajan maksuajan** päästä. Kiinteät kulut ja palkat maksetaan **omana maksupäivänään**.
- Tavaramyynnissä aloitusvarasto ostetaan päivänä 0 (raha sitoutuu varastoon), ja hävikki nostaa kappalekulua.
- Kirjanpito **täsmää** aina: kassan muutos = tulos − saamiset + ostovelat − varasto.
- **Ei mukana:** arvonlisävero (kaikki summat alv 0 %), tuloverot, lainat ja korot, kausivaihtelu.

## 12. Tunnetut rajoitukset

- Malli tallentuu vain selaimeen (ei käyttäjätilejä eikä pilveä).
- Flow ja APEXin etusivun liikeideageneraattori ovat vielä erilliset: liikeideaa ei voi vielä kirjoittaa omin sanoin niin, että siitä syntyisi Flow-malli.
- Viranomaismaksut ja -prosentit ovat arvioita, jotka pitää tarkistaa.
- Käyttöliittymä on vain suomeksi.
- Kielimallikeskustelu vaatii oman API-avaimen. Ilman sitä käytössä on sääntöpohjainen tulkki.

## 13. Ongelmatilanteita

| Ongelma | Ratkaisu |
| :-- | :-- |
| Sivu jää tekstiin *"Ladataan APEX Flow'ta…"* | Varmista, että palvelin on käynnissä (`npm run dev`) ja että selain on ajantasainen. |
| Luvut näyttävät liian hyviltä | Tarkista Kulut-paneeli: puuttuuko oma palkka, tilat tai kirjanpito? Onko kysyntä vielä oletus? |
| Tiliotetta ei tunnisteta | Tiedostossa pitää olla päivämäärä- ja summasarake. Vie tapahtumat CSV-muodossa, ei PDF:nä. |
| Valmentaja ei ymmärrä pyyntöä | Kytke kielimalli tai käytä luvun 7 esimerkkimuotoja. |
| Haluan aloittaa puhtaalta pöydältä | *Aloita alusta* (oikea yläkulma). |
