/**
 * Roads — occupancy + road-network derivation (workstream: traffic realism).
 *
 * Pure and deterministic, a sibling to traffic.js. Reads the layout's
 * building list AS OUTPUT (it never edits generateLayout and draws zero RNG),
 * and emits:
 *   - an occupancy grid (RGBA8, ready to upload as a NEAREST data texture)
 *     that the paved GROUND fragment shader samples to draw roads ONLY where
 *     buildings border them and GREENSPACE everywhere else;
 *   - a road-segment list that generateTrafficLanes consumes so cars only
 *     spawn on real, building-bordered streets (never on greenspace, never
 *     across building footprints).
 *
 * The cell<->world mapping lives here as the single source of truth, so the
 * JS predicate (presentAt) and the GLSL sampling (uv = (cell+0.5)/grid) stay
 * byte-aligned. Car gating is intentionally CPU-side (segments), NOT a
 * vertex-shader texture fetch — vertex texture fetch is unreliable on WebGL 1.
 *
 * Everything is generate(region, seed)-shaped: the same call drops onto a
 * per-tile region in endless mode, and because the mapping is absolute-world-
 * aligned, neighbouring tiles' grids and centerlines line up at the seam.
 */

import { roadCentres } from './traffic.js';

export const OCC_PAD = 1;        // apron ring (cells) for fringe + endless seams
export const DILATE_RADIUS = 1;  // Chebyshev radius marking "near a building"
export const OCC_R = 0;          // channel: cell contains a building
export const OCC_G = 1;          // channel: cell is within DILATE_RADIUS of one

// World coord of the CENTRE of cell (ix, iz). origin is the world coord of
// cell (0,0)'s low corner, so centre = origin + (i + 0.5) * spacing.
export function cellToWorld(ix, iz, originX, originZ, spacing) {
  return [originX + (ix + 0.5) * spacing, originZ + (iz + 0.5) * spacing];
}

// The single shared world->cell mapping. Mirrors the GLSL floor((v_pos -
// u_occOrigin) / spacing).
export function worldToCell(wx, wz, originX, originZ, spacing) {
  return [Math.floor((wx - originX) / spacing), Math.floor((wz - originZ) / spacing)];
}

export function occupiedAt(grid, cols, rows, ix, iz) {
  if (ix < 0 || iz < 0 || ix >= cols || iz >= rows) return 0;
  return grid[(iz * cols + ix) * 4 + OCC_R] > 127 ? 1 : 0;
}

// Dilated presence (building OR border) — the predicate the road-survival
// test uses. Mirrors the shader's step(0.5, texel.r + texel.g).
export function presentAt(grid, cols, rows, ix, iz) {
  if (ix < 0 || iz < 0 || ix >= cols || iz >= rows) return 0;
  const i = (iz * cols + ix) * 4;
  return (grid[i + OCC_R] > 127 || grid[i + OCC_G] > 127) ? 1 : 0;
}

/**
 * Build the occupancy grid for a rectangular city region centred on origin.
 *
 * @param {object} opts
 * @param {Array} opts.buildings  layout.buildings (read-only)
 * @param {number} opts.spacing
 * @param {[number,number]} opts.citySize  [w, d]
 * @param {number} [opts.pad=OCC_PAD]
 * @returns {{grid:Uint8Array, cols:number, rows:number, originX:number, originZ:number, halfW:number, halfD:number, spacing:number}}
 */
export function buildOccupancy({ buildings, spacing, citySize, pad = OCC_PAD }) {
  const halfW = citySize[0] * 0.5, halfD = citySize[1] * 0.5;
  const cols = Math.round(citySize[0] / spacing) + 2 * pad;
  const rows = Math.round(citySize[1] / spacing) + 2 * pad;
  const originX = -halfW - pad * spacing;
  const originZ = -halfD - pad * spacing;
  const grid = new Uint8Array(cols * rows * 4);

  // Pass 1: mark occupied cells (R) from building centres.
  for (const b of buildings) {
    const [ix, iz] = worldToCell(b.x, b.z, originX, originZ, spacing);
    if (ix < 0 || iz < 0 || ix >= cols || iz >= rows) continue;  // far fringe falls outside the apron; dropped
    grid[(iz * cols + ix) * 4 + OCC_R] = 255;
  }

  // Pass 2: dilation → presence (G) within DILATE_RADIUS of any occupied
  // cell (covers jitter / overhang / rotation). Also force alpha opaque on
  // every cell (some WebGL1 drivers mis-sample RGBA8 with zero alpha).
  for (let iz = 0; iz < rows; iz++) {
    for (let ix = 0; ix < cols; ix++) {
      const i = (iz * cols + ix) * 4;
      grid[i + 3] = 255;
      let near = 0;
      for (let dz = -DILATE_RADIUS; dz <= DILATE_RADIUS && !near; dz++) {
        for (let dx = -DILATE_RADIUS; dx <= DILATE_RADIUS; dx++) {
          if (occupiedAt(grid, cols, rows, ix + dx, iz + dz)) { near = 1; break; }
        }
      }
      if (near) grid[i + OCC_G] = 255;
    }
  }

  return { grid, cols, rows, originX, originZ, halfW, halfD, spacing };
}

/**
 * Derive the road-segment list cars run on. One full-length lane per road
 * centre-line (reusing traffic.roadCentres so node positions match the ground
 * shader centerlines and the layout exactly), emitted ONLY if a building
 * borders that line anywhere — so open areas get neither road nor cars.
 *
 * Phase-1 simplification: segments span the full half-extent; finer per-run
 * clipping (so cars also stop at greenspace gaps mid-line, e.g. a plaza) is a
 * phase-2 refinement. Roads still run strictly BETWEEN building rows, so cars
 * never cross a building footprint regardless.
 *
 * Segment shape matches the lane tuple generateTrafficLanes wants:
 *   { axis:0 (z-running, constant x), x0, z0:-halfD, length:2*halfD }
 *   { axis:1 (x-running, constant z), x0:-halfW, z0, length:2*halfW }
 *
 * @returns {{segments: Array<{axis:0|1,x0:number,z0:number,length:number}>}}
 */
export function roadSegments(occ, spacing) {
  const { grid, cols, rows, originX, originZ, halfW, halfD } = occ;
  const segments = [];

  // z-running roads at each x road-centre; survives if either flanking
  // building column (cell cix / cix+1) is present anywhere down the line.
  for (const cx of roadCentres(halfW, spacing)) {
    const [cix] = worldToCell(cx, 0, originX, originZ, spacing);
    let any = false;
    for (let iz = 0; iz < rows && !any; iz++) {
      if (presentAt(grid, cols, rows, cix, iz) || presentAt(grid, cols, rows, cix + 1, iz)) any = true;
    }
    if (any) segments.push({ axis: 0, x0: cx, z0: -halfD, length: halfD * 2 });
  }

  // x-running roads at each z road-centre; flanking rows ciz / ciz+1.
  for (const cz of roadCentres(halfD, spacing)) {
    const [, ciz] = worldToCell(0, cz, originX, originZ, spacing);
    let any = false;
    for (let ix = 0; ix < cols && !any; ix++) {
      if (presentAt(grid, cols, rows, ix, ciz) || presentAt(grid, cols, rows, ix, ciz + 1)) any = true;
    }
    if (any) segments.push({ axis: 1, x0: -halfW, z0: cz, length: halfW * 2 });
  }

  return { segments };
}
