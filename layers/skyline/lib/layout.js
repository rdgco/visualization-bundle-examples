/**
 * City Layout
 *
 * Procedural layout generation: the seeded RNG, the wall-color palette,
 * and `generateLayout` which places buildings on a wider-than-deep grid
 * with diagonal districts, organic edges, plazas, height clustering,
 * and taper assignments. Returns a list of building descriptors plus
 * the spacing and city bounds. No WebGL or geometry here — those live
 * in geometry.js.
 *
 * File: compositor/content/webgl/objects/city/layout.js
 */

// ============================================================================
// Seeded RNG
// ============================================================================

export function mulberry32(a) {
  return () => {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

// ============================================================================
// Palette
// ============================================================================

const PALETTES = [
  [0.11, 0.12, 0.14], [0.13, 0.13, 0.15], [0.09, 0.10, 0.12],
  [0.15, 0.13, 0.11], [0.14, 0.12, 0.10], [0.09, 0.11, 0.16],
  [0.08, 0.10, 0.14], [0.09, 0.12, 0.11], [0.13, 0.09, 0.08],
  [0.10, 0.10, 0.11], [0.12, 0.11, 0.13], [0.14, 0.14, 0.12]
];

export function pickColor(rng) {
  const p = PALETTES[Math.floor(rng() * PALETTES.length)];
  const b = 0.65 + rng() * 0.7;
  return [p[0] * b, p[1] * b, p[2] * b];
}

// ============================================================================
// Footprint mix
//
// Relative rarities among the exotic (non-box) shapes. Bevels and chops are
// common-ish; the L-shape is rare and the cylinder very rare — renormalized
// over whichever shapes the operator has enabled.
// ============================================================================

const FOOTPRINT_WEIGHTS = { bevel: 0.50, chop: 0.30, ell: 0.14, cylinder: 0.06 };

/**
 * Choose a footprint descriptor for one building.
 *
 * @param {() => number} rng
 * @param {{variety?:number, allowEll?:boolean, allowCylinder?:boolean}} opts
 *   variety — probability (0..1) that a building is non-box.
 * @returns {{type:string}} descriptor consumed by buildFootprintPolygon
 */
export function pickFootprint(rng, { variety = 0.35, allowEll = true, allowCylinder = true } = {}) {
  if (rng() >= variety) return { type: 'box' };

  const entries = [['bevel', FOOTPRINT_WEIGHTS.bevel], ['chop', FOOTPRINT_WEIGHTS.chop]];
  if (allowEll) entries.push(['ell', FOOTPRINT_WEIGHTS.ell]);
  if (allowCylinder) entries.push(['cylinder', FOOTPRINT_WEIGHTS.cylinder]);
  let total = 0;
  for (const [, w] of entries) total += w;
  let r = rng() * total, type = 'bevel';
  for (const [t, w] of entries) { if ((r -= w) <= 0) { type = t; break; } }

  switch (type) {
    case 'bevel':
      return { type, chamfer: 0.10 + rng() * 0.13 };            // slight chamfer on all corners
    case 'chop': {
      const corner = Math.floor(rng() * 4);
      const double = rng() < 0.30;
      return {
        type, corner, cut: 0.28 + rng() * 0.22,
        corner2: double ? (corner + 2) % 4 : -1, cut2: 0.28 + rng() * 0.22
      };
    }
    case 'ell':
      return { type, corner: Math.floor(rng() * 4), nx: 0.40 + rng() * 0.18, nz: 0.40 + rng() * 0.18 };
    case 'cylinder':
      return { type, sides: 18 + Math.floor(rng() * 11) };       // 18..28-gon
    default:
      return { type: 'box' };
  }
}

// ============================================================================
// Layout generator
// ============================================================================

/**
 * Generate a city layout: building positions, sizes, heights, rotations,
 * wall colors, and optional taper descriptors.
 *
 * @param {() => number} rng     Seeded RNG (mulberry32)
 * @param {{density:number,maxHeight:number,footprintVariety?:number,allowEll?:boolean,allowCylinder?:boolean}} params
 * @returns {{buildings:Array, spacing:number, citySize:[number,number]}}
 */
export function generateLayout(rng, params) {
  const buildings = [];
  const spacing = 2.8;
  const density = params.density;
  const fpCfg = {
    variety: params.footprintVariety ?? 0.35,
    allowEll: params.allowEll ?? true,
    allowCylinder: params.allowCylinder ?? true
  };
  const gridW = Math.round(density * 1.6), gridD = density;
  const halfW = (gridW * spacing) / 2, halfD = (gridD * spacing) / 2;

  const peakX = (rng() - 0.3) * halfW * 0.4, peakZ = (rng() - 0.5) * halfD * 0.3;
  const peak2X = peakX + (rng() > 0.5 ? 1 : -1) * halfW * 0.4, peak2Z = (rng() - 0.5) * halfD * 0.4;
  function heightAt(x, z) {
    return Math.exp(-((x - peakX) ** 2 + (z - peakZ) ** 2) * 0.005) +
           Math.exp(-((x - peak2X) ** 2 + (z - peak2Z) ** 2) * 0.008) * 0.6;
  }

  const plazas = [];
  for (let i = 0; i < 2 + Math.floor(rng() * 3); i++)
    plazas.push({x: (rng() - 0.5) * halfW * 1.4, z: (rng() - 0.5) * halfD * 1.2, r: 2 + rng() * 3});
  function inPlaza(x, z) {
    for (const p of plazas) if ((x - p.x) ** 2 + (z - p.z) ** 2 < p.r * p.r) return true;
    return false;
  }

  function assignTaper(b) {
    if (b.h < 5 || rng() > 0.20) return null;
    const style = rng(), tp = 0.4 + rng() * 0.3;
    if (style < 0.35) {
      const sh = 0.55 + rng() * 0.2;
      return {type: 'center', taperPoint: tp, shrinkW: sh, shrinkD: sh, offsetX: 0, offsetZ: 0};
    }
    if (style < 0.65) {
      const sh = 0.50 + rng() * 0.15, sd = rng() > 0.5 ? 1 : -1;
      return {type: 'side', taperPoint: tp, shrinkW: sh, shrinkD: 0.85 + rng() * 0.15, offsetX: sd * (1 - sh) * 0.5, offsetZ: 0};
    }
    return {type: 'oneaxis', taperPoint: tp, shrinkW: rng() > 0.5 ? 0.5 + rng() * 0.2 : 1, shrinkD: rng() > 0.5 ? 1 : 0.5 + rng() * 0.2, offsetX: 0, offsetZ: 0};
  }

  let id = 0;
  function makeB(x, z, h, rot) {
    const b = {x, z, w: 0.85 + rng() * 1.3, d: 0.85 + rng() * 1.3, h, rot, col: pickColor(rng), roofRng: rng(), id: id++};
    b.taper = assignTaper(b);
    b.footprint = pickFootprint(rng, fpCfg);
    return b;
  }

  // Main grid
  for (let ix = 0; ix < gridW; ix++) for (let iz = 0; iz < gridD; iz++) {
    const bx = ix * spacing - halfW, bz = iz * spacing - halfD;
    if (inPlaza(bx, bz)) continue;
    const eD = Math.max(Math.abs(bx) / halfW, Math.abs(bz) / halfD);
    if (eD > 0.85 && rng() < (eD - 0.85) * 4) continue;
    const j = 0.4 + eD * 0.5;
    const x = bx + (rng() - 0.5) * j, z = bz + (rng() - 0.5) * j;
    buildings.push(makeB(x, z, 1.2 + Math.pow(rng(), 1.5) * params.maxHeight * (0.3 + heightAt(x, z)),
      eD > 0.6 ? (rng() - 0.5) * 0.15 * eD : 0));
  }

  // Fringe
  for (let i = 0; i < Math.floor(density * 2.5); i++) {
    const a = rng() * Math.PI * 2, dist = 0.85 + rng() * 0.35;
    const fx = Math.cos(a) * halfW * dist, fz = Math.sin(a) * halfD * dist * 0.8;
    if (Math.abs(fx) < halfW * 0.8 && Math.abs(fz) < halfD * 0.8) continue;
    const b = makeB(fx + (rng() - 0.5) * 2, fz + (rng() - 0.5) * 2, 1 + rng() * params.maxHeight * 0.3, (rng() - 0.5) * 0.6);
    b.taper = null;
    buildings.push(b);
  }

  return { buildings, spacing, citySize: [gridW * spacing, gridD * spacing] };
}
