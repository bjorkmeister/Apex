/**
 * Sub-Engines 4.4 & 4.5: Market Dynamics, Demand Elasticity, Pricing, Marketing Funnel & Order Fulfillment.
 *
 * Enforces:
 *  - All 7 Pricing Models: Cost-Plus, Value-Based, Dynamic Surge, Tiered Volume, Wholesale/Distributor Margin,
 *    Subscription/Recurring (with deferred revenue & monthly churn), and Razors-and-Blades (installed-base consumables).
 *  - Diminishing-returns Marketing Funnel (Michaelis-Menten saturation + ad fatigue) driving segment awareness,
 *    brand equity, and B2B inbound leads.
 *  - Multinomial Logit (MNL) Customer Cohort Utility Choice across player offerings, AI competitors, and the
 *    outside option, combining price elasticity, quality, delivery speed, availability (stockouts penalize utility),
 *    brand equity, and switching-cost inertia.
 *  - Multi-stage B2B Enterprise Pipeline (`lead` -> `qualified` -> `proposal` -> `negotiation` -> `Contract`)
 *    constrained by ramped sales-rep capacity, plus active contract recurring order generation and SLA penalties.
 *  - Order Fulfillment against Warehouse Pick-Pack-Ship capacity (`pickPackUnitsPerDay`) or non-storable service capacity,
 *    booking revenue, channel commissions, COGS (`cogs_product` + `cogs_freight_out`), AR or immediate Cash,
 *    and reverse logistics (`PendingReturn` -> refund + restock/scrap).
 */
import type {
  Cents,
  Channel,
  Offering,
  OfferingState,
  OpportunityStage,
  Segment,
  WorldState,
} from "../schema";
import { payOrQueuePayable, postJournal } from "./ledger";
import { applyModifiers, nextId, pushNotification } from "./modifiers";
import { capabilityFriction } from "./operations";
import { cohortProductivity, getRole, roleHeadcount } from "./org";
import { clamp, ema, type SeededRng } from "./rng";
import { expectedDistributionMean, getLane } from "./supply";
import {
  addInventoryLot,
  consumeInventoryFefo,
  effectiveWarehouseThroughput,
  getItem,
  getWarehouse,
  inventoryAccountForItem,
  onHandQty,
  unitBookCost,
} from "./warehouse";

export function getSegment(state: WorldState, segmentId: string): Segment {
  const s = state.market.segments.find((x) => x.id === segmentId);
  if (!s) throw new Error(`Unknown segment: ${segmentId}`);
  return s;
}

export function getChannel(state: WorldState, channelId: string): Channel {
  const c = state.commercial.channels.find((x) => x.id === channelId);
  if (!c) throw new Error(`Unknown channel: ${channelId}`);
  return c;
}

export function getOfferingState(state: WorldState, offeringId: string): OfferingState {
  let st = state.commercial.offeringStates.find((x) => x.offeringId === offeringId);
  if (!st) {
    st = {
      offeringId,
      installedBase: 0,
      recurringAccrual: 0,
      deferredBalance: 0,
      qualityScore: 0.75,
      deliveryDaysEma: 3,
      fillRateEma: 0.95,
      unitsSoldMtd: 0,
      revenueMtd: 0,
      lastPrice: 0,
    };
    state.commercial.offeringStates.push(st);
  }
  return st;
}

/**
 * Resolve effective customer-facing price and net company price for an offering.
 * Supports all 7 pricing architectures.
 */
export function resolveOfferingPrice(
  state: WorldState,
  offering: Offering,
  orderQty = 1,
): { customerPrice: Cents; netUnitPrice: Cents; contributionMarginPct: number } {
  const ch = getChannel(state, offering.channelId);
  const whId = ch.fulfillmentWarehouseId;
  const bookCost = unitBookCost(state, offering.itemId, whId);
  const p = offering.pricing;

  let grossPrice = 0;
  switch (p.kind) {
    case "cost_plus":
      grossPrice = Math.round(bookCost * (1 + p.markupPct));
      break;
    case "value_based":
      grossPrice = p.listPrice;
      break;
    case "dynamic_surge": {
      const wh = getWarehouse(state, whId);
      const util = Math.max(wh.telemetry.pickUtilization, wh.telemetry.utilization);
      const surge =
        util > p.utilizationTrigger
          ? p.surgeMaxPct *
            clamp((util - p.utilizationTrigger) / Math.max(0.05, 1 - p.utilizationTrigger), 0, 1)
          : 0;
      grossPrice = Math.round(p.basePrice * (1 + surge));
      break;
    }
    case "tiered_volume": {
      let best = p.tiers[0].unitPrice;
      for (const t of p.tiers) {
        if (orderQty >= t.minQty) best = t.unitPrice;
      }
      grossPrice = best;
      break;
    }
    case "wholesale":
      grossPrice = Math.round(p.msrp * (1 - p.distributorMarginPct));
      break;
    case "subscription":
      grossPrice = Math.round(p.monthlyPrice / Math.max(1, p.unitsPerMonth));
      break;
    case "razor_blades":
      grossPrice = p.razorPrice;
      break;
  }

  const discounted = Math.max(1, Math.round(grossPrice * (1 - offering.discountPct)));
  // For wholesale, final end-customer sees MSRP * (1 - discountPct); company receives `discounted`
  const customerPrice =
    p.kind === "wholesale"
      ? Math.max(1, Math.round(p.msrp * (1 - offering.discountPct)))
      : discounted;

  const netAfterFee = Math.round(discounted * (1 - ch.feePct));
  const contribMarginPct =
    netAfterFee > 0 ? (netAfterFee - bookCost) / netAfterFee : -1;

  return { customerPrice, netUnitPrice: discounted, contributionMarginPct: contribMarginPct };
}

/**
 * Advance macroeconomic cycle and inflation indices.
 */
export function runMacroTick(state: WorldState): void {
  const m = state.market.macro;
  m.cycleDay += 1;

  // 4-phase 720-day business cycle (180 days per phase)
  const phaseDay = m.cycleDay % 720;
  if (phaseDay < 240) m.cyclePhase = "expansion";
  else if (phaseDay < 360) m.cyclePhase = "slowdown";
  else if (phaseDay < 520) m.cyclePhase = "contraction";
  else m.cyclePhase = "recovery";

  const phaseDemandTarget =
    m.cyclePhase === "expansion"
      ? 1.08
      : m.cyclePhase === "slowdown"
        ? 0.98
        : m.cyclePhase === "contraction"
          ? 0.88
          : 1.02;
  m.demandIndex = ema(m.demandIndex, phaseDemandTarget, 0.015);

  const dailyInflation = m.inflationAnnual / 360;
  m.materialPriceIndex = Math.max(0.5, m.materialPriceIndex * (1 + dailyInflation));
  m.wageIndex = Math.max(0.5, m.wageIndex * (1 + dailyInflation * 0.9));
}

/**
 * Pipeline Step 4 — Demand & Market Matching:
 *  - Run Marketing Funnel, Demand Elasticity (Multinomial Logit), B2B Sales Pipeline,
 *    and Subscription / Razor-Blade recurring accruals.
 *  - Generate order bookings into `pendingOrders`.
 */
export function runDemandAndMarketMatchingTick(
  state: WorldState,
  rng: SeededRng,
): {
  unitsDemandedToday: number;
} {
  const tick = state.calendar.tick;
  let unitsDemandedToday = 0;

  // 1. Marketing spend, saturation curve, ad fatigue, awareness/brand lift & B2B lead generation
  const b2bLeadsBySegment: Record<string, number> = {};
  for (const mkt of state.commercial.marketing) {
    const spend = mkt.dailyBudget;
    if (spend > 0) {
      payOrQueuePayable(state, {
        debitAccount: "opex_marketing",
        amount: spend,
        memo: `Marketing spend — ${mkt.name}`,
        source: "commercial:marketing",
        counterparty: `${mkt.name} Media`,
        kind: "vendor",
        dueOffsetDays: 7,
        priority: 4,
      });
      state.telemetry.mtd.marketingSpend += spend;

      // Michaelis-Menten diminishing marginal returns + ad fatigue
      const effSpend = spend * (1 - 0.55 * mkt.fatigue);
      const response = effSpend / (effSpend + mkt.halfSaturationSpend);
      mkt.fatigue = clamp(mkt.fatigue + mkt.fatigueRate * response, 0, 0.85);

      for (const segId of mkt.targetSegmentIds) {
        const pres = state.market.presence.find((p) => p.segmentId === segId);
        if (pres) {
          pres.awareness = clamp(pres.awareness + mkt.awarenessGain * response, 0.02, 0.99);
          pres.brandEquity = clamp(pres.brandEquity + mkt.brandGain * response, 0.05, 0.99);
        }
        const seg = state.market.segments.find((s) => s.id === segId);
        if (seg?.kind === "b2b") {
          b2bLeadsBySegment[segId] =
            (b2bLeadsBySegment[segId] ?? 0) + mkt.leadYield * response;
        }
      }
    } else {
      mkt.fatigue = clamp(mkt.fatigue - 0.015, 0, 0.85);
    }
  }

  // Natural daily awareness & brand decay
  for (const pres of state.market.presence) {
    pres.awareness = clamp(pres.awareness * 0.9985, 0.02, 0.99);
    pres.brandEquity = clamp(pres.brandEquity * 0.9992, 0.05, 0.99);
  }

  // 2. Refresh offering quality & delivery-speed perception from operations/channels
  for (const off of state.commercial.offerings) {
    const ost = getOfferingState(state, off.id);
    const item = getItem(state, off.itemId);
    const ch = getChannel(state, off.channelId);
    const capFric = capabilityFriction(state, ch.capabilityId);

    const laneTransit = ch.outboundLaneId
      ? expectedDistributionMean(getLane(state, ch.outboundLaneId).transitDays)
      : 0;
    const estDeliveryDays = Math.max(0.5, ch.handlingDays + laneTransit);
    ost.deliveryDaysEma = ema(ost.deliveryDaysEma, estDeliveryDays, 0.15);

    // Perceived quality = designQuality reduced by work-center defect rate & capability gap
    const recipe = state.catalog.recipes.find((r) => r.outputItemId === item.id);
    const wc = recipe
      ? state.operations.workCenters.find((w) => w.id === recipe.workCenterId)
      : undefined;
    const defectDrag = wc ? wc.telemetry.defectRateEma * 0.6 : 0;
    const targetQuality = clamp(
      item.designQuality - defectDrag - capFric.extraDefectRate,
      0.1,
      0.99,
    );
    ost.qualityScore = ema(ost.qualityScore, targetQuality, 0.15);

    const { netUnitPrice } = resolveOfferingPrice(state, off, 1);
    ost.lastPrice = netUnitPrice;
  }

  // 3. Multinomial Logit (MNL) Customer Cohort Utility & Market Share per Segment
  for (const seg of state.market.segments) {
    const pres = state.market.presence.find((p) => p.segmentId === seg.id);
    if (!pres) continue;

    const seasonFactor = seg.seasonality[(state.calendar.monthOfYear - 1) % 12] ?? 1;
    const growthFactor = Math.pow(1 + seg.growthAnnual, state.calendar.tick / 360);
    const rawDailyShoppers =
      seg.baseDailyDemand * seasonFactor * growthFactor * state.market.macro.demandIndex;
    const modDailyShoppers = Math.max(
      0,
      applyModifiers(state, "segment.demand", rawDailyShoppers, seg.id),
    );
    const noisyShoppers = Math.max(0, rng.normal(modDailyShoppers, modDailyShoppers * 0.06));
    pres.potentialToday = noisyShoppers;

    const activePlayerOfferings = state.commercial.offerings.filter(
      (o) => o.segmentId === seg.id && o.active,
    );

    const wPrice = Math.max(
      0.1,
      applyModifiers(state, "segment.priceWeight", seg.weights.price, seg.id),
    );

    // Compute exp(utility) for each player offering, each competitor offering, and outside option
    const expUtilities: { key: string; expU: number; offering?: Offering; compId?: string }[] = [];

    for (const off of activePlayerOfferings) {
      const ost = getOfferingState(state, off.id);
      const { customerPrice } = resolveOfferingPrice(state, off, seg.avgOrderQty);
      const priceRatio = customerPrice / Math.max(1, seg.wtpMean);
      const speedScore = clamp(
        1 - ost.deliveryDaysEma / Math.max(1, seg.maxDeliveryDays),
        -0.5,
        1,
      );
      const availScore = ost.fillRateEma;
      const prevShare = pres.lastShares[`player:${off.id}`] ?? 0.15;

      const u =
        -wPrice * priceRatio +
        seg.weights.quality * ost.qualityScore +
        seg.weights.speed * speedScore +
        seg.weights.availability * availScore +
        seg.weights.brand * pres.brandEquity +
        seg.switchingCost * prevShare;

      const expU = pres.awareness * Math.exp(clamp(u, -12, 12));
      expUtilities.push({ key: `player:${off.id}`, expU, offering: off });
    }

    for (const comp of state.market.competitors) {
      if (comp.bankrupt) continue;
      const coff = comp.offerings.find((o) => o.segmentId === seg.id);
      if (!coff) continue;

      const effCompPrice = Math.max(
        1,
        applyModifiers(state, "competitor.price", coff.price, comp.id),
      );
      const priceRatio = effCompPrice / Math.max(1, seg.wtpMean);
      const speedScore = clamp(
        1 - coff.deliveryDays / Math.max(1, seg.maxDeliveryDays),
        -0.5,
        1,
      );
      const prevShare = pres.lastShares[`comp:${comp.id}`] ?? 0.2;

      const u =
        -wPrice * priceRatio +
        seg.weights.quality * coff.quality +
        seg.weights.speed * speedScore +
        seg.weights.availability * coff.availability +
        seg.weights.brand * coff.brand +
        seg.switchingCost * prevShare;

      const expU = coff.awareness * Math.exp(clamp(u, -12, 12));
      expUtilities.push({ key: `comp:${comp.id}`, expU, compId: comp.id });
    }

    const expOutside = Math.exp(clamp(seg.outsideOptionUtility, -10, 10));
    const totalDenom =
      expOutside + expUtilities.reduce((s, x) => s + x.expU, 0);
    const insideDenom = Math.max(
      1e-9,
      expUtilities.reduce((s, x) => s + x.expU, 0),
    );

    let playerShareInside = 0;
    const nextShares: Record<string, number> = {};

    for (const entry of expUtilities) {
      const shareOfAll = totalDenom > 0 ? entry.expU / totalDenom : 0;
      const shareInside = entry.expU / insideDenom;
      nextShares[entry.key] = shareInside;

      const unitsChosen = noisyShoppers * shareOfAll;

      if (entry.offering) {
        playerShareInside += shareInside;
        if (seg.kind === "b2c") {
          const orderedUnits = Math.round(unitsChosen);
          if (orderedUnits > 0) {
            unitsDemandedToday += orderedUnits;
            state.telemetry.mtd.unitsDemanded += orderedUnits;
            const { netUnitPrice } = resolveOfferingPrice(
              state,
              entry.offering,
              seg.avgOrderQty,
            );
            state.commercial.backlog.push({
              id: nextId(state, "so"),
              offeringId: entry.offering.id,
              itemId: entry.offering.itemId,
              qty: orderedUnits,
              shippedQty: 0,
              unitPrice: netUnitPrice,
              createdTick: tick,
              dueTick: tick + seg.maxWaitDays,
              source:
                entry.offering.pricing.kind === "subscription"
                  ? "subscription"
                  : "spot",
            });
            const newCust = Math.max(1, Math.round(orderedUnits / Math.max(1, seg.avgOrderQty)));
            pres.customers += newCust * 0.2;
            state.telemetry.mtd.newCustomers += newCust;
          }
        } else {
          // For B2B segments, utility share amplifies inbound lead conversion
          b2bLeadsBySegment[seg.id] =
            (b2bLeadsBySegment[seg.id] ?? 0) + shareInside * 0.8;
        }
      } else if (entry.compId) {
        const comp = state.market.competitors.find((c) => c.id === entry.compId);
        const coff = comp?.offerings.find((o) => o.segmentId === seg.id);
        if (comp && coff) {
          const sold = Math.min(comp.capacityUnitsPerDay, Math.round(unitsChosen));
          coff.unitsToday = sold;
        }
      }
    }

    pres.lastShares = nextShares;
    pres.marketShare = clamp(playerShareInside, 0, 1);

    const avgFill =
      activePlayerOfferings.length > 0
        ? activePlayerOfferings.reduce(
            (s, o) => s + getOfferingState(state, o.id).fillRateEma,
            0,
          ) / activePlayerOfferings.length
        : 0;
    pres.availabilityScore = avgFill;
  }

  // 4. Subscription & Razor-and-Blades installed-base recurring demand
  for (const off of state.commercial.offerings) {
    if (!off.active) continue;
    const ost = getOfferingState(state, off.id);
    const p = off.pricing;

    if (p.kind === "subscription" && ost.installedBase > 0) {
      // Daily subscriber churn (amplified if fill rate is poor)
      const slaChurnBoost = Math.max(0, 0.9 - ost.fillRateEma) * 0.25;
      const dailyChurn = clamp((p.churnMonthly + slaChurnBoost) / 30, 0, 0.15);
      ost.installedBase = Math.max(0, ost.installedBase * (1 - dailyChurn));

      // Daily recurring subscription billing & revenue recognition
      const dailySubRev = Math.round((ost.installedBase * p.monthlyPrice) / 30);
      if (dailySubRev > 0) {
        postJournal(state, {
          memo: `Recurring subscription billing — ${off.name}`,
          source: "commercial:subscription",
          cashFlow: "operating",
          lines: [
            { account: "cash", amount: dailySubRev },
            { account: "revenue_subscription", amount: -dailySubRev },
          ],
        });
        ost.revenueMtd += dailySubRev;
      }

      // If subscription includes physical/service units per month, queue recurring shipment
      if (p.unitsPerMonth > 0) {
        ost.recurringAccrual += (ost.installedBase * p.unitsPerMonth) / 30;
        const wholeUnits = Math.floor(ost.recurringAccrual);
        if (wholeUnits > 0) {
          ost.recurringAccrual -= wholeUnits;
          unitsDemandedToday += wholeUnits;
          state.telemetry.mtd.unitsDemanded += wholeUnits;
          state.commercial.backlog.push({
            id: nextId(state, "so"),
            offeringId: off.id,
            itemId: off.itemId,
            qty: wholeUnits,
            shippedQty: 0,
            // Revenue already recognized via subscription billing above
            unitPrice: 0,
            createdTick: tick,
            dueTick: tick + 5,
            source: "subscription",
          });
        }
      }
    } else if (p.kind === "razor_blades" && ost.installedBase > 0) {
      ost.installedBase = Math.max(0, ost.installedBase * (1 - 0.02 / 30));
      ost.recurringAccrual += (ost.installedBase * p.bladesPerMonth) / 30;
      const bladeUnits = Math.floor(ost.recurringAccrual);
      if (bladeUnits > 0) {
        ost.recurringAccrual -= bladeUnits;
        unitsDemandedToday += bladeUnits;
        state.telemetry.mtd.unitsDemanded += bladeUnits;
        state.commercial.backlog.push({
          id: nextId(state, "so"),
          offeringId: off.id,
          itemId: p.bladeItemId,
          qty: bladeUnits,
          shippedQty: 0,
          unitPrice: p.bladePrice,
          createdTick: tick,
          dueTick: tick + 4,
          source: "consumable",
        });
      }
    }
  }

  // 5. B2B Enterprise Sales Pipeline & Active Contracts
  const b2bDemand = runB2BSalesAndContracts(state, rng, b2bLeadsBySegment);
  unitsDemandedToday += b2bDemand;
  state.telemetry.mtd.unitsDemanded += b2bDemand;

  return { unitsDemandedToday };
}

/**
 * Pipeline Step 5 — Outbound Logistics & Invoicing:
 *  - Ship fulfilled orders against Warehouse Pick-Pack-Ship capacity (or non-storable service capacity).
 *  - Issue Accounts Receivable (A/R) invoices or collect immediate cash; debit finished inventory to COGS.
 *  - Log expired unmet demand/stockouts as churn and process reverse-logistics customer returns.
 */
export function runOutboundLogisticsAndInvoicingTick(
  state: WorldState,
  rng: SeededRng,
): { unitsShippedToday: number; unitsLostToday: number } {
  const fulfillRes = fulfillBacklogOrders(state, rng);
  processPendingReturns(state);
  return {
    unitsShippedToday: fulfillRes.shippedToday,
    unitsLostToday: fulfillRes.lostToday,
  };
}

/**
 * Combined wrapper running Step 4 (Demand & Market Matching) followed by Step 5 (Outbound Logistics & Invoicing).
 */
export function runCommercialAndMarketTick(
  state: WorldState,
  rng: SeededRng,
): {
  unitsDemandedToday: number;
  unitsShippedToday: number;
  unitsLostToday: number;
} {
  const { unitsDemandedToday } = runDemandAndMarketMatchingTick(state, rng);
  const { unitsShippedToday, unitsLostToday } = runOutboundLogisticsAndInvoicingTick(state, rng);
  return {
    unitsDemandedToday,
    unitsShippedToday,
    unitsLostToday,
  };
}

function runB2BSalesAndContracts(
  state: WorldState,
  rng: SeededRng,
  marketingLeadsBySegment: Record<string, number>,
): number {
  const tick = state.calendar.tick;
  let b2bUnitsDemanded = 0;

  // Compute ramped sales rep capacity per B2B segment
  let totalMaxOpps = 0;
  const repLeadsBySeg: Record<string, number> = {};

  for (const role of state.org.roles) {
    if (!role.sales) continue;
    const pos = state.org.positions.find((p) => p.roleId === role.id);
    if (!pos) continue;
    let effReps = 0;
    for (const c of pos.cohorts) {
      effReps += c.count * cohortProductivity(c.hiredTick, tick, role.rampDays);
    }
    totalMaxOpps += effReps * role.sales.maxOpenOpportunities;
    for (const segId of role.sales.segmentIds) {
      repLeadsBySeg[segId] =
        (repLeadsBySeg[segId] ?? 0) + effReps * role.sales.leadsPerDay;
    }
  }

  // Generate new B2B opportunities if pipeline is within sales rep capacity
  for (const seg of state.market.segments) {
    if (seg.kind !== "b2b" || !seg.b2b) continue;
    const off = state.commercial.offerings.find(
      (o) => o.segmentId === seg.id && o.active,
    );
    if (!off) continue;

    const rawLeads =
      (marketingLeadsBySegment[seg.id] ?? 0) + (repLeadsBySeg[seg.id] ?? 0);
    const newLeads = rng.poisson(rawLeads);

    for (let i = 0; i < newLeads; i++) {
      if (state.commercial.pipeline.length >= Math.max(5, totalMaxOpps)) break;
      const dealUnits = Math.max(
        10,
        Math.round(rng.sample(seg.b2b.avgDealUnitsPerMonth)),
      );
      const { netUnitPrice } = resolveOfferingPrice(state, off, dealUnits);
      state.commercial.pipeline.push({
        id: nextId(state, "opp"),
        segmentId: seg.id,
        offeringId: off.id,
        stage: "lead",
        unitsPerMonth: dealUnits,
        unitPrice: netUnitPrice,
        stageEnteredTick: tick,
        createdTick: tick,
      });
    }
  }

  // Advance pipeline stages
  const nextOrder: Record<OpportunityStage, OpportunityStage | "won"> = {
    lead: "qualified",
    qualified: "proposal",
    proposal: "negotiation",
    negotiation: "won",
  };

  const keptOpps: WorldState["commercial"]["pipeline"] = [];
  for (const opp of state.commercial.pipeline) {
    const seg = getSegment(state, opp.segmentId);
    const b2b = seg.b2b;
    if (!b2b) continue;

    const requiredDays = b2b.stageDays[opp.stage];
    if (tick - opp.stageEnteredTick < requiredDays) {
      keptOpps.push(opp);
      continue;
    }

    // Conversion probability modulated by player utility share in this segment
    const pres = state.market.presence.find((p) => p.segmentId === seg.id);
    const shareBoost = clamp(0.65 + (pres?.marketShare ?? 0.25) * 1.1, 0.35, 1.45);
    const convProb = clamp(b2b.stageConversion[opp.stage] * shareBoost, 0.05, 0.95);

    if (rng.chance(convProb)) {
      const nextStage = nextOrder[opp.stage];
      if (nextStage === "won") {
        state.commercial.contracts.push({
          id: nextId(state, "ctr"),
          customerName: `${seg.name} Account #${state.nextSeq}`,
          segmentId: seg.id,
          offeringId: opp.offeringId,
          unitsPerMonth: opp.unitsPerMonth,
          unitPrice: opp.unitPrice,
          startTick: tick,
          endTick: tick + b2b.contractMonths * 30,
          slaFillRate: b2b.slaFillRate,
          penaltyPct: b2b.penaltyPct,
          fillRateEma: 1.0,
          status: "active",
          orderAccrual: 0,
          shippedMtd: 0,
          orderedMtd: 0,
        });
        state.telemetry.mtd.contractsWon += 1;
        state.telemetry.mtd.newCustomers += 1;
        if (pres) pres.customers += 1;
        pushNotification(
          state,
          "info",
          "sales",
          `Closed-Won B2B contract (${opp.unitsPerMonth} units/mo @ $${(opp.unitPrice / 100).toFixed(2)}).`,
        );
      } else {
        opp.stage = nextStage;
        opp.stageEnteredTick = tick;
        keptOpps.push(opp);
      }
    }
    // else: opportunity Closed-Lost (dropped)
  }
  state.commercial.pipeline = keptOpps;

  // Active B2B contracts generate recurring orders & check renewal/SLA at expiry
  for (const ctr of state.commercial.contracts) {
    if (ctr.status !== "active") continue;

    ctr.orderAccrual += ctr.unitsPerMonth / 30;
    const dueUnits = Math.floor(ctr.orderAccrual);
    if (dueUnits > 0) {
      ctr.orderAccrual -= dueUnits;
      ctr.orderedMtd += dueUnits;
      b2bUnitsDemanded += dueUnits;
      state.commercial.backlog.push({
        id: nextId(state, "so"),
        offeringId: ctr.offeringId,
        itemId:
          state.commercial.offerings.find((o) => o.id === ctr.offeringId)?.itemId ??
          state.catalog.items[0].id,
        qty: dueUnits,
        shippedQty: 0,
        unitPrice: ctr.unitPrice,
        createdTick: tick,
        dueTick: tick + 5,
        source: "contract",
        contractId: ctr.id,
      });
    }

    // Monthly SLA check & penalty on day 30
    if (state.calendar.dayOfMonth === 30 && ctr.orderedMtd > 0) {
      const mtdFill = clamp(ctr.shippedMtd / ctr.orderedMtd, 0, 1);
      ctr.fillRateEma = ema(ctr.fillRateEma, mtdFill, 0.4);
      if (mtdFill < ctr.slaFillRate) {
        const monthlyValue = Math.round(ctr.unitsPerMonth * ctr.unitPrice);
        const penalty = Math.round(monthlyValue * ctr.penaltyPct);
        if (penalty > 0) {
          payOrQueuePayable(state, {
            debitAccount: "contra_revenue_returns",
            amount: penalty,
            memo: `B2B SLA breach credit (${(mtdFill * 100).toFixed(0)}% vs ${(ctr.slaFillRate * 100).toFixed(0)}%) — ${ctr.customerName}`,
            source: "commercial:sla_penalty",
            counterparty: ctr.customerName,
            kind: "customer_credit",
            dueOffsetDays: 15,
            priority: 2,
          });
          pushNotification(
            state,
            "warning",
            "sales",
            `SLA penalty ($${(penalty / 100).toFixed(0)}) on ${ctr.customerName}: fill rate ${(mtdFill * 100).toFixed(0)}%.`,
          );
        }
      }
      ctr.shippedMtd = 0;
      ctr.orderedMtd = 0;
    }

    // Renewal or churn at contract end
    if (tick >= ctr.endTick) {
      const seg = getSegment(state, ctr.segmentId);
      const baseRenew = seg.b2b?.renewalBase ?? 0.8;
      const slaFactor = ctr.fillRateEma >= ctr.slaFillRate ? 1.05 : 0.55;
      if (rng.chance(clamp(baseRenew * slaFactor, 0.1, 0.96))) {
        ctr.startTick = tick;
        ctr.endTick = tick + (seg.b2b?.contractMonths ?? 12) * 30;
      } else {
        ctr.status = "churned";
        const pres = state.market.presence.find((p) => p.segmentId === ctr.segmentId);
        if (pres) pres.customers = Math.max(0, pres.customers - 1);
        pushNotification(
          state,
          "warning",
          "sales",
          `B2B contract ${ctr.customerName} churned at renewal (fill rate ${(ctr.fillRateEma * 100).toFixed(0)}%).`,
        );
      }
    }
  }

  return b2bUnitsDemanded;
}

function fulfillBacklogOrders(
  state: WorldState,
  rng: SeededRng,
): { shippedToday: number; lostToday: number } {
  const tick = state.calendar.tick;
  let shippedToday = 0;
  let lostToday = 0;

  // Remaining pick-pack-ship capacity per warehouse today
  const remPickByWh: Record<string, number> = {};
  const maxPickByWh: Record<string, number> = {};
  for (const wh of state.warehouses.sites) {
    const cap = effectiveWarehouseThroughput(state, wh, "pick");
    remPickByWh[wh.id] = cap;
    maxPickByWh[wh.id] = cap;
  }

  // Sort backlog: contract orders first, then earliest dueTick
  state.commercial.backlog.sort((a, b) => {
    const pa = a.source === "contract" ? 0 : 1;
    const pb = b.source === "contract" ? 0 : 1;
    if (pa !== pb) return pa - pb;
    return a.dueTick - b.dueTick;
  });

  const remainingOrders: WorldState["commercial"]["backlog"] = [];

  for (const so of state.commercial.backlog) {
    const off = state.commercial.offerings.find((o) => o.id === so.offeringId);
    if (!off) continue;
    const ost = getOfferingState(state, off.id);
    const ch = getChannel(state, off.channelId);
    const seg = getSegment(state, off.segmentId);
    const item = getItem(state, so.itemId);
    const wh = getWarehouse(state, ch.fulfillmentWarehouseId);

    const needed = Math.max(0, so.qty - so.shippedQty);
    if (needed <= 1e-6) continue;

    let shipQty = 0;
    let releasedCost: Cents = 0;

    if (item.kind === "service") {
      const availCap = state.operations.serviceCapacityToday[item.id] ?? 0;
      shipQty = Math.min(needed, Math.floor(availCap));
      if (shipQty > 0) {
        state.operations.serviceCapacityToday[item.id] = availCap - shipQty;
      }
    } else {
      const availStock = onHandQty(state, item.id, wh.id);
      const availPick = Math.floor(remPickByWh[wh.id] ?? 0);
      shipQty = Math.max(0, Math.min(needed, Math.floor(availStock), availPick));

      if (shipQty > 0) {
        remPickByWh[wh.id] = Math.max(0, (remPickByWh[wh.id] ?? 0) - shipQty);
        if (wh.laborRoleId && wh.unitsPerLaborHour > 0) {
          const pos = state.org.positions.find((p) => p.roleId === wh.laborRoleId);
          if (pos) pos.laborHoursUsed += shipQty / wh.unitsPerLaborHour;
        }
        const consumed = consumeInventoryFefo(state, {
          itemId: item.id,
          warehouseId: wh.id,
          qty: shipQty,
        });
        shipQty = consumed.consumedQty;
        releasedCost = consumed.releasedValue;
      }
    }

    if (shipQty > 0) {
      so.shippedQty += shipQty;
      shippedToday += shipQty;
      ost.unitsSoldMtd += shipQty;
      state.telemetry.mtd.unitsSold += shipQty;

      // Update installed base for subscription or razor-and-blades offerings
      if (off.pricing.kind === "subscription" && so.source === "subscription" && so.unitPrice > 0) {
        ost.installedBase += shipQty;
      } else if (off.pricing.kind === "razor_blades" && so.itemId === off.itemId) {
        ost.installedBase += shipQty;
      }

      if (so.contractId) {
        const ctr = state.commercial.contracts.find((c) => c.id === so.contractId);
        if (ctr) ctr.shippedMtd += shipQty;
      }

      // 1. Book COGS on physical inventory release
      if (releasedCost > 0) {
        const invAccount = inventoryAccountForItem(item);
        postJournal(state, {
          memo: `COGS on shipment of ${shipQty} ${item.name} (${so.id})`,
          source: "commercial:cogs",
          lines: [
            { account: "cogs_product", amount: releasedCost },
            { account: invAccount, amount: -releasedCost },
          ],
        });
      }

      // 2. Book outbound freight & 3PL pick-pack fee
      let outFreight: Cents = 0;
      if (ch.outboundLaneId) {
        const lane = getLane(state, ch.outboundLaneId);
        const rawFreight =
          lane.fixedCostPerShipment + shipQty * item.unitVolumeM3 * lane.costPerM3;
        outFreight = Math.max(0, Math.round(applyModifiers(state, "lane.cost", rawFreight, lane.id)));
      }
      if (outFreight > 0) {
        payOrQueuePayable(state, {
          debitAccount: "cogs_freight_out",
          amount: outFreight,
          memo: `Outbound freight — ${so.id}`,
          source: "commercial:freight_out",
          counterparty: "Outbound Carrier",
          kind: "freight",
          dueOffsetDays: 7,
          priority: 3,
        });
      }

      if (wh.mode === "3pl" && wh.threePl) {
        const pickFee = Math.round(shipQty * wh.threePl.handlingFeePerUnit);
        if (pickFee > 0) {
          payOrQueuePayable(state, {
            debitAccount: "opex_warehousing",
            amount: pickFee,
            memo: `3PL pick-pack fee — ${wh.name}`,
            source: "commercial:3pl_out",
            counterparty: wh.name,
            kind: "3pl",
            dueOffsetDays: 15,
            priority: 3,
          });
        }
      }

      // 3. Book Revenue, Channel Commission & Cash / Accounts Receivable
      const grossRev = Math.round(shipQty * so.unitPrice);
      if (grossRev > 0) {
        const channelFee = Math.round(grossRev * ch.feePct);
        const netReceivable = grossRev - channelFee;
        const revAccount =
          item.kind === "service" ? "revenue_service" : "revenue_product";

        const extraDelay = Math.max(
          0,
          Math.round(applyModifiers(state, "channel.paymentDelayDays", 0, ch.id)),
        );
        const effectiveTermsDays = ch.paymentTermsDays + extraDelay;

        if (effectiveTermsDays === 0) {
          const lines: {
            account: "cash" | "opex_channel_fees" | typeof revAccount;
            amount: Cents;
          }[] = [{ account: revAccount, amount: -grossRev }];
          if (netReceivable > 0) lines.push({ account: "cash", amount: netReceivable });
          if (channelFee > 0) lines.push({ account: "opex_channel_fees", amount: channelFee });
          postJournal(state, {
            memo: `Cash sale of ${shipQty} ${item.name} via ${ch.name}`,
            source: "commercial:sale_cash",
            cashFlow: "operating",
            lines,
          });
        } else {
          const lines: {
            account: "accounts_receivable" | "opex_channel_fees" | typeof revAccount;
            amount: Cents;
          }[] = [{ account: revAccount, amount: -grossRev }];
          if (netReceivable > 0) {
            lines.push({ account: "accounts_receivable", amount: netReceivable });
          }
          if (channelFee > 0) {
            lines.push({ account: "opex_channel_fees", amount: channelFee });
          }
          postJournal(state, {
            memo: `Credit sale (Net ${effectiveTermsDays}) of ${shipQty} ${item.name} via ${ch.name}`,
            source: "commercial:sale_ar",
            lines,
          });
          if (netReceivable > 0) {
            state.finance.receivables.push({
              id: nextId(state, "ar"),
              channelId: ch.id,
              amount: netReceivable,
              createdTick: tick,
              dueTick: tick + effectiveTermsDays,
              defaultProb: seg.defaultRatePct,
              slipped: false,
            });
          }
        }

        ost.revenueMtd += grossRev;
      }

      // 4. Reverse logistics: stochastic returns on physical shipments
      if (item.kind !== "service" && ch.returnRate > 0 && grossRev > 0) {
        const returnProb = clamp(
          ch.returnRate + (1 - ost.qualityScore) * 0.08,
          0,
          0.35,
        );
        const retQty = rng.poisson(shipQty * returnProb);
        if (retQty > 0 && retQty <= shipQty) {
          const refund = Math.round((grossRev * retQty) / shipQty);
          const costVal = Math.round((releasedCost * retQty) / shipQty);
          state.commercial.pendingReturns.push({
            id: nextId(state, "ret"),
            offeringId: off.id,
            itemId: item.id,
            qty: retQty,
            refund,
            costValue: costVal,
            dueTick: tick + rng.int(4, 10),
            restockRate: ch.restockRate,
            warehouseId: wh.id,
          });
        }
      }
    }

    // Check if any unshipped balance remains
    const stillUnshipped = Math.max(0, so.qty - so.shippedQty);
    if (stillUnshipped > 1e-6) {
      const fulfilledRatio = so.shippedQty / so.qty;
      ost.fillRateEma = ema(ost.fillRateEma, fulfilledRatio, 0.12);

      if (tick >= so.dueTick && so.source === "spot") {
        // Stockout churn: impatient spot customers cancel overdue orders and defect to competitors
        lostToday += stillUnshipped;
        state.telemetry.mtd.unitsLost += stillUnshipped;
        const pres = state.market.presence.find((p) => p.segmentId === off.segmentId);
        if (pres) {
          pres.brandEquity = clamp(pres.brandEquity - 0.004, 0.05, 0.99);
        }
      } else {
        remainingOrders.push(so);
      }
    } else {
      ost.fillRateEma = ema(ost.fillRateEma, 1.0, 0.08);
    }
  }

  state.commercial.backlog = remainingOrders;

  // Update warehouse pick-pack telemetry
  for (const wh of state.warehouses.sites) {
    const cap = maxPickByWh[wh.id] ?? 0;
    const used = cap - (remPickByWh[wh.id] ?? 0);
    wh.telemetry.pickUtilization = cap > 0 ? clamp(used / cap, 0, 1.5) : 0;
    wh.telemetry.pickBacklogUnits = state.commercial.backlog
      .filter((b) => {
        const o = state.commercial.offerings.find((x) => x.id === b.offeringId);
        const c = o ? getChannel(state, o.channelId) : undefined;
        return c?.fulfillmentWarehouseId === wh.id;
      })
      .reduce((s, b) => s + Math.max(0, b.qty - b.shippedQty), 0);
  }

  return { shippedToday, lostToday };
}

function processPendingReturns(state: WorldState): void {
  const tick = state.calendar.tick;
  const due = state.commercial.pendingReturns.filter((r) => tick >= r.dueTick);
  if (due.length === 0) return;

  state.commercial.pendingReturns = state.commercial.pendingReturns.filter(
    (r) => tick < r.dueTick,
  );

  for (const ret of due) {
    // 1. Refund customer (`contra_revenue_returns` -> cash or AP)
    if (ret.refund > 0) {
      payOrQueuePayable(state, {
        debitAccount: "contra_revenue_returns",
        amount: ret.refund,
        memo: `Customer return refund (${ret.qty} units)`,
        source: "commercial:return_refund",
        counterparty: "Customer Return",
        kind: "customer_credit",
        dueOffsetDays: 0,
        priority: 2,
      });
    }

    // 2. Restock salvageable units into inventory, scrap the rest
    if (ret.costValue > 0) {
      const item = getItem(state, ret.itemId);
      const invAccount = inventoryAccountForItem(item);
      const restockQty = Math.floor(ret.qty * ret.restockRate);
      const restockVal =
        ret.qty > 0 ? Math.round((ret.costValue * restockQty) / ret.qty) : 0;
      const scrapVal = ret.costValue - restockVal;

      const lines: {
        account: typeof invAccount | "cogs_spoilage_shrink" | "cogs_product";
        amount: Cents;
      }[] = [{ account: "cogs_product", amount: -ret.costValue }];
      if (restockVal > 0) lines.push({ account: invAccount, amount: restockVal });
      if (scrapVal > 0) lines.push({ account: "cogs_spoilage_shrink", amount: scrapVal });

      postJournal(state, {
        memo: `Return restock (${restockQty}/${ret.qty} units) — ${item.name}`,
        source: "commercial:return_restock",
        lines,
      });

      if (restockQty > 0 && restockVal > 0) {
        addInventoryLot(state, {
          itemId: item.id,
          warehouseId: ret.warehouseId,
          qty: restockQty,
          value: restockVal,
        });
      }
    }
  }
}
