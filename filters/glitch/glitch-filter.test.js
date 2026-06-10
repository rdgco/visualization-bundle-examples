/**
 * glitch filter — standalone runner tests (no framework).
 *   node filters/glitch/glitch-filter.test.js
 *
 * glitch constructs headless (channel canvases are lazy). At intensity 0 it
 * passes through before any channel allocation, so the passthrough + the
 * burst-envelope logic are testable under node.
 */
import assert from 'node:assert';
import GlitchFilter from './glitch-filter.js';

let passed = 0;
const test = (n, f) => { f(); passed++; console.log(`✓ ${n}`); };

test('intensity clamps; mode enum validates', () => {
  const f = new GlitchFilter(100, 100);
  f.updateParams({ intensity: 9 });
  assert.strictEqual(f._intensity, 1, 'intensity capped');
  f.updateParams({ mode: 'slice' });
  assert.strictEqual(f._mode, 'slice', 'mode applied');
  f.updateParams({ mode: 'bogus' });
  assert.strictEqual(f._mode, 'slice', 'invalid mode ignored');
});

test('render at intensity 0 passes the source through', () => {
  const f = new GlitchFilter(100, 100, { intensity: 0 });
  let drew = 0;
  f.render({ width: 100, height: 100 }, { drawImage: () => drew++ });
  assert.strictEqual(drew, 1, 'passthrough at intensity 0');
});

test('burst arms a decaying envelope; unknown reaction throws', () => {
  const f = new GlitchFilter(10, 10);
  assert.strictEqual(f._burstAmount(), 0, 'idle');
  f.react('burst', { strength: 1 });
  assert.ok(f._burstAmount() > 0.9, 'near peak after firing');
  assert.throws(() => f.react('bogus'), /unknown reaction/);
});

test('intensity is audio-bindable', async () => {
  const mod = await import('./glitch-filter.js');
  assert.strictEqual(mod.params.intensity.modulation?.kind, 'audio');
});

test('lifecycle no-throws', () => {
  const f = new GlitchFilter(10, 10);
  f.setModulatedValues({ intensity: 0.5 });
  f.resize(20, 20);
  f.cleanup();
});

console.log(`\n${passed} passed`);
