/**
 * echo filter — standalone runner tests (no framework).
 *
 *   node filters/echo/echo-filter.test.js
 *
 * The ring buffer + key pass need a DOM (offscreen canvases + getImageData),
 * which isn't available under plain node — so the filter degrades to a
 * passthrough here and these tests cover the parts that DON'T need canvases:
 * param clamping, the burst envelope, the `clear` reaction, blend-mode
 * mapping, the key math (smoothstep / bandKeep / colorKeep), the audio
 * markers, contiguous param grouping, the inert passthrough, and lifecycle
 * no-throws. The actual echo + key look is verified visually in a host.
 */

import assert from 'node:assert';
import EchoFilter, { clamp, blendToOp, smoothstep, bandKeep, colorKeep } from './echo-filter.js';

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

test('smoothstep clamps and eases', () => {
  assert.strictEqual(smoothstep(0, 1, -1), 0);
  assert.strictEqual(smoothstep(0, 1, 2), 1);
  assert.strictEqual(smoothstep(0, 1, 0.5), 0.5);
  assert.strictEqual(smoothstep(1, 1, 2), 1); // degenerate edge
});

test('bandKeep keeps inside a luma band, drops outside', () => {
  assert.ok(bandKeep(0.5, 0.2, 1, 0) > 0.99, 'mid band kept');
  assert.strictEqual(bandKeep(0.1, 0.2, 1, 0), 0, 'below low dropped');
  assert.strictEqual(bandKeep(0.5, 0.6, 0.4, 0), 0, 'inverted band keeps nothing');
});

test('colorKeep keeps near the key colour, drops far', () => {
  assert.ok(colorKeep(0, 255, 0, 0, 255, 0, 0.25, 0) > 0.99, 'exact match kept');
  assert.strictEqual(colorKeep(255, 0, 0, 0, 255, 0, 0.25, 0), 0, 'opposite colour dropped');
});

// ── construction (no DOM -> inert passthrough) ─────────────────────────────
test('constructs without a DOM and reports inactive', () => {
  const f = new EchoFilter(640, 480, { time: 150 });
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
test('delay-pedal params clamp + round; key params parse', () => {
  const f = new EchoFilter(10, 10);
  f.updateParams({ time: 9999, repeats: 99, level: 5, feedback: -1, direction: 'reverse' });
  assert.strictEqual(f._time, 500, 'time capped at 500');
  assert.strictEqual(f._repeats, 8, 'repeats capped at 8');
  assert.strictEqual(f._level, 1, 'level capped');
  assert.strictEqual(f._feedback, 0, 'feedback floored');
  assert.strictEqual(f._direction, 'reverse', 'direction enum applied');
  f.updateParams({ repeats: 2.6 });
  assert.strictEqual(f._repeats, 3, 'repeats rounds to nearest');

  f.updateParams({ key: 'color', keyColor: '#ff8000', keyTolerance: 9, keyInvert: true });
  assert.strictEqual(f._key, 'color', 'key enum applied');
  assert.deepStrictEqual(f._keyRGB, { r: 255, g: 128, b: 0 }, 'keyColor parsed to RGB');
  assert.strictEqual(f._keyTolerance, 1, 'keyTolerance clamped');
  assert.strictEqual(f._keyInvert, true, 'keyInvert applied');

  f.updateParams({ time: 'oops', blend: 'add', key: 'bogus' });
  assert.strictEqual(f._time, 500, 'non-number ignored');
  assert.strictEqual(f._op, blendToOp('add'), 'blend enum applied');
  assert.strictEqual(f._key, 'color', 'invalid key enum ignored');
});

// ── reactions ──────────────────────────────────────────────────────────────
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
  const audioBound = [
    'time', 'level', 'feedback', 'spread', 'spreadAngle', 'echoScale',
    'echoBlur', 'echoDesat', 'echoDim', 'hueStep', 'keyLow', 'keyHigh', 'keyTolerance'
  ];
  for (const name of audioBound) {
    assert.strictEqual(mod.params[name].modulation?.kind, 'audio', `${name} should be audio-bindable`);
  }
  // integer / enum / colour / structural params stay static.
  for (const name of ['repeats', 'direction', 'key', 'keyColor', 'keyInvert', 'keySoftness', 'blend', 'detail']) {
    assert.strictEqual(mod.params[name].modulation, undefined, `${name} should not be modulatable`);
  }
});

test('every param belongs to a contiguous paramGroup (no split sections)', async () => {
  const mod = await import('./echo-filter.js');
  // The harness renders one panel per contiguous run of a paramGroup. A group
  // that appears in two non-adjacent runs draws as two panels (the bug this
  // locks down) — and every param must carry a group so none floats loose.
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
  const f = new EchoFilter(10, 10);
  f.setModulatedValues({ level: 0.5 });
  f.resize(20, 20);
  f.cleanup();
  assert.strictEqual(f.isActive(), false);
});

console.log(`\n${passed} passed`);
