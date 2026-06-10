/**
 * echo filter — standalone runner tests (no framework).
 *
 *   node filters/echo/echo-filter.test.js
 *
 * The ring buffer needs a DOM (offscreen canvases), which isn't available
 * under plain node — so the filter degrades to a passthrough here and these
 * tests cover the parts that DON'T need canvases: param clamping, the burst
 * envelope, the `clear` reaction, blend-mode mapping, the audio markers, the
 * inert passthrough, and lifecycle no-throws. The actual echo look is verified
 * visually in a host (see README).
 */

import assert from 'node:assert';
import EchoFilter, { clamp, blendToOp } from './echo-filter.js';

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log(`✓ ${name}`);
}

// ── pure helpers ──────────────────────────────────────────────────────────
test('clamp bounds values', () => {
  assert.strictEqual(clamp(9, 0, 1), 1);
  assert.strictEqual(clamp(-9, 0, 1), 0);
  assert.strictEqual(clamp(0.4, 0, 1), 0.4);
});

test('blendToOp maps modes to canvas composite ops, defaults to screen', () => {
  assert.strictEqual(blendToOp('add'), 'lighter');
  assert.strictEqual(blendToOp('screen'), 'screen');
  assert.strictEqual(blendToOp('over'), 'source-over');
  assert.strictEqual(blendToOp('nonsense'), 'screen');
});

// ── construction (no DOM -> inert passthrough) ─────────────────────────────
test('constructs without a DOM and reports inactive', () => {
  const f = new EchoFilter(640, 480, { delay: 150 });
  assert.strictEqual(f.isActive(), false);
});

test('render is a safe passthrough when no DOM ring is available', () => {
  const f = new EchoFilter(100, 100);
  const calls = [];
  const src = { width: 100, height: 100 };
  f.render(src, { drawImage: (...a) => calls.push(a) });
  assert.strictEqual(calls.length, 1);
  assert.deepStrictEqual(calls[0], [src, 0, 0, 100, 100]);
});

// ── param clamping ─────────────────────────────────────────────────────────
test('params clamp into range, round taps, ignore garbage', () => {
  const f = new EchoFilter(10, 10);
  f.updateParams({ delay: 9999, taps: 2.6, echoLevel: 5, falloff: -1, detail: 9 });
  assert.strictEqual(f._delay, 500, 'delay capped at 500');
  assert.strictEqual(f._taps, 3, 'taps rounded + clamped');
  assert.strictEqual(f._echoLevel, 1, 'echoLevel capped');
  assert.strictEqual(f._falloff, 0, 'falloff floored');
  assert.strictEqual(f._detail, 1, 'detail capped');
  f.updateParams({ delay: 'oops', blend: 'add' });
  assert.strictEqual(f._delay, 500, 'non-number ignored');
  assert.strictEqual(f._op, blendToOp('add'), 'blend enum applied');
});

// ── burst reaction envelope ────────────────────────────────────────────────
test('burst arms a decaying envelope; strength scales the peak', () => {
  const f = new EchoFilter(10, 10);
  assert.strictEqual(f._burstAmount(), 0, 'idle before any burst');
  f.react('burst', { strength: 1 });
  assert.ok(f._burstAmount() > 0.9, 'near peak right after firing');
  f.react('burst', { strength: 0.5 });
  assert.ok(f._burstAmount() <= 0.5 + 1e-6, 'strength scales the peak');
});

test('clear is a no-throw state reset; unknown reaction throws', () => {
  const f = new EchoFilter(10, 10);
  f.react('clear'); // no ring in node — must be a safe no-op
  assert.throws(() => f.react('bogus'), /unknown reaction/);
});

// ── audio binding markers ──────────────────────────────────────────────────
test('continuous attributes are audio-bindable; structural ones are not', async () => {
  const mod = await import('./echo-filter.js');
  const audioBound = ['delay', 'echoLevel', 'falloff', 'offsetX', 'offsetY', 'hueStep'];
  for (const name of audioBound) {
    assert.strictEqual(mod.params[name].modulation?.kind, 'audio', `${name} should be audio-bindable`);
  }
  // taps + detail reallocate / are integer-structural -> deliberately static.
  assert.strictEqual(mod.params.taps.modulation, undefined, 'taps not modulatable');
  assert.strictEqual(mod.params.detail.modulation, undefined, 'detail not modulatable');
});

// ── lifecycle no-throws ────────────────────────────────────────────────────
test('setModulatedValues / resize / cleanup do not throw', () => {
  const f = new EchoFilter(10, 10);
  f.setModulatedValues({ echoLevel: 0.5 });
  f.resize(20, 20);
  f.cleanup();
  assert.strictEqual(f.isActive(), false);
});

console.log(`\n${passed} passed`);
