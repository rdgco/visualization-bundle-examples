/**
 * Color Tint Filter
 *
 * The simplest possible filter — copies the source canvas through
 * and overlays a configurable tinted rectangle. Pure 2D canvas;
 * no WebGL, no offscreen GL surface, no shader compilation.
 *
 * Useful as a smoke test for the harness's filter pipeline
 * (TASK-02): it visually proves the content layer is rendering to
 * its offscreen canvas and the filter's `render(source, ctx)` call
 * is wired through to the visible filter-output canvas.
 *
 * Demonstrates: color + number params, `setModulatedValues`,
 * `updateParams`, `resize`. No reactions.
 */

export const key = 'color-tint';
export const label = 'Color Tint';
export const type = 'filter';
export const category = 'demos';
export const description =
  'Overlays a configurable tinted rectangle over the source canvas. ' +
  'Pure-Canvas2D smoke filter — useful for verifying the harness pipeline end-to-end.';

export const params = {
  color: {
    type: 'color',
    label: 'Tint color',
    default: '#ff0000',
    description: 'Color of the overlay tint.',
    modulation: true
  },
  alpha: {
    type: 'number',
    label: 'Tint strength',
    default: 0.4,
    min: 0,
    max: 1,
    step: 0.01,
    description: 'Opacity of the tint overlay. 0 = source unchanged; 1 = solid color.',
    modulation: true
  }
};

export default class ColorTintFilter {
  constructor(width, height, initialParams = {}) {
    this._w = width;
    this._h = height;
    this._color = '#ff0000';
    this._alpha = 0.4;
    this._applyParams(initialParams);
  }

  _applyParams(p) {
    if (!p) return;
    if (typeof p.color === 'string') this._color = p.color;
    if (typeof p.alpha === 'number') this._alpha = Math.max(0, Math.min(1, p.alpha));
  }

  render(sourceCanvas, ctx) {
    // Copy the source through, then overlay the tint. `drawImage`
    // handles DPR / size mismatches gracefully — the source is what
    // the layer rendered, the destination is the visible filter-
    // output canvas.
    ctx.drawImage(sourceCanvas, 0, 0, this._w, this._h);
    ctx.fillStyle = withAlpha(this._color, this._alpha);
    ctx.fillRect(0, 0, this._w, this._h);
  }

  updateParams(p) { this._applyParams(p); }
  setConfig(p)    { this._applyParams(p); }
  setModulatedValues(p) { this._applyParams(p); }

  resize(width, height) {
    this._w = width;
    this._h = height;
  }

  cleanup() {
    // No GPU resources, no listeners, nothing to release.
  }
}

/**
 * Combine an opaque hex color (`#rrggbb`) with an alpha float
 * (0..1) into the `rgba(...)` form `ctx.fillStyle` accepts. Used
 * here rather than `ctx.globalAlpha` to avoid leaking state out of
 * `render()` if the caller forgets to wrap with `save()`/`restore()`.
 */
function withAlpha(hex, alpha) {
  const h = (hex || '#000000').replace('#', '');
  const r = parseInt(h.slice(0, 2), 16) || 0;
  const g = parseInt(h.slice(2, 4), 16) || 0;
  const b = parseInt(h.slice(4, 6), 16) || 0;
  return `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(3)})`;
}
