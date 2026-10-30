// src/core/quality.js — adaptive resolution. Pure logic (no DOM) so it can be unit tested.
// Smooths frame time; drops render scale quickly when slow, raises it slowly when there's headroom. Hysteresis prevents flapping.
export class QualityScaler {
  constructor({ min = 0.6, max = 1, targetFps = 45, step = 0.1 } = {}) {
    Object.assign(this, { min, max, step, scale: max, ema: 1000 / targetFps, slowMs: 1000 / targetFps, fastMs: 1000 / (targetFps * 1.8), slowFor: 0, fastFor: 0 });
  }
  /** feed every frame (ms). Returns new scale when it changes, else null. */
  sample(frameMs) {
    this.ema += (Math.min(frameMs, 200) - this.ema) * 0.1;
    if (this.ema > this.slowMs) { this.slowFor += frameMs; this.fastFor = 0; } else if (this.ema < this.fastMs) { this.fastFor += frameMs; this.slowFor = 0; } else this.slowFor = this.fastFor = 0;
    if (this.slowFor > 1500 && this.scale > this.min) { this.slowFor = 0; this.scale = Math.max(this.min, +(this.scale - this.step).toFixed(2)); return this.scale; }
    if (this.fastFor > 6000 && this.scale < this.max) { this.fastFor = 0; this.scale = Math.min(this.max, +(this.scale + this.step / 2).toFixed(2)); return this.scale; }
    return null;
  }
}
