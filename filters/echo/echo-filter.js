/**
 * Echo Filter — rhythmic frame-delay with delay-pedal controls
 *
 * The second temporal filter in this bundle, and the deliberate counterpart
 * to `feedback`. Where `feedback` keeps ONE accumulation buffer and decays it
 * exponentially (a smear that fades), `echo` keeps a RING BUFFER of the last
 * couple of seconds of frames and composites a handful of fixed-time taps —
 * the image literally repeats a beat later. Same "retain state across frames"
 * muscle, different temporal operator and data structure, and pure Canvas2D
 * (a delay-and-composite needs no per-pixel math, so no WebGL).
 *
 * The controls are modelled on a delay pedal:
 *   - Delay — `time`, `repeats` (taps), `level` (wet mix), `feedback` (how
 *     much each repeat persists), `direction` (forward / reverse playback)
 *   - Spread — fan the echoes across the screen into a receding canyon
 *   - Tone — make the repeats DIFFER from the source the way an analog delay
 *     darkens its echoes: each successive repeat is progressively blurred
 *     (spatial low-pass), desaturated, dimmed, and hue-shifted
 *   - Key — echo only part of the image (a brightness band or a colour) so the
 *     background gets no ghosts
 *
 * This filter is a clean MULTI-TAP delay (each repeat reads the original
 * source at a different delay), not a regenerative one — repeats-of-repeats
 * (true feedback) are the `feedback` filter's job. The Tone group fakes the
 * analog "each echo is more degraded" look without re-circulating.
 *
 * Pipeline (per frame):
 *   1. write the current frame into the ring (downscaled by `detail`, and
 *      colour/luma-KEYED if a key is active so only the kept range is stored),
 *      stamped with the current time; advance the write head (circular)
 *   2. draw the live source (unkeyed — only the echoes are masked)
 *   3. for repeat k = 1..repeats: find the stored frame at the tap's age
 *      (forward: `time·k`; reverse: a sweep across the window), composite it
 *      at `level · feedback^(k-1)`, fanned by `spread`, toned by the Tone group
 *
 * Lookups are TIME-indexed, so the timing is frame-rate independent. The ring
 * is bounded (~2s); `detail` trades stored-frame sharpness for memory (and is
 * also the per-pixel-key cost lever).
 */

export const key = 'echo';
export const label = 'Echo';
export const type = 'filter';
export const category = 'demos';
export const description =
  'Rhythmic frame-delay post-process with delay-pedal controls (time / ' +
  'repeats / level / feedback). The temporal counterpart to `feedback` (delay ' +
  'taps vs exponential decay; 2D ring buffer vs GPU accumulator). `spread` ' +
  'fans the echoes across the screen into a receding canyon; the Tone group ' +
  'blurs/desaturates/hue-shifts each repeat like an analog delay; `direction` ' +
  'plays the delay forward or reverse; the Key group echoes only a brightness ' +
  'band or colour so the background gets no ghosts. Every continuous ' +
  'attribute is audio-bindable; `burst` swells the echo and `clear` flushes it.';

const BLEND_MODES = ['screen', 'add', 'over'];
const BLEND_OP = { add: 'lighter', screen: 'screen', over: 'source-over' };
const DIRECTIONS = ['forward', 'reverse'];
const KEY_MODES = ['off', 'luma', 'color'];

// Cross-host audio-modulation marker (see feedback-filter.js for the full
// rationale). Harness reads `kind`; midi-daddy reads `sourceTypes` +
// `defaultAmount`; layer-core treats the object as opaque.
const audioMod = defaultAmount => ({
  kind: 'audio',
  // Include lfo + random so the platform's LFO and random-generator sources
  // can drive any attribute — e.g. an LFO or random source on `spreadAngle`
  // gives an auto-rotating / randomised canyon. Harness ignores sourceTypes
  // (it keys off `kind: 'audio'`); midi-daddy reads them to populate the
  // binding source list.
  sourceTypes: ['audio', 'oneshot', 'note', 'tempo', 'lfo', 'random'],
  defaultAmount
});

export const params = {
  // ── Delay ──────────────────────────────────────────────────────────────
  time: {
    type: 'number',
    label: 'Time',
    default: 200,
    min: 10,
    max: 1000,
    step: 1,
    description:
      'Delay time between repeats, in milliseconds (the pedal "Time" knob). ' +
      '~120–250ms reads as a tight rhythmic echo at common tempos; bind to ' +
      'tempo for beat-locked repeats.',
    modulation: audioMod(60),
    paramGroup: 'delay',
    paramGroupLabel: 'Delay',
    paramGroupCollapsed: false
  },
  repeats: {
    type: 'number',
    label: 'Repeats',
    default: 3,
    min: 1,
    max: 12,
    step: 1,
    description:
      'How many echo repeats (taps). Each repeat k shows the frame from ' +
      '`time·k` ago. Crank it with `spread` for a canyon of echoes fanned ' +
      'across the screen. Structural — not modulated.',
    paramGroup: 'delay'
    // NOT audio-bindable: integer count; smooth modulation is meaningless.
  },
  level: {
    type: 'number',
    label: 'Level',
    default: 0.7,
    min: 0,
    max: 1,
    step: 0.01,
    description:
      'Wet level — opacity of the first repeat (the pedal "Level"/"Mix" ' +
      'knob). 0 = dry (passthrough); 1 = the first echo is as strong as the ' +
      'live image. Later repeats fall off by `feedback`.',
    modulation: audioMod(0.4),
    paramGroup: 'delay'
  },
  feedback: {
    type: 'number',
    label: 'Feedback',
    default: 0.6,
    min: 0,
    max: 1,
    step: 0.01,
    description:
      'How much each repeat persists into the next — the pedal "Feedback" ' +
      'knob (opacity ratio between successive repeats). Low = one clear ' +
      'echo; high = a long even train of repeats.',
    modulation: audioMod(0.3),
    paramGroup: 'delay'
  },
  direction: {
    type: 'enum',
    label: 'Direction',
    options: DIRECTIONS,
    default: 'forward',
    description:
      'forward = repeats play normally (delayed copies of the motion); ' +
      'reverse = each delay window plays backward on a loop, so the echo ' +
      'rewinds — a reverse delay. Pairs especially well with `spread`.',
    paramGroup: 'delay'
  },

  // ── Spread ─────────────────────────────────────────────────────────────
  spread: {
    type: 'number',
    label: 'Spread',
    default: 0,
    min: 0,
    max: 1.5,
    step: 0.01,
    description:
      'How far the echoes fan out across the screen. 0 = all repeats stack in ' +
      'place (slapback); 1 = the furthest repeat reaches the frame edge, so ' +
      'the echoes fill the screen like a canyon. Direction set by `spreadAngle`.',
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
      'the axis of the canyon. Bind an LFO source to sweep it (rotating ' +
      'canyon) or a random source for a randomised angle each trigger.',
    modulation: audioMod(60),
    paramGroup: 'spread'
  },
  echoScale: {
    type: 'number',
    label: 'Echo Scale',
    default: 1,
    min: 0.3,
    max: 1.5,
    step: 0.005,
    description:
      'Per-repeat size multiplier (compounds: repeat k is `echoScale^k`). ' +
      '1 = full size; <1 shrinks each repeat so they recede into the distance ' +
      '(canyon perspective); >1 GROWS each repeat into a screen-filling bloom ' +
      '— compounding makes even 1.2 blow up fast. Pairs with `spread`.',
    modulation: audioMod(0.1),
    paramGroup: 'spread'
  },

  // ── Tone ───────────────────────────────────────────────────────────────
  echoBlur: {
    type: 'number',
    label: 'Blur / repeat',
    default: 0,
    min: 0,
    max: 30,
    step: 0.1,
    description:
      'Blur added per repeat, in pixels (cumulative: repeat k is blurred ' +
      '`echoBlur·k`). The analog-delay high-frequency loss — each echo ' +
      'softens as it ages.',
    modulation: audioMod(2),
    paramGroup: 'tone',
    paramGroupLabel: 'Tone',
    paramGroupCollapsed: false
  },
  echoDesat: {
    type: 'number',
    label: 'Desaturate / repeat',
    default: 0,
    min: 0,
    max: 1,
    step: 0.01,
    description:
      'Saturation lost per repeat (cumulative). Each echo drifts toward grey, ' +
      'so the repeats read as colour-faded ghosts distinct from the live image.',
    modulation: audioMod(0.3),
    paramGroup: 'tone'
  },
  echoDim: {
    type: 'number',
    label: 'Dim / repeat',
    default: 0,
    min: 0,
    max: 1,
    step: 0.01,
    description:
      'Brightness lost per repeat (cumulative) — darkens each successive ' +
      'echo on top of the opacity falloff, for a deeper analog fade.',
    modulation: audioMod(0.3),
    paramGroup: 'tone'
  },
  hueStep: {
    type: 'number',
    label: 'Hue / repeat',
    default: 0,
    min: -180,
    max: 180,
    step: 1,
    description:
      'Hue rotation added per repeat, in degrees. Each ghost drifts further ' +
      'around the colour wheel — a rainbow echo trail. 0 = repeats keep the ' +
      'source colour.',
    modulation: audioMod(40),
    paramGroup: 'tone'
  },

  // ── Key ────────────────────────────────────────────────────────────────
  key: {
    type: 'enum',
    label: 'Key',
    options: KEY_MODES,
    default: 'off',
    description:
      'Echo only part of the image so the background gets no ghosts. off = ' +
      'echo everything; luma = echo only a brightness band (raise `keyLow` to ' +
      'drop a dark background); color = echo only pixels near `keyColor`. ' +
      '`keyInvert` flips the selection. Costs a per-pixel pass at `detail` ' +
      'resolution when active.',
    paramGroup: 'key',
    paramGroupLabel: 'Key',
    paramGroupCollapsed: true
  },
  keyLow: {
    type: 'number',
    label: 'Key Low (luma)',
    default: 0.2,
    min: 0,
    max: 1,
    step: 0.01,
    description:
      'luma mode: lowest brightness that gets echoed. Raise it to stop ' +
      'echoing a dark background while keeping bright foreground ghosts.',
    modulation: audioMod(0.2),
    paramGroup: 'key'
  },
  keyHigh: {
    type: 'number',
    label: 'Key High (luma)',
    default: 1,
    min: 0,
    max: 1,
    step: 0.01,
    description:
      'luma mode: highest brightness that gets echoed. Lower it to stop ' +
      'echoing a blown-out / bright background.',
    modulation: audioMod(0.2),
    paramGroup: 'key'
  },
  keyColor: {
    type: 'color',
    label: 'Key Colour',
    default: '#00ff00',
    description: 'color mode: the colour to echo (or, with `keyInvert`, to drop).',
    paramGroup: 'key'
  },
  keyTolerance: {
    type: 'number',
    label: 'Key Tolerance',
    default: 0.25,
    min: 0,
    max: 1,
    step: 0.01,
    description:
      'color mode: how close to `keyColor` a pixel must be to be echoed. ' +
      'Small = only that exact colour; large = a broad swathe of related hues.',
    modulation: audioMod(0.2),
    paramGroup: 'key'
  },
  keyInvert: {
    type: 'boolean',
    label: 'Key Invert',
    default: false,
    description:
      'Echo the COMPLEMENT of the selection — everything EXCEPT the keyed ' +
      'range. Use to drop a known background colour while echoing all else.',
    paramGroup: 'key'
  },
  keySoftness: {
    type: 'number',
    label: 'Key Softness',
    default: 0.2,
    min: 0,
    max: 1,
    step: 0.01,
    description: 'Soft edge on the key so the echoed cutout is not jagged.',
    paramGroup: 'key'
  },

  // ── Output ─────────────────────────────────────────────────────────────
  blend: {
    type: 'enum',
    label: 'Blend',
    options: BLEND_MODES,
    default: 'screen',
    description:
      'How echoes composite over the source. screen = glowing, clamped ' +
      '(best default); add = pure additive, diverges from screen in ' +
      'bright/overlapping regions; over = opaque ghosts painted under the source.',
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
      '(the ring holds ~120 frames) and a cheaper key pass. Reallocates the ' +
      'ring when changed.',
    paramGroup: 'output'
    // NOT audio-bindable: changing it reallocates the ring — must stay static.
  }
};

export const reactions = {
  burst: {
    label: 'Echo burst',
    description:
      'Swell the echo on a transient (~400ms decaying envelope): briefly ' +
      'lifts every repeat toward full level so a cloud of ghosts blooms on ' +
      'the beat, then settles back to the baseline `level`.',
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
const BURST_BOOST = 0.6;     // how much a full burst adds to level at peak
const MAX_RING_MS = 2000;    // bounds ring memory; deeper echoes share the oldest frame
const RING_FPS = 60;         // ring is sized assuming up to 60 stored fps
const DEG2RAD = Math.PI / 180;
const RGB_MAX_DIST = Math.sqrt(3 * 255 * 255); // diagonal of the RGB cube

// ── pure helpers (exported for unit tests) ──────────────────────────────
export function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}
export function blendToOp(mode) {
  return BLEND_OP[mode] || BLEND_OP.screen;
}
export function smoothstep(e0, e1, x) {
  if (e0 === e1) return x < e0 ? 0 : 1;
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}
// Keep factor (0..1) for a luminance band [lo, hi] with a soft edge.
export function bandKeep(L, lo, hi, soft) {
  if (hi <= lo) return 0;
  const edge = soft * 0.5 * (hi - lo) + 1e-4;
  return smoothstep(lo - edge, lo + edge, L) * (1 - smoothstep(hi - edge, hi + edge, L));
}
// Keep factor (0..1) for proximity to a key colour, normalised tolerance.
export function colorKeep(r, g, b, kr, kg, kb, tol, soft) {
  const dr = r - kr, dg = g - kg, db = b - kb;
  const dist = Math.sqrt(dr * dr + dg * dg + db * db) / RGB_MAX_DIST;
  return 1 - smoothstep(tol * (1 - soft), tol + 1e-4, dist);
}
function parseHex(hex) {
  if (typeof hex !== 'string') return { r: 0, g: 255, b: 0 };
  const h = hex.replace('#', '');
  if (h.length < 6) return { r: 0, g: 255, b: 0 };
  return {
    r: parseInt(h.slice(0, 2), 16) || 0,
    g: parseInt(h.slice(2, 4), 16) || 0,
    b: parseInt(h.slice(4, 6), 16) || 0
  };
}

export default class EchoFilter {
  constructor(width, height, initialParams = {}) {
    this._w = Math.max(1, width | 0);
    this._h = Math.max(1, height | 0);

    // Resolved control state.
    this._time = 200;
    this._repeats = 3;
    this._level = 0.7;
    this._feedback = 0.6;
    this._direction = 'forward';
    this._spread = 0;
    this._spreadAngle = 0;
    this._echoScale = 1;
    this._echoBlur = 0;
    this._echoDesat = 0;
    this._echoDim = 0;
    this._hueStep = 0;
    this._key = 'off';
    this._keyLow = 0.2;
    this._keyHigh = 1;
    this._keyRGB = { r: 0, g: 255, b: 0 };
    this._keyTolerance = 0.25;
    this._keyInvert = false;
    this._keySoftness = 0.2;
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

    // Scratch canvas for the key pass (willReadFrequently — we getImageData it
    // every keyed frame). Kept off the ring slots so those stay GPU-friendly
    // as drawImage sources.
    this._keyScratch = null;
    this._keyScratchCtx = null;

    this._applyParams(initialParams);
  }

  _applyParams(p) {
    if (!p) return;
    if (typeof p.time === 'number' && Number.isFinite(p.time)) this._time = clamp(p.time, 10, 1000);
    if (typeof p.repeats === 'number' && Number.isFinite(p.repeats)) this._repeats = clamp(Math.round(p.repeats), 1, 12);
    if (typeof p.level === 'number' && Number.isFinite(p.level)) this._level = clamp(p.level, 0, 1);
    if (typeof p.feedback === 'number' && Number.isFinite(p.feedback)) this._feedback = clamp(p.feedback, 0, 1);
    if (typeof p.direction === 'string' && DIRECTIONS.includes(p.direction)) this._direction = p.direction;
    if (typeof p.spread === 'number' && Number.isFinite(p.spread)) this._spread = clamp(p.spread, 0, 1.5);
    if (typeof p.spreadAngle === 'number' && Number.isFinite(p.spreadAngle)) this._spreadAngle = clamp(p.spreadAngle, 0, 360);
    if (typeof p.echoScale === 'number' && Number.isFinite(p.echoScale)) this._echoScale = clamp(p.echoScale, 0.3, 1.5);
    if (typeof p.echoBlur === 'number' && Number.isFinite(p.echoBlur)) this._echoBlur = clamp(p.echoBlur, 0, 30);
    if (typeof p.echoDesat === 'number' && Number.isFinite(p.echoDesat)) this._echoDesat = clamp(p.echoDesat, 0, 1);
    if (typeof p.echoDim === 'number' && Number.isFinite(p.echoDim)) this._echoDim = clamp(p.echoDim, 0, 1);
    if (typeof p.hueStep === 'number' && Number.isFinite(p.hueStep)) this._hueStep = clamp(p.hueStep, -180, 180);
    if (typeof p.key === 'string' && KEY_MODES.includes(p.key)) this._key = p.key;
    if (typeof p.keyLow === 'number' && Number.isFinite(p.keyLow)) this._keyLow = clamp(p.keyLow, 0, 1);
    if (typeof p.keyHigh === 'number' && Number.isFinite(p.keyHigh)) this._keyHigh = clamp(p.keyHigh, 0, 1);
    if (typeof p.keyColor === 'string') this._keyRGB = parseHex(p.keyColor);
    if (typeof p.keyTolerance === 'number' && Number.isFinite(p.keyTolerance)) this._keyTolerance = clamp(p.keyTolerance, 0, 1);
    if (typeof p.keyInvert === 'boolean') this._keyInvert = p.keyInvert;
    if (typeof p.keySoftness === 'number' && Number.isFinite(p.keySoftness)) this._keySoftness = clamp(p.keySoftness, 0, 1);
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
    this._keyScratch = null;
    this._keyScratchCtx = null;
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
    this._keyScratch = null; // re-made at ring size on next keyed frame
  }

  _flushRing() {
    if (!this._ring) return;
    for (const slot of this._ring) {
      slot.ctx.clearRect(0, 0, this._ringW, this._ringH);
      slot.t = -Infinity;
    }
  }

  // Nearest stored frame to `targetT` among valid slots. Linear scan — the
  // ring is small (~120) and repeats are few, so this stays trivial and keeps
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

  // Age (ms back from now) the k-th repeat samples. Forward: a fixed `time·k`.
  // Reverse: a sawtooth sweep across the k-th delay window so the buffered
  // motion plays backward, re-triggering every `time` ms.
  _tapAge(k, now) {
    if (this._direction === 'reverse') {
      const phase = (now % this._time) / this._time; // 0..1, sweeps the window
      return this._time * (k - 1 + phase);
    }
    return this._time * k;
  }

  // Cumulative ctx.filter for the k-th repeat — the analog-delay "tone" that
  // makes each echo differ from the source (spatial blur + colour shaping).
  _tapFilter(k) {
    let f = '';
    if (this._echoBlur > 0) f += `blur(${(this._echoBlur * k).toFixed(2)}px) `;
    if (this._echoDesat > 0) f += `saturate(${Math.pow(1 - this._echoDesat, k).toFixed(3)}) `;
    if (this._echoDim > 0) f += `brightness(${Math.pow(1 - this._echoDim, k).toFixed(3)}) `;
    if (this._hueStep) f += `hue-rotate(${this._hueStep * k}deg)`;
    return f.trim();
  }

  // Write `sourceCanvas` into a ring slot, keyed if a key mode is active.
  _storeFrame(slot, sourceCanvas) {
    slot.ctx.clearRect(0, 0, this._ringW, this._ringH);
    if (this._key === 'off') {
      slot.ctx.drawImage(sourceCanvas, 0, 0, this._ringW, this._ringH);
      return;
    }
    // Key on a willReadFrequently scratch, then blit the masked result in.
    if (!this._keyScratch) {
      this._keyScratch = document.createElement('canvas');
      this._keyScratch.width = this._ringW;
      this._keyScratch.height = this._ringH;
      this._keyScratchCtx = this._keyScratch.getContext('2d', { willReadFrequently: true });
    }
    const sctx = this._keyScratchCtx;
    sctx.clearRect(0, 0, this._ringW, this._ringH);
    sctx.drawImage(sourceCanvas, 0, 0, this._ringW, this._ringH);
    this._applyKey(sctx, this._ringW, this._ringH);
    slot.ctx.drawImage(this._keyScratch, 0, 0);
  }

  // Knock the alpha of out-of-range pixels to zero so only the kept range is
  // stored (and therefore echoed). Runs at ring/detail resolution.
  _applyKey(sctx, w, h) {
    let img;
    try {
      img = sctx.getImageData(0, 0, w, h);
    } catch {
      return; // tainted source — skip keying, store as-is
    }
    const d = img.data;
    const soft = this._keySoftness;
    const inv = this._keyInvert;
    if (this._key === 'luma') {
      const lo = this._keyLow, hi = this._keyHigh;
      for (let i = 0; i < d.length; i += 4) {
        const L = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) / 255;
        let keep = bandKeep(L, lo, hi, soft);
        if (inv) keep = 1 - keep;
        d[i + 3] *= keep;
      }
    } else {
      const { r, g, b } = this._keyRGB;
      const tol = this._keyTolerance;
      for (let i = 0; i < d.length; i += 4) {
        let keep = colorKeep(d[i], d[i + 1], d[i + 2], r, g, b, tol, soft);
        if (inv) keep = 1 - keep;
        d[i + 3] *= keep;
      }
    }
    sctx.putImageData(img, 0, 0);
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

    // 1. Store the current frame (downscaled, keyed) into the write slot.
    const slot = this._ring[this._writeIdx];
    this._storeFrame(slot, sourceCanvas);
    slot.t = now;
    this._writeIdx = (this._writeIdx + 1) % this._ring.length;

    // 2. Live source (unkeyed — only the echoes are masked).
    ctx.drawImage(sourceCanvas, 0, 0, this._w, this._h);

    // 3. Echo repeats, oldest-decaying.
    const level = clamp(this._level + this._burstAmount() * BURST_BOOST, 0, 1);
    if (level <= 0.003) return;

    const a = this._spreadAngle * DEG2RAD;
    const dirX = Math.cos(a);
    const dirY = Math.sin(a);
    // Deepest readable age is bounded by the ring; beyond it, repeats share
    // the oldest stored frame (still placed at distinct spread positions).
    const maxAge = MAX_RING_MS - 1000 / RING_FPS;

    for (let k = 1; k <= this._repeats; k++) {
      const opacity = level * Math.pow(this._feedback, k - 1);
      if (opacity <= 0.003) break; // remaining repeats are dimmer still
      const tap = this._lookup(now - Math.min(this._tapAge(k, now), maxAge));
      if (!tap) continue;

      // Fan the echo out from centre along the spread axis (furthest repeat
      // reaches the frame edge at spread = 1); echoScale shrinks each
      // successive repeat for a receding-canyon perspective.
      const frac = this._repeats > 1 ? k / this._repeats : 0;
      const mag = this._spread * frac;
      const cx = this._w * (0.5 + dirX * mag * 0.5);
      const cy = this._h * (0.5 + dirY * mag * 0.5);
      const scale = Math.pow(this._echoScale, k);
      const dw = this._w * scale;
      const dh = this._h * scale;

      ctx.save();
      ctx.globalCompositeOperation = this._op;
      ctx.globalAlpha = opacity;
      const filter = this._tapFilter(k);
      if (filter) ctx.filter = filter;
      ctx.drawImage(tap.canvas, 0, 0, this._ringW, this._ringH, cx - dw / 2, cy - dh / 2, dw, dh);
      ctx.restore();
    }
  }
}
