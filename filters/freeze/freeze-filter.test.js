/**
 * freeze filter — standalone runner tests (no framework).
 *
 *   node filters/freeze/freeze-filter.test.js
 *
 * The held-frame canvas needs a DOM, which isn't available under plain node —
 * so the filter degrades to a passthrough here and these tests cover the
 * DOM-independent logic: param clamping, the capture/release reaction state,
 * the auto-capture window timing, the audio markers, contiguous grouping, the
 * passthrough, and lifecycle no-throws. The held overlay is verified visually.
 */

import assert from 'node:assert';
import FreezeFilter, { clamp } from './freeze-filter.js';

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

// ── construction (no DOM -> inert passthrough) ─────────────────────────────
test('constructs without a DOM and reports inactive', () => {
  const f = new FreezeFilter(640, 480, { mode: 'manual' });
  assert.strictEqual(f.isActive(), false);
});

test('render is a safe passthrough when no DOM is available', () => {
  const f = new FreezeFilter(100, 100);
  const calls = [];
  const src = { width: 100, height: 100 };
  f.render(src, { drawImage: (...a) => calls.push(a) });
  assert.strictEqual(calls.length, 1);
  assert.deepStrictEqual(calls[0], [src, 0, 0, 100, 100]);
});

// ── param clamping ─────────────────────────────────────────────────────────
test('params clamp + round; enums validate', () => {
  const f = new FreezeFilter(10, 10);
  f.updateParams({ mode: 'slice', holdTime: 9999, dry: 5, wet: -1, fade: 'dissolve', fadeTime: 99999, sliceCount: 99, sliceAmount: -1, sliceAxis: 'vertical' });
  assert.strictEqual(f._mode, 'slice', 'mode enum applied');
  assert.strictEqual(f._holdTime, 2000, 'holdTime capped');
  assert.strictEqual(f._dry, 1, 'dry capped');
  assert.strictEqual(f._wet, 0, 'wet floored');
  assert.strictEqual(f._fade, 'dissolve', 'fade enum applied');
  assert.strictEqual(f._fadeTime, 5000, 'fadeTime capped');
  assert.strictEqual(f._sliceCount, 32, 'sliceCount capped');
  assert.strictEqual(f._sliceAmount, 0, 'sliceAmount floored');
  assert.strictEqual(f._sliceAxis, 'vertical', 'axis enum applied');
  f.updateParams({ sliceCount: 5.6, mode: 'bogus', fade: 'nope', sliceAxis: 'diagonal' });
  assert.strictEqual(f._sliceCount, 6, 'sliceCount rounds');
  assert.strictEqual(f._mode, 'slice', 'invalid mode ignored');
  assert.strictEqual(f._fade, 'dissolve', 'invalid fade ignored');
  assert.strictEqual(f._sliceAxis, 'vertical', 'invalid axis ignored');
});

test('fade off never progresses; manual fades over full fadeTime', () => {
  const f = new FreezeFilter(10, 10);
  f.updateParams({ mode: 'manual', fade: 'off', fadeTime: 1000 });
  assert.strictEqual(f._fadeProgress(9999), 0, 'off never progresses');
  f.updateParams({ fade: 'smooth' });
  assert.strictEqual(f._fadeProgress(0), 0, 'just captured');
  assert.strictEqual(f._fadeProgress(500), 0.5, 'halfway through the full fadeTime');
  assert.strictEqual(f._fadeProgress(5000), 1, 'clamped at fully departed');
});

test('auto modes cap the fade to the hold window (the stutter-masking fix)', () => {
  const f = new FreezeFilter(10, 10);
  // fadeTime 1000 >> holdTime 150: in manual it would barely fade per window;
  // capped to holdTime it fully fades within each grab.
  f.updateParams({ mode: 'stutter', fade: 'smooth', holdTime: 150, fadeTime: 1000 });
  assert.strictEqual(f._fadeProgress(75), 0.5, 'half a hold window -> half faded');
  assert.strictEqual(f._fadeProgress(150), 1, 'one hold window -> fully faded');
});

// ── reactions (capture / release) ──────────────────────────────────────────
test('capture requests a grab + freezes; release unfreezes; unknown throws', () => {
  const f = new FreezeFilter(10, 10);
  assert.strictEqual(f._frozen, false, 'starts live');
  f.react('capture');
  assert.strictEqual(f._captureRequested, true, 'capture queues a grab');
  assert.strictEqual(f._frozen, true, 'capture freezes (manual)');
  f.react('release');
  assert.strictEqual(f._frozen, false, 'release unfreezes');
  assert.throws(() => f.react('bogus'), /unknown reaction/);
});

// ── auto-capture window timing ──────────────────────────────────────────────
test('auto modes are due for capture once the hold window elapses', () => {
  const f = new FreezeFilter(10, 10);
  f.updateParams({ mode: 'manual' });
  assert.strictEqual(f._dueForCapture(1e9), false, 'manual never auto-captures');

  f.updateParams({ mode: 'stutter', holdTime: 100 });
  f._holdStart = 1000;
  assert.strictEqual(f._dueForCapture(1050), false, 'within the window: not due');
  assert.strictEqual(f._dueForCapture(1100), true, 'window elapsed: due');

  f.updateParams({ mode: 'slice' });
  assert.strictEqual(f._dueForCapture(1100), true, 'slice auto-captures too');
});

// ── audio binding markers ──────────────────────────────────────────────────
test('continuous attributes are audio-bindable; structural ones are not', async () => {
  const mod = await import('./freeze-filter.js');
  for (const name of ['holdTime', 'dry', 'wet', 'fadeTime', 'flickerRate', 'sliceAmount']) {
    assert.strictEqual(mod.params[name].modulation?.kind, 'audio', `${name} should be audio-bindable`);
  }
  for (const name of ['mode', 'fade', 'sliceCount', 'sliceAxis']) {
    assert.strictEqual(mod.params[name].modulation, undefined, `${name} should not be modulatable`);
  }
});

test('every param belongs to a contiguous paramGroup (no split sections)', async () => {
  const mod = await import('./freeze-filter.js');
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
  const f = new FreezeFilter(10, 10);
  f.setModulatedValues({ dry: 0.5 });
  f.resize(20, 20);
  f.cleanup();
  assert.strictEqual(f.isActive(), false);
});

console.log(`\n${passed} passed`);
