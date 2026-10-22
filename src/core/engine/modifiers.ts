/**
 * Declarative Modifier Evaluation & Entity Helpers.
 *
 * Active events (Director AI crises, macro shocks) attach `Modifier` objects to `WorldState.events.active`.
 * Sub-engines query `applyModifiers(state, target, baseValue, scopeId)` so crises never corrupt base parameters.
 */
import type { ModifierTarget, WorldState } from "../schema";

export function applyModifiers(
  state: WorldState,
  target: ModifierTarget,
  base: number,
  scopeId?: string,
): number {
  let mul = 1;
  let add = 0;
  for (const ev of state.events.active) {
    for (const m of ev.modifiers) {
      if (m.target !== target) continue;
      if (m.scopeId && m.scopeId !== scopeId) continue;
      if (m.op === "mul") mul *= m.value;
      else add += m.value;
    }
  }
  return base * mul + add;
}

export function nextId(state: WorldState, prefix: string): string {
  const n = state.nextSeq++;
  return `${prefix}_${n}`;
}

export function pushNotification(
  state: WorldState,
  severity: "info" | "warning" | "critical",
  category: string,
  message: string,
): void {
  state.events.notifications.push({
    tick: state.calendar.tick,
    severity,
    category,
    message,
  });
  if (state.events.notifications.length > 200) {
    state.events.notifications.splice(0, state.events.notifications.length - 200);
  }
}

/** Advance the 30/360 banking calendar by 1 day. */
export function advanceCalendar(state: WorldState): void {
  const nextTick = state.calendar.tick + 1;
  const zeroBased = nextTick;
  const year = Math.floor(zeroBased / 360) + 1;
  const dayOfYear = zeroBased % 360;
  const monthOfYear = Math.floor(dayOfYear / 30) + 1;
  const dayOfMonth = (dayOfYear % 30) + 1;
  const quarter = (Math.floor((monthOfYear - 1) / 3) + 1) as 1 | 2 | 3 | 4;
  const monthIndex = Math.floor(zeroBased / 30);

  state.calendar = {
    tick: nextTick,
    dayOfMonth,
    monthOfYear,
    year,
    quarter,
    monthIndex,
  };
}
