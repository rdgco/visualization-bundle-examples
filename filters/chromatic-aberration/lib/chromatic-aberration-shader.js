/**
 * Chromatic Aberration shaders (GLSL ES 1.00 — WebGL1 + WebGL2).
 *
 * A single full-screen pass that samples the red / green / blue channels at
 * radially-offset coordinates — red pushed outward, blue pulled inward, around
 * `u_center` — so the colour fringes split toward the edges like a cheap lens.
 * Stateless: a pure function of the scene + params.
 */

export const ABERRATION_VERT = `
attribute vec2 a_position;
varying vec2 v_uv;
void main() {
  v_uv = a_position * 0.5 + 0.5;
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

export const ABERRATION_FRAG = `
precision highp float;
varying vec2 v_uv;
uniform sampler2D u_scene;
uniform vec2  u_resolution;
uniform float u_amount;   // dispersion strength (uv units at the corner)
uniform float u_power;    // radial falloff exponent (how edge-biased it is)
uniform vec2  u_center;

void main() {
  vec2 uv = v_uv;
  vec2 d = uv - u_center;
  float r = length(d);
  vec2 dir = r > 0.0001 ? d / r : vec2(0.0);

  // Dispersion grows with distance from the centre — none at the middle,
  // most at the edges (power shapes the ramp).
  float disp = u_amount * pow(r, u_power);
  vec2 off = dir * disp;

  float cr = texture2D(u_scene, uv + off).r;  // red pushed out
  float cg = texture2D(u_scene, uv).g;        // green stays
  float cb = texture2D(u_scene, uv - off).b;  // blue pulled in
  float a  = texture2D(u_scene, uv).a;

  gl_FragColor = vec4(cr, cg, cb, a);
}
`;
