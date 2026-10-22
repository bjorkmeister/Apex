/**
 * Director AI & crisis system: modifiers, active events, decision cards, notifications.
 */
import { z } from "zod";
import { ActionPayload } from "./actions";
import { Cents, Id, Tick } from "./primitives";

/** Every stochastic shock is expressed as a declarative modifier on an engine parameter. */
export const ModifierTarget = z.enum([
  "supplier.reliability",
  "supplier.leadTime",
  "supplier.price",
  "lane.transitDays",
  "lane.cost",
  "material.price",
  "segment.demand",
  "segment.priceWeight",
  "workCenter.capacity",
  "workCenter.defectRate",
  "warehouse.pickCapacity",
  "warehouse.receivingCapacity",
  "wage.market",
  "role.attrition",
  "competitor.price",
  "macro.baseRateBps",
  "revolver.limit",
  "channel.paymentDelayDays",
]);
export type ModifierTarget = z.infer<typeof ModifierTarget>;

export const Modifier = z.object({
  target: ModifierTarget,
  /** Entity id the modifier applies to; omitted = global. */
  scopeId: Id.optional(),
  op: z.enum(["mul", "add"]),
  value: z.number(),
});
export type Modifier = z.infer<typeof Modifier>;

export const EventCategory = z.enum([
  "supply",
  "operations",
  "market",
  "finance",
  "people",
  "regulatory",
  "macro",
]);

export const ActiveEvent = z.object({
  id: Id,
  templateId: z.string(),
  title: z.string(),
  description: z.string(),
  category: EventCategory,
  severity: z.number().int().min(1).max(5),
  startTick: Tick,
  endTick: Tick,
  modifiers: z.array(Modifier),
  /** Which vulnerability in the business model triggered this. */
  rationale: z.string(),
});
export type ActiveEvent = z.infer<typeof ActiveEvent>;

export const DecisionOption = z.object({
  id: Id,
  label: z.string(),
  description: z.string(),
  actions: z.array(ActionPayload),
  projected: z.object({ cashImpact: Cents.optional(), notes: z.string() }),
});
export type DecisionOption = z.infer<typeof DecisionOption>;

export const DecisionCard = z.object({
  id: Id,
  eventId: Id.optional(),
  title: z.string(),
  prompt: z.string(),
  options: z.array(DecisionOption).min(1),
  defaultOptionId: Id,
  createdTick: Tick,
  deadlineTick: Tick,
  status: z.enum(["pending", "resolved", "expired"]),
  chosenOptionId: Id.optional(),
});
export type DecisionCard = z.infer<typeof DecisionCard>;

export const Notification = z.object({
  tick: Tick,
  severity: z.enum(["info", "warning", "critical"]),
  category: z.string(),
  message: z.string(),
});
export type Notification = z.infer<typeof Notification>;

export const DirectorState = z.object({
  cooldowns: z.record(z.string(), Tick),
  lastEventTick: Tick.optional(),
  firedCount: z.number().int().min(0),
});

export const EventsState = z.object({
  active: z.array(ActiveEvent),
  decisions: z.array(DecisionCard),
  director: DirectorState,
  notifications: z.array(Notification),
  /** Compact history of every event ever fired (for the risk register export). */
  log: z.array(
    z.object({ tick: Tick, eventId: Id, templateId: z.string(), title: z.string(), severity: z.number() }),
  ),
});
export type EventsState = z.infer<typeof EventsState>;
