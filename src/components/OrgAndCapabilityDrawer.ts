/**
 * Organizational Design, RACI Governance & Enterprise Capability Map Drawer:
 *  - L1/L2/L3 Capability Maturity vs. Required Maturity, Operational Friction Multipliers & Daily Investment
 *  - Workforce Roles, Onboarding Cohorts (30% -> 100% ramp), Brooks's Law Coordination Tax, Morale & Fatigue
 *  - RACI Governance Matrix & Compliance Process Ownership
 */
import { capabilityFriction } from "../core/engine/operations";
import { roleHeadcount } from "../core/engine/org";
import type { WorldState } from "../core/schema";
import { escapeHtml, fmtCurrency, fmtPct } from "./formatters";
import type { ClarityMode } from "./ValueChainCanvas";

export function renderOrgAndCapabilityDrawer(
  state: WorldState,
  clarityMode: ClarityMode = "simple",
): string {
  const drift = state.org.governance.drift;

  return `
    <div class="drawer-grid">
      <!-- 1. Enterprise Capability Map (L1/L2/L3) -->
      <div class="panel-card">
        <div class="card-header">
          <div>
            <span class="tag tag-cyan">${
              clarityMode === "simple"
                ? "YRITYKSEN YDINOSAAMINEN & PROSESSIT"
                : "MODULE 1 & 4.1 • ENTERPRISE CAPABILITY MAP"
            }</span>
            <h3>${
              clarityMode === "simple"
                ? "Osaamisalueet, Laatu & Kehityspanostukset"
                : "L1/L2/L3 Business Capabilities & Friction Physics"
            }</h3>
          </div>
          <span class="tag tag-blue">${state.operations.capabilities.length} ${
            clarityMode === "simple" ? "osaamisaluetta" : "Core Capabilities"
          }</span>
        </div>

        ${state.operations.capabilities
          .map((cap) => {
            const fric = capabilityFriction(state, cap.id);
            const effMat =
              cap.sourcing === "outsourced" && cap.vendor ? cap.vendor.maturity : cap.maturity;
            const pct = Math.min(1, effMat / 5);
            const reqPct = Math.min(1, cap.requiredMaturity / 5);
            const hasGap = effMat + 0.05 < cap.requiredMaturity;
            const ownerRole = state.org.roles.find((r) => r.id === cap.ownerRoleId);

            return `
              <div class="sub-box">
                <div class="sub-box-header">
                  <div>
                    <strong>${escapeHtml(cap.name)}</strong>
                    <span class="sub" style="display:block">${escapeHtml(cap.description)}</span>
                  </div>
                  <span class="tag ${hasGap ? "tag-amber" : "tag-green"}">
                    ${clarityMode === "simple" ? `Taso ${effMat.toFixed(1)} / Tavoite ${cap.requiredMaturity.toFixed(1)}` : `Maturity ${effMat.toFixed(2)} / Req ${cap.requiredMaturity.toFixed(1)}`}
                  </span>
                </div>

                <div class="progress-track" style="position:relative;margin:8px 0">
                  <div class="progress-fill ${hasGap ? "bar-warn" : "bar-ok"}" style="width:${Math.round(pct * 100)}%"></div>
                  <div style="position:absolute;top:-2px;bottom:-2px;left:${Math.round(reqPct * 100)}%;width:2px;background:#f8fafc" title="Required Maturity ${cap.requiredMaturity}"></div>
                </div>

                <div class="inspector-grid" style="margin:8px 0">
                  <div><label>${clarityMode === "simple" ? "Kustannusvaikutus" : "Cost Friction"}</label><strong class="mono">${fric.costMultiplier.toFixed(2)}x</strong></div>
                  <div><label>${clarityMode === "simple" ? "Työn nopeus" : "Throughput Speed"}</label><strong class="mono">${fric.throughputMultiplier.toFixed(2)}x</strong></div>
                  <div><label>${clarityMode === "simple" ? "Virhe- / hukkariski" : "Added Defect Penalty"}</label><strong class="mono">+${fmtPct(fric.extraDefectRate, 1)}</strong></div>
                  <div><label>${clarityMode === "simple" ? "Vastuuhenkilö / Panostus" : "Owner / Daily Spend"}</label><strong class="mono">${escapeHtml(ownerRole?.title.slice(0, 14) ?? "Unassigned")} • ${fmtCurrency(cap.dailyInvestment)}/${clarityMode === "simple" ? "pv" : "d"}</strong></div>
                </div>

                <div class="inspector-actions">
                  <button class="btn btn-xs btn-primary" data-action='{"type":"SET_CAPABILITY_INVESTMENT","capabilityId":"${cap.id}","dailyInvestment":${Math.round(cap.dailyInvestment * 1.4 + 10000)}}'>
                    ${clarityMode === "simple" ? `Kehitä osaamista (${fmtCurrency(Math.round(cap.dailyInvestment * 1.4 + 10000))}/pv)` : `Boost Investment (${fmtCurrency(Math.round(cap.dailyInvestment * 1.4 + 10000))}/d)`}
                  </button>
                  <button class="btn btn-xs btn-secondary" data-action='{"type":"SET_CAPABILITY_INVESTMENT","capabilityId":"${cap.id}","dailyInvestment":${cap.maintenanceSpendPerDay}}'>
                    ${clarityMode === "simple" ? `Ylläpitotaso (${fmtCurrency(cap.maintenanceSpendPerDay)}/pv)` : `Hold at Maintenance (${fmtCurrency(cap.maintenanceSpendPerDay)}/d)`}
                  </button>
                </div>
              </div>
            `;
          })
          .join("")}
      </div>

      <!-- 2. Dynamic Org Chart, Brooks's Law & RACI Matrix -->
      <div class="panel-card">
        <div class="card-header">
          <div>
            <span class="tag tag-cyan">${
              clarityMode === "simple"
                ? "HENKILÖSTÖ, PALKAT & VASTUUALUEET"
                : "SUB-ENGINE 4.3 • ORG DESIGN, BROOKS'S LAW & RACI"
            }</span>
            <h3>${
              clarityMode === "simple"
                ? "Tiimin roolit, Rekrytointi & Jaksaminen"
                : "Workforce Roles, Onboarding Ramp & RACI Governance"
            }</h3>
          </div>
          <span class="tag ${drift > 0.08 ? "tag-red" : "tag-green"}">${
            clarityMode === "simple"
              ? `Työnjaon selkeys: ${fmtPct(1 - drift, 0)}`
              : `Governance Drift: ${fmtPct(drift, 1)}`
          }</span>
        </div>

        ${state.org.roles
          .map((role) => {
            const pos = state.org.positions.find((p) => p.roleId === role.id);
            if (!pos) return "";
            const hc = roleHeadcount(pos);
            const pending = pos.pendingHires.reduce((s, h) => s + h.count, 0);
            const coordTax = state.org.governance.coordinationTax[role.departmentId] ?? 0;
            const util =
              pos.laborHoursAvailable > 0
                ? Math.min(1.5, pos.laborHoursUsed / pos.laborHoursAvailable)
                : 0;
            const monthlySalary = Math.round(role.annualSalary / 12);

            return `
              <div class="sub-box">
                <div class="sub-box-header">
                  <div>
                    <strong>${escapeHtml(role.title)}</strong>
                    <span class="sub"> (${
                      clarityMode === "simple"
                        ? `${fmtCurrency(monthlySalary)}/kk • ${fmtCurrency(role.annualSalary)}/v`
                        : `${role.tier.toUpperCase()} • ${fmtCurrency(role.annualSalary)}/yr`
                    })</span>
                  </div>
                  <span class="tag ${hc === 0 ? "tag-red" : "tag-blue"}">
                    ${
                      clarityMode === "simple"
                        ? `${hc} hlö${pending > 0 ? ` (+${pending} perehdytyksessä)` : ""}`
                        : `HC: ${hc}${pending > 0 ? ` (+${pending} hiring)` : ""}`
                    }
                  </span>
                </div>

                <div class="inspector-grid" style="margin:6px 0">
                  <div><label>${clarityMode === "simple" ? "Motivaatio / Kuormitus" : "Morale / Fatigue"}</label><strong class="mono">${fmtPct(pos.morale, 0)} / ${fmtPct(pos.fatigue, 0)}</strong></div>
                  <div><label>${clarityMode === "simple" ? "Ammattitaito" : "Skill Proficiency"}</label><strong class="mono">${fmtPct(pos.proficiency, 0)}</strong></div>
                  <div><label>${clarityMode === "simple" ? "Työtunnit / Käyttöaste" : "Hours Avail / Util"}</label><strong class="mono">${pos.laborHoursAvailable.toFixed(1)}h (${fmtPct(util, 0)})</strong></div>
                  <div><label>${clarityMode === "simple" ? "Perehdytys- & viestintäkitka" : "Brooks's Law Tax"}</label><strong class="mono">${fmtPct(coordTax, 1)}</strong></div>
                </div>

                <div class="inspector-actions">
                  <button class="btn btn-xs btn-primary" data-action='{"type":"HIRE","roleId":"${role.id}","count":1}'>
                    ${clarityMode === "simple" ? `+Palkkaa 1 hlö (Rekrykulu ${fmtCurrency(role.recruitingCost)})` : `+Hire 1 (${fmtCurrency(role.recruitingCost)} fee)`}
                  </button>
                  <button class="btn btn-xs btn-secondary" data-action='{"type":"SET_SALARY","roleId":"${role.id}","annualSalary":${Math.round(role.annualSalary * 1.06)}}'>
                    ${clarityMode === "simple" ? "Nosta palkkaa +6%" : "Raise Pay +6%"}
                  </button>
                  <button class="btn btn-xs btn-secondary" data-action='{"type":"LAYOFF","roleId":"${role.id}","count":1}' ${hc <= 1 ? "disabled" : ""}>
                    ${clarityMode === "simple" ? "Vähennä 1 hlö" : "Layoff 1"}
                  </button>
                </div>
              </div>
            `;
          })
          .join("")}

        <h4 class="section-sub">${
          clarityMode === "simple"
            ? "Vastuumatriisi (Kuka vastaa mistäkin osa-alueesta)"
            : "RACI Governance Matrix & Compliance Criticality"
        }</h4>
        <table class="fin-table">
          <thead>
            <tr>
              <th>${clarityMode === "simple" ? "Toiminto / Prosessi" : "Core Process"}</th>
              <th>${clarityMode === "simple" ? "Päävastuu" : "Accountable (A)"}</th>
              <th>${clarityMode === "simple" ? "Tekijä" : "Responsible (R)"}</th>
              <th>${clarityMode === "simple" ? "Riskitaso" : "Compliance Exposure"}</th>
            </tr>
          </thead>
          <tbody>
            ${state.org.processes
              .map((proc) => {
                const aRole = state.org.roles.find((r) => r.id === proc.accountableRoleId);
                const rRoles = proc.responsibleRoleIds
                  .map((id) => state.org.roles.find((r) => r.id === id)?.title ?? id)
                  .join(", ");
                const unowned = state.org.governance.unownedProcessIds.includes(proc.id);
                return `
                  <tr>
                    <td>
                      <strong>${escapeHtml(proc.name)}</strong>
                      ${unowned ? `<span class="tag tag-red">${clarityMode === "simple" ? "EI VASTUUHENKILÖÄ" : "UNOWNED DRIFT"}</span>` : ""}
                    </td>
                    <td>${escapeHtml(aRole?.title ?? "Unassigned")}</td>
                    <td>${escapeHtml(rRoles || "Unassigned")}</td>
                    <td class="mono">${proc.complianceCritical ? `${clarityMode === "simple" ? "Sakkoriski" : "Fine Risk"} ${fmtCurrency(proc.fineCents)}` : `L${proc.criticality}`}</td>
                  </tr>
                `;
              })
              .join("")}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

