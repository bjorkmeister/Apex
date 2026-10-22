/**
 * Warehouse Physics, Supply Chain & Production Queuing Drawer:
 *  - Zone Cubic Volume Utilization (`ambient`, `chilled`, `frozen`, `hazmat`, `oversize`)
 *  - Valued FEFO/FIFO Inventory Lots & Perishable Shelf-Life Countdowns
 *  - Automated Reorder Policy Controls (`EOQ`, `Min-Max`, `JIT` vs `JIC` toggle) & Open POs
 *  - Production Work Centers, Little's Law (L = λW), Make-vs-Buy & Overtime Controls
 */
import { usedVolumeM3 } from "../core/engine/warehouse";
import type { WorldState } from "../core/schema";
import { escapeHtml, fmtCurrency, fmtCurrencyPrecise, fmtNum, fmtPct } from "./formatters";
import type { ClarityMode } from "./ValueChainCanvas";

export function renderWarehouseAndOpsDrawer(
  state: WorldState,
  clarityMode: ClarityMode = "simple",
): string {
  const tick = state.calendar.tick;
  const openPos = state.supply.purchaseOrders.filter(
    (p) => p.status !== "received" && p.status !== "cancelled",
  );
  const nl = state.company.domainUi?.nodeLabels;

  return `
    <div class="drawer-grid">
      <!-- 1. Warehouse Physics & Cubic Zone Utilization -->
      <div class="panel-card">
        <div class="card-header">
          <div>
            <span class="tag tag-cyan">${
              clarityMode === "simple"
                ? escapeHtml(nl?.facilityTag || "TOIMITILA, KYLMÄTILAT & VARASTO")
                : "SUB-ENGINE 4.2 • WAREHOUSE PHYSICS"
            }</span>
            <h3>${
              clarityMode === "simple"
                ? "Kioskit / Toimitilat, Vuokrat & Varastosaldot"
                : "Storage Zones, Throughput & FEFO Lots"
            }</h3>
          </div>
          <span class="tag tag-blue">${state.warehouses.lots.length} ${
            clarityMode === "simple" ? "varastoerää" : "Active Lots"
          }</span>
        </div>

        ${state.warehouses.sites
          .map((wh) => {
            const dailyRent = wh.rentPerDay ?? 0;
            const monthlyRent = dailyRent * 30;
            const zonesHtml = wh.zones
              .map((z) => {
                const used = usedVolumeM3(state, wh.id, z.handling);
                const pct = z.capacityM3 > 0 ? Math.min(1, used / z.capacityM3) : 0;
                const barCls = pct > 0.88 ? "bar-crit" : pct > 0.72 ? "bar-warn" : "bar-ok";
                const zName =
                  clarityMode === "simple"
                    ? z.handling === "frozen"
                      ? "Pakastealtaat (-18°C)"
                      : z.handling === "cold"
                        ? "Kylmiö (+4°C)"
                        : "Kuiva- & tarvikevarasto"
                    : `${z.handling.toUpperCase()} Zone`;
                return `
                  <div class="zone-bar-row">
                    <div class="zone-bar-label">
                      <span><strong>${zName}</strong></span>
                      <span class="mono">${used.toFixed(1)} / ${z.capacityM3.toFixed(1)} m³ (${fmtPct(pct, 0)})</span>
                    </div>
                    <div class="progress-track"><div class="progress-fill ${barCls}" style="width:${Math.round(pct * 100)}%"></div></div>
                  </div>
                `;
              })
              .join("");

            return `
              <div class="sub-box">
                <div class="sub-box-header">
                  <strong>${escapeHtml(wh.name)} (${
                    clarityMode === "simple"
                      ? wh.mode === "leased"
                        ? `Vuokratila ${fmtCurrency(dailyRent)}/pv (${fmtCurrency(monthlyRent)}/kk)`
                        : "Oma toimipiste"
                      : wh.mode.toUpperCase()
                  })</strong>
                  <span class="mono">${
                    clarityMode === "simple"
                      ? `Kapasiteetti: ${wh.pickPackUnitsPerDay} kpl/pv • Laitetaso: ${fmtPct(wh.automationLevel, 0)}`
                      : `Rec: ${wh.receivingUnitsPerDay}u/d • Pick: ${wh.pickPackUnitsPerDay}u/d • Auto: ${fmtPct(wh.automationLevel, 0)}`
                  }</span>
                </div>
                ${zonesHtml}
                <div class="inspector-actions" style="margin-top:8px">
                  <button class="btn btn-sm btn-primary" data-action='{"type":"CAPEX_UPGRADE","targetKind":"warehouse","targetId":"${wh.id}","upgrade":"automation","amount":3500000,"financing":"equipment_loan"}'>
                    ${clarityMode === "simple" ? "+Uudet kylmä- ja myymälälaitteet (Lainarahoitus)" : "+Automation CapEx ($35k)"}
                  </button>
                  <button class="btn btn-sm btn-secondary" data-action='{"type":"CAPEX_UPGRADE","targetKind":"warehouse","targetId":"${wh.id}","upgrade":"capacity","amount":4000000,"financing":"cash"}'>
                    ${clarityMode === "simple" ? "+25% Lisää tilaa kojuun / varastoon" : "+25% Cubic Capacity ($40k)"}
                  </button>
                </div>
              </div>
            `;
          })
          .join("")}

        <h4 class="section-sub">${
          clarityMode === "simple"
            ? "Varastossa olevat raaka-aineet, kupit & valmiit tuotteet"
            : "Valued FEFO/FIFO Inventory Sub-Ledger"
        }</h4>
        <table class="fin-table">
          <thead>
            <tr>
              <th>${clarityMode === "simple" ? "Tuote / Raaka-aine" : "Lot / SKU"}</th>
              <th>${clarityMode === "simple" ? "Säilytys" : "Handling"}</th>
              <th>${clarityMode === "simple" ? "Määrä varastossa" : "On-Hand Qty"}</th>
              <th>${clarityMode === "simple" ? "Varastoarvo" : "Book Value"}</th>
              <th>${clarityMode === "simple" ? "Säilyvyys" : "Shelf Life"}</th>
            </tr>
          </thead>
          <tbody>
            ${state.warehouses.lots
              .slice(0, 12)
              .map((lot) => {
                const item = state.catalog.items.find((i) => i.id === lot.itemId);
                const remDays =
                  lot.expiryTick !== undefined ? Math.max(0, lot.expiryTick - tick) : null;
                const hLabel =
                  clarityMode === "simple"
                    ? item?.handling === "frozen"
                      ? "PAKKANEN"
                      : item?.handling === "cold"
                        ? "KYLMÄ"
                        : "KUIVA"
                    : item?.handling.toUpperCase() ?? "AMB";
                return `
                  <tr>
                    <td><strong>${escapeHtml(item?.name ?? lot.itemId)}</strong> <span class="sub">(${lot.id})</span></td>
                    <td><span class="tag tag-slate">${escapeHtml(hLabel)}</span></td>
                    <td class="mono">${fmtNum(lot.qty, 0)} ${escapeHtml(item?.uom ?? "kpl")}</td>
                    <td class="mono">${fmtCurrency(lot.value)}</td>
                    <td class="mono ${remDays !== null && remDays <= 3 ? "text-red" : ""}">${
                      remDays !== null
                        ? clarityMode === "simple"
                          ? `${remDays} pv jäljellä`
                          : `${remDays}d left`
                        : clarityMode === "simple"
                          ? "Ei vanhene"
                          : "Non-perishable"
                    }</td>
                  </tr>
                `;
              })
              .join("")}
          </tbody>
        </table>
      </div>

      <!-- 2. Production Operations, Little's Law & Reorder Policies -->
      <div class="panel-card">
        <div class="card-header">
          <div>
            <span class="tag tag-cyan">${
              clarityMode === "simple"
                ? escapeHtml(nl?.workCenterTag || "VALMISTUS, TISKI & OSTOTILAUKSET")
                : "SUB-ENGINE 4.1 • LITTLE'S LAW (L = λW) & PROCUREMENT"
            }</span>
            <h3>${
              clarityMode === "simple"
                ? "Myyntitiski, Valmistus & Raaka-aineiden Ostot"
                : "Work Centers, Make-vs-Buy & Reorder Policies"
            }</h3>
          </div>
          <span class="tag tag-blue">${state.operations.orders.length} ${
            clarityMode === "simple" ? "aktiivista erää" : "Open Work Orders"
          }</span>
        </div>

        ${state.operations.workCenters
          .map((wc) => {
            const pol = state.operations.policies.find((p) => {
              const r = state.catalog.recipes.find((x) => x.id === p.recipeId);
              return r?.workCenterId === wc.id;
            });
            const nextSourcing = wc.sourcing === "insourced" ? "outsourced" : "insourced";
            const util = wc.telemetry.utilization;
            return `
              <div class="sub-box">
                <div class="sub-box-header">
                  <strong>${escapeHtml(wc.name)}</strong>
                  <span class="tag ${util > 0.85 ? "tag-red" : "tag-green"}">${
                    clarityMode === "simple"
                      ? `${wc.sourcing === "insourced" ? "Oma tiski/tiimi" : "Alihankinta"} • Kuormitus ${fmtPct(util, 0)}`
                      : `${wc.sourcing.toUpperCase()} • ρ=${fmtPct(util, 0)}`
                  }</span>
                </div>
                <div class="inspector-grid" style="margin:8px 0">
                  <div><label>${clarityMode === "simple" ? "Jonossa nyt" : "Little's Law WIP (L)"}</label><strong class="mono">${wc.telemetry.littlesL.toFixed(1)} ${clarityMode === "simple" ? "annosta/työtä" : "batches"}</strong></div>
                  <div><label>${clarityMode === "simple" ? "Asiakasvirta & Odotus" : "Arrival (λ) × Wait (W)"}</label><strong class="mono">${wc.telemetry.arrivalRateEma.toFixed(1)}/pv • ${wc.telemetry.avgWaitDays.toFixed(2)} pv</strong></div>
                  <div><label>${clarityMode === "simple" ? "Laitteiden kunto" : "Machine Condition"}</label><strong class="mono">${fmtPct(wc.condition, 0)}</strong></div>
                  <div><label>${clarityMode === "simple" ? "Hukka / Virheet" : "Defect Rate EMA"}</label><strong class="mono">${fmtPct(wc.telemetry.defectRateEma, 1)}</strong></div>
                </div>
                <div class="inspector-actions">
                  <button class="btn btn-sm btn-primary" data-action='{"type":"SET_OVERTIME","workCenterId":"${wc.id}","hoursPerDay":${wc.overtimeHoursPerDay >= 4 ? 0 : 4}}'>
                    ${
                      clarityMode === "simple"
                        ? wc.overtimeHoursPerDay >= 4
                          ? "Palauta normaali aukiolo (0h lisäaika)"
                          : "Pidennä aukioloa / lisävuoro (+4h/pv)"
                        : wc.overtimeHoursPerDay >= 4
                          ? "Clear Overtime (0h)"
                          : "Authorize Overtime (+4h/d)"
                    }
                  </button>
                  <button class="btn btn-sm btn-secondary" data-action='{"type":"SET_WORK_CENTER_SOURCING","workCenterId":"${wc.id}","sourcing":"${nextSourcing}"}'>
                    ${
                      clarityMode === "simple"
                        ? `Vaihda: ${nextSourcing === "insourced" ? "Oma valmistus" : "Alihankinta"}`
                        : `Toggle Make/Buy → ${nextSourcing.toUpperCase()}`
                    }
                  </button>
                  ${
                    pol
                      ? `<button class="btn btn-sm btn-secondary" data-action='{"type":"SET_PRODUCTION_POLICY","recipeId":"${pol.recipeId}","mode":"${pol.mode}","targetStockUnits":${Math.round(pol.targetStockUnits * 1.25)},"maxBatchesPerDay":${pol.maxBatchesPerDay + 1}}'>
                          ${clarityMode === "simple" ? `Kasvata päivän valmistustavoitetta +25% (${Math.round(pol.targetStockUnits * 1.25)} kpl)` : `Raise Target Stock +25% (${Math.round(pol.targetStockUnits * 1.25)}u)`}
                        </button>`
                      : ""
                  }
                </div>
              </div>
            `;
          })
          .join("")}

        <h4 class="section-sub">${
          clarityMode === "simple"
            ? `Ostot tukuista & Automaattinen täydennys (${openPos.length} tilausta matkalla)`
            : `Automated Reorder Policies (EOQ / JIT vs. JIC) & Open POs (${openPos.length})`
        }</h4>
        <div class="covenant-list">
          ${state.supply.reorderPolicies
            .map((rp) => {
              const item = state.catalog.items.find((i) => i.id === rp.itemId);
              const sup = state.supply.suppliers.find((s) => s.id === rp.supplierId);
              const offer = sup?.offers.find((o) => o.itemId === rp.itemId) ?? sup?.offers[0];
              const nextStrat = rp.strategy === "jic" ? "jit" : "jic";
              return `
                <div class="covenant-item">
                  <div>
                    <strong>📦 ${escapeHtml(item?.name ?? rp.itemId)}</strong>
                    <span class="sub">${escapeHtml(sup?.name ?? "")} • ${
                      clarityMode === "simple"
                        ? `Hinta ${fmtCurrencyPrecise(offer?.unitPrice ?? item?.standardCost ?? 0)}/${escapeHtml(item?.uom ?? "kpl")} • Puskuri: ${rp.safetyStockDays} pv (${rp.strategy === "jic" ? "Reilu varmuusvarasto" : "Tilaa tarpeeseen"})`
                        : `Mode: ${rp.mode.toUpperCase()} • Strategy: ${rp.strategy.toUpperCase()} (${rp.safetyStockDays}d buffer)`
                    }</span>
                  </div>
                  <div style="display:flex;gap:6px">
                    <button class="btn btn-xs btn-secondary" data-action='{"type":"SET_REORDER_POLICY","policyId":"${rp.id}","mode":"${rp.mode}","strategy":"${nextStrat}","safetyStockDays":${nextStrat === "jit" ? 2 : 7}}'>
                      ${clarityMode === "simple" ? (nextStrat === "jit" ? "Vaihda: Tilaa tarpeeseen (2 pv)" : "Vaihda: Varmuusvarasto (7 pv)") : `Switch to ${nextStrat.toUpperCase()}`}
                    </button>
                    <button class="btn btn-xs btn-primary" data-action='{"type":"PLACE_PURCHASE_ORDER","supplierId":"${rp.supplierId}","itemId":"${rp.itemId}","qty":${offer?.moq ?? 100},"warehouseId":"${rp.warehouseId}","laneId":"${rp.laneId}"}'>
                      ${clarityMode === "simple" ? `🛒 Tilaa +${offer?.moq ?? 100} ${escapeHtml(item?.uom ?? "kpl")}` : "Buy MOQ Now"}
                    </button>
                  </div>
                </div>
              `;
            })
            .join("")}
        </div>

        ${
          openPos.length > 0
            ? `<table class="fin-table" style="margin-top:8px">
                <thead>
                  <tr>
                    <th>${clarityMode === "simple" ? "Tilaus" : "PO"}</th>
                    <th>${clarityMode === "simple" ? "Raaka-aine / Tuote" : "Item"}</th>
                    <th>${clarityMode === "simple" ? "Määrä" : "Qty"}</th>
                    <th>${clarityMode === "simple" ? "Yhteensä" : "Landed Value"}</th>
                    <th>${clarityMode === "simple" ? "Saapuu" : "Status / ETA"}</th>
                  </tr>
                </thead>
                <tbody>
                  ${openPos
                    .slice(0, 8)
                    .map((po) => {
                      const it = state.catalog.items.find((i) => i.id === po.itemId);
                      return `
                        <tr>
                          <td class="mono">${po.id}</td>
                          <td>${escapeHtml(it?.name ?? po.itemId)}</td>
                          <td class="mono">${fmtNum(po.qty - po.receivedQty)} ${escapeHtml(it?.uom ?? "kpl")}</td>
                          <td class="mono">${fmtCurrency(po.qty * po.unitPrice + po.freightCost)}</td>
                          <td class="mono"><span class="tag tag-blue">${po.status.toUpperCase()}</span> ${clarityMode === "simple" ? `Päivä ${po.etaTick}` : `Day ${po.etaTick}`}</td>
                        </tr>
                      `;
                    })
                    .join("")}
                </tbody>
              </table>`
            : ""
        }
      </div>
    </div>
  `;
}

