/**
 * Skyline layout — pure-module tests (no WebGL).
 *
 *   node layers/skyline/lib/layout.test.js
 *
 * Covers the seeded generator's two load-bearing properties: it is
 * deterministic (same seed → identical city), and the classic layout is
 * frozen — relocating the palette to the style descriptor (workstream G)
 * must not move a single building. The golden digest below was captured
 * from the layer's `main` state before the style-seam refactor.
 */

import assert from 'node:assert';
import { mulberry32, generateLayout, pickColor } from './layout.js';
import { CONTEMPORARY } from './style.js';

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
    process.exitCode = 1;
  }
}

const CLASSIC_PARAMS = {
  density: 11, maxHeight: 20, footprintVariety: 0.35,
  allowEll: true, allowCylinder: true
};

// Same checksum formula used to capture the golden value, so the test
// reduces the whole building list to one number that moves if anything does.
function layoutChecksum(buildings) {
  let sum = 0;
  for (const b of buildings) {
    sum += b.x * 1.1 + b.z * 2.3 + b.h * 3.7 + b.w * 5.1 +
           b.d * 7.3 + b.rot * 11.0 + b.roofRng * 13.0;
  }
  return +sum.toFixed(6);
}

console.log('Skyline layout');

test('generateLayout is deterministic for a fixed seed', () => {
  const a = generateLayout(mulberry32(1234), CLASSIC_PARAMS);
  const b = generateLayout(mulberry32(1234), CLASSIC_PARAMS);
  assert.strictEqual(a.buildings.length, b.buildings.length);
  assert.strictEqual(layoutChecksum(a.buildings), layoutChecksum(b.buildings));
});

test('different seeds produce different cities', () => {
  const a = generateLayout(mulberry32(1), CLASSIC_PARAMS);
  const b = generateLayout(mulberry32(2), CLASSIC_PARAMS);
  assert.notStrictEqual(layoutChecksum(a.buildings), layoutChecksum(b.buildings));
});

test('classic layout regression — seed 42 matches the pre-refactor golden', () => {
  const layout = generateLayout(mulberry32(42), CLASSIC_PARAMS);
  assert.strictEqual(layout.buildings.length, 172, 'building count');
  assert.strictEqual(layout.spacing, 2.8, 'spacing');
  assert.ok(Math.abs(layout.citySize[0] - 50.4) < 1e-9, 'citySize.x');
  assert.ok(Math.abs(layout.citySize[1] - 30.8) < 1e-9, 'citySize.z');
  assert.strictEqual(layoutChecksum(layout.buildings), 9097.844684, 'checksum');

  // Spot-check the first building and the tallest one (id 86) field-by-field.
  const b0 = layout.buildings[0];
  assert.strictEqual(b0.footprint.type, 'chop');
  assert.ok(Math.abs(b0.x - (-25.1727)) < 1e-3 && Math.abs(b0.h - 1.6585) < 1e-3);

  const tall = layout.buildings.find(b => b.id === 86);
  assert.ok(Math.abs(tall.h - 20.578) < 1e-3, 'tallest height');
  assert.ok(Math.abs(tall.x - 2.8561) < 1e-3 && Math.abs(tall.z - 1.5049) < 1e-3);
});

test('pickColor draws from the contemporary palette with brightness jitter', () => {
  // Brightness factor is 0.65..1.35; each channel must stay within the
  // palette's max channel scaled by that range.
  const maxChan = Math.max(...CONTEMPORARY.palettes.flat());
  for (let i = 0; i < 200; i++) {
    const c = pickColor(mulberry32(i * 7 + 1));
    assert.strictEqual(c.length, 3);
    for (const ch of c) {
      assert.ok(ch >= 0 && ch <= maxChan * 1.35 + 1e-9, `channel ${ch} in range`);
    }
  }
});

test('pickColor is deterministic for a fixed rng stream', () => {
  const c1 = pickColor(mulberry32(99));
  const c2 = pickColor(mulberry32(99));
  assert.deepStrictEqual(c1, c2);
});

console.log(`\n${passed} passed\n`);
