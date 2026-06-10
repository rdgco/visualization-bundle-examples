/**
 * edge-detect — Sobel edge detection over the source, with operator
 * control over how much of the original shows through (wet/dry), how the
 * edges are coloured, and how much they glow.
 *
 * Pipeline per frame (all Canvas2D, no WebGL):
 *   1. Paint the background — a solid colour, with the source image
 *      faded in over it by `backgroundOpacity`. 0 = edges float on the
 *      backdrop colour (classic "edges only"); 1 = edges sit over the
 *      full original image; in between is a wet/dry crossfade.
 *   2. Run a 3×3 Sobel on the source's luminance at a *downscaled*
 *      working resolution (`detail`) — the single biggest lever for
 *      keeping up with video. The edge map is built into an offscreen
 *      canvas: alpha = edge strength (threshold + gain), RGB = either a
 *      fixed `edgeColor` or the sampled source colour (`colorMode`).
 *   3. Composite the edge map onto the output, upscaled. A blurred,
 *      additive pass underneath gives the glow/bloom; a crisp pass on
 *      top keeps the lines sharp.
 *
 * Performance notes:
 *   - The expensive part (getImageData + Sobel) runs on a `detail`-scaled
 *     buffer, so 0.5 quarters the pixel work. Drop `detail` for live
 *     video on a big canvas; raise it for stills.
 *   - The glow uses `ctx.filter = 'blur(...)'` which Chromium runs on the
 *     GPU — far cheaper than a hand-rolled box blur in JS.
 *   - No allocation per frame beyond the two getImageData/putImageData
 *     buffers (unavoidable for readback). The Sobel typed arrays are
 *     reallocated only when the working size changes.
 *
 * The pure math (luminance, Sobel, threshold/gain, config normalization)
 * lives in `lib/edges.js` and is unit-tested; this file owns the canvas
 * work, the glow compositing, the `pulse` reaction's decay timing, and
 * the param plumbing.
 */

import {
  COLOR_MODES,
  DEFAULT_CONFIG,
  clamp,
  clamp01,
  num,
  hexToRgb,
  normalizeConfig,
  computeLuminance,
  sobel,
  edgeAlpha
} from './lib/edges.js';

export const key = 'edge-detect';
export const label = 'Edge Detect';
export const type = 'filter';
export const category = 'stylize';
export const description =
  'Sobel edge detection over the source. Show edges only or blend the ' +
  'original through with the wet/dry control, colour the edges with a ' +
  'fixed tint or the underlying image, and add a glow around them. ' +
  'Runs at a tunable resolution so it keeps up with video.';

// Cross-host audio-modulation marker. Harness reads `kind: 'audio'`; midi-daddy
// reads `sourceTypes` + `defaultAmount`; lfo/random let the platform's
// generators drive the param. Each host ignores the other's keys.
const audioMod = defaultAmount => ({
  kind: 'audio',
  sourceTypes: ['audio', 'oneshot', 'note', 'tempo', 'lfo', 'random'],
  defaultAmount
});

export const params = {
  backgroundOpacity: {
    type: 'number',
    label: 'Wet / dry (source thru)',
    default: DEFAULT_CONFIG.backgroundOpacity,
    min: 0, max: 1, step: 0.01,
    description:
      'How much of the original image shows behind the edges. 0 = edges ' +
      'only (on the backdrop colour); 1 = edges over the full source; ' +
      'in between crossfades the two.',
    modulation: audioMod(0.3)
  },
  threshold: {
    type: 'number',
    label: 'Threshold',
    default: DEFAULT_CONFIG.threshold,
    min: 0, max: 1, step: 0.005,
    description:
      'Edge sensitivity floor. Raise to drop faint texture/noise and ' +
      'keep only the strong outlines; lower to catch fine detail.',
    modulation: audioMod(0.1)
  },
  gain: {
    type: 'number',
    label: 'Edge intensity',
    default: DEFAULT_CONFIG.gain,
    min: 0, max: 8, step: 0.05,
    description: 'Brightness/opacity of the detected edges. Push faint edges to full strength.',
    modulation: audioMod(2)
  },
  colorMode: {
    type: 'enum',
    label: 'Edge colour mode',
    options: COLOR_MODES,
    default: DEFAULT_CONFIG.colorMode,
    description:
      'solid = every edge drawn in the edge colour; source = edges keep ' +
      'the colour of the image underneath them (neon outline vs traced photo).'
  },
  edgeColor: {
    type: 'color',
    label: 'Edge colour',
    default: DEFAULT_CONFIG.edgeColor,
    description: 'Colour of the edges in solid mode (ignored in source mode).'
  },
  backgroundColor: {
    type: 'color',
    label: 'Backdrop colour',
    default: DEFAULT_CONFIG.backgroundColor,
    description: 'Fill behind the edges, visible wherever the source is faded out by wet/dry.'
  },
  glow: {
    type: 'number',
    label: 'Glow',
    default: DEFAULT_CONFIG.glow,
    min: 0, max: 1, step: 0.01,
    description: 'Strength of the additive bloom around the edges. 0 = crisp lines only.',
    modulation: audioMod(0.3)
  },
  glowSize: {
    type: 'number',
    label: 'Glow radius',
    default: DEFAULT_CONFIG.glowSize,
    min: 0, max: 40, step: 1,
    description: 'How far the glow spreads, in pixels. Larger = softer halo.',
    modulation: audioMod(8)
  },
  detail: {
    type: 'number',
    label: 'Detail / quality',
    default: DEFAULT_CONFIG.detail,
    min: 0.2, max: 1, step: 0.05,
    description:
      'Resolution the edge pass runs at, as a fraction of the canvas. ' +
      'Lower = faster (good for live video), higher = finer edges.',
    modulation: audioMod(0.2)
  }
};

export const reactions = {
  pulse: {
    label: 'Pulse',
    description:
      'Flares the edges — boosts intensity and glow, then decays back ' +
      'over the chosen duration. Fire it on a beat/hit for a reactive flash.',
    args: {
      strength: {
        type: 'number',
        label: 'Strength',
        default: 0.8,
        min: 0, max: 1, step: 0.01,
        description: 'Size of the flare — how much extra intensity and glow the pulse adds at its peak.'
      },
      duration: {
        type: 'number',
        label: 'Duration (s)',
        default: 0.8,
        min: 0.05, max: 4, step: 0.05,
        description: 'How long the flare takes to fade back to normal, in seconds. Larger = slower decay.'
      }
    }
  }
};

// Default decay (seconds) when a pulse is fired without a duration arg.
const PULSE_DECAY = 0.8;
// How much a full-strength pulse adds, at peak, to gain and glow.
const PULSE_GAIN_BOOST = 3;
const PULSE_GLOW_BOOST = 0.6;

export default class EdgeDetectFilter {
  constructor(width, height, initialParams = {}) {
    this._w = Math.max(1, width | 0);
    this._h = Math.max(1, height | 0);
    this._config = normalizeConfig(initialParams, DEFAULT_CONFIG);

    // Offscreen work canvas (downscaled source readback) + edge canvas
    // (the built edge map, same downscaled size). Both are re-sized lazily
    // in render() when the working dimensions change.
    // Guarded so the filter constructs headless (degrades to a passthrough)
    // like every other filter in the bundle.
    this._supported = typeof document !== 'undefined' && typeof document.createElement === 'function';
    this._work = this._wctx = this._edge = this._ectx = null;
    if (this._supported) {
      this._work = document.createElement('canvas');
      this._wctx = this._work.getContext('2d', { willReadFrequently: true });
      this._edge = document.createElement('canvas');
      this._ectx = this._edge.getContext('2d');
    }
    this._sw = 0;
    this._sh = 0;

    // Reused Sobel buffers, reallocated only on size change.
    this._lum = null;

    // Pulse state. `_pulse` is the current 0..1 envelope value; `_pulseDecay`
    // is the operator-chosen fade time (seconds) of the in-flight pulse.
    this._pulse = 0;
    this._pulseDecay = PULSE_DECAY;
    this._lastT = performance.now();
  }

  // ── Contract: live-update + lifecycle ──────────────────────────────
  _applyParams(p) {
    this._config = normalizeConfig(p, this._config);
  }
  updateParams(p) { this._applyParams(p); }
  setConfig(p) { this._applyParams(p); }
  setModulatedValues(p) { this._applyParams(p); }

  isActive() { return this._supported; }

  resize(width, height) {
    this._w = Math.max(1, width | 0);
    this._h = Math.max(1, height | 0);
  }

  cleanup() {
    this._lum = null;
    // Drop the offscreen canvas backing stores.
    if (this._work) this._work.width = this._work.height = 0;
    if (this._edge) this._edge.width = this._edge.height = 0;
  }

  // ── Contract: reaction ─────────────────────────────────────────────
  react(reaction, args = {}) {
    if (reaction === 'pulse') {
      this._pulse = clamp01(num(args.strength, 0.8));
      // Clamp the fade time; floor it so the per-frame decay can't divide
      // by zero.
      this._pulseDecay = clamp(num(args.duration, PULSE_DECAY), 0.05, 4);
      return;
    }
    throw new Error(`edge-detect: unknown reaction '${reaction}'`);
  }

  // ── Contract: render ───────────────────────────────────────────────
  render(sourceCanvas, ctx) {
    if (!this._supported) {
      if (ctx && typeof ctx.drawImage === 'function') ctx.drawImage(sourceCanvas, 0, 0, this._w, this._h);
      return;
    }
    const { _w: w, _h: h } = this;
    const cfg = this._config;

    // Advance the pulse envelope.
    const now = performance.now();
    let dt = (now - this._lastT) / 1000;
    if (!Number.isFinite(dt) || dt < 0) dt = 0;
    if (dt > 0.1) dt = 0.1; // clamp after a tab stall / first frame
    this._lastT = now;
    if (this._pulse > 0) {
      this._pulse = Math.max(0, this._pulse - dt / this._pulseDecay);
    }
    const gain = cfg.gain + this._pulse * PULSE_GAIN_BOOST;
    const glow = clamp01(cfg.glow + this._pulse * PULSE_GLOW_BOOST);

    // 1. Background — backdrop colour, then the source faded in over it.
    ctx.fillStyle = cfg.backgroundColor;
    ctx.fillRect(0, 0, w, h);
    if (cfg.backgroundOpacity > 0) {
      ctx.save();
      ctx.globalAlpha = cfg.backgroundOpacity;
      ctx.drawImage(sourceCanvas, 0, 0, w, h);
      ctx.restore();
    }

    // 2. Build the edge map at the downscaled working resolution.
    const sw = Math.max(1, Math.round(w * cfg.detail));
    const sh = Math.max(1, Math.round(h * cfg.detail));
    if (sw !== this._sw || sh !== this._sh) {
      this._sw = this._work.width = this._edge.width = sw;
      this._sh = this._work.height = this._edge.height = sh;
      this._lum = null;
    }

    this._wctx.drawImage(sourceCanvas, 0, 0, sw, sh);
    let src;
    try {
      src = this._wctx.getImageData(0, 0, sw, sh);
    } catch {
      // Tainted canvas (shouldn't happen in Electron file:// — see image
      // layer notes) or a zero-size source. Bail on the edge pass; the
      // background already drew, so the frame is still valid.
      return;
    }

    const lum = computeLuminance(src.data, sw, sh);
    const mag = sobel(lum, sw, sh);

    const edgeImg = this._ectx.createImageData(sw, sh);
    const out = edgeImg.data;
    const sd = src.data;
    const solid = cfg.colorMode === 'solid';
    const { r: er, g: eg, b: eb } = hexToRgb(cfg.edgeColor);
    const { threshold } = cfg;
    for (let p = 0, i = 0; p < mag.length; p++, i += 4) {
      const a = edgeAlpha(mag[p], threshold, gain);
      if (a <= 0) continue; // leave fully transparent
      if (solid) {
        out[i] = er; out[i + 1] = eg; out[i + 2] = eb;
      } else {
        out[i] = sd[i]; out[i + 1] = sd[i + 1]; out[i + 2] = sd[i + 2];
      }
      out[i + 3] = (a * 255) | 0;
    }
    this._ectx.putImageData(edgeImg, 0, 0);

    // 3. Composite the edge map onto the output, upscaled.
    // Glow first (blurred, additive, underneath), crisp lines on top.
    //
    // A blur spreads each thin edge line's alpha thin enough that a
    // single additive pass is almost invisible — and a *larger* radius
    // dilutes it further. So accumulate several blurred additive passes;
    // the pass count + per-pass alpha scale with `glow`, building a
    // bloom that's actually visible and that responds to `glowSize`.
    if (glow > 0 && cfg.glowSize > 0) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.filter = `blur(${cfg.glowSize}px)`;
      const passes = Math.max(1, Math.round(glow * 4));
      ctx.globalAlpha = Math.min(1, 0.4 + glow * 0.6);
      for (let i = 0; i < passes; i++) {
        ctx.drawImage(this._edge, 0, 0, w, h);
      }
      ctx.restore();
    }
    ctx.drawImage(this._edge, 0, 0, w, h);
  }
}
