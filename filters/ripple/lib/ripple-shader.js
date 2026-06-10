/**
 * Ripple Filter shaders (GLSL ES 1.00 — WebGL1 + WebGL2).
 *
 * A single full-screen pass that displaces the texture-coordinate used to
 * sample the scene by animated sine waves, so the layer undulates like water /
 * heat-haze. Stateless except for `u_time` (the host advances it) — no retained
 * buffer; each frame is a pure function of the scene + the clock.
 */

export const RIPPLE_VERT = `
attribute vec2 a_position;
varying vec2 v_uv;
void main() {
  v_uv = a_position * 0.5 + 0.5;
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

// modes: 0 horizontal, 1 vertical, 2 radial (concentric), 3 both (shimmer)
export const RIPPLE_FRAG = `
precision highp float;
varying vec2 v_uv;
uniform sampler2D u_scene;
uniform vec2  u_resolution;
uniform float u_time;     // seconds
uniform float u_amp;      // displacement amplitude (uv units)
uniform float u_freq;     // wave count across the frame
uniform float u_speed;    // phase advance (rad/sec)
uniform int   u_mode;
uniform vec2  u_center;   // radial origin (uv)

const float TAU = 6.2831853;

void main() {
  vec2 uv = v_uv;
  float aspect = u_resolution.x / u_resolution.y;
  vec2 off = vec2(0.0);

  if (u_mode == 0) {              // horizontal: shift x by a wave along y
    off.x = u_amp * sin(uv.y * u_freq * TAU + u_time * u_speed);
  } else if (u_mode == 1) {       // vertical: shift y by a wave along x
    off.y = u_amp * sin(uv.x * u_freq * TAU + u_time * u_speed);
  } else if (u_mode == 2) {       // radial: concentric ripples from the centre
    vec2 d = uv - u_center;
    d.x *= aspect;
    float r = length(d);
    float w = u_amp * sin(r * u_freq * TAU - u_time * u_speed);
    vec2 dir = r > 0.0001 ? d / r : vec2(0.0);
    off = dir * w;
    off.x /= aspect;
  } else {                        // both: 2D shimmer
    off.x = u_amp * sin(uv.y * u_freq * TAU + u_time * u_speed);
    off.y = u_amp * sin(uv.x * u_freq * TAU + u_time * u_speed * 1.3);
  }

  gl_FragColor = texture2D(u_scene, uv + off);
}
`;
