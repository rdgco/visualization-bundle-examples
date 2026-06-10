/**
 * Echo Filter — rhythmic frame-delay / ghost train
 *
 * The second temporal filter in this bundle, and the deliberate counterpart
 * to `feedback`. Where `feedback` keeps ONE accumulation buffer and decays it
 * exponentially (a smear that fades), `echo` keeps a RING BUFFER of the last
 * couple of seconds of frames and composites a handful of fixed-DELAY taps —
 * the image literally repeats a beat later. Same "retain state across frames"
 * muscle, different temporal operator and a different data structure.
 *
 * It's also the contrast in implementation: `feedback` needed WebGL for its
 * smooth warp; a pure delay-and-composite needs no per-pixel math, so `echo`
 * is plain Canvas2D. The retained-state pattern generalises beyond shaders —
 * here it's an array of ordinary offscreen canvases, time-stamped and read
 * back at `now − delay·k`.
 *
 * Pipeline (per frame):
 *   1. write the current frame into the ring (downscaled by `detail`),
 *      stamped with the current time; advance the write head (circular)
 *   2. draw the live source to the output
 *   3. for tap k = 1..taps: find the stored frame closest to `now − delay·k`
 *      and composite it at a decaying opacity (`echoLevel · falloff^(k-1)`),
 *      with an optional per-tap drift (`offsetX/Y`) and hue step (`hueStep`)
 *      so the ghosts march and drift in colour
 *
 * Lookups are TIME-indexed, not frame-indexed, so the echo timing is
 * frame-rate independent and survives stalls. The ring is sized to cover the
 * deepest tap (taps_max · delay_max = 2000ms); `detail` trades stored-frame
 * sharpness for memory.
 *
 * Controls:
 *   - `delay` / `taps` / `echoLevel` / `falloff` — the echo itself
 *   - `offsetX` / `offsetY` / `hueStep` — per-tap drift & colour
 *   - `blend` / `detail` — compositing & the memory/quality lever
 *   - `burst` reaction — transient swell of the echo on a beat
 *   - `clear` reaction — flush the delay line (kill the tail instantly)
 *
 * Every numeric attribute except the two structural ones (`taps`, `detail`,
 * which reallocate the ring) is audio-bindable; the filter stays audio-blind
 * and the host pushes resolved values via `setModulatedValues()`.
 */

export const key = 'echo';
export const label = 'Echo';
export const type = 'filter';
export const category = 'demos';
export const description =
  'Rhythmic frame-delay post-process: keeps a ring buffer of recent frames ' +
  'and composites fixed-delay ghost taps, so the image repeats a beat later. ' +
  'The temporal counterpart to `feedback` (delay taps vs exponential decay; ' +
  '2D ring buffer vs GPU accumulator). Per-tap drift and hue make a marching, ' +
  'colour-shifting ghost train. Every attribute is audio-bindable; `burst` ' +
  'swells the echo on a beat and `clear` flushes the tail.';

const BLEND_MODES = ['screen', 'add', 'over'];
const BLEND_OP = { add: 'lighter', screen: 'screen', over: 'source-over' };

// Cross-host audio-modulation marker (see feedback-filter.js for the full
// rationale). Harness reads `kind`; midi-daddy reads `sourceTypes` +
// `defaultAmount`; layer-core treats the object as opaque.
const audioMod = defaultAmount => ({
  kind: 'audio',
  sourceTypes: ['audio', 'oneshot', 'note', 'tempo'],
  defaultAmount
});

export const params = {
  // ── Echo ───────────────────────────────────────────────────────────────
  delay: {
    type: 'number',
    label: 'Delay',
    default: 200,
    min: 10,
    max: 500,
    step: 1,
    description:
      'Time between echo taps, in milliseconds. Each successive ghost is one ' +
      '`delay` further back. ~120–250ms reads as a tight rhythmic echo at ' +
      'common tempos; bind it to tempo for beat-locked repeats.',
    modulation: audioMod(60),
    paramGroup: 'echo',
    paramGroupLabel: 'Echo',
    paramGroupCollapsed: false
  },
  taps: {
    type: 'number',
    label: 'Taps',
    default: 3,
    min: 1,
    max: 4,
    step: 1,
    description:
      'How many echo ghosts to draw. Each tap k shows the frame from ' +
      '`delay·k` ago. Structural (reallocation-free, but not modulated).'
    // NOT audio-bindable: integer tap count; smooth modulation is meaningless.
  },
  echoLevel: {
    type: 'number',
    label: 'Echo Level',
    default: 0.7,
    min: 0,
    max: 1,
    step: 0.01,
    description:
      'Opacity of the first echo tap. 0 = no echo (passthrough); 1 = the ' +
      'first ghost is as strong as the live image. Later taps fall off by ' +
      '`falloff`.',
    modulation: audioMod(0.4),
    paramGroup: 'echo'
  },
  falloff: {
    type: 'number',
    label: 'Falloff',
    default: 0.6,
    min: 0,
    max: 1,
    step: 0.01,
    description:
      'Opacity ratio between successive taps. 0.6 = each ghost is 60% as ' +
      'bright as the one before it. Low = a single clear echo; high = a long ' +
      'even ghost train.',
    modulation: audioMod(0.3),
    paramGroup: 'echo'
  },

  // ── Drift ──────────────────────────────────────────────────────────────
  offsetX: {
    type: 'number',
    label: 'Drift X',
    default: 0,
    min: -0.1,
    max: 0.1,
    step: 0.002,
    description:
      'Per-tap horizontal drift (fraction of width). Each ghost is offset ' +
      'cumulatively, so the echoes march sideways across the frame.',
    modulation: audioMod(0.04),
    paramGroup: 'drift',
    paramGroupLabel: 'Drift',
    paramGroupCollapsed: false
  },
  offsetY: {
    type: 'number',
    label: 'Drift Y',
    default: 0,
    min: -0.1,
    max: 0.1,
    step: 0.002,
    description: 'Per-tap vertical drift (fraction of height). Ghosts march up or down.',
    modulation: audioMod(0.04),
    paramGroup: 'drift'
  },
  hueStep: {
    type: 'number',
    label: 'Hue Step',
    default: 0,
    min: -180,
    max: 180,
    step: 1,
    description:
      'Hue rotation added per tap, in degrees. Each ghost drifts further ' +
      'around the colour wheel — a rainbow echo trail. 0 = ghosts keep the ' +
      'source colour.',
    modulation: audioMod(40),
    paramGroup: 'drift'
  },

  // ── Output ─────────────────────────────────────────────────────────────
  blend: {
    type: 'enum',
    label: 'Blend',
    options: BLEND_MODES,
    default: 'screen',
    description:
      'How echoes composite over the source. screen = glowing, clamped ' +
      '(best default); add = pure additive (bright trails blow out); over = ' +
      'opaque ghosts painted under the source.',
    paramGroup: 'output',
    paramGroupLabel: 'Output',
    paramGroupCollapsed: false
  },
  detail: {
    type: 'number',
    label: 'Detail / memory',
    default: 0.5,
    min: 0.25,
    max: 1,
    step: 0.05,
    description:
      'Resolution the delay line stores frames at, as a fraction of the ' +
      'canvas. The memory lever: lower = softer ghosts but much less RAM ' +
      '(the ring holds ~120 frames). Reallocates the ring when changed.'
    // NOT audio-bindable: changing it reallocates the ring — must stay static.
  }
};

export const reactions = {
  burst: {
    label: 'Echo burst',
    description:
      'Swell the echo on a transient (~400ms decaying envelope): briefly ' +
      'lifts every tap toward full level so a cloud of ghosts blooms on the ' +
      'beat, then settles back to the baseline `echoLevel`.',
    args: {
      strength: {
        type: 'number',
        label: 'Strength',
        default: 1,
        min: 0,
        max: 1,
        step: 0.01,
        description: 'How hard the burst lifts the echo level at its peak.'
      }
    }
  },
  clear: {
    label: 'Clear tail',
    description:
      'Flush the delay line — wipes every stored frame so the echo tail ' +
      'vanishes instantly and rebuilds from live. Fire on a downbeat to ' +
      'snap the screen clean. A state-reset reaction (no decay envelope).',
    args: {}
  }
};

const BURST_MS = 400;
const BURST_BOOST = 0.6;     // how much a full burst adds to echoLevel at peak
const MAX_RING_MS = 2000;    // covers the deepest tap (taps_max · delay_max)
const RING_FPS = 60;         // ring is sized assuming up to 60 stored fps

// ── pure helpers (exported for unit tests) ──────────────────────────────
export function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}
export function blendToOp(mode) {
  return BLEND_OP[mode] || BLEND_OP.screen;
}

export default class EchoFilter {
  constructor(width, height, initialParams = {}) {
    this._w = Math.max(1, width | 0);
    this._h = Math.max(1, height | 0);

    // Resolved control state.
    this._delay = 200;
    this._taps = 3;
    this._echoLevel = 0.7;
    this._falloff = 0.6;
    this._offsetX = 0;
    this._offsetY = 0;
    this._hueStep = 0;
    this._op = BLEND_OP.screen;
    this._detail = 0.5;

    // Burst reaction envelope (decaying, like glitch/feedback).
    this._burstUntil = 0;
    this._burstStrength = 0;

    // Ring buffer of recent frames: { canvas, ctx, t }. Allocated lazily in
    // render() once we know we have a DOM; null in non-DOM (test) environments,
    // where the filter degrades to a passthrough.
    this._supported = typeof document !== 'undefined' && typeof document.createElement === 'function';
    this._ring = null;
    this._ringW = 0;
    this._ringH = 0;
    this._writeIdx = 0;

    this._applyParams(initialParams);
  }

  _applyParams(p) {
    if (!p) return;
    if (typeof p.delay === 'number' && Number.isFinite(p.delay)) this._delay = clamp(p.delay, 10, 500);
    if (typeof p.taps === 'number' && Number.isFinite(p.taps)) this._taps = clamp(Math.round(p.taps), 1, 4);
    if (typeof p.echoLevel === 'number' && Number.isFinite(p.echoLevel)) this._echoLevel = clamp(p.echoLevel, 0, 1);
    if (typeof p.falloff === 'number' && Number.isFinite(p.falloff)) this._falloff = clamp(p.falloff, 0, 1);
    if (typeof p.offsetX === 'number' && Number.isFinite(p.offsetX)) this._offsetX = clamp(p.offsetX, -0.1, 0.1);
    if (typeof p.offsetY === 'number' && Number.isFinite(p.offsetY)) this._offsetY = clamp(p.offsetY, -0.1, 0.1);
    if (typeof p.hueStep === 'number' && Number.isFinite(p.hueStep)) this._hueStep = clamp(p.hueStep, -180, 180);
    if (typeof p.blend === 'string' && p.blend in BLEND_OP) this._op = BLEND_OP[p.blend];
    if (typeof p.detail === 'number' && Number.isFinite(p.detail)) this._detail = clamp(p.detail, 0.25, 1);
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
    this._ring = null; // reallocated at next render against the new size
  }

  cleanup() {
    if (this._ring) {
      for (const slot of this._ring) {
        slot.canvas.width = slot.canvas.height = 0;
      }
    }
    this._ring = null;
  }

  // ── Contract: reactions ─────────────────────────────────────────────────
  react(key, args = {}) {
    if (key === 'burst') {
      const strength = typeof args.strength === 'number' ? clamp(args.strength, 0, 1) : 1;
      this._burstStrength = strength;
      this._burstUntil = (typeof performance !== 'undefined' ? performance.now() : 0) + BURST_MS;
      return;
    }
    if (key === 'clear') {
      this._flushRing();
      return;
    }
    throw new Error(`echo: unknown reaction '${key}'`);
  }

  _burstAmount() {
    const now = (typeof performance !== 'undefined' ? performance.now() : 0);
    if (now >= this._burstUntil) return 0;
    return this._burstStrength * ((this._burstUntil - now) / BURST_MS);
  }

  // ── Ring buffer ─────────────────────────────────────────────────────────
  _ensureRing() {
    const rw = Math.max(1, Math.round(this._w * this._detail));
    const rh = Math.max(1, Math.round(this._h * this._detail));
    if (this._ring && this._ringW === rw && this._ringH === rh) return;

    // Cap covers the deepest tap; +2 slack so the newest write never collides
    // with the oldest readable frame.
    const cap = Math.ceil((MAX_RING_MS / 1000) * RING_FPS) + 2;
    const ring = new Array(cap);
    for (let i = 0; i < cap; i++) {
      const canvas = document.createElement('canvas');
      canvas.width = rw;
      canvas.height = rh;
      ring[i] = { canvas, ctx: canvas.getContext('2d'), t: -Infinity };
    }
    this._ring = ring;
    this._ringW = rw;
    this._ringH = rh;
    this._writeIdx = 0;
  }

  _flushRing() {
    if (!this._ring) return;
    for (const slot of this._ring) {
      slot.ctx.clearRect(0, 0, this._ringW, this._ringH);
      slot.t = -Infinity;
    }
  }

  // Nearest stored frame to `targetT` among valid slots. Linear scan — the
  // ring is small (~120) and taps are few, so this stays trivial and keeps
  // the example readable. Returns the slot or null if the ring is empty.
  _lookup(targetT) {
    let best = null;
    let bestDiff = Infinity;
    for (const slot of this._ring) {
      if (slot.t === -Infinity) continue;
      const diff = Math.abs(slot.t - targetT);
      if (diff < bestDiff) {
        bestDiff = diff;
        best = slot;
      }
    }
    return best;
  }

  // ── Contract: render ─────────────────────────────────────────────────────
  render(sourceCanvas, ctx) {
    if (!this._supported) {
      if (ctx && typeof ctx.drawImage === 'function') {
        ctx.drawImage(sourceCanvas, 0, 0, this._w, this._h);
      }
      return;
    }

    this._ensureRing();
    const now = performance.now();

    // 1. Store the current frame (downscaled) into the write slot.
    const slot = this._ring[this._writeIdx];
    slot.ctx.clearRect(0, 0, this._ringW, this._ringH);
    slot.ctx.drawImage(sourceCanvas, 0, 0, this._ringW, this._ringH);
    slot.t = now;
    this._writeIdx = (this._writeIdx + 1) % this._ring.length;

    // 2. Live source.
    ctx.drawImage(sourceCanvas, 0, 0, this._w, this._h);

    // 3. Echo taps, oldest-decaying.
    const level = clamp(this._echoLevel + this._burstAmount() * BURST_BOOST, 0, 1);
    if (level <= 0.003) return;

    for (let k = 1; k <= this._taps; k++) {
      const opacity = level * Math.pow(this._falloff, k - 1);
      if (opacity <= 0.003) break; // remaining taps are dimmer still
      const tap = this._lookup(now - this._delay * k);
      if (!tap) continue;

      ctx.save();
      ctx.globalCompositeOperation = this._op;
      ctx.globalAlpha = opacity;
      if (this._hueStep) ctx.filter = `hue-rotate(${this._hueStep * k}deg)`;
      const dx = this._offsetX * k * this._w;
      const dy = this._offsetY * k * this._h;
      ctx.drawImage(tap.canvas, 0, 0, this._ringW, this._ringH, dx, dy, this._w, this._h);
      ctx.restore();
    }
  }
}
