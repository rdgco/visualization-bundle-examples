/**
 * duotone — gradient-map post-process. Reduces the source to luminance and
 * remaps it through a 2- or 3-stop colour gradient: shadows → `colorLow`,
 * highlights → `colorHigh` (with an optional `colorMid` at the centre).
 * Recolours any layer into a brand palette; reads especially well on lit
 * white projector screens.
 *
 * Pipeline per frame (all Canvas2D):
 *   1. Draw the source into a full-res work canvas and read it back.
 *   2. Per pixel: compute Rec. 601 luminance, map it to a LUT index
 *      (stretched by `contrast`, biased by `offset`), look up the gradient
 *      colour, and blend it over the original by `mix`. Alpha is preserved.
 *   3. putImageData the result to the output.
 *
 * The 256-entry colour LUT is rebuilt only when a colour/stop param changes
 * (tracked by `lutKey`); `offset`/`contrast`/`mix` are applied at sample
 * time, so dragging them never rebuilds the table. The expensive part is
 * the full-res `getImageData` + per-pixel loop — a cheap point-op (no
 * neighbourhood), but still per-pixel JS at FULL resolution, so it scales
 * with canvas area (the heaviest CPU filter alongside frame-diff).
 *
 * The pure math (luminance, hex parsing, LUT build, index mapping, config
 * normalization) lives in `lib/gradient-lut.js` and is unit-tested; this
 * file owns the canvas work and the param plumbing.
 */

import {
  DEFAULT_CONFIG,
  OFFSET_MIN,
  OFFSET_MAX,
  CONTRAST_MIN,
  CONTRAST_MAX,
  normalizeConfig,
  buildLut,
  lutKey,
  luma,
  mapIndex
} from './lib/gradient-lut.js';

export const key = 'duotone';
export const label = 'Duotone';
export const type = 'filter';
export const category = 'stylize';
export const description =
  'Gradient-map the source: reduce to luminance and remap shadows → ' +
  'highlights through a 2- or 3-stop colour gradient. Recolours any layer ' +
  'into a brand palette; bind the gradient offset to audio to scroll the ' +
  'palette through the image on the beat.';

// Cross-host audio-modulation marker. Harness reads `kind: 'audio'`; midi-daddy
// reads `sourceTypes` + `defaultAmount`; lfo/random let the platform's
// generators drive the param. Each host ignores the other's keys.
const audioMod = defaultAmount => ({
  kind: 'audio',
  sourceTypes: ['audio', 'oneshot', 'note', 'tempo', 'lfo', 'random'],
  defaultAmount
});

export const params = {
  colorLow: {
    type: 'color',
    label: 'Shadows colour',
    default: DEFAULT_CONFIG.colorLow,
    description: 'Colour the darkest parts of the source map to (luminance 0).'
  },
  colorHigh: {
    type: 'color',
    label: 'Highlights colour',
    default: DEFAULT_CONFIG.colorHigh,
    description: 'Colour the brightest parts of the source map to (luminance 255).'
  },
  useMidpoint: {
    type: 'boolean',
    label: '3-stop (use mid colour)',
    default: DEFAULT_CONFIG.useMidpoint,
    description: 'When on, inserts the mid colour at the centre of the gradient for a three-tone map.'
  },
  colorMid: {
    type: 'color',
    label: 'Midtones colour',
    default: DEFAULT_CONFIG.colorMid,
    description: 'Centre stop of the gradient. Only used when 3-stop is on.'
  },
  offset: {
    type: 'number',
    label: 'Palette offset',
    default: DEFAULT_CONFIG.offset,
    min: OFFSET_MIN, max: OFFSET_MAX, step: 0.01,
    description:
      'Shifts the luminance → palette mapping. ±1 sweeps the whole image to ' +
      'one end of the gradient; bind to bass to scroll the palette on the beat.',
    modulation: audioMod(0.4)
  },
  contrast: {
    type: 'number',
    label: 'Contrast',
    default: DEFAULT_CONFIG.contrast,
    min: CONTRAST_MIN, max: CONTRAST_MAX, step: 0.05,
    description:
      'Stretches luminance around mid-grey before the map. 1 = unchanged; ' +
      'higher pushes shadows/highlights apart for a punchier split.',
    modulation: audioMod(0.5)
  },
  mix: {
    type: 'number',
    label: 'Mix (wet / dry)',
    default: DEFAULT_CONFIG.mix,
    min: 0, max: 1, step: 0.01,
    description: 'Blend of the duotone over the original. 1 = full duotone, 0 = untouched source.',
    modulation: audioMod(0.3)
  }
};

export default class DuotoneFilter {
  constructor(width, height, initialParams = {}) {
    this._w = Math.max(1, width | 0);
    this._h = Math.max(1, height | 0);
    this._config = normalizeConfig(initialParams, DEFAULT_CONFIG);

    // Full-res work canvas for source readback; resized lazily in render().
    // Guarded so the filter constructs headless (degrades to a passthrough)
    // like every other filter in the bundle.
    this._supported = typeof document !== 'undefined' && typeof document.createElement === 'function';
    this._work = null;
    this._wctx = null;
    if (this._supported) {
      this._work = document.createElement('canvas');
      this._wctx = this._work.getContext('2d', { willReadFrequently: true });
    }
    this._ww = 0;
    this._wh = 0;

    // The colour LUT + the key it was built from, so we only rebuild on a
    // colour/stop change.
    this._lut = buildLut(this._config);
    this._lutKey = lutKey(this._config);
  }

  // ── Contract: live-update + lifecycle ──────────────────────────────
  _applyParams(p) {
    const next = normalizeConfig(p, this._config);
    const nextKey = lutKey(next);
    if (nextKey !== this._lutKey) {
      this._lut = buildLut(next);
      this._lutKey = nextKey;
    }
    this._config = next;
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
    this._lut = null;
    if (this._work) this._work.width = this._work.height = 0;
  }

  // ── Contract: render ───────────────────────────────────────────────
  render(sourceCanvas, ctx) {
    if (!this._supported) {
      if (ctx && typeof ctx.drawImage === 'function') ctx.drawImage(sourceCanvas, 0, 0, this._w, this._h);
      return;
    }
    const { _w: w, _h: h } = this;
    const cfg = this._config;

    if (w !== this._ww || h !== this._wh) {
      this._ww = this._work.width = w;
      this._wh = this._work.height = h;
    }

    this._wctx.drawImage(sourceCanvas, 0, 0, w, h);
    let img;
    try {
      img = this._wctx.getImageData(0, 0, w, h);
    } catch {
      // Tainted/zero-size source — pass the original through unchanged so
      // the frame is still valid.
      ctx.drawImage(sourceCanvas, 0, 0, w, h);
      return;
    }

    const d = img.data;
    const lut = this._lut;
    const { offset, contrast, mix } = cfg;
    const wet = mix >= 1;
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i], g = d[i + 1], b = d[i + 2];
      const idx = mapIndex(luma(r, g, b), offset, contrast) * 3;
      let nr = lut[idx], ng = lut[idx + 1], nb = lut[idx + 2];
      if (!wet) {
        nr = r + (nr - r) * mix;
        ng = g + (ng - g) * mix;
        nb = b + (nb - b) * mix;
      }
      d[i] = nr; d[i + 1] = ng; d[i + 2] = nb;
      // alpha (d[i + 3]) left untouched
    }
    ctx.putImageData(img, 0, 0);
  }
}
