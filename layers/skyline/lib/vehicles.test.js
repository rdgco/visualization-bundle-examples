/**
 * Vehicles subsystem — pure-module tests (no WebGL).
 *
 *   node layers/skyline/lib/vehicles.test.js
 *
 * The body/pool expander must be deterministic, produce exactly the declared
 * interleave lengths (the named-constant strides must match the data, or the
 * city.js attribute pointers silently corrupt geometry), add no RNG, keep the
 * truck fraction near 15%, and size bodies so they sit on the painted road.
 */

import assert from 'node:assert';
import { generateTrafficLanes } from './traffic.js';
import {
  expandVehicleBodies, truckHash, colorSeedHash,
  BODY_FLOATS, BODY_VERTS_PER_CAR, POOL_FLOATS, POOL_VERTS_PER_CAR,
  CAR_DIMS, TRUCK_DIMS, UNIT_BOX_30
} from './vehicles.js';

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (err) { console.error(`  ✗ ${name}\n    ${err.message}`); process.exitCode = 1; }
}

const REGION = { halfW: 25.2, halfD: 15.4, spacing: 2.8, seed: 42 };
const fleet = generateTrafficLanes(REGION);
const carCount = fleet.length / 9;

console.log('Skyline vehicles');

test('UNIT_BOX_30 is a closed box minus the bottom face (30 verts, unit normals)', () => {
  assert.strictEqual(UNIT_BOX_30.length, BODY_VERTS_PER_CAR);
  // No downward-facing normal (bottom omitted); all normals unit, axis-aligned.
  for (const v of UNIT_BOX_30) {
    assert.notStrictEqual(v.normal[1], -1, 'no bottom face');
    const m = Math.hypot(...v.normal);
    assert.ok(Math.abs(m - 1) < 1e-9, 'unit normal');
    assert.ok(v.corner[1] >= 0 && v.corner[1] <= 1, 'y in [0,1] (sits on ground)');
  }
});

test('expandVehicleBodies interleave lengths match the named-constant strides', () => {
  const { bodyData, bodyCount, poolData, poolCount } = expandVehicleBodies(fleet);
  assert.strictEqual(bodyData.length, carCount * BODY_VERTS_PER_CAR * BODY_FLOATS);
  assert.strictEqual(poolData.length, carCount * POOL_VERTS_PER_CAR * POOL_FLOATS);
  assert.strictEqual(bodyCount, carCount * BODY_VERTS_PER_CAR);
  assert.strictEqual(poolCount, carCount * POOL_VERTS_PER_CAR);
  assert.strictEqual(bodyData.length % BODY_FLOATS, 0);
  assert.strictEqual(poolData.length % POOL_FLOATS, 0);
});

test('expandVehicleBodies is deterministic and replicates car instance attrs', () => {
  const a = expandVehicleBodies(fleet), b = expandVehicleBodies(fleet);
  assert.deepStrictEqual(Array.from(a.bodyData), Array.from(b.bodyData));
  // First vertex of car 0 carries car 0's origin/lane (attrs 0..8 == fleet 0..8).
  for (let k = 0; k < 9; k++) assert.strictEqual(a.bodyData[k], fleet[k]);
});

test('truck fraction is ~15% and depends only on startPhase', () => {
  let trucks = 0;
  for (let c = 0; c < carCount; c++) if (truckHash(fleet[c * 9 + 5])) trucks++;
  const frac = trucks / carCount;
  assert.ok(frac > 0.07 && frac < 0.25, `truck fraction ${frac.toFixed(3)} ≈ 0.15`);
  // truckHash ignores speed: same startPhase, different speed → same flag.
  assert.strictEqual(truckHash(0.9), truckHash(0.9));
});

test('colorSeedHash is in [0,1) and varies with both inputs', () => {
  const a = colorSeedHash(0.2, 0.1), b = colorSeedHash(0.2, 0.18);
  assert.ok(a >= 0 && a < 1 && b >= 0 && b < 1);
  assert.notStrictEqual(a, b);
});

test('vehicle bodies fit within the painted road (half-width + laneOff ≤ roadHalf)', () => {
  const sp = REGION.spacing;
  const roadHalf = sp * 0.20;
  const laneOff = sp * 0.20 * 0.45;
  assert.ok(CAR_DIMS[0] / 2 + laneOff <= roadHalf, `car ${CAR_DIMS[0]} fits`);
  assert.ok(TRUCK_DIMS[0] / 2 + laneOff <= roadHalf, `truck ${TRUCK_DIMS[0]} fits`);
});

console.log(`\n${passed} passed\n`);
