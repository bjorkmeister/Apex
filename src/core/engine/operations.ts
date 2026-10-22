/**
 * Sub-Engine 4.1: Operations, Production, Capabilities & Queuing Physics (Little's Law).
 *
 * Enforces:
 *  - L1/L2/L3 Capability maturity dynamics: daily investment vs. maintenance spend, entropy decay,
 *    and operational friction (unit cost multiplier, cycle-time penalty, defect-rate penalty) when
 *    `maturity < requiredMaturity`.
 *  - Make-vs-Buy sourcing on both Capabilities and Work Centers.
 *  - Little's Law ($L = \lambda W$) & Kingman's congestion curve: when work-center utilization $\rho > 0.85$,
 *    wait times ($W$), equipment wear, and defect rates rise non-linearly.
 *  - Full WIP accounting: raw materials consumed -> `inventory_wip`, variable overhead capitalized,
 *    completed good units -> `inventory_finished` (or non-storable `serviceCapacityToday` for service items),
 *    scrapped defects -> `cogs_spoilage_shrink`.
 */
import type { Capability, Cents, Recipe, WorkCenter, WorldState } from "../schema";
import { payOrQueuePayable, postJournal } from "./ledger";
import { applyModifiers, nextId, pushNotification } from "./modifiers";
import { clamp, ema, type SeededRng } from "./rng";
import { onOrderQty } from "./supply";
import {
  addInventoryLot,
  availableZoneVolumeM3,
  consumeInventoryFefo,
  getItem,
  inventoryAccountForItem,
  onHandQty,
} from "./warehouse";

export function getCapability(state: WorldState, capabilityId?: string): Capability | undefined {
  if (!capabilityId) return undefined;
  return state.operations.capabilities.find((c) => c.id === capabilityId);
}

/**
 * Operational friction from capability maturity gap (`requiredMaturity - effectiveMaturity`).
 * Returns multipliers for cost (>= 0.88), speed/throughput (<= 1.15), and added defect rate (>= 0).
 */
export function capabilityFriction(
  state: WorldState,
  capabilityId?: string,
): { costMultiplier: number; throughputMultiplier: number; extraDefectRate: number } {
  const cap = getCapability(state, capabilityId);
  if (!cap) return { costMultiplier: 1, throughputMultiplier: 1, extraDefectRate: 0 };

  const effMaturity =
    cap.sourcing === "outsourced" && cap.vendor ? cap.vendor.maturity : cap.maturity;
  const gap = Math.max(0, cap.requiredMaturity - effMaturity);
  const surplus = Math.max(0, effMaturity - cap.requiredMaturity);

  // Governance drift amplifies capability friction
  const driftPenalty = state.org.governance.drift * 0.2;

  const costMultiplier = clamp(1 + gap * 0.14 + driftPenalty - surplus * 0.04, 0.85, 2.2);
  const throughputMultiplier = clamp(1 - gap * 0.12 - driftPenalty * 0.5 + surplus * 0.05, 0.35, 1.2);
  const extraDefectRate = clamp(gap * 0.025 + driftPenalty * 0.05, 0, 0.35);

  return { costMultiplier, throughputMultiplier, extraDefectRate };
}

/** Update capability maturities & book capability investment / vendor fees. */
export function runCapabilitiesTick(state: WorldState): void {
  for (const cap of state.operations.capabilities) {
    if (cap.sourcing === "outsourced" && cap.vendor) {
      if (cap.vendor.feePerDay > 0) {
        payOrQueuePayable(state, {
          debitAccount: "opex_capability",
          amount: cap.vendor.feePerDay,
          memo: `Outsourced capability fee — ${cap.name} (${cap.vendor.name})`,
          source: "ops:capability",
          counterparty: cap.vendor.name,
          kind: "vendor",
          dueOffsetDays: 15,
          priority: 4,
        });
      }
      continue;
    }

    const spend = cap.dailyInvestment;
    if (spend > 0) {
      payOrQueuePayable(state, {
        debitAccount: "opex_capability",
        amount: spend,
        memo: `Capability investment — ${cap.name}`,
        source: "ops:capability",
        counterparty: "Internal Capability Program",
        kind: "other",
        dueOffsetDays: 0,
        priority: 5,
      });
    }

    if (spend >= cap.maintenanceSpendPerDay) {
      const netInvest = spend - cap.maintenanceSpendPerDay;
      const levelScale = Math.pow(1.6, Math.max(0, cap.maturity - 1));
      const gain = netInvest / Math.max(1, cap.costPerMaturityPoint * levelScale);
      cap.maturity = clamp(cap.maturity + gain, 1, 5);
    } else {
      const shortfallRatio =
        cap.maintenanceSpendPerDay > 0
          ? (cap.maintenanceSpendPerDay - spend) / cap.maintenanceSpendPerDay
          : 0;
      cap.maturity = clamp(cap.maturity - cap.decayPerDay * shortfallRatio, 1, 5);
    }
  }
}

/** Schedule a production order (manual or policy-driven). */
export function scheduleProductionOrder(
  state: WorldState,
  recipe: Recipe,
  batches: number,
): void {
  const totalBatches = Math.max(0, Math.round(batches));
  if (totalBatches <= 0) return;
  state.operations.orders.push({
    id: nextId(state, "prod"),
    recipeId: recipe.id,
    batches: totalBatches,
    status: "awaiting_materials",
    createdTick: state.calendar.tick,
    remainingMachineHours: recipe.machineHours * totalBatches,
    remainingLaborHours: recipe.laborHours * totalBatches,
    wipValue: 0,
  });
}

/**
 * Run daily production & queuing physics across all policies and work centers.
 */
export function runOperationsTick(state: WorldState, rng: SeededRng): void {
  const tick = state.calendar.tick;

  // Reset non-storable service capacity for today
  state.operations.serviceCapacityToday = {};

  // 1. Evaluate Make-to-Stock / Make-to-Order production policies
  for (const pol of state.operations.policies) {
    if (pol.mode === "manual") continue;
    const recipe = state.catalog.recipes.find((r) => r.id === pol.recipeId);
    if (!recipe) continue;
    const item = getItem(state, recipe.outputItemId);
    const wc = state.operations.workCenters.find((w) => w.id === recipe.workCenterId);
    if (!wc) continue;

    const openBatches = state.operations.orders
      .filter((o) => o.recipeId === recipe.id)
      .reduce((s, o) => s + o.batches, 0);
    const wipUnits = openBatches * recipe.outputQty;

    const backlogUnits = state.commercial.backlog
      .filter((b) => b.itemId === item.id)
      .reduce((s, b) => s + Math.max(0, b.qty - b.shippedQty), 0);

    let neededUnits = 0;
    if (item.kind === "service") {
      // Service recipes produce daily capacity to cover target + unshipped backlog
      neededUnits = Math.max(
        0,
        pol.targetStockUnits + Math.min(backlogUnits, pol.targetStockUnits) - wipUnits,
      );
    } else if (pol.mode === "make_to_stock") {
      const onHand = onHandQty(state, item.id, wc.warehouseId);
      neededUnits = Math.max(
        0,
        pol.targetStockUnits + Math.min(backlogUnits, pol.targetStockUnits) - (onHand + wipUnits),
      );
    } else if (pol.mode === "make_to_order") {
      const onHand = onHandQty(state, item.id, wc.warehouseId);
      neededUnits = Math.max(0, backlogUnits - (onHand + wipUnits));
    }

    if (neededUnits > 0) {
      const maxOpenCap = Math.max(0, pol.maxBatchesPerDay * 2 - openBatches);
      const batches = Math.min(
        pol.maxBatchesPerDay,
        maxOpenCap,
        Math.ceil(neededUnits / recipe.outputQty),
      );
      if (batches > 0) {
        scheduleProductionOrder(state, recipe, batches);
      }
    }
  }

  // 2. Process each Work Center
  for (const wc of state.operations.workCenters) {
    processWorkCenter(state, rng, wc, tick);
  }
}

function processWorkCenter(
  state: WorldState,
  rng: SeededRng,
  wc: WorkCenter,
  tick: number,
): void {
  const friction = capabilityFriction(state, wc.capabilityId);

  // Daily preventive maintenance spend & condition restoration
  if (wc.sourcing === "insourced" && wc.maintenanceCostPerDay > 0) {
    payOrQueuePayable(state, {
      debitAccount: "opex_maintenance",
      amount: wc.maintenanceCostPerDay,
      memo: `Work-center maintenance — ${wc.name}`,
      source: "ops:maintenance",
      counterparty: "Industrial Maintenance Services",
      kind: "maintenance",
      dueOffsetDays: 7,
      priority: 4,
    });
    wc.condition = clamp(wc.condition + wc.maintenanceRestorePerDay, 0.2, 1);
  }

  // Push scheduled overtime into the assigned labor role position state
  // If the assigned specialist/frontline role has 0 hired staff (Solo Entrepreneur mode), the founder (positions[0]) covers the work!
  const rawLaborPos = wc.laborRoleId
    ? state.org.positions.find((p) => p.roleId === wc.laborRoleId)
    : undefined;
  const rawHc = rawLaborPos ? rawLaborPos.cohorts.reduce((s, c) => s + c.count, 0) : 0;
  const laborPos = rawHc > 0 ? rawLaborPos : state.org.positions[0] ?? rawLaborPos;
  if (laborPos) {
    const headcount = laborPos.cohorts.reduce((s, c) => s + c.count, 0);
    laborPos.overtimeHoursPerPerson =
      headcount > 0 ? wc.overtimeHoursPerDay / headcount : 0;
  }

  const ordersForWc = state.operations.orders.filter((o) => {
    const r = state.catalog.recipes.find((x) => x.id === o.recipeId);
    return r?.workCenterId === wc.id;
  });

  let batchesReleasedToday = 0;

  // Step A: Release `awaiting_materials` orders when BOM inputs are on hand (supports partial batch release)
  for (const ord of ordersForWc) {
    if (ord.status !== "awaiting_materials") continue;
    const recipe = state.catalog.recipes.find((r) => r.id === ord.recipeId);
    if (!recipe) continue;

    // Determine how many integer batches we have BOM materials for right now
    let maxBatchesByMat = ord.batches;
    for (const inp of recipe.inputs) {
      const avail = onHandQty(state, inp.itemId, wc.warehouseId);
      const possible = inp.qty > 0 ? Math.floor((avail + 1e-6) / inp.qty) : ord.batches;
      if (possible < ord.batches) {
        const reqQty = inp.qty * ord.batches;
        const key = `${wc.warehouseId}:${inp.itemId}`;
        const prev = state.supply.usageStats[key] ?? { ema: reqQty, varEma: 0 };
        state.supply.usageStats[key] = {
          ema: Math.max(prev.ema, reqQty * 0.7),
          varEma: prev.varEma,
        };
      }
      maxBatchesByMat = Math.min(maxBatchesByMat, possible);
    }

    if (maxBatchesByMat <= 0) continue;

    // If only a subset of batches can start, split the remaining batches into a separate awaiting_materials order
    if (maxBatchesByMat < ord.batches) {
      const deferredBatches = ord.batches - maxBatchesByMat;
      ord.batches = maxBatchesByMat;
      state.operations.orders.push({
        id: nextId(state, "prod"),
        recipeId: recipe.id,
        batches: deferredBatches,
        status: "awaiting_materials",
        createdTick: ord.createdTick,
        remainingMachineHours: recipe.machineHours * deferredBatches,
        remainingLaborHours: recipe.laborHours * deferredBatches,
        wipValue: 0,
      });
    }

    // Consume BOM inputs (FEFO) and transfer value from `inventory_raw`/`inventory_finished` -> `inventory_wip`
    let rawReleased: Cents = 0;
    let finReleased: Cents = 0;
    for (const inp of recipe.inputs) {
      const item = getItem(state, inp.itemId);
      const { releasedValue } = consumeInventoryFefo(state, {
        itemId: inp.itemId,
        warehouseId: wc.warehouseId,
        qty: inp.qty * ord.batches,
      });
      if (item.kind === "finished") finReleased += releasedValue;
      else rawReleased += releasedValue;
    }

    const totalMatVal = rawReleased + finReleased;
    if (totalMatVal > 0) {
      const lines: {
        account: "inventory_wip" | "inventory_raw" | "inventory_finished";
        amount: Cents;
      }[] = [{ account: "inventory_wip", amount: totalMatVal }];
      if (rawReleased > 0) lines.push({ account: "inventory_raw", amount: -rawReleased });
      if (finReleased > 0) lines.push({ account: "inventory_finished", amount: -finReleased });
      postJournal(state, {
        memo: `Issue BOM materials to WIP for ${ord.id} (${recipe.name})`,
        source: "ops:wip_issue",
        lines,
      });
      ord.wipValue += totalMatVal;
    }

    ord.startedTick = tick;
    batchesReleasedToday += ord.batches;

    if (wc.sourcing === "outsourced" && wc.outsource) {
      ord.status = "at_vendor";
      ord.vendorDueTick = tick + Math.max(1, wc.outsource.leadDays);
    } else {
      ord.status = "in_progress";
      // Apply capability cycle-time penalty to required hours
      ord.remainingMachineHours =
        (recipe.machineHours * ord.batches) / Math.max(0.25, friction.throughputMultiplier);
      ord.remainingLaborHours =
        (recipe.laborHours * ord.batches) / Math.max(0.25, friction.throughputMultiplier);
    }
  }

  // Step B: Outsourced work-center completion (`at_vendor`)
  if (wc.sourcing === "outsourced" && wc.outsource) {
    for (const ord of ordersForWc) {
      if (ord.status !== "at_vendor") continue;
      if (ord.vendorDueTick !== undefined && tick >= ord.vendorDueTick) {
        const recipe = state.catalog.recipes.find((r) => r.id === ord.recipeId)!;
        const vendorFee = Math.round(
          ord.batches * wc.outsource.costPerBatch * friction.costMultiplier,
        );
        if (vendorFee > 0) {
          payOrQueuePayable(state, {
            debitAccount: "inventory_wip",
            amount: vendorFee,
            memo: `Contract manufacturing (${wc.outsource.vendorName}) — ${ord.id}`,
            source: "ops:outsource",
            counterparty: wc.outsource.vendorName,
            kind: "vendor",
            dueOffsetDays: 15,
            priority: 3,
          });
          ord.wipValue += vendorFee;
        }
        const vendorDefect = clamp(
          recipe.baseDefectRate + (1 - wc.outsource.reliability) * 0.25 + friction.extraDefectRate,
          0,
          0.6,
        );
        completeProductionOrder(state, wc, recipe, ord, vendorDefect);
      }
    }
  }

  // Step C: Insourced work-center execution & Little's Law queuing physics
  const baseMachineCap =
    (wc.machineHoursPerDay + Math.min(wc.overtimeHoursPerDay, wc.maxOvertimeHoursPerDay)) *
    wc.condition *
    friction.throughputMultiplier;
  const effMachineCap = Math.max(
    0,
    applyModifiers(state, "workCenter.capacity", baseMachineCap, wc.id),
  );

  const availLaborHours = laborPos
    ? Math.max(0, laborPos.laborHoursAvailable - laborPos.laborHoursUsed)
    : Number.POSITIVE_INFINITY;

  const inProgress = ordersForWc.filter((o) => o.status === "in_progress");
  const totalMachineHoursDemanded = inProgress.reduce((s, o) => s + o.remainingMachineHours, 0);

  // Instantaneous utilization ρ; above 85%, Kingman congestion degrades effective speed & raises defects
  const rho =
    effMachineCap > 0
      ? totalMachineHoursDemanded / effMachineCap
      : totalMachineHoursDemanded > 0
        ? 1.5
        : 0;
  const excessRho = rho > 0.85 ? Math.min(rho, 1.5) - 0.85 : 0;
  const congestionOverhead =
    rho > 0.85 ? 1 + 0.55 * excessRho * excessRho : 1;

  let remMachine = effMachineCap / congestionOverhead;
  let remLabor = availLaborHours / congestionOverhead;
  let machineHoursUsed = 0;

  // Non-linear defect penalty above 85% utilization + equipment wear + capability gap
  const overloadDefect =
    rho > 0.85 ? 0.12 * excessRho * excessRho : 0;
  const conditionDefect = (1 - wc.condition) * 0.06;

  for (const ord of inProgress) {
    if (remMachine <= 1e-6 && ord.remainingMachineHours > 0) break;
    if (remLabor <= 1e-6 && ord.remainingLaborHours > 0) break;

    const recipe = state.catalog.recipes.find((r) => r.id === ord.recipeId)!;

    // Fraction of remaining work we can complete today
    const fMachine =
      ord.remainingMachineHours > 0
        ? Math.min(1, remMachine / ord.remainingMachineHours)
        : 1;
    const fLabor =
      ord.remainingLaborHours > 0
        ? Math.min(1, remLabor / ord.remainingLaborHours)
        : 1;
    const fraction = Math.min(fMachine, fLabor);
    if (fraction <= 0) continue;

    const mUsed = ord.remainingMachineHours * fraction;
    const lUsed = ord.remainingLaborHours * fraction;

    ord.remainingMachineHours = Math.max(0, ord.remainingMachineHours - mUsed);
    ord.remainingLaborHours = Math.max(0, ord.remainingLaborHours - lUsed);
    remMachine = Math.max(0, remMachine - mUsed);
    remLabor = Math.max(0, remLabor - lUsed);
    machineHoursUsed += mUsed * congestionOverhead;

    if (laborPos) {
      laborPos.laborHoursUsed += lUsed * congestionOverhead;
    }

    // Capitalize variable machine overhead into WIP
    const varCost = Math.round(
      mUsed * wc.variableCostPerHour * friction.costMultiplier,
    );
    if (varCost > 0) {
      payOrQueuePayable(state, {
        debitAccount: "inventory_wip",
        amount: varCost,
        memo: `Variable production overhead — ${wc.name} (${ord.id})`,
        source: "ops:overhead",
        counterparty: "Utilities & Consumables",
        kind: "utilities",
        dueOffsetDays: 15,
        priority: 4,
      });
      ord.wipValue += varCost;
    }

    const baseDef = applyModifiers(
      state,
      "workCenter.defectRate",
      recipe.baseDefectRate + friction.extraDefectRate + overloadDefect + conditionDefect,
      wc.id,
    );
    const totalDefectRate = clamp(baseDef, 0, 0.75);

    if (ord.remainingMachineHours <= 1e-5 && ord.remainingLaborHours <= 1e-5) {
      completeProductionOrder(state, wc, recipe, ord, totalDefectRate);
    } else if (ord.batches > 1) {
      // Release completed integer batches immediately so partial multi-batch orders still ship finished units today
      const completedBatches = Math.floor(ord.batches * fraction);
      if (completedBatches >= 1 && completedBatches < ord.batches) {
        const shareWip = Math.min(
          ord.wipValue,
          Math.round((ord.wipValue * completedBatches) / ord.batches),
        );
        ord.wipValue -= shareWip;
        ord.batches -= completedBatches;
        const partialOrd = {
          ...ord,
          batches: completedBatches,
          wipValue: shareWip,
        };
        completeProductionOrder(state, wc, recipe, partialOrd, totalDefectRate);
      }
    }
  }

  // Equipment wear rises non-linearly when running > 85% utilization
  const wearMultiplier =
    rho > 0.85 ? 1 + 1.2 * excessRho + 3.5 * excessRho * excessRho : 1;
  const minConditionFloor = wc.maintenanceCostPerDay > 0 ? 0.65 : 0.2;
  wc.condition = clamp(
    wc.condition - machineHoursUsed * wc.wearPerHour * wearMultiplier,
    minConditionFloor,
    1,
  );

  // Remove completed orders (marked with batches === 0)
  state.operations.orders = state.operations.orders.filter((o) => o.batches > 0);

  // Step D: Update Little's Law ($L = \lambda W$) & queuing telemetry
  const remainingQueueBatches = state.operations.orders
    .filter((o) => {
      const r = state.catalog.recipes.find((x) => x.id === o.recipeId);
      return r?.workCenterId === wc.id;
    })
    .reduce((s, o) => s + o.batches, 0);

  const lambda = ema(wc.telemetry.arrivalRateEma, batchesReleasedToday, 0.2);
  const offeredHours = ema(wc.telemetry.offeredHoursEma, totalMachineHoursDemanded, 0.2);
  const util = effMachineCap > 0 ? clamp(machineHoursUsed / effMachineCap, 0, 1.5) : 0;

  // Kingman's equation for waiting time + service time (days), non-linear above 85% utilization
  const rhoEffective = Math.max(
    effMachineCap > 0 ? offeredHours / effMachineCap : 0,
    rho,
  );
  const rhoClamped = clamp(rhoEffective, 0, 0.98);
  const kingmanWaitDays =
    rhoClamped <= 0.85
      ? 1 + 0.35 * rhoClamped
      : 1 + 0.2975 + 0.85 * ((rhoClamped - 0.85) / Math.max(0.02, 1 - rhoClamped));
  const backlogWaitDays =
    lambda > 0.05 ? remainingQueueBatches / lambda : kingmanWaitDays;
  const avgWaitDays = Math.max(1, kingmanWaitDays, backlogWaitDays);
  const littlesL = lambda * avgWaitDays;

  wc.telemetry = {
    utilization: util,
    offeredHoursEma: offeredHours,
    arrivalRateEma: lambda,
    queueBatches: remainingQueueBatches,
    avgWaitDays,
    littlesL,
    defectRateEma: ema(
      wc.telemetry.defectRateEma,
      clamp(overloadDefect + conditionDefect + friction.extraDefectRate, 0, 0.75),
      0.2,
    ),
    hoursUsedToday: machineHoursUsed,
    capacityHoursToday: effMachineCap,
  };

  void rng;
}

function completeProductionOrder(
  state: WorldState,
  wc: WorkCenter,
  recipe: Recipe,
  ord: WorldState["operations"]["orders"][number],
  defectRate: number,
): void {
  const outItem = getItem(state, recipe.outputItemId);
  const grossOutput = recipe.outputQty * ord.batches;
  const scrappedUnits = Math.min(grossOutput, Math.floor(grossOutput * defectRate));
  const goodUnits = Math.max(0, grossOutput - scrappedUnits);

  const totalWip = ord.wipValue;

  if (outItem.kind === "service") {
    // Service capacity is non-storable: WIP cost flows directly to COGS (`cogs_product`)
    if (totalWip > 0) {
      postJournal(state, {
        memo: `Service delivery capacity produced — ${outItem.name}`,
        source: "ops:service_complete",
        lines: [
          { account: "cogs_product", amount: totalWip },
          { account: "inventory_wip", amount: -totalWip },
        ],
      });
    }
    state.operations.serviceCapacityToday[outItem.id] =
      (state.operations.serviceCapacityToday[outItem.id] ?? 0) + goodUnits;
    ord.wipValue = 0;
    ord.batches = 0;
    return;
  }

  // Physical item: check warehouse zone volume
  const freeM3 = availableZoneVolumeM3(state, wc.warehouseId, outItem.handling);
  const maxFitUnits =
    outItem.unitVolumeM3 > 0 ? Math.floor(freeM3 / outItem.unitVolumeM3) : goodUnits;
  const storedUnits = Math.max(0, Math.min(goodUnits, maxFitUnits));
  const overflowLostUnits = goodUnits - storedUnits;
  const totalLostUnits = scrappedUnits + overflowLostUnits;

  const scrapValue =
    grossOutput > 0 ? Math.min(totalWip, Math.round((totalWip * totalLostUnits) / grossOutput)) : totalWip;
  const goodValue = totalWip - scrapValue;
  const invAccount = inventoryAccountForItem(outItem);

  if (totalWip > 0) {
    const lines: {
      account: typeof invAccount | "cogs_spoilage_shrink" | "inventory_wip";
      amount: Cents;
    }[] = [{ account: "inventory_wip", amount: -totalWip }];
    if (goodValue > 0) lines.push({ account: invAccount, amount: goodValue });
    if (scrapValue > 0) lines.push({ account: "cogs_spoilage_shrink", amount: scrapValue });
    postJournal(state, {
      memo: `Completed ${storedUnits} ${outItem.name} (${scrappedUnits} defective${overflowLostUnits > 0 ? `, ${overflowLostUnits} warehouse-overflow` : ""})`,
      source: "ops:complete",
      lines,
    });
  }

  if (storedUnits > 0) {
    addInventoryLot(state, {
      itemId: outItem.id,
      warehouseId: wc.warehouseId,
      qty: storedUnits,
      value: goodValue,
    });
  }

  if (overflowLostUnits > 0) {
    pushNotification(
      state,
      "critical",
      "warehouse",
      `Warehouse ${wc.warehouseId} ${outItem.handling} zone full! ${overflowLostUnits} produced ${outItem.name} lost to overflow.`,
    );
  }

  ord.wipValue = 0;
  ord.batches = 0;
}
