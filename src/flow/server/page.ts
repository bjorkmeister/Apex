/**
 * APEX Studio — sivupohja ja tyylit (`src/flow/server/page.ts`).
 */

export const FLOW_CSS = `
:root{
  --bg-deep:#060b16;--bg-panel:#0c1426;--bg-card:#111c33;--bg-hover:#172544;
  --border:#1e2d4a;--border-bright:#38bdf8;
  --text-main:#f1f5f9;--text-muted:#94a3b8;--text-dim:#64748b;
  --font-sans:"Inter",-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
  --font-mono:"JetBrains Mono","Fira Code",ui-monospace,SFMono-Regular,Menlo,monospace;
  --st-healthy:#10b981;--st-warning:#f59e0b;--st-critical:#ef4444;
  --dom-demand:#38bdf8;--dom-value:#60a5fa;--dom-enabling:#818cf8;
  --dom-application:#a78bfa;--dom-finance:#34d399;--dom-people:#f472b6;
  --bg:var(--bg-deep);--panel:var(--bg-panel);--panel2:var(--bg-card);
  --line:var(--border);--text:var(--text-main);--muted:var(--text-muted);
  --ok:var(--st-healthy);--warn:var(--st-warning);--alert:var(--st-critical);
  --accent:var(--border-bright);--accent2:var(--dom-enabling)
}
*{box-sizing:border-box}
html,body{margin:0;background:var(--bg-deep);color:var(--text-main);font:15px/1.45 var(--font-sans);font-variant-numeric:tabular-nums}
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
.flow-node.dim{opacity:.32}
.fl-persona{display:flex;align-items:center;gap:6px;font-size:12px;color:var(--muted)}
.fl-persona select{background:var(--panel2);border:1px solid var(--line);border-radius:8px;color:var(--text);padding:5px 8px;font:inherit;font-size:13px}
.fl-btn:disabled{opacity:.4;cursor:not-allowed}
.fl-subheader{display:flex;align-items:center;gap:16px;flex-wrap:wrap;padding:8px 20px;border-bottom:1px solid var(--line);background:#0c1424}
.fl-lens{display:inline-flex;border:1px solid var(--line);border-radius:10px;overflow:hidden}
.fl-lens-btn{background:transparent;border:0;padding:6px 14px;font-size:13px;color:var(--muted)}
.fl-lens-btn[aria-pressed="true"]{background:#0e7490;color:#fff}
.fl-boundary{display:flex;flex-direction:column;gap:2px;font-size:12.5px;color:#fcd34d}
.fl-quickstress{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:13px;color:var(--muted)}
.co-strip{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:10px;align-items:stretch}
.co-card{background:var(--panel);border:1px solid var(--line);border-left:4px solid var(--accent2);border-radius:12px;padding:10px 14px;display:flex;flex-direction:column;gap:4px}
.co-card.sev-alert{border-left-color:var(--alert)}
.co-card.sev-warn{border-left-color:var(--warn)}
.co-card.sev-good{border-left-color:var(--ok)}
.co-card + .co-card{margin-top:0}
.fd-section .co-card{margin-top:8px}
.co-title{font-weight:700;font-size:14.5px}
.co-body{font-size:13.5px;color:#cbd5e1}
.co-card.compact .co-body{display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.co-learn{font-size:12.5px;color:#a5b4fc;background:#141c38;border-radius:8px;padding:6px 8px}
.co-actions{display:flex;flex-wrap:wrap;gap:6px;margin-top:2px}
.co-open{grid-column:1/-1;justify-self:start;background:transparent;border:1px dashed var(--line);border-radius:10px;padding:6px 12px;color:var(--accent);font-size:13.5px}
.co-open:hover{border-color:var(--accent)}
.co-log{display:flex;flex-direction:column;gap:8px;max-height:46vh;overflow:auto;padding:4px 2px}
.co-msg{max-width:88%;padding:8px 12px;border-radius:12px;font-size:14px}
.co-text{white-space:pre-wrap}
.co-msg.user{align-self:flex-end;background:#0e7490}
.co-msg.coach{align-self:flex-start;background:var(--panel2);border:1px solid var(--line)}
.co-msg.pending{opacity:.6;font-style:italic}
.co-applied{margin:6px 0 0;padding-left:4px;list-style:none;font-size:12.5px;color:#6ee7b7}
.co-note{font-size:12px;color:#fcd34d;margin-top:4px}
.co-source{font-size:10.5px;color:#64748b;margin-top:4px;text-transform:uppercase;letter-spacing:.4px}
.co-form{display:flex;gap:8px;margin-top:10px}
.co-form input{flex:1;background:var(--panel2);border:1px solid var(--line);border-radius:10px;padding:9px 12px;font-size:14px}
.co-form input:focus{outline:none;border-color:var(--accent)}
.fl-toast{position:fixed;left:50%;bottom:24px;transform:translateX(-50%) translateY(20px);background:#0e7490;color:#fff;padding:10px 18px;border-radius:12px;font-size:14px;opacity:0;pointer-events:none;transition:opacity .2s,transform .2s;z-index:30;max-width:min(680px,90vw)}
.fl-toast.show{opacity:1;transform:translateX(-50%)}
.ob-step{font-size:13px;color:var(--muted);margin-bottom:8px}
.ob-personas{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:28px}
.ob-persona{background:transparent;border:1px solid var(--line);border-radius:999px;padding:6px 14px;font-size:13.5px}
.ob-persona.on{border-color:var(--accent);background:#0f2440;color:#fff}
.im-list{display:flex;flex-direction:column;gap:6px}
.im-row{display:flex;align-items:center;gap:10px;background:var(--panel2);border:1px solid var(--line);border-radius:10px;padding:8px 10px;font-size:14px;margin:6px 0}
.im-row input{width:18px;height:18px;accent-color:var(--ok);flex:none}
.im-label{flex:1;display:flex;flex-direction:column}
.im-label em{font-style:normal;font-size:12px;color:var(--muted)}
.im-label em.im-dup{color:#fcd34d}
.fl-lang{display:inline-flex;border:1px solid var(--line);border-radius:8px;overflow:hidden}
.fl-lang-btn{background:transparent;border:0;padding:5px 9px;font-size:12px;color:var(--muted)}
.fl-lang-btn[aria-pressed="true"]{background:#0e7490;color:#fff}
.fl-menu{position:relative}
.fl-menu>summary{list-style:none;cursor:pointer}
.fl-menu>summary::-webkit-details-marker{display:none}
.fl-menu-body{position:absolute;right:0;top:calc(100% + 6px);background:#0f172a;border:1px solid var(--line);border-radius:12px;padding:6px;display:flex;flex-direction:column;min-width:220px;z-index:15;box-shadow:0 10px 30px rgba(0,0,0,.4)}
.fl-toolbar .fl-menu-body{left:0;right:auto}
.fl-menu-body a,.fl-menu-body button{display:block;text-align:left;background:transparent;border:0;color:var(--text);padding:8px 10px;border-radius:8px;text-decoration:none;font-size:14px}
.fl-menu-body a:hover,.fl-menu-body button:hover{background:var(--panel2)}
.fl-toolbar{display:flex;gap:6px;flex-wrap:wrap;padding:8px 20px;border-bottom:1px solid var(--line);background:#0c1424}
.fl-tool{background:transparent;border:1px solid transparent;border-radius:999px;padding:5px 12px;font-size:13.5px;color:#cbd5e1}
.fl-tool:hover{border-color:var(--line);background:var(--panel)}
.fl-goals{display:flex;gap:6px;flex-wrap:wrap}
.fl-goal{background:var(--panel2);border:1px solid var(--line);border-radius:999px;padding:3px 10px;font-size:12.5px}
.fl-goal.ok{border-color:#065f46;color:#6ee7b7}
.fl-goal.bad{border-color:#7f1d1d;color:#fca5a5}
.fl-subheader[hidden]{display:none}
.pv{font-size:9px;vertical-align:middle;margin-left:2px;cursor:help}
.pv-preset{color:#475569}.pv-user{color:#38bdf8}.pv-coach{color:#a78bfa}.pv-import{color:#fbbf24}.pv-market{color:#34d399}.pv-launchpad{color:#f472b6}.pv-genesis{color:#c084fc}.pv-widget{color:#fb923c}
.pv-legend{margin-top:10px;line-height:1.8}
.fd-dim{color:var(--muted);font-size:12px;font-style:normal}
.warn{color:#fcd34d}
.fl-drawer.wide{width:min(760px,100vw)}
.tl-event{fill:rgba(251,191,36,.10)}
.tl-event-label{fill:#fbbf24;font-size:10px}
.tl-overlay{fill:none;stroke-width:2;stroke-dasharray:6 4;vector-effect:non-scaling-stroke;opacity:.9}
.tl-legend{display:inline-flex;gap:12px;margin-left:14px}
.tl-legend i,.wg-legend i{display:inline-block;width:10px;height:3px;margin-right:4px;vertical-align:middle}
.wg-strip{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:10px}
.wg-card{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:10px 12px;display:flex;flex-direction:column;gap:4px;min-width:0}
.wg-card.kind-chart,.wg-card.kind-table{grid-column:span 2}
@media (max-width:700px){.wg-card.kind-chart,.wg-card.kind-table{grid-column:auto}}
.wg-card.active{border-color:var(--warn)}
.wg-head{display:flex;align-items:center;gap:6px}
.wg-title{font-size:12px;text-transform:uppercase;letter-spacing:.5px;color:var(--muted);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.wg-ai{font-size:12px}
.wg-x{background:none;border:0;color:#475569;font-size:12px;padding:0 2px}
.wg-x:hover{color:#f87171}
.wg-value{font-size:22px;font-weight:700}
.wg-alert{font-size:13.5px;border-radius:8px;padding:6px 8px;background:#3b2f12;color:#fde68a}
.wg-alert.sev-alert{background:#3f1515;color:#fecaca}
.wg-alert.sev-info{background:#10233f;color:#bae6fd}
.wg-ok{font-size:13px;color:#6ee7b7}
.wg-error{font-size:12.5px;color:#fca5a5}
.wg-chart{width:100%;height:90px;display:block}
.wg-range,.wg-legend{display:flex;justify-content:space-between;gap:10px;font-size:11px;color:var(--muted)}
.wg-table{width:100%;font-size:13px;border-collapse:collapse}
.wg-table td{padding:3px 0;border-bottom:1px solid #1b2742}
.wg-table td:last-child{text-align:right;font-weight:600}
.wg-card input[type=range]{width:100%;accent-color:var(--accent)}
.wg-tpls{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:8px;margin:8px 0}
.wg-tpl{display:flex;flex-direction:column;gap:2px;text-align:left;background:var(--panel2);border:1px solid var(--line);border-radius:10px;padding:8px 10px}
.wg-tpl:hover{border-color:var(--accent)}
.wg-tpl span{font-size:12px;color:var(--muted)}
.wg-row{display:flex;gap:10px;align-items:flex-start;padding:8px 0;border-bottom:1px solid #1b2742}
.wg-row-main{flex:1;min-width:0}
.wg-row-title{font-weight:600}
.wg-formula{width:100%;margin-top:4px;background:#0b1324;border:1px solid var(--line);border-radius:8px;padding:5px 8px;font:12.5px ui-monospace,Menlo,monospace;color:#cbd5e1}
.wg-switch{position:relative;display:inline-block;width:36px;height:20px;flex:none;margin-top:2px}
.wg-switch input{opacity:0;width:0;height:0}
.wg-switch span{position:absolute;inset:0;background:#334155;border-radius:999px;transition:background .15s}
.wg-switch span::after{content:"";position:absolute;width:14px;height:14px;left:3px;top:3px;background:#fff;border-radius:50%;transition:transform .15s}
.wg-switch input:checked+span{background:var(--ok)}
.wg-switch input:checked+span::after{transform:translateX(16px)}
.wg-vocab{font-size:12.5px;columns:2;padding-left:16px}
.wg-vocab code{color:#7dd3fc}
.sc-list{display:flex;flex-direction:column;margin-top:10px}
.sc-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:6px 0;border-bottom:1px solid #1b2742}
.sc-actions{margin-left:auto;display:flex;gap:6px;align-items:center}
.sc-row>.fd-icon-btn{margin-left:auto}
.sc-dot{display:inline-block;width:10px;height:10px;border-radius:50%;margin-right:6px;vertical-align:middle}
.ss-grid{display:grid;grid-template-columns:repeat(12,1fr);gap:4px;margin:10px 0;align-items:end}
.ss-col{display:flex;flex-direction:column;align-items:center;gap:4px;font-size:11px;color:var(--muted)}
.ss-bar{width:100%;background:linear-gradient(180deg,#38bdf8,#0369a1);border-radius:4px 4px 0 0;min-height:2px}
.ss-col .fd-input input{width:100%;padding:3px 2px;text-align:center;font-size:12px}
.cr-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:8px}
.cr-card{display:flex;flex-direction:column;gap:4px;background:var(--panel2);border:1px solid var(--line);border-radius:10px;padding:10px}
.cr-card span{font-size:12.5px;color:#cbd5e1}
.cr-card em{font-style:normal;font-size:12px;color:#fbbf24}
.cr-card .fd-chip{align-self:flex-start}
.tk-list{display:flex;flex-direction:column;gap:10px}
.tk-card{background:var(--panel2);border:1px solid var(--line);border-radius:12px;padding:10px 12px}
.tk-card.active{border-color:var(--accent)}
.tk-card p{margin:4px 0;font-size:13.5px}
.tk-head{display:flex;gap:8px;align-items:center}
.tk-banner{display:flex;gap:10px;align-items:center;flex-wrap:wrap;background:#10233f;border:1px solid #1d4ed8;border-radius:12px;padding:8px 12px;font-size:13.5px}
.tk-banner.done{background:#052e1f;border-color:#10b981}
.tk-progress{color:var(--muted)}
.ad-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:10px}
.ad-card{background:var(--panel2);border:1px solid var(--line);border-left:4px solid var(--ok);border-radius:12px;padding:10px 12px}
.ad-card.stance-concern{border-left-color:var(--warn)}
.ad-card.stance-alarm{border-left-color:var(--alert)}
.ad-head{display:flex;gap:8px;align-items:center;margin-bottom:4px}
.ad-head b{flex:1}
.mk-row{background:var(--panel2);border:1px solid var(--line);border-radius:10px;padding:8px 10px;margin:8px 0}
.mk-row a,.rp-preview a,.fd-list a{color:#7dd3fc}
.rp-preview h2{font-size:20px;margin:10px 0}
.rp-preview h3{font-size:16px;margin:18px 0 6px;color:var(--accent2)}
.rp-preview h4{font-size:14px;margin:12px 0 4px}
.rp-preview ul{padding-left:18px;font-size:13.5px}
.rp-preview p{font-size:13.5px}
.ob-idea{width:100%;background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:12px 14px;font:inherit;font-size:16px;color:var(--text);resize:vertical}
.ob-idea:focus{outline:none;border-color:var(--accent)}
.ob-row{display:flex;align-items:center;gap:14px;flex-wrap:wrap}
.ob-start.secondary{background:transparent;border:1px solid var(--accent);color:var(--accent)}
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
/* --- APEX Studio v3.2 Unified 5-Zone Shell & Classic Institutional Telemetry --- */
.v3-badge{font:600 10px var(--font-mono);background:var(--bg-card);border:1px solid var(--border);color:var(--border-bright);padding:2px 6px;border-radius:6px;margin-left:4px;vertical-align:middle}
.zone-command-bar{flex-wrap:wrap;gap:10px;background:var(--bg-panel);border-bottom:1px solid var(--border)}
.cmd-search-wrap{position:relative;flex:1;min-width:180px;max-width:300px}
.cmd-search-input{width:100%;background:var(--bg-card);border:1px solid var(--border);border-radius:8px;padding:6px 10px;font:13px var(--font-mono);color:var(--text-main)}
.cmd-search-input:focus{outline:none;border-color:var(--border-bright)}
.cmd-search-dropdown{position:absolute;left:0;right:0;top:calc(100% + 4px);background:var(--bg-panel);border:1px solid var(--border-bright);border-radius:10px;max-height:320px;overflow:auto;z-index:25;box-shadow:0 12px 30px rgba(0,0,0,.55);padding:4px}
.cmd-search-item{width:100%;display:flex;flex-direction:column;align-items:flex-start;gap:2px;background:transparent;border:0;border-radius:7px;padding:6px 8px;text-align:left}
.cmd-search-item:hover{background:var(--bg-hover)}
.csi-kind{font:600 10px var(--font-mono);text-transform:uppercase;color:var(--dom-demand)}
.csi-title{font-size:13px;color:var(--text-main)}
.csi-uri{font:11px var(--font-mono);color:var(--text-dim)}
.cmd-search-empty{padding:10px;font-size:12.5px;color:var(--text-muted)}
.cmd-maturity-group,.cmd-xray-group,.cmd-zoom-group{display:inline-flex;background:var(--bg-deep);border:1px solid var(--border);border-radius:9px;padding:2px;gap:2px}
.maturity-pill,.xray-pill,.zoom-pill{background:transparent;border:0;border-radius:7px;padding:4px 9px;font-size:12px;color:var(--text-muted);white-space:nowrap}
.maturity-pill:hover,.xray-pill:hover,.zoom-pill:hover{color:var(--text-main);background:var(--bg-hover)}
.maturity-pill.active,.xray-pill.active,.zoom-pill.active{background:var(--bg-card);color:var(--border-bright);font-weight:600;box-shadow:inset 0 0 0 1px var(--border-bright)}
.unified-studio-grid{display:grid;grid-template-columns:270px minmax(0,1fr) 410px;gap:14px;padding:14px 18px;max-width:1920px;margin:0 auto;align-items:start}
@media (max-width:1320px){.unified-studio-grid{grid-template-columns:230px minmax(0,1fr) 360px}}
@media (max-width:1050px){.unified-studio-grid{grid-template-columns:1fr}}
.studio-zone-center.fl-main{display:block;padding:0;margin:0;max-width:none}
.zone-navigator{background:var(--bg-panel);border:1px solid var(--border);border-radius:14px;padding:12px;max-height:calc(100vh - 140px);overflow:auto;position:sticky;top:70px}
.zone-navigator.collapsed{width:44px;padding:8px;text-align:center}
.zone-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px}
.zone-title-group{display:flex;flex-direction:column}
.zone-kicker{font:600 10px var(--font-mono);text-transform:uppercase;letter-spacing:.6px;color:var(--dom-demand)}
.nav-collapse-btn{background:var(--bg-card);border:1px solid var(--border);border-radius:6px;padding:2px 7px;font-size:12px;color:var(--text-muted)}
.nav-breadcrumbs{display:flex;flex-wrap:wrap;align-items:center;gap:4px;padding:6px 8px;background:var(--bg-deep);border:1px solid var(--border);border-radius:8px;margin-bottom:10px;font-size:12px}
.crumb-btn{background:transparent;border:0;color:var(--text-muted);padding:2px 4px;border-radius:4px;font-size:12px}
.crumb-btn.active{color:var(--border-bright);font-weight:600}
.crumb-sep{color:var(--text-dim)}
.crumb-exit{margin-left:auto;background:#3f1515;border:1px solid var(--st-critical);color:#fecaca;border-radius:5px;padding:1px 6px;font-size:11px}
.nav-section{border-top:1px solid var(--border);padding:8px 0}
.nav-section summary{cursor:pointer;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.5px;color:var(--text-muted);display:flex;justify-content:space-between;align-items:center}
.nav-count{font:11px var(--font-mono);color:var(--text-dim);background:var(--bg-deep);padding:1px 6px;border-radius:999px}
.nav-tree,.nav-entity-list{display:flex;flex-direction:column;gap:3px;margin-top:6px}
.nav-tree-item{display:flex;align-items:center;gap:4px;border-radius:7px}
.nav-tree-item.active{background:var(--bg-hover)}
.nav-tree-select,.nav-entity-row{flex:1;display:flex;align-items:center;gap:6px;background:transparent;border:0;padding:5px 6px;border-radius:6px;text-align:left;font-size:12.5px;min-width:0}
.nav-entity-row:hover,.nav-tree-select:hover{background:var(--bg-hover)}
.nav-entity-row.active{background:var(--bg-hover);box-shadow:inset 2px 0 0 var(--border-bright)}
.nav-status-dot,.cap-status-dot,.domain-dot{width:8px;height:8px;border-radius:50%;flex:none}
.st-ok,.cap-known{background:var(--st-healthy)}
.st-warn,.cap-unclear{background:var(--st-warning)}
.st-crit,.cap-missing{background:var(--st-critical)}
.dom-people{background:var(--dom-people)}.dom-app{background:var(--dom-application)}.dom-demand{background:var(--dom-demand)}.dom-finance{background:var(--dom-finance)}
.nav-level-tag{font:600 10px var(--font-mono);color:var(--dom-value);background:var(--bg-deep);padding:1px 4px;border-radius:4px}
.nav-node-name,.nav-entity-name{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.nav-spotlight-btn{background:transparent;border:1px solid transparent;border-radius:5px;padding:1px 5px;font-size:12px;color:var(--text-dim)}
.nav-spotlight-btn:hover,.nav-spotlight-btn.active{border-color:var(--border-bright);color:var(--border-bright);background:var(--bg-card)}
.nav-usedby-badge,.nav-mono-val{font:11px var(--font-mono);color:var(--text-dim)}
/* --- Zone 3 · ICOM Process Cards, Spotlight & Capability Map --- */
.icom-architecture-deck{background:var(--bg-panel);border:1px solid var(--border);border-radius:16px;padding:12px 14px;display:flex;flex-direction:column;gap:12px}
.icom-band-row{display:flex;flex-direction:column;gap:8px}
.icom-support-band{border-top:1px dashed var(--border);padding-top:10px}
.icom-band-label{font:600 11px var(--font-mono);text-transform:uppercase;letter-spacing:.6px;color:var(--text-muted)}
.icom-node-strip,.spotlight-children-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:10px}
.icom-node-card{background:var(--bg-card);border:1px solid var(--border);border-left:3px solid var(--st-healthy);border-radius:12px;padding:8px 10px;display:flex;flex-direction:column;gap:6px;transition:border-color .15s,opacity .2s}
.icom-node-card.icom-warn{border-left-color:var(--st-warning)}
.icom-node-card.icom-crit{border-left-color:var(--st-critical)}
.icom-node-card.selected{border-color:var(--border-bright);box-shadow:0 0 0 1px var(--border-bright)}
.icom-card-body{display:flex;align-items:center;gap:6px;cursor:pointer}
.icom-card-main{flex:1;min-width:0}
.icom-card-head{display:flex;align-items:center;gap:6px;margin-bottom:6px}
.icom-level-badge{font:600 10px var(--font-mono);background:var(--bg-deep);color:var(--dom-value);padding:1px 5px;border-radius:4px}
.icom-card-title{flex:1;font-size:13.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.icom-zoom-in-btn{background:var(--bg-deep);border:1px solid var(--border);border-radius:5px;padding:1px 6px;font-size:11px;color:var(--text-muted)}
.icom-zoom-in-btn:hover{border-color:var(--border-bright);color:var(--border-bright)}
.icom-metrics-row{display:grid;grid-template-columns:repeat(3,1fr);gap:6px}
.icom-metric-cell{background:var(--bg-deep);border-radius:6px;padding:4px 6px;display:flex;flex-direction:column}
.im-lbl{font-size:10px;color:var(--text-dim);text-transform:uppercase}
.im-val{font:600 12px var(--font-mono);color:var(--text-main);font-variant-numeric:tabular-nums}
.icom-port-rail{display:flex;justify-content:center;align-items:center}
.icom-dot{font:700 9px var(--font-mono);width:15px;height:15px;border-radius:4px;display:inline-flex;align-items:center;justify-content:center;background:var(--bg-deep);border:1px solid var(--border);color:var(--text-dim)}
.icom-dot-i{border-color:var(--dom-demand);color:var(--dom-demand)}
.icom-dot-c{border-color:var(--dom-enabling);color:var(--dom-enabling)}
.icom-dot-o{border-color:var(--dom-finance);color:var(--dom-finance)}
.icom-mech-strip{display:flex;flex-wrap:wrap;gap:4px;border-top:1px dashed var(--border);padding-top:6px}
.icom-mech-pill{font:600 10.5px var(--font-mono);padding:2px 7px;border-radius:999px;cursor:pointer;background:var(--bg-deep);border:1px solid var(--border)}
.mech-pill-people{border-color:var(--dom-people);color:var(--dom-people)}
.mech-pill-app{border-color:var(--dom-application);color:var(--dom-application)}
.mech-pill-asset{border-color:var(--dom-enabling);color:var(--dom-enabling)}
.spotlight-banner{display:flex;justify-content:space-between;align-items:center;gap:10px;background:var(--bg-deep);border:1px solid var(--border-bright);border-radius:10px;padding:8px 12px}
.spotlight-sub{font-size:12px;color:var(--text-muted);margin-left:8px}
.bundled-streams-strip{display:flex;flex-wrap:wrap;gap:8px;padding:4px 0}
.bundled-stream-pill{font:11.5px var(--font-mono);background:var(--bg-deep);border:1px solid var(--border);border-bottom-color:var(--border-bright);padding:3px 8px;border-radius:6px;color:var(--text-main)}
.capability-map-stage{background:var(--bg-panel);border:1px solid var(--border);border-radius:16px;padding:16px}
.cap-map-header{display:flex;justify-content:space-between;align-items:flex-end;flex-wrap:wrap;gap:10px;margin-bottom:14px}
.cap-map-header h4{margin:2px 0 0;font-size:17px}
.cap-map-legend{display:flex;gap:12px;font-size:12px;color:var(--text-muted)}
.cml-item{display:inline-flex;align-items:center;gap:5px}
.cap-dot-known,.cap-dot-unclear,.cap-dot-missing{width:9px;height:9px;border-radius:50%;display:inline-block}
.cap-dot-known{background:var(--st-healthy)}.cap-dot-unclear{background:var(--st-warning)}.cap-dot-missing{background:var(--st-critical)}
.capability-card-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:12px}
.capability-map-card{background:var(--bg-card);border:1.5px solid var(--border);border-radius:12px;padding:12px;display:flex;flex-direction:column;gap:6px;cursor:pointer}
.capability-map-card.cap-card-missing{border-style:dashed}
.capability-map-card.selected{box-shadow:0 0 0 2px var(--border-bright)}
.cmc-top{display:flex;justify-content:space-between;align-items:center;font:600 11px var(--font-mono)}
.cmc-ref{color:var(--text-dim)}
.cmc-title{font-size:14.5px}
.cmc-rationale{margin:0;font-size:12.5px;color:var(--text-muted)}
.cmc-notes{display:flex;flex-direction:column;gap:4px;margin-top:4px}
.cmc-note{display:flex;gap:6px;align-items:baseline;font-size:12px;background:var(--bg-deep);padding:4px 8px;border-radius:6px}
.cmc-note-icon{font:700 11px var(--font-mono);color:var(--border-bright)}
.cmc-deps{font-size:11px;color:var(--text-dim);margin-top:4px}
/* --- Zone 4 · 6-Tab Inspector & Classic Institutional Telemetry --- */
.studio-zone-inspector.fl-side{padding:12px;max-height:calc(100vh - 140px)}
.inspector-shell{display:flex;flex-direction:column;gap:10px}
.inspector-entity-header{background:var(--bg-deep);border:1px solid var(--border);border-radius:10px;padding:8px 10px}
.inspector-entity-meta{display:flex;justify-content:space-between;align-items:center;gap:6px;margin-bottom:4px}
.uri-pill,.uri-mini{font:11px var(--font-mono);color:var(--dom-demand);background:var(--bg-card);padding:1px 6px;border-radius:5px}
.usedby-pill{font-size:11.5px;color:var(--text-muted)}
.inspector-entity-title-row{display:flex;justify-content:space-between;align-items:center;gap:8px}
.inspector-entity-title{margin:0;font-size:15px}
.btn-ghost{background:var(--bg-card);border:1px solid var(--border);border-radius:6px;color:var(--text-main)}
.btn-ghost:hover{border-color:var(--border-bright);color:var(--border-bright)}
.btn-xs{padding:3px 8px;font-size:11.5px}
.inspector-tabs{display:grid;grid-template-columns:repeat(6,1fr);gap:2px;background:var(--bg-deep);border:1px solid var(--border);border-radius:9px;padding:2px}
.inspector-tab-btn{background:transparent;border:0;border-radius:6px;padding:5px 4px;font-size:11.5px;color:var(--text-muted);text-align:center}
.inspector-tab-btn.active{background:var(--bg-card);color:var(--border-bright);font-weight:600}
.ins-section{border-bottom:1px solid var(--border);padding:10px 0}
.ins-section-title{font:600 11.5px var(--font-mono);text-transform:uppercase;letter-spacing:.5px;color:var(--dom-enabling);margin-bottom:8px}
.ins-section-head-row{display:flex;justify-content:space-between;align-items:center;margin-bottom:6px}
.telemetry-kpi-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.telemetry-kpi-card{background:var(--bg-card);border:1px solid var(--border);border-radius:9px;padding:8px 10px;display:flex;flex-direction:column;gap:2px}
.tk-label{font-size:11px;color:var(--text-muted)}
.tk-val{font:700 15px var(--font-mono);font-variant-numeric:tabular-nums}
.tk-sub{font-size:11px;color:var(--text-dim)}
.st-text-ok{color:var(--st-healthy)}.st-text-warn{color:var(--st-warning)}.st-text-crit{color:var(--st-critical)}
.st-banner-ok,.st-banner-warn,.st-banner-crit{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:7px 10px;border-radius:8px;font-size:12px}
.st-banner-ok{background:rgba(16,185,129,.12);border:1px solid var(--st-healthy);color:#6ee7b7}
.st-banner-warn{background:rgba(245,158,11,.12);border:1px solid var(--st-warning);color:#fde68a}
.st-banner-crit{background:rgba(239,68,68,.12);border:1px solid var(--st-critical);color:#fca5a5}
.classic-telemetry-table{width:100%;border-collapse:collapse;font-size:12.5px;font-variant-numeric:tabular-nums}
.classic-telemetry-table th{text-align:left;color:var(--text-muted);font-size:11px;text-transform:uppercase;padding:5px 6px;border-bottom:1px solid var(--border)}
.classic-telemetry-table td{padding:5px 6px;border-bottom:1px solid rgba(30,45,74,.6)}
.classic-telemetry-table .num-col{text-align:right;font-family:var(--font-mono)}
.classic-telemetry-table .row-group-head td{font:600 11px var(--font-mono);text-transform:uppercase;color:var(--dom-demand);background:var(--bg-deep);padding-top:8px}
.classic-telemetry-table .row-subtotal td{font-weight:600;background:rgba(23,37,68,.45)}
.classic-telemetry-table .row-total td{font-weight:700;border-top:1.5px solid var(--border-bright);background:rgba(56,189,248,.08)}
.teach-callout{margin-top:8px;background:rgba(129,140,248,.12);border-left:3px solid var(--dom-enabling);border-radius:6px;padding:6px 8px;font-size:12px;color:#c7d2fe}
.physics-module-card,.org-role-card,.it-system-card{background:var(--bg-card);border:1px solid var(--border);border-radius:8px;padding:8px;margin-bottom:6px}
.pm-header,.orc-top,.its-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:4px}
.pm-atom-badge,.its-layer-badge{font:600 10.5px var(--font-mono);background:var(--bg-deep);color:var(--dom-value);padding:1px 6px;border-radius:4px;margin-right:6px}
.pm-param-row,.icom-port-row,.link-row,.journal-mini-row{display:flex;justify-content:space-between;align-items:center;gap:6px;padding:3px 0;font-size:12px;border-bottom:1px dashed rgba(30,45,74,.5)}
.uri-link-btn,.link-uri-btn{background:transparent;border:0;font:11px var(--font-mono);color:var(--border-bright);padding:0;text-align:left}
.icom-port-grid{display:grid;grid-template-columns:1fr 1fr;gap:6px}
.icom-side-box{background:var(--bg-card);border:1px solid var(--border);border-radius:7px;padding:6px}
.icom-side-head{display:flex;align-items:center;gap:5px;font-size:11px;font-weight:600;margin-bottom:4px}
.icom-badge{font:700 10px var(--font-mono);padding:1px 5px;border-radius:4px;background:var(--bg-deep)}
.raci-pill{font:700 10.5px var(--font-mono);padding:1px 6px;border-radius:4px}
.raci-a{background:rgba(244,114,182,.18);color:var(--dom-people);border:1px solid var(--dom-people)}
.raci-r{background:rgba(56,189,248,.18);color:var(--dom-demand);border:1px solid var(--dom-demand)}
.raci-c{background:var(--bg-deep);color:var(--text-dim)}
.cap-status-pill{font:600 10.5px var(--font-mono);padding:2px 6px;border-radius:999px}
.bizcap-row{display:flex;align-items:flex-start;gap:8px;padding:6px;border-radius:7px;cursor:pointer}
.bizcap-row:hover{background:var(--bg-hover)}
.bizcap-sub{font-size:11.5px;color:var(--text-muted)}
.legacy-levers-accordion{margin-top:10px;border-top:1px solid var(--border);padding-top:8px}
.legacy-levers-accordion summary{cursor:pointer;font-size:12px;color:var(--text-muted)}
/* --- Zone 5 · Git-Style Timeline Branch Bar & Monte Carlo Strip --- */
.studio-zone-timeline{padding:0 18px 18px;max-width:1920px;margin:0 auto}
.zone-timeline{background:var(--bg-panel);border:1px solid var(--border);border-radius:14px;padding:10px 14px}
.timeline-branch-bar{display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;padding-bottom:8px;border-bottom:1px solid var(--border);margin-bottom:8px}
.tbb-left,.tbb-center,.tbb-right,.tbb-branches,.tbb-crisis-strip{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.tbb-center{flex:1;min-width:240px}
.tbb-day-slider{flex:1;accent-color:var(--border-bright)}
.git-branch-pill{display:inline-flex;align-items:center;gap:5px;background:var(--bg-card);border:1px solid var(--border-bright);color:var(--text-main);padding:4px 10px;border-radius:999px;font-size:12px}
.git-scenario-chip{display:inline-flex;align-items:center;gap:5px;background:var(--bg-deep);border:1px solid var(--border);border-radius:999px;padding:2px 8px;font-size:12px}
.gsc-load{background:transparent;border:0;color:var(--text-main);font-size:12px;padding:2px 4px}
.gsc-delta{font:600 11px var(--font-mono)}
.mc-confidence-strip{display:inline-flex;align-items:center;gap:8px;background:var(--bg-deep);border:1px solid var(--border);border-radius:8px;padding:4px 9px;font:11.5px var(--font-mono)}
.mc-tag{color:var(--dom-application);font-weight:700}
.crisis-chip{background:var(--bg-card);border:1px solid var(--border);border-radius:999px;padding:3px 9px;font-size:11.5px;color:var(--text-muted)}
.crisis-chip.active,.crisis-chip:hover{border-color:var(--st-warning);color:#fde68a}
.maturity-timeline-notice{display:flex;align-items:center;gap:10px;padding:14px;background:var(--bg-deep);border:1px dashed var(--border);border-radius:10px;font-size:13px;color:var(--text-muted)}
`;

export function renderFlowPage(): string {
  return `<!DOCTYPE html>
<html lang="fi">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link rel="icon" href="data:," />
  <title>APEX Studio</title>
  <style>${FLOW_CSS}</style>
</head>
<body>
  <div id="flow-root"><p style="padding:40px;color:#94a3b8">APEX Studio…</p></div>
  <noscript><p style="padding:40px">APEX Studio vaatii JavaScriptin. / APEX Studio requires JavaScript.</p></noscript>
  <script type="module" src="/flow/client/app.ts"></script>
</body>
</html>`;
}
