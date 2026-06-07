/**
 * Unit tests for the pure pixelate math. No canvas/DOM — config
 * normalization and the block-size → downscaled-buffer dimensions are plain
 * arithmetic. The Canvas2D downscale/upscale in pixelate-filter.js needs a
 * renderer harness and isn't covered here.
 */

import {
  DEFAULT_CONFIG,
  BLOCK_MIN,
  BLOCK_MAX,
  clamp,
  clamp01,
  num,
  normalizeConfig,
  blockDims
} from './mosaic.js';

describe('clamp / clamp01 / num', () => {
  it('clamps to the given range', () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(11, 0, 10)).toBe(10);
  });

  it('clamp01 pins to 0..1', () => {
    expect(clamp01(0.5)).toBe(0.5);
    expect(clamp01(-2)).toBe(0);
    expect(clamp01(2)).toBe(1);
  });

  it('num falls back on non-finite / non-number input', () => {
    expect(num(3, 9)).toBe(3);
    expect(num(NaN, 9)).toBe(9);
    expect(num(Infinity, 9)).toBe(9);
    expect(num('7', 9)).toBe(9);
    expect(num(undefined, 9)).toBe(9);
  });
});

describe('normalizeConfig', () => {
  it('returns the defaults for an empty patch', () => {
    expect(normalizeConfig({})).toEqual({ ...DEFAULT_CONFIG });
  });

  it('rounds blockSize to a whole number of pixels', () => {
    expect(normalizeConfig({ blockSize: 12.6 }).blockSize).toBe(13);
    expect(normalizeConfig({ blockSize: 12.4 }).blockSize).toBe(12);
  });

  it('clamps blockSize to BLOCK_MIN..BLOCK_MAX', () => {
    expect(normalizeConfig({ blockSize: 0 }).blockSize).toBe(BLOCK_MIN);
    expect(normalizeConfig({ blockSize: -50 }).blockSize).toBe(BLOCK_MIN);
    expect(normalizeConfig({ blockSize: 9999 }).blockSize).toBe(BLOCK_MAX);
  });

  it('clamps mix to 0..1', () => {
    expect(normalizeConfig({ mix: 0.3 }).mix).toBe(0.3);
    expect(normalizeConfig({ mix: -1 }).mix).toBe(0);
    expect(normalizeConfig({ mix: 5 }).mix).toBe(1);
  });

  it('falls back to the base for malformed fields', () => {
    const base = { blockSize: 20, mix: 0.5 };
    expect(normalizeConfig({ blockSize: 'big', mix: null }, base)).toEqual(base);
  });

  it('does not mutate the base or carry unknown keys through', () => {
    const base = { ...DEFAULT_CONFIG };
    const out = normalizeConfig({ bogus: 1 }, base);
    expect(out).toEqual({ ...DEFAULT_CONFIG });
    expect(out).not.toHaveProperty('bogus');
    expect(base).toEqual({ ...DEFAULT_CONFIG });
  });
});

describe('blockDims', () => {
  it('is an identity grid at blockSize 1', () => {
    expect(blockDims(100, 50, 1)).toEqual({ sw: 100, sh: 50 });
  });

  it('divides both axes by the block size', () => {
    expect(blockDims(100, 50, 10)).toEqual({ sw: 10, sh: 5 });
  });

  it('rounds to the nearest whole working pixel', () => {
    // 100 / 3 = 33.33 → 33,  50 / 3 = 16.67 → 17
    expect(blockDims(100, 50, 3)).toEqual({ sw: 33, sh: 17 });
  });

  it('never collapses below a 1×1 buffer', () => {
    expect(blockDims(40, 20, 1000)).toEqual({ sw: 1, sh: 1 });
    expect(blockDims(0, 0, 8)).toEqual({ sw: 1, sh: 1 });
  });

  it('defends against a non-positive / non-finite block size', () => {
    expect(blockDims(80, 40, 0)).toEqual({ sw: 80, sh: 40 });
    expect(blockDims(80, 40, -4)).toEqual({ sw: 80, sh: 40 });
    expect(blockDims(80, 40, NaN)).toEqual({ sw: 80, sh: 40 });
  });

  it('floors a fractional block size before dividing', () => {
    // floor(2.9) = 2 → 80/2 = 40
    expect(blockDims(80, 40, 2.9)).toEqual({ sw: 40, sh: 20 });
  });
});
