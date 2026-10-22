/**
 * Deterministic PRNG (Mulberry32) & distribution sampler.
 *
 * State is a single signed 32-bit integer stored in `WorldState.rngState`.
 * Cloning `WorldState` at any tick clones `rngState`, guaranteeing 100% reproducible
 * timeline branches ("Git for Business Cases").
 */
import type { Distribution } from "../schema";

export class SeededRng {
  private s: number;

  constructor(seed: number) {
    this.s = seed | 0;
    if (this.s === 0) this.s = 0x6d2b79f5;
  }

  get state(): number {
    return this.s;
  }

  /** Uniform float in [0, 1). */
  next(): number {
    this.s = (this.s + 0x6d2b79f5) | 0;
    let t = Math.imul(this.s ^ (this.s >>> 15), 1 | this.s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Integer in [min, max] inclusive. */
  int(min: number, max: number): number {
    if (max <= min) return Math.floor(min);
    return Math.floor(min + this.next() * (max - min + 1));
  }

  /** Bernoulli trial with probability `p`. */
  chance(p: number): boolean {
    if (p <= 0) return false;
    if (p >= 1) return true;
    return this.next() < p;
  }

  /** Standard normal N(0, 1) via Box-Muller. */
  normal01(): number {
    const u1 = Math.max(1e-12, this.next());
    const u2 = this.next();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  }

  normal(mean: number, sd: number, min?: number): number {
    const v = mean + sd * this.normal01();
    return min !== undefined ? Math.max(min, v) : v;
  }

  triangular(min: number, mode: number, max: number): number {
    if (max <= min) return min;
    const u = this.next();
    const f = (mode - min) / (max - min);
    if (u < f) {
      return min + Math.sqrt(u * (max - min) * (mode - min));
    }
    return max - Math.sqrt((1 - u) * (max - min) * (max - mode));
  }

  /** Poisson(λ) via Knuth for small λ and normal approximation for λ > 30. */
  poisson(lambda: number): number {
    if (lambda <= 0) return 0;
    if (lambda > 30) {
      return Math.max(0, Math.round(this.normal(lambda, Math.sqrt(lambda))));
    }
    const L = Math.exp(-lambda);
    let k = 0;
    let p = 1;
    do {
      k++;
      p *= this.next();
    } while (p > L);
    return k - 1;
  }

  sample(dist: Distribution): number {
    switch (dist.kind) {
      case "fixed":
        return dist.value;
      case "normal":
        return this.normal(dist.mean, dist.sd, dist.min);
      case "triangular":
        return this.triangular(dist.min, dist.mode, dist.max);
    }
  }
}

export const clamp = (v: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, v));

export const ema = (prev: number, next: number, alpha = 0.2): number =>
  prev * (1 - alpha) + next * alpha;
