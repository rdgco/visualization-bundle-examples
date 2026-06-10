/**
 * Long Exposure Filter — light-painting accumulator
 *
 * The fourth temporal filter in this bundle, completing the retained-buffer
 * quartet: feedback (decay), echo (delay), freeze (hold), and now long-exposure
 * (accumulate). Its operator is "remember the brightest" — each frame it
 * max-blends (`lighten`) the live source into a retained accumulation buffer,
 * so bright moving things etch streaks that DON'T fade. Think a camera shutter
 * left open: light paints permanent trails across the frame.
 *
 * Distinct from `feedback`, which decays an accumulator toward black (a smear
 * that fades). Long-exposure keeps the MAX seen so far and only fades on an
 * optional, slow `decayTime` — so trails persist for seconds (or forever) and
 * dark areas never darken what's already been painted.
 *
 * Pure Canvas2D — `globalCompositeOperation = 'lighten'` is the whole trick
 * (GPU-accelerated in Chromium), plus an optional black-fade for decay and a
 * hue-rotate for colour-cycling trails. One accumulation canvas, trivial memory.
 *
 * Pipeline (per frame):
 *   1. (seed / `clear`) — start the accumulation from the current frame
 *   2. decay — if `decayTime` > 0, fade the accumulation toward black so old
 *      trails have a finite lifetime (half-life = decayTime); 0 = infinite
 *   3. hue — if `hueDrift` != 0, rotate the accumulation's hue, so older trails
 *      drift further around the colour wheel than freshly-painted ones
 *   4. accumulate — `lighten` / `add` / `screen`-blend the live source in
 *      (boosted by `sourceGain` + the `pulse` reaction)
 *   5. output — crossfade live ↔ accumulation by `mix`
 *
 * Reactions: `clear` resets the exposure (the canonical start-a-fresh-frame
 * move for light-painting); `pulse` momentarily over-drives the source so a
 * beat etches brighter.
 *
 * Best loaded over moving content with bright highlights on dark fields —
 * video, particles, neon. Every continuous attribute is audio-bindable.
 */

export const key = 'long-exposure';
export const label = 'Long Exposure';
export const type = 'filter';
export const category = 'demos';
export const description =
  'Light-painting accumulator: max-blends the live frame into a retained ' +
  'buffer so bright moving things etch streaks that do not fade — a camera ' +
  'shutter left open. Completes the temporal quartet (feedback decay / echo ' +
  'delay / freeze hold / long-exposure accumulate). `decayTime` sets how long ' +
  'trails persist (0 = forever); `accumulate` picks the build-up blend; ' +
  '`hueDrift` cycles trail colour as it ages; `clear` resets the exposure and ' +
  '`pulse` over-drives a beat. Best over video / particles / neon.';

const ACCUMULATE_MODES = ['lighten', 'add', 'screen'];
const ACCUMULATE_OP = { lighten: 'lighten', add: 'lighter', screen: 'screen' };

// Cross-host audio-modulation marker (see other filters for the rationale).
// Includes lfo + random so the platform's generators can drive any attribute.
const audioMod = defaultAmount => ({
  kind: 'audio',
  sourceTypes: ['audio', 'oneshot', 'note', 'tempo', 'lfo', 'random'],
  defaultAmount
});

export const params = {
  // ── Exposure ───────────────────────────────────────────────────────────
  accumulate: {
    type: 'enum',
    label: 'Accumulate',
    options: ACCUMULATE_MODES,
    default: 'lighten',
    description:
      'How the live frame builds up in the buffer. lighten = keep the brightest ' +
      'per pixel (classic light-painting; dark areas never overwrite trails); ' +
      'add = additive (trails blow out toward white faster); screen = a softer ' +
      'additive build-up.',
    paramGroup: 'exposure',
    paramGroupLabel: 'Exposure',
    paramGroupCollapsed: false
  },
  decayTime: {
    type: 'number',
    label: 'Decay Time',
    default: 5,
    min: 0,
    max: 30,
    step: 0.1,
    description:
      'How long painted trails persist before fading, in seconds (half-life). ' +
      '0 = infinite exposure — trails never fade until you `clear`. For live ' +
      'video, a few seconds keeps it alive; longer = denser light-painting.',
    modulation: audioMod(2),
    paramGroup: 'exposure'
  },
  sourceGain: {
    type: 'number',
    label: 'Source Gain',
    default: 1,
    min: 0,
    max: 3,
    step: 0.01,
    description:
      'How hard the live frame etches into the buffer each frame. 1 = as-is; ' +
      '>1 over-drives (brighter, faster-building trails); 0 = stop painting ' +
      '(the buffer just decays).',
    modulation: audioMod(0.6),
    paramGroup: 'exposure'
  },
  mix: {
    type: 'number',
    label: 'Mix',
    default: 1,
    min: 0,
    max: 1,
    step: 0.01,
    description:
      'Output blend between the live frame (0) and the accumulated exposure ' +
      '(1). 1 = pure long-exposure; lower to bring the crisp live frame back ' +
      'through the trails.',
    modulation: audioMod(0.4),
    paramGroup: 'exposure'
  },

  // ── Colour ─────────────────────────────────────────────────────────────
  hueDrift: {
    type: 'number',
    label: 'Hue Drift',
    default: 0,
    min: -180,
    max: 180,
    step: 1,
    description:
      'Hue rotation of the accumulation, in degrees/second. Because it ' +
      'compounds over the retained buffer, older trails drift further around ' +
      'the colour wheel than fresh paint — a rainbow light-trail. 0 = trails ' +
      'keep the source colour.',
    modulation: audioMod(40),
    paramGroup: 'color',
    paramGroupLabel: 'Colour',
    paramGroupCollapsed: false
  }
};

export const reactions = {
  clear: {
    label: 'Clear exposure',
    description:
      'Wipe the accumulation and start a fresh exposure from the current ' +
      'frame. The canonical light-painting reset — fire it to begin a new ' +
      'trail. A state-reset reaction (no decay envelope).',
    args: {}
  },
  pulse: {
    label: 'Exposure pulse',
    description:
      'Over-drive the source on a transient (~400ms decaying envelope) so a ' +
      'beat etches a brighter burst into the exposure, then settles back to ' +
      'the baseline `sourceGain`.',
    args: {
      strength: {
        type: 'number',
        label: 'Strength',
        default: 1,
        min: 0,
        max: 1,
        step: 0.01,
        description: 'How hard the pulse boosts the source gain at its peak.'
      }
    }
  }
};

const PULSE_MS = 400;
const PULSE_GAIN_BOOST = 1.5; // extra source gain at the peak of a full pulse

// ── pure helpers (exported for unit tests) ──────────────────────────────
export function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}
export function accumulateToOp(mode) {
  return ACCUMULATE_OP[mode] || ACCUMULATE_OP.lighten;
}
// Fraction of the accumulation that survives a dt-second step, given a
// half-life `decayTime` (0 = no decay / infinite exposure).
export function retainFactor(decayTime, dt) {
  if (decayTime <= 0) return 1;
  return Math.pow(0.5, dt / decayTime);
}

export default class LongExposureFilter {
  constructor(width, height, initialParams = {}) {
    this._w = Math.max(1, width | 0);
    this._h = Math.max(1, height | 0);

    // Resolved control state.
    this._accOp = ACCUMULATE_OP.lighten;
    this._decayTime = 5;
    this._sourceGain = 1;
    this._mix = 1;
    this._hueDrift = 0;

    // Pulse reaction envelope (decaying, like glitch/feedback).
    this._pulseUntil = 0;
    this._pulseStrength = 0;

    this._clearRequested = false;
    this._lastT = (typeof performance !== 'undefined' ? performance.now() : 0);

    // Retained accumulation buffer + an optional hue-rotate scratch.
    this._supported = typeof document !== 'undefined' && typeof document.createElement === 'function';
    this._accum = null;
    this._accumCtx = null;
    this._hasAccum = false;
    this._hueScratch = null;
    this._hueScratchCtx = null;

    this._applyParams(initialParams);
  }

  _applyParams(p) {
    if (!p) return;
    if (typeof p.accumulate === 'string' && p.accumulate in ACCUMULATE_OP) this._accOp = ACCUMULATE_OP[p.accumulate];
    if (typeof p.decayTime === 'number' && Number.isFinite(p.decayTime)) this._decayTime = clamp(p.decayTime, 0, 30);
    if (typeof p.sourceGain === 'number' && Number.isFinite(p.sourceGain)) this._sourceGain = clamp(p.sourceGain, 0, 3);
    if (typeof p.mix === 'number' && Number.isFinite(p.mix)) this._mix = clamp(p.mix, 0, 1);
    if (typeof p.hueDrift === 'number' && Number.isFinite(p.hueDrift)) this._hueDrift = clamp(p.hueDrift, -180, 180);
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
    this._accum = null;       // reallocated + reseeded at next render
    this._hueScratch = null;
    this._hasAccum = false;
  }

  cleanup() {
    if (this._accum) this._accum.width = this._accum.height = 0;
    if (this._hueScratch) this._hueScratch.width = this._hueScratch.height = 0;
    this._accum = null;
    this._accumCtx = null;
    this._hueScratch = null;
    this._hueScratchCtx = null;
  }

  // ── Contract: reactions ─────────────────────────────────────────────────
  react(key, args = {}) {
    if (key === 'clear') {
      this._clearRequested = true;
      return;
    }
    if (key === 'pulse') {
      const strength = typeof args.strength === 'number' ? clamp(args.strength, 0, 1) : 1;
      this._pulseStrength = strength;
      this._pulseUntil = (typeof performance !== 'undefined' ? performance.now() : 0) + PULSE_MS;
      return;
    }
    throw new Error(`long-exposure: unknown reaction '${key}'`);
  }

  _pulseAmount() {
    const now = (typeof performance !== 'undefined' ? performance.now() : 0);
    if (now >= this._pulseUntil) return 0;
    return this._pulseStrength * ((this._pulseUntil - now) / PULSE_MS);
  }

  _ensureAccum() {
    if (this._accum && this._accum.width === this._w && this._accum.height === this._h) return;
    this._accum = document.createElement('canvas');
    this._accum.width = this._w;
    this._accum.height = this._h;
    this._accumCtx = this._accum.getContext('2d');
    this._hasAccum = false;
  }

  _ensureHueScratch() {
    if (this._hueScratch && this._hueScratch.width === this._w && this._hueScratch.height === this._h) return;
    this._hueScratch = document.createElement('canvas');
    this._hueScratch.width = this._w;
    this._hueScratch.height = this._h;
    this._hueScratchCtx = this._hueScratch.getContext('2d');
  }

  // ── Contract: render ─────────────────────────────────────────────────────
  render(sourceCanvas, ctx) {
    if (!this._supported) {
      if (ctx && typeof ctx.drawImage === 'function') {
        ctx.drawImage(sourceCanvas, 0, 0, this._w, this._h);
      }
      return;
    }

    this._ensureAccum();
    const w = this._w;
    const h = this._h;
    const acc = this._accumCtx;

    const now = performance.now();
    let dt = (now - this._lastT) / 1000;
    if (!Number.isFinite(dt) || dt <= 0) dt = 1 / 60;
    if (dt > 0.25) dt = 0.25; // clamp long stalls so a tab-return doesn't nuke the trail
    this._lastT = now;

    // 1. Seed / clear — start the exposure from the current frame.
    if (this._clearRequested || !this._hasAccum) {
      acc.save();
      acc.globalCompositeOperation = 'copy';
      acc.globalAlpha = 1;
      acc.filter = 'none';
      acc.drawImage(sourceCanvas, 0, 0, w, h);
      acc.restore();
      this._clearRequested = false;
      this._hasAccum = true;
    } else {
      // 2. Decay — fade the accumulation toward black so trails have a lifetime.
      const retain = retainFactor(this._decayTime, dt);
      if (retain < 1) {
        acc.save();
        acc.globalCompositeOperation = 'source-over';
        acc.globalAlpha = 1 - retain;
        acc.fillStyle = '#000000';
        acc.fillRect(0, 0, w, h);
        acc.restore();
      }

      // 3. Hue drift — rotate the whole accumulation, so older paint (present
      //    over more frames) drifts further around the wheel than fresh paint.
      if (this._hueDrift !== 0) {
        this._ensureHueScratch();
        const deg = this._hueDrift * dt;
        const sctx = this._hueScratchCtx;
        sctx.save();
        sctx.globalCompositeOperation = 'copy';
        sctx.filter = `hue-rotate(${deg}deg)`;
        sctx.drawImage(this._accum, 0, 0, w, h);
        sctx.restore();
        acc.save();
        acc.globalCompositeOperation = 'copy';
        acc.filter = 'none';
        acc.drawImage(this._hueScratch, 0, 0, w, h);
        acc.restore();
      }

      // 4. Accumulate — blend the live frame in (lighten / add / screen),
      //    over-driven by sourceGain + any active pulse.
      const gain = clamp(this._sourceGain + this._pulseAmount() * PULSE_GAIN_BOOST, 0, 4);
      if (gain > 0) {
        acc.save();
        acc.globalCompositeOperation = this._accOp;
        acc.filter = gain !== 1 ? `brightness(${gain.toFixed(3)})` : 'none';
        acc.drawImage(sourceCanvas, 0, 0, w, h);
        acc.restore();
      }
    }

    // 5. Output — crossfade live ↔ accumulation by mix (mix 1 = pure exposure).
    ctx.save();
    ctx.globalCompositeOperation = 'copy';
    ctx.drawImage(this._accum, 0, 0, w, h);
    ctx.restore();
    if (this._mix < 1) {
      ctx.save();
      ctx.globalAlpha = 1 - this._mix;
      ctx.drawImage(sourceCanvas, 0, 0, w, h);
      ctx.restore();
    }
  }
}
