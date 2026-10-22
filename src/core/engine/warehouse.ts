/**
 * Sub-Engine 4.2b: Warehouse Physics & Valued Inventory Lot Management (FEFO/FIFO).
 *
 * Enforces:
 *  - Zone cubic volume constraints by HandlingClass (`ambient`, `chilled`, `frozen`, `hazmat`, `oversize`).
 *  - FEFO (First-Expired, First-Out) then FIFO lot consumption with exact integer-cent proportional cost release.
 *  - Perishable shelf-life expiration, annual shrinkage, and annual obsolescence write-offs.
 *  - Daily warehouse rent, insurance, and 3PL storage fees.
 */
import type { AccountCode, Cents, HandlingClass, Item, Warehouse, WorldState } from "../schema";
import { payOrQueuePayable, postJournal } from "./ledger";
import { applyModifiers, nextId, pushNotification } from "./modifiers";
import { clamp, ema } from "./rng";

export function inventoryAccountForItem(item: Item): "inventory_raw" | "inventory_finished" {
  return item.kind === "finished" ? "inventory_finished" : "inventory_raw";
}

export function getItem(state: WorldState, itemId: string): Item {
  const it = state.catalog.items.find((i) => i.id === itemId);
  if (!it) throw new Error(`Unknown item: ${itemId}`);
  return it;
}

export function getWarehouse(state: WorldState, warehouseId: string): Warehouse {
  const wh = state.warehouses.sites.find((w) => w.id === warehouseId);
  if (!wh) throw new Error(`Unknown warehouse: ${warehouseId}`);
  return wh;
}

/** Total on-hand quantity for `(itemId, warehouseId)` (or across all warehouses if `warehouseId` omitted). */
export function onHandQty(state: WorldState, itemId: string, warehouseId?: string): number {
  let qty = 0;
  for (const lot of state.warehouses.lots) {
    if (lot.itemId !== itemId) continue;
    if (warehouseId && lot.warehouseId !== warehouseId) continue;
    qty += lot.qty;
  }
  return qty;
}

/** Total capitalized value (cents) for `(itemId, warehouseId)`. */
export function onHandValue(state: WorldState, itemId: string, warehouseId?: string): Cents {
  let val = 0;
  for (const lot of state.warehouses.lots) {
    if (lot.itemId !== itemId) continue;
    if (warehouseId && lot.warehouseId !== warehouseId) continue;
    val += lot.value;
  }
  return val;
}

/** Weighted-average unit cost in cents for an item (falls back to `standardCost` if out of stock). */
export function unitBookCost(state: WorldState, itemId: string, warehouseId?: string): Cents {
  const qty = onHandQty(state, itemId, warehouseId);
  const val = onHandValue(state, itemId, warehouseId);
  if (qty > 0) return Math.round(val / qty);
  const item = getItem(state, itemId);
  return item.standardCost ?? 100;
}

/** Cubic meters currently occupied in a warehouse for a specific handling class. */
export function usedVolumeM3(
  state: WorldState,
  warehouseId: string,
  handling?: HandlingClass,
): number {
  let vol = 0;
  for (const lot of state.warehouses.lots) {
    if (lot.warehouseId !== warehouseId || lot.qty <= 0) continue;
    const item = getItem(state, lot.itemId);
    if (handling && item.handling !== handling) continue;
    vol += lot.qty * item.unitVolumeM3;
  }
  return vol;
}

/** Available free cubic meters in a warehouse's zone for `handling`. */
export function availableZoneVolumeM3(
  state: WorldState,
  warehouseId: string,
  handling: HandlingClass,
): number {
  const wh = getWarehouse(state, warehouseId);
  const zone = wh.zones.find((z) => z.handling === handling);
  if (!zone) return 0;
  return Math.max(0, zone.capacityM3 - usedVolumeM3(state, warehouseId, handling));
}

/** Effective daily receiving or pick-pack throughput (units/day), factoring automation, labor, and modifiers. */
export function effectiveWarehouseThroughput(
  state: WorldState,
  wh: Warehouse,
  kind: "receiving" | "pick",
): number {
  const base = kind === "receiving" ? wh.receivingUnitsPerDay : wh.pickPackUnitsPerDay;
  const target =
    kind === "receiving" ? "warehouse.receivingCapacity" : "warehouse.pickCapacity";
  const withAutomation = base * (1 + wh.automationLevel * 0.85);
  const modified = applyModifiers(state, target, withAutomation, wh.id);

  if (wh.mode === "3pl" || !wh.laborRoleId) return Math.max(0, modified);

  const pos = state.org.positions.find((p) => p.roleId === wh.laborRoleId);
  if (!pos || pos.laborHoursAvailable <= 0) {
    return Math.max(0, modified * 0.35);
  }
  const poolHours =
    kind === "receiving"
      ? Math.max(0, pos.laborHoursAvailable * 0.65 - pos.laborHoursUsed)
      : Math.max(0, pos.laborHoursAvailable - pos.laborHoursUsed);
  const unitRate =
    kind === "receiving" ? wh.unitsPerLaborHour * 2.5 : wh.unitsPerLaborHour;
  const laborLimitedUnits = poolHours * unitRate * (1 + wh.automationLevel);
  return Math.max(0, Math.min(modified, laborLimitedUnits));
}

/** Add a valued inventory lot (caller is responsible for posting the corresponding GL journal). */
export function addInventoryLot(
  state: WorldState,
  opts: {
    itemId: string;
    warehouseId: string;
    qty: number;
    value: Cents;
  },
): void {
  if (opts.qty <= 0) return;
  const item = getItem(state, opts.itemId);
  const tick = state.calendar.tick;
  state.warehouses.lots.push({
    id: nextId(state, "lot"),
    itemId: opts.itemId,
    warehouseId: opts.warehouseId,
    qty: opts.qty,
    value: Math.max(0, Math.round(opts.value)),
    receivedTick: tick,
    expiryTick: item.shelfLifeDays ? tick + item.shelfLifeDays : undefined,
  });
}

/**
 * Consume up to `requestedQty` from `(itemId, warehouseId)` in FEFO/FIFO order.
 * Releases exact integer cents so when a lot's `qty` hits 0 its `value` also hits 0.
 * Also updates the daily usage EMA for automated reorder policies.
 */
export function consumeInventoryFefo(
  state: WorldState,
  opts: {
    itemId: string;
    warehouseId: string;
    qty: number;
    recordUsage?: boolean;
  },
): { consumedQty: number; releasedValue: Cents } {
  let remaining = opts.qty;
  if (remaining <= 0) return { consumedQty: 0, releasedValue: 0 };

  const candidates = state.warehouses.lots
    .filter((l) => l.itemId === opts.itemId && l.warehouseId === opts.warehouseId && l.qty > 0)
    .sort((a, b) => {
      const ea = a.expiryTick ?? Number.MAX_SAFE_INTEGER;
      const eb = b.expiryTick ?? Number.MAX_SAFE_INTEGER;
      if (ea !== eb) return ea - eb;
      return a.receivedTick - b.receivedTick;
    });

  let consumedQty = 0;
  let releasedValue = 0;

  for (const lot of candidates) {
    if (remaining <= 1e-9) break;
    if (lot.qty <= remaining + 1e-9) {
      consumedQty += lot.qty;
      releasedValue += lot.value;
      remaining -= lot.qty;
      lot.qty = 0;
      lot.value = 0;
    } else {
      const take = remaining;
      const valTake = Math.min(lot.value, Math.round((lot.value * take) / lot.qty));
      lot.qty -= take;
      lot.value -= valTake;
      consumedQty += take;
      releasedValue += valTake;
      remaining = 0;
    }
  }

  state.warehouses.lots = state.warehouses.lots.filter((l) => l.qty > 1e-6);

  if (opts.recordUsage !== false && consumedQty > 0) {
    recordItemUsage(state, opts.warehouseId, opts.itemId, consumedQty);
  }

  return { consumedQty, releasedValue };
}

export function recordItemUsage(
  state: WorldState,
  warehouseId: string,
  itemId: string,
  usedToday: number,
): void {
  const key = `${warehouseId}:${itemId}`;
  const prev = state.supply.usageStats[key] ?? { ema: usedToday, varEma: 0 };
  const diff = usedToday - prev.ema;
  const nextEma = ema(prev.ema, usedToday, 0.15);
  const nextVar = ema(prev.varEma, diff * diff, 0.15);
  state.supply.usageStats[key] = { ema: nextEma, varEma: nextVar };
}

/**
 * Daily warehouse holding physics:
 *  1. Perishable lots past `expiryTick` are written off to `cogs_spoilage_shrink`.
 *  2. Daily shrinkage + obsolescence erode lot quantities and values.
 *  3. Daily rent, insurance, and 3PL storage charges are booked.
 *  4. Cubic utilization telemetry is updated per warehouse.
 */
export function runWarehouseHoldingTick(state: WorldState): void {
  const tick = state.calendar.tick;

  // 1. Expiration & 2. Shrinkage / Obsolescence
  let rawWriteOff: Cents = 0;
  let finWriteOff: Cents = 0;
  let expiredUnits = 0;

  for (const lot of state.warehouses.lots) {
    if (lot.qty <= 0) continue;
    const item = getItem(state, lot.itemId);
    const wh = getWarehouse(state, lot.warehouseId);

    if (lot.expiryTick !== undefined && tick >= lot.expiryTick) {
      if (item.kind === "finished") finWriteOff += lot.value;
      else rawWriteOff += lot.value;
      expiredUnits += lot.qty;
      lot.qty = 0;
      lot.value = 0;
      continue;
    }

    const dailyLossRate =
      (wh.shrinkageRateAnnual + item.obsolescenceAnnual) / 360;
    if (dailyLossRate > 0 && lot.qty > 1) {
      const lostQty = lot.qty * dailyLossRate;
      const lostVal = Math.min(lot.value, Math.floor(lot.value * dailyLossRate));
      if (lostVal > 0 && lostQty < lot.qty) {
        lot.qty -= lostQty;
        lot.value -= lostVal;
        if (item.kind === "finished") finWriteOff += lostVal;
        else rawWriteOff += lostVal;
      }
    }
  }

  state.warehouses.lots = state.warehouses.lots.filter((l) => l.qty > 1e-6);

  if (rawWriteOff + finWriteOff > 0) {
    const lines: { account: AccountCode; amount: Cents }[] = [
      { account: "cogs_spoilage_shrink", amount: rawWriteOff + finWriteOff },
    ];
    if (rawWriteOff > 0) lines.push({ account: "inventory_raw", amount: -rawWriteOff });
    if (finWriteOff > 0) lines.push({ account: "inventory_finished", amount: -finWriteOff });
    postJournal(state, {
      memo:
        expiredUnits > 0
          ? `Spoilage (${Math.round(expiredUnits)} expired units) & shrinkage`
          : "Daily inventory shrinkage & obsolescence",
      source: "warehouse:spoilage",
      lines,
    });
    if (expiredUnits >= 10) {
      pushNotification(
        state,
        "warning",
        "warehouse",
        `${Math.round(expiredUnits)} perishable units expired in storage ($${((rawWriteOff + finWriteOff) / 100).toFixed(0)} write-off).`,
      );
    }
  }

  // 3. Rent, insurance, 3PL storage & 4. Utilization telemetry
  for (const wh of state.warehouses.sites) {
    const totalCapM3 = wh.zones.reduce((s, z) => s + z.capacityM3, 0);
    const usedM3 = usedVolumeM3(state, wh.id);
    wh.telemetry.utilization = totalCapM3 > 0 ? clamp(usedM3 / totalCapM3, 0, 2) : 0;

    if (wh.rentPerDay > 0) {
      payOrQueuePayable(state, {
        debitAccount: "opex_rent",
        amount: wh.rentPerDay,
        memo: `Facility rent — ${wh.name}`,
        source: "warehouse:rent",
        counterparty: `${wh.name} Landlord`,
        kind: "landlord",
        dueOffsetDays: 0,
        priority: 2,
      });
    }

    const whInvValue = state.warehouses.lots
      .filter((l) => l.warehouseId === wh.id)
      .reduce((s, l) => s + l.value, 0);
    const dailyInsurance = Math.round((whInvValue * wh.insuranceRateAnnual) / 360);
    if (dailyInsurance > 0) {
      payOrQueuePayable(state, {
        debitAccount: "opex_warehousing",
        amount: dailyInsurance,
        memo: `Inventory insurance — ${wh.name}`,
        source: "warehouse:insurance",
        counterparty: "Commercial Insurer",
        kind: "insurance",
        dueOffsetDays: 15,
        priority: 4,
      });
    }

    if (wh.mode === "3pl" && wh.threePl) {
      const storageFee = Math.round(usedM3 * wh.threePl.storagePerM3Day);
      if (storageFee > 0) {
        payOrQueuePayable(state, {
          debitAccount: "opex_warehousing",
          amount: storageFee,
          memo: `3PL storage — ${wh.name}`,
          source: "warehouse:3pl",
          counterparty: wh.name,
          kind: "3pl",
          dueOffsetDays: 15,
          priority: 3,
        });
      }
    }
  }
}
