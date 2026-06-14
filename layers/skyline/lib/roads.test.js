/**
 * Roads subsystem — pure-module tests (no WebGL).
 *
 *   node layers/skyline/lib/roads.test.js
 *
 * Occupancy + road-graph derivation must be deterministic, must NOT perturb
 * the layout it reads, and the JS presence predicate must match the GLSL the
 * ground shader runs (uv = (cell+0.5)/grid, presence = r+g > 0.5). Those are
 * the properties the "no clipping / greenspace in the open" behaviour and
 * endless-tile seams rely on.
 */

import assert from 'node:assert';
import { mulberry32, generateLayout } from './layout.js';
import { roadCentres } from './traffic.js';
import {
  buildOccupancy, roadSegments, worldToCell, presentAt, occupiedAt,
  OCC_PAD, OCC_R, OCC_G
} from './roads.js';

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (err) { console.error(`  ✗ ${name}\n    ${err.message}`); process.exitCode = 1; }
}

const CLASSIC_PARAMS = { density: 11, maxHeight: 20, footprintVariety: 0.35, allowEll: true, allowCylinder: true };
const SPACING = 2.8;

function layoutChecksum(buildings) {
  let sum = 0;
  for (const b of buildings) {
    sum += b.x * 1.1 + b.z * 2.3 + b.h * 3.7 + b.w * 5.1 + b.d * 7.3 + b.rot * 11.0 + b.roofRng * 13.0;
  }
  return +sum.toFixed(6);
}

function makeOcc(seed = 42) {
  const layout = generateLayout(mulberry32(seed), CLASSIC_PARAMS);
  return { layout, occ: buildOccupancy({ buildings: layout.buildings, spacing: SPACING, citySize: layout.citySize }) };
}

console.log('Skyline roads / occupancy');

test('buildOccupancy is deterministic (same inputs → identical grid)', () => {
  const a = makeOcc(42).occ, b = makeOcc(42).occ;
  assert.strictEqual(a.cols, b.cols);
  assert.strictEqual(a.rows, b.rows);
  assert.deepStrictEqual(Array.from(a.grid), Array.from(b.grid));
});

test('buildOccupancy does not perturb the layout it reads (seed-42 golden holds)', () => {
  const layout = generateLayout(mulberry32(42), CLASSIC_PARAMS);
  const before = layoutChecksum(layout.buildings);
  const beforeCount = layout.buildings.length;
  buildOccupancy({ buildings: layout.buildings, spacing: SPACING, citySize: layout.citySize });
  assert.strictEqual(layout.buildings.length, beforeCount);
  assert.strictEqual(layoutChecksum(layout.buildings), before);
  assert.strictEqual(before, 9097.844684, 'matches the layout golden');
});

test('grid dimensions and origin follow citySize + pad', () => {
  const { layout, occ } = makeOcc(42);
  assert.strictEqual(occ.cols, Math.round(layout.citySize[0] / SPACING) + 2 * OCC_PAD);
  assert.strictEqual(occ.rows, Math.round(layout.citySize[1] / SPACING) + 2 * OCC_PAD);
  assert.ok(Math.abs(occ.originX - (-layout.citySize[0] / 2 - OCC_PAD * SPACING)) < 1e-9);
  assert.ok(Math.abs(occ.originZ - (-layout.citySize[1] / 2 - OCC_PAD * SPACING)) < 1e-9);
});

test('dilation marks the 8 neighbours of every occupied cell as present', () => {
  const { occ } = makeOcc(42);
  const { grid, cols, rows } = occ;
  let checkedOne = false;
  for (let iz = 0; iz < rows; iz++) {
    for (let ix = 0; ix < cols; ix++) {
      if (!occupiedAt(grid, cols, rows, ix, iz)) continue;
      checkedOne = true;
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = ix + dx, nz = iz + dz;
          if (nx < 0 || nz < 0 || nx >= cols || nz >= rows) continue;
          assert.strictEqual(presentAt(grid, cols, rows, nx, nz), 1, `neighbour (${nx},${nz}) present`);
        }
      }
    }
  }
  assert.ok(checkedOne, 'at least one occupied cell exists');
});

test('JS presence predicate matches the GLSL r+g>0.5 sampling for every cell', () => {
  const { occ } = makeOcc(7);
  const { grid, cols, rows } = occ;
  // Re-implement the shader's occPresent in JS over the same packed bytes.
  const glslPresent = (ix, iz) => {
    if (ix < 0 || iz < 0 || ix >= cols || iz >= rows) return 0;          // uv out of [0,1] → 0
    const i = (iz * cols + ix) * 4;
    return (grid[i + OCC_R] / 255 + grid[i + OCC_G] / 255) > 0.5 ? 1 : 0; // step(0.5, r+g)
  };
  for (let iz = -1; iz <= rows; iz++) {
    for (let ix = -1; ix <= cols; ix++) {
      assert.strictEqual(glslPresent(ix, iz), presentAt(grid, cols, rows, ix, iz), `cell (${ix},${iz})`);
    }
  }
});

test('out-of-grid presence is 0 (greenspace beyond the apron)', () => {
  const { occ } = makeOcc(42);
  const { grid, cols, rows } = occ;
  assert.strictEqual(presentAt(grid, cols, rows, -5, 0), 0);
  assert.strictEqual(presentAt(grid, cols, rows, cols + 5, 0), 0);
  assert.strictEqual(occupiedAt(grid, cols, rows, 0, rows + 3), 0);
});

test('roadSegments sit exactly on roadCentres lines, have positive length, and only where buildings border', () => {
  const { occ } = makeOcc(42);
  const { segments } = roadSegments(occ, SPACING);
  assert.ok(segments.length > 0, 'some roads survive');
  const xCentres = roadCentres(occ.halfW, SPACING);
  const zCentres = roadCentres(occ.halfD, SPACING);
  for (const s of segments) {
    assert.ok(s.length > 0, 'positive length');
    if (s.axis === 0) {
      assert.ok(xCentres.some(c => Math.abs(c - s.x0) < 1e-9), 'z-running on an x road centre');
    } else {
      assert.ok(zCentres.some(c => Math.abs(c - s.z0) < 1e-9), 'x-running on a z road centre');
    }
    // survival check: at least one flanking cell present along the line
    let bordered = false;
    if (s.axis === 0) {
      const [cix] = worldToCell(s.x0, 0, occ.originX, occ.originZ, SPACING);
      for (let iz = 0; iz < occ.rows && !bordered; iz++) {
        if (presentAt(occ.grid, occ.cols, occ.rows, cix, iz) || presentAt(occ.grid, occ.cols, occ.rows, cix + 1, iz)) bordered = true;
      }
    } else {
      const [, ciz] = worldToCell(0, s.z0, occ.originX, occ.originZ, SPACING);
      for (let ix = 0; ix < occ.cols && !bordered; ix++) {
        if (presentAt(occ.grid, occ.cols, occ.rows, ix, ciz) || presentAt(occ.grid, occ.cols, occ.rows, ix, ciz + 1)) bordered = true;
      }
    }
    assert.ok(bordered, 'segment is building-bordered');
  }
});

console.log(`\n${passed} passed\n`);
