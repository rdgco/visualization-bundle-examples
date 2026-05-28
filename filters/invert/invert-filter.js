/**
 * Invert Filter
 *
 * RGB invert per-pixel. Useful as a second smoke filter alongside
 * color-tint — proves per-pixel readback works (drawImage + getImageData
 * + putImageData) rather than just the source→destination blit path
 * color-tint exercises.
 *
 * No params, no reactions — the simplest possible "filter has visible
 * effect" demonstration. Single `strength` param lets the operator
 * fade between source and inverted output.
 *
 * Pure 2D canvas. No WebGL.
 */

export const key = 'invert';
export const label = 'Invert';
export const type = 'filter';
export const category = 'demos';
export const description =
  'Per-pixel RGB invert with an adjustable strength fade. Pure Canvas2D ' +
  'smoke filter; useful for verifying readback-style pipelines (vs ' +
  'color-tint\'s blit-only path).';

export const params = {
  strength: {
    type: 'number',
    label: 'Invert strength',
    default: 1.0,
    min: 0,
    max: 1,
    step: 0.01,
    description: 'Mix between source (0) and fully-inverted (1).',
    modulation: true
  }
};

export default class InvertFilter {
  constructor(width, height, initialParams = {}) {
    this._w = width;
    this._h = height;
    this._strength = 1.0;
    this._applyParams(initialParams);
  }

  _applyParams(p) {
    if (!p) return;
    if (typeof p.strength === 'number') {
      this._strength = Math.max(0, Math.min(1, p.strength));
    }
  }

  render(sourceCanvas, ctx) {
    // Blit source to the destination first so we can readback at the
    // destination's pixel dimensions (avoids a size mismatch when the
    // source canvas is a different resolution from this output canvas).
    ctx.drawImage(sourceCanvas, 0, 0, this._w, this._h);
    if (this._strength <= 0) return;

    const img = ctx.getImageData(0, 0, this._w, this._h);
    const d = img.data;
    const s = this._strength;
    for (let i = 0; i < d.length; i += 4) {
      // Linear mix: source * (1 - s) + (255 - source) * s
      d[i]     = d[i]     * (1 - s) + (255 - d[i])     * s;
      d[i + 1] = d[i + 1] * (1 - s) + (255 - d[i + 1]) * s;
      d[i + 2] = d[i + 2] * (1 - s) + (255 - d[i + 2]) * s;
      // alpha untouched
    }
    ctx.putImageData(img, 0, 0);
  }

  updateParams(p) { this._applyParams(p); }
  setConfig(p)    { this._applyParams(p); }
  setModulatedValues(p) { this._applyParams(p); }

  resize(width, height) {
    this._w = width;
    this._h = height;
  }

  cleanup() {
    // No GPU resources to release.
  }
}
