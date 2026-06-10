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
 *     `wet`) until `release`. The performance / freeze-on-a-hit mode.
 *   - stutter — auto: re-grab every `holdTime` ms and hold, so motion judders
 *     forward in chunks. Bind `holdTime` to tempo for beat-synced stutter.
 *
 * `dry` (live) and `wet` (frozen) are tuned independently, so you can crossfade
 * the original against the freeze any way you like. After each capture the
 * frozen frame fades away per `fade` (off / smooth / flicker / dissolve) over
 * `fadeTime` — fading or flickering into an ethereal absence. (Manual mode
 * fades over the full fadeTime; stutter caps it to the hold window.)
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
  'beat-synced judder. Independent `dry`/`wet` opacities crossfade live against ' +
  'the freeze, and `fade` (smooth / flicker / dissolve) lets the frozen frame ' +
  'fade away over `fadeTime` after freezing. Introduces the capture/grab reaction shape.';

const MODES = ['manual', 'stutter'];
const FADE_MODES = ['off', 'smooth', 'flicker', 'dissolve'];
const MAX_DISSOLVE_BLUR = 24; // px the dissolve fade blurs to as it leaves

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
      'judders forward; bind holdTime to tempo).',
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
      'stutter: how long each captured frame is held before re-grabbing, in ' +
      'milliseconds. Short = fast judder; long = slow chunky freeze. Bind to ' +
      'tempo for beat-locked stutter.',
    modulation: audioMod(80),
    paramGroup: 'freeze'
  },
  dry: {
    type: 'number',
    label: 'Dry (live)',
    default: 1,
    min: 0,
    max: 1,
    step: 0.01,
    description:
      'Opacity of the live / original image — always active, in every mode and ' +
      'whether or not anything is frozen. Fade it down to dissolve the live ' +
      'picture (toward the background) while the frozen `wet` layer holds. The ' +
      'reliable audio target: bind a level here and the original breathes with ' +
      'the music regardless of mode.',
    modulation: audioMod(0.4),
    paramGroup: 'freeze'
  },
  wet: {
    type: 'number',
    label: 'Wet (frozen)',
    default: 1,
    min: 0,
    max: 1,
    step: 0.01,
    description:
      'Opacity of the frozen frame where it shows. 1 = fully frozen over live; ' +
      '<1 = a ghost of the freeze. Tuned independently of `dry`, so you can ' +
      'crossfade live and frozen any way you like.',
    modulation: audioMod(0.4),
    paramGroup: 'freeze'
  },

  // ── Fade (how the frozen frame leaves after a freeze) ───────────────────
  fade: {
    type: 'enum',
    label: 'Fade',
    options: FADE_MODES,
    default: 'smooth',
    description:
      'How the frozen frame fades away after each freeze. off = stays put (a ' +
      'hard freeze); smooth = fades to absence over `fadeTime`; flicker = ' +
      'blinks out, increasingly off as it goes; dissolve = blurs and fades ' +
      'into an ethereal cloud. In manual mode the fade runs over the full ' +
      '`fadeTime` after you capture; in stutter it is capped to the hold ' +
      'window so every held frame fully fades before the next grab.',
    paramGroup: 'fade',
    paramGroupLabel: 'Fade',
    paramGroupCollapsed: false
  },
  fadeTime: {
    type: 'number',
    label: 'Fade Time',
    default: 1000,
    min: 50,
    max: 5000,
    step: 10,
    description:
      'How long the frozen frame takes to fade away after a freeze, in ' +
      'milliseconds (ignored when fade = off). In manual mode this is the full ' +
      'fade duration; in stutter it is capped to `holdTime` so the fade ' +
      'always completes within each window.',
    modulation: audioMod(400),
    paramGroup: 'fade'
  },
  flickerRate: {
    type: 'number',
    label: 'Flicker Rate',
    default: 12,
    min: 1,
    max: 30,
    step: 0.5,
    description:
      'flicker fade: how fast the frozen frame blinks (Hz) as it goes. Higher ' +
      '= a faster strobe-out.',
    modulation: audioMod(6),
    paramGroup: 'fade'
  }
};

export const reactions = {
  capture: {
    label: 'Capture',
    description:
      'Grab the current frame and hold it. In manual mode this freezes the ' +
      'screen until `release`; in stutter it re-syncs the window to now ' +
      '(re-grab on the beat). The snapshot-grab reaction.',
    args: {}
  },
  release: {
    label: 'Release',
    description:
      'Resume live in manual mode (unfreeze). No-op in stutter, which keeps ' +
      're-grabbing. State-reset shape, paired with `capture`.',
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
    this._dry = 1;
    this._wet = 1;
    this._fade = 'smooth';
    this._fadeTime = 1000;
    this._flickerRate = 12;

    // Flicker-fade gate.
    this._flickerOn = true;
    this._flickerNext = -Infinity;

    // Hold state.
    this._frozen = false;        // manual mode: showing the held frame?
    this._captureRequested = false;
    this._holdStart = -Infinity; // wall-clock of the current window's grab
    this._hasHeld = false;       // a frame has been captured at least once

    this._supported = typeof document !== 'undefined' && typeof document.createElement === 'function';
    this._held = null;
    this._heldCtx = null;

    this._applyParams(initialParams);
  }

  _applyParams(p) {
    if (!p) return;
    if (typeof p.mode === 'string' && MODES.includes(p.mode)) this._mode = p.mode;
    if (typeof p.holdTime === 'number' && Number.isFinite(p.holdTime)) this._holdTime = clamp(p.holdTime, 20, 2000);
    if (typeof p.dry === 'number' && Number.isFinite(p.dry)) this._dry = clamp(p.dry, 0, 1);
    if (typeof p.wet === 'number' && Number.isFinite(p.wet)) this._wet = clamp(p.wet, 0, 1);
    if (typeof p.fade === 'string' && FADE_MODES.includes(p.fade)) this._fade = p.fade;
    if (typeof p.fadeTime === 'number' && Number.isFinite(p.fadeTime)) this._fadeTime = clamp(p.fadeTime, 50, 5000);
    if (typeof p.flickerRate === 'number' && Number.isFinite(p.flickerRate)) this._flickerRate = clamp(p.flickerRate, 1, 30);
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
    if (this._mode !== 'stutter') return false;
    return now - this._holdStart >= this._holdTime;
  }

  // Fade progress 0..1 since the last capture (0 = just grabbed / fade off,
  // 1 = fully departed). Manual mode fades over the full `fadeTime`; stutter
  // caps the fade to the hold window so it always completes before the next
  // grab (otherwise the re-grab masks it — the long-fadeTime-in-stutter trap).
  _fadeProgress(elapsed) {
    if (this._fade === 'off' || this._fadeTime <= 0) return 0;
    const dur = this._mode === 'stutter' ? Math.min(this._fadeTime, this._holdTime) : this._fadeTime;
    if (dur <= 0) return 0;
    return clamp(elapsed / dur, 0, 1);
  }

  _ensureHeld() {
    if (this._held && this._held.width === this._w && this._held.height === this._h) return;
    this._held = document.createElement('canvas');
    this._held.width = this._w;
    this._held.height = this._h;
    this._heldCtx = this._held.getContext('2d');
    this._hasHeld = false;
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
      this._flickerOn = true; // fresh capture starts visible
    }

    // Live (dry) base — 'copy' so `dry` actually attenuates the original
    // (the vignette filter's idiom); dry = 1 is identity.
    ctx.save();
    ctx.globalCompositeOperation = 'copy';
    ctx.globalAlpha = this._dry;
    ctx.drawImage(sourceCanvas, 0, 0, this._w, this._h);
    ctx.restore();

    // Overlay the held (wet) frame where the mode calls for it, attenuated by
    // the fade envelope so the freeze can fade / flicker / dissolve away.
    const showHeld = this._mode === 'manual' ? this._frozen : true;
    if (!showHeld || !this._hasHeld) return;

    const p = this._fadeProgress(now - this._holdStart);
    let factor = 1;
    if (this._fade === 'smooth' || this._fade === 'dissolve') {
      factor = 1 - p;
    } else if (this._fade === 'flicker') {
      // Re-roll the gate at flickerRate; on-probability falls to 0 as it leaves.
      if (now >= this._flickerNext) {
        this._flickerOn = Math.random() < (1 - p);
        this._flickerNext = now + 1000 / this._flickerRate;
      }
      factor = this._flickerOn ? 1 : 0;
    }
    const effWet = this._wet * factor;
    if (effWet <= 0.003) return;

    ctx.save();
    ctx.globalAlpha = effWet;
    if (this._fade === 'dissolve' && p > 0) {
      ctx.filter = `blur(${(p * MAX_DISSOLVE_BLUR).toFixed(2)}px)`;
    }
    ctx.drawImage(this._held, 0, 0, this._w, this._h);
    ctx.restore();
  }
}
