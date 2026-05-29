/**
 * Glitch Filter
 *
 * The canonical example of a filter that declares a **reaction**
 * alongside a modulatable parameter — the filter counterpart of how
 * `gauges-dashboard` is the canonical params+reactions example layer.
 *
 * It exists to show the difference between the two control surfaces in
 * one place:
 *
 *   - `intensity` (number param, `modulation: true`) — the *baseline*
 *     glitch amount, applied every frame. Modulate it and the glitch
 *     swells/breathes smoothly. This is continuous, single-valued,
 *     reversible: exactly what modulation is for.
 *
 *   - `burst` (reaction) — a *transient spike on top*. Firing it sets a
 *     short decaying envelope; for ~300ms the effective amount jumps,
 *     with per-frame randomness, then settles back to the baseline.
 *     This can't be expressed by modulating a scalar — it's a discrete,
 *     self-decaying, internally-randomized event. Exactly what
 *     reactions are for.
 *
 * Effective amount per frame = clamp(intensity + burstEnvelope). So
 * the same filter demonstrates "modulate the knob for the level, fire
 * the reaction for the event," side by side.
 *
 * `mode` (enum) picks the glitch algorithm — all pure Canvas2D, no
 * `getImageData` readback:
 *   - rgb-split : chromatic aberration (channel-isolated offset copies)
 *   - slice     : horizontal scanline bands shifted by random amounts
 *   - blocks    : random rectangular block displacement (datamosh-ish)
 *
 * Demonstrates: number param (modulatable) + enum param + a reaction
 * with a numeric arg.
 */

export const key = 'glitch';
export const label = 'Glitch';
export const type = 'filter';
export const category = 'demos';
export const description =
  'Digital-glitch post-process. The `intensity` param is the continuous ' +
  'baseline glitch level (modulate it for a swell); the `burst` reaction ' +
  'fires a transient, decaying spike on top. `mode` selects the algorithm ' +
  '(rgb-split / slice / blocks). Canonical example of a filter that pairs a ' +
  'modulatable parameter with a reaction.';

const MODES = ['rgb-split', 'slice', 'blocks'];

export const params = {
  intensity: {
    type: 'number',
    label: 'Intensity',
    default: 0.15,
    min: 0,
    max: 1,
    step: 0.01,
    description:
      'Baseline glitch amount, applied every frame. 0 = clean passthrough. ' +
      'Modulate this for a continuous swell; the `burst` reaction spikes ' +
      'on top of it.',
    modulation: true
  },
  mode: {
    type: 'enum',
    label: 'Algorithm',
    options: MODES,
    default: 'rgb-split',
    description:
      'Which glitch algorithm to apply. rgb-split = chromatic aberration; ' +
      'slice = horizontal band displacement; blocks = random block corruption.'
  }
};

export const reactions = {
  burst: {
    label: 'Glitch burst',
    description:
      'Fire a transient, self-decaying glitch spike (~300ms) on top of the ' +
      'baseline intensity. `strength` scales the spike height.',
    args: {
      strength: {
        type: 'number',
        label: 'Strength',
        default: 1,
        min: 0,
        max: 1,
        step: 0.01,
        description: 'Peak amount the burst adds on top of the baseline intensity.'
      }
    }
  }
};

const BURST_MS = 300;

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export default class GlitchFilter {
  constructor(width, height, initialParams = {}) {
    this._w = width;
    this._h = height;
    this._intensity = 0.15;
    this._mode = 'rgb-split';
    // Burst envelope: while now < _burstUntil, add a decaying spike.
    this._burstUntil = 0;
    this._burstStrength = 0;
    // Lazily-created channel canvases for the rgb-split mode.
    this._channels = null;
    this._applyParams(initialParams);
  }

  _applyParams(p) {
    if (!p) return;
    if (typeof p.intensity === 'number' && Number.isFinite(p.intensity)) {
      this._intensity = clamp01(p.intensity);
    }
    if (typeof p.mode === 'string' && MODES.includes(p.mode)) {
      this._mode = p.mode;
    }
  }

  // ── Contract: live-update + lifecycle ──────────────────────────────
  updateParams(p) { this._applyParams(p); }
  setConfig(p) { this._applyParams(p); }
  setModulatedValues(p) { this._applyParams(p); }

  resize(width, height) {
    this._w = width;
    this._h = height;
    this._channels = null; // re-created at the next rgb-split frame
  }

  cleanup() {
    this._channels = null;
  }

  // ── Contract: reaction ─────────────────────────────────────────────
  /**
   * `burst` arms a short decaying envelope. The render loop reads it
   * each frame via `_burstAmount()`; nothing else to do here. Other
   * reaction keys are unknown — throwing surfaces as a reaction-result
   * error in the harness logs.
   */
  react(key, args = {}) {
    if (key === 'burst') {
      const strength = typeof args.strength === 'number' ? clamp01(args.strength) : 1;
      this._burstStrength = strength;
      this._burstUntil = performance.now() + BURST_MS;
      return;
    }
    throw new Error(`glitch: unknown reaction '${key}'`);
  }

  // Current burst contribution (0 when no burst is active), decaying
  // linearly over the envelope window.
  _burstAmount() {
    const now = performance.now();
    if (now >= this._burstUntil) return 0;
    const remaining = (this._burstUntil - now) / BURST_MS; // 1 → 0
    return this._burstStrength * remaining;
  }

  // ── Contract: render ───────────────────────────────────────────────
  render(sourceCanvas, ctx) {
    const amt = clamp01(this._intensity + this._burstAmount());
    if (amt <= 0.001) {
      ctx.drawImage(sourceCanvas, 0, 0, this._w, this._h);
      return;
    }
    if (this._mode === 'slice') this._renderSlice(sourceCanvas, ctx, amt);
    else if (this._mode === 'blocks') this._renderBlocks(sourceCanvas, ctx, amt);
    else this._renderRgbSplit(sourceCanvas, ctx, amt);
  }

  _renderSlice(source, ctx, amt) {
    const { _w: w, _h: h } = this;
    ctx.drawImage(source, 0, 0, w, h);
    const bands = 10 + Math.floor(amt * 20);
    const bandH = Math.ceil(h / bands);
    const maxShift = amt * w * 0.15;
    for (let i = 0; i < bands; i++) {
      if (Math.random() > amt) continue; // P(shift this band) = amt
      const y = i * bandH;
      const dx = (Math.random() * 2 - 1) * maxShift;
      ctx.drawImage(source, 0, y, w, bandH, dx, y, w, bandH);
    }
  }

  _renderBlocks(source, ctx, amt) {
    const { _w: w, _h: h } = this;
    ctx.drawImage(source, 0, 0, w, h);
    const n = Math.floor(amt * 30);
    for (let i = 0; i < n; i++) {
      const bw = 20 + Math.random() * w * 0.3;
      const bh = 5 + Math.random() * h * 0.15;
      const sx = Math.random() * (w - bw);
      const sy = Math.random() * (h - bh);
      const dx = sx + (Math.random() * 2 - 1) * amt * w * 0.2;
      const dy = sy + (Math.random() * 2 - 1) * amt * h * 0.05;
      ctx.drawImage(source, sx, sy, bw, bh, dx, dy, bw, bh);
    }
  }

  _renderRgbSplit(source, ctx, amt) {
    const { _w: w, _h: h } = this;
    this._ensureChannels();
    const dx = amt * w * 0.04;
    // Isolate each channel into its own canvas (drawImage then
    // multiply by a pure-channel color zeroes the other two), then
    // recombine additively at horizontal offsets → chromatic
    // aberration. Aligned (dx=0) recombines to the original image.
    this._isolate(this._channels.r, source, '#ff0000');
    this._isolate(this._channels.g, source, '#00ff00');
    this._isolate(this._channels.b, source, '#0000ff');
    ctx.clearRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'lighter';
    ctx.drawImage(this._channels.r, dx, 0, w, h);
    ctx.drawImage(this._channels.g, 0, 0, w, h);
    ctx.drawImage(this._channels.b, -dx, 0, w, h);
    ctx.globalCompositeOperation = 'source-over';
  }

  _isolate(canvas, source, channelColor) {
    const c = canvas.getContext('2d');
    c.globalCompositeOperation = 'source-over';
    c.clearRect(0, 0, this._w, this._h);
    c.drawImage(source, 0, 0, this._w, this._h);
    c.globalCompositeOperation = 'multiply';
    c.fillStyle = channelColor;
    c.fillRect(0, 0, this._w, this._h);
    c.globalCompositeOperation = 'source-over';
  }

  _ensureChannels() {
    if (this._channels
        && this._channels.r.width === this._w
        && this._channels.r.height === this._h) {
      return;
    }
    const make = () => {
      const cv = document.createElement('canvas');
      cv.width = this._w;
      cv.height = this._h;
      return cv;
    };
    this._channels = { r: make(), g: make(), b: make() };
  }
}
