/**
 * City Geometry Builders
 *
 * Pure functions that push interleaved vertex data into flat arrays.
 * Building vertices are 17 floats each
 * (pos3 + normal3 + localPos3 + meta4 + color3 + variation1);
 * roof triangles use the same layout so they can be rendered with the
 * same shader program — they just emit a localPos whose Y is ~0.99 so
 * the window-shader branch skips them.
 *
 * File: compositor/content/webgl/objects/city/geometry.js
 */

/**
 * Push 6 vertices for a quad (2 triangles) with per-vertex metadata.
 * p0–p3 are world positions, lp0–lp3 are local-space positions (unit box 0..1),
 * n is the face normal, meta/color/variation are per-building data.
 */
export function pushQuad(buf, p0, p1, p2, p3, lp0, lp1, lp2, lp3, n, meta, color, variation) {
  for (const [p, lp] of [[p0, lp0], [p1, lp1], [p2, lp2], [p0, lp0], [p2, lp2], [p3, lp3]]) {
    buf.push(p[0], p[1], p[2], n[0], n[1], n[2], lp[0], lp[1], lp[2],
      meta[0], meta[1], meta[2], meta[3], color[0], color[1], color[2], variation);
  }
}

/**
 * Generate a box segment in world space.
 * cx,cz = center XZ, y0 = base Y, w/h/d = dimensions, rot = Y rotation.
 * buildingId, color, variation, scaleVec = per-building data for shader.
 */
export function generateBoxSegment(buf, cx, cz, y0, w, h, d, rot, buildingId, color, variation, scaleVec) {
  const cr = Math.cos(rot), sr = Math.sin(rot);

  // Transform a local point to world space
  const P = (lx, ly, lz) => {
    const wx = lx * w, wz = lz * d;
    return [cx + wx * cr - wz * sr, y0 + ly * h, cz + wx * sr + wz * cr];
  };

  // Rotate a normal
  const N = (nx, ny, nz) => [nx * cr - nz * sr, ny, nx * sr + nz * cr];

  const meta = [buildingId, scaleVec[0], scaleVec[1], scaleVec[2]];

  // 4 side faces
  // Front (-Z)
  pushQuad(buf,
    P(-0.5, 0, -0.5), P(0.5, 0, -0.5), P(0.5, 1, -0.5), P(-0.5, 1, -0.5),
    [-0.5, 0, -0.5], [0.5, 0, -0.5], [0.5, 1, -0.5], [-0.5, 1, -0.5],
    N(0, 0, -1), meta, color, variation);
  // Back (+Z)
  pushQuad(buf,
    P(0.5, 0, 0.5), P(-0.5, 0, 0.5), P(-0.5, 1, 0.5), P(0.5, 1, 0.5),
    [0.5, 0, 0.5], [-0.5, 0, 0.5], [-0.5, 1, 0.5], [0.5, 1, 0.5],
    N(0, 0, 1), meta, color, variation);
  // Right (+X)
  pushQuad(buf,
    P(0.5, 0, -0.5), P(0.5, 0, 0.5), P(0.5, 1, 0.5), P(0.5, 1, -0.5),
    [0.5, 0, -0.5], [0.5, 0, 0.5], [0.5, 1, 0.5], [0.5, 1, -0.5],
    N(1, 0, 0), meta, color, variation);
  // Left (-X)
  pushQuad(buf,
    P(-0.5, 0, 0.5), P(-0.5, 0, -0.5), P(-0.5, 1, -0.5), P(-0.5, 1, 0.5),
    [-0.5, 0, 0.5], [-0.5, 0, -0.5], [-0.5, 1, -0.5], [-0.5, 1, 0.5],
    N(-1, 0, 0), meta, color, variation);
  // Top
  pushQuad(buf,
    P(-0.5, 1, -0.5), P(0.5, 1, -0.5), P(0.5, 1, 0.5), P(-0.5, 1, 0.5),
    [-0.5, 1, -0.5], [0.5, 1, -0.5], [0.5, 1, 0.5], [-0.5, 1, 0.5],
    [0, 1, 0], meta, color, variation);
}

export function generateRoofTri(buf, p0, p1, p2, color) {
  const ax = p1[0] - p0[0], ay = p1[1] - p0[1], az = p1[2] - p0[2];
  const bx = p2[0] - p0[0], by = p2[1] - p0[1], bz = p2[2] - p0[2];
  let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
  const l = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
  nx /= l; ny /= l; nz /= l;
  for (const p of [p0, p1, p2]) {
    // roofs use the same building shader — just pass roof-like meta so windows don't render
    buf.push(p[0], p[1], p[2], nx, ny, nz, 0, 0.99, 0, 0, 1, 1, 1, color[0], color[1], color[2], 0);
  }
}

export function generateRoofQuad(buf, a, b, c, d, col) {
  generateRoofTri(buf, a, b, c, col);
  generateRoofTri(buf, a, c, d, col);
}
