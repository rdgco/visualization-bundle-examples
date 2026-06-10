/**
 * chromatic-aberration filter — standalone runner tests (no framework).
 *
 *   node filters/chromatic-aberration/chromatic-aberration-filter.test.js
 *
 * The dispersion needs a WebGL context (absent under plain node), so the filter
 * degrades to a passthrough here; these tests cover the GL-independent logic:
 * param clamping, the pulse envelope, audio markers, contiguous grouping, the
 * passthrough, and lifecycle no-throws. The colour split is verified visually.
 */

import assert from 'node:assert';
import ChromaticAberrationFilter, { clamp } from './chromatic-aberration-filter.js';

let passed = 0;
function test(name, fn) { fn(); passed++; console.log(`✓ ${name}`); }

test('clamp bounds values', () => {
  assert.strictEqual(clamp(9, 0, 1), 1);
  assert.strictEqual(clamp(-9, 0, 1), 0);
  assert.strictEqual(clamp(0.4, 0, 1), 0.4);
});

test('constructs without a DOM and reports inactive', () => {
  const f = new ChromaticAberrationFilter(640, 480, { amount: 0.03 });
  assert.strictEqual(f.isActive(), false);
});

test('render is a safe passthrough when WebGL is unavailable', () => {
  const f = new ChromaticAberrationFilter(100, 100);
  const calls = [];
  const src = { width: 100, height: 100 };
  f.render(src, { drawImage: (...a) => calls.push(a) });
  assert.strictEqual(calls.length, 1);
  assert.deepStrictEqual(calls[0], [src, 0, 0, 100, 100]);
});

test('params clamp into range; garbage ignored', () => {
  const f = new ChromaticAberrationFilter(10, 10);
  f.updateParams({ amount: 9, power: 99, centerX: 5, centerY: -5 });
  assert.strictEqual(f._amount, 0.15, 'amount capped');
  assert.strictEqual(f._power, 4, 'power capped');
  assert.strictEqual(f._centerX, 1, 'centerX capped');
  assert.strictEqual(f._centerY, 0, 'centerY floored');
  f.updateParams({ amount: 'oops', power: null });
  assert.strictEqual(f._amount, 0.15, 'non-number ignored');
  assert.strictEqual(f._power, 4, 'non-number ignored');
});

test('pulse arms a decaying envelope; unknown reaction throws', () => {
  const f = new ChromaticAberrationFilter(10, 10);
  assert.strictEqual(f._pulseAmount(), 0, 'idle');
  f.react('pulse', { strength: 1 });
  assert.ok(f._pulseAmount() > 0.9, 'near peak');
  f.react('pulse', { strength: 0.5 });
  assert.ok(f._pulseAmount() <= 0.5 + 1e-6, 'strength scales');
  assert.throws(() => f.react('bogus'), /unknown reaction/);
});

test('all numeric attributes are audio-bindable', async () => {
  const mod = await import('./chromatic-aberration-filter.js');
  for (const name of ['amount', 'power', 'centerX', 'centerY']) {
    assert.strictEqual(mod.params[name].modulation?.kind, 'audio', `${name} should be audio-bindable`);
  }
});

test('every param belongs to a contiguous paramGroup', async () => {
  const mod = await import('./chromatic-aberration-filter.js');
  const seq = Object.values(mod.params).map(s => s.paramGroup);
  assert.ok(seq.every(Boolean), 'every param has a paramGroup');
  const seen = new Set();
  let prev = null;
  for (const g of seq) {
    if (g !== prev && seen.has(g)) assert.fail(`paramGroup '${g}' split`);
    seen.add(g); prev = g;
  }
});

test('setModulatedValues / resize / cleanup do not throw', () => {
  const f = new ChromaticAberrationFilter(10, 10);
  f.setModulatedValues({ amount: 0.03 });
  f.resize(20, 20);
  f.cleanup();
  assert.strictEqual(f.isActive(), false);
});

console.log(`\n${passed} passed`);
