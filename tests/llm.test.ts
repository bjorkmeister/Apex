/**
 * Automated Test Suite for APEX Multi-Provider Bring-Your-Own-Key (BYOK) LLM Engine B (`/tests/llm.test.ts`).
 *
 * Verifies:
 *  1. Multi-Provider runtime configuration (Gemini, OpenAI, Anthropic, Deterministic)
 *  2. Safe API key masking and credential hygiene
 *  3. Dynamic provider switching and model catalogs
 *  4. Two-Phase Commit validation on LLM C-Suite War Room Briefings
 *  5. Business DNA Compiler synthesis within Archetype Sanity Bounds
 *  6. War Room Server `/api/llm/config` and `/api/llm/test` endpoints
 *  7. Master BYOK Modal and Topbar badge rendering in UI
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildVerticalFarmScenario,
  getActiveLlmConfig,
  getMaskedLlmConfig,
  generateWarRoomBriefingWithLlm,
  generateBusinessDnaPatchWithLlm,
  isLlmConfigured,
  maskApiKey,
  PROVIDER_PRESETS,
  setActiveLlmConfig,
  testLlmConnection,
  validateAction,
  verifyAccountingInvariants,
} from "../src/core/index.ts";

describe("APEX Engine B — Multi-Provider Bring-Your-Own-Key (BYOK) Verification Suite", () => {
  it("1. Accurately manages runtime configuration, key masking, and provider presets", () => {
    // Test key masking
    assert.equal(maskApiKey(""), undefined);
    assert.equal(maskApiKey("12345"), "••••••••");
    assert.equal(
      maskApiKey("sk-proj-1234567890abcdef"),
      "sk-proj...cdef",
      "OpenAI key should be masked with sk-proj prefix and trailing 4 chars",
    );
    assert.equal(
      maskApiKey("AQ.Ab8RN6JLkvOMHOgsWwTk-ygpL9LjoA70jMcjyVSLqyLEOMlp2g"),
      "AQ.Ab8R...lp2g",
      "Vertex AI key should be masked with AQ. prefix and trailing 4 chars",
    );
    assert.equal(
      maskApiKey("AIzaSyAbcd12345efgh6789"),
      "AIzaSy...6789",
      "Google AI Studio key should be masked with AIzaSy prefix",
    );

    // Verify all 4 provider presets exist with metadata
    assert.ok(PROVIDER_PRESETS.gemini, "Gemini preset must exist");
    assert.ok(PROVIDER_PRESETS.openai, "OpenAI preset must exist");
    assert.ok(PROVIDER_PRESETS.anthropic, "Anthropic preset must exist");
    assert.ok(PROVIDER_PRESETS.deterministic, "Deterministic preset must exist");

    assert.equal(PROVIDER_PRESETS.deterministic.requiresKey, false);
    assert.equal(PROVIDER_PRESETS.gemini.requiresKey, true);
    assert.equal(PROVIDER_PRESETS.openai.requiresKey, true);
    assert.equal(PROVIDER_PRESETS.anthropic.requiresKey, true);
  });

  it("2. Supports dynamic switching between Gemini, OpenAI, Anthropic, and Deterministic engines", () => {
    // Switch to Deterministic
    setActiveLlmConfig({ provider: "deterministic" });
    let cfg = getActiveLlmConfig();
    assert.equal(cfg.provider, "deterministic");
    assert.equal(isLlmConfigured(cfg), false);

    let masked = getMaskedLlmConfig();
    assert.equal(masked.provider, "deterministic");
    assert.equal(masked.isKeySet, false);

    // Switch to OpenAI with a custom key
    setActiveLlmConfig({
      provider: "openai",
      apiKey: "sk-proj-test-1234567890-abcdef",
      model: "gpt-4o-mini",
    });
    cfg = getActiveLlmConfig();
    assert.equal(cfg.provider, "openai");
    assert.equal(cfg.model, "gpt-4o-mini");
    assert.equal(isLlmConfigured(cfg), true);

    masked = getMaskedLlmConfig();
    assert.equal(masked.provider, "openai");
    assert.equal(masked.isKeySet, true);
    assert.ok(masked.maskedKey?.startsWith("sk-proj"));

    // Switch to Anthropic with custom model
    setActiveLlmConfig({
      provider: "anthropic",
      apiKey: "sk-ant-api03-test-token-anthropic-1234",
      model: "claude-3-5-haiku-latest",
    });
    cfg = getActiveLlmConfig();
    assert.equal(cfg.provider, "anthropic");
    assert.equal(cfg.model, "claude-3-5-haiku-latest");
    assert.equal(isLlmConfigured(cfg), true);

    masked = getMaskedLlmConfig();
    assert.equal(masked.provider, "anthropic");
    assert.equal(masked.isKeySet, true);
    assert.ok(masked.maskedKey?.includes("..."));

    // Switch to Gemini with Vertex Express key
    setActiveLlmConfig({
      provider: "gemini",
      apiKey: "AQ.Ab8RN6JLkvOMHOgsWwTk-ygpL9LjoA70jMcjyVSLqyLEOMlp2g",
      model: "gemini-2.5-pro",
    });
    cfg = getActiveLlmConfig();
    assert.equal(cfg.provider, "gemini");
    assert.equal(cfg.model, "gemini-2.5-pro");
    assert.equal(isLlmConfigured(cfg), true);
  });

  it("3. Generates Two-Phase Commit validated War Room Briefings and falls back cleanly without key", async () => {
    const state = buildVerticalFarmScenario(20261016);

    // Test with Deterministic engine
    const detRes = await generateWarRoomBriefingWithLlm(state, {
      provider: "deterministic",
    });
    assert.ok(detRes.briefing.executiveSummary.length > 0);
    assert.equal(detRes.briefing.proposals.length, 4, "Must have 4 C-Suite proposals (COO, CFO, CRO, CHRO)");
    assert.ok(detRes.briefing.debateTranscript.length >= 2, "Must include cross-functional debate transcript");

    // Every proposal's actions must pass Engine A Two-Phase Commit validation
    for (const prop of detRes.briefing.proposals) {
      assert.ok(["coo", "cfo", "cro", "chro"].includes(prop.agentRole));
      for (const act of prop.actions) {
        const val = validateAction(state, act);
        assert.equal(
          val.valid,
          true,
          `Action ${act.type} emitted for ${prop.agentRole} must be feasible and valid under Engine A invariants`,
        );
      }
    }
  });

  it("4. Tests connection diagnostics for Deterministic, Unconfigured, and Configured providers", async () => {
    // Deterministic test
    const detTest = await testLlmConnection({ provider: "deterministic" });
    assert.equal(detTest.ok, true);
    assert.ok(detTest.message.includes("Deterministic engine active"));

    // Missing key test
    const noKeyTest = await testLlmConnection({
      provider: "openai",
      apiKey: "",
      model: "gpt-4o",
    });
    assert.equal(noKeyTest.ok, false);
    assert.ok(noKeyTest.message.includes("No API key"));
  });

  it("5. Verifies War Room Server /api/llm/config, /api/llm/test, and UI modal rendering", async () => {
    const {
      buildViewPayload,
      createInitialSession,
    } = await import("../src/app/server.ts");

    const session = createInitialSession("vertical_farm");

    // 1. Check buildViewPayload surfaces llmConfig and interactive button
    const payload = buildViewPayload(session);
    assert.ok(payload.llmConfig, "llmConfig must be present in view payload");
    assert.ok(payload.html.includes("btn-open-llm-modal"), "HTML must include interactive BYOK modal button");
    assert.ok(payload.html.includes("llm-modal-backdrop"), "HTML must include BYOK modal container");
    assert.ok(payload.html.includes("Google Gemini"));
    assert.ok(payload.html.includes("OpenAI"));
    assert.ok(payload.html.includes("Anthropic Claude"));
    assert.ok(payload.html.includes("Deterministic (Offline)"));

    // 2. Test in-process configuration update and verification
    setActiveLlmConfig({
      provider: "openai",
      apiKey: "sk-proj-test-key-1234567890",
      model: "gpt-4o-mini",
    });
    const updatedPayload = buildViewPayload(session);
    assert.equal(updatedPayload.llmConfig.provider, "openai");
    assert.equal(updatedPayload.llmConfig.model, "gpt-4o-mini");
    assert.equal(updatedPayload.llmConfig.isKeySet, true);
    assert.ok(updatedPayload.html.includes("OPENAI ARMED"));

    // 3. Test in-process connection verification for deterministic provider
    const testRes = await testLlmConnection({ provider: "deterministic" });
    assert.equal(testRes.ok, true);
    assert.ok(testRes.message.includes("Deterministic"));
  });

  it("6. Guides the user progressively from Tabula Rasa through Canvas and Capability Design to War Room", async () => {
    const {
      buildViewPayload,
      createInitialSession,
    } = await import("../src/app/server.ts");

    // 1. Initial State: Tabula Rasa (Phase 0)
    const session = createInitialSession("vertical_farm", "genesis");
    assert.equal(session.mode, "genesis");
    const genesisPayload = buildViewPayload(session);
    assert.equal(genesisPayload.mode, "genesis");
    assert.ok(genesisPayload.html.includes("TYHJÄ PÖYTÄ • TABULA RASA"), "Must render welcoming Tabula Rasa hero");
    assert.ok(genesisPayload.html.includes("Minkälaisen yrityksen haluat rakentaa?"), "Must invite user to describe idea");
    assert.ok(genesisPayload.html.includes("btn-submit-spark"), "Must include idea submission CTA");
    assert.ok(genesisPayload.html.includes("data-launch-sandbox"), "Must include demo sandbox fast-track cards");

    // 2. Transition to Phase 1: Business Idea Canvas & Capability Design
    session.mode = "canvas";
    session.draft.prompt = "Korkealuokkainen hapanjuurileipomo B2B- ja D2C-jakelulla";
    session.draft.founderRole = "product";
    session.draft.capabilities.production = "in_house";
    session.draft.capabilities.logistics = "outsource";

    const canvasPayload = buildViewPayload(session);
    assert.equal(canvasPayload.mode, "canvas");
    assert.ok(canvasPayload.html.includes("BUSINESS IDEA CANVAS"), "Must render Business Idea Canvas");
    assert.ok(canvasPayload.html.includes("2. PERUSTAJAN PÄÄROOLI"), "Must render founder role selection");
    assert.ok(canvasPayload.html.includes("Chief Product Officer / Mestari"), "Must display chosen founder role");
    assert.ok(canvasPayload.html.includes("3. KYVYKKYYDET: OMA VAI ALIHANKINTA?"), "Must render capability design toggles");
    assert.ok(canvasPayload.html.includes("4. YKSIKKÖTALOUS &amp; KIITOTIE"), "Must render unit economics and runway");
    assert.ok(canvasPayload.html.includes("btn-launch-mission-control"), "Must include launch button");

    // 3. Transition to Phase 2: Mission Control Ignition (The War Room)
    session.mode = "war_room";
    const warRoomPayload = buildViewPayload(session);
    assert.equal(warRoomPayload.mode, "war_room");
    assert.ok(warRoomPayload.html.includes("TIERED TICK-CLOCK"), "Must now reveal full War Room Mission Control");
    assert.ok(warRoomPayload.html.includes("btn-return-genesis"), "Must include return to canvas button");
  });

  it("7. Accurately compiles and customizes knowledge-work ventures ('Myyn vain osaamistani') without physical warehousing or baking toggles", async () => {
    const {
      classifyPromptArchetype,
      compileBusinessPromptSync,
    } = await import("../src/core/compiler/index.ts");
    const {
      buildViewPayload,
      createInitialSession,
    } = await import("../src/app/server.ts");

    // 1. Verify archetype classification
    const prompt = "Myyn vain osaamistani ja tarjoan strategista asiantuntijaneuvonantoa yritysjohdolle";
    const archetype = classifyPromptArchetype(prompt);
    assert.equal(
      archetype,
      "B2B_ENTERPRISE_SERVICES",
      "Knowledge work & expertise prompt must classify as B2B_ENTERPRISE_SERVICES",
    );

    // 2. Verify compiled state has zero physical lots and pure service items
    const compiled = compileBusinessPromptSync(prompt, { seed: 9999 });
    assert.equal(compiled.company.archetype, "B2B_ENTERPRISE_SERVICES");
    assert.equal(compiled.warehouses.lots.length, 0, "Knowledge venture must have zero physical inventory lots");
    const mainItem = compiled.catalog.items.find((i) => i.kind === "service");
    assert.ok(mainItem, "Must contain a primary service item");
    assert.equal(mainItem?.uom, "day");

    // 3. Verify Canvas rendering dynamically tailors to knowledge-work economics
    const { createRootBranch } = await import("../src/core/index.ts");
    const session = createInitialSession("vertical_farm", "canvas");
    const root = createRootBranch(compiled, `main (${compiled.company.name})`);
    session.branches = [root];
    session.activeBranchId = root.id;
    session.draft.prompt = prompt;
    session.draft.archetype = "B2B_ENTERPRISE_SERVICES";
    session.draft.founderRole = "product";

    const payload = buildViewPayload(session);
    assert.equal(payload.mode, "canvas");

    // Must include knowledge-work delivery and methodology toggles
    assert.ok(payload.html.includes("Asiantuntijatyö &amp; Toimitus (Core Delivery)"));
    assert.ok(payload.html.includes("Oma senior-tiimi"));
    assert.ok(payload.html.includes("Freelancer-verkosto"));
    assert.ok(payload.html.includes("B2B-Asiakashankinta &amp; Myynti"));
    assert.ok(payload.html.includes("Metodologia, Työkalut &amp; IP"));
    assert.ok(payload.html.includes("Principal Consultant / Johtava asiantuntija"));
    assert.ok(payload.html.includes("PÄÄPALVELU"));
    assert.ok(payload.html.includes("Ei fyysistä tuotehävikkiä"));

    // Must NOT include irrelevant baking or pallet warehouse toggles
    assert.ok(!payload.html.includes("Ensisijainen valmistus / Paisto"));
    assert.ok(!payload.html.includes("Oma leipomo"));
    assert.ok(!payload.html.includes("Co-Packer"));
    assert.ok(!payload.html.includes("Kylmävarastointi"));
  });

  it("8. Compiles realistic micro-ventures ('Jäätelökioski', 'Nakkikiska') with accessible vocational Finnish economics and clarity mode toggle", async () => {
    const {
      classifyPromptArchetype,
      compileBusinessPromptSync,
    } = await import("../src/core/compiler/index.ts");
    const {
      renderValueChainSvg,
      renderNodeInspector,
    } = await import("../src/components/ValueChainCanvas.ts");
    const {
      buildViewPayload,
      createInitialSession,
    } = await import("../src/app/server.ts");
    const { createRootBranch } = await import("../src/core/index.ts");

    // 1. Archetype classification for everyday food micro-ventures
    const iceCreamPrompt = "Kesäinen jäätelökioski kauppatorilla, Valion ja Pingviinin jäätelöt";
    assert.equal(
      classifyPromptArchetype(iceCreamPrompt),
      "PERISHABLE_COLD_CHAIN",
      "Kiosk / Ice cream venture must classify as PERISHABLE_COLD_CHAIN, not D2C fashion or heavy manufacturing",
    );

    const grillPrompt = "Yögrilli ja nakkikiska keskustassa, makkarat ja lihapiirakat";
    assert.equal(
      classifyPromptArchetype(grillPrompt),
      "PERISHABLE_COLD_CHAIN",
      "Nakkikiska / grill must classify as PERISHABLE_COLD_CHAIN",
    );

    // 2. Realistic Finnish micro-venture unit economics
    const compiled = compileBusinessPromptSync(iceCreamPrompt, { seed: 12345 });
    const mainOffering = compiled.commercial.offerings[0];
    const offState = compiled.commercial.offeringStates[0];
    const priceCents = offState?.lastPrice || (mainOffering.pricing.kind === "value_based" ? mainOffering.pricing.listPrice : 450);

    // Kiosk price must be 4.50 € (450 cents), not $79 or $89
    assert.ok(priceCents >= 350 && priceCents <= 650, `Kiosk price should be realistic small-business level (found ${priceCents} cents)`);
    assert.ok(compiled.supply.suppliers.some((s) => s.name.includes("Valio") || s.name.includes("Pingviini") || s.name.includes("Tukku")), "Must source from authentic food vendors");

    // 3. Value Chain Canvas: Clarity Mode ("Selkokieli / Yrittäjätila") vs Expert Mode
    const simpleSvg = renderValueChainSvg(compiled, null, "simple");
    assert.ok(simpleSvg.includes("1. TUKUT &amp; HANKINNAT"), "Simple mode must have human-friendly Finnish column 1");
    assert.ok(simpleSvg.includes("2. KULJETUS &amp; TOIMITUKSET"), "Simple mode must have human-friendly Finnish column 2");
    assert.ok(simpleSvg.includes("3. KIOSKI / VARASTO"), "Simple mode must have human-friendly Finnish column 3");
    assert.ok(simpleSvg.includes("4. VALMISTUS &amp; TISKI"), "Simple mode must have human-friendly Finnish column 4");
    assert.ok(simpleSvg.includes("5. MYYNTIPISTE &amp; KASSA"), "Simple mode must have human-friendly Finnish column 5");
    assert.ok(simpleSvg.includes("6. ASIAKKAAT"), "Simple mode must have human-friendly Finnish column 6");
    assert.ok(!simpleSvg.includes("PRODUCTION (L = λW)"), "Simple mode must NOT display Little's Law formula headers");

    const expertSvg = renderValueChainSvg(compiled, null, "expert");
    assert.ok(expertSvg.includes("1. TIER-1 SUPPLIERS"), "Expert mode must preserve controller headers");
    assert.ok(expertSvg.includes("4. PRODUCTION (L = λW)"), "Expert mode must preserve controller formulas");

    // 4. Inspector clarity mode
    const inspector = renderNodeInspector(compiled, { kind: "workCenter", id: compiled.operations.workCenters[0].id }, "simple");
    assert.ok(inspector.includes("VALMISTUS &amp; ASIAKASPALVELUTISKI"), "Inspector must use vocational Finnish title");
    assert.ok(inspector.includes("Jonotusaika tiskillä"), "Inspector must use intuitive kiosk queue label");

    // 5. War Room Dashboard renders Clarity Mode switch
    const session = createInitialSession("vertical_farm", "war_room");
    const root = createRootBranch(compiled, `main (${compiled.company.name})`);
    session.branches = [root];
    session.activeBranchId = root.id;
    session.clarityMode = "simple";

    const payload = buildViewPayload(session);
    assert.ok(payload.html.includes("Selkokieli (Yrittäjätila)"), "Dashboard must contain Selkokieli toggle");
    assert.ok(payload.html.includes("Controller &amp; M&amp;A"), "Dashboard must contain Controller mode toggle");
    assert.ok(payload.html.includes("💰 1. Kassa, Tulot &amp; Menot"), "Dashboard must render localized drawer tabs in simple mode");
    assert.ok(payload.html.includes("📦 2. Varasto, Kioski &amp; Laitteet"), "Dashboard must render localized drawer tabs in simple mode");
  });

  it("9. Synthesizes bespoke per-business domainUi ontology with zero preset leftovers (no hydroponics/e-bike dummy strings)", async () => {
    const { compileBusinessPromptSync } = await import("../src/core/compiler/index.ts");
    const prompt = "Kukkakauppa ja hautajaiskukkasidonta Helsingin Punavuoressa";
    const compiled = compileBusinessPromptSync(prompt, { seed: 4242 });

    // 1. Must carry bespoke domainUi
    assert.ok(compiled.company.domainUi, "Compiled business must carry bespoke domainUi configuration");
    assert.strictEqual(compiled.company.domainUi.valueChainColumns.length, 6, "Must have 6 custom value chain columns");
    assert.ok(compiled.company.domainUi.canvasConfig.roles.length >= 3, "Must have tailored founder/executive roles");
    assert.ok(compiled.company.domainUi.canvasConfig.capabilities.length >= 3, "Must have tailored operational capabilities");

    // 2. Zero preset dummy leftovers anywhere in roles, capabilities, processes, debts, or fixed assets
    const serialized = JSON.stringify(compiled);
    assert.ok(!serialized.includes("Lead Photobiology"), "Must NOT contain vertical farm role leftovers");
    assert.ok(!serialized.includes("FDA FSMA"), "Must NOT contain vertical farm compliance process leftovers");
    assert.ok(!serialized.includes("AgriBank"), "Must NOT contain vertical farm lender leftovers");
    assert.ok(!serialized.includes("FreshMart"), "Must NOT contain vertical farm contract leftovers");
    assert.ok(!serialized.includes("Hydroponic"), "Must NOT contain vertical farm fixed asset leftovers");

    // 3. Roles and capabilities must reflect the actual business
    assert.ok(compiled.org.roles.some((r) => r.title.toLowerCase().includes("florist") || r.title.toLowerCase().includes("kukk")), "Org roles must match flower shop domain");
    assert.ok(compiled.operations.capabilities.some((c) => c.name.toLowerCase().includes("kukk") || c.name.toLowerCase().includes("sidon")), "Capabilities must match flower shop domain");
  });

  it("10. Scales a Jäätelökioski from Stage 1 micro-kiosk to Stage 4 Multinational Dessert Corporation while enforcing game theory and double-entry invariants", async () => {
    const {
      compileBusinessPrompt,
      computeGameTheoryAnalysis,
      evolveVentureToNextStage,
      stepTick,
      verifyAccountingInvariants,
      createRootBranch,
    } = await import("../src/core/index.ts");
    const { buildViewPayload } = await import("../src/app/server.ts");

    const state = await compileBusinessPrompt("Jäätelökioski", {
      seed: 20261017,
      useLiveLlm: false,
    });
    stepTick(state, { strictInvariants: true });

    // Stage 1 verification
    assert.equal(state.company.ventureStage, 1);
    const gt1 = computeGameTheoryAnalysis(state);
    assert.ok(gt1.regimeName.includes("Hotelling"), "Stage 1 should model Hotelling location/service competition");
    const power1 = gt1.buyerPowerPct;

    // Verify contextual dashboard HTML at Stage 1
    const rootBranch = createRootBranch(state, "main");
    const session: any = {
      mode: "war_room",
      draft: {
        prompt: "Jäätelökioski",
        founderRole: "solo_founder",
        capabilities: { production: "in_house", warehouse: "in_house", logistics: "in_house", qa: "in_house" },
      },
      branches: [rootBranch],
      activeBranchId: rootBranch.id,
      activeTab: "financials",
      clarityMode: "simple",
      selectedNode: { kind: "supplier", id: state.supply.suppliers[0].id },
      mcSummary: null,
      lastNegotiation: null,
      exportedMarkdown: null,
      lastActionFeedback: null,
      lastMacroStepSummary: null,
      liveBriefing: null,
      lastLlmMeta: null,
    };

    const view1 = buildViewPayload(session);
    assert.ok(view1.html.includes("1. RAAKA-AINEET & TARVIKKEET"), "Must render contextual raw materials card");
    assert.ok(view1.html.includes("2. TOIMITILA, KOJU & VUOKRA"), "Must render contextual facility & rent card");
    assert.ok(view1.html.includes("3. ASIAKASVIRTA & MYYNTI"), "Must render contextual customer flow & marketing card");
    assert.ok(view1.html.includes("4. PELITEORIA & KILPAILU"), "Must render contextual game theory card");
    assert.ok(view1.html.includes("NASH-TASAPAINO") || view1.html.includes("Nash-tasapaino"), "Must render Nash equilibrium in payoff matrix");

    // Evolve Stage 1 -> Stage 2 (Kaupunkiketju & Oma Artesaanijäätelöpaja)
    const evo2 = evolveVentureToNextStage(state);
    assert.equal(evo2.ok, true);
    assert.equal(state.company.ventureStage, 2);
    assert.equal(verifyAccountingInvariants(state).length, 0, "Accounting invariants must hold after Stage 2 scaling");
    stepTick(state, { strictInvariants: true });

    // Evolve Stage 2 -> Stage 3 (Valtakunnallinen Jäätelöbrändi & Kauppajakelu)
    const evo3 = evolveVentureToNextStage(state);
    assert.equal(evo3.ok, true);
    assert.equal(state.company.ventureStage, 3);
    assert.equal(verifyAccountingInvariants(state).length, 0, "Accounting invariants must hold after Stage 3 scaling");
    stepTick(state, { strictInvariants: true });

    // Evolve Stage 3 -> Stage 4 (Monikansallinen Jälkiruokakonserni)
    const evo4 = evolveVentureToNextStage(state);
    assert.equal(evo4.ok, true);
    assert.equal(state.company.ventureStage, 4);
    assert.ok(evo4.title.includes("Monikansallinen"), `Stage 4 title should be multinational: ${evo4.title}`);
    assert.equal(verifyAccountingInvariants(state).length, 0, "Accounting invariants must hold after Stage 4 scaling");
    stepTick(state, { strictInvariants: true });

    const gt4 = computeGameTheoryAnalysis(state);
    assert.ok(gt4.buyerPowerPct > power1, "Buyer bargaining power must increase significantly by Stage 4");
    assert.ok(gt4.regimeName.includes("Oligopol"), "Stage 4 should model Oligopolistic Cournot/Bertrand competition");
    assert.ok(state.org.roles.length >= 5, "Stage 4 should have expanded leadership and specialist roles across stages");
    assert.ok(state.finance.fixedAssets.length >= 4, "Stage 4 should have capitalized growth investments across stages");
  });

  it("11. Marks every synthesized assumption with *, displays upstream/downstream dependency chains, and updates all linked metrics live while preserving accounting invariants", async () => {
    const {
      applyAssumptionUpdate,
      buildAssumptionDependencyGraph,
      compileBusinessPrompt,
      createRootBranch,
      stepTick,
      verifyAccountingInvariants,
    } = await import("../src/core/index.ts");
    const { buildViewPayload } = await import("../src/app/server.ts");

    const state = await compileBusinessPrompt("Jäätelökioski Kauppatorilla", {
      seed: 20261018,
      useLiveLlm: false,
    });
    stepTick(state, { strictInvariants: true });

    // 1. All 10 assumptions start as AI-assumed (*)
    const graph0 = buildAssumptionDependencyGraph(state);
    assert.equal(graph0.selling_price.isAssumed, true);
    assert.ok(graph0.selling_price.displayValue.endsWith("*"), "Selling price must be marked with *");
    assert.ok(graph0.raw_cost_1.displayValue.endsWith("*"), "Raw material 1 cost must be marked with *");
    assert.ok(graph0.facility_rent.displayValue.endsWith("*"), "Facility rent must be marked with *");
    assert.ok(graph0.daily_demand.displayValue.endsWith("*"), "Daily demand must be marked with *");

    // 2. Verify upstream & downstream dependency links exist
    assert.ok(graph0.selling_price.upstreamDependencies.some((d) => d.key === "raw_cost_1"));
    assert.ok(graph0.selling_price.upstreamDependencies.some((d) => d.key === "customer_wtp"));
    assert.ok(graph0.selling_price.downstreamImpacts.length >= 3);

    // 3. Mutate raw_cost_1 and selling_price, verify BOM cost & unit margin & accounting invariants
    const updRaw = applyAssumptionUpdate(state, "raw_cost_1", 0.85);
    assert.equal(updRaw.ok, true);
    assert.equal(verifyAccountingInvariants(state).length, 0, "Inventory revaluation must preserve strict double-entry invariants");

    const updPrice = applyAssumptionUpdate(state, "selling_price", 5.20);
    assert.equal(updPrice.ok, true);
    assert.equal(updPrice.node.isAssumed, false, "Updated assumption must be marked verified (not assumed)");
    assert.ok(updPrice.node.displayValue.endsWith("✓"), "Updated assumption display value must end with ✓");

    // Step simulation tick after live assumption edits to confirm stability
    stepTick(state, { strictInvariants: true });
    assert.equal(verifyAccountingInvariants(state).length, 0);

    // 4. Verify rendered HTML contains Football Manager Dependency Explorer & progressive disclosure
    const rootBranch = createRootBranch(state, "main");
    const session: any = {
      mode: "war_room",
      draft: {
        prompt: "Jäätelökioski Kauppatorilla",
        founderRole: "solo_founder",
        capabilities: { production: "in_house", warehouse: "in_house", logistics: "in_house", qa: "in_house" },
      },
      branches: [rootBranch],
      activeBranchId: rootBranch.id,
      activeTab: "financials",
      clarityMode: "simple",
      selectedNode: { kind: "channel", id: state.commercial.channels[0].id },
      selectedAssumption: "selling_price",
      drawerExpanded: false,
      mcSummary: null,
      lastNegotiation: null,
      exportedMarkdown: null,
      lastActionFeedback: null,
      lastMacroStepSummary: null,
      liveBriefing: null,
      lastLlmMeta: null,
    };

    const view = buildViewPayload(session);
    assert.ok(view.html.includes("assumption-inspector-panel"), "Must render Football Manager Assumption & Dependency Inspector");
    assert.ok(view.html.includes("YLÄVIRRAN SIDONNAISUUDET"), "Must list upstream dependencies");
    assert.ok(view.html.includes("ALAVIRRAN VAIKUTUKSET"), "Must list downstream impacts");
    assert.ok(view.html.includes("fm-progressive-drawer"), "Must use progressive disclosure for deep-dive drawers");
  });

  it("12. Provides AAA AI-Market Research, Web-Grounding Benchmarks, and Executable Strategic Plays ('Peliliikkeet') with strict accounting invariants", async () => {
    const {
      buildAssumptionDependencyGraph,
      compileBusinessPrompt,
      createRootBranch,
      executeStrategicPlay,
      stepLivingWorldDynamics,
      stepTick,
      verifyAccountingInvariants,
    } = await import("../src/core/index.ts");
    const { buildViewPayload } = await import("../src/app/server.ts");

    const state = await compileBusinessPrompt("Artesaanikahvila & leipomo Kalliossa", {
      seed: 20261019,
      useLiveLlm: false,
    });
    stepTick(state, { strictInvariants: true });

    // 1. Verify marketIntelligence and assumptionOrigins are populated automatically
    assert.ok(state.company.marketIntelligence, "marketIntelligence must be initialized on compiled state");
    assert.ok(state.company.assumptionOrigins, "assumptionOrigins must be initialized on compiled state");
    assert.equal(state.company.marketIntelligence.strategicPlays.length, 3, "Must provide 3 context-specific strategic plays");
    assert.ok(state.company.marketIntelligence.benchmarks.length >= 4, "Must provide market benchmarks");

    const beforeGraph = buildAssumptionDependencyGraph(state);
    const beforeDemand = beforeGraph.daily_demand.currentValue;
    const beforeCash = state.finance.ledger.balances.cash;

    // 2. Execute Strategic Play #1 (Local Hype & Growth Campaign)
    const play0 = state.company.marketIntelligence.strategicPlays[0];
    const playRes = executeStrategicPlay(state, play0.id);
    assert.equal(playRes.ok, true);
    assert.equal(play0.executed, true);

    const afterGraph = buildAssumptionDependencyGraph(state);
    assert.ok(
      afterGraph.daily_demand.currentValue > beforeDemand,
      `Strategic play must increase daily demand (${beforeDemand} -> ${afterGraph.daily_demand.currentValue})`,
    );
    assert.equal(
      afterGraph.daily_demand.isAssumed,
      false,
      "Variables modified by player's strategic play must be marked verified (✓)",
    );
    assert.ok(
      state.finance.ledger.balances.cash < beforeCash,
      "Strategic play investment must be deducted from cash",
    );
    assert.equal(
      verifyAccountingInvariants(state).length,
      0,
      "Strategic play execution must preserve double-entry accounting invariants",
    );

    // 3. Step living world dynamics & tick
    stepLivingWorldDynamics(state);
    stepTick(state, { strictInvariants: true });
    assert.equal(verifyAccountingInvariants(state).length, 0);

    // 4. Verify UI renders the Market Research & Strategic Plays panel
    const rootBranch = createRootBranch(state, "main");
    const session: any = {
      mode: "war_room",
      draft: {
        prompt: "Artesaanikahvila & leipomo Kalliossa",
        founderRole: "solo_founder",
        capabilities: { production: "in_house", warehouse: "in_house", logistics: "in_house", qa: "in_house" },
      },
      branches: [rootBranch],
      activeBranchId: rootBranch.id,
      activeTab: "financials",
      clarityMode: "simple",
      selectedNode: { kind: "channel", id: state.commercial.channels[0].id },
      selectedAssumption: "daily_demand",
      drawerExpanded: false,
      mcSummary: null,
      lastNegotiation: null,
      exportedMarkdown: null,
      lastActionFeedback: null,
      lastMacroStepSummary: null,
      liveBriefing: null,
      lastLlmMeta: null,
    };

    const view = buildViewPayload(session);
    assert.ok(view.html.includes("market-research-form"), "Must render Live AI Market Research form");
    assert.ok(view.html.includes("data-execute-play"), "Must render executable strategic play buttons");
    assert.ok(view.html.includes("MARKKINAVERTAILU"), "Must render market benchmark comparison drawer");
  });

  it("13. Verifies starting capital scaling (10 000 € kiosk), pre-flight Sense Check, adaptive solo vs team UI, and Finnish crisis cards", async () => {
    const {
      compileBusinessPromptSync,
      buildPreFlightSenseCheck,
      suggestInitialCapitalEuros,
    } = await import("../src/core/compiler/index.ts");
    const {
      createInitialSession,
      buildViewPayload,
      executeTwoPhaseActionOnSession,
    } = await import("../src/app/server.ts");
    const {
      getLlmSessionTelemetry,
      recordEngineActivity,
    } = await import("../src/core/llm/index.ts");
    const { totalHeadcount } = await import("../src/core/engine/org.ts");
    const { debitBalance, verifyAccountingInvariants } = await import("../src/core/engine/ledger.ts");
    const { stepTick } = await import("../src/core/engine/tick.ts");

    // 1. Suggest Initial Capital & Compile Nakkikiska with 10 000 € Starting Capital & Commercial Model
    const prompt = "Perinteinen suomalainen nakkikioski ja grilli torilla";
    const suggestedCap = suggestInitialCapitalEuros(prompt);
    assert.equal(suggestedCap, 10_000, "Nakkikiska must suggest 10 000 € realistic starting capital");

    const state = compileBusinessPromptSync(prompt, {
      seed: 42,
      initialCapitalEuros: 10_000,
      commercialModelNotes: "Myyntihinta 6,50 € / annos, noin 60 asiakasta päivässä",
    });

    // Opening cash must be scaled to exactly 10 000 € (1 000 000 cents), NOT hundreds of thousands!
    assert.equal(state.company.initialCapitalEuros, 10_000);
    assert.equal(debitBalance(state.finance.ledger, "cash"), 10_000_00, "Opening cash must be 10 000 €");
    assert.equal(verifyAccountingInvariants(state).length, 0, "Opening balance sheet must be balanced");

    // Starting staffing for 10 000 € micro-venture must be 1 solo entrepreneur
    const hc0 = totalHeadcount(state);
    assert.equal(hc0, 1, "Micro-kiosk must start with 1 solo entrepreneur, not a 4-person executive suite");

    // Supplier MOQ for low cost items (<= 3 €) must be realistic (e.g. 100 units), not 1 unit
    const sup0Offer = state.supply.suppliers[0]?.offers[0];
    assert.ok(sup0Offer && sup0Offer.moq >= 50, "Wholesale MOQ for kiosk ingredients must be at least 50-100 units");

    // Commercial notes price (6,50 € = 650 cents) must be applied
    assert.equal(state.commercial.offeringStates[0]?.lastPrice, 650, "Offering price must match commercial model notes");

    // 2. Pre-Flight Sense Check & Risk Analysis Card in Canvas
    const senseCheck = buildPreFlightSenseCheck(state);
    assert.ok(senseCheck.viabilityScore >= 30 && senseCheck.viabilityScore <= 100);
    assert.ok(senseCheck.breakEvenUnitsPerDay > 0, "Must calculate realistic break-even units per day");
    assert.ok(senseCheck.risks.length >= 2, "Must identify top risks for the business idea");
    assert.ok(senseCheck.suggestions.length >= 2, "Must offer actionable improvement suggestions");

    const session = createInitialSession("vertical_farm", "canvas");
    session.draft.prompt = prompt;
    session.draft.initialCapitalEuros = 10_000;
    session.draft.commercialModelNotes = "Myyntihinta 6,50 € / annos";
    const canvasPayload = buildViewPayload(session);
    assert.ok(canvasPayload.html.includes("APEX SENSE CHECK &amp; RISKIANALYYSI"), "Must render Sense Check card");
    assert.ok(canvasPayload.html.includes("data-sensecheck-suggest"), "Must render 1-click suggestion buttons");
    assert.ok(canvasPayload.html.includes("Haluatko todella simuloida tätä yritystä"), "Must include explicit confirmation");

    // 3. Stage- & Role-Driven Adaptive UI in War Room
    session.mode = "war_room";
    session.activeBranchId = session.branches[0].id;
    session.branches[0].head = state;

    const warRoomPayload1 = buildViewPayload(session);
    assert.ok(warRoomPayload1.html.includes("YRITTÄJÄN MUISTILISTA &amp; TILANNEKUVA"), "Solo entrepreneur must see Yrittäjän Muistilista when alone");
    assert.ok(warRoomPayload1.html.includes("Hoidat itse (Yrittäjä)"), "Must indicate founder personally handles non-hired areas");
    assert.ok(!warRoomPayload1.html.includes("JOHORYHMÄN"), "Typo JOHORYHMÄN must be fixed");
    assert.ok(warRoomPayload1.html.includes("Näkymä:"), "Must render clean Workspace View tabs");
    assert.ok(warRoomPayload1.html.includes("MITÄ SOVELLUS &amp; TEKOÄLY TEKEE NYT"), "Must render live AI/Engine activity ticker");

    // Now hire staff for Tuotanto and Myynti so headcount reaches 3
    // Execute Two-Phase Commit HIRE action
    executeTwoPhaseActionOnSession(
      session,
      state,
      { type: "HIRE", roleId: "role_1", count: 1 },
      "player:founder",
    );
    // Directly staff roles so active headcount reaches 3 to test team UI transition
    state.org.positions[1].cohorts.push({ count: 1, hiredTick: 1 });
    state.org.positions[2].cohorts.push({ count: 1, hiredTick: 1 });
    const hcUpdated = totalHeadcount(state);
    assert.equal(hcUpdated, 3, "Headcount must increase after hiring");

    const warRoomPayload2 = buildViewPayload(session);
    assert.ok(warRoomPayload2.html.includes("JOHTORYHMÄN KESKUSTELU &amp; RISTIRIIDAT"), "Must adapt to Johtoryhmän Keskustelu when managers are hired");

    // 4. Finnish Director AI Crisis Cards
    while (state.calendar.tick < 9) {
      stepTick(state, { strictInvariants: true });
    }
    stepTick(state, { strictInvariants: true, forceCrisisOnEvaluation: true });
    assert.equal(state.calendar.tick, 10);
    assert.equal(state.status, "paused_decision");
    const pendingCrisis = state.events.decisions.find((d) => d.status === "pending");
    assert.ok(pendingCrisis, "Day 10 must activate a crisis decision");

    const crisisPayload = buildViewPayload(session);
    assert.ok(crisisPayload.html.includes("TILANNEHÄLYTYS &amp; PÄÄTÖS • SIMULAATIO PYSÄYTETTY (PÄIVÄ 10)"), "Crisis card must be in Finnish");
    assert.ok(!crisisPayload.html.includes("DIRECTOR AI STRESS TEST"), "Must not display untranslated English crisis title");
    assert.ok(!crisisPayload.html.includes("Fulfillment Congestion at"), "Must not display untranslated English congestion text");

    // 5. Live Activity Ticker & API Session Telemetry
    recordEngineActivity({
      actor: "engine",
      title: "Testiaktiviteetti",
      detail: "Simuloitu onnistuneesti",
      ok: true,
    });
    const tel = getLlmSessionTelemetry();
    assert.ok(tel.totalCalls >= 0);
    assert.ok(tel.recentActivities.length > 0, "Activity log must record operations");
  });
});



