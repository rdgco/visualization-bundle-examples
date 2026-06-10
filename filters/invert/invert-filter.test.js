/**
 * invert filter — standalone runner tests (no framework).
 *   node filters/invert/invert-filter.test.js
 *
 * invert is DOM-safe; at strength 0 it short-circuits before the
 * getImageData readback, so its passthrough is testable with a mock ctx.
 */
import assert from 'node:assert';
import InvertFilter from './invert-filter.js';

let passed = 0;
const test = (n, f) => { f(); passed++; console.log(`✓ ${n}`); };

test('strength clamps into 0..1', () => {
  const f = new InvertFilter(100, 100);
  f.updateParams({ strength: 5 });
  assert.strictEqual(f._strength, 1, 'capped at 1');
  f.updateParams({ strength: -3 });
  assert.strictEqual(f._strength, 0, 'floored at 0');
});

test('render at strength 0 blits source without readback', () => {
  const f = new InvertFilter(100, 100, { strength: 0 });
  let drew = 0, read = 0;
  f.render({ width: 100, height: 100 }, {
    drawImage: () => drew++,
    getImageData: () => { read++; return { data: new Uint8ClampedArray(4) }; },
    putImageData: () => {}
  });
  assert.strictEqual(drew, 1, 'source blitted');
  assert.strictEqual(read, 0, 'no readback when strength 0');
});

test('strength is audio-bindable', async () => {
  const mod = await import('./invert-filter.js');
  assert.strictEqual(mod.params.strength.modulation?.kind, 'audio');
});

test('lifecycle no-throws', () => {
  const f = new InvertFilter(10, 10);
  f.setModulatedValues({ strength: 0.5 });
  f.resize(20, 20);
  f.cleanup();
});

console.log(`\n${passed} passed`);
