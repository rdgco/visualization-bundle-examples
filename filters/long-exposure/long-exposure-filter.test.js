/**
 * long-exposure filter — standalone runner tests (no framework).
 *
 *   node filters/long-exposure/long-exposure-filter.test.js
 *
 * The accumulation buffer needs a DOM, which isn't available under plain node —
 * so the filter degrades to a passthrough here and these tests cover the
 * DOM-independent logic: param clamping, the decay retain math, the blend
 * mapping, the clear/pulse reactions, the audio markers, contiguous grouping,
 * the passthrough, and lifecycle no-throws. The painted trails are verified
 * visually in a host (best over video).
 */

import assert from 'node:assert';
import LongExposureFilter, { clamp, accumulateToOp, retainFactor } from './long-exposure-filter.js';

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

test('accumulateToOp maps modes to composite ops, defaults to lighten', () => {
  assert.strictEqual(accumulateToOp('lighten'), 'lighten');
  assert.strictEqual(accumulateToOp('add'), 'lighter');
  assert.strictEqual(accumulateToOp('screen'), 'screen');
  assert.strictEqual(accumulateToOp('nonsense'), 'lighten');
});

test('retainFactor: 0 decayTime = infinite (retain 1); half-life halves', () => {
  assert.strictEqual(retainFactor(0, 0.016), 1, 'decayTime 0 -> never fades');
  assert.strictEqual(retainFactor(2, 2), 0.5, 'one half-life -> half retained');
  assert.ok(Math.abs(retainFactor(2, 4) - 0.25) < 1e-9, 'two half-lives -> quarter');
  assert.ok(retainFactor(5, 0.016) > 0.99, 'a single frame at 5s half-life barely fades');
});

// ── construction (no DOM -> inert passthrough) ─────────────────────────────
test('constructs without a DOM and reports inactive', () => {
  const f = new LongExposureFilter(640, 480, { decayTime: 3 });
  assert.strictEqual(f.isActive(), false);
});

test('render is a safe passthrough when no DOM is available', () => {
  const f = new LongExposureFilter(100, 100);
  const calls = [];
  const src = { width: 100, height: 100 };
  f.render(src, { drawImage: (...a) => calls.push(a) });
  assert.strictEqual(calls.length, 1);
  assert.deepStrictEqual(calls[0], [src, 0, 0, 100, 100]);
});

// ── param clamping ─────────────────────────────────────────────────────────
test('params clamp into range; enum + garbage handled', () => {
  const f = new LongExposureFilter(10, 10);
  f.updateParams({ accumulate: 'add', decayTime: 999, sourceGain: 99, mix: 5, hueDrift: 999 });
  assert.strictEqual(f._accOp, accumulateToOp('add'), 'accumulate enum applied');
  assert.strictEqual(f._decayTime, 30, 'decayTime capped');
  assert.strictEqual(f._sourceGain, 3, 'sourceGain capped');
  assert.strictEqual(f._mix, 1, 'mix capped');
  assert.strictEqual(f._hueDrift, 180, 'hueDrift capped');
  f.updateParams({ accumulate: 'bogus', decayTime: 'oops' });
  assert.strictEqual(f._accOp, accumulateToOp('add'), 'invalid enum ignored');
  assert.strictEqual(f._decayTime, 30, 'non-number ignored');
});

// ── reactions ──────────────────────────────────────────────────────────────
test('clear requests a reset; pulse arms a decaying envelope; unknown throws', () => {
  const f = new LongExposureFilter(10, 10);
  assert.strictEqual(f._clearRequested, false, 'no reset pending');
  f.react('clear');
  assert.strictEqual(f._clearRequested, true, 'clear queues a reset');
  assert.strictEqual(f._pulseAmount(), 0, 'idle before any pulse');
  f.react('pulse', { strength: 1 });
  assert.ok(f._pulseAmount() > 0.9, 'near peak right after firing');
  f.react('pulse', { strength: 0.5 });
  assert.ok(f._pulseAmount() <= 0.5 + 1e-6, 'strength scales the peak');
  assert.throws(() => f.react('bogus'), /unknown reaction/);
});

// ── audio binding markers ──────────────────────────────────────────────────
test('continuous attributes are audio-bindable; the enum is not', async () => {
  const mod = await import('./long-exposure-filter.js');
  for (const name of ['decayTime', 'sourceGain', 'mix', 'hueDrift']) {
    assert.strictEqual(mod.params[name].modulation?.kind, 'audio', `${name} should be audio-bindable`);
  }
  assert.strictEqual(mod.params.accumulate.modulation, undefined, 'accumulate enum not modulatable');
});

test('every param belongs to a contiguous paramGroup (no split sections)', async () => {
  const mod = await import('./long-exposure-filter.js');
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
  const f = new LongExposureFilter(10, 10);
  f.setModulatedValues({ decayTime: 2 });
  f.resize(20, 20);
  f.cleanup();
  assert.strictEqual(f.isActive(), false);
});

console.log(`\n${passed} passed`);
