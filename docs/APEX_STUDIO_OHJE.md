# APEX Studio – käyttöohje

*Versio: lokakuu 2026. Osoite: `http://127.0.0.1:3000/` (vanha War Room: `/classic`).*

## 1. Mikä APEX Studio on?

APEX Studio on liiketoiminnan **simulaattori ja valmentaja**. Näet yrityksesi rahavirrat elävinä virtoina: mistä raha tulee, mihin se menee, missä se viipyy ja milloin kassa uhkaa loppua.

Sen avulla voit:
- **kokeilla liikeideaa** ennen kuin laitat siihen omia rahojasi,
- **ymmärtää kassavirtaa**: miksi kannattava yritys voi silti ajautua maksuvaikeuksiin,
- **testata päätöksiä turvallisesti**: hinnankorotus, rekry, maksuehdot, uusi myyntikanava, kriisi,
- **käydä läpi yrityksen perustamisen** muistilistalla, jonka kohdat vaikuttavat laskelmiin,
- **opetella** liiketoimintaa harjoitustehtävien avulla.

APEX ei arvaa, miten asiakkaat käyttäytyvät. Se laskee täsmällisesti, mitä antamistasi luvuista seuraa, ja kertoo kipurajat.

## 2. Aloittaminen

Aloitussivulla on neljä tapaa aloittaa:

1. **Kerro liikeideasi omin sanoin.** Esim. *"Avaan jäätelökioskin Helsingin rantaan. Alkupääoma 6 000 €."* APEX rakentaa mallin: tulovirrat, kiinteät kulut, kausivaihtelun ja tekstissä mainitut luvut.
   - Kun kielimalli on kytketty (oma API-avain), se tulkitsee idean vapaasti.
   - Ilman kielimallia APEX tunnistaa toimialan avainsanoista (suomeksi ja englanniksi).
2. **Valitse, mitä yrityksesi myy:** aikaa ja osaamista, tavaraa varastosta, kuukausitilauksia tai tiskimyyntiä. Valintoja voi yhdistellä.
3. **Aloita esimerkistä:** IT-konsultti, ruokakioski, ohjelmistoyritys tai verkkokauppa.
4. **Harjoitustehtävät:** valmis tilanne ja tavoite (ks. luku 13).

Valitse myös **rooli** (*Käytän APEXia, koska…*). Rooli vaikuttaa siihen, mitä korostetaan, ei laskentaan (luku 9).

**Kieli:** FI / EN oikeassa yläkulmassa. Valinta tallentuu.

## 3. Päänäkymä

Ylhäältä alas:
- **Yläpalkki:** yrityksen nimi (muokattava), kieli, rooli, ↶ Kumoa, 🚀 Perustamislista ja ⋯-valikko (klassinen näkymä, aloita alusta).
- **Näkökulma ja tavoitteet** (johtajarooleilla): *Koko yritys / Myynti / Toimitus / Talous*, tavoitteiden tila ja rajapintaviestit.
- **Työkalurivi:** roolin tärkeimmät työkalut, muut löytyvät kohdasta *Lisää ▾*.
- **Kolme pääkorttia:** *Kuussa jää käteen*, *Kassa* ja *Kannattavuusraja*. Väri kertoo tilanteen. Kortti avaa siihen liittyvän paneelin.
- **Valmentajan havainnot:** kaksi tärkeintä havaintoa ja niihin kokeilunapit.
- **Omat widgetit** (jos lisätty).
- **Virtakuva:** *Kysyntä → Toimituskyky → Rahat matkalla → Kassa → Kulut.* Liikkuvat pisteet: vihreä = asiakkaat, keltainen = laskut matkalla, punainen = kulut. Pullonkaulassa osa asiakkaista kimpoaa pois.
- **Aikajana:** *▶ Toista vuosi* tai klikkaa päivää. Näet kassan kehityksen, tapahtumat (keltaiset alueet), vertailtavat skenaariot (katkoviivat) ja päivän, jona kassa loppuu.
- **Vivut (oikealla):** syntyvät tulovirroista. Vedä, niin kaikki päivittyy heti.
  - Pallo nimen vieressä kertoo luvun **alkuperän**: oma arvio, oletus, valmentaja, tiliote, markkinatieto, perustamislista tai tekoälyn aloitus. Vie hiiri pallon päälle nähdäksesi lähteen.

## 4. Syventävät paneelit (solmut)

- **Kysyntä ja hinnoittelu:** tulovirtojen luvut, kaavat, *Mitä jos muutan hintaa?* -kipurajat ja tulovirtojen lisäys tai poisto.
- **Toimituskyky:** kysyntä vs. kapasiteetti, menetetty myynti, laskuttamaton aika ja *Kannattaako palkata uusi tekijä?*.
- **Rahat matkalla:** maksuajan vaikutus kassan pohjaan ja tulovirtakohtaiset maksuajat.
- **Kassa:** alkukassa, kuukausitaulukko (kuukauden nimi ja ⚡ tapahtumat, jos niitä on), stressitesti ja tiliotteen tuonti.
- **Kulut:** kiinteät kulut (nimi, summa, maksupäivä), palkat ja muuttuvat kulut.

## 5. Valmentaja ja keskustelu 💬

Valmentaja lukee mallin jatkuvasti ja nostaa esiin mm. kassan loppumisen, tappiollisuuden, pullonkaulat, asiakashankinnan kannattavuuden, hävikin, puuttuvat kulut, oman palkan ja jaksamisen, kausivaihtelun ja tapahtumien vaikutukset sekä perustamislistan seuraavan askeleen.

**Keskustelussa** voit pyytää muutoksia omin sanoin. Ilman kielimallia ymmärretään ainakin:

| Suomeksi | In English |
| :-- | :-- |
| *Nosta hintaa 10 %* | *Raise prices by 10%* |
| *Tuntihinta 95 €* | *Hourly rate 95 €* |
| *Maksuaika 14 päivää* | *Payment terms 14 days* |
| *Palkkaa uusi työntekijä* | *Hire a new consultant* |
| *Lisää kulu toimisto 600 €* | *Add cost office 600 €* |
| *Lisää kuukausisopimukset 300 € / kk* | *Add a monthly maintenance contract 300 € / month* |
| *Mitä jos myynti putoaa 20 %?* | *What if sales drop 20%?* |

Kielimallin kanssa onnistuu myös esim. *"Lisää Wolt-kotiinkuljetus 30 % komissiolla"* tai *"Lisää kesäksi kahden kuukauden kriisi"*. Kaikki muutokset kulkevat tarkistettujen komentojen kautta ja ne voi kumota.

## 6. Omat widgetit 🧩

Widgetit ovat omia mittareita, hälytyksiä, vipuja, kuvaajia ja taulukoita päänäkymään.
- **Valmiit pohjat** (toimivat aina): *Kassa riittää*, *Myyntikate*, *Kate per työtunti*, *Oma tuntipalkka*, *Hälytys: kassa alle 2 kk kulut*, *Tulos kuukausittain*, *Myynti ja kulut*, *Asiakkaan arvo / hankintakulu*, *Myymättä jäävä myynti*, *Pikavipu: hinta*, *Yksikkötalous*.
- **Pyydä omin sanoin** (vaatii kielimallin, käyttää omaa API-avaintasi): esim. *"Näytä kate per työtunti ja varoita, jos laskutusaste on alle 50 %"*. Kielimalli kirjoittaa widgetin **kuvauksen**, ei ohjelmakoodia. Kuvaus tarkistetaan ennen käyttöä, ja kaavat lasketaan APEXin omalla turvallisella kaavakielellä.
- **Hallinta:** päälle/pois-kytkin, kaavan muokkaus, poisto. ✨ merkitsee tekoälyn luoman widgetin, ja pyyntö näkyy listassa.
- Kaavoissa käytettävät muuttujat näkyvät Widgetit-paneelin alaosassa.

## 7. Skenaariot ja aikakone 🔀

- **Tallenna** nykyinen malli skenaarioksi (esim. *"Palkkaan heti"*) ja jatka kokeilemista.
- Valitut skenaariot piirretään **aikajanalle** katkoviivoina nykyisen mallin rinnalle, ja **vertailutaulukko** näyttää tuloksen, kassan pohjan ja kassan lopussa.
- *Palaa tähän* lataa skenaarion takaisin (kumottavissa).
- **Vaihteluvälit:** kerro, kuinka varma olet luvuistasi (esim. myynti ±20 %). APEX ajaa 400 simulaatiota ja näyttää huonon, tyypillisen ja hyvän lopputuloksen sekä todennäköisyyden, että kassa loppuu tai vuosi on tappiollinen. Epävarmuutta ei arvata, sen annat sinä.

## 8. Yrittäjän tilanne 🧑

Syötä viikkotunnit ja elinkustannukset. APEX näyttää oman palkan, tuntipalkan, riittääkö palkka elämiseen (ennen veroja) ja työtahdin kestävyyden nyrkkisäännöllä (≤ 45 h kestävä, 45–55 h raskas, > 55 h ei kestä pitkään). Väsymyksen vaikutusta myyntiin ei arvata.

## 9. Roolit, näkökulmat ja tavoitteet

Rooli valitsee työkalurivin järjestyksen, näkökulmat, stressitestinapit, perustamislistan korostuksen ja valmentajan opettavan sävyn (*Opi:*-laatikot opiskelijalle, perustajalle ja neuvojalle).

**Näkökulma** (johtajaroolit) rajaa vivut, pääkortit ja virtakuvan omaan osa-alueeseen. Muu yritys näkyy himmennettynä, ja se kertoo päätöstesi seuraukset rajapintaviesteinä.

**Tavoitteet 🏁:** aseta tavoitteita (myynti, myyntikate, myymättä jäävä myynti, kapasiteetin käyttö, tulos, kassan pohja, pelivara, kassa vuoden lopussa). Ne näkyvät näkymän yläreunassa ✓ / ✗, ja rikkoutunut tavoite näkyy varoituksena.

## 10. Sesongit ja kriisit 🌦

- **Kausivaihtelu:** valmiit profiilit (tasainen, kesä-, joulu-, talvipainotteinen, yrityspalvelu B2B) tai kuukausikertoimet käsin. Valitse myös, mistä kuukaudesta simulaatio alkaa.
- **Kriisikortit:** suurin asiakas lähtee, kilpailija avaa viereen, energian hinta nousee, raaka-aineet kallistuvat, sairastut kuukaudeksi, laite hajoaa, somehitti. Valitse alkamiskuukausi ja *Lisää malliin*, tai kokeile *🎲 Satunnainen kriisi*.
- Valmentaja kertoo, kestääkö kassa, ja ehdottaa vastatoimia. Vaikutukset ovat esimerkkejä, eivät ennusteita, ja ne voi poistaa.

## 11. Neuvonantajat 👥 ja markkinatieto 🌍

- **Neuvonantajat:** talousjohtaja, myyntijohtaja, operatiivinen johtaja sekä henkilöstö ja jaksaminen. Jokainen antaa luvuilla perustellun näkemyksen. *Kysy neuvonantajilta* käynnistää kielimallin kanssa keskustelun, jossa ehdotukset tulevat kokeilunappeina. Ilman kielimallia vastaukset tulevat säännöistä.
- **Markkinatieto:** hae tietoa toimialastasi. Kielimalli arvioi oletustesi realistisuutta ja ehdottaa korjauksia. **Lähteeksi merkitään vain oikeasti haettu sivu**; muut ehdotukset merkitään *"kielimallin arvio – ei lähdettä"*. Käytetyn arvon alkuperä tallentuu vivun palloon ja raporttiin.

## 12. Tiliote, toteuma ja raportti

- **Tiliotteen tuonti 📄** (Kulut- tai Kassa-paneeli, CSV): tunnistaa toistuvat kulut ja keskimääräisen myynnin, jättää pois verot, siirrot ja kertaostot eikä tuplaa mallissa jo olevia kuluja. **Tiedosto luetaan vain selaimessasi.**
- **Toteuma 📊:** valitse tuonnissa *Tallenna toteumaksi*, niin APEX vertaa toteutuneita tuloja ja menoja suunnitelmaan kuukausittain.
- **Raportti 📄:** liiketoimintasuunnitelman laskelmat: yhteenveto, tulovirrat, kulut, 12 kuukauden laskelma, herkkyys ja stressitestit, maksuajat, sesongit ja tapahtumat, skenaariovertailu, yrittäjä, oletukset alkuperineen, perustamislista ja rajoitukset. Lataa Markdown-tiedostona, kopioi tai avaa tulostettava versio.

## 13. Harjoitustehtävät 🎯

Kuusi tehtävää: *Pelasta kassa*, *Löydä kannattavuus*, *Pullonkaula*, *Tilausten yksikkötalous*, *Kestä huono kvartaali* ja *Selviä talvesta*. Jokaisessa on lähtötilanne, tavoite, vihje ja automaattinen tarkistus. Tapoja ratkaista on useita, mutta "lisää rahaa" ei kelpaa. Ratkaistut tehtävät merkitään ✅.

## 14. Perustamislista 🚀

12 kohtaa viidessä vaiheessa. Rahavaikutteiset kohdat (perustamismaksu, YEL, kirjanpito, vakuutukset, 14 pv maksuehto) muuttavat mallia heti, ja ruksin poisto peruu vaikutuksen. Automaattiset kohdat täyttyvät, kun malli on kunnossa. **Viranomaisluvut ovat arvioita**, ja jokaisessa kohdassa kerrotaan, mistä ne tarkistetaan.

## 15. Tallennus, kumoaminen ja pikalinkit

- Kaikki tallentuu automaattisesti **tähän selaimeen**. ↶ Kumoa peruu viimeisimmän muutoksen (30 muistissa). Esc sulkee paneelin.
- Pikalinkit: `/?preset=it_consultant` (myös `food_kiosk`, `saas_hybrid`, `webshop`), `/?task=rescue-cash`, `&persona=director`, `&lang=en`, `&open=scenarios` (mikä tahansa paneeli).

## 16. Miten laskenta toimii (lyhyesti)

- Päivä päivältä 12 kuukautta (kuukausi = 30 päivää). Myynti saapuu kassaan maksuajan päästä, ja kulut maksetaan omina päivinään.
- Kausikertoimet kertovat kysynnän, ja tapahtumat muuttavat kysyntää, hintoja ja kuluja vain voimassaolokuukausina. Kertakulut maksetaan kerran.
- Kirjanpito täsmää aina: kassan muutos = tulos − saamiset + ostovelat − varasto.
- **Ei mukana:** arvonlisävero (summat alv 0 %), tuloverot, lainat ja korot.

## 17. Kielituki kehittäjälle

- Tekstit kirjoitetaan koodiin **vain suomeksi** `t("…")`-kutsuun. Suomenkielinen teksti on käännösavain.
- `npm run i18n` näyttää puuttuvat käännökset, ja `npm run i18n:translate` kääntää ne kielimallilla sanaston (`src/flow/i18n/glossary.ts`) avulla.
- Puuttuva käännös näyttää suomen. Englanti ei siis koskaan estä julkaisua.
- Nykyiset englanninkieliset tekstit on käännetty kielimallilla eikä niitä ole vielä tarkistettu ihmisen toimesta.

## 18. Tunnetut rajoitukset

- Malli tallentuu vain selaimeen (ei käyttäjätilejä eikä pilveä, vaihe 15).
- PDF-tiliotteita ei tueta.
- Markkinatiedon haku käyttää Wikipediaa. Muut lähteet ovat kielimallin yleistietoa, ja ne merkitään arvioiksi.
- Klassinen näkymä (`/classic`) on vielä mukana, ja se poistetaan vaiheessa 16.
