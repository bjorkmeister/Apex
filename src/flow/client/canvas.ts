/**
 * APEX Flow — elävä virtakanvaasi (`src/flow/client/canvas.ts`).
 *
 * Piirtää enintään viisi pääsolmua SVG:nä ja animoi virrat:
 * - kysyntä → toimituskyky: asiakkaat/tilaukset pisteinä (määrä ∝ myynti),
 * - toimituskyky → kassa: laskut kulkevat putkessa maksuajan mittaisen matkan,
 * - kassa → kulut: kulut valuvat säiliön pohjalta,
 * - pullonkaulassa osa pisteistä kimpoaa pois punaisena.
 *
 * Ajetaan vain selaimessa.
 */
import type { FlowView, NodeId, NodeStatus } from "../model/view.ts";
import { esc, money } from "../model/format.ts";

const SVG_NS = "http://www.w3.org/2000/svg";

interface Particle {
  lane: "demand" | "invoice" | "drain" | "lost";
  t: number;
  speed: number;
}

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

const BOXES: Record<Exclude<NodeId, "cash">, Box> = {
  demand: { x: 20, y: 120, w: 190, h: 110 },
  capacity: { x: 270, y: 120, w: 190, h: 110 },
  receivables: { x: 478, y: 14, w: 196, h: 90 },
  costs: { x: 840, y: 268, w: 150, h: 84 },
};
const TANK: Box = { x: 690, y: 50, w: 130, h: 260 };
const PIPE_Y = 175;

const STATUS_COLORS: Record<NodeStatus, string> = {
  ok: "#10b981",
  warn: "#f59e0b",
  alert: "#ef4444",
  idle: "#64748b",
};

function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
}

/** Asettaa tekstin ja lyhentää sen kolmella pisteellä, jos se ei mahdu laatikkoon. */
function fitText(t: SVGTextElement, text: string, maxWidth: number): void {
  t.textContent = text;
  t.removeAttribute("data-full");
  try {
    if (t.getComputedTextLength() <= maxWidth) return;
    t.setAttribute("data-full", text);
    let s = text;
    while (s.length > 4) {
      s = s.slice(0, -1);
      t.textContent = `${s.trimEnd()}…`;
      if (t.getComputedTextLength() <= maxWidth) break;
    }
    const title = document.createElementNS(SVG_NS, "title");
    title.textContent = text;
    t.appendChild(title);
  } catch {
    // Elementti ei ole vielä renderöity: jätetään teksti ennalleen.
  }
}

export class FlowCanvas {
  private readonly svg: SVGSVGElement;
  private readonly particleLayer: SVGGElement;
  private readonly water: SVGPathElement;
  private readonly tankLabel: SVGTextElement;
  private readonly tankSub: SVGTextElement;
  private readonly tankFrame: SVGRectElement;
  private readonly pipeAmount: SVGTextElement;
  private readonly nodeTexts = new Map<string, { value: SVGTextElement; sub: SVGTextElement; frame: SVGRectElement; maxWidth: number }>();
  private particles: Particle[] = [];
  private view: FlowView | null = null;
  private day = 0;
  private lastTs = 0;
  private wavePhase = 0;
  private spawnAcc = { demand: 0, invoice: 0, drain: 0 };
  private rafId = 0;
  private readonly onSelect: (id: NodeId) => void;

  constructor(host: HTMLElement, onSelect: (id: NodeId) => void) {
    this.onSelect = onSelect;
    this.svg = el("svg", { viewBox: "0 0 1000 370", class: "flow-svg", role: "img", "aria-label": "Yrityksen rahavirrat" });
    host.innerHTML = "";
    host.appendChild(this.svg);

    const defs = el("defs", {});
    const clip = el("clipPath", { id: "tank-clip" });
    clip.appendChild(el("rect", { x: TANK.x + 4, y: TANK.y + 4, width: TANK.w - 8, height: TANK.h - 8, rx: 14 }));
    defs.appendChild(clip);
    const grad = el("linearGradient", { id: "water-grad", x1: 0, y1: 0, x2: 0, y2: 1 });
    grad.appendChild(el("stop", { offset: "0%", "stop-color": "#38bdf8" }));
    grad.appendChild(el("stop", { offset: "100%", "stop-color": "#0369a1" }));
    defs.appendChild(grad);
    this.svg.appendChild(defs);

    // Putket (taustalle).
    const pipes = el("g", { class: "flow-pipes" });
    pipes.appendChild(el("path", { d: this.lanePath("demand"), class: "flow-pipe" }));
    pipes.appendChild(el("path", { d: this.lanePath("invoice"), class: "flow-pipe flow-pipe-wide", "data-node": "receivables" }));
    pipes.appendChild(el("path", { d: this.lanePath("drain"), class: "flow-pipe" }));
    this.svg.appendChild(pipes);

    // Rahat matkalla -summa putken päällä.
    this.pipeAmount = el("text", { x: 575, y: PIPE_Y + 34, class: "flow-pipe-amount", "text-anchor": "middle" });
    this.svg.appendChild(this.pipeAmount);

    this.particleLayer = el("g", { class: "flow-particles" });
    this.svg.appendChild(this.particleLayer);

    // Solmulaatikot.
    for (const [id, b] of Object.entries(BOXES)) this.addNodeBox(id as NodeId, b);

    // Kassasäiliö.
    const tankGroup = el("g", { class: "flow-node flow-tank", "data-node": "cash", tabindex: 0 });
    this.tankFrame = el("rect", { x: TANK.x, y: TANK.y, width: TANK.w, height: TANK.h, rx: 18, class: "flow-tank-frame" });
    tankGroup.appendChild(this.tankFrame);
    this.water = el("path", { d: "", fill: "url(#water-grad)", "clip-path": "url(#tank-clip)", class: "flow-water" });
    tankGroup.appendChild(this.water);
    tankGroup.appendChild(el("text", { x: TANK.x + TANK.w / 2, y: TANK.y - 14, class: "flow-node-title", "text-anchor": "middle" })).textContent = "Kassa";
    this.tankLabel = el("text", { x: TANK.x + TANK.w / 2, y: TANK.y + 40, class: "flow-tank-value", "text-anchor": "middle" });
    this.tankSub = el("text", { x: TANK.x + TANK.w / 2, y: TANK.y + 60, class: "flow-node-sub", "text-anchor": "middle" });
    tankGroup.appendChild(this.tankLabel);
    tankGroup.appendChild(this.tankSub);
    this.svg.appendChild(tankGroup);

    this.svg.addEventListener("click", (ev) => {
      const target = (ev.target as Element).closest("[data-node]");
      const id = target?.getAttribute("data-node") as NodeId | null;
      if (id) this.onSelect(id);
    });
    this.svg.addEventListener("keydown", (ev) => {
      if (ev.key !== "Enter" && ev.key !== " ") return;
      const id = (ev.target as Element).getAttribute?.("data-node") as NodeId | null;
      if (id) {
        ev.preventDefault();
        this.onSelect(id);
      }
    });

    this.rafId = requestAnimationFrame((ts) => this.frame(ts));
  }

  destroy(): void {
    cancelAnimationFrame(this.rafId);
  }

  private addNodeBox(id: NodeId, b: Box): void {
    const g = el("g", { class: "flow-node", "data-node": id, tabindex: 0 });
    const frame = el("rect", { x: b.x, y: b.y, width: b.w, height: b.h, rx: 14, class: "flow-node-frame" });
    g.appendChild(frame);
    const title = el("text", { x: b.x + 14, y: b.y + 24, class: "flow-node-title" });
    g.appendChild(title);
    const value = el("text", { x: b.x + 14, y: b.y + 52, class: "flow-node-value" });
    g.appendChild(value);
    const sub = el("text", { x: b.x + 14, y: b.y + 74, class: "flow-node-sub" });
    g.appendChild(sub);
    if (b.h > 90) {
      const hint = el("text", { x: b.x + b.w - 14, y: b.y + b.h - 12, class: "flow-node-hint", "text-anchor": "end" });
      hint.textContent = "avaa ›";
      g.appendChild(hint);
    }
    title.setAttribute("data-title", id);
    this.svg.appendChild(g);
    this.nodeTexts.set(id, { value, sub, frame, maxWidth: b.w - 28 });
  }

  private lanePath(lane: Particle["lane"]): string {
    const d = BOXES.demand;
    const c = BOXES.capacity;
    const k = BOXES.costs;
    switch (lane) {
      case "demand":
        return `M ${d.x + d.w} ${PIPE_Y} L ${c.x} ${PIPE_Y}`;
      case "invoice":
        return `M ${c.x + c.w} ${PIPE_Y} L ${TANK.x} ${PIPE_Y}`;
      case "drain":
        return `M ${TANK.x + TANK.w / 2} ${TANK.y + TANK.h} L ${TANK.x + TANK.w / 2} ${k.y + k.h / 2} L ${k.x} ${k.y + k.h / 2}`;
      case "lost":
        return `M ${c.x - 10} ${PIPE_Y} Q ${c.x - 40} ${PIPE_Y + 60} ${c.x - 70} ${PIPE_Y + 150}`;
    }
  }

  private pointOn(lane: Particle["lane"], t: number): { x: number; y: number } {
    const d = BOXES.demand;
    const c = BOXES.capacity;
    const k = BOXES.costs;
    switch (lane) {
      case "demand":
        return { x: d.x + d.w + (c.x - d.x - d.w) * t, y: PIPE_Y };
      case "invoice":
        return { x: c.x + c.w + (TANK.x - c.x - c.w) * t, y: PIPE_Y };
      case "drain": {
        const x0 = TANK.x + TANK.w / 2;
        const y0 = TANK.y + TANK.h;
        const y1 = k.y + k.h / 2;
        const seg1 = y1 - y0;
        const seg2 = x0 - k.x;
        const total = Math.abs(seg1) + Math.abs(seg2);
        const dist = t * total;
        if (dist <= Math.abs(seg1)) return { x: x0, y: y0 + dist };
        return { x: x0 + (dist - Math.abs(seg1)), y: y1 };
      }
      case "lost": {
        const x0 = c.x - 10;
        const cx = c.x - 40;
        const x1 = c.x - 70;
        const y0 = PIPE_Y;
        const cy = PIPE_Y + 60;
        const y1 = PIPE_Y + 150;
        const u = 1 - t;
        return { x: u * u * x0 + 2 * u * t * cx + t * t * x1, y: u * u * y0 + 2 * u * t * cy + t * t * y1 };
      }
    }
  }

  /** Päivittää datan. Animaatio jatkuu katkeamatta. */
  update(view: FlowView): void {
    this.view = view;
    for (const n of view.nodes) {
      if (n.id === "cash") continue;
      const t = this.nodeTexts.get(n.id);
      if (!t) continue;
      const titleEl = this.svg.querySelector(`[data-title="${n.id}"]`);
      if (titleEl) titleEl.textContent = n.title;
      fitText(t.value, n.value, t.maxWidth);
      fitText(t.sub, n.sub, t.maxWidth);
      t.frame.setAttribute("stroke", STATUS_COLORS[n.status]);
      t.frame.setAttribute("data-status", n.status);
    }
    const cashNode = view.nodes.find((n) => n.id === "cash");
    if (cashNode) this.tankFrame.setAttribute("stroke", STATUS_COLORS[cashNode.status]);
    this.setDay(Math.min(this.day, Math.max(0, view.sim.days.length - 1)));
  }

  setDay(day: number): void {
    this.day = day;
    const v = this.view;
    if (!v || v.sim.days.length === 0) {
      this.tankLabel.textContent = "–";
      this.tankSub.textContent = "";
      this.pipeAmount.textContent = "";
      return;
    }
    const p = v.sim.days[Math.min(day, v.sim.days.length - 1)];
    this.tankLabel.textContent = money(p.cash);
    this.tankLabel.setAttribute("data-negative", p.cash < 0 ? "1" : "0");
    this.tankSub.textContent = `kk ${Math.floor(day / 30) + 1}, pv ${(day % 30) + 1}`;
    this.pipeAmount.textContent = p.receivables > 0.5 ? `${money(p.receivables)} matkalla` : "";
  }

  private frame(ts: number): void {
    const dt = this.lastTs ? Math.min(0.05, (ts - this.lastTs) / 1000) : 0;
    this.lastTs = ts;
    this.wavePhase += dt * 2.2;
    const v = this.view;
    if (v && !v.isEmpty) this.stepParticles(v, dt);
    this.drawWater();
    this.drawParticles();
    this.rafId = requestAnimationFrame((t) => this.frame(t));
  }

  private stepParticles(v: FlowView, dt: number): void {
    // Spawn-tahti skaalataan: 10 000 €/kk ≈ 3 pistettä sekunnissa, katto 9/s.
    const rate = (eurPerMonth: number) => Math.min(9, Math.max(0, eurPerMonth) / 3300);
    const lostShare = v.bottleneck && v.bottleneck.demand > 0 ? v.bottleneck.lostDemand / v.bottleneck.demand : 0;
    const termsDays = v.econ.reduce((m, e) => Math.max(m, e.paymentTermsDays), 0);
    const invoiceSpeed = 1 / Math.max(0.5, 0.6 + termsDays * 0.07);

    this.spawnAcc.demand += rate(v.monthlyRevenue / Math.max(0.05, 1 - lostShare)) * dt;
    this.spawnAcc.invoice += rate(v.monthlyRevenue) * dt;
    this.spawnAcc.drain += rate(v.monthlyFixed + v.monthlyVariable) * dt;

    while (this.spawnAcc.demand >= 1) {
      this.spawnAcc.demand -= 1;
      this.particles.push({ lane: "demand", t: 0, speed: 0.9 });
    }
    while (this.spawnAcc.invoice >= 1) {
      this.spawnAcc.invoice -= 1;
      this.particles.push({ lane: "invoice", t: 0, speed: invoiceSpeed });
    }
    while (this.spawnAcc.drain >= 1) {
      this.spawnAcc.drain -= 1;
      this.particles.push({ lane: "drain", t: 0, speed: 0.55 });
    }

    const next: Particle[] = [];
    for (const p of this.particles) {
      p.t += p.speed * dt;
      if (p.t < 1) {
        next.push(p);
      } else if (p.lane === "demand" && lostShare > 0 && Math.random() < lostShare) {
        next.push({ lane: "lost", t: 0, speed: 0.8 });
      }
    }
    this.particles = next.slice(-160);
  }

  private drawParticles(): void {
    const layer = this.particleLayer;
    while (layer.childNodes.length < this.particles.length) {
      layer.appendChild(el("circle", { r: 5 }));
    }
    while (layer.childNodes.length > this.particles.length) {
      layer.removeChild(layer.lastChild as ChildNode);
    }
    this.particles.forEach((p, i) => {
      const c = layer.childNodes[i] as SVGCircleElement;
      const pt = this.pointOn(p.lane, p.t);
      c.setAttribute("cx", pt.x.toFixed(1));
      c.setAttribute("cy", pt.y.toFixed(1));
      c.setAttribute("class", `flow-dot flow-dot-${p.lane}`);
      c.setAttribute("r", p.lane === "invoice" ? "6" : "4.5");
      if (p.lane === "lost") c.setAttribute("opacity", (1 - p.t).toFixed(2));
      else c.removeAttribute("opacity");
    });
  }

  private drawWater(): void {
    const v = this.view;
    let level = 0;
    if (v && v.sim.days.length > 0) {
      const maxAbs = Math.max(1, ...v.sim.days.map((d) => Math.abs(d.cash)), Math.abs(v.sim.openingCash));
      const cash = v.sim.days[Math.min(this.day, v.sim.days.length - 1)].cash;
      level = Math.max(0, cash) / maxAbs;
    }
    const innerTop = TANK.y + 4;
    const innerH = TANK.h - 8;
    const surface = innerTop + innerH * (1 - Math.min(1, level));
    const amp = level > 0.01 ? 4 : 0;
    const left = TANK.x;
    const right = TANK.x + TANK.w;
    let d = `M ${left} ${TANK.y + TANK.h} L ${left} ${surface.toFixed(1)}`;
    for (let x = left; x <= right; x += 10) {
      const y = surface + Math.sin(this.wavePhase + (x - left) / 18) * amp;
      d += ` L ${x} ${y.toFixed(1)}`;
    }
    d += ` L ${right} ${TANK.y + TANK.h} Z`;
    this.water.setAttribute("d", d);
  }
}

/** Kassan aikajana: viiva, nollataso, miinusalue ja valittu päivä. */
export function renderTimeline(view: FlowView, day: number): string {
  const days = view.sim.days;
  if (days.length === 0) return "";
  const W = 1000;
  const H = 120;
  const pad = 8;
  const cashes = days.map((d) => d.cash);
  const max = Math.max(0, ...cashes);
  const min = Math.min(0, ...cashes);
  const span = Math.max(1, max - min);
  const x = (i: number) => pad + (i / (days.length - 1)) * (W - pad * 2);
  const y = (c: number) => pad + ((max - c) / span) * (H - pad * 2);
  const pts = days.map((d, i) => `${x(i).toFixed(1)},${y(d.cash).toFixed(1)}`).join(" ");
  const zeroY = y(0);
  const months = Array.from({ length: Math.floor(days.length / 30) + 1 }, (_, m) => m * 30)
    .filter((d) => d < days.length)
    .map((d) => `<line x1="${x(d)}" x2="${x(d)}" y1="${pad}" y2="${H - pad}" class="tl-month"/><text x="${x(d) + 4}" y="${H - 2}" class="tl-month-label">${d / 30 + 1}</text>`)
    .join("");
  const cashOut =
    view.sim.cashOutDay !== null
      ? `<circle cx="${x(view.sim.cashOutDay)}" cy="${zeroY}" r="6" class="tl-cashout"/><text x="${x(view.sim.cashOutDay) + 9}" y="${zeroY - 8}" class="tl-cashout-label">Kassa loppuu</text>`
      : "";
  const cur = days[Math.min(day, days.length - 1)];
  return `<svg viewBox="0 0 ${W} ${H}" class="flow-timeline-svg" preserveAspectRatio="none" aria-label="Kassan kehitys 12 kuukautta">
    <rect x="0" y="${zeroY}" width="${W}" height="${Math.max(0, H - zeroY)}" class="tl-negative"/>
    ${months}
    <line x1="0" x2="${W}" y1="${zeroY}" y2="${zeroY}" class="tl-zero"/>
    <polyline points="${pts}" class="tl-line"/>
    ${cashOut}
    <line x1="${x(day)}" x2="${x(day)}" y1="0" y2="${H}" class="tl-cursor"/>
    <circle cx="${x(day)}" cy="${y(cur.cash)}" r="5" class="tl-cursor-dot"/>
  </svg>
  <div class="tl-caption">${esc(`Päivä ${day + 1}: kassa ${money(cur.cash)}`)}${cur.receivables > 0.5 ? esc(` · matkalla ${money(cur.receivables)}`) : ""}</div>`;
}
