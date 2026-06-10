/**
 * vignette filter — standalone runner tests (no framework).
 *   node filters/vignette/vignette-filter.test.js
 *
 * The shader needs a WebGL context, so the filter is inert under node; these
 * cover the headless guard + passthrough, the schema's audio markers, and
 * lifecycle no-throws. The shader output is verified visually in a host.
 */
import assert from 'node:assert';
import VignetteFilter from './vignette-filter.js';

let passed = 0;
const test = (n, f) => { f(); passed++; console.log(`✓ ${n}`); };

test('constructs headless, reports inactive, passes through', () => {
  const f = new VignetteFilter(640, 480);
  assert.strictEqual(f.isActive(), false);
  let drew = 0;
  f.render({ width: 640, height: 480 }, { drawImage: () => drew++ });
  assert.strictEqual(drew, 1, 'passthrough when no WebGL');
});

test('schema params carry the cross-host audio marker', async () => {
  const mod = await import('./vignette-filter.js');
  // a number param and a colour param both opt into audio
  assert.strictEqual(mod.params.sizeX.modulation?.kind, 'audio');
  assert.strictEqual(mod.params['frame.color'].modulation?.kind, 'audio');
  assert.ok(mod.params.sizeX.modulation.sourceTypes.includes('lfo'), 'lfo source present');
});

test('lifecycle no-throws', () => {
  const f = new VignetteFilter(10, 10);
  f.updateConfig({ sizeX: 40 });
  f.setModulatedValues({ sizeX: 60 });
  f.resize(20, 20);
  f.cleanup();
  assert.strictEqual(f.isActive(), false);
});

console.log(`\n${passed} passed`);
