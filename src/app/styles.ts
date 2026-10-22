/**
 * AAA Strategy Game & Bloomberg-Style War Room Stylesheet (`/src/app/styles.ts`).
 */
export const WAR_ROOM_CSS = `
:root {
  --bg-deep: #060b16;
  --bg-panel: #0c1426;
  --bg-card: #111c33;
  --bg-hover: #172544;
  --border: #1e2d4a;
  --border-bright: #38bdf8;
  --text-main: #f1f5f9;
  --text-muted: #94a3b8;
  --text-dim: #64748b;
  --cyan: #38bdf8;
  --green: #10b981;
  --amber: #f59e0b;
  --red: #ef4444;
  --blue: #60a5fa;
  --font-sans: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  --font-mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}

* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

body {
  background: var(--bg-deep);
  color: var(--text-main);
  font-family: var(--font-sans);
  font-size: 13px;
  line-height: 1.45;
  overflow-x: hidden;
}

.mono {
  font-family: var(--font-mono);
}

.text-cyan { color: var(--cyan); }
.text-green { color: var(--green); }
.text-amber { color: var(--amber); }
.text-red { color: var(--red); }
.sub { color: var(--text-muted); font-size: 11px; }

.war-room-shell {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  padding: 10px 14px 28px;
  gap: 10px;
}

/* TOP COMMAND BAR */
.topbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: linear-gradient(180deg, #0f1a30 0%, #0a1222 100%);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 10px 14px;
  gap: 12px;
  flex-wrap: wrap;
}

.brand-cluster {
  display: flex;
  align-items: center;
  gap: 12px;
}

.apex-logo {
  background: linear-gradient(135deg, #0284c7, #2563eb);
  color: #fff;
  font-weight: 900;
  font-size: 13px;
  letter-spacing: 0.1em;
  padding: 8px 11px;
  border-radius: 6px;
  box-shadow: 0 0 16px rgba(56, 189, 248, 0.35);
}

.company-title-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.company-title-row h1 {
  font-size: 16px;
  font-weight: 800;
  letter-spacing: -0.01em;
}

.company-tagline {
  color: var(--text-muted);
  font-size: 11.5px;
  margin-top: 2px;
}

.clock-controls {
  display: flex;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
}

.clock-readout {
  display: flex;
  flex-direction: column;
  text-align: right;
}

.clock-label {
  font-size: 9.5px;
  color: var(--text-dim);
  letter-spacing: 0.08em;
  font-weight: 700;
}

.clock-readout strong {
  font-size: 13px;
  color: var(--cyan);
}

.speed-buttons {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

/* COMPILER & PRESETS BAR */
.compiler-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 8px 12px;
  gap: 12px;
  flex-wrap: wrap;
}

.preset-buttons {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.compiler-label {
  font-size: 10px;
  font-weight: 800;
  color: var(--text-muted);
  letter-spacing: 0.08em;
  margin-right: 4px;
}

.compiler-form {
  display: flex;
  flex: 1;
  min-width: 320px;
  gap: 8px;
}

.compiler-input {
  flex: 1;
  background: #060b16;
  border: 1px solid var(--border);
  border-radius: 5px;
  color: var(--text-main);
  padding: 6px 10px;
  font-size: 12px;
}

.compiler-input:focus {
  outline: none;
  border-color: var(--cyan);
}

/* KPI RIBBON */
.kpi-ribbon {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 8px;
}

@media (max-width: 1280px) {
  .kpi-ribbon {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}

.kpi-card {
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: 7px;
  padding: 9px 11px;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.kpi-card label {
  font-size: 9.5px;
  font-weight: 800;
  letter-spacing: 0.07em;
  color: var(--text-dim);
}

.kpi-card strong {
  font-size: 15px;
  font-weight: 800;
}

.kpi-card strong small {
  font-size: 11.5px;
  color: var(--text-muted);
}

/* WORKSPACE GRID */
.workspace-grid {
  display: grid;
  grid-template-columns: minmax(0, 2.25fr) minmax(350px, 1fr);
  gap: 10px;
  align-items: start;
}

@media (max-width: 1200px) {
  .workspace-grid {
    grid-template-columns: 1fr;
  }
}

.main-stage {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.panel-card {
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 12px;
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 10px;
  gap: 8px;
}

.card-header h3 {
  font-size: 14px;
  font-weight: 700;
  margin-top: 2px;
}

/* VALUE CHAIN SVG */
.vc-canvas-wrap {
  width: 100%;
  height: 365px;
  background: #070d1b;
  border: 1px solid #17233b;
  border-radius: 6px;
  overflow: hidden;
}

@keyframes dashFlow {
  to {
    stroke-dashoffset: -32;
  }
}

.vc-flow-edge {
  animation: dashFlow 1.2s linear infinite;
}

.vc-node:hover rect:first-child {
  stroke: #38bdf8;
  filter: drop-shadow(0 0 6px rgba(56, 189, 248, 0.35));
}

.vc-inspector-wrap {
  margin-top: 10px;
}

.inspector-card {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 10px 12px;
}

.inspector-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.inspector-header h4 {
  font-size: 13px;
  margin-top: 2px;
}

.inspector-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
  margin-bottom: 8px;
}

.inspector-grid label {
  display: block;
  font-size: 10px;
  color: var(--text-dim);
}

.inspector-grid strong {
  font-size: 12px;
}

.inspector-actions {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

/* TABS & DRAWERS */
.drawer-tabs {
  display: flex;
  gap: 6px;
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 6px;
  flex-wrap: wrap;
}

.tab-btn {
  flex: 1;
  min-width: 180px;
  background: transparent;
  color: var(--text-muted);
  border: 1px solid transparent;
  border-radius: 5px;
  padding: 8px 10px;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.15s;
}

.tab-btn:hover {
  background: var(--bg-card);
  color: var(--text-main);
}

.tab-btn.active {
  background: #172554;
  color: #fff;
  border-color: var(--cyan);
}

.drawer-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.drawer-grid .span-2 {
  grid-column: span 2;
}

@media (max-width: 1000px) {
  .drawer-grid {
    grid-template-columns: 1fr;
  }
  .drawer-grid .span-2 {
    grid-column: span 1;
  }
}

/* TABLES & METRICS */
.fin-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}

.fin-table th,
.fin-table td {
  padding: 5px 7px;
  border-bottom: 1px solid #162238;
  text-align: left;
}

.fin-table th {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text-dim);
}

.fin-table td:last-child,
.fin-table th:last-child {
  text-align: right;
}

.fin-table .row-section td {
  font-size: 10px;
  font-weight: 800;
  color: var(--cyan);
  background: #091122;
  padding-top: 8px;
  letter-spacing: 0.06em;
}

.fin-table .row-total td {
  font-weight: 700;
  border-top: 1px solid #2b3d63;
  background: rgba(30, 41, 59, 0.35);
}

.fin-table .row-grand td {
  font-weight: 800;
  font-size: 12.5px;
  border-top: 2px solid var(--cyan);
  background: rgba(56, 189, 248, 0.08);
}

.fin-table .row-highlight td {
  background: rgba(56, 189, 248, 0.12);
}

.ccc-metrics-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 10px 0;
  flex-wrap: wrap;
}

.metric-box {
  flex: 1;
  min-width: 140px;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 8px 10px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.metric-box.box-ok { border-color: rgba(16, 185, 129, 0.5); }
.metric-box.box-warn { border-color: rgba(245, 158, 11, 0.6); }

.metric-box label {
  font-size: 10px;
  color: var(--text-dim);
}

.metric-box strong {
  font-size: 15px;
}

.ccc-op {
  font-size: 18px;
  font-weight: 800;
  color: var(--text-dim);
}

.treasury-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 8px;
}

/* SUB-BOXES & PROGRESS BARS */
.sub-box {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 9px 11px;
  margin-bottom: 8px;
}

.sub-box-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
}

.section-sub {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--text-muted);
  margin: 10px 0 6px;
}

.zone-bar-row {
  margin-top: 6px;
}

.zone-bar-label {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  margin-bottom: 3px;
}

.progress-track {
  width: 100%;
  height: 7px;
  background: #080f1e;
  border-radius: 4px;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  border-radius: 4px;
}

.bar-ok { background: var(--green); }
.bar-warn { background: var(--amber); }
.bar-crit { background: var(--red); }

/* C-SUITE WAR ROOM PANEL */
.consensus-banner {
  background: linear-gradient(135deg, #0f1d38 0%, #10192d 100%);
  border: 1px solid #253b63;
  border-radius: 8px;
  padding: 10px 12px;
  margin-bottom: 10px;
}

.consensus-title {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 6px;
}

.consensus-banner p {
  font-size: 12px;
  color: #cbd5e1;
}

.csuite-grid {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.agent-card {
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 10px 12px;
}

.agent-card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 4px;
}

.agent-kpi {
  font-family: var(--font-mono);
  font-size: 10.5px;
  color: var(--cyan);
  margin-bottom: 4px;
}

.agent-headline {
  font-size: 12.5px;
  font-weight: 700;
  margin-bottom: 4px;
}

.agent-diag {
  font-size: 11.5px;
  color: #cbd5e1;
  margin-bottom: 6px;
}

.agent-tradeoff {
  font-size: 11px;
  background: rgba(245, 158, 11, 0.08);
  border-left: 2px solid var(--amber);
  padding: 5px 8px;
  color: #fde68a;
  margin-bottom: 8px;
}

.agent-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  font-size: 10.5px;
  color: var(--text-muted);
}

/* TAGS & BUTTONS */
.tag {
  display: inline-block;
  font-size: 9.5px;
  font-weight: 800;
  letter-spacing: 0.06em;
  padding: 2px 6px;
  border-radius: 4px;
}

.tag-cyan { background: rgba(56, 189, 248, 0.16); color: #38bdf8; border: 1px solid rgba(56, 189, 248, 0.35); }
.tag-green { background: rgba(16, 185, 129, 0.16); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.35); }
.tag-amber { background: rgba(245, 158, 11, 0.16); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.35); }
.tag-red { background: rgba(239, 68, 68, 0.18); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.4); }
.tag-blue { background: rgba(96, 165, 250, 0.16); color: #93c5fd; border: 1px solid rgba(96, 165, 250, 0.35); }
.tag-slate { background: #1e293b; color: #94a3b8; }

.btn {
  border: 1px solid transparent;
  border-radius: 5px;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.12s;
  font-family: var(--font-sans);
}

.btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.btn-xs { padding: 4px 8px; font-size: 11px; }
.btn-sm { padding: 6px 10px; font-size: 11.5px; }
.btn-block { width: 100%; padding: 8px 12px; font-size: 12px; margin-top: 8px; }

.btn-primary {
  background: linear-gradient(180deg, #0284c7 0%, #0369a1 100%);
  color: #fff;
  border-color: #38bdf8;
}

.btn-primary:hover:not(:disabled) {
  background: #0284c7;
  box-shadow: 0 0 10px rgba(56, 189, 248, 0.35);
}

.btn-secondary {
  background: #162238;
  color: #e2e8f0;
  border-color: #2c3e60;
}

.btn-secondary:hover:not(:disabled) {
  background: #1e2f4d;
  border-color: var(--cyan);
}

/* LISTS & FEEDS */
.covenant-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.covenant-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 7px 10px;
  gap: 8px;
}

.event-feed {
  display: flex;
  flex-direction: column;
  gap: 5px;
  max-height: 240px;
  overflow-y: auto;
}

.feed-item {
  font-size: 11.5px;
  padding: 5px 8px;
  border-radius: 4px;
  background: var(--bg-card);
  border-left: 3px solid var(--blue);
}

.feed-warning { border-left-color: var(--amber); }
.feed-critical { border-left-color: var(--red); background: rgba(239, 68, 68, 0.08); }

.negotiation-result {
  margin-top: 8px;
  padding: 8px 10px;
  border-radius: 6px;
  font-size: 11.5px;
}
.neg-ok { background: rgba(16, 185, 129, 0.12); border: 1px solid var(--green); }
.neg-warn { background: rgba(245, 158, 11, 0.12); border: 1px solid var(--amber); }

/* CRISIS MODAL */
.modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(3, 7, 18, 0.82);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  padding: 20px;
}

.modal-card {
  background: #0d1629;
  border: 2px solid var(--red);
  border-radius: 10px;
  max-width: 820px;
  width: 100%;
  padding: 18px 20px;
  box-shadow: 0 20px 50px rgba(0, 0, 0, 0.75);
}

.crisis-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 10px;
}

.crisis-header h2 {
  font-size: 18px;
  margin-top: 4px;
}

.crisis-prompt {
  font-size: 13px;
  color: #e2e8f0;
  margin-bottom: 12px;
}

.crisis-rationale {
  background: rgba(239, 68, 68, 0.1);
  border-left: 3px solid var(--red);
  padding: 8px 12px;
  border-radius: 4px;
  margin-bottom: 14px;
  font-size: 12px;
}

.crisis-options-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.crisis-option-card {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 12px;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
}

.crisis-option-top {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 8px;
  margin-bottom: 6px;
}

.crisis-notes {
  font-size: 11px;
  color: var(--cyan);
  margin-top: 8px;
}

.markdown-preview {
  background: #060b16;
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 12px;
  font-family: var(--font-mono);
  font-size: 11.5px;
  max-height: 400px;
  overflow-y: auto;
  white-space: pre-wrap;
}

.legend-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  display: inline-block;
}
.dot-ok { background: var(--green); }
.dot-warn { background: var(--amber); }
.dot-crit { background: var(--red); }

.empty-hint {
  padding: 16px;
  text-align: center;
  color: var(--text-muted);
  background: var(--bg-card);
  border-radius: 6px;
  border: 1px dashed var(--border);
}

.compiler-select {
  background: #060b16;
  border: 1px solid var(--border);
  border-radius: 5px;
  color: var(--cyan);
  padding: 6px 8px;
  font-size: 11.5px;
  font-family: var(--font-mono);
}

.pipeline-status-strip {
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: #091122;
  border: 1px solid var(--border);
  border-radius: 7px;
  padding: 7px 12px;
  gap: 10px;
  flex-wrap: wrap;
}

.pipeline-steps-row {
  display: flex;
  align-items: center;
  gap: 5px;
  flex-wrap: wrap;
}

.pipeline-pill {
  background: var(--bg-card);
  border: 1px solid var(--border);
  color: #cbd5e1;
  font-family: var(--font-mono);
  font-size: 10.5px;
  padding: 2px 7px;
  border-radius: 4px;
}

.pipeline-arrow {
  color: var(--cyan);
  font-size: 11px;
  font-weight: 700;
}

.trigger-badges-row {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.tag-blue {
  background: rgba(96, 165, 250, 0.14);
  color: var(--blue);
  border: 1px solid rgba(96, 165, 250, 0.35);
}

.tag-xs {
  font-size: 8.5px;
  padding: 1px 5px;
}

/* BYOK LLM CONFIG MODAL */
.llm-config-modal {
  border: 2px solid var(--cyan);
  max-width: 680px;
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 8px;
}

.modal-title-cluster h2 {
  font-size: 17px;
  font-weight: 800;
  margin-top: 4px;
}

.modal-subtitle {
  color: var(--text-muted);
  font-size: 11.5px;
  margin-bottom: 14px;
  line-height: 1.4;
}

.provider-pill-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  margin-bottom: 16px;
}

.provider-pill {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 10px;
  text-align: left;
  cursor: pointer;
  color: var(--text-main);
  transition: all 0.15s ease;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.provider-pill:hover {
  background: var(--bg-hover);
  border-color: var(--border-bright);
}

.provider-pill.selected {
  background: rgba(56, 189, 248, 0.08);
  border-color: var(--cyan);
  box-shadow: 0 0 10px rgba(56, 189, 248, 0.2);
}

.provider-pill-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.provider-pill-top strong {
  font-size: 12.5px;
}

.provider-pill-sub {
  color: var(--text-muted);
  font-size: 10.5px;
}

.llm-config-form {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.form-label-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 12px;
  font-weight: 700;
}

.key-input-wrapper {
  display: flex;
  gap: 6px;
}

.form-input {
  flex: 1;
  background: #060b16;
  border: 1px solid var(--border);
  border-radius: 5px;
  color: #fff;
  padding: 8px 10px;
  font-size: 12px;
}

.form-input:focus {
  outline: none;
  border-color: var(--cyan);
  box-shadow: 0 0 8px rgba(56, 189, 248, 0.25);
}

.form-select {
  width: 100%;
  background: #060b16;
  border: 1px solid var(--border);
  border-radius: 5px;
  color: #fff;
  padding: 8px 10px;
  font-size: 12px;
}

.form-select:focus {
  outline: none;
  border-color: var(--cyan);
}

.model-select-wrapper {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.form-help-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 11px;
}

.link-help {
  color: var(--cyan);
  text-decoration: none;
  font-weight: 600;
}

.link-help:hover {
  text-decoration: underline;
}

.test-banner {
  padding: 8px 12px;
  border-radius: 6px;
  font-size: 11.5px;
  font-family: var(--font-mono);
  display: flex;
  align-items: center;
  gap: 8px;
}

.test-banner-ok {
  background: rgba(16, 185, 129, 0.15);
  border: 1px solid var(--green);
  color: #34d399;
}

.test-banner-err {
  background: rgba(239, 68, 68, 0.15);
  border: 1px solid var(--red);
  color: #f87171;
}

.test-banner-loading {
  background: rgba(56, 189, 248, 0.15);
  border: 1px solid var(--cyan);
  color: #38bdf8;
}

.modal-actions-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 8px;
  padding-top: 10px;
  border-top: 1px solid var(--border);
}

.actions-right {
  display: flex;
  gap: 8px;
}

.btn-llm-pill {
  cursor: pointer;
  background: rgba(15, 23, 42, 0.8);
  border: 1px solid var(--border);
  border-radius: 5px;
  padding: 3px 8px;
  font-size: 10px;
  font-weight: 700;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  transition: all 0.15s ease;
}

.btn-llm-pill:hover {
  border-color: var(--cyan);
  background: #172544;
}

/* GENESIS STUDIO & CANVAS STYLING */
.genesis-shell {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  padding: 12px 18px 36px;
  gap: 16px;
  background: radial-gradient(circle at 50% 10%, #0e1a32 0%, #060b16 70%);
}

.genesis-topbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: rgba(15, 26, 48, 0.7);
  backdrop-filter: blur(8px);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 12px 16px;
}

.genesis-title {
  font-size: 13px;
  font-weight: 800;
  letter-spacing: 0.05em;
  color: var(--text-main);
}

.genesis-hero-container {
  display: flex;
  justify-content: center;
  align-items: center;
  flex: 1;
  padding: 20px 0;
}

.genesis-hero-card {
  max-width: 860px;
  width: 100%;
  background: #0a1324;
  border: 1px solid #233556;
  border-radius: 12px;
  padding: 32px 36px;
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.6);
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.genesis-badge-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.genesis-hero-h1 {
  font-size: 28px;
  font-weight: 900;
  letter-spacing: -0.02em;
  line-height: 1.25;
  color: #fff;
}

.genesis-hero-p {
  font-size: 14px;
  line-height: 1.6;
  color: #cbd5e1;
}

.genesis-spark-form {
  display: flex;
  flex-direction: column;
  gap: 14px;
  margin-top: 6px;
}

.prompt-input-wrapper {
  display: flex;
  flex-direction: column;
}

.genesis-textarea {
  width: 100%;
  background: #050a14;
  border: 1.5px solid #2a3d60;
  border-radius: 8px;
  color: #fff;
  padding: 14px 16px;
  font-size: 14px;
  font-family: var(--font-sans);
  line-height: 1.5;
  resize: vertical;
  transition: all 0.15s ease;
}

.genesis-textarea:focus {
  outline: none;
  border-color: var(--cyan);
  box-shadow: 0 0 16px rgba(56, 189, 248, 0.25);
}

.inspiration-container {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.inspiration-pills {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
}

.btn-pill {
  background: #111e36;
  border: 1px solid #233556;
  border-radius: 20px;
  color: #94a3b8;
  padding: 6px 12px;
  font-size: 11.5px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.12s ease;
}

.btn-pill:hover {
  background: #192b4d;
  color: var(--cyan);
  border-color: var(--cyan);
}

.genesis-form-actions {
  display: flex;
  justify-content: flex-start;
  margin-top: 6px;
}

.btn-lg {
  padding: 12px 22px;
  font-size: 14px;
  font-weight: 800;
}

.genesis-sandbox-section {
  margin-top: 18px;
  padding-top: 18px;
  border-top: 1px solid #1a2944;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.sandbox-divider {
  font-size: 10.5px;
  font-weight: 800;
  letter-spacing: 0.08em;
  color: var(--text-dim);
}

.sandbox-cards-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}

.sandbox-card {
  background: #0d172b;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 12px;
  text-align: left;
  cursor: pointer;
  color: var(--text-main);
  transition: all 0.15s ease;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.sandbox-card:hover {
  background: #162544;
  border-color: var(--cyan);
  transform: translateY(-2px);
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.4);
}

.sandbox-card-top {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
}

.sandbox-desc {
  font-size: 11px;
  color: var(--text-muted);
  line-height: 1.35;
}

.sandbox-action-row {
  margin-top: auto;
  font-size: 11px;
  font-weight: 700;
}

/* CANVAS VIEW */
.canvas-main-container {
  max-width: 1080px;
  width: 100%;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.canvas-breadcrumbs {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  font-weight: 700;
  padding: 6px 12px;
  background: #091222;
  border: 1px solid var(--border);
  border-radius: 6px;
  width: fit-content;
}

.breadcrumb-step {
  color: var(--text-dim);
}

.breadcrumb-step.done {
  color: var(--green);
}

.breadcrumb-step.active {
  color: var(--cyan);
}

.breadcrumb-arrow {
  color: var(--text-dim);
}

.canvas-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}

.canvas-card {
  background: #0a1324;
  border: 1px solid #1e2f4f;
  border-radius: 10px;
  padding: 18px 20px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.canvas-card-header {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.canvas-card-header h3 {
  font-size: 16px;
  font-weight: 800;
  color: #fff;
}

.canvas-tagline {
  font-size: 12.5px;
  color: var(--cyan);
  font-style: italic;
}

.archetype-info-box {
  background: #050a14;
  border: 1px solid #1a2a44;
  border-radius: 6px;
  padding: 10px 12px;
}

.archetype-badge-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

/* Role Selector Grid */
.role-selector-grid {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.role-card {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  background: #060c18;
  border: 1px solid #1a2a44;
  border-radius: 6px;
  padding: 10px 12px;
  cursor: pointer;
  transition: all 0.12s ease;
}

.role-card:hover {
  background: #0c162b;
  border-color: #2e446d;
}

.role-card.selected {
  background: rgba(56, 189, 248, 0.08);
  border-color: var(--cyan);
  box-shadow: 0 0 10px rgba(56, 189, 248, 0.2);
}

.role-card input[type="radio"] {
  margin-top: 3px;
}

.role-card-body {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.role-card-body strong {
  font-size: 12.5px;
}

.custom-role-input {
  width: 100%;
  margin-top: 6px;
  background: #091322;
  border: 1px solid #1e3a5f;
  border-radius: 4px;
  padding: 6px 10px;
  font-size: 12px;
  color: #e2e8f0;
  transition: all 0.15s ease;
}

.custom-role-input:focus {
  outline: none;
  border-color: var(--cyan);
  box-shadow: 0 0 8px rgba(56, 189, 248, 0.25);
}

/* Capability toggles list */
.capability-toggles-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.cap-toggle-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: #060c18;
  border: 1px solid #1a2a44;
  border-radius: 6px;
  padding: 10px 12px;
  gap: 12px;
}

.cap-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.cap-switch-group {
  display: flex;
  gap: 4px;
}

/* Economics Summary Grid */
.economics-summary-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.econ-box {
  background: #060c18;
  border: 1px solid #1a2a44;
  border-radius: 6px;
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.econ-box label {
  font-size: 9px;
  font-weight: 800;
  letter-spacing: 0.08em;
  color: var(--text-dim);
}

.econ-box strong {
  font-size: 14px;
}

/* Ignition Footer */
.canvas-ignition-footer {
  background: linear-gradient(90deg, #0f1c36 0%, #17284d 100%);
  border: 1.5px solid var(--border-bright);
  border-radius: 10px;
  padding: 18px 24px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 20px;
  box-shadow: 0 8px 24px rgba(56, 189, 248, 0.2);
}

.ignition-text h4 {
  font-size: 17px;
  font-weight: 800;
  color: #fff;
  margin-bottom: 3px;
}

.btn-ignition {
  background: linear-gradient(135deg, #0284c7 0%, #2563eb 100%);
  border: 1px solid var(--cyan);
  box-shadow: 0 0 20px rgba(56, 189, 248, 0.4);
  white-space: nowrap;
}

.btn-ignition:hover {
  box-shadow: 0 0 28px rgba(56, 189, 248, 0.7);
  transform: scale(1.02);
}

/* FOOTBALL MANAGER ASSUMPTION (*) & DEPENDENCY NETWORK EXPLORER */
.assumption-pill-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 10px;
}

.assumption-pill {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: rgba(245, 158, 11, 0.14);
  border: 1px dashed rgba(251, 191, 36, 0.65);
  color: #fde68a;
  font-family: var(--font-mono);
  font-size: 11px;
  font-weight: 700;
  padding: 3px 8px;
  border-radius: 5px;
  cursor: pointer;
  transition: all 0.14s ease;
}

.assumption-pill:hover {
  background: rgba(245, 158, 11, 0.28);
  border-color: #fbbf24;
  color: #ffffff;
  transform: translateY(-1px);
}

.assumption-pill-inline {
  padding: 1px 6px;
  font-size: 11px;
  vertical-align: baseline;
}

.assumption-pill-verified {
  background: rgba(16, 185, 129, 0.14);
  border: 1px solid rgba(16, 185, 129, 0.55);
  color: #a7f3d0;
}

.assumption-pill-active {
  background: rgba(56, 189, 248, 0.22);
  border: 1.5px solid #38bdf8;
  color: #ffffff;
  box-shadow: 0 0 12px rgba(56, 189, 248, 0.35);
}

.fm-dependency-panel {
  border: 1px solid rgba(251, 191, 36, 0.45);
  background: linear-gradient(135deg, #0d1629 0%, #09101f 100%);
}

.fm-inspector-body {
  display: grid;
  grid-template-columns: 1.25fr 1fr 1fr;
  gap: 10px;
}

.fm-inspector-col {
  background: #070d19;
  border: 1px solid #1e293b;
  border-radius: 8px;
  padding: 10px 12px;
}

.fm-col-title {
  font-size: 10.5px;
  font-weight: 800;
  letter-spacing: 0.06em;
  color: #94a3b8;
  text-transform: uppercase;
  margin-bottom: 6px;
}

.fm-dep-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.fm-dep-item {
  background: #0c1526;
  border: 1px solid #1e293b;
  border-radius: 6px;
  padding: 7px 9px;
  transition: border-color 0.14s ease, background 0.14s ease;
}

.fm-dep-item:hover {
  border-color: #38bdf8;
  background: #111e36;
}

/* PROGRESSIVE DISCLOSURE (<details>) */
.fm-progressive-drawer {
  background: #0a1222;
  border: 1px solid #1e293b;
  border-radius: 8px;
  padding: 8px 12px;
}

.fm-progressive-summary {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  cursor: pointer;
  list-style: none;
  user-select: none;
}

.fm-progressive-summary::-webkit-details-marker {
  display: none;
}
`;

