/**
 * pixelate — mosaic / block-resample post-process. Collapses the source
 * into square blocks of a tunable size, with the block size audio-
 * modulatable so the image shatters into big blocks on a hit and resolves
 * as the energy decays.
 *
 * Pipeline per frame (all Canvas2D, no WebGL, no getImageData):
 *   1. Draw the source downscaled to `w/blockSize × h/blockSize` on a small
 *      offscreen canvas, smoothing ON — the browser's bilinear shrink
 *      *averages* each block's region into one pixel (a nicer mosaic than
 *      point-sampling a single pixel per block).
 *   2. Draw that small canvas back up to full size with smoothing OFF
 *      (nearest-neighbour), so each averaged pixel becomes one crisp block.
 *   3. If `mix < 1`, the original is drawn first and the blocks composited
 *      over it at `mix` alpha — a sharp↔blocky crossfade.
 *
 * Performance: this is *cheaper* than a full-resolution pass — the only
 * real work is shrinking the source, which the GPU does in `drawImage`.
 * No per-pixel JS loop, no pixel readback, and the small offscreen canvas
 * is reallocated only when the working dimensions change.
 *
 * The pure math (config normalization, block-size → buffer dimensions)
 * lives in `lib/mosaic.js` and is unit-tested; this file owns the canvas
 * work and the param plumbing.
 */

import {
  DEFAULT_CONFIG,
  BLOCK_MIN,
  BLOCK_MAX,
  normalizeConfig,
  blockDims
} from './lib/mosaic.js';

export const key = 'pixelate';
export const label = 'Pixelate';
export const type = 'filter';
export const category = 'stylize';
export const description =
  'Mosaic / block-resample of the source. Collapses the image into square ' +
  'blocks of a tunable size; bind the block size to audio so it shatters ' +
  'into big blocks on a hit and resolves as it decays. Cheaper than a ' +
  'full-resolution pass.';

// Cross-host audio-modulation marker. Harness reads `kind: 'audio'`; midi-daddy
// reads `sourceTypes` + `defaultAmount`; lfo/random let the platform's
// generators drive the param. Each host ignores the other's keys.
const audioMod = defaultAmount => ({
  kind: 'audio',
  sourceTypes: ['audio', 'oneshot', 'note', 'tempo', 'lfo', 'random'],
  defaultAmount
});

export const params = {
  blockSize: {
    type: 'number',
    label: 'Block size (px)',
    default: DEFAULT_CONFIG.blockSize,
    min: BLOCK_MIN, max: BLOCK_MAX, step: 1,
    description:
      'Edge length of one mosaic block, in output pixels. 1 = untouched; ' +
      'larger = chunkier blocks. Bind to peak/bass for a shatter-on-the-beat.',
    modulation: audioMod(8)
  },
  mix: {
    type: 'number',
    label: 'Mix (wet / dry)',
    default: DEFAULT_CONFIG.mix,
    min: 0, max: 1, step: 0.01,
    description:
      'Blend of the pixelated result over the original. 1 = fully ' +
      'pixelated; 0 = original source; in between crossfades sharp↔blocky.',
    modulation: audioMod(0.3)
  }
};

export default class PixelateFilter {
  constructor(width, height, initialParams = {}) {
    this._w = Math.max(1, width | 0);
    this._h = Math.max(1, height | 0);
    this._config = normalizeConfig(initialParams, DEFAULT_CONFIG);

    // Small offscreen canvas the source is shrunk into; resized lazily in
    // render(). Guarded so the filter constructs headless (degrades to a
    // passthrough) like every other filter in the bundle.
    this._supported = typeof document !== 'undefined' && typeof document.createElement === 'function';
    this._small = null;
    this._sctx = null;
    if (this._supported) {
      this._small = document.createElement('canvas');
      this._sctx = this._small.getContext('2d');
    }
    this._sw = 0;
    this._sh = 0;
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
    // Drop the offscreen canvas backing store.
    if (this._small) this._small.width = this._small.height = 0;
  }

  // ── Contract: render ───────────────────────────────────────────────
  render(sourceCanvas, ctx) {
    if (!this._supported) {
      if (ctx && typeof ctx.drawImage === 'function') ctx.drawImage(sourceCanvas, 0, 0, this._w, this._h);
      return;
    }
    const { _w: w, _h: h } = this;
    const cfg = this._config;

    const { sw, sh } = blockDims(w, h, cfg.blockSize);
    if (sw !== this._sw || sh !== this._sh) {
      this._sw = this._small.width = sw;
      this._sh = this._small.height = sh;
    }

    // 1. Shrink the source into the small buffer, averaging each block's
    //    region (smoothing ON gives the averaged mosaic colour).
    this._sctx.imageSmoothingEnabled = true;
    this._sctx.clearRect(0, 0, sw, sh);
    this._sctx.drawImage(sourceCanvas, 0, 0, sw, sh);

    // 2. (wet/dry) draw the original underneath when not fully wet, so the
    //    blocks can crossfade over it.
    if (cfg.mix < 1) {
      ctx.drawImage(sourceCanvas, 0, 0, w, h);
    }

    // 3. Scale the small buffer back up with crisp, nearest-neighbour
    //    blocks. globalAlpha carries the wet/dry blend.
    const prevSmoothing = ctx.imageSmoothingEnabled;
    ctx.imageSmoothingEnabled = false;
    ctx.save();
    if (cfg.mix < 1) ctx.globalAlpha = cfg.mix;
    ctx.drawImage(this._small, 0, 0, sw, sh, 0, 0, w, h);
    ctx.restore();
    ctx.imageSmoothingEnabled = prevSmoothing;
  }
}
