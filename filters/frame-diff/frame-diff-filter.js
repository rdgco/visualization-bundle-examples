/**
 * Frame Difference Filter — motion detector / motion mask
 *
 * The analytic member of the temporal family. Where feedback / echo / freeze /
 * long-exposure are decorative (they reshape motion history), frame-diff
 * MEASURES motion: it keeps the previous frame and computes |current − previous|
 * per pixel, so only what MOVED lights up. Static areas stay dark.
 *
 * Per-pixel + a `detail` downscale lever — the same family as `edge-detect`
 * (its getImageData/threshold/glow pattern is the template here), but temporal:
 * the retained buffer is the previous frame rather than a neighbourhood kernel.
 *
 * A raw consecutive-frame diff only lights the leading/trailing edge of a
 * moving thing for a single frame — thin and flickery. So a `trail` control
 * persists the motion map (max-blend with decay), turning it into glowing
 * motion trails that read on stage.
 *
 * Modes:
 *   - motion — show the motion itself (moving edges glow in `motionColor` or
 *     the moving content's own colour; static = dark). The showpiece.
 *   - reveal — show the LIVE frame only where it moved (motion-keyed cutout
 *     over a dimmable backdrop). Moving subjects punch through.
 *   - mask   — a hard stencil: opaque where moving, transparent where still.
 *
 * Pipeline (per frame, at `detail` resolution): read the source back → diff
 * against the stored previous frame → threshold + gain (+ `pulse`) → persist
 * via `trail` → build the motion map for the mode → composite (backdrop +
 * glow + crisp), upscaled → store this frame as next frame's previous.
 *
 * `clear` resets the stored frame + trail; `pulse` flashes sensitivity on a
 * beat. Every continuous attribute is audio-bindable.
 */

export const key = 'frame-diff';
export const label = 'Frame Difference';
export const type = 'filter';
export const category = 'demos';
export const description =
  'Motion detector: keeps the previous frame and shows |current − previous|, ' +
  'so only what moved lights up. The analytic temporal filter — measures ' +
  'motion rather than reshaping it. motion mode glows the moving edges, reveal ' +
  'mode shows the live frame only where it moved, mask mode is a hard motion ' +
  'stencil. `trail` persists the motion into glowing trails; `sensitivity` / ' +
  '`threshold` tune detection; `clear` resets and `pulse` flashes on a beat. ' +
  'Runs at a tunable `detail` resolution like edge-detect.';

const MODES = ['motion', 'reveal', 'mask'];
const COLOR_MODES = ['solid', 'source'];

// Cross-host audio-modulation marker (see other filters for the rationale).
// Includes lfo + random so the platform's generators can drive any attribute.
const audioMod = defaultAmount => ({
  kind: 'audio',
  sourceTypes: ['audio', 'oneshot', 'note', 'tempo', 'lfo', 'random'],
  defaultAmount
});

export const params = {
  // ── Detect ─────────────────────────────────────────────────────────────
  mode: {
    type: 'enum',
    label: 'Mode',
    options: MODES,
    default: 'motion',
    description:
      'motion = show the motion itself (moving edges glow, static is dark); ' +
      'reveal = show the live frame only where it moved (motion-keyed cutout); ' +
      'mask = a hard stencil, opaque where moving and transparent where still.',
    paramGroup: 'detect',
    paramGroupLabel: 'Detect',
    paramGroupCollapsed: false
  },
  sensitivity: {
    type: 'number',
    label: 'Sensitivity',
    default: 2,
    min: 0,
    max: 8,
    step: 0.05,
    description:
      'Gain on the detected motion — how strongly a given amount of change ' +
      'lights up. Raise to catch subtle movement; lower to show only fast/big ' +
      'motion.',
    modulation: audioMod(2),
    paramGroup: 'detect'
  },
  threshold: {
    type: 'number',
    label: 'Threshold',
    default: 0.08,
    min: 0,
    max: 1,
    step: 0.005,
    description:
      'Motion floor — changes below this are ignored (kills sensor noise and ' +
      'compression shimmer in static areas). Raise until still scenes go dark.',
    modulation: audioMod(0.1),
    paramGroup: 'detect'
  },
  detail: {
    type: 'number',
    label: 'Detail / quality',
    default: 0.5,
    min: 0.2,
    max: 1,
    step: 0.05,
    description:
      'Resolution the diff runs at, as a fraction of the canvas. The perf ' +
      'lever (the per-pixel readback is the cost): lower = faster + softer ' +
      'motion, higher = crisper. Structural — not modulated.',
    paramGroup: 'detect'
  },

  // ── Look ───────────────────────────────────────────────────────────────
  trail: {
    type: 'number',
    label: 'Motion Trail',
    default: 0.6,
    min: 0,
    max: 0.97,
    step: 0.01,
    description:
      'How long detected motion lingers (persistence of the motion map). 0 = ' +
      'raw one-frame diff (thin, flickery); higher = motion leaves glowing ' +
      'trails that fade over time. The single biggest "reads on stage" knob.',
    modulation: audioMod(0.3),
    paramGroup: 'look',
    paramGroupLabel: 'Look',
    paramGroupCollapsed: false
  },
  colorMode: {
    type: 'enum',
    label: 'Colour Mode',
    options: COLOR_MODES,
    default: 'solid',
    description:
      'motion mode: solid = moving edges drawn in `motionColor`; source = they ' +
      "keep the moving content's own colour.",
    paramGroup: 'look'
  },
  motionColor: {
    type: 'color',
    label: 'Motion Colour',
    default: '#00ffaa',
    description: 'Colour of the motion in solid colour-mode (and the mask stencil).',
    paramGroup: 'look'
  },
  backgroundOpacity: {
    type: 'number',
    label: 'Wet / dry (source thru)',
    default: 0,
    min: 0,
    max: 1,
    step: 0.01,
    description:
      'How much of the live frame shows behind the motion. 0 = motion on ' +
      'black (clearest); 1 = motion over the full source; in between is a ' +
      'crossfade. In reveal mode this dims the static backdrop.',
    modulation: audioMod(0.3),
    paramGroup: 'look'
  },
  glow: {
    type: 'number',
    label: 'Glow',
    default: 0.4,
    min: 0,
    max: 1,
    step: 0.01,
    description: 'Additive bloom around the motion. 0 = crisp only.',
    modulation: audioMod(0.3),
    paramGroup: 'look'
  },
  glowSize: {
    type: 'number',
    label: 'Glow radius',
    default: 8,
    min: 0,
    max: 40,
    step: 1,
    description: 'How far the glow spreads, in pixels.',
    modulation: audioMod(6),
    paramGroup: 'look'
  }
};

export const reactions = {
  pulse: {
    label: 'Pulse',
    description:
      'Flash the motion — boosts sensitivity briefly, then decays back over ' +
      '`duration`. Fire on a beat so all motion flares on the hit.',
    args: {
      strength: {
        type: 'number',
        label: 'Strength',
        default: 0.8,
        min: 0,
        max: 1,
        step: 0.01,
        description: 'Size of the sensitivity flare at its peak.'
      },
      duration: {
        type: 'number',
        label: 'Duration (s)',
        default: 0.8,
        min: 0.05,
        max: 4,
        step: 0.05,
        description: 'How long the flare takes to fade back, in seconds.'
      }
    }
  },
  clear: {
    label: 'Clear motion',
    description:
      'Reset the stored previous frame and wipe the motion trail — a clean ' +
      'slate (no motion until the next frame moves). State-reset reaction.',
    args: {}
  }
};

const PULSE_DECAY = 0.8;        // default fade (s) when fired without a duration
const PULSE_SENS_BOOST = 4;     // extra sensitivity at the peak of a full pulse

// ── pure helpers (exported for unit tests) ──────────────────────────────
export function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}
// Motion amount 0..1 from a normalized per-pixel diff (0..1), after the
// threshold floor and the sensitivity gain.
export function motionAmount(diff, threshold, gain) {
  return clamp((diff - threshold) * gain, 0, 1);
}
function hexToRgb(hex) {
  if (typeof hex !== 'string') return { r: 0, g: 255, b: 170 };
  const h = hex.replace('#', '');
  if (h.length < 6) return { r: 0, g: 255, b: 170 };
  return {
    r: parseInt(h.slice(0, 2), 16) || 0,
    g: parseInt(h.slice(2, 4), 16) || 0,
    b: parseInt(h.slice(4, 6), 16) || 0
  };
}

export default class FrameDiffFilter {
  constructor(width, height, initialParams = {}) {
    this._w = Math.max(1, width | 0);
    this._h = Math.max(1, height | 0);

    // Resolved control state.
    this._mode = 'motion';
    this._sensitivity = 2;
    this._threshold = 0.08;
    this._detail = 0.5;
    this._trail = 0.6;
    this._colorMode = 'solid';
    this._motionRGB = { r: 0, g: 255, b: 170 };
    this._backgroundOpacity = 0;
    this._glow = 0.4;
    this._glowSize = 8;

    // Pulse envelope (edge-detect style: 0..1 value + chosen fade seconds).
    this._pulse = 0;
    this._pulseDecay = PULSE_DECAY;
    this._clearRequested = false;
    this._lastT = (typeof performance !== 'undefined' ? performance.now() : 0);

    // Per-pixel buffers (at detail resolution).
    this._supported = typeof document !== 'undefined' && typeof document.createElement === 'function';
    this._work = null;   // downscaled source readback canvas
    this._wctx = null;
    this._edge = null;    // built motion map canvas
    this._ectx = null;
    this._sw = 0;
    this._sh = 0;
    this._prev = null;    // Uint8ClampedArray of the previous frame's pixels
    this._motion = null;  // Float32Array motion map (for trail persistence)

    this._applyParams(initialParams);
  }

  _applyParams(p) {
    if (!p) return;
    if (typeof p.mode === 'string' && MODES.includes(p.mode)) this._mode = p.mode;
    if (typeof p.sensitivity === 'number' && Number.isFinite(p.sensitivity)) this._sensitivity = clamp(p.sensitivity, 0, 8);
    if (typeof p.threshold === 'number' && Number.isFinite(p.threshold)) this._threshold = clamp(p.threshold, 0, 1);
    if (typeof p.detail === 'number' && Number.isFinite(p.detail)) this._detail = clamp(p.detail, 0.2, 1);
    if (typeof p.trail === 'number' && Number.isFinite(p.trail)) this._trail = clamp(p.trail, 0, 0.97);
    if (typeof p.colorMode === 'string' && COLOR_MODES.includes(p.colorMode)) this._colorMode = p.colorMode;
    if (typeof p.motionColor === 'string') this._motionRGB = hexToRgb(p.motionColor);
    if (typeof p.backgroundOpacity === 'number' && Number.isFinite(p.backgroundOpacity)) this._backgroundOpacity = clamp(p.backgroundOpacity, 0, 1);
    if (typeof p.glow === 'number' && Number.isFinite(p.glow)) this._glow = clamp(p.glow, 0, 1);
    if (typeof p.glowSize === 'number' && Number.isFinite(p.glowSize)) this._glowSize = clamp(p.glowSize, 0, 40);
  }

  // ── Contract: live-update aliases + lifecycle ──────────────────────────
  updateParams(p) { this._applyParams(p); }
  updateConfig(p) { this._applyParams(p); }
  setConfig(p) { this._applyParams(p); }
  setModulatedValues(p) { this._applyParams(p); }

  isActive() { return this._supported; }

  resize(width, height) {
    this._w = Math.max(1, width | 0);
    this._h = Math.max(1, height | 0);
    // Buffers reallocate at the next render when the working size changes.
  }

  cleanup() {
    if (this._work) this._work.width = this._work.height = 0;
    if (this._edge) this._edge.width = this._edge.height = 0;
    this._work = this._wctx = this._edge = this._ectx = null;
    this._prev = null;
    this._motion = null;
  }

  // ── Contract: reactions ─────────────────────────────────────────────────
  react(key, args = {}) {
    if (key === 'pulse') {
      this._pulse = clamp(typeof args.strength === 'number' ? args.strength : 0.8, 0, 1);
      this._pulseDecay = clamp(typeof args.duration === 'number' ? args.duration : PULSE_DECAY, 0.05, 4);
      return;
    }
    if (key === 'clear') {
      this._clearRequested = true;
      return;
    }
    throw new Error(`frame-diff: unknown reaction '${key}'`);
  }

  _ensureBuffers(sw, sh) {
    if (this._work && this._sw === sw && this._sh === sh) return;
    if (!this._work) {
      this._work = document.createElement('canvas');
      this._wctx = this._work.getContext('2d', { willReadFrequently: true });
      this._edge = document.createElement('canvas');
      this._ectx = this._edge.getContext('2d');
    }
    this._sw = this._work.width = this._edge.width = sw;
    this._sh = this._work.height = this._edge.height = sh;
    this._prev = null;     // size changed — re-seed the previous frame
    this._motion = null;
  }

  // ── Contract: render ─────────────────────────────────────────────────────
  render(sourceCanvas, ctx) {
    if (!this._supported) {
      if (ctx && typeof ctx.drawImage === 'function') {
        ctx.drawImage(sourceCanvas, 0, 0, this._w, this._h);
      }
      return;
    }

    const w = this._w;
    const h = this._h;

    // Advance the pulse envelope.
    const now = performance.now();
    let dt = (now - this._lastT) / 1000;
    if (!Number.isFinite(dt) || dt < 0) dt = 0;
    if (dt > 0.1) dt = 0.1;
    this._lastT = now;
    if (this._pulse > 0) this._pulse = Math.max(0, this._pulse - dt / this._pulseDecay);
    const gain = this._sensitivity + this._pulse * PULSE_SENS_BOOST;

    // Backdrop: black, then the live frame faded in by wet/dry.
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, w, h);
    if (this._backgroundOpacity > 0) {
      ctx.save();
      ctx.globalAlpha = this._backgroundOpacity;
      ctx.drawImage(sourceCanvas, 0, 0, w, h);
      ctx.restore();
    }

    // Read the source back at the working resolution.
    const sw = Math.max(1, Math.round(w * this._detail));
    const sh = Math.max(1, Math.round(h * this._detail));
    this._ensureBuffers(sw, sh);

    if (this._clearRequested) {
      this._prev = null;
      this._clearRequested = false;
    }

    this._wctx.drawImage(sourceCanvas, 0, 0, sw, sh);
    let cur;
    try {
      cur = this._wctx.getImageData(0, 0, sw, sh);
    } catch {
      return; // tainted/zero-size source — backdrop already drew
    }
    const cd = cur.data;

    // First frame (or after clear / resize): seed the previous frame, no motion.
    if (!this._prev || this._prev.length !== cd.length) {
      this._prev = new Uint8ClampedArray(cd);
      this._motion = new Float32Array(sw * sh);
      return;
    }

    const pd = this._prev;
    const motion = this._motion;
    const trail = this._trail;
    const reveal = this._mode === 'reveal';
    const mask = this._mode === 'mask';
    const useSource = this._colorMode === 'source';
    const mc = this._motionRGB;

    const edgeImg = this._ectx.createImageData(sw, sh);
    const od = edgeImg.data;

    for (let p = 0, i = 0; p < motion.length; p++, i += 4) {
      const diff = (Math.abs(cd[i] - pd[i]) + Math.abs(cd[i + 1] - pd[i + 1]) + Math.abs(cd[i + 2] - pd[i + 2])) / 765;
      let m = motionAmount(diff, this._threshold, gain);
      const held = motion[p] * trail;
      if (held > m) m = held; // trail: persist the brighter of new vs decayed-old
      motion[p] = m;
      if (m <= 0.003) continue; // leave transparent

      if (reveal) {
        od[i] = cd[i]; od[i + 1] = cd[i + 1]; od[i + 2] = cd[i + 2];
        od[i + 3] = (m * 255) | 0;
      } else if (mask) {
        od[i] = mc.r; od[i + 1] = mc.g; od[i + 2] = mc.b;
        od[i + 3] = m >= 0.5 ? 255 : 0;
      } else { // motion
        if (useSource) { od[i] = cd[i]; od[i + 1] = cd[i + 1]; od[i + 2] = cd[i + 2]; }
        else { od[i] = mc.r; od[i + 1] = mc.g; od[i + 2] = mc.b; }
        od[i + 3] = (m * 255) | 0;
      }
    }
    this._ectx.putImageData(edgeImg, 0, 0);

    // Composite: blurred additive glow underneath, crisp motion on top.
    if (this._glow > 0 && this._glowSize > 0) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.filter = `blur(${this._glowSize}px)`;
      const passes = Math.max(1, Math.round(this._glow * 4));
      ctx.globalAlpha = Math.min(1, 0.4 + this._glow * 0.6);
      for (let k = 0; k < passes; k++) ctx.drawImage(this._edge, 0, 0, w, h);
      ctx.restore();
    }
    ctx.drawImage(this._edge, 0, 0, w, h);

    // Store this frame as next frame's previous.
    pd.set(cd);
  }
}
