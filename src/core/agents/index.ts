/**
 * Module 3: Multi-Agent Cognitive Orchestrator (Neural & Policy Layer).
 *
 * Implements:
 *  1. Internal C-Suite Advisory & Execution Team:
 *     - COO / Head of Operations & Logistics (OEE, warehouse utilization, stockouts, lead times, BOM costs)
 *     - CFO / Treasury Agent (burn rate, working capital CCC, debt covenants, unit economics, CapEx ROI)
 *     - CRO / VP of Sales & Marketing (market share, pricing power, B2B pipeline velocity, LTV:CAC)
 *     - CHRO / Org Architect (role coverage, RACI governance drift, span of control, burnout/attrition)
 *  2. War Room Briefing & Trade-Off Debate Protocol:
 *     - Each agent inspects a structured snapshot of `WorldState`, diagnoses bottlenecks from its
 *       incentive lens, challenges conflicting C-suite proposals (e.g. CRO wants a 10% discount + ad blitz
 *       while CFO warns of credit covenant breach and COO warns warehouse pick slots are at 90%), and
 *       emits Zod-validated `ActionPayload` recommendations.
 *  3. Interactive B2B / Supplier / Investor Negotiation Simulator:
 *     - Counterparty agents evaluate player proposals against walk-away reservation utility and respond
 *       with counter-offers or accepted `ActionPayload`s.
 */
import { z } from "zod";
import { buildBalanceSheet, buildIncomeStatement } from "../engine/ledger";
import { resolveOfferingPrice } from "../engine/market";
import { roleHeadcount } from "../engine/org";
import { onHandQty } from "../engine/warehouse";
import { ActionPayload, type WorldState } from "../schema";

export const AgentRoleId = z.enum(["coo", "cfo", "cro", "chro"]);
export type AgentRoleId = z.infer<typeof AgentRoleId>;

export const AgentProposal = z.object({
  id: z.string(),
  agentRole: AgentRoleId,
  agentTitle: z.string(),
  priority: z.enum(["low", "medium", "high", "critical"]),
  headline: z.string(),
  diagnosis: z.string(),
  tradeOffWarning: z.string(),
  kpiFocus: z.string(),
  actions: z.array(ActionPayload),
});
export type AgentProposal = z.infer<typeof AgentProposal>;

export const WarRoomDebateTurn = z.object({
  speaker: AgentRoleId,
  speakerTitle: z.string(),
  targetRole: AgentRoleId.optional(),
  stance: z.enum(["propose", "object", "support", "synthesize"]),
  message: z.string(),
});
export type WarRoomDebateTurn = z.infer<typeof WarRoomDebateTurn>;

export const WarRoomBriefing = z.object({
  tick: z.number(),
  executiveSummary: z.string(),
  proposals: z.array(AgentProposal),
  debateTranscript: z.array(WarRoomDebateTurn),
});
export type WarRoomBriefing = z.infer<typeof WarRoomBriefing>;

/**
 * Generate a complete C-Suite War Room Briefing from the current `WorldState`.
 * Every emitted action is strictly validated against `ActionPayload`.
 */
export function generateWarRoomBriefing(state: WorldState): WarRoomBriefing {
  const tick = state.calendar.tick;
  const coo = evaluateCooAgent(state);
  const cfo = evaluateCfoAgent(state);
  const cro = evaluateCroAgent(state);
  const chro = evaluateChroAgent(state);

  const proposals = [coo, cfo, cro, chro].map((p) => AgentProposal.parse(p));

  const debateTranscript: WarRoomDebateTurn[] = [
    {
      speaker: "cro",
      speakerTitle: cro.agentTitle,
      stance: "propose",
      message: `${cro.headline} — ${cro.diagnosis}`,
    },
    {
      speaker: "coo",
      speakerTitle: coo.agentTitle,
      targetRole: "cro",
      stance: coo.priority === "high" || coo.priority === "critical" ? "object" : "support",
      message: `${coo.headline}. ${coo.tradeOffWarning}`,
    },
    {
      speaker: "cfo",
      speakerTitle: cfo.agentTitle,
      targetRole: "cro",
      stance: cfo.priority === "high" || cfo.priority === "critical" ? "object" : "synthesize",
      message: `${cfo.headline} — ${cfo.diagnosis} ${cfo.tradeOffWarning}`,
    },
    {
      speaker: "chro",
      speakerTitle: chro.agentTitle,
      targetRole: "coo",
      stance: chro.priority === "high" ? "object" : "synthesize",
      message: `${chro.headline} — ${chro.diagnosis}`,
    },
  ];

  const lastKpi = state.telemetry.daily[state.telemetry.daily.length - 1];
  const cashDollars = ((lastKpi?.cash ?? state.finance.periodStartCash) / 100).toLocaleString(
    "en-US",
    { maximumFractionDigits: 0 },
  );
  const cccDays = (lastKpi?.ccc ?? 0).toFixed(1);
  const isFi = Boolean(state.company.domainUi);

  return {
    tick,
    executiveSummary: isFi
      ? `Päivä ${tick} — Tilannekuva (${state.company.name}): Kassa ${cashDollars} € | Kassasykli ${cccDays} pv | Toimitusvarmuus ${((lastKpi?.fillRate ?? 1) * 100).toFixed(0)}% | Markkinaosuus ${((lastKpi?.marketShare ?? 0.25) * 100).toFixed(1)}%.`
      : `Day ${tick} War Room Briefing: Cash $${cashDollars} | CCC ${cccDays}d | Fill Rate ${((lastKpi?.fillRate ?? 1) * 100).toFixed(0)}% | Market Share ${((lastKpi?.marketShare ?? 0.25) * 100).toFixed(1)}%.`,
    proposals,
    debateTranscript,
  };
}

function evaluateCooAgent(state: WorldState): AgentProposal {
  const wc = state.operations.workCenters[0];
  const wh = state.warehouses.sites[0];
  const rawItem =
    state.catalog.items.find((i) => i.kind === "raw" || i.kind === "component") ??
    state.catalog.items[0];
  const rawOnHand = onHandQty(state, rawItem.id, wh.id);
  const isFi = Boolean(state.company.domainUi);

  // Check if production utilization > 82% (Little's Law congestion zone)
  if (wc && wc.telemetry.utilization > 0.82) {
    return {
      id: `prop_coo_${state.calendar.tick}`,
      agentRole: "coo",
      agentTitle: isFi ? "Toiminta- & Hankintavastaava (COO)" : "COO / VP of Operations & Supply Chain",
      priority: "high",
      headline: isFi
        ? `Pura ruuhka pisteessä ${wc.name} (Kuormitus ${(wc.telemetry.utilization * 100).toFixed(0)}%)`
        : `De-bottleneck ${wc.name} (${(wc.telemetry.utilization * 100).toFixed(0)}% utilization, Little's L=${wc.telemetry.littlesL.toFixed(1)})`,
      diagnosis: isFi
        ? `${wc.name} käy yli 85% kuormituksella, jolloin jonotusaika kasvaa ja asiakkaita kääntyy pois.`
        : `${wc.name} has crossed the 85% Kingman congestion knee. Queue wait time is ${wc.telemetry.avgWaitDays.toFixed(1)} days and defect rates are climbing.`,
      tradeOffWarning: isFi
        ? "Jos myyntiä kasvatetaan ilman lisätunteja tai laitekapasiteettia, jono tukkii palvelun."
        : "If CRO pushes demand without expanding capacity or authorizing overtime, stockouts will spike customer churn.",
      kpiFocus: isFi ? "Palvelunopeus, Jonotusaika, Kapasiteetti" : "OEE, Little's Law Wait Time (W), Defect Rate",
      actions: [
        {
          type: "SET_OVERTIME",
          workCenterId: wc.id,
          hoursPerDay: Math.min(wc.maxOvertimeHoursPerDay, wc.overtimeHoursPerDay + 3),
        },
      ],
    };
  }

  // Check if warehouse pick or cubic utilization > 80%
  if (wh && Math.max(wh.telemetry.utilization, wh.telemetry.pickUtilization) > 0.8) {
    return {
      id: `prop_coo_${state.calendar.tick}`,
      agentRole: "coo",
      agentTitle: isFi ? "Toiminta- & Hankintavastaava (COO)" : "COO / VP of Operations & Supply Chain",
      priority: "high",
      headline: isFi
        ? `Laajenna pisteen ${wh.name} laitteistoa (${(Math.max(wh.telemetry.utilization, wh.telemetry.pickUtilization) * 100).toFixed(0)}% täynnä)`
        : `Upgrade ${wh.name} Automation (${(Math.max(wh.telemetry.utilization, wh.telemetry.pickUtilization) * 100).toFixed(0)}% load)`,
      diagnosis: isFi
        ? `Toimipisteen ${wh.name} säilytys- ja käsittelykapasiteetti on tulossa täyteen.`
        : `Warehouse throughput at ${wh.name} is nearing physical ceiling (${Math.round(wh.telemetry.pickBacklogUnits)} units in pick backlog).`,
      tradeOffWarning: isFi
        ? "Vaati 35 000 € kalustolainan, mutta poistaa pullonkaulan ja mahdollistaa suuremman myynnin."
        : "Requires $35k equipment CapEx, but prevents dock demurrage and SLA penalties.",
      kpiFocus: isFi ? "Tilakapasiteetti, Toimituskyky" : "Warehouse Pick Throughput, Dock Backlog, Fill Rate",
      actions: [
        {
          type: "CAPEX_UPGRADE",
          targetKind: "warehouse",
          targetId: wh.id,
          upgrade: "automation",
          amount: 35_000_00,
          financing: "equipment_loan",
        },
      ],
    };
  }

  // Check raw material buffer
  const supplier = state.supply.suppliers[0];
  const lane = state.supply.lanes[0];
  if (supplier && lane && rawItem.kind !== "service" && rawOnHand < (supplier.offers[0]?.moq ?? 50) * 1.5) {
    const qty = Math.max(supplier.offers[0]?.moq ?? 50, 100);
    return {
      id: `prop_coo_${state.calendar.tick}`,
      agentRole: "coo",
      agentTitle: isFi ? "Toiminta- & Hankintavastaava (COO)" : "COO / VP of Operations & Supply Chain",
      priority: "medium",
      headline: isFi
        ? `Tilaa täydennystä: ${rawItem.name} (${Math.round(rawOnHand)} ${rawItem.uom} jäljellä)`
        : `Replenish ${rawItem.name} Buffer Stock (${Math.round(rawOnHand)} units left)`,
      diagnosis: isFi
        ? `Raaka-aineen (${rawItem.name}) saldo lähestyy varmuusrajaa toimittajalta ${supplier.name}.`
        : `Raw inventory for ${rawItem.name} is approaching lead-time safety threshold.`,
      tradeOffWarning: isFi
        ? "Sitoo hieman kassaa varastoon, mutta estää tuotteiden loppumisen kesken myyntipäivän."
        : "Ties up working capital in raw inventory (increases DIO).",
      kpiFocus: isFi ? "Raaka-aineiden riittävyys, Toimitusvarmuus" : "Raw Material Coverage, Supplier Fill Reliability",
      actions: [
        {
          type: "PLACE_PURCHASE_ORDER",
          supplierId: supplier.id,
          itemId: rawItem.id,
          qty,
          warehouseId: wh.id,
          laneId: lane.id,
        },
      ],
    };
  }

  const cap = state.operations.capabilities[0];
  return {
    id: `prop_coo_${state.calendar.tick}`,
    agentRole: "coo",
    agentTitle: isFi ? "Toiminta- & Hankintavastaava (COO)" : "COO / VP of Operations & Supply Chain",
    priority: "low",
    headline: isFi
      ? `Kehitä osaamista & toimintaa: ${cap?.name ?? "Ydintoiminta"} (${cap?.maturity.toFixed(1) ?? "3.5"}/5.0)`
      : `Advance ${cap?.name ?? "Core Operations"} Maturity (${cap?.maturity.toFixed(2) ?? "3.2"}/5.0)`,
    diagnosis: isFi
      ? "Päivittäinen toiminta ja varastosaldot rullaavat tasapainossa; toiminnan kehitys nopeuttaa palvelua ja pienentää hävikkiä."
      : "Operations and warehouse flows are balanced; incremental capability maturity will compress unit conversion cost and defect rates.",
    tradeOffWarning: isFi
      ? "Pieni päivittäinen kehityspanostus (+60 €/pv), joka maksaa itsensä takaisin parempana katteena."
      : "Modest daily OpEx increase ($60/day) with compounding margin payoff.",
    kpiFocus: isFi ? "Palvelun laatu, Yksikkökustannus" : "Capability Maturity, Unit Conversion Cost",
    actions: cap
      ? [
          {
            type: "SET_CAPABILITY_INVESTMENT",
            capabilityId: cap.id,
            dailyInvestment: cap.dailyInvestment + 60_00,
          },
        ]
      : [{ type: "NOOP", note: "Maintain steady operations" }],
  };
}

function evaluateCfoAgent(state: WorldState): AgentProposal {
  const bs = buildBalanceSheet(state.finance.ledger);
  const is = buildIncomeStatement(state.finance.ledger);
  const lastKpi = state.telemetry.daily[state.telemetry.daily.length - 1];
  const ccc = lastKpi?.ccc ?? 25;
  const isFi = Boolean(state.company.domainUi);

  // Liquidity / Working Capital Trap check
  if (bs.assets.cash < 65_000_00 && bs.assets.accountsReceivable > 15_000_00) {
    return {
      id: `prop_cfo_${state.calendar.tick}`,
      agentRole: "cfo",
      agentTitle: isFi ? "Talous- & Kassavastaava (CFO)" : "CFO / Head of Treasury & Corporate Finance",
      priority: "critical",
      headline: isFi
        ? "Kassahälytys: Kotiuta myyntisaamiset heti kassaan (Factoring)"
        : "Working Capital Alert: Factor Receivables to Unlock Immediate Liquidity",
      diagnosis: isFi
        ? `Kassa on laskenut tasolle ${(bs.assets.cash / 100).toFixed(0)} €, kun taas ${(bs.assets.accountsReceivable / 100).toFixed(0)} € odottaa asiakkaiden laskuissa.`
        : `Cash is down to $${(bs.assets.cash / 100).toFixed(0)} while $${(bs.assets.accountsReceivable / 100).toFixed(0)} is locked in customer AR (CCC = ${ccc.toFixed(1)} days).`,
      tradeOffWarning: isFi
        ? "Rahoitusyhtiön palkkio on 3%, mutta saat rahat heti tilille palkkoja ja ostoja varten."
        : "Factoring 50% of AR incurs a 3% discount fee, but prevents revolver exhaustion or missed payroll.",
      kpiFocus: isFi ? "Kassan riittävyys, Maksuvalmius" : "Cash Runway, Cash Conversion Cycle (CCC), Covenant Headroom",
      actions: [
        {
          type: "FACTOR_RECEIVABLES",
          fraction: 0.5,
          discountPct: 0.03,
        },
      ],
    };
  }

  // Check if B2B channel DSO is dragging CCC > 40 days
  const creditChannel = state.commercial.channels.find((c) => c.paymentTermsDays >= 30);
  if (ccc > 38 && creditChannel) {
    return {
      id: `prop_cfo_${state.calendar.tick}`,
      agentRole: "cfo",
      agentTitle: isFi ? "Talous- & Kassavastaava (CFO)" : "CFO / Head of Treasury & Corporate Finance",
      priority: "high",
      headline: isFi
        ? `Lyhennä kanavan ${creditChannel.name} maksuaikaa (${creditChannel.paymentTermsDays} pv → ${Math.max(15, creditChannel.paymentTermsDays - 15)} pv)`
        : `Tighten ${creditChannel.name} Terms from Net ${creditChannel.paymentTermsDays} to Net ${Math.max(15, creditChannel.paymentTermsDays - 15)}`,
      diagnosis: isFi
        ? `Rahan kiertoaika (CCC) on venynyt ${ccc.toFixed(1)} päivään.`
        : `Cash Conversion Cycle is stretched to ${ccc.toFixed(1)} days (DSO ${lastKpi?.dso.toFixed(1)}d + DIO ${lastKpi?.dio.toFixed(1)}d - DPO ${lastKpi?.dpo.toFixed(1)}d).`,
      tradeOffWarning: isFi
        ? "Nopeuttaa rahojen saapumista tilille 15 päivällä."
        : "Accelerates cash collection by 15 days without diluting equity.",
      kpiFocus: isFi ? "Myyntisaamiset, Kassavirta" : "DSO, Cash Conversion Cycle (CCC), Free Cash Flow",
      actions: [
        {
          type: "SET_CHANNEL_TERMS",
          channelId: creditChannel.id,
          paymentTermsDays: Math.max(15, creditChannel.paymentTermsDays - 15),
        },
      ],
    };
  }

  // Check excess debt to pay down
  const expensiveDebt = state.finance.debts.find(
    (d) => d.principal >= 25_000_00 && bs.assets.cash > 180_000_00,
  );
  if (expensiveDebt) {
    return {
      id: `prop_cfo_${state.calendar.tick}`,
      agentRole: "cfo",
      agentTitle: isFi ? "Talous- & Kassavastaava (CFO)" : "CFO / Head of Treasury & Corporate Finance",
      priority: "medium",
      headline: isFi
        ? `Lyhennä lainaa (${expensiveDebt.lender}) 20 000 € korkokulujen pienentämiseksi`
        : `Retire $20k Principal on ${expensiveDebt.lender} to Cut Interest Carry`,
      diagnosis: isFi
        ? `Kassapuskuri (${(bs.assets.cash / 100).toFixed(0)} €) on vahva; ylimääräinen lainanlyhennys säästää korkokuluja.`
        : `Cash buffer ($${(bs.assets.cash / 100).toFixed(0)}) comfortably exceeds covenant floor; deleveraging boosts Net Margin and ROIC.`,
      tradeOffWarning: isFi
        ? "Pienentää käteiskassaa 20 000 €, mutta parantaa kuukausittaista nettotulosta."
        : "Reduces cash cushion by $20k in exchange for permanent interest savings.",
      kpiFocus: isFi ? "Korkokulut, Nettotulos" : "Interest Coverage, Net Margin, ROIC",
      actions: [
        {
          type: "REPAY_DEBT",
          debtId: expensiveDebt.id,
          amount: 20_000_00,
        },
      ],
    };
  }

  const gmPct = is.netRevenue > 0 ? (is.grossProfit / is.netRevenue) * 100 : 40;
  return {
    id: `prop_cfo_${state.calendar.tick}`,
    agentRole: "cfo",
    agentTitle: isFi ? "Talous- & Kassavastaava (CFO)" : "CFO / Head of Treasury & Corporate Finance",
    priority: "low",
    headline: isFi
      ? `Pidä kassa ja myyntikate (${gmPct.toFixed(1)}%) vahvalla pohjalla`
      : `Maintain Treasury Discipline (Gross Margin ${gmPct.toFixed(1)}%, Balance Sheet Reconciled)`,
    diagnosis: isFi
      ? `Kassatilanne (${(bs.assets.cash / 100).toFixed(0)} €) ja rahan kierto (${ccc.toFixed(1)} pv) ovat terveellä tasolla.`
      : `Liquidity ($${(bs.assets.cash / 100).toFixed(0)}) and working capital cycle (${ccc.toFixed(1)}d) are within target guardrails.`,
    tradeOffWarning: isFi
      ? "Vältä turhaa hintasotaa kilpailijoiden kanssa, jotta yksikkökate ei sula."
      : "Resist unbudgeted discounts unless unit contribution margin exceeds 35%.",
    kpiFocus: isFi ? "Myyntikate, Kassavirta" : "Gross Margin, ROIC, Working Capital",
    actions: [{ type: "NOOP", note: "Hold treasury allocations steady" }],
  };
}

function evaluateCroAgent(state: WorldState): AgentProposal {
  const primaryOff = state.commercial.offerings[0];
  const primaryMkt = state.commercial.marketing[0];
  const pres = state.market.presence[0];
  const { contributionMarginPct } = resolveOfferingPrice(state, primaryOff, 1);
  const isFi = Boolean(state.company.domainUi);

  if (pres && pres.awareness < 0.65 && primaryMkt) {
    return {
      id: `prop_cro_${state.calendar.tick}`,
      agentRole: "cro",
      agentTitle: isFi ? "Myynti- & Markkinointivastaava (CRO)" : "CRO / VP of Sales & Marketing",
      priority: "medium",
      headline: isFi
        ? `Lisää näkyvyyttä: ${primaryMkt.name} (+50 €/pv) asiakasvirran kasvattamiseksi`
        : `Scale ${primaryMkt.name} (+$120/day) to Expand Top-of-Funnel Awareness (${(pres.awareness * 100).toFixed(0)}%)`,
      diagnosis: isFi
        ? `Tunnettuus kohderyhmässä on ${(pres.awareness * 100).toFixed(0)}% ja myyntikate on vahva (${(contributionMarginPct * 100).toFixed(0)}%). Lisänäkyvyys tuo uusia asiakkaita ilman hinnanalennusta (Nash-erilaistuminen).`
        : `Segment awareness is ${(pres.awareness * 100).toFixed(0)}% while unit contribution margin is ${(contributionMarginPct * 100).toFixed(0)}%. We are leaving profitable market share on the table.`,
      tradeOffWarning: isFi
        ? "Kasvattaa markkinointikulua ja vaatii, että tiski ja varasto pystyvät palvelemaan lisäasiakkaat."
        : "Increases daily marketing OpEx by $120/day and requires COO warehouse capacity to fulfill incremental demand.",
      kpiFocus: isFi ? "Asiakasvirta, Tunnettuus, Markkinaosuus" : "Market Share, Brand Equity, B2B Pipeline Velocity",
      actions: [
        {
          type: "SET_MARKETING_BUDGET",
          channelId: primaryMkt.id,
          dailyBudget: primaryMkt.dailyBudget + (isFi ? 50_00 : 120_00),
        },
      ],
    };
  }

  return {
    id: `prop_cro_${state.calendar.tick}`,
    agentRole: "cro",
    agentTitle: isFi ? "Myynti- & Markkinointivastaava (CRO)" : "CRO / VP of Sales & Marketing",
    priority: "low",
    headline: isFi
      ? `Käynnistä 5% kampanjaetu tuotteelle ${primaryOff.name} kilpailijoiden haastamiseksi`
      : `Deploy 5% Tactical Promotion on ${primaryOff.name} to Capture Competitor Accounts`,
    diagnosis: isFi
      ? `Markkinaosuutesi on nyt ${((pres?.marketShare ?? 0.25) * 100).toFixed(1)}%. Pieni 5% kampanja houkuttelee ohikulkijoita kilpailijoilta.`
      : `Current market share is ${((pres?.marketShare ?? 0.25) * 100).toFixed(1)}%. A modest 5% tactical discount sharpens our multinomial-logit utility score against rivals.`,
    tradeOffWarning: isFi
      ? "Leikkaa myyntikatetta 5%-yksikköä; liian suuri alennus voi laukaista kilpailijoiden vastareaktion."
      : "Compresses gross margin by ~5 pts; CFO will monitor CAC payback.",
    kpiFocus: isFi ? "Myyntivolyymi, Markkinaosuus" : "Conversion Share, Unit Volume, LTV:CAC",
    actions: [
      {
        type: "SET_DISCOUNT",
        offeringId: primaryOff.id,
        discountPct: Math.min(0.2, primaryOff.discountPct + 0.05),
      },
    ],
  };
}

function evaluateChroAgent(state: WorldState): AgentProposal {
  const isFi = Boolean(state.company.domainUi);
  // Check RACI unowned processes first
  const unownedId = state.org.governance.unownedProcessIds[0];
  if (unownedId) {
    const proc = state.org.processes.find((p) => p.id === unownedId);
    const mgrRole =
      state.org.roles.find((r) => r.isManager) ?? state.org.roles[0];
    if (proc && mgrRole) {
      return {
        id: `prop_chro_${state.calendar.tick}`,
        agentRole: "chro",
        agentTitle: isFi ? "Tiimi- & Henkilöstövastaava (CHRO)" : "CHRO / VP of People & Org Architecture",
        priority: "critical",
        headline: isFi
          ? `Nimeä vastuuhenkilö prosessille "${proc.name}"`
          : `Eliminate Governance Drift: Assign RACI Ownership for "${proc.name}"`,
        diagnosis: isFi
          ? `Prosessilla "${proc.name}" ei ole nimettyä vastuuhenkilöä, mikä aiheuttaa virheitä ja sakkovaaran.`
          : `Unowned RACI process "${proc.name}" is driving governance drift (${(state.org.governance.drift * 100).toFixed(0)}%) and exposing us to regulatory fines.`,
        tradeOffWarning: isFi
          ? "Ei maksa mitään; selkeyttää työnjaon välittömästi."
          : "Zero cash cost; immediately restores compliance accountability.",
        kpiFocus: isFi ? "Työnjaon selkeys, Laatu" : "Governance Drift, RACI Coverage, Compliance Risk",
        actions: [
          {
            type: "ASSIGN_RACI",
            processId: proc.id,
            accountableRoleId: mgrRole.id,
            responsibleRoleIds: [mgrRole.id],
          },
        ],
      };
    }
  }

  // Check fatigued or low-morale roles
  const stressedPos = [...state.org.positions].sort(
    (a, b) => b.fatigue - a.fatigue + (0.75 - a.morale),
  )[0];
  if (stressedPos && (stressedPos.fatigue > 0.35 || stressedPos.morale < 0.68)) {
    const role = state.org.roles.find((r) => r.id === stressedPos.roleId)!;
    return {
      id: `prop_chro_${state.calendar.tick}`,
      agentRole: "chro",
      agentTitle: isFi ? "Tiimi- & Henkilöstövastaava (CHRO)" : "CHRO / VP of People & Org Architecture",
      priority: "high",
      headline: isFi
        ? `Palkkaa +1 ${role.title} keventämään työkuormaa`
        : `Hire +1 ${role.title} to Relieve Workload & Prevent Attrition`,
      diagnosis: isFi
        ? `Roolin ${role.title} jaksaminen on koetuksella (väsymys ${(stressedPos.fatigue * 100).toFixed(0)}%, tyytyväisyys ${(stressedPos.morale * 100).toFixed(0)}%).`
        : `${role.title} team morale is ${(stressedPos.morale * 100).toFixed(0)}% with ${(stressedPos.fatigue * 100).toFixed(0)}% fatigue (${roleHeadcount(stressedPos)} active staff).`,
      tradeOffWarning: isFi
        ? `Rekrytointikulu ${(role.recruitingCost / 100).toFixed(0)} € ja palkka ~${Math.round(role.annualSalary / 1200).toLocaleString()} €/kk.`
        : `Adds $${(role.recruitingCost / 100).toFixed(0)} recruiting fee and ~$${Math.round(role.annualSalary / 1200).toLocaleString()}/mo payroll; new hire starts at 30% productivity during ${role.rampDays}-day ramp.`,
      kpiFocus: isFi ? "Tiimin jaksaminen, Palvelukyky" : "Employee Morale, Fatigue, Attrition Rate, Span of Control",
      actions: [
        {
          type: "HIRE",
          roleId: role.id,
          count: 1,
        },
      ],
    };
  }

  return {
    id: `prop_chro_${state.calendar.tick}`,
    agentRole: "chro",
    agentTitle: isFi ? "Tiimi- & Henkilöstövastaava (CHRO)" : "CHRO / VP of People & Org Architecture",
    priority: "low",
    headline: isFi
      ? `Tiimin työnjako ja jaksaminen kunnossa (Selkeys ${(100 - state.org.governance.drift * 100).toFixed(0)}%)`
      : `Workforce Healthy (100% RACI Coverage, Drift ${(state.org.governance.drift * 100).toFixed(0)}%)`,
    diagnosis: isFi
      ? "Kaikilla avaintehtävillä on vastuuhenkilö ja tiimin kuormitus on hyvällä tasolla."
      : "All critical RACI processes have staffed Accountable/Responsible owners and span of control is balanced.",
    tradeOffWarning: isFi
      ? "Pidä tiimikoko sopivana myyntivolyymiin nähden."
      : "Avoid rapid headcount spikes that trigger Brooks's Law coordination tax.",
    kpiFocus: isFi ? "Tiimin tuottavuus, Työtyytyväisyys" : "Productivity, Span of Control, Retention",
    actions: [{ type: "NOOP", note: "Hold org chart steady" }],
  };
}

// ── External Counterparty Negotiation Simulator (Suppliers, B2B Buyers, Investors) ──

export interface NegotiationProposal {
  counterpartyKind: "supplier" | "investor";
  counterpartyId: string;
  /** For supplier: requested payment terms days (e.g. Net 45/60); for investor: requested capital cents. */
  requestedValue: number;
  /** For supplier: committed order qty; for investor: proposed pre-money valuation cents. */
  offeredCommitment: number;
}

export interface NegotiationOutcome {
  accepted: boolean;
  counterpartyName: string;
  responseMessage: string;
  actions: ActionPayload[];
}

export function negotiateWithCounterparty(
  state: WorldState,
  proposal: NegotiationProposal,
): NegotiationOutcome {
  const isFi = Boolean(state.company.domainUi);
  if (proposal.counterpartyKind === "supplier") {
    const sup =
      state.supply.suppliers.find((s) => s.id === proposal.counterpartyId) ??
      state.supply.suppliers[0];
    const wh = state.warehouses.sites[0];
    const lane = state.supply.lanes[0];
    const offer = sup.offers[0];
    const minCommitment = offer.moq * 2;

    if (proposal.offeredCommitment >= minCommitment && proposal.requestedValue <= 60) {
      sup.terms = { kind: "net", days: Math.round(proposal.requestedValue) };
      offer.unitPrice = Math.max(15, Math.round(offer.unitPrice * 0.95));
      return {
        accepted: true,
        counterpartyName: sup.name,
        responseMessage: isFi
          ? `Sopimus syntyi! Kun sitoudut ${proposal.offeredCommitment} yksikön tilaukseen, ${sup.name} myöntää ${Math.round(proposal.requestedValue)} pv maksuaikaa ja -5% volyymialennuksen.`
          : `Agreed. With a commitment of ${proposal.offeredCommitment} units, ${sup.name} extends Net ${Math.round(proposal.requestedValue)} terms (improving your DPO and Cash Conversion Cycle).`,
        actions: [
          {
            type: "PLACE_PURCHASE_ORDER",
            supplierId: sup.id,
            itemId: offer.itemId,
            qty: proposal.offeredCommitment,
            warehouseId: wh.id,
            laneId: lane.id,
          },
        ],
      };
    }
    return {
      accepted: false,
      counterpartyName: sup.name,
      responseMessage: isFi
        ? `${sup.name} hylkäsi tarjouksen: vaatii vähintään ${minCommitment} kpl sitoumuksen.`
        : `${sup.name} declined: requires at least ${minCommitment} units committed and max Net 60 terms.`,
      actions: [],
    };
  }

  // Investor VC/PE Valuation Negotiation
  const bs = buildBalanceSheet(state.finance.ledger);
  const is = buildIncomeStatement(state.finance.ledger);
  const annualizedRev = Math.max(250_000_00, is.netRevenue * 12);
  const maxSupportablePreMoney = Math.max(
    bs.equity.total * 3,
    annualizedRev * 5,
  );

  if (proposal.offeredCommitment <= maxSupportablePreMoney) {
    return {
      accepted: true,
      counterpartyName: isFi ? "Kasvusijoittaja & Pääomarahasto" : "Summit Horizon Ventures",
      responseMessage: isFi
        ? `Sijoitussopimus hyväksytty! Sijoitamme ${(proposal.requestedValue / 100).toLocaleString()} € kasvupääomaa ${(proposal.offeredCommitment / 100).toLocaleString()} € valuaatiolla.`
        : `Term sheet signed! Investing $${(proposal.requestedValue / 100).toLocaleString()} at a $${(proposal.offeredCommitment / 100).toLocaleString()} pre-money valuation.`,
      actions: [
        {
          type: "RAISE_EQUITY",
          investor: isFi ? "Kasvusijoittaja & Pääomarahasto" : "Summit Horizon Ventures",
          roundName: "Growth Round",
          amount: Math.round(proposal.requestedValue),
          preMoneyValuation: Math.round(proposal.offeredCommitment),
          boardSeat: true,
        },
      ],
    };
  }

  return {
    accepted: false,
    counterpartyName: isFi ? "Kasvusijoittaja & Pääomarahasto" : "Summit Horizon Ventures",
    responseMessage: isFi
      ? `Valuaatio hylätty: nykyisellä liikevaihdolla ja taseella korkein hyväksyttävä pre-money-arvo on ${(maxSupportablePreMoney / 100).toLocaleString()} €.`
      : `Valuation rejected: based on your trailing revenue and unit economics, our ceiling pre-money valuation is $${(maxSupportablePreMoney / 100).toLocaleString()}.`,
    actions: [],
  };
}
