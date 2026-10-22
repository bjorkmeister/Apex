/**
 * Multi-Agent C-Suite War Room Briefing, Competitor CEO Radar & Counterparty Negotiation UI.
 */
import type { NegotiationOutcome, WarRoomBriefing } from "../core/agents";
import { computeGameTheoryAnalysis } from "../core/compiler";
import type { WorldState } from "../core/schema";
import { escapeHtml, fmtCurrency, fmtCurrencyPrecise, fmtPct } from "./formatters";
import type { ClarityMode } from "./ValueChainCanvas";

export function renderWarRoomDebatePanel(
  state: WorldState,
  briefing: WarRoomBriefing,
  lastNegotiation?: NegotiationOutcome | null,
  clarityMode: ClarityMode = "simple",
): string {
  const roleBadgeColor: Record<string, string> = {
    coo: "tag-cyan",
    cfo: "tag-green",
    cro: "tag-amber",
    chro: "tag-blue",
  };
  const roleLabelSimple: Record<string, string> = {
    coo: "ARKI & HANKINNAT",
    cfo: "KASSA & TALOUS",
    cro: "MYYNTI & ASIAKKAAT",
    chro: "TIIMI & JAKSAMINEN",
  };
  const gt = computeGameTheoryAnalysis(state);

  // Inspect actual headcount and hired roles to adapt UI from Solo Entrepreneur -> Small Team -> C-Suite Board
  const getRoleStaff = (roleIdSubstr: string): { count: number; title: string; roleId: string; monthlyCostEuros: number } => {
    const role =
      state.org.roles.find((r) => r.id.toLowerCase().includes(roleIdSubstr)) ??
      state.org.roles[0];
    if (!role) return { count: 0, title: "Työntekijä", roleId: "role_ops", monthlyCostEuros: 2800 };
    const pos = state.org.positions.find((p) => p.roleId === role.id);
    const count = pos ? pos.cohorts.reduce((s, c) => s + c.count, 0) : 0;
    const monthlyCostEuros = Math.round((role.annualSalary * (1 + role.benefitsLoad)) / 1200);
    return { count, title: role.title, roleId: role.id, monthlyCostEuros };
  };

  const totalHeadcount = state.org.positions.reduce(
    (sum, p) => sum + p.cohorts.reduce((s, c) => s + c.count, 0),
    0,
  );
  const isSoloOrMicro = totalHeadcount <= 2;

  // Map the 4 functional areas (coo, cro, cfo, chro) to organization roles
  const opsRole = state.org.roles[1] ?? state.org.roles[0];
  const salesRole = state.org.roles[2] ?? state.org.roles[0];
  const finRole = state.org.roles[3] ?? state.org.roles[0];
  const execRole = state.org.roles[0];

  const getAreaOwnerBadge = (agentRole: string): { isHired: boolean; ownerLabel: string; hireRoleId: string; hireTitle: string; monthlyEuros: number } => {
    const targetRole =
      agentRole === "coo"
        ? opsRole
        : agentRole === "cro"
          ? salesRole
          : agentRole === "cfo"
            ? finRole
            : execRole;
    if (!targetRole) {
      return {
        isHired: false,
        ownerLabel: "👑 Hoidat itse (Yksinyrittäjä)",
        hireRoleId: "role_ops",
        hireTitle: "Apulainen",
        monthlyEuros: 2500,
      };
    }
    const pos = state.org.positions.find((p) => p.roleId === targetRole.id);
    const hc = pos ? pos.cohorts.reduce((s, c) => s + c.count, 0) : 0;
    const monthlyEuros = Math.round((targetRole.annualSalary * (1 + targetRole.benefitsLoad)) / 1200);

    // If total headcount is 1 (just the founder), the founder handles all areas personally
    if (totalHeadcount <= 1 || hc === 0) {
      return {
        isHired: false,
        ownerLabel: "👑 Hoidat itse (Yrittäjä)",
        hireRoleId: targetRole.id,
        hireTitle: targetRole.title,
        monthlyEuros,
      };
    }
    return {
      isHired: true,
      ownerLabel: `👤 Vastuuhenkilö: ${targetRole.title} (${hc} hlö)`,
      hireRoleId: targetRole.id,
      hireTitle: targetRole.title,
      monthlyEuros,
    };
  };

  const soloAreaTitles: Record<string, string> = {
    coo: "Ostot, varasto & päivittäinen tekeminen",
    cfo: "Kassa, laskut & katelaskenta",
    cro: "Asiakashankinta, hinnat & markkinointi",
    chro: "Oma jaksaminen, työvuorot & apukädet",
  };

  const currentCash = state.finance.ledger.balances.cash || state.finance.periodStartCash || 10_000_00;
  const pitchAmountEuros = currentCash < 50_000_00 ? "25 000 €" : "200 000 €";

  return `
    <div class="war-room-stack">
      <!-- CEO / Entrepreneur Synthesis Banner -->
      <div class="consensus-banner">
        <div class="consensus-title">
          <span class="tag tag-cyan">${
            clarityMode === "simple"
              ? isSoloOrMicro
                ? `📓 YRITTÄJÄN MUISTILISTA &amp; TILANNEKUVA (PÄIVÄ ${briefing.tick} • TIIMI: ${totalHeadcount} HLÖ)`
                : `👥 JOHTORYHMÄN &amp; VASTUUALUEIDEN TILANNEKUVA (PÄIVÄ ${briefing.tick} • TIIMI: ${totalHeadcount} HLÖ)`
              : `ENGINE B • MULTI-AGENT WAR ROOM BRIEFING (DAY ${briefing.tick})`
          }</span>
          <button class="btn btn-xs btn-secondary" id="btn-refresh-briefing">${
            clarityMode === "simple" ? "🔄 Päivitä tilannearvio" : "Refresh Debate"
          }</button>
        </div>
        <p>${escapeHtml(briefing.executiveSummary)}</p>
        ${
          clarityMode === "simple" && isSoloOrMicro
            ? `<div style="margin-top:6px;padding:6px 9px;background:rgba(56,189,248,0.1);border:1px solid rgba(56,189,248,0.3);border-radius:6px;font-size:11.5px;color:#bae6fd">
                💡 <strong>Yksinyrittäjä-tila:</strong> Koska tiimissäsi on nyt <b>${totalHeadcount} hlö</b>, alla olevat 4 korttia ovat sinun omia tehtäväalueitasi (Ostot, Kassa, Myynti, Jaksaminen). Kun yrityksesi kasvaa ja palkkaat työntekijöitä tai vastaavia, he ottavat nämä tontit haltuunsa!
              </div>`
            : ""
        }
      </div>

      <!-- 4 Responsibility / C-Suite Agent Cards -->
      <div class="csuite-grid">
        ${briefing.proposals
          .map((prop, idx) => {
            const urgCls =
              prop.priority === "critical"
                ? "tag-red"
                : prop.priority === "high"
                  ? "tag-amber"
                  : "tag-slate";
            const prioLabel =
              clarityMode === "simple"
                ? prop.priority === "critical"
                  ? "KRIITTINEN"
                  : prop.priority === "high"
                    ? "TÄRKEÄ"
                    : "NORMAALI"
                : prop.priority.toUpperCase();
            const ownerInfo = getAreaOwnerBadge(prop.agentRole);
            const displayTitle =
              clarityMode === "simple" && !ownerInfo.isHired
                ? soloAreaTitles[prop.agentRole] ?? prop.agentTitle
                : prop.agentTitle;

            return `
              <div class="agent-card">
                <div class="agent-card-header">
                  <div>
                    <span class="tag ${roleBadgeColor[prop.agentRole] ?? "tag-blue"}">${
                      clarityMode === "simple"
                        ? roleLabelSimple[prop.agentRole] ?? prop.agentRole.toUpperCase()
                        : prop.agentRole.toUpperCase()
                    }</span>
                    <strong>${escapeHtml(displayTitle)}</strong>
                  </div>
                  <span class="tag ${urgCls}">${prioLabel}</span>
                </div>
                <div style="display:flex;justify-content:space-between;align-items:center;margin:3px 0 6px 0;font-size:11px">
                  <span class="${ownerInfo.isHired ? "text-green" : "text-amber"}">${escapeHtml(ownerInfo.ownerLabel)}</span>
                  ${
                    clarityMode === "simple" && !ownerInfo.isHired
                      ? `<button type="button" class="btn btn-xs btn-secondary" style="padding:1px 6px;font-size:10px" data-action='{"type":"HIRE","roleId":"${escapeHtml(ownerInfo.hireRoleId)}","count":1}' title="Palkkaa vastuuhenkilö tälle osa-alueelle (~${ownerInfo.monthlyEuros} €/kk)">
                          + Palkkaa ${escapeHtml(ownerInfo.hireTitle)} (~${ownerInfo.monthlyEuros} €/kk)
                        </button>`
                      : ""
                  }
                </div>
                <div class="agent-kpi">${escapeHtml(prop.kpiFocus)}</div>
                <h4 class="agent-headline">${escapeHtml(prop.headline)}</h4>
                <p class="agent-diag">${escapeHtml(prop.diagnosis)}</p>
                <div class="agent-tradeoff">
                  <strong>${clarityMode === "simple" ? "Huomioitava sivuvaikutus:" : "Cross-Functional Trade-Off:"}</strong> ${escapeHtml(prop.tradeOffWarning)}
                </div>
                <div class="agent-footer">
                  <span class="mono" style="font-size:10px;color:#64748b">${clarityMode === "simple" ? "1-klikkauksen toimenpide" : prop.actions.map((a) => a.type).join(", ")}</span>
                  <button class="btn btn-xs btn-primary" data-agent-proposal-idx="${idx}">
                    ${clarityMode === "simple" ? `✓ Toteuta ehdotus` : `Approve & Execute (${prop.actions.length})`}
                  </button>
                </div>
              </div>
            `;
          })
          .join("")}
      </div>

      <!-- Game Theory & Competitor Counter-Moves -->
      <div class="panel-card" style="margin-top:10px">
        <div class="card-header">
          <div>
            <span class="tag tag-amber">♟️ ${
              clarityMode === "simple"
                ? "PELITEORIA, MARKKINATASAPAINO & KILPAILIJOIDEN SIIRROT"
                : "GAME THEORY & NASH EQUILIBRIUM RADAR"
            }</span>
            <h3>${escapeHtml(gt.regimeName)}</h3>
          </div>
          <span class="tag tag-cyan">${clarityMode === "simple" ? `Hintasotariski ${gt.priceWarRiskPct}%` : `War Risk ${gt.priceWarRiskPct}%`}</span>
        </div>
        <p style="font-size:12px;color:#cbd5e1;margin:4px 0 8px 0;line-height:1.45">${escapeHtml(gt.regimeDescription)}</p>
        <div style="padding:8px 10px;background:#0f172a;border:1px solid #1e293b;border-radius:6px;margin-bottom:8px;font-size:11.5px;color:#94a3b8">
          <strong style="color:#f8fafc">⚖️ ${clarityMode === "simple" ? "Arvoketjun neuvotteluvoima (Stackelberg):" : "Stackelberg Bargaining Power:"}</strong>
          <span> ${escapeHtml(gt.supplierDependencyWarning)}</span>
        </div>

        <table class="fin-table" style="margin-bottom:8px">
          <thead>
            <tr>
              <th>${clarityMode === "simple" ? "Peliteoreettinen skenaario" : "Strategy Profile"}</th>
              <th>${clarityMode === "simple" ? "Vaikutus sinulle & kilpailijoille" : "Payoff Outcomes"}</th>
            </tr>
          </thead>
          <tbody>
            ${[
              { cell: gt.payoffMatrix.differentiateHold, isEq: true },
              { cell: gt.payoffMatrix.differentiateCut, isEq: false },
              { cell: gt.payoffMatrix.undercutHold, isEq: false },
              { cell: gt.payoffMatrix.undercutWar, isEq: false },
            ]
              .map(
                ({ cell, isEq }) => `
                <tr style="${isEq ? "background:rgba(16,185,129,0.12);border-left:3px solid #10b981;" : ""}">
                  <td>
                    <strong>${escapeHtml(cell.title)}</strong>
                    <span class="tag ${isEq ? "tag-green" : "tag-slate"}" style="margin-left:4px">${escapeHtml(cell.tag)}</span>
                  </td>
                  <td style="font-size:11.5px">
                    <div class="${isEq ? "text-green" : ""}">${escapeHtml(cell.playerOutcome)}</div>
                    <div class="sub">${escapeHtml(cell.compOutcome)}</div>
                  </td>
                </tr>
              `,
              )
              .join("")}
          </tbody>
        </table>

        <div class="covenant-list">
          ${state.market.competitors
            .map((comp) => {
              const lastShare =
                comp.shareHistory[comp.shareHistory.length - 1] ?? 0;
              const firstOff = comp.offerings[0];
              const archFi =
                comp.archetype === "cost_leader"
                  ? "Hintahyökkääjä (Bertrand)"
                  : comp.archetype === "premium_artisan"
                    ? "Laatu- & brändikilpailija"
                    : comp.archetype === "fast_follower"
                      ? "Nopea seuraaja (-5%)"
                      : "Alueellinen kilpailija";
              return `
                <div class="covenant-item">
                  <div>
                    <strong>${escapeHtml(comp.name)}</strong>
                    <span class="tag tag-slate">${escapeHtml(clarityMode === "simple" ? archFi : comp.archetype.toUpperCase())}</span>
                    <span class="sub" style="display:block">${escapeHtml(comp.strategyMemo)}</span>
                  </div>
                  <div style="text-align:right">
                    <div class="mono">${clarityMode === "simple" ? "Hinta" : "Price"} ${fmtCurrencyPrecise(firstOff?.price ?? 0)} • ${clarityMode === "simple" ? "Osuus" : "Share"} ${fmtPct(lastShare, 1)}</div>
                    <span class="sub">${clarityMode === "simple" ? "Kassa" : "Cash"} ${fmtCurrency(comp.cash, true)} • ${comp.bankrupt ? "POISTUNUT MARKKINOILTA" : `${clarityMode === "simple" ? "Siirto pv" : "Move T"}${comp.lastMoveTick}`}</span>
                  </div>
                </div>
              `;
            })
            .join("")}
        </div>
      </div>

      <!-- Cross-Functional Debate Transcript -->
      <div class="panel-card" style="margin-top:10px">
        <div class="card-header">
          <div>
            <span class="tag tag-blue">${
              clarityMode === "simple"
                ? isSoloOrMicro
                  ? "YRITTÄJÄN PÄÄTÖSPUNTARI (MYYNTI VS. KASSA VS. TEKEMINEN)"
                  : "JOHTORYHMÄN KESKUSTELU &amp; RISTIRIIDAT"
                : "WAR ROOM DEBATE TRANSCRIPT"
            }</span>
            <h3>${clarityMode === "simple" ? "Näkökulmien vertailu (Myynti vs. Kassa vs. Tuotanto)" : "C-Suite Cross-Functional Argumentation"}</h3>
          </div>
        </div>
        <div class="event-feed">
          ${briefing.debateTranscript
            .map(
              (turn) => `
              <div class="feed-item">
                <span class="tag ${roleBadgeColor[turn.speaker] ?? "tag-slate"}">${
                  clarityMode === "simple"
                    ? roleLabelSimple[turn.speaker] ?? turn.speaker.toUpperCase()
                    : `${turn.speaker.toUpperCase()} (${turn.stance.toUpperCase()})`
                }</span>
                <span>${escapeHtml(turn.message)}</span>
              </div>
            `,
            )
            .join("")}
        </div>
      </div>

      <!-- Counterparty Negotiation Simulator -->
      <div class="panel-card" style="margin-top:10px">
        <div class="card-header">
          <div>
            <span class="tag tag-cyan">${clarityMode === "simple" ? "SOPIMUS- & RAHOITUSNEUVOTTELUT" : "COUNTERPARTY NEGOTIATION SIMULATOR"}</span>
            <h3>${clarityMode === "simple" ? "Neuvottele tukkujen maksuajoista tai kasvurahoituksesta" : "Supplier Terms & Venture Equity Table"}</h3>
          </div>
        </div>
        <div class="inspector-actions">
          ${state.supply.suppliers
            .map(
              (sup) => `
              <button class="btn btn-xs btn-secondary" data-negotiate-supplier="${sup.id}">
                ${clarityMode === "simple" ? `🤝 Neuvottele maksuaika & alennus: ${escapeHtml(sup.name)}` : `Negotiate Net 45 w/ ${escapeHtml(sup.name)}`}
              </button>
            `,
            )
            .join("")}
          <button class="btn btn-xs btn-primary" data-negotiate-investor="vc_growth">
            ${clarityMode === "simple" ? `💶 Neuvottele ${pitchAmountEuros} kasvurahoitus` : "Pitch Growth Round"}
          </button>
        </div>
        ${
          lastNegotiation
            ? `<div class="negotiation-result ${lastNegotiation.accepted ? "neg-ok" : "neg-warn"}">
                <strong>${escapeHtml(lastNegotiation.counterpartyName)} (${
                  lastNegotiation.accepted
                    ? clarityMode === "simple"
                      ? "HYVÄKSYTTY"
                      : "ACCEPTED"
                    : clarityMode === "simple"
                      ? "VASTATARJOUS"
                      : "COUNTER-OFFER"
                }):</strong>
                <p>${escapeHtml(lastNegotiation.responseMessage)}</p>
              </div>`
            : ""
        }
      </div>
    </div>
  `;
}

