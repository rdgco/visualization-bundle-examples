/**
 * pixelate filter — standalone runner tests (no framework).
 *   node filters/pixelate/pixelate-filter.test.js
 *
 * The mosaic needs offscreen canvases, so the filter is inert under node;
 * these cover the headless guard + passthrough, the audio markers, and
 * lifecycle no-throws. (The block-dim math is unit-tested in lib/mosaic.test.js.)
 */
import assert from 'node:assert';
import PixelateFilter from './pixelate-filter.js';

let passed = 0;
const test = (n, f) => { f(); passed++; console.log(`✓ ${n}`); };

test('constructs headless, reports inactive, passes through', () => {
  const f = new PixelateFilter(640, 480);
  assert.strictEqual(f.isActive(), false);
  let drew = 0;
  f.render({ width: 640, height: 480 }, { drawImage: () => drew++ });
  assert.strictEqual(drew, 1, 'passthrough when no DOM');
});

test('blockSize + mix are audio-bindable', async () => {
  const mod = await import('./pixelate-filter.js');
  assert.strictEqual(mod.params.blockSize.modulation?.kind, 'audio');
  assert.strictEqual(mod.params.mix.modulation?.kind, 'audio');
});

test('lifecycle no-throws', () => {
  const f = new PixelateFilter(10, 10);
  f.setModulatedValues({ blockSize: 8 });
  f.resize(20, 20);
  f.cleanup();
  assert.strictEqual(f.isActive(), false);
});

console.log(`\n${passed} passed`);
