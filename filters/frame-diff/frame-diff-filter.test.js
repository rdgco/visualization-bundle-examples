/**
 * frame-diff filter — standalone runner tests (no framework).
 *
 *   node filters/frame-diff/frame-diff-filter.test.js
 *
 * The per-pixel diff needs a DOM (canvas + getImageData), which isn't available
 * under plain node — so the filter degrades to a passthrough here and these
 * tests cover the DOM-independent logic: param clamping, the motion math, the
 * pulse/clear reactions, the audio markers, contiguous grouping, the
 * passthrough, and lifecycle no-throws. The detected motion is verified
 * visually in a host.
 */

import assert from 'node:assert';
import FrameDiffFilter, { clamp, motionAmount } from './frame-diff-filter.js';

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

test('motionAmount applies threshold then gain, clamped 0..1', () => {
  assert.strictEqual(motionAmount(0.05, 0.1, 2), 0, 'below threshold -> 0');
  assert.strictEqual(motionAmount(0.6, 0.1, 2), 1, 'strong motion clamps to 1');
  assert.ok(Math.abs(motionAmount(0.3, 0.1, 2) - 0.4) < 1e-9, '(0.3-0.1)*2 = 0.4');
});

// ── construction (no DOM -> inert passthrough) ─────────────────────────────
test('constructs without a DOM and reports inactive', () => {
  const f = new FrameDiffFilter(640, 480, { mode: 'reveal' });
  assert.strictEqual(f.isActive(), false);
});

test('render is a safe passthrough when no DOM is available', () => {
  const f = new FrameDiffFilter(100, 100);
  const calls = [];
  const src = { width: 100, height: 100 };
  f.render(src, { drawImage: (...a) => calls.push(a) });
  assert.strictEqual(calls.length, 1);
  assert.deepStrictEqual(calls[0], [src, 0, 0, 100, 100]);
});

// ── param clamping ─────────────────────────────────────────────────────────
test('params clamp into range; enums + colour + garbage handled', () => {
  const f = new FrameDiffFilter(10, 10);
  f.updateParams({ mode: 'mask', sensitivity: 99, threshold: 5, detail: 9, trail: 5, colorMode: 'source', motionColor: '#ff8000', glow: 9, glowSize: 99 });
  assert.strictEqual(f._mode, 'mask', 'mode enum applied');
  assert.strictEqual(f._sensitivity, 8, 'sensitivity capped');
  assert.strictEqual(f._threshold, 1, 'threshold capped');
  assert.strictEqual(f._detail, 1, 'detail capped');
  assert.strictEqual(f._trail, 0.97, 'trail capped');
  assert.strictEqual(f._colorMode, 'source', 'colorMode enum applied');
  assert.deepStrictEqual(f._motionRGB, { r: 255, g: 128, b: 0 }, 'motionColor parsed');
  assert.strictEqual(f._glow, 1, 'glow capped');
  assert.strictEqual(f._glowSize, 40, 'glowSize capped');
  f.updateParams({ mode: 'bogus', colorMode: 'nope' });
  assert.strictEqual(f._mode, 'mask', 'invalid mode ignored');
  assert.strictEqual(f._colorMode, 'source', 'invalid colorMode ignored');
});

// ── reactions ──────────────────────────────────────────────────────────────
test('pulse arms a decaying flare; clear queues a reset; unknown throws', () => {
  const f = new FrameDiffFilter(10, 10);
  assert.strictEqual(f._pulse, 0, 'idle');
  f.react('pulse', { strength: 0.9, duration: 1.5 });
  assert.strictEqual(f._pulse, 0.9, 'pulse set to strength');
  assert.strictEqual(f._pulseDecay, 1.5, 'duration applied');
  assert.strictEqual(f._clearRequested, false, 'no reset pending');
  f.react('clear');
  assert.strictEqual(f._clearRequested, true, 'clear queues a reset');
  assert.throws(() => f.react('bogus'), /unknown reaction/);
});

// ── audio binding markers ──────────────────────────────────────────────────
test('continuous attributes are audio-bindable; enums/colour/structural are not', async () => {
  const mod = await import('./frame-diff-filter.js');
  for (const name of ['sensitivity', 'threshold', 'trail', 'backgroundOpacity', 'glow', 'glowSize']) {
    assert.strictEqual(mod.params[name].modulation?.kind, 'audio', `${name} should be audio-bindable`);
  }
  for (const name of ['mode', 'detail', 'colorMode', 'motionColor']) {
    assert.strictEqual(mod.params[name].modulation, undefined, `${name} should not be modulatable`);
  }
});

test('every param belongs to a contiguous paramGroup (no split sections)', async () => {
  const mod = await import('./frame-diff-filter.js');
  const seq = Object.values(mod.params).map(s => s.paramGroup);
  assert.ok(seq.every(Boolean), 'every param has a paramGroup');
  const seen = new Set();
  let prev = null;
  for (const g of seq) {
    if (g !== prev && seen.has(g)) assert.fail(`paramGroup '${g}' is split into non-adjacent runs`);
    seen.add(g);
    prev = g;
  }
});

// ── lifecycle no-throws ────────────────────────────────────────────────────
test('setModulatedValues / resize / cleanup do not throw', () => {
  const f = new FrameDiffFilter(10, 10);
  f.setModulatedValues({ sensitivity: 3 });
  f.resize(20, 20);
  f.cleanup();
  assert.strictEqual(f.isActive(), false);
});

console.log(`\n${passed} passed`);
