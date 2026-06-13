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
 * The motion (stop-and-go, red lights, speed) lives in the car vertex
 * shader (CAR_VERT), driven by u_time — so a whole fleet animates with zero
 * per-frame CPU and this module only ever runs at build time.
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
  const out = [];
  for (let c = first; c <= half + 1e-6; c += spacing) out.push(c);
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
 * @returns {Float32Array} CAR_FLOATS per car
 */
export function generateTrafficLanes({ halfW, halfD, spacing, seed, carsPerRoad = 6 }) {
  const out = [];
  const rng = mulberry32((seed ^ 0x9e3779b9) >>> 0);
  const laneOff = spacing * 0.20 * 0.45;   // offset from road centre → two opposing lanes

  // Roads running in z (constant x at each x-axis road centre).
  for (const cx of roadCentres(halfW, spacing)) {
    for (let i = 0; i < carsPerRoad; i++) {
      const dir = rng() < 0.5 ? 1 : -1;
      const oz = dir > 0 ? -halfD : halfD;
      out.push(
        cx + dir * laneOff, oz,
        0, dir, halfD * 2, rng(),
        SPEED_MIN + rng() * SPEED_SPAN, dir > 0 ? 1 : 0, rng()
      );
    }
  }
  // Roads running in x (constant z at each z-axis road centre).
  for (const cz of roadCentres(halfD, spacing)) {
    for (let i = 0; i < carsPerRoad; i++) {
      const dir = rng() < 0.5 ? 1 : -1;
      const ox = dir > 0 ? -halfW : halfW;
      out.push(
        ox, cz + dir * laneOff,
        dir, 0, halfW * 2, rng(),
        SPEED_MIN + rng() * SPEED_SPAN, dir > 0 ? 1 : 0, rng()
      );
    }
  }
  return new Float32Array(out);
}
