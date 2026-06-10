/**
 * edge-detect filter — standalone runner tests (no framework).
 *   node filters/edge-detect/edge-detect-filter.test.js
 *
 * The Sobel readback needs a DOM, so the filter is inert under node; these
 * cover the DOM-independent surface: the headless guard + passthrough, the
 * pulse reaction, the audio markers, and lifecycle no-throws. (The Sobel
 * math is unit-tested separately in lib/edges.test.js.)
 */
import assert from 'node:assert';
import EdgeDetectFilter from './edge-detect-filter.js';

let passed = 0;
const test = (n, f) => { f(); passed++; console.log(`✓ ${n}`); };

test('constructs headless, reports inactive, passes through', () => {
  const f = new EdgeDetectFilter(640, 480);
  assert.strictEqual(f.isActive(), false);
  let drew = 0;
  f.render({ width: 640, height: 480 }, { drawImage: () => drew++ });
  assert.strictEqual(drew, 1, 'passthrough when no DOM');
});

test('pulse arms a flare; unknown reaction throws', () => {
  const f = new EdgeDetectFilter(10, 10);
  assert.strictEqual(f._pulse, 0, 'idle');
  f.react('pulse', { strength: 0.9, duration: 1.5 });
  assert.strictEqual(f._pulse, 0.9, 'pulse set to strength');
  assert.strictEqual(f._pulseDecay, 1.5, 'duration applied');
  assert.throws(() => f.react('bogus'), /unknown reaction/);
});

test('numeric params are audio-bindable', async () => {
  const mod = await import('./edge-detect-filter.js');
  for (const name of ['backgroundOpacity', 'threshold', 'gain', 'glow', 'glowSize', 'detail']) {
    assert.strictEqual(mod.params[name].modulation?.kind, 'audio', `${name} audio-bindable`);
  }
});

test('lifecycle no-throws', () => {
  const f = new EdgeDetectFilter(10, 10);
  f.setModulatedValues({ gain: 2 });
  f.resize(20, 20);
  f.cleanup();
  assert.strictEqual(f.isActive(), false);
});

console.log(`\n${passed} passed`);
