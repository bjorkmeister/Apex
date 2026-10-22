/**
 * APEX Flow — sivupohja ja tyylit (`src/flow/server/page.ts`).
 */

export const FLOW_CSS = `
:root{--bg:#0b1120;--panel:#111a2e;--panel2:#16213a;--line:#24324f;--text:#e2e8f0;--muted:#94a3b8;--ok:#10b981;--warn:#f59e0b;--alert:#ef4444;--accent:#38bdf8;--accent2:#818cf8}
*{box-sizing:border-box}
html,body{margin:0;background:var(--bg);color:var(--text);font:15px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
button{font:inherit;color:inherit;cursor:pointer}
input{font:inherit;color:inherit}
.fl-header{display:flex;align-items:center;gap:16px;padding:12px 20px;border-bottom:1px solid var(--line);background:#0d1527;position:sticky;top:0;z-index:5}
.fl-back{color:var(--muted);text-decoration:none;font-size:13px}
.fl-back:hover{color:var(--text)}
.fl-brand{font-size:17px;letter-spacing:.3px;white-space:nowrap}
.fl-brand b{color:var(--accent)}
.fl-beta{font-size:10px;text-transform:uppercase;background:#1e293b;color:var(--muted);padding:2px 6px;border-radius:6px;margin-left:4px;vertical-align:middle}
.fl-name{flex:1;min-width:120px;max-width:360px;background:transparent;border:1px solid transparent;border-radius:8px;padding:6px 10px;font-size:16px;font-weight:600}
.fl-name:hover,.fl-name:focus{border-color:var(--line);background:var(--panel);outline:none}
.fl-header-actions{margin-left:auto;display:flex;gap:8px;align-items:center}
.fl-btn{background:var(--panel2);border:1px solid var(--line);border-radius:10px;padding:7px 14px;font-size:14px}
.fl-btn:hover{border-color:var(--accent)}
.fl-btn.ghost{background:transparent}
.fl-btn.primary{background:#0e7490;border-color:#0891b2}
.fl-btn.wide{width:100%;margin-top:8px}
.fl-btn[aria-pressed="true"]{border-color:var(--accent);color:var(--accent)}
.fl-main{display:grid;grid-template-columns:minmax(0,1fr) 340px;gap:18px;padding:18px 20px;max-width:1500px;margin:0 auto}
@media (max-width:1050px){.fl-main{grid-template-columns:1fr}}
.fl-stage{display:flex;flex-direction:column;gap:14px;min-width:0}
.fl-headlines{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}
@media (max-width:700px){.fl-headlines{grid-template-columns:1fr}}
.fl-headline{display:flex;flex-direction:column;align-items:flex-start;gap:2px;text-align:left;background:var(--panel);border:1px solid var(--line);border-left:4px solid var(--ok);border-radius:14px;padding:12px 16px}
.fl-headline:hover{border-color:var(--accent)}
.fl-headline.st-warn{border-left-color:var(--warn)}
.fl-headline.st-alert{border-left-color:var(--alert)}
.fl-headline.st-idle{border-left-color:#64748b}
.fl-hl-label{font-size:12px;text-transform:uppercase;letter-spacing:.6px;color:var(--muted)}
.fl-hl-value{font-size:24px;font-weight:700}
.st-alert .fl-hl-value{color:#fca5a5}
.fl-hl-sub{font-size:13px;color:var(--muted)}
.fl-canvas{background:radial-gradient(ellipse at 60% 40%,#13213d 0%,#0d1527 70%);border:1px solid var(--line);border-radius:18px;padding:8px}
.flow-svg{width:100%;height:auto;display:block}
.flow-pipe{fill:none;stroke:#1e3a5f;stroke-width:12;stroke-linecap:round}
.flow-pipe-wide{stroke-width:22;stroke:#3b2f12;cursor:pointer}
.flow-pipe-amount{fill:#fbbf24;font-size:14px;font-weight:600}
.flow-node{cursor:pointer;outline:none}
.flow-node-frame{fill:#111c33;stroke:#10b981;stroke-width:2}
.flow-node:hover .flow-node-frame,.flow-node:focus .flow-node-frame{fill:#16264a}
.flow-node-title{fill:var(--muted);font-size:13px;text-transform:uppercase;letter-spacing:.6px}
.flow-node-value{fill:var(--text);font-size:19px;font-weight:700}
.flow-node-sub{fill:var(--muted);font-size:12.5px}
.flow-node-hint{fill:#475569;font-size:11px}
.flow-tank-frame{fill:#0a1428;stroke:#10b981;stroke-width:3}
.flow-tank:hover .flow-tank-frame,.flow-tank:focus .flow-tank-frame{fill:#0e1b36}
.flow-tank-value{fill:#fff;font-size:20px;font-weight:800;paint-order:stroke;stroke:#0a1428;stroke-width:4px}
.flow-tank-value[data-negative="1"]{fill:#fca5a5}
.flow-dot-demand{fill:#34d399}
.flow-dot-invoice{fill:#fbbf24}
.flow-dot-drain{fill:#f87171}
.flow-dot-lost{fill:#ef4444}
.fl-timeline{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:10px 14px}
.fl-timeline-bar{display:flex;gap:12px;align-items:center;margin-bottom:6px}
.fl-timeline-bar input{flex:1;accent-color:var(--accent)}
.flow-timeline-svg{width:100%;height:120px;display:block;cursor:pointer}
.tl-line{fill:none;stroke:var(--accent);stroke-width:2.5;vector-effect:non-scaling-stroke}
.tl-zero{stroke:#64748b;stroke-dasharray:4 4;vector-effect:non-scaling-stroke}
.tl-negative{fill:rgba(239,68,68,.08)}
.tl-month{stroke:#1e293b;vector-effect:non-scaling-stroke}
.tl-month-label{fill:#475569;font-size:10px}
.tl-cursor{stroke:#fbbf24;stroke-width:1.5;vector-effect:non-scaling-stroke}
.tl-cursor-dot{fill:#fbbf24}
.tl-cashout{fill:var(--alert)}
.tl-cashout-label{fill:#fca5a5;font-size:12px;font-weight:600}
.tl-caption{font-size:13px;color:var(--muted);margin-top:4px}
.fl-side{background:var(--panel);border:1px solid var(--line);border-radius:18px;padding:14px 16px;align-self:start;position:sticky;top:70px;max-height:calc(100vh - 90px);overflow:auto}
.fl-side-head{display:flex;align-items:baseline;justify-content:space-between;margin-bottom:6px}
.fl-side-head h3{margin:0;font-size:16px}
.fl-side-head span{font-size:12px;color:var(--muted)}
.lv-group{margin-top:12px}
.lv-group-title{font-size:12px;text-transform:uppercase;letter-spacing:.6px;color:var(--accent2);margin-bottom:4px}
.lv-row{padding:8px 0;border-bottom:1px solid #1b2742}
.lv-top{display:flex;justify-content:space-between;align-items:baseline;gap:8px}
.lv-top label{font-size:14px}
.lv-top output{font-weight:700;font-variant-numeric:tabular-nums}
.lv-row input[type=range]{width:100%;accent-color:var(--accent);margin:6px 0 2px}
.lv-hint{font-size:12px;color:var(--muted)}
.fl-drawer-backdrop{position:fixed;inset:0;background:rgba(2,6,23,.5);z-index:20}
.fl-drawer{position:fixed;top:0;right:0;height:100vh;width:min(560px,100vw);background:#0f172a;border-left:1px solid var(--line);z-index:21;transform:translateX(100%);transition:transform .22s ease;overflow:auto;box-shadow:-20px 0 40px rgba(0,0,0,.35)}
.fl-drawer.open{transform:none}
@media (prefers-reduced-motion:reduce){.fl-drawer{transition:none}}
.fd-header{display:flex;justify-content:space-between;align-items:center;padding:16px 20px;border-bottom:1px solid var(--line);position:sticky;top:0;background:#0f172a;z-index:1}
.fd-header h2{margin:0;font-size:19px}
.fd-close{background:transparent;border:0;font-size:18px;color:var(--muted)}
.fd-body{padding:6px 20px 40px}
.fd-section{padding:14px 0;border-bottom:1px solid #1b2742}
.fd-section h3{margin:4px 0 8px;font-size:17px}
.fd-section h4{margin:14px 0 8px;font-size:14px;color:var(--accent2);text-transform:uppercase;letter-spacing:.5px}
.fd-section p{margin:6px 0}
.fd-atom-head{display:flex;align-items:center;gap:8px}
.fd-atom-icon{font-size:20px}
.fd-atom-name{flex:1;background:transparent;border:1px solid transparent;border-radius:8px;padding:4px 8px;font-size:16px;font-weight:700}
.fd-atom-name:hover,.fd-atom-name:focus{border-color:var(--line);outline:none}
.fd-atom-kind{font-size:12px;color:var(--muted);margin:2px 0 10px 36px}
.fd-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:8px;margin:8px 0}
.fd-kpis div{background:var(--panel2);border-radius:10px;padding:8px 10px;display:flex;flex-direction:column}
.fd-kpis span{font-size:11.5px;color:var(--muted)}
.fd-kpis b{font-size:15px}
.fd-formula{font:12.5px/1.4 ui-monospace,Menlo,monospace;background:#0b1324;border:1px dashed #2b3b5c;border-radius:8px;padding:6px 10px;margin:8px 0;color:#cbd5e1}
.fd-formula span{font-family:system-ui;font-size:10.5px;text-transform:uppercase;color:var(--muted);margin-right:8px}
.fd-note{font-size:13px;color:var(--muted)}
.fd-warn{font-size:13.5px;color:#fcd34d}
.fd-table{width:100%;border-collapse:collapse;font-size:13.5px;margin:6px 0}
.fd-table th{text-align:left;font-weight:600;color:var(--muted);font-size:12px;padding:6px;border-bottom:1px solid var(--line)}
.fd-table td{padding:6px;border-bottom:1px solid #1b2742;font-variant-numeric:tabular-nums}
.fd-table tr.current td{background:#13213d}
.fd-table-compact td{padding:4px 6px}
.bad{color:#fca5a5}
.good{color:#6ee7b7}
.fd-inputs{display:flex;flex-direction:column;gap:8px;margin:8px 0}
.fd-inputs label{display:flex;justify-content:space-between;align-items:center;gap:10px;font-size:14px}
.fd-input{display:inline-flex;align-items:center;gap:6px}
.fd-input input{width:110px;background:var(--panel2);border:1px solid var(--line);border-radius:8px;padding:5px 8px;text-align:right}
.fd-input input:focus{outline:none;border-color:var(--accent)}
.fd-input em{font-style:normal;font-size:12px;color:var(--muted);white-space:nowrap}
.fd-chips{display:flex;flex-wrap:wrap;gap:8px;margin:8px 0}
.fd-chip{background:var(--panel2);border:1px solid var(--line);border-radius:999px;padding:6px 12px;font-size:13px}
.fd-chip:hover{border-color:var(--accent)}
.fd-chip.small{padding:3px 10px;font-size:12px}
.fd-link-danger{background:none;border:0;color:#f87171;font-size:12.5px}
.fd-icon-btn{background:none;border:0;color:var(--muted)}
.fd-icon-btn:hover{color:#f87171}
.fd-bar{height:14px;background:#1e293b;border-radius:999px;overflow:hidden;margin:6px 0}
.fd-bar-fill{height:100%;background:var(--ok)}
.fd-bar-fill.over{background:var(--alert)}
.fd-bar-legend{display:flex;justify-content:space-between;font-size:12px;color:var(--muted)}
.fd-costs{display:flex;flex-direction:column;gap:6px;margin:8px 0}
.fd-cost-row{display:flex;gap:6px;align-items:center}
.fd-cost-label{flex:1;min-width:0;background:var(--panel2);border:1px solid var(--line);border-radius:8px;padding:5px 8px}
.fd-cost-row .fd-input input{width:84px}
.fd-list{margin:6px 0;padding-left:18px;font-size:13.5px}
.fd-stress{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px}
.fd-stress div{background:var(--panel2);border-radius:10px;padding:10px;display:flex;flex-direction:column}
.fd-stress span{font-size:12px;color:var(--muted)}
.fd-stress b{font-size:18px}
.fd-stress em{font-style:normal;font-size:12px;color:var(--muted)}
.fl-badge{display:inline-block;margin-left:6px;font-size:12px;background:#0e7490;border-radius:999px;padding:1px 8px}
.lp-progress{height:10px;background:#1e293b;border-radius:999px;overflow:hidden}
.lp-progress div{height:100%;background:linear-gradient(90deg,#10b981,#38bdf8)}
.lp-count{float:right;color:var(--muted);font-weight:400}
.lp-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:10px}
.lp-item{background:var(--panel2);border:1px solid var(--line);border-radius:12px;padding:10px 12px}
.lp-item.st-done{opacity:.72}
.lp-item.st-attention{border-color:var(--warn)}
.lp-row{display:flex;gap:10px;align-items:flex-start}
.lp-check{width:20px;height:20px;margin-top:2px;accent-color:var(--ok);flex:none}
.lp-auto{flex:none;width:20px;height:20px;border-radius:50%;border:2px solid #475569;display:inline-flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;color:#475569;margin-top:2px}
.lp-auto.st-done{border-color:var(--ok);color:var(--ok)}
.lp-auto.st-attention{border-color:var(--warn);color:var(--warn)}
.lp-text{flex:1;min-width:0}
.lp-title{font-weight:600}
.lp-tag{font-size:11px;font-weight:400;color:var(--muted);margin-left:8px;border:1px solid var(--line);border-radius:999px;padding:0 6px}
.lp-why{font-size:13px;color:var(--muted);margin:2px 0}
.lp-effect{font-size:13px;color:#7dd3fc}
.lp-note{font-size:13px;color:#fcd34d}
.lp-source{font-size:12px;color:#64748b;margin-top:4px}
.lp-params{display:flex;flex-direction:column;gap:6px;margin:6px 0}
.lp-param{display:flex;justify-content:space-between;align-items:center;gap:8px;font-size:13px}
.ob-main{max-width:860px;margin:0 auto;padding:36px 20px 60px}
.ob-main h1{font-size:30px;margin:0 0 6px}
.ob-main h2{font-size:17px;margin:38px 0 10px;color:var(--muted)}
.ob-lead{color:var(--muted);margin:0 0 18px}
.ob-name{display:flex;flex-direction:column;gap:6px;font-size:13px;color:var(--muted);margin-bottom:16px}
.ob-name input{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:10px 12px;font-size:16px;color:var(--text);max-width:420px}
.ob-cards{display:grid;grid-template-columns:repeat(2,1fr);gap:12px}
@media (max-width:640px){.ob-cards{grid-template-columns:1fr}}
.ob-card{display:flex;flex-direction:column;gap:4px;text-align:left;background:var(--panel);border:2px solid var(--line);border-radius:14px;padding:16px}
.ob-card b{font-size:16px}
.ob-card span{font-size:13px;color:var(--muted)}
.ob-card.on{border-color:var(--accent);background:#0f2440}
.ob-start{margin-top:18px;background:#0e7490;border:0;border-radius:12px;padding:12px 22px;font-size:16px;font-weight:600}
.ob-start:disabled{opacity:.4;cursor:not-allowed}
.ob-presets{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:10px}
.ob-preset{display:flex;flex-direction:column;gap:2px;text-align:left;background:transparent;border:1px solid var(--line);border-radius:12px;padding:12px}
.ob-preset:hover{border-color:var(--accent)}
.ob-preset span{font-size:12.5px;color:var(--muted)}
.ob-foot{font-size:12.5px;color:var(--muted);margin-top:28px}
`;

export function renderFlowPage(): string {
  return `<!DOCTYPE html>
<html lang="fi">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link rel="icon" href="data:," />
  <title>APEX Flow — yrityksesi rahavirrat elävänä</title>
  <style>${FLOW_CSS}</style>
</head>
<body>
  <div id="flow-root"><p style="padding:40px;color:#94a3b8">Ladataan APEX Flow'ta…</p></div>
  <noscript><p style="padding:40px">APEX Flow vaatii JavaScriptin.</p></noscript>
  <script type="module" src="/flow/client/app.ts"></script>
</body>
</html>`;
}
