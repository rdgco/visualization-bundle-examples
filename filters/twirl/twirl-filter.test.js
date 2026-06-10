/**
 * twirl filter — standalone runner tests (no framework).
 *
 *   node filters/twirl/twirl-filter.test.js
 *
 * The polar warp needs a WebGL context (absent under plain node), so the filter
 * degrades to a passthrough here; these tests cover the GL-independent logic:
 * param clamping (incl. signed strength), the mode mapping, the pulse envelope,
 * audio markers, contiguous grouping, the passthrough, and lifecycle no-throws.
 * The warp itself is verified visually in a host.
 */

import assert from 'node:assert';
import TwirlFilter, { clamp, modeToInt } from './twirl-filter.js';

let passed = 0;
function test(name, fn) { fn(); passed++; console.log(`✓ ${name}`); }

test('clamp bounds values', () => {
  assert.strictEqual(clamp(9, -1, 1), 1);
  assert.strictEqual(clamp(-9, -1, 1), -1);
  assert.strictEqual(clamp(0.4, -1, 1), 0.4);
});

test('modeToInt maps modes and defaults to twirl', () => {
  assert.strictEqual(modeToInt('twirl'), 0);
  assert.strictEqual(modeToInt('pinch'), 1);
  assert.strictEqual(modeToInt('fisheye'), 2);
  assert.strictEqual(modeToInt('nonsense'), 0);
});

test('constructs without a DOM and reports inactive', () => {
  const f = new TwirlFilter(640, 480, { mode: 'pinch' });
  assert.strictEqual(f.isActive(), false);
});

test('render is a safe passthrough when WebGL is unavailable', () => {
  const f = new TwirlFilter(100, 100);
  const calls = [];
  const src = { width: 100, height: 100 };
  f.render(src, { drawImage: (...a) => calls.push(a) });
  assert.strictEqual(calls.length, 1);
  assert.deepStrictEqual(calls[0], [src, 0, 0, 100, 100]);
});

test('params clamp into range; signed strength + garbage handled', () => {
  const f = new TwirlFilter(10, 10);
  f.updateParams({ mode: 'fisheye', strength: 9, radius: 99, centerX: 5, centerY: -5 });
  assert.strictEqual(f._mode, modeToInt('fisheye'), 'mode applied');
  assert.strictEqual(f._strength, 1, 'strength capped at +1');
  assert.strictEqual(f._radius, 1.5, 'radius capped');
  assert.strictEqual(f._centerX, 1, 'centerX capped');
  assert.strictEqual(f._centerY, 0, 'centerY floored');
  f.updateParams({ strength: -9 });
  assert.strictEqual(f._strength, -1, 'strength clamps at -1 (signed)');
  f.updateParams({ mode: 'bogus', strength: 'oops' });
  assert.strictEqual(f._mode, modeToInt('fisheye'), 'invalid mode ignored');
  assert.strictEqual(f._strength, -1, 'non-number ignored');
});

test('pulse arms a decaying envelope; unknown reaction throws', () => {
  const f = new TwirlFilter(10, 10);
  assert.strictEqual(f._pulseAmount(), 0, 'idle');
  f.react('pulse', { strength: 1 });
  assert.ok(f._pulseAmount() > 0.9, 'near peak');
  f.react('pulse', { strength: 0.5 });
  assert.ok(f._pulseAmount() <= 0.5 + 1e-6, 'strength scales');
  assert.throws(() => f.react('bogus'), /unknown reaction/);
});

test('numeric attributes are audio-bindable; the enum is not', async () => {
  const mod = await import('./twirl-filter.js');
  for (const name of ['strength', 'radius', 'centerX', 'centerY']) {
    assert.strictEqual(mod.params[name].modulation?.kind, 'audio', `${name} should be audio-bindable`);
  }
  assert.strictEqual(mod.params.mode.modulation, undefined, 'mode not modulatable');
});

test('every param belongs to a contiguous paramGroup', async () => {
  const mod = await import('./twirl-filter.js');
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
  const f = new TwirlFilter(10, 10);
  f.setModulatedValues({ strength: -0.3 });
  f.resize(20, 20);
  f.cleanup();
  assert.strictEqual(f.isActive(), false);
});

console.log(`\n${passed} passed`);
