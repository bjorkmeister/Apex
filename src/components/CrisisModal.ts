/**
 * Director AI Stochastic Crisis & Decision Card Modal.
 * Auto-surfaces when the Director AI triggers a stress-test event and pauses the simulation clock.
 */
import type { WorldState } from "../core/schema";
import { escapeHtml, fmtCurrency } from "./formatters";

export function renderCrisisModal(state: WorldState): string {
  const pending = state.events.decisions.find((d) => d.status === "pending");
  if (!pending) return "";

  const ev = state.events.active.find((e) => e.id === pending.eventId);

  const formatModTargetFi = (target: string): string => {
    switch (target) {
      case "supplier.leadTime":
        return "Tukun toimitusaika";
      case "supplier.price":
        return "Tukun ostohinta";
      case "warehouse.pickCapacity":
        return "Tilojen käsittelykapasiteetti";
      case "workCenter.capacity":
        return "Valmistus- ja palvelukapasiteetti";
      case "workCenter.defectRate":
        return "Hävikki / virheosuus";
      case "competitor.price":
        return "Kilpailijan hinta";
      case "segment.priceWeight":
        return "Asiakkaiden hintaherkkyys";
      default:
        return target;
    }
  };

  return `
    <div class="modal-backdrop">
      <div class="modal-card crisis-modal">
        <div class="crisis-header">
          <div>
            <span class="tag tag-red">⚡ TILANNEHÄLYTYS &amp; PÄÄTÖS • SIMULAATIO PYSÄYTETTY (PÄIVÄ ${state.calendar.tick})</span>
            <h2>${escapeHtml(pending.title)}</h2>
          </div>
          <span class="tag tag-amber">Määräaika: Päivä ${pending.deadlineTick}</span>
        </div>

        <p class="crisis-prompt">${escapeHtml(pending.prompt)}</p>

        ${
          ev
            ? `<div class="crisis-rationale">
                <strong>Havaittu pullonkaula tai riski:</strong> ${escapeHtml(ev.rationale)}
                <div class="sub" style="margin-top:4px">
                  Vaikutus voimassa päivään ${ev.endTick} asti:
                  ${ev.modifiers
                    .map(
                      (m) =>
                        `${formatModTargetFi(m.target)} ${m.op === "mul" ? `×${m.value}` : `+${(m.value * 100).toFixed(0)}%`}`,
                    )
                    .join(" • ")}
                </div>
              </div>`
            : ""
        }

        <div class="crisis-options-grid">
          ${pending.options
            .map(
              (opt) => `
              <div class="crisis-option-card">
                <div class="crisis-option-top">
                  <h4>${escapeHtml(opt.label)}</h4>
                  <span class="mono ${(opt.projected.cashImpact ?? 0) < 0 ? "text-amber" : "text-green"}">
                    ${(opt.projected.cashImpact ?? 0) === 0 ? "0 € välitön kassameno" : `${fmtCurrency(opt.projected.cashImpact ?? 0)} kassavaikutus`}
                  </span>
                </div>
                <p>${escapeHtml(opt.description)}</p>
                <div class="crisis-notes">${escapeHtml(opt.projected.notes)}</div>
                <button class="btn btn-primary btn-block" data-resolve-decision="${pending.id}:${opt.id}">
                  ✓ Toteuta ratkaisu: ${escapeHtml(opt.label)}
                </button>
              </div>
            `,
            )
            .join("")}
        </div>
      </div>
    </div>
  `;
}
