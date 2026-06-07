/**
 * Pure math for the `duotone` filter. No canvas / no DOM — config
 * normalization, hex parsing, the luminance weights, the 256-entry colour
 * LUT, and the luminance → LUT-index mapping. All plain arithmetic, so the
 * colour logic is unit-testable in plain Node.
 *
 * The Canvas2D readback + per-pixel apply live in `../duotone-filter.js`;
 * everything here is stateless and side-effect free.
 */

export const DEFAULT_CONFIG = {
  // shadows colour (luminance 0) and highlights colour (luminance 255)
  colorLow: '#0b0f2b',
  colorHigh: '#f6c177',
  // optional third stop at the midpoint, gated by `useMidpoint`
  useMidpoint: false,
  colorMid: '#eb5e7c',
  // luminance → index bias (-1..1), scrolls the palette through the image
  offset: 0,
  // pre-map luminance stretch around mid-grey (1 = unchanged)
  contrast: 1,
  // wet/dry: 1 = full duotone, 0 = original source
  mix: 1
};

export const OFFSET_MIN = -1;
export const OFFSET_MAX = 1;
export const CONTRAST_MIN = 0;
export const CONTRAST_MAX = 4;
export const LUT_SIZE = 256;

export function clamp(v, min, max) {
  return v < min ? min : v > max ? max : v;
}

export function clamp01(v) {
  return clamp(v, 0, 1);
}

export function num(v, fallback) {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

// Rec. 601 luma weights — matches the edge-detect filter's luminance so a
// pixel's "brightness" reads the same across the bundle's filters.
export function luma(r, g, b) {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

/**
 * Parse a `#rrggbb` hex string to `{ r, g, b }` (0..255). Falls back to
 * black on anything malformed so a bad param can never throw mid-frame.
 */
export function hexToRgb(hex) {
  if (typeof hex === 'string' && /^#[0-9a-fA-F]{6}$/.test(hex)) {
    return {
      r: parseInt(hex.slice(1, 3), 16),
      g: parseInt(hex.slice(3, 5), 16),
      b: parseInt(hex.slice(5, 7), 16)
    };
  }
  return { r: 0, g: 0, b: 0 };
}

/**
 * Merge `patch` over `base`, coercing + clamping every field so the
 * returned config is always render-safe.
 */
export function normalizeConfig(patch, base = DEFAULT_CONFIG) {
  const p = patch || {};
  return {
    colorLow: typeof p.colorLow === 'string' ? p.colorLow : base.colorLow,
    colorHigh: typeof p.colorHigh === 'string' ? p.colorHigh : base.colorHigh,
    useMidpoint: typeof p.useMidpoint === 'boolean' ? p.useMidpoint : base.useMidpoint,
    colorMid: typeof p.colorMid === 'string' ? p.colorMid : base.colorMid,
    offset: clamp(num(p.offset, base.offset), OFFSET_MIN, OFFSET_MAX),
    contrast: clamp(num(p.contrast, base.contrast), CONTRAST_MIN, CONTRAST_MAX),
    mix: clamp01(num(p.mix, base.mix))
  };
}

/**
 * A short string identity of the LUT-affecting fields. The filter rebuilds
 * its LUT only when this changes — `offset`/`contrast`/`mix` are applied at
 * sample time and don't touch the table, so dragging them is free.
 */
export function lutKey(cfg) {
  return `${cfg.colorLow}|${cfg.colorHigh}|${cfg.useMidpoint}|${cfg.colorMid}`;
}

/**
 * Build the gradient LUT: a `Uint8ClampedArray(256*3)` mapping luminance
 * (0..255) → RGB. Two-stop (low → high) unless `useMidpoint`, in which case
 * it's three-stop (low → mid at the centre → high).
 */
export function buildLut(cfg) {
  const lut = new Uint8ClampedArray(LUT_SIZE * 3);
  const low = hexToRgb(cfg.colorLow);
  const high = hexToRgb(cfg.colorHigh);
  const mid = hexToRgb(cfg.colorMid);
  for (let i = 0; i < LUT_SIZE; i++) {
    const t = i / (LUT_SIZE - 1);
    let r, g, b;
    if (cfg.useMidpoint) {
      if (t < 0.5) {
        const u = t / 0.5;
        r = lerp(low.r, mid.r, u); g = lerp(low.g, mid.g, u); b = lerp(low.b, mid.b, u);
      } else {
        const u = (t - 0.5) / 0.5;
        r = lerp(mid.r, high.r, u); g = lerp(mid.g, high.g, u); b = lerp(mid.b, high.b, u);
      }
    } else {
      r = lerp(low.r, high.r, t); g = lerp(low.g, high.g, t); b = lerp(low.b, high.b, t);
    }
    const o = i * 3;
    lut[o] = r; lut[o + 1] = g; lut[o + 2] = b;
  }
  return lut;
}

/**
 * Map a pixel luminance (0..255) to a LUT index (0..255): stretch around
 * mid-grey by `contrast`, then bias by `offset` (a full ±1 shifts the whole
 * range end to end). Clamped to the table bounds.
 */
export function mapIndex(lum, offset, contrast) {
  const stretched = 128 + (lum - 128) * contrast;
  const idx = Math.round(stretched + offset * (LUT_SIZE - 1));
  return clamp(idx, 0, LUT_SIZE - 1);
}
