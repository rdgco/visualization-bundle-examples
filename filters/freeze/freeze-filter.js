/**
 * Freeze Filter — sample-and-hold / stutter
 *
 * The third temporal filter in this bundle, and the conceptual complement to
 * `feedback` and `echo`. Those two ADD motion history (one decays it, one
 * delays it); `freeze` REMOVES motion — it captures a frame and holds it. The
 * three together cover the temporal operators decay / delay / freeze.
 *
 * It's also the one that introduces the CAPTURE reaction shape. The bundle's
 * reactions so far are a decaying envelope (`pulse`/`burst`), a latched toggle
 * (`reverse`), and a state-reset (`clear`); `capture` is the missing kind — a
 * snapshot grab — paired with `release` to resume live.
 *
 * Pure Canvas2D: a single held frame plus a few drawImages. No per-pixel math
 * (a freeze is a copy-and-hold), so no WebGL and no ring — distinct again from
 * echo's ring buffer.
 *
 * Modes:
 *   - manual  — live until you `capture`; then the grabbed frame holds (over
 *     `mix`) until `release`. The performance / freeze-on-a-hit mode.
 *   - stutter — auto: re-grab every `holdTime` ms and hold, so motion judders
 *     forward in chunks. Bind `holdTime` to tempo for beat-synced stutter.
 *   - slice   — like stutter, but only a random subset of bands freeze each
 *     window (the rest stay live) — a torn, datamosh look.
 *
 * Timing is wall-clock (`performance.now()`), so the stutter rate is
 * frame-rate independent.
 */

export const key = 'freeze';
export const label = 'Freeze';
export const type = 'filter';
export const category = 'demos';
export const description =
  'Sample-and-hold / stutter post-process: captures a frame and holds it, the ' +
  'temporal complement to `feedback` and `echo` (it removes motion instead of ' +
  'adding history). manual mode freezes on a `capture` reaction until ' +
  '`release`; stutter mode re-grabs every `holdTime` ms (bind to tempo) for a ' +
  'beat-synced judder; slice mode freezes a random subset of bands for a torn ' +
  'datamosh look. `mix` blends the frozen frame over live. Introduces the ' +
  'capture/grab reaction shape.';

const MODES = ['manual', 'stutter', 'slice'];
const AXES = ['horizontal', 'vertical'];

// Cross-host audio-modulation marker (see other filters for the rationale).
// Includes lfo + random so the platform's generators can drive any attribute.
const audioMod = defaultAmount => ({
  kind: 'audio',
  sourceTypes: ['audio', 'oneshot', 'note', 'tempo', 'lfo', 'random'],
  defaultAmount
});

export const params = {
  // ── Freeze ─────────────────────────────────────────────────────────────
  mode: {
    type: 'enum',
    label: 'Mode',
    options: MODES,
    default: 'stutter',
    description:
      'manual = live until you fire `capture`, then hold until `release` ' +
      '(freeze-on-a-hit). stutter = auto re-grab every `holdTime` ms (motion ' +
      'judders forward; bind holdTime to tempo). slice = stutter, but only a ' +
      'random subset of bands freeze each window (torn / datamosh).',
    paramGroup: 'freeze',
    paramGroupLabel: 'Freeze',
    paramGroupCollapsed: false
  },
  holdTime: {
    type: 'number',
    label: 'Hold Time',
    default: 150,
    min: 20,
    max: 2000,
    step: 1,
    description:
      'stutter / slice: how long each captured frame is held before re-grabbing, ' +
      'in milliseconds. Short = fast judder; long = slow chunky freeze. Bind to ' +
      'tempo for beat-locked stutter.',
    modulation: audioMod(80),
    paramGroup: 'freeze'
  },
  mix: {
    type: 'number',
    label: 'Mix',
    default: 1,
    min: 0,
    max: 1,
    step: 0.01,
    description:
      'How strongly the frozen frame covers the live image. 1 = fully frozen; ' +
      '<1 = a ghost of the freeze over live motion. 0 = no freeze (live).',
    modulation: audioMod(0.4),
    paramGroup: 'freeze'
  },

  // ── Slice ──────────────────────────────────────────────────────────────
  sliceCount: {
    type: 'number',
    label: 'Slice Count',
    default: 8,
    min: 2,
    max: 32,
    step: 1,
    description:
      'slice mode: how many bands to divide the frame into. More = finer ' +
      'tearing. Structural — not modulated.',
    paramGroup: 'slice',
    paramGroupLabel: 'Slice',
    paramGroupCollapsed: true
  },
  sliceAmount: {
    type: 'number',
    label: 'Slice Amount',
    default: 0.5,
    min: 0,
    max: 1,
    step: 0.01,
    description:
      'slice mode: fraction of bands that freeze each window (the rest stay ' +
      'live). 0 = all live; 1 = all frozen (= stutter). The torn-ness knob.',
    modulation: audioMod(0.4),
    paramGroup: 'slice'
  },
  sliceAxis: {
    type: 'enum',
    label: 'Slice Axis',
    options: AXES,
    default: 'horizontal',
    description: 'slice mode: band orientation — horizontal rows or vertical columns.',
    paramGroup: 'slice'
  }
};

export const reactions = {
  capture: {
    label: 'Capture',
    description:
      'Grab the current frame and hold it. In manual mode this freezes the ' +
      'screen until `release`; in stutter / slice it re-syncs the window to ' +
      'now (re-grab on the beat). The snapshot-grab reaction.',
    args: {}
  },
  release: {
    label: 'Release',
    description:
      'Resume live in manual mode (unfreeze). No-op in the auto modes, which ' +
      'keep stuttering. State-reset shape, paired with `capture`.',
    args: {}
  }
};

// ── pure helpers (exported for unit tests) ──────────────────────────────
export function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

export default class FreezeFilter {
  constructor(width, height, initialParams = {}) {
    this._w = Math.max(1, width | 0);
    this._h = Math.max(1, height | 0);

    // Resolved control state.
    this._mode = 'stutter';
    this._holdTime = 150;
    this._mix = 1;
    this._sliceCount = 8;
    this._sliceAmount = 0.5;
    this._sliceAxis = 'horizontal';

    // Hold state.
    this._frozen = false;        // manual mode: showing the held frame?
    this._captureRequested = false;
    this._holdStart = -Infinity; // wall-clock of the current window's grab
    this._hasHeld = false;       // a frame has been captured at least once
    this._frozenBands = [];      // slice mode: which bands are frozen this window

    this._supported = typeof document !== 'undefined' && typeof document.createElement === 'function';
    this._held = null;
    this._heldCtx = null;

    this._applyParams(initialParams);
  }

  _applyParams(p) {
    if (!p) return;
    if (typeof p.mode === 'string' && MODES.includes(p.mode)) this._mode = p.mode;
    if (typeof p.holdTime === 'number' && Number.isFinite(p.holdTime)) this._holdTime = clamp(p.holdTime, 20, 2000);
    if (typeof p.mix === 'number' && Number.isFinite(p.mix)) this._mix = clamp(p.mix, 0, 1);
    if (typeof p.sliceCount === 'number' && Number.isFinite(p.sliceCount)) this._sliceCount = clamp(Math.round(p.sliceCount), 2, 32);
    if (typeof p.sliceAmount === 'number' && Number.isFinite(p.sliceAmount)) this._sliceAmount = clamp(p.sliceAmount, 0, 1);
    if (typeof p.sliceAxis === 'string' && AXES.includes(p.sliceAxis)) this._sliceAxis = p.sliceAxis;
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
    this._held = null;   // reallocated at next render against the new size
    this._hasHeld = false;
  }

  cleanup() {
    if (this._held) this._held.width = this._held.height = 0;
    this._held = null;
    this._heldCtx = null;
  }

  // ── Contract: reactions ─────────────────────────────────────────────────
  react(key) {
    if (key === 'capture') {
      this._captureRequested = true; // grabbed on the next render (has the source)
      this._frozen = true;
      return;
    }
    if (key === 'release') {
      this._frozen = false;
      return;
    }
    throw new Error(`freeze: unknown reaction '${key}'`);
  }

  // True when an auto mode's current window has elapsed and it's time to grab
  // a fresh frame.
  _dueForCapture(now) {
    if (this._mode !== 'stutter' && this._mode !== 'slice') return false;
    return now - this._holdStart >= this._holdTime;
  }

  _ensureHeld() {
    if (this._held && this._held.width === this._w && this._held.height === this._h) return;
    this._held = document.createElement('canvas');
    this._held.width = this._w;
    this._held.height = this._h;
    this._heldCtx = this._held.getContext('2d');
    this._hasHeld = false;
  }

  // slice mode: re-roll which bands freeze this window (per-band probability =
  // sliceAmount). Uses Math.random — visual, not asserted in tests.
  _rollBands() {
    const n = this._sliceCount;
    const bands = new Array(n);
    for (let i = 0; i < n; i++) bands[i] = Math.random() < this._sliceAmount;
    this._frozenBands = bands;
  }

  _drawFrozenBands(ctx) {
    const n = this._frozenBands.length;
    const horiz = this._sliceAxis === 'horizontal';
    for (let i = 0; i < n; i++) {
      if (!this._frozenBands[i]) continue;
      if (horiz) {
        const y0 = Math.round((i * this._h) / n);
        const y1 = Math.round(((i + 1) * this._h) / n);
        ctx.drawImage(this._held, 0, y0, this._w, y1 - y0, 0, y0, this._w, y1 - y0);
      } else {
        const x0 = Math.round((i * this._w) / n);
        const x1 = Math.round(((i + 1) * this._w) / n);
        ctx.drawImage(this._held, x0, 0, x1 - x0, this._h, x0, 0, x1 - x0, this._h);
      }
    }
  }

  // ── Contract: render ─────────────────────────────────────────────────────
  render(sourceCanvas, ctx) {
    if (!this._supported) {
      if (ctx && typeof ctx.drawImage === 'function') {
        ctx.drawImage(sourceCanvas, 0, 0, this._w, this._h);
      }
      return;
    }

    this._ensureHeld();
    const now = performance.now();

    // Decide whether to (re)capture the held frame this render.
    let capture = this._captureRequested || this._dueForCapture(now);
    this._captureRequested = false;
    if (capture) {
      this._heldCtx.clearRect(0, 0, this._w, this._h);
      this._heldCtx.drawImage(sourceCanvas, 0, 0, this._w, this._h);
      this._holdStart = now;
      this._hasHeld = true;
      if (this._mode === 'slice') this._rollBands();
    }

    // Live source underneath.
    ctx.drawImage(sourceCanvas, 0, 0, this._w, this._h);

    // Overlay the held frame where the mode calls for it.
    const showHeld = this._mode === 'manual' ? this._frozen : true;
    if (!showHeld || !this._hasHeld || this._mix <= 0) return;

    ctx.save();
    ctx.globalAlpha = this._mix;
    if (this._mode === 'slice') {
      this._drawFrozenBands(ctx);
    } else {
      ctx.drawImage(this._held, 0, 0, this._w, this._h);
    }
    ctx.restore();
  }
}
