/**
 * Sub-Engine 4.3: Organizational Design, RACI Governance & Workforce Dynamics.
 *
 * Enforces:
 *  - Hiring pipeline (`pendingHires`) with recruiting lead-time distributions and onboarding
 *    ramp-up curves where new hires start at 30% productivity and ramp linearly over `rampDays`.
 *  - Brooks's Law & Span of Control: exceeding a manager's `idealSpan` or scaling department headcount
 *    without management structure imposes a coordination tax on effective labor hours.
 *  - Morale, wage competitiveness (vs. `marketSalary * macro.wageIndex`), overtime fatigue, and
 *    stochastic attrition.
 *  - RACI Governance Drift: processes without an active Accountable (`A`) or Responsible (`R`) role
 *    with headcount > 0 drive up `governance.drift`, causing operational friction and compliance fines.
 *  - Daily payroll accrual (`opex_payroll` / `cogs_direct_labor` -> `accrued_payroll`).
 */
import type { Cents, PositionState, Role, WorldState } from "../schema";
import { payOrQueuePayable, postJournal } from "./ledger";
import { applyModifiers, pushNotification } from "./modifiers";
import { clamp, ema, type SeededRng } from "./rng";

export function getRole(state: WorldState, roleId: string): Role {
  const r = state.org.roles.find((x) => x.id === roleId);
  if (!r) throw new Error(`Unknown role: ${roleId}`);
  return r;
}

export function roleHeadcount(pos: PositionState): number {
  return pos.cohorts.reduce((s, c) => s + c.count, 0);
}

export function totalHeadcount(state: WorldState): number {
  return state.org.positions.reduce((s, p) => s + roleHeadcount(p), 0);
}

/**
 * Productivity multiplier for a cohort hired at `hiredTick`:
 * Hires at tick <= 0 are initial staff (100%). Hires at tick > 0 start at 30% and ramp over `rampDays`.
 */
export function cohortProductivity(hiredTick: number, currentTick: number, rampDays: number): number {
  if (hiredTick <= 0 || rampDays <= 0) return 1.0;
  const tenure = Math.max(0, currentTick - hiredTick);
  return clamp(0.3 + 0.7 * Math.min(1, tenure / rampDays), 0.3, 1.0);
}

/**
 * Run daily workforce, RACI governance, and payroll accrual tick.
 */
export function runOrgTick(state: WorldState, rng: SeededRng): void {
  const tick = state.calendar.tick;

  // 1. Onboard pending hires whose `readyTick <= tick`
  for (const pos of state.org.positions) {
    const ready = pos.pendingHires.filter((h) => tick >= h.readyTick);
    if (ready.length > 0) {
      const added = ready.reduce((s, h) => s + h.count, 0);
      pos.cohorts.push({ count: added, hiredTick: tick });
      pos.pendingHires = pos.pendingHires.filter((h) => tick < h.readyTick);
    }
  }

  // 2. Span-of-control & Brooks's Law coordination tax per department
  const deptCoordTax: Record<string, number> = {};
  for (const dept of state.org.departments) {
    const deptRoles = state.org.roles.filter((r) => r.departmentId === dept.id);
    let mgrCapacity = 0;
    let icCount = 0;
    let onboardingCount = 0;

    for (const r of deptRoles) {
      const pos = state.org.positions.find((p) => p.roleId === r.id);
      if (!pos) continue;
      const hc = roleHeadcount(pos);
      if (r.isManager) {
        mgrCapacity += hc * Math.max(1, r.idealSpan);
      } else {
        icCount += hc;
      }
      for (const c of pos.cohorts) {
        if (c.hiredTick > 0 && tick - c.hiredTick < r.rampDays) {
          onboardingCount += c.count;
        }
      }
    }

    const spanOverload =
      icCount > 0 && mgrCapacity < icCount
        ? (icCount - mgrCapacity) / Math.max(1, icCount)
        : 0;
    // Brooks's Law: onboarding ratio drains existing team bandwidth
    const brooksTax =
      icCount + mgrCapacity > 0
        ? (onboardingCount / (icCount + mgrCapacity)) * 0.18
        : 0;

    deptCoordTax[dept.id] = clamp(spanOverload * 0.35 + brooksTax, 0, 0.5);
  }
  state.org.governance.coordinationTax = deptCoordTax;

  // 3. Morale, fatigue, attrition, available labor hours, and daily payroll accrual
  let directLaborAccrual: Cents = 0;
  let opexPayrollAccrual: Cents = 0;

  for (const pos of state.org.positions) {
    const role = getRole(state, pos.roleId);
    const hc = roleHeadcount(pos);
    if (hc === 0) {
      pos.laborHoursAvailable = 0;
      pos.laborHoursUsed = 0;
      continue;
    }

    // Utilization of previous day's available hours
    const prevUtil =
      pos.laborHoursAvailable > 0
        ? clamp(pos.laborHoursUsed / pos.laborHoursAvailable, 0, 1.5)
        : 0.7;

    // Overtime & overload fatigue dynamics
    const otRatio = pos.overtimeHoursPerPerson / Math.max(1, role.hoursPerDay);
    const fatigueDelta =
      otRatio > 0.05 || prevUtil > 0.92
        ? (otRatio * 0.08 + Math.max(0, prevUtil - 0.9) * 0.05)
        : -0.025;
    pos.fatigue = clamp(pos.fatigue + fatigueDelta, 0, 1);

    // Wage competitiveness vs. macro-indexed market salary
    const effMarketSalary = applyModifiers(
      state,
      "wage.market",
      role.marketSalary * state.market.macro.wageIndex,
      role.id,
    );
    const wageRatio = effMarketSalary > 0 ? role.annualSalary / effMarketSalary : 1;

    const missedPayrollPenalty =
      state.org.governance.lastMissedPayrollTick !== undefined &&
      tick - state.org.governance.lastMissedPayrollTick <= 30
        ? 0.35
        : 0;

    const coordTax = deptCoordTax[role.departmentId] ?? 0;
    const targetMorale = clamp(
      0.72 +
        (wageRatio - 1) * 0.55 -
        pos.fatigue * 0.45 -
        coordTax * 0.25 -
        missedPayrollPenalty,
      0.05,
      1.0,
    );
    pos.morale = ema(pos.morale, targetMorale, 0.12);

    // Proficiency grows slowly with tenure and erodes when onboarding share is high
    pos.proficiency = clamp(pos.proficiency + 0.0008, 0.4, 1.0);

    // Daily stochastic attrition
    const baseAnnualAttrition =
      0.1 +
      Math.max(0, 0.75 - pos.morale) * 0.45 +
      pos.fatigue * 0.25 +
      Math.max(0, 1 - wageRatio) * 0.35;
    const modAnnualAttrition = clamp(
      applyModifiers(state, "role.attrition", baseAnnualAttrition, role.id),
      0.01,
      0.95,
    );
    const dailyQuitProb = modAnnualAttrition / 360;

    let quits = 0;
    for (let i = 0; i < hc; i++) {
      if (rng.chance(dailyQuitProb)) quits++;
    }
    if (quits > 0) {
      removeFromCohorts(pos, quits);
      pos.attritionYtd += quits;
      pushNotification(
        state,
        "warning",
        "org",
        `${quits} ${role.title} resigned (morale ${(pos.morale * 100).toFixed(0)}%, fatigue ${(pos.fatigue * 100).toFixed(0)}%).`,
      );
      // Automatically open HR backfill requisition so critical roles do not stay permanently vacant
      if (pos.pendingHires.length === 0) {
        const leadDays = Math.max(1, Math.round(rng.sample(role.recruitingLeadDays)));
        pos.pendingHires.push({
          count: quits,
          readyTick: tick + leadDays,
        });
        if (role.recruitingCost > 0) {
          payOrQueuePayable(state, {
            debitAccount: "opex_recruiting",
            amount: role.recruitingCost * quits,
            memo: `Backfill recruiting for ${quits} ${role.title}`,
            source: "org:backfill",
            counterparty: "Talent Recruiting Partners",
            kind: "other",
            dueOffsetDays: 15,
            priority: 4,
          });
        }
      }
    }

    const hcAfter = roleHeadcount(pos);
    // Compute effective labor hours available today across cohorts
    let effPeople = 0;
    for (const c of pos.cohorts) {
      effPeople += c.count * cohortProductivity(c.hiredTick, tick, role.rampDays);
    }
    const moraleFactor = 0.65 + 0.35 * pos.morale;
    const fatigueFactor = 1 - 0.35 * pos.fatigue;
    const totalHoursPerPerson = role.hoursPerDay + pos.overtimeHoursPerPerson;

    pos.laborHoursAvailable = Math.max(
      0,
      effPeople *
        totalHoursPerPerson *
        pos.proficiency *
        moraleFactor *
        fatigueFactor *
        (1 - coordTax),
    );
    pos.laborHoursUsed = 0;

    // Daily payroll accrual (360-day year; overtime paid at 1.5x hourly rate)
    const dailyBasePerPerson = (role.annualSalary * (1 + role.benefitsLoad)) / 360;
    const overtimeMultiplier =
      role.hoursPerDay > 0 ? 1 + (pos.overtimeHoursPerPerson / role.hoursPerDay) * 1.5 : 1;
    const rolePayroll = Math.round(hcAfter * dailyBasePerPerson * overtimeMultiplier);

    if (role.isDirectLabor) directLaborAccrual += rolePayroll;
    else opexPayrollAccrual += rolePayroll;
  }

  const totalPayrollAccrual = directLaborAccrual + opexPayrollAccrual;
  if (totalPayrollAccrual > 0) {
    const lines: {
      account: "cogs_direct_labor" | "opex_payroll" | "accrued_payroll";
      amount: Cents;
    }[] = [{ account: "accrued_payroll", amount: -totalPayrollAccrual }];
    if (directLaborAccrual > 0) {
      lines.push({ account: "cogs_direct_labor", amount: directLaborAccrual });
    }
    if (opexPayrollAccrual > 0) {
      lines.push({ account: "opex_payroll", amount: opexPayrollAccrual });
    }
    postJournal(state, {
      memo: "Daily payroll & benefits accrual",
      source: "org:payroll_accrual",
      lines,
    });
  }

  // 4. RACI Governance Drift & compliance enforcement
  const unowned: string[] = [];
  let unownedWeight = 0;
  let totalWeight = 0;

  for (const proc of state.org.processes) {
    totalWeight += proc.criticality;
    const accOk =
      proc.accountableRoleId !== undefined &&
      hasActiveStaff(state, proc.accountableRoleId);
    const respOk = proc.responsibleRoleIds.some((rid) => hasActiveStaff(state, rid));

    if (!accOk || !respOk) {
      unowned.push(proc.id);
      unownedWeight += proc.criticality;

      // Compliance-critical unowned processes risk regulatory fines
      if (proc.complianceCritical && proc.fineCents > 0 && rng.chance(0.025)) {
        payOrQueuePayable(state, {
          debitAccount: "opex_fines",
          amount: proc.fineCents,
          memo: `Compliance fine: unowned RACI process "${proc.name}"`,
          source: "org:compliance_fine",
          counterparty: "Regulatory Authority",
          kind: "fine",
          dueOffsetDays: 10,
          priority: 1,
        });
        pushNotification(
          state,
          "critical",
          "governance",
          `Compliance fine ($${(proc.fineCents / 100).toFixed(0)}) levied: process "${proc.name}" lacks staffed RACI ownership.`,
        );
      }
    }
  }

  state.org.governance.unownedProcessIds = unowned;
  const targetDrift = totalWeight > 0 ? unownedWeight / totalWeight : 0;
  state.org.governance.drift = clamp(
    ema(state.org.governance.drift, targetDrift, 0.15),
    0,
    1,
  );
}

function hasActiveStaff(state: WorldState, roleId: string): boolean {
  const pos = state.org.positions.find((p) => p.roleId === roleId);
  return pos ? roleHeadcount(pos) > 0 : false;
}

export function removeFromCohorts(pos: PositionState, count: number): number {
  let rem = count;
  // LIFO (newest hires leave / laid off first)
  for (let i = pos.cohorts.length - 1; i >= 0 && rem > 0; i--) {
    const c = pos.cohorts[i];
    const take = Math.min(c.count, rem);
    c.count -= take;
    rem -= take;
  }
  pos.cohorts = pos.cohorts.filter((c) => c.count > 0);
  return count - rem;
}
