/**
 * APEX Studio v3.2 — Capability Classification & Gap Analysis Engine (`src/flow/graph/gaps.ts`).
 *
 * Implements TSD v3.2 Section 4.4, Override 2, Override 4, and Principle P1 / P9:
 * - Industry-agnostic `BusinessCapability` template schema with explicit sources, dates,
 *   and non-legal-advice disclaimers.
 * - Built-in pure data templates (3 distinct operational profiles) that can be applied or
 *   compared without code changes.
 * - `analyzeGaps(graph, template)` compares a graph's `BusinessCapability` map and broken
 *   `stub` streams (`named` / `unknown` / `ghost` upstream nodes) against a capability template
 *   and produces a structured, plain-language readiness & risk report.
 */
import type {
  BusinessCapability,
  EnterpriseGraph,
  EntityURI,
  VentureMaturity,
} from "./types.ts";

export interface CapabilityTemplateNote {
  kind: "cost" | "risk" | "obligation" | "question";
  text: string;
  estimatedMonthlyEur?: number;
}

export interface CapabilityTemplateItem {
  slug: string;
  name: string;
  statusDefault: "known" | "unclear" | "missing";
  rationale: string;
  consequenceIfMissing: string;
  dependsOnSlugs: string[];
  notes: CapabilityTemplateNote[];
  canonicalRef?: string;
}

export interface CapabilityTemplate {
  id: string;
  name: string;
  description: string;
  source: string;
  updatedAt: string;
  disclaimer: string;
  items: CapabilityTemplateItem[];
}

export interface GapItem {
  uri: EntityURI;
  name: string;
  status: "unclear" | "missing";
  rationale: string;
  consequence: string;
  estimatedMonthlyCost: number;
  openQuestions: string[];
  obligationsAndRisks: string[];
  suggestedAction: string;
  canonicalRef?: string;
}

export interface StubStreamWarning {
  streamUri: EntityURI;
  streamName: string;
  fromNodeUri: EntityURI;
  fromNodeName: string;
  toNodeUri: EntityURI;
  toNodeName: string;
  reason: string;
}

export interface GapAnalysisReport {
  templateId: string;
  templateName: string;
  source: string;
  updatedAt: string;
  disclaimer: string;
  maturity: VentureMaturity;
  knownCount: number;
  unclearCount: number;
  missingCount: number;
  totalEstimatedMonthlyCost: number;
  unpricedCostItemsCount: number;
  gaps: GapItem[];
  stubWarnings: StubStreamWarning[];
  undefinedNodes: { uri: EntityURI; name: string; definition: "named" | "unknown" | "ghost" }[];
  readinessScore: number;
  summaryText: string;
  canAdvanceMaturity: boolean;
  advanceRecommendation: string;
}

const DEFAULT_DISCLAIMER =
  "Suuntaa-antava suunnittelupohja — ei oikeudellista, verotuksellista tai viranomaisneuvontaa. Tarkista ajantasaiset velvoitteet viranomaislähteistä.";

/**
 * Pohja 1: Fyysisen tuotteen, valmistuksen tai tuotebrändin kyvykkyyspohja.
 */
export const PHYSICAL_PRODUCT_CAPABILITY_TEMPLATE: CapabilityTemplate = {
  id: "physical_product_brand",
  name: "Fyysisen tuotteen ja brändin kyvykkyyspohja",
  description:
    "Kattaa tuotekehityksen, tuoteturvallisuuden, sopimusvalmistuksen tai hankinnan, varastoinnin ja jakelun kyvykkyydet.",
  source: "Yleinen liiketoimintakyvykkyysluokitus (APQC 2.0–4.0 / EU-tuoteturvallisuusviitekehys)",
  updatedAt: "2026-10-24",
  disclaimer: DEFAULT_DISCLAIMER,
  items: [
    {
      slug: "product_formulation_and_rnd",
      name: "Tuotekehitys, reseptiikka ja prototyyppien validointi",
      statusDefault: "unclear",
      rationale: "Fyysinen tuote vaatii todennetun koostumuksen, laatuvaatimukset ja yksikkökustannuslaskelman ennen erätuotantoa.",
      consequenceIfMissing: "Tuotteen laatu vaihtelee, yksikkökate jää negatiiviseksi tai erät viivästyvät.",
      dependsOnSlugs: [],
      canonicalRef: "APQC-2.1",
      notes: [
        {
          kind: "cost",
          text: "Tuotekehitys-, laboratorio- ja mallieräkulut",
          estimatedMonthlyEur: 450,
        },
        {
          kind: "question",
          text: "Onko tuotteen koostumus, pakkaus ja tavoiteyksikkökustannus lukittu?",
        },
      ],
    },
    {
      slug: "regulatory_and_product_safety",
      name: "Tuoteturvallisuus, merkinnät ja viranomaisrekisteröinnit",
      statusDefault: "missing",
      rationale: "Kuluttaja- ja ammattituotteilla on pakolliset turvallisuusarvioinnit, pakkausmerkinnät ja vastuuvelvoitteet.",
      consequenceIfMissing: "Myyntikielto, takaisinveto tai vakuutussuojan puuttuminen vahinkotilanteessa.",
      dependsOnSlugs: ["product_formulation_and_rnd"],
      canonicalRef: "APQC-11.1",
      notes: [
        {
          kind: "obligation",
          text: "Tuoteturvallisuusasiakirjat, pakkausmerkinnät ja tuotevastuuvakuutus",
        },
        {
          kind: "cost",
          text: "Sertifiointi-, rekisteröinti- ja vakuutusmaksut",
          estimatedMonthlyEur: 240,
        },
        {
          kind: "risk",
          text: "Viranomaisrekisteröinnin tai turvallisuusarvioinnin läpimenoaika voi viivästyttää lanseerausta 1–3 kk.",
        },
      ],
    },
    {
      slug: "sourcing_and_contract_manufacturing",
      name: "Raaka-aineiden hankinta ja sopimusvalmistajaverkosto",
      statusDefault: "missing",
      rationale: "Määrittää minimitilauserät (MOQ), toimitusajat, ostohinnat ja toimitusvarmuuden.",
      consequenceIfMissing: "Toimituskatkokset tai liian suuri minimitilauserä sitoo koko alkukassan varastoon.",
      dependsOnSlugs: ["product_formulation_and_rnd"],
      canonicalRef: "APQC-4.1",
      notes: [
        {
          kind: "cost",
          text: "Alkuvaraston ja pakkausmateriaalien sitoma käyttöpääoma",
          estimatedMonthlyEur: 600,
        },
        {
          kind: "question",
          text: "Mikä on toimittajan minimitilauserä (MOQ), toimitusaika ja maksuehto?",
        },
      ],
    },
    {
      slug: "demand_and_channel_acquisition",
      name: "Brändi, asiakashankinta ja myyntikanavat",
      statusDefault: "unclear",
      rationale: "Ilman toistettavaa asiakashankintakanavaa valmis varasto jää sitomaan pääomaa.",
      consequenceIfMissing: "Myyntivolyymi ei kata kiinteitä kuluja ja varasto vanhenee.",
      dependsOnSlugs: ["product_formulation_and_rnd"],
      canonicalRef: "APQC-3.0",
      notes: [
        {
          kind: "cost",
          text: "Markkinoinnin, näytteiden ja myyntikanavan kuukausibudjetti",
          estimatedMonthlyEur: 550,
        },
        {
          kind: "question",
          text: "Mikä on asiakashankintakustannus (CAC) suhteessa kertaostoksen katteeseen?",
        },
      ],
    },
    {
      slug: "fulfillment_and_returns",
      name: "Varastointi, toimitukset ja palautusten käsittely",
      statusDefault: "unclear",
      rationale: "Logistiikka, pakkaus ja asiakaspalautukset vaikuttavat suoraan yksikkökatteeseen ja läpimenoaikaan.",
      consequenceIfMissing: "Toimituskulut ja palautukset syövät myyntikatteen.",
      dependsOnSlugs: ["sourcing_and_contract_manufacturing", "demand_and_channel_acquisition"],
      canonicalRef: "APQC-4.4",
      notes: [
        {
          kind: "cost",
          text: "Varastointi-, keräily- ja lähetysjärjestelmien peruskulut",
          estimatedMonthlyEur: 320,
        },
      ],
    },
    {
      slug: "working_capital_and_financial_control",
      name: "Käyttöpääoman, kassasyklin ja taloushallinnon ohjaus",
      statusDefault: "unclear",
      rationale: "Ostovelkojen, varaston kierron ja myyntisaamisten eriaikaisuus ratkaisee kassan riittävyyden.",
      consequenceIfMissing: "Kassakriisi kasvuvaiheessa, kun ostot maksetaan ennen myyntitulojen kotiutumista.",
      dependsOnSlugs: ["fulfillment_and_returns"],
      canonicalRef: "APQC-9.0",
      notes: [
        {
          kind: "cost",
          text: "Taloushallinto, kirjanpito ja maksuliikenne",
          estimatedMonthlyEur: 180,
        },
      ],
    },
  ],
};

/**
 * Pohja 2: Asiantuntija-, palvelu- ja aikakapasiteettiorganisaation kyvykkyyspohja.
 */
export const EXPERT_SERVICE_CAPABILITY_TEMPLATE: CapabilityTemplate = {
  id: "expert_knowledge_service",
  name: "Asiantuntija- ja palveluorganisaation kyvykkyyspohja",
  description:
    "Kattaa palvelulupauksen tuotteistuksen, myyntiputken, asiantuntijakapasiteetin kuormituksen, sopimusvastuut ja laskutuksen.",
  source: "Yleinen palveluliiketoiminnan kyvykkyysluokitus (APQC 2.0–5.0 / PRH & Verohallinto)",
  updatedAt: "2026-10-24",
  disclaimer: DEFAULT_DISCLAIMER,
  items: [
    {
      slug: "service_packaging_and_pricing",
      name: "Palvelulupauksen rajaus ja hinnoittelumalli",
      statusDefault: "known",
      rationale: "Selkeä palvelukuvaus ja tunti- tai kiinteähinnoittelu estävät työmäärän hallitsemattoman paisumisen.",
      consequenceIfMissing: "Laskuttamaton lisätyö laskee todellisen tuntituoton alle kannattavuusrajan.",
      dependsOnSlugs: [],
      canonicalRef: "APQC-2.2",
      notes: [
        {
          kind: "question",
          text: "Mikä osuus työviikosta on aidosti laskutettavaa asiakastyötä?",
        },
      ],
    },
    {
      slug: "lead_generation_and_proposal_pipeline",
      name: "Uusasiakashankinta ja tarjouskantaputki",
      statusDefault: "unclear",
      rationale: "Tasainen tarjouskanta ehkäisee kuukausittaiset kuoppajaksot asiakasprojektien välillä.",
      consequenceIfMissing: "Kapasiteetin käyttöaste romahtaa toimeksiantojen päättyessä.",
      dependsOnSlugs: ["service_packaging_and_pricing"],
      canonicalRef: "APQC-3.3",
      notes: [
        {
          kind: "cost",
          text: "Myynnin työkalut, verkostoituminen ja markkinointi",
          estimatedMonthlyEur: 250,
        },
      ],
    },
    {
      slug: "delivery_capacity_and_quality",
      name: "Toimituskapasiteetti, osaaminen ja laadunvarmistus",
      statusDefault: "known",
      rationale: "Henkilöstön mitoitus ja työkalut määrittävät maksimiläpimenon ja toimitusajan.",
      consequenceIfMissing: "Ylikuormitus (> 85 %) kasvattaa jonoja ja virheiden korjaustyötä.",
      dependsOnSlugs: ["service_packaging_and_pricing"],
      canonicalRef: "APQC-5.2",
      notes: [
        {
          kind: "cost",
          text: "Ammattityökalut, ohjelmistot ja työvälineet",
          estimatedMonthlyEur: 160,
        },
      ],
    },
    {
      slug: "contracts_ipr_and_liability",
      name: "Toimeksiantosopimukset, vastuunrajaus ja vakuutusturva",
      statusDefault: "missing",
      rationale: "Kirjalliset sopimusehdot, immateriaalioikeudet ja vastuuvakuutus suojaavat korvausvaatimuksilta.",
      consequenceIfMissing: "Rajoittamaton vahingonkorvausvastuu tai riita työn hyväksymisestä.",
      dependsOnSlugs: ["service_packaging_and_pricing"],
      canonicalRef: "APQC-11.2",
      notes: [
        {
          kind: "obligation",
          text: "Toimeksiantosopimuspohja, vastuunrajaama ja varallisuus-/vastuuvakuutus",
        },
        {
          kind: "cost",
          text: "Vakuutukset ja lakisääteiset eläke-/sosiaaliturvamaksut",
          estimatedMonthlyEur: 310,
        },
      ],
    },
    {
      slug: "invoicing_and_receivables_management",
      name: "Laskutusrytmi, maksuehdot ja kassapuskuri",
      statusDefault: "unclear",
      rationale: "Pitkä maksuaika (30–60 pv) sitoo käyttöpääomaa, vaikka tuloslaskelma näyttäisi voitolliselta.",
      consequenceIfMissing: "Kassa tyhjenee ennen kuin asiakkaiden laskut erääntyvät maksuun.",
      dependsOnSlugs: ["delivery_capacity_and_quality"],
      canonicalRef: "APQC-9.2",
      notes: [
        {
          kind: "cost",
          text: "Laskutus- ja kirjanpitopalvelu",
          estimatedMonthlyEur: 150,
        },
        {
          kind: "risk",
          text: "Yli 21 päivän maksuehto vaatii suuremman alkukassapuskurin.",
        },
      ],
    },
  ],
};

/**
 * Pohja 3: Jatkuvan tilaus-, sopimus- tai digitaalisen alustapalvelun kyvykkyyspohja.
 */
export const RECURRING_DIGITAL_CAPABILITY_TEMPLATE: CapabilityTemplate = {
  id: "recurring_digital_service",
  name: "Jatkuvan tilaus- ja alustapalvelun kyvykkyyspohja",
  description:
    "Kattaa palvelualustan kehityksen, asiakkaiden käyttöönoton, poistuman (churn) hallinnan, tietosuojan ja toistuvan laskutuksen.",
  source: "Yleinen tilausliiketoiminnan kyvykkyysluokitus (APQC 2.0–8.0 / EU-tietosuojaviitekehys)",
  updatedAt: "2026-10-24",
  disclaimer: DEFAULT_DISCLAIMER,
  items: [
    {
      slug: "platform_architecture_and_delivery",
      name: "Ydinalustan kehitys, ylläpito ja toimintavarmuus",
      statusDefault: "known",
      rationale: "Jatkuva palvelu edellyttää vakaata tuotantoympäristöä ja säännöllistä ylläpitoa.",
      consequenceIfMissing: "Käyttökatkot rikkovat palvelulupauksen ja kiihdyttävät asiakaspoistumaa.",
      dependsOnSlugs: [],
      canonicalRef: "APQC-8.4",
      notes: [
        {
          kind: "cost",
          text: "Palvelin-, pilvi- ja kehitysympäristökulut",
          estimatedMonthlyEur: 340,
        },
      ],
    },
    {
      slug: "customer_acquisition_and_onboarding",
      name: "Asiakashankinta ja sujuva käyttöönotto (Onboarding)",
      statusDefault: "unclear",
      rationale: "Asiakashankintakustannuksen (CAC) on oltava oikeassa suhteessa asiakkaan elinkaariarvoon (LTV).",
      consequenceIfMissing: "Asiakashankinta polttaa kassaa nopeammin kuin kuukausimaksut kerryttävät sitä.",
      dependsOnSlugs: ["platform_architecture_and_delivery"],
      canonicalRef: "APQC-3.4",
      notes: [
        {
          kind: "cost",
          text: "Digitaalinen asiakashankinta ja kokeilujaksojen tuki",
          estimatedMonthlyEur: 750,
        },
        {
          kind: "question",
          text: "Kuinka monessa kuukaudessa uusi tilaaja maksaa hankintakulunsa (CAC payback) takaisin?",
        },
      ],
    },
    {
      slug: "retention_and_customer_success",
      name: "Asiakaspysyvyys, tuki ja poistuman (Churn) hallinta",
      statusDefault: "unclear",
      rationale: "Pienikin muutos kuukausipoistumassa muuttaa tilauskannan kasvukäyrän ja kannattavuuden.",
      consequenceIfMissing: "Poistuma kumoaa uusmyynnin ja tilauskanta polkee paikallaan.",
      dependsOnSlugs: ["customer_acquisition_and_onboarding"],
      canonicalRef: "APQC-6.2",
      notes: [
        {
          kind: "risk",
          text: "Yli 5 % kuukausipoistuma pysäyttää orgaanisen kasvun.",
        },
      ],
    },
    {
      slug: "data_privacy_security_and_terms",
      name: "Tietosuoja, tietoturva ja käyttöehdot (SLA)",
      statusDefault: "missing",
      rationale: "Henkilö- ja yritysdatan käsittely vaatii rekisteriselosteet, sopimusehdot ja tietoturvakäytännöt.",
      consequenceIfMissing: "Estää yritysasiakkaiden hankinnan ja luo sääntelyriskin.",
      dependsOnSlugs: ["platform_architecture_and_delivery"],
      canonicalRef: "APQC-8.3",
      notes: [
        {
          kind: "obligation",
          text: "Käyttöehdot, tietosuojaseloste ja tietojenkäsittelysopimukset (DPA)",
        },
        {
          kind: "cost",
          text: "Tietoturvavalvonta, varmuuskopiointi ja vakuutukset",
          estimatedMonthlyEur: 210,
        },
      ],
    },
    {
      slug: "recurring_billing_and_revenue_ops",
      name: "Toistuva laskutus, maksuvälitys ja talousseuranta",
      statusDefault: "known",
      rationale: "Automaattinen veloitussykli ja epäonnistuneiden maksujen uusinta turvaavat kassavirran.",
      consequenceIfMissing: "Manuaalinen laskutus viivästyttää suorituksia ja aiheuttaa luottotappioita.",
      dependsOnSlugs: ["customer_acquisition_and_onboarding"],
      canonicalRef: "APQC-9.3",
      notes: [
        {
          kind: "cost",
          text: "Maksuvälitys-, taloushallinto- ja kirjanpitokulut",
          estimatedMonthlyEur: 190,
        },
      ],
    },
  ],
};

export const CAPABILITY_TEMPLATES: Record<string, CapabilityTemplate> = {
  [PHYSICAL_PRODUCT_CAPABILITY_TEMPLATE.id]: PHYSICAL_PRODUCT_CAPABILITY_TEMPLATE,
  [EXPERT_SERVICE_CAPABILITY_TEMPLATE.id]: EXPERT_SERVICE_CAPABILITY_TEMPLATE,
  [RECURRING_DIGITAL_CAPABILITY_TEMPLATE.id]: RECURRING_DIGITAL_CAPABILITY_TEMPLATE,
};

export const CAPABILITY_TEMPLATE_LIST: readonly CapabilityTemplate[] = [
  PHYSICAL_PRODUCT_CAPABILITY_TEMPLATE,
  EXPERT_SERVICE_CAPABILITY_TEMPLATE,
  RECURRING_DIGITAL_CAPABILITY_TEMPLATE,
];

/**
 * Valitsee sopivimman kyvykkyyspohjan graafin tai syötteen rakenteen perusteella.
 */
export function selectCapabilityTemplate(templateId?: string): CapabilityTemplate {
  if (templateId && CAPABILITY_TEMPLATES[templateId]) {
    return CAPABILITY_TEMPLATES[templateId]!;
  }
  return PHYSICAL_PRODUCT_CAPABILITY_TEMPLATE;
}

/**
 * Muuntaa kyvykkyyspohjan `BusinessCapability`-tietueiksi.
 */
export function buildBusinessCapabilitiesFromTemplate(
  template: CapabilityTemplate,
  provenance: "template" | "genesis" | "user" = "template",
  statusOverrides: Record<string, "known" | "unclear" | "missing"> = {},
): Record<string, BusinessCapability> {
  const out: Record<string, BusinessCapability> = {};
  for (const item of template.items) {
    const uri: EntityURI = `apex://capability-biz/${item.slug}`;
    out[uri] = {
      uri,
      name: item.name,
      status: statusOverrides[uri] ?? statusOverrides[item.slug] ?? item.statusDefault,
      rationale: item.rationale,
      dependsOn: item.dependsOnSlugs.map((s) => `apex://capability-biz/${s}` as EntityURI),
      notes: item.notes.map((n) => ({
        kind: n.kind,
        text: n.text,
        ...(n.estimatedMonthlyEur !== undefined ? { amount: { const: n.estimatedMonthlyEur } } : {}),
      })),
      canonicalRef: item.canonicalRef,
      realizedBy: [],
      provenance,
    };
  }
  return out;
}

/**
 * Yhdistää kyvykkyyspohjan `EnterpriseGraph`-rakenteeseen säilyttäen käyttäjän olemassa olevat
 * tilavalinnat (`known` / `unclear` / `missing`).
 */
export function applyCapabilityTemplate(
  graph: EnterpriseGraph,
  template: CapabilityTemplate,
  provenance: "template" | "genesis" | "user" = "template",
): EnterpriseGraph {
  const existing = graph.businessCapabilities ?? {};
  const fromTpl = buildBusinessCapabilitiesFromTemplate(template, provenance);
  const merged: Record<string, BusinessCapability> = { ...fromTpl };

  for (const [uri, bc] of Object.entries(existing)) {
    if (merged[uri]) {
      merged[uri] = {
        ...merged[uri]!,
        status: bc.status,
        realizedBy: bc.realizedBy.length > 0 ? bc.realizedBy : merged[uri]!.realizedBy,
        provenance: bc.provenance,
      };
    } else {
      merged[uri] = bc;
    }
  }

  return {
    ...graph,
    businessCapabilities: merged,
  };
}

/**
 * Suorittaa aukkoanalyysin (`analyzeGaps`, TSD 4.4 & Override 4):
 * - Tarkistaa graafin `BusinessCapability`-solmut (tai annetun `template`-pohjan).
 * - Tunnistaa keskeneräiset (`named` / `unknown` / `ghost`) prosessisolmut ja niistä lähtevät
 *   katkenneet `stub`-virrat.
 * - Tuottaa selkokielisen yhteenvedon puuttuvista kyvykkyyksistä, alustavista kuluista,
 *   velvoitteista ja valmiudesta edetä seuraavalle kypsyystasolle.
 */
export function analyzeGaps(
  graph: EnterpriseGraph,
  template?: CapabilityTemplate,
): GapAnalysisReport {
  const activeTemplate = template ?? PHYSICAL_PRODUCT_CAPABILITY_TEMPLATE;
  const templateByUri = new Map<string, CapabilityTemplateItem>();
  for (const item of activeTemplate.items) {
    templateByUri.set(`apex://capability-biz/${item.slug}`, item);
  }

  // Jos graafissa ei ole vielä BusinessCapability-solmuja tai annettiin eksplisiittinen pohja,
  // käytetään pohjan ja graafin yhdistelmää.
  const existingCaps = Object.values(graph.businessCapabilities ?? {});
  const capabilitiesToEvaluate: BusinessCapability[] =
    template !== undefined
      ? Object.values(
          buildBusinessCapabilitiesFromTemplate(
            template,
            "template",
            Object.fromEntries(existingCaps.map((c) => [c.uri, c.status])),
          ),
        )
      : existingCaps.length > 0
        ? existingCaps
        : Object.values(buildBusinessCapabilitiesFromTemplate(activeTemplate));

  let knownCount = 0;
  let unclearCount = 0;
  let missingCount = 0;
  let totalEstimatedMonthlyCost = 0;
  let unpricedCostItemsCount = 0;
  const gaps: GapItem[] = [];

  for (const bc of capabilitiesToEvaluate) {
    if (bc.status === "known") {
      knownCount += 1;
    } else if (bc.status === "unclear") {
      unclearCount += 1;
    } else {
      missingCount += 1;
    }

    let capMonthlyCost = 0;
    const openQuestions: string[] = [];
    const obligationsAndRisks: string[] = [];

    for (const note of bc.notes) {
      if (note.kind === "cost") {
        if (note.amount) {
          const v =
            "const" in note.amount
              ? note.amount.const
              : (graph.factors[note.amount.factor]?.value ?? 0);
          capMonthlyCost += v;
          totalEstimatedMonthlyCost += v;
        } else {
          unpricedCostItemsCount += 1;
        }
      } else if (note.kind === "question") {
        openQuestions.push(note.text);
      } else {
        obligationsAndRisks.push(note.text);
      }
    }

    if (bc.status !== "known") {
      const tplItem = templateByUri.get(bc.uri);
      const consequence =
        tplItem?.consequenceIfMissing ??
        (bc.status === "missing"
          ? "Kyvykkyys puuttuu kokonaan: toimintaa ei voida käynnistää turvallisesti ilman ratkaisua."
          : "Kyvykkyyden toteutustapa ja kustannusvaikutus ovat vielä avoimia.");

      const suggestedAction =
        bc.status === "missing"
          ? `Määrittele vastuu ja toteutustapa kyvykkyydelle "${bc.name}" ennen operatiivista käynnistystä.`
          : `Tarkenna avoimet kysymykset ja kustannusarvio kyvykkyydelle "${bc.name}".`;

      gaps.push({
        uri: bc.uri,
        name: bc.name,
        status: bc.status,
        rationale: bc.rationale ?? tplItem?.rationale ?? "",
        consequence,
        estimatedMonthlyCost: capMonthlyCost,
        openQuestions,
        obligationsAndRisks,
        suggestedAction,
        canonicalRef: bc.canonicalRef,
      });
    }
  }

  // Tunnista keskeneräiset solmut ja katkenneet stub-virrat (Override 4)
  const undefinedNodes: { uri: EntityURI; name: string; definition: "named" | "unknown" | "ghost" }[] = [];
  for (const node of Object.values(graph.nodes)) {
    if (node.level === 0) continue;
    if (node.ghost?.status === "pending") {
      undefinedNodes.push({ uri: node.uri, name: node.name, definition: "ghost" });
    } else if (node.definition === "named" || node.definition === "unknown") {
      undefinedNodes.push({ uri: node.uri, name: node.name, definition: node.definition });
    }
  }

  const stubWarnings: StubStreamWarning[] = [];
  for (const stream of Object.values(graph.streams)) {
    const fromNode = graph.nodes[stream.from.node];
    const toNode = graph.nodes[stream.to.node];
    if (!fromNode || !toNode) continue;
    const fromSkipped =
      fromNode.definition === "named" ||
      fromNode.definition === "unknown" ||
      fromNode.ghost?.status === "pending";
    const toActive =
      (toNode.definition ?? "defined") === "defined" && toNode.ghost?.status !== "pending";
    if (fromSkipped && toActive) {
      stubWarnings.push({
        streamUri: stream.uri,
        streamName: stream.name,
        fromNodeUri: fromNode.uri,
        fromNodeName: fromNode.name,
        toNodeUri: toNode.uri,
        toNodeName: toNode.name,
        reason: "Ei laskettu: odottaa ylävirran määrittelyä",
      });
    }
  }

  const totalCaps = Math.max(1, capabilitiesToEvaluate.length);
  const readinessScore = Math.round(((knownCount + unclearCount * 0.4) / totalCaps) * 100);
  const maturity: VentureMaturity = graph.maturity ?? 3;
  const canAdvanceMaturity = missingCount === 0 && stubWarnings.length === 0;

  const summaryText =
    missingCount > 0
      ? `Kyvykkyyskartassa on ${missingCount} puuttuvaa ja ${unclearCount} täsmennettävää osa-aluetta (${knownCount}/${totalCaps} kunnossa). Tunnistetut alustavat peruskulut ovat ${Math.round(totalEstimatedMonthlyCost)} €/kk.`
      : unclearCount > 0
        ? `Yhtään kriittistä kyvykkyyttä ei puutu kokonaan, mutta ${unclearCount} osa-aluetta kaipaa vielä täsmennystä (${knownCount}/${totalCaps} kunnossa).`
        : `Kaikki ${totalCaps} ydinkyvykkyyttä on määritelty. Malli on valmis operatiiviseen prosessi- ja kassavirtasimulaatioon.`;

  const advanceRecommendation = canAdvanceMaturity
    ? maturity < 2
      ? "Ydinkyvykkyydet on tunnistettu. Voit halutessasi edetä kypsyystasolle 2–3 hahmottelemaan prosessisolmut ja virrat."
      : "Prosessit ja kyvykkyydet ovat yhtenäiset."
    : `Ratkaise ensin puuttuvat kyvykkyydet (${missingCount} kpl)${
        stubWarnings.length > 0 ? ` ja katkenneet ylävirran kytkennät (${stubWarnings.length} kpl)` : ""
      } ennen täyttä operatiivista simulaatiota.`;

  return {
    templateId: activeTemplate.id,
    templateName: activeTemplate.name,
    source: activeTemplate.source,
    updatedAt: activeTemplate.updatedAt,
    disclaimer: activeTemplate.disclaimer,
    maturity,
    knownCount,
    unclearCount,
    missingCount,
    totalEstimatedMonthlyCost,
    unpricedCostItemsCount,
    gaps,
    stubWarnings,
    undefinedNodes,
    readinessScore,
    summaryText,
    canAdvanceMaturity,
    advanceRecommendation,
  };
}
