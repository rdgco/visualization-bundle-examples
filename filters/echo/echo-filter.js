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
 *   - `delay` / `echoCount` / `echoLevel` / `falloff` — the echo itself
 *   - `spread` / `spreadAngle` / `echoScale` / `hueStep` — fan the echoes out
 *     across the screen (the canyon), recede them, and drift their colour
 *   - `blend` / `detail` — compositing & the memory/quality lever
 *   - `burst` reaction — transient swell of the echo on a beat
 *   - `clear` reaction — flush the delay line (kill the tail instantly)
 *
 * Every numeric attribute except the two structural ones (`echoCount`,
 * `detail`, which set the echo count / reallocate the ring) is audio-bindable;
 * the filter stays audio-blind and the host pushes resolved values via
 * `setModulatedValues()`.
 */

export const key = 'echo';
export const label = 'Echo';
export const type = 'filter';
export const category = 'demos';
export const description =
  'Rhythmic frame-delay post-process: keeps a ring buffer of recent frames ' +
  'and composites fixed-delay ghost taps, so the image repeats a beat later. ' +
  'The temporal counterpart to `feedback` (delay taps vs exponential decay; ' +
  '2D ring buffer vs GPU accumulator). `spread` fans the echoes across the ' +
  'screen into a receding canyon; per-echo hue makes a rainbow ghost train. ' +
  'Every attribute is audio-bindable; `burst` swells the echo on a beat and ' +
  '`clear` flushes the tail.';

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
  echoCount: {
    type: 'number',
    label: 'Echo Count',
    default: 3,
    min: 1,
    max: 8,
    step: 1,
    description:
      'How many echo ghosts to draw. Each echo k shows the frame from ' +
      '`delay·k` ago. Crank it up with `spread` for a canyon of echoes ' +
      'fanned across the screen. Structural — not modulated.',
    paramGroup: 'echo'
    // NOT audio-bindable: integer count; smooth modulation is meaningless.
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

  // ── Spread ─────────────────────────────────────────────────────────────
  spread: {
    type: 'number',
    label: 'Spread',
    default: 0,
    min: 0,
    max: 1,
    step: 0.01,
    description:
      'How far the echoes fan out across the screen. 0 = all echoes stack in ' +
      'place (slapback); 1 = the furthest echo reaches the frame edge, so the ' +
      'echoes fill the screen like a canyon. Direction set by `spreadAngle`.',
    modulation: audioMod(0.4),
    paramGroup: 'spread',
    paramGroupLabel: 'Spread',
    paramGroupCollapsed: false
  },
  spreadAngle: {
    type: 'number',
    label: 'Spread Angle',
    default: 0,
    min: 0,
    max: 360,
    step: 1,
    description:
      'Direction the echoes fan out, in degrees (0 = right, 90 = down). Sets ' +
      'the axis of the canyon.',
    modulation: audioMod(60),
    paramGroup: 'spread'
  },
  echoScale: {
    type: 'number',
    label: 'Echo Scale',
    default: 1,
    min: 0.6,
    max: 1,
    step: 0.005,
    description:
      'Per-echo size multiplier. 1 = every echo full size; <1 shrinks each ' +
      'successive echo so they recede into the distance — the canyon ' +
      'perspective. Pairs with `spread`.',
    modulation: audioMod(0.1),
    paramGroup: 'spread'
  },
  hueStep: {
    type: 'number',
    label: 'Hue Step',
    default: 0,
    min: -180,
    max: 180,
    step: 1,
    description:
      'Hue rotation added per echo, in degrees. Each ghost drifts further ' +
      'around the colour wheel — a rainbow echo trail. 0 = ghosts keep the ' +
      'source colour.',
    modulation: audioMod(40),
    paramGroup: 'spread'
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
      '(the ring holds ~120 frames). Reallocates the ring when changed.',
    paramGroup: 'output'
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
const MAX_RING_MS = 2000;    // bounds ring memory; deeper echoes share the oldest frame
const RING_FPS = 60;         // ring is sized assuming up to 60 stored fps
const DEG2RAD = Math.PI / 180;

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
    this._echoCount = 3;
    this._echoLevel = 0.7;
    this._falloff = 0.6;
    this._spread = 0;
    this._spreadAngle = 0;
    this._echoScale = 1;
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
    if (typeof p.echoCount === 'number' && Number.isFinite(p.echoCount)) this._echoCount = clamp(Math.round(p.echoCount), 1, 8);
    if (typeof p.echoLevel === 'number' && Number.isFinite(p.echoLevel)) this._echoLevel = clamp(p.echoLevel, 0, 1);
    if (typeof p.falloff === 'number' && Number.isFinite(p.falloff)) this._falloff = clamp(p.falloff, 0, 1);
    if (typeof p.spread === 'number' && Number.isFinite(p.spread)) this._spread = clamp(p.spread, 0, 1);
    if (typeof p.spreadAngle === 'number' && Number.isFinite(p.spreadAngle)) this._spreadAngle = clamp(p.spreadAngle, 0, 360);
    if (typeof p.echoScale === 'number' && Number.isFinite(p.echoScale)) this._echoScale = clamp(p.echoScale, 0.6, 1);
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

    const a = this._spreadAngle * DEG2RAD;
    const dirX = Math.cos(a);
    const dirY = Math.sin(a);
    // Deepest readable age is bounded by the ring; beyond it, taps share the
    // oldest stored frame (still placed at distinct spread positions).
    const maxAge = MAX_RING_MS - 1000 / RING_FPS;

    for (let k = 1; k <= this._echoCount; k++) {
      const opacity = level * Math.pow(this._falloff, k - 1);
      if (opacity <= 0.003) break; // remaining echoes are dimmer still
      const tap = this._lookup(now - Math.min(this._delay * k, maxAge));
      if (!tap) continue;

      // Fan the echo out from centre along the spread axis (furthest echo
      // reaches the frame edge at spread = 1); echoScale shrinks each
      // successive echo for a receding-canyon perspective.
      const frac = this._echoCount > 1 ? k / this._echoCount : 0;
      const mag = this._spread * frac;
      const cx = this._w * (0.5 + dirX * mag * 0.5);
      const cy = this._h * (0.5 + dirY * mag * 0.5);
      const scale = Math.pow(this._echoScale, k);
      const dw = this._w * scale;
      const dh = this._h * scale;

      ctx.save();
      ctx.globalCompositeOperation = this._op;
      ctx.globalAlpha = opacity;
      if (this._hueStep) ctx.filter = `hue-rotate(${this._hueStep * k}deg)`;
      ctx.drawImage(tap.canvas, 0, 0, this._ringW, this._ringH, cx - dw / 2, cy - dh / 2, dw, dh);
      ctx.restore();
    }
  }
}
