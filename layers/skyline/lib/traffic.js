/**
 * Traffic — a self-contained "mini-world" over the street grid.
 *
 * This is the first subsystem extracted from city.js (alongside the style
 * descriptor seam). It owns the car instance data: lanes derived from the
 * road grid and a fleet of cars placed on them. It is pure and
 * deterministic — given a region + seed it returns the same Float32Array —
 * which is exactly what endless mode needs: call it per tile with that
 * tile's bounds + per-tile seed and the streams line up across borders.
 *
 * The motion (lane walk, signal stop-and-go, speed) lives in the vehicle
 * vertex shaders (CAR_BODY_VERT / CAR_POOL_VERT, sharing CAR_WALK_GLSL),
 * driven by u_time — so a whole fleet animates with zero per-frame CPU and
 * this module only ever runs at build time.
 *
 * Car instance layout — 9 floats:
 *   origin.x, origin.z,                  // lane start in world space
 *   dirX, dirZ, laneLength, startPhase,  // a_lane: unit direction + length + phase 0..1
 *   speed, colorFlag, visThreshold       // a_meta: cells/sec, 1=headlight 0=taillight, fade-in cutoff
 */

import { mulberry32 } from './layout.js';

export const CAR_FLOATS = 9;

// Per-car speed in cells (blocks) per second, before u_carSpeed. Tuned slow:
// at ~0.10–0.22 a car crosses one block every ~4.5–10s, and stop-and-go in
// the shader slows it further — city traffic, not a streaking light.
const SPEED_MIN = 0.10;
const SPEED_SPAN = 0.12;

/**
 * Coordinates of the road centres along one axis within [-half, half].
 * Roads sit half a cell off the building grid lines (mod(coord, sp) == sp/2),
 * matching the ground shader and the building layout. Shared by the car
 * lanes and the streetlight placement so they always align.
 */
export function roadCentres(half, spacing) {
  const first = Math.ceil(-half / spacing + 0.5) * spacing - spacing * 0.5;
  // Index-based (first + i*spacing) rather than accumulating `c += spacing`,
  // so centres stay exactly on the mod(coord, sp) == sp/2 grid even at the
  // large absolute-world extents endless mode will use (no FP drift).
  const n = Math.floor((half + 1e-6 - first) / spacing);
  const out = [];
  for (let i = 0; i <= n; i++) out.push(first + i * spacing);
  return out;
}

/**
 * Build the car instance buffer for a rectangular city region centred on
 * the origin.
 *
 * @param {object} opts
 * @param {number} opts.halfW       half-extent in x
 * @param {number} opts.halfD       half-extent in z
 * @param {number} opts.spacing     block size (road grid pitch)
 * @param {number} opts.seed        deterministic seed (per tile in endless mode)
 * @param {number} [opts.carsPerRoad=6]
 * @param {Array<{axis:0|1,x0:number,z0:number,length:number}>} [opts.segments]
 *   Optional explicit lane set (from roads.roadSegments) so cars only spawn on
 *   real, building-bordered streets. When omitted, lanes are the full road
 *   grid (every roadCentre line) — byte-identical to the pre-occupancy
 *   behavior. A segments list covering every roadCentre line, in the same
 *   order (all axis-0 then all axis-1), reproduces the no-segments output.
 * @returns {Float32Array} CAR_FLOATS per car
 */
export function generateTrafficLanes({ halfW, halfD, spacing, seed, carsPerRoad = 6, segments = null }) {
  const out = [];
  const rng = mulberry32((seed ^ 0x9e3779b9) >>> 0);
  const laneOff = spacing * 0.20 * 0.45;   // offset from road centre → two opposing lanes

  // Without an explicit list, lanes are the full road grid: every z-running
  // centre line first, then every x-running line — the exact order (and thus
  // RNG draw order) the original two-loop generator used.
  const lanes = segments || [
    ...roadCentres(halfW, spacing).map(cx => ({ axis: 0, x0: cx, z0: -halfD, length: halfD * 2 })),
    ...roadCentres(halfD, spacing).map(cz => ({ axis: 1, x0: -halfW, z0: cz, length: halfW * 2 }))
  ];

  for (const s of lanes) {
    for (let i = 0; i < carsPerRoad; i++) {
      const dir = rng() < 0.5 ? 1 : -1;
      // dir>0 starts at the low end of the lane; dir<0 at the high end.
      if (s.axis === 0) {
        const oz = dir > 0 ? s.z0 : s.z0 + s.length;
        out.push(
          s.x0 + dir * laneOff, oz,
          0, dir, s.length, rng(),
          SPEED_MIN + rng() * SPEED_SPAN, dir > 0 ? 1 : 0, rng()
        );
      } else {
        const ox = dir > 0 ? s.x0 : s.x0 + s.length;
        out.push(
          ox, s.z0 + dir * laneOff,
          dir, 0, s.length, rng(),
          SPEED_MIN + rng() * SPEED_SPAN, dir > 0 ? 1 : 0, rng()
        );
      }
    }
  }
  return new Float32Array(out);
}
