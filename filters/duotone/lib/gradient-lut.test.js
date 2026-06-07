/**
 * Unit tests for the pure duotone math. No canvas/DOM — hex parsing,
 * luminance, config normalization, the colour LUT, and the luminance →
 * index mapping are all plain arithmetic. The Canvas2D readback + per-pixel
 * apply in duotone-filter.js needs a renderer harness and isn't covered.
 */

import {
  DEFAULT_CONFIG,
  OFFSET_MIN,
  OFFSET_MAX,
  CONTRAST_MIN,
  CONTRAST_MAX,
  LUT_SIZE,
  clamp,
  clamp01,
  num,
  lerp,
  luma,
  hexToRgb,
  normalizeConfig,
  lutKey,
  buildLut,
  mapIndex
} from './gradient-lut.js';

describe('helpers', () => {
  it('clamp / clamp01 pin to range', () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(99, 0, 10)).toBe(10);
    expect(clamp01(2)).toBe(1);
    expect(clamp01(-2)).toBe(0);
  });

  it('num falls back on non-finite / non-number', () => {
    expect(num(3, 9)).toBe(3);
    expect(num(NaN, 9)).toBe(9);
    expect(num('7', 9)).toBe(9);
  });

  it('lerp interpolates', () => {
    expect(lerp(0, 10, 0)).toBe(0);
    expect(lerp(0, 10, 1)).toBe(10);
    expect(lerp(0, 10, 0.5)).toBe(5);
  });

  it('luma uses Rec. 601 weights', () => {
    expect(luma(255, 255, 255)).toBeCloseTo(255, 5);
    expect(luma(0, 0, 0)).toBe(0);
    expect(luma(255, 0, 0)).toBeCloseTo(76.245, 3);
  });
});

describe('hexToRgb', () => {
  it('parses #rrggbb', () => {
    expect(hexToRgb('#ff8800')).toEqual({ r: 255, g: 136, b: 0 });
    expect(hexToRgb('#000000')).toEqual({ r: 0, g: 0, b: 0 });
  });

  it('falls back to black on malformed input', () => {
    expect(hexToRgb('nope')).toEqual({ r: 0, g: 0, b: 0 });
    expect(hexToRgb('#fff')).toEqual({ r: 0, g: 0, b: 0 });
    expect(hexToRgb(null)).toEqual({ r: 0, g: 0, b: 0 });
  });
});

describe('normalizeConfig', () => {
  it('returns the defaults for an empty patch', () => {
    expect(normalizeConfig({})).toEqual({ ...DEFAULT_CONFIG });
  });

  it('clamps offset and contrast to their ranges', () => {
    expect(normalizeConfig({ offset: 5 }).offset).toBe(OFFSET_MAX);
    expect(normalizeConfig({ offset: -5 }).offset).toBe(OFFSET_MIN);
    expect(normalizeConfig({ contrast: 99 }).contrast).toBe(CONTRAST_MAX);
    expect(normalizeConfig({ contrast: -1 }).contrast).toBe(CONTRAST_MIN);
  });

  it('clamps mix to 0..1', () => {
    expect(normalizeConfig({ mix: 0.4 }).mix).toBe(0.4);
    expect(normalizeConfig({ mix: 9 }).mix).toBe(1);
  });

  it('keeps string colours and boolean useMidpoint, falling back when malformed', () => {
    expect(normalizeConfig({ colorLow: '#123456' }).colorLow).toBe('#123456');
    expect(normalizeConfig({ useMidpoint: true }).useMidpoint).toBe(true);
    const base = { ...DEFAULT_CONFIG, colorLow: '#abcdef', useMidpoint: true };
    expect(normalizeConfig({ colorLow: 42, useMidpoint: 'yes' }, base).colorLow).toBe('#abcdef');
    expect(normalizeConfig({ colorLow: 42, useMidpoint: 'yes' }, base).useMidpoint).toBe(true);
  });

  it('does not mutate base or carry unknown keys', () => {
    const base = { ...DEFAULT_CONFIG };
    const out = normalizeConfig({ bogus: 1 }, base);
    expect(out).not.toHaveProperty('bogus');
    expect(base).toEqual({ ...DEFAULT_CONFIG });
  });
});

describe('lutKey', () => {
  it('changes only when a colour/stop field changes', () => {
    const a = normalizeConfig({});
    expect(lutKey(a)).toBe(lutKey(normalizeConfig({ offset: 0.5, contrast: 2, mix: 0.3 })));
    expect(lutKey(a)).not.toBe(lutKey(normalizeConfig({ colorLow: '#111111' })));
    expect(lutKey(a)).not.toBe(lutKey(normalizeConfig({ useMidpoint: true })));
  });
});

describe('buildLut', () => {
  it('produces a 256*3 table', () => {
    expect(buildLut(normalizeConfig({})).length).toBe(LUT_SIZE * 3);
  });

  it('two-stop: endpoints are the low and high colours', () => {
    const lut = buildLut(normalizeConfig({ colorLow: '#102030', colorHigh: '#a0b0c0' }));
    expect([lut[0], lut[1], lut[2]]).toEqual([0x10, 0x20, 0x30]);
    const last = (LUT_SIZE - 1) * 3;
    expect([lut[last], lut[last + 1], lut[last + 2]]).toEqual([0xa0, 0xb0, 0xc0]);
  });

  it('two-stop: the centre is the average of the endpoints', () => {
    const lut = buildLut(normalizeConfig({ colorLow: '#000000', colorHigh: '#ffffff' }));
    const c = 128 * 3;
    // i=128 → t≈0.502, so ~128 grey; allow a couple units of rounding slack.
    expect(lut[c]).toBeGreaterThan(124);
    expect(lut[c]).toBeLessThan(132);
  });

  it('three-stop: the centre is the mid colour', () => {
    const lut = buildLut(normalizeConfig({
      colorLow: '#000000', colorHigh: '#ffffff', colorMid: '#ff0000', useMidpoint: true
    }));
    // i=127 (t≈0.498) sits essentially at the mid stop.
    const c = 127 * 3;
    expect(lut[c]).toBeGreaterThan(250);     // R ~255
    expect(lut[c + 1]).toBeLessThan(4);       // G ~0
    expect(lut[c + 2]).toBeLessThan(4);       // B ~0
  });
});

describe('mapIndex', () => {
  it('is the identity (rounded) at offset 0, contrast 1', () => {
    expect(mapIndex(100, 0, 1)).toBe(100);
    expect(mapIndex(200, 0, 1)).toBe(200);
    expect(mapIndex(0, 0, 1)).toBe(0);
  });

  it('offset biases the index and clamps at the ends', () => {
    expect(mapIndex(100, 0.5, 1)).toBe(228); // 100 + 0.5*255 = 227.5 → 228
    expect(mapIndex(200, 1, 1)).toBe(255);   // 200 + 255 → clamp
    expect(mapIndex(50, -1, 1)).toBe(0);     // 50 - 255 → clamp
  });

  it('contrast stretches around mid-grey (128)', () => {
    expect(mapIndex(64, 0, 2)).toBe(0);      // 128 + (-64)*2 = 0
    expect(mapIndex(192, 0, 2)).toBe(255);   // 128 + (64)*2 = 256 → clamp
    expect(mapIndex(128, 0, 3)).toBe(128);   // mid-grey is the fixed point
  });
});
