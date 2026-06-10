/**
 * Twirl Filter shaders (GLSL ES 1.00 — WebGL1 + WebGL2).
 *
 * A single full-screen pass that remaps the sample coordinate in polar space
 * around `u_center`, within `u_radius`. Three warps:
 *   twirl   — rotate by an angle that falls off from centre to edge (spiral)
 *   pinch   — scale the radius (signed: + squeezes inward, − bulges out)
 *   fisheye — barrel / pincushion (radius scaled by r², signed)
 *
 * Stateless: a pure function of the scene + params. All factors are clamped so
 * the warp can't invert or sample wildly out of range.
 */

export const TWIRL_VERT = `
attribute vec2 a_position;
varying vec2 v_uv;
void main() {
  v_uv = a_position * 0.5 + 0.5;
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

// modes: 0 twirl, 1 pinch (+in / -bulge), 2 fisheye (barrel / pincushion)
export const TWIRL_FRAG = `
precision highp float;
varying vec2 v_uv;
uniform sampler2D u_scene;
uniform vec2  u_resolution;
uniform float u_strength;  // -1..1
uniform float u_radius;    // effect radius (uv, aspect-corrected)
uniform int   u_mode;
uniform vec2  u_center;

const float TAU = 6.2831853;

void main() {
  vec2 uv = v_uv;
  float aspect = u_resolution.x / u_resolution.y;
  vec2 d = uv - u_center;
  d.x *= aspect;
  float r = length(d);
  float rad = max(u_radius, 0.0001);
  float t = clamp(1.0 - r / rad, 0.0, 1.0); // 1 at centre -> 0 at the radius edge

  vec2 sd = d;
  if (u_mode == 0) {                 // twirl
    float ang = u_strength * TAU * t * t;
    float s = sin(ang), c = cos(ang);
    sd = mat2(c, -s, s, c) * d;
  } else if (u_mode == 1) {          // pinch (+) / bulge (-)
    float f = clamp(1.0 + u_strength * t, 0.2, 3.0);
    sd = d * f;
  } else {                           // fisheye barrel (+) / pincushion (-)
    float rn = clamp(r / rad, 0.0, 1.0);
    float f = clamp(1.0 + u_strength * rn * rn, 0.2, 3.0);
    sd = d * f;
  }

  sd.x /= aspect;
  gl_FragColor = texture2D(u_scene, sd + u_center);
}
`;
