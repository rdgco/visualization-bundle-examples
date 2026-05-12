/**
 * WebGL Math Utilities
 *
 * Minimal mat4 and vec3 operations for WebGL rendering.
 * All matrices are column-major Float32Arrays (WebGL convention).
 *
 * Column-major layout means mat[0..3] is column 0, mat[4..7] is column 1, etc.
 * This matches what gl.uniformMatrix4fv expects with transpose=false.
 */

// ============================================================================
// mat4
// ============================================================================

/** Create a 4x4 identity matrix. */
export function mat4Create() {
  const m = new Float32Array(16);
  m[0] = m[5] = m[10] = m[15] = 1;
  return m;
}

/**
 * Multiply two 4x4 matrices: out = a × b.
 * out may alias a or b.
 */
export function mat4Multiply(out, a, b) {
  const a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3];
  const a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7];
  const a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11];
  const a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];

  for (let col = 0; col < 4; col++) {
    const bi0 = b[col * 4], bi1 = b[col * 4 + 1], bi2 = b[col * 4 + 2], bi3 = b[col * 4 + 3];
    out[col * 4] = a00 * bi0 + a10 * bi1 + a20 * bi2 + a30 * bi3;
    out[col * 4 + 1] = a01 * bi0 + a11 * bi1 + a21 * bi2 + a31 * bi3;
    out[col * 4 + 2] = a02 * bi0 + a12 * bi1 + a22 * bi2 + a32 * bi3;
    out[col * 4 + 3] = a03 * bi0 + a13 * bi1 + a23 * bi2 + a33 * bi3;
  }
  return out;
}

/** Perspective projection matrix. fov is in radians. */
export function mat4Perspective(fov, aspect, near, far) {
  const m = new Float32Array(16);
  const f = 1 / Math.tan(fov / 2);
  const rangeInv = 1 / (near - far);
  m[0] = f / aspect;
  m[5] = f;
  m[10] = (near + far) * rangeInv;
  m[11] = -1;
  m[14] = 2 * near * far * rangeInv;
  return m;
}

/** View matrix from eye position looking at center with given up vector. */
export function mat4LookAt(eye, center, up) {
  const m = new Float32Array(16);
  // Forward = normalize(center - eye)
  let fx = center[0] - eye[0], fy = center[1] - eye[1], fz = center[2] - eye[2];
  let len = Math.sqrt(fx * fx + fy * fy + fz * fz) || 1;
  fx /= len; fy /= len; fz /= len;

  // Right = normalize(forward × up)
  let rx = fy * up[2] - fz * up[1];
  let ry = fz * up[0] - fx * up[2];
  let rz = fx * up[1] - fy * up[0];
  len = Math.sqrt(rx * rx + ry * ry + rz * rz) || 1;
  rx /= len; ry /= len; rz /= len;

  // Recalculate up = right × forward
  const ux = ry * fz - rz * fy;
  const uy = rz * fx - rx * fz;
  const uz = rx * fy - ry * fx;

  m[0] = rx; m[1] = ux; m[2] = -fx; m[3] = 0;
  m[4] = ry; m[5] = uy; m[6] = -fy; m[7] = 0;
  m[8] = rz; m[9] = uz; m[10] = -fz; m[11] = 0;
  m[12] = -(rx * eye[0] + ry * eye[1] + rz * eye[2]);
  m[13] = -(ux * eye[0] + uy * eye[1] + uz * eye[2]);
  m[14] = -(-fx * eye[0] + -fy * eye[1] + -fz * eye[2]);
  m[15] = 1;
  return m;
}

/** Rotation around X axis. */
export function mat4RotateX(out, m, angle) {
  const c = Math.cos(angle), s = Math.sin(angle);
  const r = mat4Create();
  r[5] = c; r[6] = s;
  r[9] = -s; r[10] = c;
  return mat4Multiply(out, m, r);
}

/** Rotation around Y axis. */
export function mat4RotateY(out, m, angle) {
  const c = Math.cos(angle), s = Math.sin(angle);
  const r = mat4Create();
  r[0] = c; r[2] = -s;
  r[8] = s; r[10] = c;
  return mat4Multiply(out, m, r);
}

/** Rotation around Z axis. */
export function mat4RotateZ(out, m, angle) {
  const c = Math.cos(angle), s = Math.sin(angle);
  const r = mat4Create();
  r[0] = c; r[1] = s;
  r[4] = -s; r[5] = c;
  return mat4Multiply(out, m, r);
}

/** Translation. */
export function mat4Translate(out, m, x, y, z) {
  const t = mat4Create();
  t[12] = x; t[13] = y; t[14] = z;
  return mat4Multiply(out, m, t);
}

/** Uniform scale. */
export function mat4Scale(out, m, s) {
  const sc = mat4Create();
  sc[0] = s; sc[5] = s; sc[10] = s;
  return mat4Multiply(out, m, sc);
}

export function mat4ScaleNonUniform(out, m, sx, sy, sz) {
  const sc = mat4Create();
  sc[0] = sx; sc[5] = sy; sc[10] = sz;
  return mat4Multiply(out, m, sc);
}

/**
 * Extract the upper-left 3x3 from a 4x4 as a Float32Array(9).
 * Used for transforming normals (adequate when model matrix has
 * no non-uniform scale; use inverse-transpose otherwise).
 */
export function mat3NormalFromMat4(m) {
  const n = new Float32Array(9);
  n[0] = m[0]; n[1] = m[1]; n[2] = m[2];
  n[3] = m[4]; n[4] = m[5]; n[5] = m[6];
  n[6] = m[8]; n[7] = m[9]; n[8] = m[10];
  return n;
}


// ============================================================================
// vec3 helpers (plain arrays — [x, y, z])
// ============================================================================

export function vec3Normalize(v) {
  const len = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]) || 1;
  return [v[0] / len, v[1] / len, v[2] / len];
}

export function vec3Cross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0]
  ];
}

export function vec3Sub(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
