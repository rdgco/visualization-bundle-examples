/**
 * Traffic subsystem — pure-module tests (no WebGL).
 *
 *   node layers/skyline/lib/traffic.test.js
 *
 * The car motion lives in the vertex shader, so what's testable here is the
 * lane/car *data*: deterministic generation, well-formed instances, lanes
 * that span the region, and road-centre alignment. Determinism is the load-
 * bearing property — endless mode calls this per tile and relies on the same
 * region + seed yielding the same fleet every time.
 */

import assert from 'node:assert';
import { generateTrafficLanes, roadCentres, CAR_FLOATS } from './traffic.js';

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

const REGION = { halfW: 25.2, halfD: 15.4, spacing: 2.8, seed: 42 };

console.log('Skyline traffic subsystem');

test('roadCentres are spaced by `spacing` and offset half a cell off the grid', () => {
  const cs = roadCentres(25.2, 2.8);
  assert.ok(cs.length > 0);
  for (const c of cs) {
    // road centres satisfy mod(c, sp) == sp/2 (half a cell off building lines)
    const m = ((c % 2.8) + 2.8) % 2.8;
    assert.ok(Math.abs(m - 1.4) < 1e-6, `centre ${c} is half a cell off`);
    assert.ok(Math.abs(c) <= 25.2 + 1e-6, 'within region');
  }
  for (let i = 1; i < cs.length; i++) {
    assert.ok(Math.abs((cs[i] - cs[i - 1]) - 2.8) < 1e-6, 'evenly spaced');
  }
});

test('generateTrafficLanes returns a flat CAR_FLOATS-stride buffer', () => {
  const buf = generateTrafficLanes(REGION);
  assert.ok(buf instanceof Float32Array);
  assert.strictEqual(buf.length % CAR_FLOATS, 0, 'whole number of cars');
  assert.ok(buf.length > 0, 'some cars');
});

test('is deterministic for a fixed region + seed', () => {
  const a = generateTrafficLanes(REGION);
  const b = generateTrafficLanes(REGION);
  assert.deepStrictEqual(Array.from(a), Array.from(b));
});

test('different seeds produce different fleets', () => {
  const a = generateTrafficLanes(REGION);
  const b = generateTrafficLanes({ ...REGION, seed: 43 });
  assert.notDeepStrictEqual(Array.from(a), Array.from(b));
});

test('every car is well-formed: unit axis-aligned lane, phase/vis in 0..1, valid color flag', () => {
  const buf = generateTrafficLanes(REGION);
  for (let i = 0; i < buf.length; i += CAR_FLOATS) {
    const dirX = buf[i + 2], dirZ = buf[i + 3], len = buf[i + 4], phase = buf[i + 5];
    const speed = buf[i + 6], colorFlag = buf[i + 7], vis = buf[i + 8];
    // exactly one axis is the travel direction (±1), the other 0
    assert.ok((Math.abs(dirX) === 1 && dirZ === 0) || (dirX === 0 && Math.abs(dirZ) === 1),
      'axis-aligned unit direction');
    assert.ok(len > 0, 'positive lane length');
    assert.ok(phase >= 0 && phase < 1, 'phase in [0,1)');
    assert.ok(vis >= 0 && vis < 1, 'vis threshold in [0,1)');
    assert.ok(speed > 0, 'positive speed');
    assert.ok(colorFlag === 0 || colorFlag === 1, 'head/tail flag');
  }
});

test('car count scales with carsPerRoad', () => {
  const few = generateTrafficLanes({ ...REGION, carsPerRoad: 2 });
  const many = generateTrafficLanes({ ...REGION, carsPerRoad: 8 });
  assert.ok(many.length === few.length * 4, '8 vs 2 cars per road → 4x');
});

console.log(`\n${passed} passed\n`);
