/**
 * Unit tests for the pure edge-detection math. No canvas/DOM — luminance,
 * Sobel, threshold/gain mapping, and config normalization are all plain
 * arithmetic over typed arrays. The Canvas2D readback + compositing in
 * edge-detect-filter.js needs a renderer harness and isn't covered here.
 */

import {
  DEFAULT_CONFIG,
  COLOR_MODES,
  clamp,
  clamp01,
  num,
  hexToRgb,
  normalizeConfig,
  luma,
  computeLuminance,
  sobel,
  edgeAlpha
} from './edges.js';

// Build a packed RGBA buffer (w*h) from a per-pixel grey value function.
function greyImage(w, h, valueAt) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = valueAt(x, y);
      const i = (y * w + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = v;
      data[i + 3] = 255;
    }
  }
  return data;
}

describe('clamp helpers', () => {
  test('clamp bounds both ends', () => {
    expect(clamp(5, 0, 1)).toBe(1);
    expect(clamp(-5, 0, 1)).toBe(0);
    expect(clamp(0.5, 0, 1)).toBe(0.5);
  });
  test('clamp01 is clamp to 0..1', () => {
    expect(clamp01(2)).toBe(1);
    expect(clamp01(-2)).toBe(0);
  });
  test('num falls back on non-finite', () => {
    expect(num(3, 9)).toBe(3);
    expect(num(NaN, 9)).toBe(9);
    expect(num('x', 9)).toBe(9);
    expect(num(undefined, 9)).toBe(9);
  });
});

describe('hexToRgb', () => {
  test('parses #rrggbb', () => {
    expect(hexToRgb('#ff8800')).toEqual({ r: 255, g: 136, b: 0 });
    expect(hexToRgb('#000000')).toEqual({ r: 0, g: 0, b: 0 });
  });
  test('falls back to black on garbage', () => {
    expect(hexToRgb('nope')).toEqual({ r: 0, g: 0, b: 0 });
    expect(hexToRgb('#fff')).toEqual({ r: 0, g: 0, b: 0 });
    expect(hexToRgb(null)).toEqual({ r: 0, g: 0, b: 0 });
  });
});

describe('normalizeConfig', () => {
  test('returns defaults for empty patch', () => {
    expect(normalizeConfig({})).toEqual(DEFAULT_CONFIG);
    expect(normalizeConfig(undefined)).toEqual(DEFAULT_CONFIG);
  });
  test('clamps numeric ranges', () => {
    const c = normalizeConfig({ threshold: 5, gain: 99, glow: -1, detail: 9, glowSize: 999 });
    expect(c.threshold).toBe(1);
    expect(c.gain).toBe(8);
    expect(c.glow).toBe(0);
    expect(c.detail).toBe(1);
    expect(c.glowSize).toBe(40);
  });
  test('detail has a floor so the work buffer never collapses', () => {
    expect(normalizeConfig({ detail: 0 }).detail).toBe(0.2);
  });
  test('rejects unknown colorMode, keeps base', () => {
    expect(normalizeConfig({ colorMode: 'rainbow' }).colorMode).toBe(DEFAULT_CONFIG.colorMode);
    expect(normalizeConfig({ colorMode: 'source' }).colorMode).toBe('source');
    COLOR_MODES.forEach(m => expect(normalizeConfig({ colorMode: m }).colorMode).toBe(m));
  });
  test('merges over a custom base', () => {
    const base = { ...DEFAULT_CONFIG, gain: 3 };
    expect(normalizeConfig({}, base).gain).toBe(3);
    expect(normalizeConfig({ gain: 1 }, base).gain).toBe(1);
  });
});

describe('luminance', () => {
  test('luma weights sum to 1 (white → 255)', () => {
    expect(luma(255, 255, 255)).toBeCloseTo(255);
    expect(luma(0, 0, 0)).toBe(0);
  });
  test('computeLuminance packs one value per pixel', () => {
    const data = greyImage(2, 1, () => 128);
    const lum = computeLuminance(data, 2, 1);
    expect(lum).toHaveLength(2);
    expect(lum[0]).toBeCloseTo(128);
    expect(lum[1]).toBeCloseTo(128);
  });
});

describe('sobel', () => {
  test('flat field has zero gradient', () => {
    const lum = computeLuminance(greyImage(5, 5, () => 100), 5, 5);
    const mag = sobel(lum, 5, 5);
    expect(Math.max(...mag)).toBe(0);
  });

  test('vertical edge produces a strong interior gradient', () => {
    // Left half black, right half white — a hard vertical edge at x=2.
    const w = 5, h = 5;
    const lum = computeLuminance(greyImage(w, h, x => (x < 2 ? 0 : 255)), w, h);
    const mag = sobel(lum, w, h);
    // Interior column straddling the edge lights up; far columns stay flat.
    const center = mag[2 * w + 2];
    const flat = mag[2 * w + 0]; // border, always 0
    expect(center).toBeGreaterThan(0.3);
    expect(flat).toBe(0);
  });

  test('magnitude is normalized to 0..1', () => {
    const w = 4, h = 4;
    const lum = computeLuminance(greyImage(w, h, x => (x < 2 ? 0 : 255)), w, h);
    const mag = sobel(lum, w, h);
    for (const m of mag) {
      expect(m).toBeGreaterThanOrEqual(0);
      expect(m).toBeLessThanOrEqual(1);
    }
  });
});

describe('edgeAlpha', () => {
  test('below threshold is suppressed', () => {
    expect(edgeAlpha(0.05, 0.1, 1)).toBe(0);
    expect(edgeAlpha(0.1, 0.1, 1)).toBe(0);
  });
  test('gain scales the post-threshold range', () => {
    // mag 0.5, threshold 0 → t=0.5; gain 2 → 1 (clamped).
    expect(edgeAlpha(0.5, 0, 2)).toBe(1);
    expect(edgeAlpha(0.5, 0, 1)).toBeCloseTo(0.5);
  });
  test('threshold rescales the remaining range to 0..1', () => {
    // mag at the top of the range maps to 1 regardless of threshold.
    expect(edgeAlpha(1, 0.5, 1)).toBeCloseTo(1);
    // halfway between threshold and 1 maps to 0.5 at gain 1.
    expect(edgeAlpha(0.75, 0.5, 1)).toBeCloseTo(0.5);
  });
});
