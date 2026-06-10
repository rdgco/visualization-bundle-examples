/**
 * duotone filter — standalone runner tests (no framework).
 *   node filters/duotone/duotone-filter.test.js
 *
 * The gradient-map needs a DOM (getImageData), so the filter is inert under
 * node; these cover the headless guard + passthrough, the audio markers, and
 * lifecycle no-throws. (The LUT/luma math is unit-tested in lib/gradient-lut.test.js.)
 */
import assert from 'node:assert';
import DuotoneFilter from './duotone-filter.js';

let passed = 0;
const test = (n, f) => { f(); passed++; console.log(`✓ ${n}`); };

test('constructs headless, reports inactive, passes through', () => {
  const f = new DuotoneFilter(640, 480);
  assert.strictEqual(f.isActive(), false);
  let drew = 0;
  f.render({ width: 640, height: 480 }, { drawImage: () => drew++ });
  assert.strictEqual(drew, 1, 'passthrough when no DOM');
});

test('offset + contrast + mix are audio-bindable', async () => {
  const mod = await import('./duotone-filter.js');
  for (const name of ['offset', 'contrast', 'mix']) {
    assert.strictEqual(mod.params[name].modulation?.kind, 'audio', `${name} audio-bindable`);
  }
});

test('lifecycle no-throws', () => {
  const f = new DuotoneFilter(10, 10);
  f.setModulatedValues({ offset: 0.2 });
  f.resize(20, 20);
  f.cleanup();
  assert.strictEqual(f.isActive(), false);
});

console.log(`\n${passed} passed`);
