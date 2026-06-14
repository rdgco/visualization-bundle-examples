/**
 * Vehicles — expand the car-instance descriptor into drawable body geometry.
 *
 * Pure and deterministic, the geometry half of the traffic subsystem. Reads
 * the fixed 9-float-per-car descriptor from traffic.js (no RNG, no time, no
 * globals) and bakes, for each car, a 3D box body plus a headlight ground
 * pool, replicating the per-car instance attributes onto every vertex (no
 * instanced_arrays — WebGL 1 safe). The car vertex shader walks the lane and
 * poses the box from these attributes, so there is still zero per-frame CPU.
 *
 * Truck-vs-car and body colour are decided in the shader by hashing the
 * already-drawn startPhase / speed, so this expander adds no RNG and cannot
 * perturb the layout or traffic streams. Composes per-tile trivially.
 *
 * Strides are derived from the named float-count constants below (never
 * hardcoded), so the VBO attribute pointers in city.js stay in sync.
 */

// Body vertex: a_origin(2) + a_lane(4) + a_meta(3) + a_corner(3) + a_normal(3).
export const BODY_SIZES = [2, 4, 3, 3, 3];
export const BODY_FLOATS = BODY_SIZES.reduce((a, b) => a + b, 0);   // 15
export const BODY_STRIDE = BODY_FLOATS * 4;                          // 60 bytes
export const BODY_VERTS_PER_CAR = 30;                               // box, 5 faces (no bottom) x 2 tris x 3

// Pool vertex: a_origin(2) + a_lane(4) + a_meta(3) + a_quad(2).
export const POOL_SIZES = [2, 4, 3, 2];
export const POOL_FLOATS = POOL_SIZES.reduce((a, b) => a + b, 0);    // 11
export const POOL_STRIDE = POOL_FLOATS * 4;                          // 44 bytes
export const POOL_VERTS_PER_CAR = 6;                                // one quad = 2 tris

// Vehicle dimensions in GRID units (NOT metres — the grid is ~2.8 units/block
// and a road is ~0.56 units half-width, so real metres would be wider than the
// street). Tuned so half-width + lane offset stays inside the painted road:
// roadHalf = spacing*0.20, laneOff = spacing*0.20*0.45 ⇒ at spacing 2.8,
// roadHalf 0.56, laneOff 0.252; car half-width 0.21 and truck 0.275 both fit.
export const CAR_DIMS = [0.42, 0.30, 1.00];    // width, height, length
export const TRUCK_DIMS = [0.55, 0.52, 1.85];

// ~15% trucks: truck when fract(startPhase * 97) >= 0.85. Mirrors the shader.
export function truckHash(startPhase) {
  const x = startPhase * 97.0;
  return (x - Math.floor(x)) >= 0.85;
}

// Body-colour selector 0..1 from startPhase + speed (decorrelated). Mirrors
// the shader's v_colorSeed. The fragment shader maps this onto the bodyPaint
// palette.
export function colorSeedHash(startPhase, speed) {
  const x = startPhase * 131.0 + speed * 53.0;
  return x - Math.floor(x);
}

// Unit box: x,z in [-0.5, 0.5], y in [0, 1], +z is the travel/front direction.
// Five faces (bottom omitted — never seen). Each entry: { corner, normal }.
function buildUnitBox() {
  const out = [];
  // face = 4 CCW corners + outward normal → 2 triangles (0,1,2),(0,2,3)
  const face = (c0, c1, c2, c3, n) => {
    const cs = [c0, c1, c2, c0, c2, c3];
    for (const c of cs) out.push({ corner: c, normal: n });
  };
  const lo = -0.5, hi = 0.5, y0 = 0, y1 = 1;
  // front (+z)
  face([lo, y0, hi], [hi, y0, hi], [hi, y1, hi], [lo, y1, hi], [0, 0, 1]);
  // back (-z)
  face([hi, y0, lo], [lo, y0, lo], [lo, y1, lo], [hi, y1, lo], [0, 0, -1]);
  // right (+x)
  face([hi, y0, hi], [hi, y0, lo], [hi, y1, lo], [hi, y1, hi], [1, 0, 0]);
  // left (-x)
  face([lo, y0, lo], [lo, y0, hi], [lo, y1, hi], [lo, y1, lo], [-1, 0, 0]);
  // top (+y)
  face([lo, y1, hi], [hi, y1, hi], [hi, y1, lo], [lo, y1, lo], [0, 1, 0]);
  return out;
}

export const UNIT_BOX_30 = buildUnitBox();

// Unit quad in [-0.5, 0.5]^2 (the headlight pool footprint), 2 triangles.
const QUAD_6 = [
  [-0.5, -0.5], [0.5, -0.5], [0.5, 0.5],
  [-0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]
];

/**
 * Expand a car-instance buffer (9 floats/car from traffic.generateTrafficLanes)
 * into body + headlight-pool vertex buffers.
 *
 * @param {Float32Array} carData
 * @returns {{bodyData:Float32Array, bodyCount:number, poolData:Float32Array, poolCount:number}}
 */
export function expandVehicleBodies(carData) {
  const carCount = Math.floor(carData.length / 9);
  const bodyData = new Float32Array(carCount * BODY_VERTS_PER_CAR * BODY_FLOATS);
  const poolData = new Float32Array(carCount * POOL_VERTS_PER_CAR * POOL_FLOATS);
  let bo = 0, po = 0;

  for (let c = 0; c < carCount; c++) {
    const b = c * 9;
    const ox = carData[b], oz = carData[b + 1];
    const dx = carData[b + 2], dz = carData[b + 3], len = carData[b + 4];
    const phase = carData[b + 5], speed = carData[b + 6], flag = carData[b + 7], vis = carData[b + 8];

    for (const v of UNIT_BOX_30) {
      bodyData[bo++] = ox; bodyData[bo++] = oz;
      bodyData[bo++] = dx; bodyData[bo++] = dz; bodyData[bo++] = len; bodyData[bo++] = phase;
      bodyData[bo++] = speed; bodyData[bo++] = flag; bodyData[bo++] = vis;
      bodyData[bo++] = v.corner[0]; bodyData[bo++] = v.corner[1]; bodyData[bo++] = v.corner[2];
      bodyData[bo++] = v.normal[0]; bodyData[bo++] = v.normal[1]; bodyData[bo++] = v.normal[2];
    }
    for (const q of QUAD_6) {
      poolData[po++] = ox; poolData[po++] = oz;
      poolData[po++] = dx; poolData[po++] = dz; poolData[po++] = len; poolData[po++] = phase;
      poolData[po++] = speed; poolData[po++] = flag; poolData[po++] = vis;
      poolData[po++] = q[0]; poolData[po++] = q[1];
    }
  }

  return {
    bodyData, bodyCount: carCount * BODY_VERTS_PER_CAR,
    poolData, poolCount: carCount * POOL_VERTS_PER_CAR
  };
}
