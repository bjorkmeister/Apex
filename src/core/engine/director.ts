/**
 * Sub-Engine 4.7: The "Director AI", Stochastic Crisis Engine & External Competitor CEOs.
 *
 * The Director AI continuously inspects real structural vulnerabilities in `WorldState`:
 *  1. Single-sourced or overseas supply concentration -> Port Congestion / Supplier Quality Crisis
 *  2. Warehouse cubic or pick utilization > 88%      -> Fulfillment Backlog & Dock Gridlock Crisis
 *  3. Production utilization > 88% or condition < 0.6 -> Critical Equipment Breakdown
 *  4. High player gross margin (>48%) + share gain   -> Competitor Predatory Price War
 *  5. Low employee morale (<0.55) or high fatigue    -> Key Talent Walkout / Labor Dispute
 *  6. Unowned RACI compliance processes              -> Regulatory Audit & Injunction
 *  7. Tight cash / high revolver utilization         -> Credit Tightening / Working Capital Squeeze
 *
 * When a crisis triggers, the Director AI attaches declarative `Modifier`s to `events.active`,
 * generates an interactive multi-option `DecisionCard` with concrete `ActionPayload`s, and pauses
 * the simulation (`status = "paused_decision"`) unless auto-resolve is enabled.
 */
import type { ActiveEvent, DecisionCard, WorldState } from "../schema";
import { debitBalance } from "./ledger";
import { nextId, pushNotification } from "./modifiers";
import { clamp, type SeededRng } from "./rng";

export interface DirectorOptions {
  /** If true, newly spawned decision cards do not pause the simulation clock (useful for headless/Monte Carlo runs). */
  autoResolveDecisions?: boolean;
  /** If true, forces a director crisis to trigger on evaluation days (e.g. Day 10) regardless of stochastic chance. */
  forceCrisisOnEvaluation?: boolean;
}

/**
 * Daily tick for active events, decision card deadlines, competitor CEOs, and the Director AI.
 */
export function runDirectorAndCompetitorsTick(
  state: WorldState,
  rng: SeededRng,
  opts: DirectorOptions = {},
): void {
  const tick = state.calendar.tick;

  // 1. Expire finished active events
  const beforeCount = state.events.active.length;
  state.events.active = state.events.active.filter((ev) => tick < ev.endTick);
  if (state.events.active.length < beforeCount) {
    pushNotification(
      state,
      "info",
      "director",
      "Markkina- tai toimintahäiriö on päättynyt ja tilanne on palautunut normaaliksi.",
    );
  }

  // 2. Auto-resolve expired pending DecisionCards using their `defaultOptionId`
  for (const dec of state.events.decisions) {
    if (dec.status !== "pending") continue;
    if (tick >= dec.deadlineTick || opts.autoResolveDecisions) {
      const opt =
        dec.options.find((o) => o.id === dec.defaultOptionId) ?? dec.options[0];
      dec.status = opts.autoResolveDecisions ? "resolved" : "expired";
      dec.chosenOptionId = opt.id;
      for (const act of opt.actions) {
        state.actionQueue.push({
          id: nextId(state, "act"),
          issuedBy: "director:default_option",
          issuedAtTick: tick,
          executeAtTick: tick + 1,
          rationale: `Automaattinen ratkaisu tilanteeseen "${dec.title}": ${opt.label}`,
          payload: act,
        });
      }
      if (state.status === "paused_decision") {
        state.status = "running";
      }
    }
  }

  // 3. Autonomous External Competitor CEO Moves (weekly evaluation on day % 7 === 0)
  if (tick % 7 === 0) {
    runCompetitorMoves(state, rng);
  }

  // 4. Director AI vulnerability scan (evaluates every 5 days, min 20-day global cooldown)
  if (tick >= 10 && tick % 5 === 0) {
    const lastTick = state.events.director.lastEventTick ?? -999;
    if (tick - lastTick >= 22 && state.events.active.length < 2) {
      maybeTriggerDirectorCrisis(state, rng, opts);
    }
  }
}

function runCompetitorMoves(state: WorldState, rng: SeededRng): void {
  const tick = state.calendar.tick;

  for (const comp of state.market.competitors) {
    if (comp.bankrupt) continue;

    // Update competitor daily P&L approximation over the past 7 days
    let weeklyRev = 0;
    let weeklyUnits = 0;
    for (const coff of comp.offerings) {
      weeklyRev += coff.unitsToday * coff.price * 7;
      weeklyUnits += coff.unitsToday * 7;
    }
    const weeklyCost = weeklyUnits * comp.unitCost + comp.fixedCostPerDay * 7;
    comp.cash += Math.round(weeklyRev - weeklyCost);

    if (comp.cash < -comp.fixedCostPerDay * 45) {
      comp.bankrupt = true;
      comp.strategyMemo = "Poistui markkinoilta kassan loputtua.";
      pushNotification(
        state,
        "info",
        "competitor",
        `Kilpailija ${comp.name} on lopettanut toimintansa kassan tyrehdyttyä!`,
      );
      continue;
    }

    // Track competitor share across segments
    let avgShare = 0;
    for (const coff of comp.offerings) {
      const pres = state.market.presence.find((p) => p.segmentId === coff.segmentId);
      avgShare += pres?.lastShares[`comp:${comp.id}`] ?? 0.2;
    }
    avgShare = comp.offerings.length > 0 ? avgShare / comp.offerings.length : 0;
    comp.shareHistory.push(avgShare);
    if (comp.shareHistory.length > 8) comp.shareHistory.shift();

    const prevShare =
      comp.shareHistory.length >= 2
        ? comp.shareHistory[comp.shareHistory.length - 2]
        : avgShare;
    const losingShare = avgShare < prevShare - 0.015;

    // Archetype-specific strategic behavior
    for (const coff of comp.offerings) {
      const minPrice = Math.max(100, Math.round(comp.unitCost * (1 + comp.priceFloorMargin)));

      if (comp.archetype === "cost_leader") {
        if (losingShare && coff.price > minPrice) {
          coff.price = Math.max(minPrice, Math.round(coff.price * 0.96));
          comp.strategyMemo = `Laski hintaa (-4%) puolustaakseen volyymiaan.`;
          comp.lastMoveTick = tick;
        } else if (!losingShare && rng.chance(0.25)) {
          coff.price = Math.round(coff.price * 1.015);
        }
      } else if (comp.archetype === "blitzscaler") {
        if (comp.cash > comp.fixedCostPerDay * 30) {
          coff.price = Math.max(minPrice, Math.round(coff.price * 0.95));
          coff.awareness = clamp(coff.awareness + 0.025, 0.1, 0.98);
          comp.cash -= Math.round(comp.fixedCostPerDay * 2);
          comp.strategyMemo = `Ostaa markkinaosuutta aggressiivisella hinnoittelulla ja mainonnalla.`;
          comp.lastMoveTick = tick;
        } else {
          coff.price = Math.round(coff.price * 1.05);
          comp.strategyMemo = `Pakotettu nostamaan hintoja (+5%) kassan hupenemisen vuoksi.`;
          comp.lastMoveTick = tick;
        }
      } else if (comp.archetype === "premium_artisan") {
        coff.quality = clamp(coff.quality + 0.004, 0.5, 0.99);
        coff.brand = clamp(coff.brand + 0.004, 0.3, 0.99);
        if (losingShare && rng.chance(0.4)) {
          coff.price = Math.max(minPrice, Math.round(coff.price * 0.98));
        }
        comp.strategyMemo = `Panostaa käsityölaatuun ja brändin arvostukseen.`;
      } else if (comp.archetype === "fast_follower") {
        // Mirrors player's price in this segment minus 5%
        const playerOff = state.commercial.offerings.find(
          (o) => o.segmentId === coff.segmentId && o.active,
        );
        const ost = playerOff
          ? state.commercial.offeringStates.find((s) => s.offeringId === playerOff.id)
          : undefined;
        if (ost && ost.lastPrice > 0) {
          const target = Math.max(minPrice, Math.round(ost.lastPrice * 0.95));
          coff.price = Math.round(coff.price * 0.7 + target * 0.3);
          comp.strategyMemo = `Seuraa hinnoitteluasi ja alittaa sen 5%:lla.`;
          comp.lastMoveTick = tick;
        }
      } else {
        // regional_incumbent
        if (losingShare) {
          coff.availability = clamp(coff.availability + 0.01, 0.5, 0.99);
          coff.price = Math.max(minPrice, Math.round(coff.price * 0.98));
          comp.strategyMemo = `Hyödyntää vakiintunutta myyntipaikkaa puolustaakseen asiakkaita.`;
          comp.lastMoveTick = tick;
        }
      }
    }
  }
}

function maybeTriggerDirectorCrisis(
  state: WorldState,
  rng: SeededRng,
  opts: DirectorOptions,
): void {
  const tick = state.calendar.tick;
  const cd = state.events.director.cooldowns;
  const currentCash = Math.max(2_000_00, debitBalance(state.finance.ledger, "cash") || state.finance.periodStartCash || 25_000_00);
  const isSmallBiz = currentCash < 50_000_00;

  interface Candidate {
    templateId: string;
    weight: number;
    build: () => { event: ActiveEvent; decision: DecisionCard };
  }

  const candidates: Candidate[] = [];

  // Vulnerability 1: Single-sourced or long-lead supplier concentration
  const primarySupplier = state.supply.suppliers[0];
  if (primarySupplier && (cd.supply_shock ?? 0) <= tick) {
    const singleSourceCount = state.catalog.items.filter((it) => {
      if (it.kind !== "raw" && it.kind !== "component") return false;
      const supCount = state.supply.suppliers.filter((s) =>
        s.offers.some((o) => o.itemId === it.id),
      ).length;
      return supCount <= 1;
    }).length;
    const vulnWeight = singleSourceCount > 0 ? 0.38 : 0.16;

    candidates.push({
      templateId: "supply_shock",
      weight: vulnWeight,
      build: () => {
        const eventId = nextId(state, "ev");
        const decId = nextId(state, "dec");
        const firstRaw =
          state.catalog.items.find((i) => i.kind === "raw" || i.kind === "component") ??
          state.catalog.items[0];
        const wh = state.warehouses.sites[0];
        const altSupplier =
          state.supply.suppliers.find((s) => s.id !== primarySupplier.id) ?? primarySupplier;
        const fastLane =
          state.supply.lanes.find((l) => l.mode === "air" || l.mode === "ftl") ??
          state.supply.lanes[0];
        const emergencyQty = Math.max(50, primarySupplier.offers[0]?.moq ?? 100);
        const emergencyCostCents = Math.round(
          emergencyQty * (altSupplier.offers[0]?.unitPrice ?? 2_00) * 1.15,
        );

        const event: ActiveEvent = {
          id: eventId,
          templateId: "supply_shock",
          title: `Toimitushäiriö tukussa: ${primarySupplier.name}`,
          description: `Kuljetusviiveet ja eräpula toimittajalla ${primarySupplier.name} (${primarySupplier.region}) ovat kaksinkertaistaneet toimitusajat ja nostaneet ostohintoja +22% seuraavan 25 päivän ajaksi.`,
          category: "supply",
          severity: 4,
          startTick: tick,
          endTick: tick + 25,
          modifiers: [
            {
              target: "supplier.leadTime",
              scopeId: primarySupplier.id,
              op: "mul",
              value: 1.9,
            },
            {
              target: "supplier.price",
              scopeId: primarySupplier.id,
              op: "mul",
              value: 1.22,
            },
          ],
          rationale:
            singleSourceCount > 0
              ? `Laukesi, koska raaka-aineet ovat vain yhden toimittajan (${primarySupplier.name}) varassa.`
              : `Laukesi alueellisen toimitusketjuhäiriön vuoksi (${primarySupplier.region}).`,
        };

        const decision: DecisionCard = {
          id: decId,
          eventId,
          title: event.title,
          prompt: `${event.description} Päätä miten turvaat raaka-aineiden riittävyyden ilman että kassa tyhjenee.`,
          createdTick: tick,
          deadlineTick: tick + 5,
          status: "pending",
          defaultOptionId: "opt_absorb",
          options: [
            {
              id: "opt_expedite",
              label: `Pikatoimitus & varmuuserän osto (${emergencyQty} ${firstRaw.uom})`,
              description: `Tilaa välitön varmuuserä (${emergencyQty} ${firstRaw.uom} tuotetta ${firstRaw.name}) reitillä ${fastLane.name} toimittajalta ${altSupplier.name}, jotta myynti ei pysähdy.`,
              actions: [
                {
                  type: "PLACE_PURCHASE_ORDER",
                  supplierId: altSupplier.id,
                  itemId: firstRaw.id,
                  qty: emergencyQty,
                  warehouseId: wh.id,
                  laneId: fastLane.id,
                },
              ],
              projected: {
                cashImpact: -emergencyCostCents,
                notes: "Turvaa myynnin ja toimitusvarmuuden; sitoo käteiskassaa heti varastoon.",
              },
            },
            {
              id: "opt_absorb",
              label: "Selviä nykyisellä varastolla ilman lisätilauksia",
              description:
                "Pidä nykyinen ostolinja ja käytä olemassa olevaa varastopuskuria, kunnes tukkutoimitukset normalisoituvat.",
              actions: [{ type: "NOOP", note: "Käytä nykyistä varastopuskuria" }],
              projected: {
                cashImpact: 0,
                notes: "Säästää kassaa tänään, mutta uhkaa loppua kesken jos varasto käy vähiin.",
              },
            },
          ],
        };

        return { event, decision };
      },
    });
  }

  // Vulnerability 2: High warehouse utilization (> 78%)
  const busiestWh = [...state.warehouses.sites].sort(
    (a, b) =>
      Math.max(b.telemetry.utilization, b.telemetry.pickUtilization) -
      Math.max(a.telemetry.utilization, a.telemetry.pickUtilization),
  )[0];
  if (
    busiestWh &&
    Math.max(busiestWh.telemetry.utilization, busiestWh.telemetry.pickUtilization) > 0.78 &&
    (cd.warehouse_gridlock ?? 0) <= tick
  ) {
    candidates.push({
      templateId: "warehouse_gridlock",
      weight: 0.45,
      build: () => {
        const eventId = nextId(state, "ev");
        const decId = nextId(state, "dec");
        // Scale CapEx to business size: e.g. 1 500 € for a small kiosk, up to 45 000 € for an enterprise warehouse
        const upgradeCost = isSmallBiz
          ? Math.max(1_200_00, Math.round((currentCash * 0.15) / 100_00) * 100_00)
          : 45_000_00;
        const upgradeEuros = Math.round(upgradeCost / 100).toLocaleString("fi-FI");

        const event: ActiveEvent = {
          id: eventId,
          templateId: "warehouse_gridlock",
          title: `Tilanahtaus & ruuhka pisteessä ${busiestWh.name}`,
          description: `Säilytys- ja käsittelytilat pisteessä ${busiestWh.name} ovat ruuhkautuneet, mikä hidastaa tavarankäsittelyä ja palvelua 25% seuraavan 20 päivän ajan.`,
          category: "operations",
          severity: 4,
          startTick: tick,
          endTick: tick + 20,
          modifiers: [
            {
              target: "warehouse.pickCapacity",
              scopeId: busiestWh.id,
              op: "mul",
              value: 0.75,
            },
          ],
          rationale: `Laukesi, koska pisteen ${busiestWh.name} täyttö- tai kuormitusaste nousi tasolle ${(Math.max(busiestWh.telemetry.utilization, busiestWh.telemetry.pickUtilization) * 100).toFixed(0)}%.`,
        };

        const decision: DecisionCard = {
          id: decId,
          eventId,
          title: event.title,
          prompt: `${event.description} Jos ruuhkaa ei pureta, asiakaspalvelu ja toimitukset hidastuvat selvästi.`,
          createdTick: tick,
          deadlineTick: tick + 5,
          status: "pending",
          defaultOptionId: "opt_wait_wh",
          options: [
            {
              id: "opt_automate_wh",
              label: `Hanki lisäkalustoa & kylmä-/hyllytilaa (${upgradeEuros} € laitelaina)`,
              description: `Uudista pisteen ${busiestWh.name} laitteisto ja säilytysratkaisut (rahoitetaan kalustolainalla), mikä nostaa käsittelykapasiteettia pysyvästi.`,
              actions: [
                {
                  type: "CAPEX_UPGRADE",
                  targetKind: "warehouse",
                  targetId: busiestWh.id,
                  upgrade: "automation",
                  amount: upgradeCost,
                  financing: "equipment_loan",
                },
              ],
              projected: {
                cashImpact: 0,
                notes: `Lisää ${upgradeEuros} € kalustolainan (0 € välitön kassameno); kasvattaa kapasiteettia pysyvästi +22%.`,
              },
            },
            {
              id: "opt_wait_wh",
              label: "Pura ruuhka käsityöllä ilman uutta lainaa",
              description: "Vältä uutta velkaa ja pura tilanahtaus nykyisillä välineillä seuraavan 3 viikon aikana.",
              actions: [{ type: "NOOP", note: "Pura ruuhka ilman laiteinvestointia" }],
              projected: {
                cashImpact: 0,
                notes: "Ei uutta lainaa, mutta hitaampi palvelu voi kääntää osan asiakkaista pois.",
              },
            },
          ],
        };

        return { event, decision };
      },
    });
  }

  // Vulnerability 3: High work-center utilization (>80%) or low equipment condition (<0.78)
  const stressedWc = [...state.operations.workCenters].sort(
    (a, b) => b.telemetry.utilization - a.telemetry.utilization + (1 - b.condition),
  )[0];
  if (
    stressedWc &&
    (stressedWc.telemetry.utilization > 0.8 || stressedWc.condition < 0.78) &&
    (cd.line_breakdown ?? 0) <= tick
  ) {
    candidates.push({
      templateId: "line_breakdown",
      weight: 0.42,
      build: () => {
        const eventId = nextId(state, "ev");
        const decId = nextId(state, "dec");
        const overhaulCost = isSmallBiz
          ? Math.max(800_00, Math.round((currentCash * 0.12) / 100_00) * 100_00)
          : 30_000_00;
        const overhaulEuros = Math.round(overhaulCost / 100).toLocaleString("fi-FI");
        const overtimeCost = isSmallBiz ? 350_00 : 5_000_00;

        const event: ActiveEvent = {
          id: eventId,
          templateId: "line_breakdown",
          title: `Laite- tai palveluhäiriö pisteessä ${stressedWc.name}`,
          description: `Kova kuormitus ja laitteiden kuluminen pisteessä ${stressedWc.name} aiheuttivat osittaisen vikaantumisen, joka leikkaa päiväkapasiteettia -30% ja lisää hävikkiä 18 päivän ajan.`,
          category: "operations",
          severity: 4,
          startTick: tick,
          endTick: tick + 18,
          modifiers: [
            {
              target: "workCenter.capacity",
              scopeId: stressedWc.id,
              op: "mul",
              value: 0.7,
            },
            {
              target: "workCenter.defectRate",
              scopeId: stressedWc.id,
              op: "add",
              value: 0.04,
            },
          ],
          rationale: `Laukesi korkean käyttöasteen (${(stressedWc.telemetry.utilization * 100).toFixed(0)}%) ja laitteiston kunnon (${(stressedWc.condition * 100).toFixed(0)}%) vuoksi pisteessä ${stressedWc.name}.`,
        };

        const decision: DecisionCard = {
          id: decId,
          eventId,
          title: event.title,
          prompt: `${event.description} Valitse miten palautat pisteen ${stressedWc.name} toimintakyvyn.`,
          createdTick: tick,
          deadlineTick: tick + 5,
          status: "pending",
          defaultOptionId: "opt_overtime",
          options: [
            {
              id: "opt_overhaul",
              label: `Pikahuolto & laitteiston peruskorjaus (${overhaulEuros} € kassasta)`,
              description: `Palauta pisteen ${stressedWc.name} laitteiden kunto 100%:iin ja kasvata päiväkapasiteettia pysyvästi.`,
              actions: [
                {
                  type: "CAPEX_UPGRADE",
                  targetKind: "work_center",
                  targetId: stressedWc.id,
                  upgrade: "maintenance_overhaul",
                  amount: overhaulCost,
                  financing: "cash",
                },
              ],
              projected: {
                cashImpact: -overhaulCost,
                notes: "Palauttaa laitteiston kunnon 100%:iin ja lisää päiväkapasiteettia +12%.",
              },
            },
            {
              id: "opt_overtime",
              label: "Tee lisätunteja / iltavuoro (+4 h/pv)",
              description: `Lisää +4 työtuntia päivässä pisteessä ${stressedWc.name} menetetyn kapasiteetin paikkaamiseksi.`,
              actions: [
                {
                  type: "SET_OVERTIME",
                  workCenterId: stressedWc.id,
                  hoursPerDay: Math.min(
                    stressedWc.maxOvertimeHoursPerDay,
                    stressedWc.overtimeHoursPerDay + 4,
                  ),
                },
              ],
              projected: {
                cashImpact: -overtimeCost,
                notes: "Palauttaa palvelukyvyn heti, mutta lisää ylityökuluja ja tekijöiden väsymystä.",
              },
            },
          ],
        };

        return { event, decision };
      },
    });
  }

  // Vulnerability 4: Predatory competitor price war
  const activeComp = state.market.competitors.find((c) => !c.bankrupt);
  if (activeComp && (cd.price_war ?? 0) <= tick) {
    const primaryOff = state.commercial.offerings[0];
    const primaryMkt = state.commercial.marketing[0];
    const mktBoostDaily = isSmallBiz ? 25_00 : 400_00;
    const mktBoostEuros = Math.round(mktBoostDaily / 100);
    candidates.push({
      templateId: "price_war",
      weight: 0.25,
      build: () => {
        const eventId = nextId(state, "ev");
        const decId = nextId(state, "dec");

        const event: ActiveEvent = {
          id: eventId,
          templateId: "price_war",
          title: `Kilpailija ${activeComp.name} aloitti aggressiivisen hintakampanjan`,
          description: `${activeComp.name} leikkasi hintojaan -18% houkutellakseen asiakkaitasi ja lisäsi asiakkaiden hintatietoisuutta seuraavan 30 päivän ajaksi.`,
          category: "market",
          severity: 3,
          startTick: tick,
          endTick: tick + 30,
          modifiers: [
            {
              target: "competitor.price",
              scopeId: activeComp.id,
              op: "mul",
              value: 0.82,
            },
            {
              target: "segment.priceWeight",
              op: "mul",
              value: 1.2,
            },
          ],
          rationale: `Laukesi, koska kilpailija ${activeComp.name} haastaa myyntikatteesi ja markkinaosuutesi.`,
        };

        const decision: DecisionCard = {
          id: decId,
          eventId,
          title: event.title,
          prompt: `${event.description} Miten vastaat kilpailijan ${activeComp.name} hintahyökkäykseen?`,
          createdTick: tick,
          deadlineTick: tick + 5,
          status: "pending",
          defaultOptionId: "opt_hold_price",
          options: [
            {
              id: "opt_match_discount",
              label: "Vastaa 10% kampanja-alennuksella",
              description: `Aseta 10% kampanja-alennus tuotteelle ${primaryOff.name} puolustaaksesi asiakasvirtaa.`,
              actions: [
                {
                  type: "SET_DISCOUNT",
                  offeringId: primaryOff.id,
                  discountPct: clamp(primaryOff.discountPct + 0.1, 0, 0.35),
                },
              ],
              projected: {
                cashImpact: 0,
                notes: "Puolustaa myyntimäärää ja asiakkaita, mutta pienentää yksikkökatetta.",
              },
            },
            {
              id: "opt_brand_defend",
              label: `Pidä hinta & panosta näkyvyyteen (+${mktBoostEuros} €/pv)`,
              description: `Älä lähde hintasotaan; kasvata kanavan ${primaryMkt?.name ?? "markkinointi"} budjettia laadun ja tunnettuuden vahvistamiseksi.`,
              actions: primaryMkt
                ? [
                    {
                      type: "SET_MARKETING_BUDGET",
                      channelId: primaryMkt.id,
                      dailyBudget: primaryMkt.dailyBudget + mktBoostDaily,
                    },
                  ]
                : [{ type: "NOOP" }],
              projected: {
                cashImpact: -mktBoostDaily * 30,
                notes: "Säilyttää täyden myyntikatteen ja vahvistaa brändiä (Nash-erilaistuminen).",
              },
            },
            {
              id: "opt_hold_price",
              label: "Pidä nykyinen hinta & säästä kassaa",
              description: "Pidä hinnat ennallaan ja hyväksy tilapäinen notkahdus myyntimäärässä.",
              actions: [{ type: "NOOP", note: "Pidä hinnat ennallaan" }],
              projected: {
                cashImpact: 0,
                notes: "Turvaa yksikkökatteen ja kassan; osa hintaherkistä asiakkaista käy kilpailijalla.",
              },
            },
          ],
        };

        return { event, decision };
      },
    });
  }

  if (candidates.length === 0) return;

  // Trigger with ~35% probability on scan day if vulnerabilities exist, unless forced
  if (!opts.forceCrisisOnEvaluation && !rng.chance(0.35)) return;

  const totalW = candidates.reduce((s, c) => s + c.weight, 0);
  let pick = rng.next() * totalW;
  let chosen = candidates[0];
  for (const c of candidates) {
    pick -= c.weight;
    if (pick <= 0) {
      chosen = c;
      break;
    }
  }

  const { event, decision } = chosen.build();
  state.events.active.push(event);
  state.events.decisions.push(decision);
  state.events.director.cooldowns[chosen.templateId] = tick + 75;
  state.events.director.lastEventTick = tick;
  state.events.director.firedCount += 1;
  state.events.log.push({
    tick,
    eventId: event.id,
    templateId: event.templateId,
    title: event.title,
    severity: event.severity,
  });

  pushNotification(
    state,
    event.severity >= 4 ? "critical" : "warning",
    "director",
    `TILANNEHÄLYTYS: ${event.title} — ${event.rationale}`,
  );

  if (!opts.autoResolveDecisions && debitBalance(state.finance.ledger, "cash") >= 0) {
    state.status = "paused_decision";
  }
}

/**
 * Programmatically forces a Director AI stress-test event and decision card.
 * Useful for deterministic testing, debugging, and scenario simulations.
 */
export function triggerDirectorCrisis(
  state: WorldState,
  templateId?: string,
): { event: ActiveEvent; decision: DecisionCard } | null {
  const rng = new SeededRng(state.calendar.tick + 2026);
  const fakeOpts: DirectorOptions = { forceCrisisOnEvaluation: true };
  if (templateId) {
    delete state.events.director.cooldowns[templateId];
  }
  maybeTriggerDirectorCrisis(state, rng, fakeOpts);
  const pending = state.events.decisions.find((d) => d.status === "pending");
  if (!pending) return null;
  const ev = state.events.active.find((e) => e.id === pending.eventId);
  return ev ? { event: ev, decision: pending } : null;
}
