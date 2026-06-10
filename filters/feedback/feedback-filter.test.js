/**
 * feedback filter — standalone runner tests (no framework).
 *
 *   node filters/feedback/feedback-filter.test.js
 *
 * The GPU pipeline needs a real WebGL context, which isn't available under
 * plain node — so the bridge degrades to null here and these tests cover the
 * parts that DON'T need GL: param clamping, the pulse reaction envelope, the
 * blend-mode mapping, the inert passthrough, and lifecycle no-throws. The
 * actual feedback look is verified visually in a host (see README).
 */

import assert from 'node:assert';
import FeedbackFilter, { clamp, blendToInt } from './feedback-filter.js';

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log(`✓ ${name}`);
}

// ── pure helpers ──────────────────────────────────────────────────────────
test('clamp bounds values', () => {
  assert.strictEqual(clamp(5, 0, 1), 1);
  assert.strictEqual(clamp(-5, 0, 1), 0);
  assert.strictEqual(clamp(0.5, 0, 1), 0.5);
});

test('blendToInt maps modes and defaults to screen', () => {
  assert.strictEqual(blendToInt('add'), 0);
  assert.strictEqual(blendToInt('screen'), 1);
  assert.strictEqual(blendToInt('over'), 2);
  assert.strictEqual(blendToInt('nonsense'), 1);
});

// ── construction (no DOM -> inert) ─────────────────────────────────────────
test('constructs without a DOM and reports inactive', () => {
  const f = new FeedbackFilter(640, 480, { trailPersistence: 0.8 });
  assert.strictEqual(f.isActive(), false, 'no WebGL under node -> inactive');
});

test('render is a safe passthrough when WebGL is unavailable', () => {
  const f = new FeedbackFilter(100, 100);
  const calls = [];
  const fakeSource = { width: 100, height: 100 };
  const fakeCtx = { drawImage: (...a) => calls.push(a) };
  f.render(fakeSource, fakeCtx);
  assert.strictEqual(calls.length, 1, 'passthrough draws the source once');
  assert.deepStrictEqual(calls[0], [fakeSource, 0, 0, 100, 100]);
});

// ── param clamping ─────────────────────────────────────────────────────────
test('params clamp into range and ignore garbage', () => {
  const f = new FeedbackFilter(10, 10);
  f.updateParams({ trailPersistence: 9, sourceGain: -3, feedbackZoom: 99 });
  assert.strictEqual(f._persistence, 0.99, 'persistence capped at 0.99');
  assert.strictEqual(f._sourceGain, 0, 'gain floored at 0');
  assert.strictEqual(f._zoom, 1.5, 'zoom capped at 1.5');
  f.updateParams({ trailPersistence: 'oops', blend: 'add' });
  assert.strictEqual(f._persistence, 0.99, 'non-number ignored');
  assert.strictEqual(f._blend, blendToInt('add'), 'blend enum applied');
});

test('degree params convert to radians per second', () => {
  const f = new FeedbackFilter(10, 10);
  f.updateParams({ feedbackRotate: 90, hueDrift: 180 });
  assert.ok(Math.abs(f._rotateRadPerSec - Math.PI / 2) < 1e-9);
  assert.ok(Math.abs(f._hueRadPerSec - Math.PI) < 1e-9);
});

// ── pulse reaction envelope ────────────────────────────────────────────────
test('pulse arms a decaying envelope; unknown reaction throws', () => {
  const f = new FeedbackFilter(10, 10);
  assert.strictEqual(f._pulseAmount(), 0, 'idle before any pulse');
  f.react('pulse', { strength: 1 });
  assert.ok(f._pulseAmount() > 0.9, 'near peak right after firing');
  f.react('pulse', { strength: 0.5 });
  assert.ok(f._pulseAmount() <= 0.5 + 1e-6, 'strength scales the peak');
  assert.throws(() => f.react('bogus'), /unknown reaction/);
});

// ── reverse reaction (spin direction) ──────────────────────────────────────
test('reverse toggles spin sign and honours forced modes', () => {
  const f = new FeedbackFilter(10, 10);
  assert.strictEqual(f._spinSign, 1, 'forward by default');
  f.react('reverse');
  assert.strictEqual(f._spinSign, -1, 'toggle flips');
  f.react('reverse');
  assert.strictEqual(f._spinSign, 1, 'toggle flips back');
  f.react('reverse', { mode: 'reverse' });
  assert.strictEqual(f._spinSign, -1, 'forced reverse');
  f.react('reverse', { mode: 'reverse' });
  assert.strictEqual(f._spinSign, -1, 'forced reverse is idempotent');
  f.react('reverse', { mode: 'forward' });
  assert.strictEqual(f._spinSign, 1, 'forced forward');
});

test('every numeric param is audio-bindable (kind: audio marker)', async () => {
  const mod = await import('./feedback-filter.js');
  const numeric = Object.entries(mod.params).filter(([, s]) => s.type === 'number');
  assert.ok(numeric.length >= 7, 'expected the full numeric attribute set');
  for (const [name, spec] of numeric) {
    assert.strictEqual(spec.modulation?.kind, 'audio', `${name} missing audio marker`);
    assert.ok(
      Array.isArray(spec.modulation.sourceTypes) && spec.modulation.sourceTypes.includes('audio'),
      `${name} missing audio sourceType`
    );
  }
});

// ── lifecycle no-throws ────────────────────────────────────────────────────
test('setModulatedValues / resize / cleanup do not throw', () => {
  const f = new FeedbackFilter(10, 10);
  f.setModulatedValues({ trailPersistence: 0.5 });
  f.resize(20, 20);
  f.cleanup();
  assert.strictEqual(f.isActive(), false);
});

console.log(`\n${passed} passed`);
