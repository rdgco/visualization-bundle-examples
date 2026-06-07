/**
 * Pure edge-detection math for the `edge-detect` filter. No canvas / no
 * DOM — just luminance, a 3×3 Sobel operator, and config normalization,
 * so the heavy per-pixel work is unit-testable in plain Node.
 *
 * The Canvas2D readback, compositing, glow, and timing live in
 * `../edge-detect-filter.js`; everything here is plain arithmetic over
 * typed arrays.
 */

export const COLOR_MODES = ['solid', 'source'];

export const DEFAULT_CONFIG = {
  // gradient magnitude below this is suppressed (0..1)
  threshold: 0.08,
  // edge brightness multiplier
  gain: 1.6,
  // edge tint in 'solid' color mode
  edgeColor: '#37e6a5',
  // 'solid' = edgeColor, 'source' = sampled image color
  colorMode: 'solid',
  backgroundColor: '#05070a',
  // wet/dry: 0 = edges on backgroundColor, 1 = edges over source
  backgroundOpacity: 0,
  // bloom strength around edges (0..1)
  glow: 0.45,
  // blur radius of the glow, in output pixels
  glowSize: 6,
  // processing resolution as a fraction of output (0.2..1)
  detail: 0.6
};

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
 * returned config is always render-safe. Unknown enum values fall back
 * to the base value.
 */
export function normalizeConfig(patch, base = DEFAULT_CONFIG) {
  const p = patch || {};
  const colorMode = COLOR_MODES.includes(p.colorMode) ? p.colorMode : base.colorMode;
  return {
    threshold: clamp01(num(p.threshold, base.threshold)),
    gain: clamp(num(p.gain, base.gain), 0, 8),
    edgeColor: typeof p.edgeColor === 'string' ? p.edgeColor : base.edgeColor,
    colorMode,
    backgroundColor: typeof p.backgroundColor === 'string' ? p.backgroundColor : base.backgroundColor,
    backgroundOpacity: clamp01(num(p.backgroundOpacity, base.backgroundOpacity)),
    glow: clamp01(num(p.glow, base.glow)),
    glowSize: clamp(num(p.glowSize, base.glowSize), 0, 40),
    detail: clamp(num(p.detail, base.detail), 0.2, 1)
  };
}

// Rec. 601 luma weights — cheap and good enough for edge gradients.
export function luma(r, g, b) {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

/**
 * Build a single-channel luminance buffer (0..255) from packed RGBA
 * `data` of `w*h` pixels. Returns a `Float32Array` of length `w*h`.
 */
export function computeLuminance(data, w, h) {
  const out = new Float32Array(w * h);
  for (let i = 0, p = 0; p < out.length; i += 4, p++) {
    out[p] = luma(data[i], data[i + 1], data[i + 2]);
  }
  return out;
}

// Largest possible Sobel gradient magnitude for 0..255 input:
// |gx|max = |gy|max = 4*255 = 1020, so |g|max = sqrt(1020² + 1020²).
const MAX_MAGNITUDE = Math.sqrt(1020 * 1020 * 2);

/**
 * 3×3 Sobel over a luminance buffer. Returns a `Float32Array` of length
 * `w*h` holding the gradient magnitude per pixel, normalized to 0..1.
 * The one-pixel border is left at 0 (no neighbourhood to sample).
 */
export function sobel(lum, w, h) {
  const out = new Float32Array(w * h);
  const inv = 1 / MAX_MAGNITUDE;
  for (let y = 1; y < h - 1; y++) {
    const row = y * w;
    for (let x = 1; x < w - 1; x++) {
      const i = row + x;
      const tl = lum[i - w - 1], tc = lum[i - w], tr = lum[i - w + 1];
      const ml = lum[i - 1], mr = lum[i + 1];
      const bl = lum[i + w - 1], bc = lum[i + w], br = lum[i + w + 1];
      const gx = (tr + 2 * mr + br) - (tl + 2 * ml + bl);
      const gy = (bl + 2 * bc + br) - (tl + 2 * tc + tr);
      out[i] = Math.sqrt(gx * gx + gy * gy) * inv;
    }
  }
  return out;
}

/**
 * Map a normalized gradient magnitude (0..1) to an edge alpha (0..1):
 * subtract the threshold (rescaling so the remaining range still spans
 * 0..1), then apply gain. Below threshold → 0.
 */
export function edgeAlpha(mag, threshold, gain) {
  if (mag <= threshold) return 0;
  const denom = 1 - threshold;
  const t = denom > 0 ? (mag - threshold) / denom : mag;
  return clamp01(t * gain);
}
