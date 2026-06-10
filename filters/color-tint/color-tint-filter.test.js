/**
 * color-tint filter — standalone runner tests (no framework).
 *   node filters/color-tint/color-tint-filter.test.js
 *
 * color-tint is DOM-safe (it only touches the passed ctx), so it runs fully
 * under node with a mock ctx. Covers param clamping, the blit+tint render,
 * the audio markers, and lifecycle no-throws.
 */
import assert from 'node:assert';
import ColorTintFilter from './color-tint-filter.js';

let passed = 0;
const test = (n, f) => { f(); passed++; console.log(`✓ ${n}`); };

test('param clamp + applies colour', () => {
  const f = new ColorTintFilter(100, 100);
  f.updateParams({ alpha: 5, color: '#00ff00' });
  assert.strictEqual(f._alpha, 1, 'alpha clamped to 1');
  assert.strictEqual(f._color, '#00ff00', 'colour applied');
  f.updateParams({ alpha: -2 });
  assert.strictEqual(f._alpha, 0, 'alpha floored at 0');
});

test('render blits the source then overlays the tint', () => {
  const f = new ColorTintFilter(100, 100);
  let drew = 0, filled = 0;
  f.render({ width: 100, height: 100 }, { drawImage: () => drew++, set fillStyle(v) {}, fillRect: () => filled++ });
  assert.strictEqual(drew, 1, 'source blitted once');
  assert.strictEqual(filled, 1, 'tint overlaid once');
});

test('colour + alpha are audio-bindable', async () => {
  const mod = await import('./color-tint-filter.js');
  assert.strictEqual(mod.params.color.modulation?.kind, 'audio');
  assert.strictEqual(mod.params.alpha.modulation?.kind, 'audio');
});

test('lifecycle no-throws', () => {
  const f = new ColorTintFilter(10, 10);
  f.setModulatedValues({ alpha: 0.5 });
  f.resize(20, 20);
  f.cleanup();
});

console.log(`\n${passed} passed`);
