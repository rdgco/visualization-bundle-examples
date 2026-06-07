/**
 * Pure math for the `pixelate` filter. No canvas / no DOM — config
 * normalization and the block-size → downscaled-buffer dimensions, so the
 * only non-trivial arithmetic is unit-testable in plain Node.
 *
 * The Canvas2D downscale/upscale and the blend live in
 * `../pixelate-filter.js`; everything here is plain arithmetic.
 */

export const DEFAULT_CONFIG = {
  // edge length, in output pixels, of one mosaic block. 1 = identity.
  blockSize: 16,
  // wet/dry: 1 = fully pixelated, 0 = original source untouched.
  mix: 1
};

// Bounds — kept here so the filter, its params schema, and the tests
// agree on one source of truth.
export const BLOCK_MIN = 1;
export const BLOCK_MAX = 128;

export function clamp(v, min, max) {
  return v < min ? min : v > max ? max : v;
}

export function clamp01(v) {
  return clamp(v, 0, 1);
}

export function num(v, fallback) {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

/**
 * Merge `patch` over `base`, coercing + clamping every field so the
 * returned config is always render-safe. `blockSize` is floored to a whole
 * number of pixels.
 */
export function normalizeConfig(patch, base = DEFAULT_CONFIG) {
  const p = patch || {};
  return {
    blockSize: clamp(Math.round(num(p.blockSize, base.blockSize)), BLOCK_MIN, BLOCK_MAX),
    mix: clamp01(num(p.mix, base.mix))
  };
}

/**
 * Downscaled working dimensions for a given block size: the source is drawn
 * into a `sw × sh` buffer and scaled back up, so each source region of
 * `blockSize` px collapses to a single working pixel = one output block.
 *
 * `blockSize` is defended (floored to >= 1) so a bad value can never
 * produce a zero-size canvas mid-frame; dimensions floor at 1.
 */
export function blockDims(w, h, blockSize) {
  const bs = Math.max(1, Math.floor(num(blockSize, 1)));
  return {
    sw: Math.max(1, Math.round(w / bs)),
    sh: Math.max(1, Math.round(h / bs))
  };
}
