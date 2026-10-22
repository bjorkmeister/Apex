/**
 * Sub-Engine 4.2a: Procurement, Inbound Logistics, Dock Receiving & Automated Reorder Policies.
 *
 * Enforces:
 *  - Multi-tier suppliers with MOQs, volume price breaks, payment terms (CIA / COD / Net 30/60/90),
 *    lead-time distributions (μ, σ), reliability scores, and credit holds when AP is overdue.
 *  - Inbound freight modes (Ocean, Rail, FTL, LTL, Air, Courier) with transit-time distributions,
 *    delay probabilities, damage rates, and cubic-meter freight pricing.
 *  - Physical dock receiving bottleneck: arrivals enter `at_dock` and can only be put away up to
 *     BOTH warehouse `receivingUnitsPerDay` AND available zone cubic volume (`capacityM3`).
 *    Excess sits at the dock incurring daily demurrage.
 *  - Automated reorder policies: EOQ, Min-Max, and JIT vs. JIC safety-stock strategies.
 */
import type {
  Cents,
  FreightLane,
  PurchaseOrder,
  ReorderPolicy,
  Supplier,
  SupplierOffer,
  WorldState,
} from "../schema";
import { debitBalance, payOrQueuePayable, postJournal } from "./ledger";
import { applyModifiers, nextId, pushNotification } from "./modifiers";
import { clamp, type SeededRng } from "./rng";
import {
  addInventoryLot,
  availableZoneVolumeM3,
  effectiveWarehouseThroughput,
  getItem,
  getWarehouse,
  inventoryAccountForItem,
  onHandQty,
} from "./warehouse";

export function getSupplier(state: WorldState, supplierId: string): Supplier {
  const s = state.supply.suppliers.find((x) => x.id === supplierId);
  if (!s) throw new Error(`Unknown supplier: ${supplierId}`);
  return s;
}

export function getLane(state: WorldState, laneId: string): FreightLane {
  const l = state.supply.lanes.find((x) => x.id === laneId);
  if (!l) throw new Error(`Unknown freight lane: ${laneId}`);
  return l;
}

/** Resolve unit price from supplier offer price breaks + macro material index + modifiers. */
export function resolveSupplierUnitPrice(
  state: WorldState,
  supplier: Supplier,
  offer: SupplierOffer,
  qty: number,
): Cents {
  let base = offer.unitPrice;
  for (const brk of offer.priceBreaks) {
    if (qty >= brk.minQty && brk.unitPrice < base) {
      base = brk.unitPrice;
    }
  }
  const macroScaled = base * state.market.macro.materialPriceIndex;
  const supMod = applyModifiers(state, "supplier.price", macroScaled, supplier.id);
  const itemMod = applyModifiers(state, "material.price", supMod, offer.itemId);
  return Math.max(1, Math.round(itemMod));
}

export function computeInboundFreightCost(
  state: WorldState,
  lane: FreightLane,
  itemId: string,
  qty: number,
): Cents {
  const item = getItem(state, itemId);
  const totalM3 = qty * item.unitVolumeM3;
  const raw = lane.fixedCostPerShipment + totalM3 * lane.costPerM3;
  const modified = applyModifiers(state, "lane.cost", raw, lane.id);
  return Math.max(0, Math.round(modified));
}

/**
 * Place a Purchase Order (either manually by player/agent or via automated reorder policy).
 * Enforces MOQ, supplier credit hold, and Cash-in-Advance (CIA) prepayment.
 */
export function placePurchaseOrder(
  state: WorldState,
  rng: SeededRng,
  opts: {
    supplierId: string;
    itemId: string;
    warehouseId: string;
    laneId: string;
    qty: number;
    auto: boolean;
  },
): { ok: boolean; error?: string; po?: PurchaseOrder } {
  const supplier = state.supply.suppliers.find((s) => s.id === opts.supplierId);
  if (!supplier) return { ok: false, error: `Unknown supplier ${opts.supplierId}` };
  if (supplier.creditHold) {
    return { ok: false, error: `Supplier ${supplier.name} has placed account on credit hold` };
  }

  const offer = supplier.offers.find((o) => o.itemId === opts.itemId);
  if (!offer) {
    return { ok: false, error: `Supplier ${supplier.name} does not supply item ${opts.itemId}` };
  }

  const lane = state.supply.lanes.find((l) => l.id === opts.laneId);
  if (!lane) return { ok: false, error: `Unknown freight lane ${opts.laneId}` };

  const wh = state.warehouses.sites.find((w) => w.id === opts.warehouseId);
  if (!wh) return { ok: false, error: `Unknown warehouse ${opts.warehouseId}` };

  const qty = Math.max(offer.moq, Math.ceil(opts.qty));
  const unitPrice = resolveSupplierUnitPrice(state, supplier, offer, qty);
  const freightCost = computeInboundFreightCost(state, lane, opts.itemId, qty);
  const goodsTotal = Math.round(qty * unitPrice);

  // If Cash-In-Advance (CIA), require immediate cash
  let prepaid: Cents = 0;
  if (supplier.terms.kind === "cia") {
    const cash = debitBalance(state.finance.ledger, "cash");
    if (cash < goodsTotal) {
      return {
        ok: false,
        error: `Insufficient cash ($${(cash / 100).toFixed(0)}) for CIA order ($${(goodsTotal / 100).toFixed(0)}) with ${supplier.name}`,
      };
    }
    postJournal(state, {
      memo: `Prepaid CIA purchase order to ${supplier.name}`,
      source: "supply:cia",
      cashFlow: "operating",
      lines: [
        { account: "prepaid", amount: goodsTotal },
        { account: "cash", amount: -goodsTotal },
      ],
    });
    prepaid = goodsTotal;
    state.telemetry.mtd.purchases += goodsTotal;
  }

  // Sample supplier production lead time + freight transit time + stochastic delays
  const baseLead = Math.max(1, Math.round(rng.sample(supplier.leadTimeDays)));
  const effReliability = clamp(
    applyModifiers(state, "supplier.reliability", supplier.reliability, supplier.id),
    0.1,
    1,
  );
  const supplierDelay = rng.chance(1 - effReliability) ? rng.int(2, 7) : 0;
  const effLead = Math.max(
    1,
    Math.round(applyModifiers(state, "supplier.leadTime", baseLead + supplierDelay, supplier.id)),
  );

  const baseTransit = Math.max(0, Math.round(rng.sample(lane.transitDays)));
  const laneDelay = rng.chance(lane.delayProb) ? Math.max(1, Math.round(rng.sample(lane.delayDays))) : 0;
  const effTransit = Math.max(
    0,
    Math.round(applyModifiers(state, "lane.transitDays", baseTransit + laneDelay, lane.id)),
  );

  const tick = state.calendar.tick;
  const shipTick = tick + effLead;
  const etaTick = shipTick + effTransit;

  const po: PurchaseOrder = {
    id: nextId(state, "po"),
    supplierId: supplier.id,
    itemId: opts.itemId,
    warehouseId: wh.id,
    laneId: lane.id,
    qty,
    unitPrice,
    freightCost,
    placedTick: tick,
    shipTick,
    etaTick,
    status: effLead === 0 ? "in_transit" : "placed",
    receivedQty: 0,
    damagedQty: 0,
    prepaid,
    auto: opts.auto,
  };

  state.supply.purchaseOrders.push(po);
  return { ok: true, po };
}

/** Total pipeline quantity on open purchase orders for `(itemId, warehouseId)`. */
export function onOrderQty(state: WorldState, itemId: string, warehouseId?: string): number {
  let q = 0;
  for (const po of state.supply.purchaseOrders) {
    if (po.itemId !== itemId) continue;
    if (warehouseId && po.warehouseId !== warehouseId) continue;
    if (po.status === "received" || po.status === "cancelled") continue;
    q += Math.max(0, po.qty - po.receivedQty - po.damagedQty);
  }
  return q;
}

/**
 * Daily inbound supply chain & dock receiving tick:
 *  1. Advance `placed` POs to `in_transit` on `shipTick`, and `in_transit` to `at_dock` on `etaTick`
 *     (applying transit damage on arrival).
 *  2. Receive `at_dock` POs into warehouse lots subject to receiving throughput AND zone volume limits.
 *     Capitalizes landed cost (goods + inbound freight + 3PL receiving fee) into inventory.
 *  3. Charge demurrage on any units left sitting at the dock.
 *  4. Evaluate automated reorder policies (EOQ / Min-Max / JIT / JIC).
 */
export function runSupplyChainTick(state: WorldState, rng: SeededRng): { purchasesBookedToday: Cents } {
  const tick = state.calendar.tick;
  let purchasesBookedToday: Cents = 0;

  // 1. Advance PO lifecycle states
  for (const po of state.supply.purchaseOrders) {
    if (po.status === "placed" && tick >= po.shipTick) {
      po.status = "in_transit";
    }
    if (po.status === "in_transit" && tick >= po.etaTick) {
      const lane = getLane(state, po.laneId);
      const damageRate = clamp(lane.damageRate, 0, 0.5);
      const damaged = damageRate > 0 ? Math.floor(po.qty * damageRate * rng.next() * 2) : 0;
      po.damagedQty = Math.min(po.qty, damaged);
      po.status = "at_dock";

      // If damaged goods were prepaid (CIA), write off damaged portion immediately
      if (po.damagedQty > 0 && po.prepaid > 0) {
        const writeOff = Math.min(po.prepaid, Math.round((po.prepaid * po.damagedQty) / po.qty));
        if (writeOff > 0) {
          po.prepaid -= writeOff;
          postJournal(state, {
            memo: `Transit damage write-off on prepaid PO ${po.id}`,
            source: "supply:damage",
            lines: [
              { account: "cogs_spoilage_shrink", amount: writeOff },
              { account: "prepaid", amount: -writeOff },
            ],
          });
        }
      }
    }
  }

  // 2. Receive `at_dock` POs per warehouse subject to receiving capacity & zone volume
  for (const wh of state.warehouses.sites) {
    let remainingRecUnits = effectiveWarehouseThroughput(state, wh, "receiving");
    const dockPos = state.supply.purchaseOrders
      .filter((p) => p.warehouseId === wh.id && p.status === "at_dock")
      .sort((a, b) => a.etaTick - b.etaTick);

    let dockBacklogUnits = 0;
    let demurrageM3 = 0;

    for (const po of dockPos) {
      const item = getItem(state, po.itemId);
      const supplier = getSupplier(state, po.supplierId);
      const lane = getLane(state, po.laneId);
      const remainingToReceive = Math.max(0, po.qty - po.damagedQty - po.receivedQty);
      if (remainingToReceive <= 1e-6) {
        po.status = "received";
        continue;
      }

      const freeM3 = availableZoneVolumeM3(state, wh.id, item.handling);
      const maxByVolume =
        item.unitVolumeM3 > 0 ? Math.floor(freeM3 / item.unitVolumeM3) : remainingToReceive;
      const canReceive = Math.max(
        0,
        Math.min(remainingToReceive, Math.floor(remainingRecUnits), maxByVolume),
      );

      if (canReceive > 0) {
        const wasFirstReceipt = po.receivedQty === 0;
        po.receivedQty += canReceive;
        remainingRecUnits = Math.max(0, remainingRecUnits - canReceive);

        // Consume warehouse labor hours if applicable
        if (wh.laborRoleId && wh.unitsPerLaborHour > 0) {
          const pos = state.org.positions.find((p) => p.roleId === wh.laborRoleId);
          if (pos) pos.laborHoursUsed += canReceive / wh.unitsPerLaborHour;
        }

        const goodsCost = Math.round(canReceive * po.unitPrice);
        // Capitalize inbound freight on first receipt tranche
        const freightCap = wasFirstReceipt ? po.freightCost : 0;
        const threePlFee =
          wh.mode === "3pl" && wh.threePl
            ? Math.round(canReceive * wh.threePl.handlingFeePerUnit)
            : 0;
        const capitalizedValue = goodsCost + freightCap + threePlFee;
        const invAccount = inventoryAccountForItem(item);

        // Book goods liability or release CIA prepayment
        if (goodsCost > 0) {
          if (po.prepaid > 0) {
            const releasePrepaid = Math.min(po.prepaid, goodsCost);
            const residualAp = goodsCost - releasePrepaid;
            po.prepaid -= releasePrepaid;
            const lines: { account: typeof invAccount | "prepaid" | "accounts_payable"; amount: Cents }[] =
              [{ account: invAccount, amount: goodsCost }];
            if (releasePrepaid > 0) lines.push({ account: "prepaid", amount: -releasePrepaid });
            if (residualAp > 0) lines.push({ account: "accounts_payable", amount: -residualAp });
            postJournal(state, {
              memo: `Received ${canReceive} ${item.name} on prepaid PO ${po.id}`,
              source: "supply:receive",
              lines,
            });
          } else {
            const dueDays = supplier.terms.kind === "cod" ? 0 : supplier.terms.days;
            const { paidCash, queuedAp } = payOrQueuePayable(state, {
              debitAccount: invAccount,
              amount: goodsCost,
              memo: `Received ${canReceive} ${item.name} from ${supplier.name} (${po.id})`,
              source: "supply:receive",
              counterparty: supplier.name,
              kind: "supplier",
              dueOffsetDays: dueDays,
              supplierId: supplier.id,
              priority: 2,
            });
            purchasesBookedToday += paidCash + queuedAp;
            state.telemetry.mtd.purchases += paidCash + queuedAp;
          }
        }

        if (freightCap > 0) {
          payOrQueuePayable(state, {
            debitAccount: invAccount,
            amount: freightCap,
            memo: `Inbound freight (${lane.name}) capitalized on ${po.id}`,
            source: "supply:freight_in",
            counterparty: `${lane.name} Carrier`,
            kind: "freight",
            dueOffsetDays: 7,
            priority: 3,
          });
        }

        if (threePlFee > 0) {
          payOrQueuePayable(state, {
            debitAccount: invAccount,
            amount: threePlFee,
            memo: `3PL receiving handling — ${wh.name}`,
            source: "supply:3pl_in",
            counterparty: wh.name,
            kind: "3pl",
            dueOffsetDays: 15,
            priority: 3,
          });
        }

        addInventoryLot(state, {
          itemId: item.id,
          warehouseId: wh.id,
          qty: canReceive,
          value: capitalizedValue,
        });
      }

      const stillAtDock = Math.max(0, po.qty - po.damagedQty - po.receivedQty);
      if (stillAtDock <= 1e-6) {
        po.status = "received";
        // Release any leftover rounding prepaid
        if (po.prepaid > 0) {
          const leftover = po.prepaid;
          po.prepaid = 0;
          postJournal(state, {
            memo: `Close residual prepaid on ${po.id}`,
            source: "supply:receive",
            lines: [
              { account: inventoryAccountForItem(item), amount: leftover },
              { account: "prepaid", amount: -leftover },
            ],
          });
        }
      } else {
        dockBacklogUnits += stillAtDock;
        demurrageM3 += stillAtDock * item.unitVolumeM3;
      }
    }

    wh.telemetry.receivingBacklogUnits = dockBacklogUnits;

    if (demurrageM3 > 0 && wh.demurragePerM3Day > 0) {
      const demurrage = Math.round(demurrageM3 * wh.demurragePerM3Day);
      if (demurrage > 0) {
        payOrQueuePayable(state, {
          debitAccount: "opex_warehousing",
          amount: demurrage,
          memo: `Dock demurrage (${Math.round(dockBacklogUnits)} units blocked) — ${wh.name}`,
          source: "warehouse:demurrage",
          counterparty: "Freight Carrier Demurrage",
          kind: "freight",
          dueOffsetDays: 0,
          priority: 3,
        });
      }
    }
  }

  // Prune old completed POs to keep state compact
  if (state.supply.purchaseOrders.length > 250) {
    state.supply.purchaseOrders = state.supply.purchaseOrders.filter(
      (p) => p.status !== "received" && p.status !== "cancelled" || tick - p.etaTick <= 30,
    );
  }

  // 4. Automated reorder policies
  for (const pol of state.supply.reorderPolicies) {
    if (pol.mode === "manual") continue;
    const lastRev = pol.lastReviewTick ?? -999;
    if (tick - lastRev < pol.reviewPeriodDays) continue;
    pol.lastReviewTick = tick;

    evaluateReorderPolicy(state, rng, pol);
  }

  return { purchasesBookedToday };
}

function evaluateReorderPolicy(state: WorldState, rng: SeededRng, pol: ReorderPolicy): void {
  const supplier = state.supply.suppliers.find((s) => s.id === pol.supplierId);
  const lane = state.supply.lanes.find((l) => l.id === pol.laneId);
  const wh = state.warehouses.sites.find((w) => w.id === pol.warehouseId);
  if (!supplier || !lane || !wh || supplier.creditHold) return;
  const offer = supplier.offers.find((o) => o.itemId === pol.itemId);
  if (!offer) return;

  const key = `${pol.warehouseId}:${pol.itemId}`;
  const stat = state.supply.usageStats[key] ?? { ema: 5, varEma: 1 };
  const dailyDemand = Math.max(0.5, stat.ema);
  const dailySd = Math.sqrt(Math.max(0, stat.varEma));

  const meanLeadDays = Math.max(
    1,
    expectedDistributionMean(supplier.leadTimeDays) + expectedDistributionMean(lane.transitDays),
  );

  const strategyMultiplier = pol.strategy === "jit" ? 0.35 : 1.0;
  const safetyStock =
    (pol.safetyStockDays * dailyDemand +
      pol.serviceLevelZ * dailySd * Math.sqrt(meanLeadDays)) *
    strategyMultiplier;

  const reorderPoint = dailyDemand * meanLeadDays + safetyStock;
  const inventoryPosition =
    onHandQty(state, pol.itemId, pol.warehouseId) +
    onOrderQty(state, pol.itemId, pol.warehouseId);

  if (inventoryPosition > reorderPoint) return;

  let orderQty = 0;
  if (pol.mode === "eoq") {
    // Wilson EOQ: sqrt(2 * D_annual * S / H_annual)
    const annualDemand = dailyDemand * 360;
    const orderSetupCost = Math.max(50_00, lane.fixedCostPerShipment + 150_00);
    const unitCost = Math.max(10, offer.unitPrice);
    const holdingRateAnnual = Math.max(0.12, wh.insuranceRateAnnual + wh.shrinkageRateAnnual + 0.15);
    const hAnnual = unitCost * holdingRateAnnual;
    const eoq = Math.sqrt((2 * annualDemand * orderSetupCost) / Math.max(1, hAnnual));
    orderQty = Math.max(eoq, reorderPoint + dailyDemand * pol.reviewPeriodDays - inventoryPosition);
  } else if (pol.mode === "min_max") {
    const maxTarget = pol.maxStockUnits ?? reorderPoint + dailyDemand * 14;
    orderQty = Math.max(0, maxTarget - inventoryPosition);
  } else if (pol.mode === "jit") {
    orderQty = Math.max(0, dailyDemand * (meanLeadDays + 2) + safetyStock - inventoryPosition);
  }

  // Cap order so we don't exceed total zone volume or perishable shelf life
  const item = getItem(state, pol.itemId);
  const zone = wh.zones.find((z) => z.handling === item.handling);
  let maxAllowedByZone = Number.POSITIVE_INFINITY;
  if (zone && item.unitVolumeM3 > 0) {
    const maxZoneUnits = Math.floor((zone.capacityM3 * 0.85) / item.unitVolumeM3);
    maxAllowedByZone = Math.max(0, maxZoneUnits - inventoryPosition);
  }
  if (item.shelfLifeDays) {
    const maxPerishableCover = dailyDemand * Math.max(4, item.shelfLifeDays * 0.7);
    orderQty = Math.min(orderQty, maxPerishableCover);
  }
  orderQty = Math.min(orderQty, Math.max(offer.moq, dailyDemand * 30), maxAllowedByZone);

  if (orderQty > 0 && maxAllowedByZone >= offer.moq * 0.5) {
    const res = placePurchaseOrder(state, rng, {
      supplierId: pol.supplierId,
      itemId: pol.itemId,
      warehouseId: pol.warehouseId,
      laneId: pol.laneId,
      qty: Math.max(offer.moq, Math.ceil(orderQty)),
      auto: true,
    });
    if (!res.ok && res.error) {
      pushNotification(state, "warning", "supply", `Auto-reorder skipped: ${res.error}`);
    }
  }
}

export function expectedDistributionMean(d: Supplier["leadTimeDays"]): number {
  switch (d.kind) {
    case "fixed":
      return d.value;
    case "normal":
      return d.mean;
    case "triangular":
      return (d.min + d.mode + d.max) / 3;
  }
}
