/**
 * City Geometry Builders
 *
 * Pure functions that push interleaved vertex data into flat arrays.
 * Building vertices are 17 floats each:
 *
 *   pos3 + normal3 + facade3 + meta4 + color3 + variation1
 *
 * where `facade3` is (faceU, faceV, 0) — faceU runs 0..1 along the
 * width of a side face, faceV runs 0..1 from the segment's base to its
 * top — and `meta4` is [buildingId, faceWidth, segmentHeight, reserved].
 * Those four were historically [id, scaleX, scaleY, scaleZ], with the
 * fragment shader reconstructing the per-face U coordinate and width
 * from the unit box. That only worked for axis-aligned box faces; by
 * baking faceU + the physical face width per vertex here, the window
 * shader is freed from box geometry and any extruded polygon footprint
 * (bevel / chop / ell / cylinder) maps windows correctly.
 *
 * Roof triangles reuse the same building shader; they emit a faceU/faceV
 * whose interior collapses so the window branch never lights them.
 *
 * File: compositor/content/webgl/objects/city/geometry.js
 */

// ============================================================================
// Footprint polygons
//
// Each builder returns a CCW-ish array of unit { x, z } points in the
// [-0.5, 0.5] box. The prism extruder scales them by the building's
// w (x) and d (z) and rotates by `rot`, so a circle of radius 0.5
// becomes an ellipse, a unit square becomes the w×d box, etc.
// ============================================================================

const BOX_CORNERS = [
  { x: -0.5, z: -0.5 }, { x: 0.5, z: -0.5 },
  { x: 0.5, z: 0.5 }, { x: -0.5, z: 0.5 }
];

// Rectangle with a per-corner chamfer. `chamfer[i]` is the cut depth
// (unit space, 0 = sharp corner) applied to BOX_CORNERS[i]. Used for both
// bevel (all four corners equally, slightly) and chop (one or two corners,
// more aggressively). Returns 4..8 points, CCW.
function rectWithChamfers(chamfer) {
  const out = [];
  for (let i = 0; i < 4; i++) {
    const c = BOX_CORNERS[i];
    const prev = BOX_CORNERS[(i + 3) % 4];
    const next = BOX_CORNERS[(i + 1) % 4];
    const amt = chamfer[i] || 0;
    if (amt <= 1e-4) { out.push({ x: c.x, z: c.z }); continue; }
    // Walk in from the corner along the incoming (prev) edge, then along
    // the outgoing (next) edge. Box edges are axis-aligned, so the unit
    // direction toward a neighbour is just the sign of the delta.
    out.push({ x: c.x + Math.sign(prev.x - c.x) * amt, z: c.z + Math.sign(prev.z - c.z) * amt });
    out.push({ x: c.x + Math.sign(next.x - c.x) * amt, z: c.z + Math.sign(next.z - c.z) * amt });
  }
  return out;
}

// Rotate a point 90° * k CCW about the origin (k = 0..3).
function rot90(p, k) {
  let { x, z } = p;
  for (let i = 0; i < (k & 3); i++) { const nx = -z, nz = x; x = nx; z = nz; }
  return { x, z };
}

// L-shaped footprint: the full box with a rectangular notch removed from
// one corner. Built for the top-right corner, then rotated to `corner`.
// nx / nz are the notch extents as a fraction of the full 1.0 span.
function ellPolygon(corner, nx, nz) {
  const base = [
    { x: -0.5, z: -0.5 }, { x: 0.5, z: -0.5 },
    { x: 0.5, z: 0.5 - nz }, { x: 0.5 - nx, z: 0.5 - nz },
    { x: 0.5 - nx, z: 0.5 }, { x: -0.5, z: 0.5 }
  ];
  return corner ? base.map(p => rot90(p, corner)) : base;
}

// Regular n-gon on the unit circle (radius 0.5). Scaled to an ellipse by
// the building's w / d at extrude time.
function cylinderPolygon(sides) {
  const n = Math.max(3, Math.round(sides));
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    out.push({ x: Math.cos(a) * 0.5, z: Math.sin(a) * 0.5 });
  }
  return out;
}

/**
 * Build a footprint polygon for a building.
 *
 * @param {string} type  'box' | 'bevel' | 'chop' | 'ell' | 'cylinder'
 * @param {object} p     shape params from layout.pickFootprint
 * @returns {Array<{x:number,z:number}>} unit polygon, CCW
 */
export function buildFootprintPolygon(type, p = {}) {
  switch (type) {
    case 'bevel': {
      const c = p.chamfer ?? 0.16;
      return rectWithChamfers([c, c, c, c]);
    }
    case 'chop': {
      const ch = [0, 0, 0, 0];
      ch[(p.corner ?? 0) & 3] = p.cut ?? 0.4;
      if (p.corner2 >= 0) ch[p.corner2 & 3] = p.cut2 ?? (p.cut ?? 0.4);
      return rectWithChamfers(ch);
    }
    case 'ell':
      return ellPolygon((p.corner ?? 0) & 3, p.nx ?? 0.5, p.nz ?? 0.5);
    case 'cylinder':
      return cylinderPolygon(p.sides ?? 22);
    case 'box':
    default:
      return BOX_CORNERS.map(c => ({ x: c.x, z: c.z }));
  }
}

// ============================================================================
// Polygon triangulation (top caps)
//
// Ear-clipping so concave footprints (the L-shape) cap correctly. Convex
// shapes degrade to a fan. Returns index triples into `points`. Winding of
// the emitted triangles is irrelevant — caps are drawn with a fixed
// upward normal and no back-face culling — so we only need a valid cover.
// ============================================================================

function cross2(ax, az, bx, bz, cx, cz) {
  return (bx - ax) * (cz - az) - (bz - az) * (cx - ax);
}

function pointInTri(px, pz, ax, az, bx, bz, cx, cz) {
  const d1 = cross2(ax, az, bx, bz, px, pz);
  const d2 = cross2(bx, bz, cx, cz, px, pz);
  const d3 = cross2(cx, cz, ax, az, px, pz);
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNeg && hasPos);
}

export function triangulatePolygon(points) {
  const n = points.length;
  if (n < 3) return [];
  if (n === 3) return [[0, 1, 2]];

  // Signed area decides winding; build an index ring in CCW order so the
  // convexity test below (left turn ⇒ cross > 0) holds.
  let area = 0;
  for (let i = 0; i < n; i++) {
    const a = points[i], b = points[(i + 1) % n];
    area += a.x * b.z - b.x * a.z;
  }
  const ring = [];
  for (let i = 0; i < n; i++) ring.push(area >= 0 ? i : n - 1 - i);

  const tris = [];
  let guard = n * n + 8;
  while (ring.length > 3 && guard-- > 0) {
    let clipped = false;
    for (let i = 0; i < ring.length; i++) {
      const i0 = ring[(i - 1 + ring.length) % ring.length];
      const i1 = ring[i];
      const i2 = ring[(i + 1) % ring.length];
      const a = points[i0], b = points[i1], c = points[i2];
      if (cross2(a.x, a.z, b.x, b.z, c.x, c.z) <= 0) continue; // reflex — not an ear
      let contains = false;
      for (let j = 0; j < ring.length; j++) {
        const ij = ring[j];
        if (ij === i0 || ij === i1 || ij === i2) continue;
        const q = points[ij];
        if (pointInTri(q.x, q.z, a.x, a.z, b.x, b.z, c.x, c.z)) { contains = true; break; }
      }
      if (contains) continue;
      tris.push([i0, i1, i2]);
      ring.splice(i, 1);
      clipped = true;
      break;
    }
    if (!clipped) break; // degenerate guard — leave the rest uncapped
  }
  if (ring.length === 3) tris.push([ring[0], ring[1], ring[2]]);
  return tris;
}

// ============================================================================
// Prism extrusion
// ============================================================================

function pushBuildingVert(buf, p, fU, fV, n, meta, color, variation) {
  buf.push(
    p[0], p[1], p[2],
    n[0], n[1], n[2],
    fU, fV, 0,
    meta[0], meta[1], meta[2], meta[3],
    color[0], color[1], color[2],
    variation
  );
}

/**
 * Extrude a footprint polygon into a prism: one quad per side edge plus a
 * triangulated flat top cap.
 *
 * @param {number[]} buf       interleaved vertex sink
 * @param {Array<{x,z}>} poly  unit footprint (from buildFootprintPolygon)
 * @param {number} cx          footprint centre X
 * @param {number} cz          footprint centre Z
 * @param {number} y0          base Y
 * @param {number} w           footprint scale in X
 * @param {number} d           footprint scale in Z
 * @param {number} h           segment height
 * @param {number} rot         Y rotation
 * @param {number} buildingId  per-building id (window hashing)
 * @param {number[]} color     wall color
 * @param {number} variation   per-building window-style variation
 */
export function generatePrism(buf, poly, cx, cz, y0, w, d, h, rot, buildingId, color, variation) {
  const cr = Math.cos(rot), sr = Math.sin(rot);
  const nPts = poly.length;
  if (nPts < 3) return;

  // Scaled (w/d) but un-rotated footprint, plus its centroid — used to
  // orient each edge's outward normal.
  const sp = poly.map(pt => ({ x: pt.x * w, z: pt.z * d }));
  let gx = 0, gz = 0;
  for (const s of sp) { gx += s.x; gz += s.z; }
  gx /= nPts; gz /= nPts;

  const worldAt = (sx, sz, y) => [cx + sx * cr - sz * sr, y, cz + sx * sr + sz * cr];

  // ── Side walls ──
  for (let i = 0; i < nPts; i++) {
    const a = sp[i], b = sp[(i + 1) % nPts];
    const ex = b.x - a.x, ez = b.z - a.z;
    const faceWidth = Math.hypot(ex, ez);
    if (faceWidth < 1e-6) continue;

    // Outward normal: perpendicular to the edge, flipped to point away
    // from the centroid. Rotated into world space (Y-only rotation).
    let nx = ez, nz = -ex;
    const mx = (a.x + b.x) * 0.5, mz = (a.z + b.z) * 0.5;
    if (nx * (mx - gx) + nz * (mz - gz) < 0) { nx = -nx; nz = -nz; }
    const nl = Math.hypot(nx, nz) || 1;
    nx /= nl; nz /= nl;
    const normal = [nx * cr - nz * sr, 0, nx * sr + nz * cr];

    const meta = [buildingId, faceWidth, h, 0];
    const aB = worldAt(a.x, a.z, y0), bB = worldAt(b.x, b.z, y0);
    const aT = worldAt(a.x, a.z, y0 + h), bT = worldAt(b.x, b.z, y0 + h);

    // Two triangles. faceU 0→1 a→b; faceV 0→1 base→top.
    pushBuildingVert(buf, aB, 0, 0, normal, meta, color, variation);
    pushBuildingVert(buf, bB, 1, 0, normal, meta, color, variation);
    pushBuildingVert(buf, bT, 1, 1, normal, meta, color, variation);
    pushBuildingVert(buf, aB, 0, 0, normal, meta, color, variation);
    pushBuildingVert(buf, bT, 1, 1, normal, meta, color, variation);
    pushBuildingVert(buf, aT, 0, 1, normal, meta, color, variation);
  }

  // ── Flat top cap ── (upward normal ⇒ shader's isTop branch ⇒ no windows)
  const up = [0, 1, 0];
  const capMeta = [buildingId, 1, h, 0];
  const topY = y0 + h;
  for (const [i0, i1, i2] of triangulatePolygon(poly)) {
    for (const idx of [i0, i1, i2]) {
      const s = sp[idx];
      pushBuildingVert(buf, worldAt(s.x, s.z, topY), 0.5, 1, up, capMeta, color, variation);
    }
  }
}

// ============================================================================
// Roof triangles (box footprints keep the varied roof shapes)
// ============================================================================

export function generateRoofTri(buf, p0, p1, p2, color) {
  const ax = p1[0] - p0[0], ay = p1[1] - p0[1], az = p1[2] - p0[2];
  const bx = p2[0] - p0[0], by = p2[1] - p0[1], bz = p2[2] - p0[2];
  let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
  const l = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
  nx /= l; ny /= l; nz /= l;
  for (const p of [p0, p1, p2]) {
    // Roofs use the building shader; faceU is held at 0 so the window
    // branch resolves to wall, and meta carries no real face width.
    buf.push(p[0], p[1], p[2], nx, ny, nz, 0, 0.99, 0, 0, 1, 1, 1, color[0], color[1], color[2], 0);
  }
}

export function generateRoofQuad(buf, a, b, c, d, col) {
  generateRoofTri(buf, a, b, c, col);
  generateRoofTri(buf, a, c, d, col);
}
