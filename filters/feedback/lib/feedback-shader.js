/**
 * Feedback Filter shaders (GLSL ES 1.00 — runs on WebGL1 and WebGL2)
 *
 * Two programs:
 *   COMBINE — the temporal core. Samples the PREVIOUS accumulation frame
 *             through a warp transform (zoom/rotate/offset around centre),
 *             fades it by persistence, hue-rotates it, then blends the
 *             current source frame on top. This is the pass that makes the
 *             filter "remember" — its output becomes next frame's feedback.
 *   COPY    — trivial passthrough: draws the freshly combined accumulation
 *             texture to the visible canvas so it can be composited back to
 *             the host's 2D context.
 *
 * The warp is applied to the texture-coordinate used to SAMPLE the previous
 * frame, not to the geometry — sampling from a coordinate pulled toward the
 * centre makes the retained image appear to grow each frame (infinite-tunnel
 * zoom); rotating that coordinate spins the trail.
 */

export const FEEDBACK_VERT = `
attribute vec2 a_position;
varying vec2 v_uv;
void main() {
  v_uv = a_position * 0.5 + 0.5;
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

// blend modes: 0 = add, 1 = screen, 2 = over (source-over-feedback)
export const FEEDBACK_FRAG = `
precision highp float;
varying vec2 v_uv;

uniform sampler2D u_source;     // current frame (the upstream canvas)
uniform sampler2D u_feedback;   // previous accumulation frame
uniform vec2  u_resolution;
uniform float u_persistence;    // 0..~1 — fraction of the trail that survives
uniform float u_sourceGain;     // how strongly the new frame is injected
uniform int   u_blend;          // 0 add / 1 screen / 2 over
uniform float u_zoom;           // per-frame scale of the feedback (1 = none)
uniform float u_rotate;         // per-frame rotation of the feedback (radians)
uniform vec2  u_shift;          // per-frame translation of the feedback (uv)
uniform float u_hue;            // per-frame hue rotation of the feedback (radians)

// Rotate an RGB colour around the luma axis by angle a (radians).
vec3 hueRotate(vec3 c, float a) {
  // YIQ-style luma-preserving hue rotation.
  const vec3 k = vec3(0.57735); // normalized (1,1,1)
  float cosA = cos(a);
  return c * cosA
       + cross(k, c) * sin(a)
       + k * dot(k, c) * (1.0 - cosA);
}

void main() {
  // ---- warp the coordinate we read the PREVIOUS frame from ----
  vec2 uv = v_uv;
  vec2 p = uv - 0.5;
  // aspect-correct so rotation isn't sheared on non-square canvases
  float aspect = u_resolution.x / u_resolution.y;
  p.x *= aspect;
  float s = sin(u_rotate);
  float co = cos(u_rotate);
  p = mat2(co, -s, s, co) * p;   // rotate
  p /= u_zoom;                    // zoom (>1 pulls the sample inward -> image grows)
  p.x /= aspect;
  vec2 fuv = p + 0.5 - u_shift;   // translate

  // mask the trail to inside the frame so it falls off cleanly at the edges
  // instead of clamp-smearing the border pixels into long streaks.
  float inb = step(0.0, fuv.x) * step(fuv.x, 1.0)
            * step(0.0, fuv.y) * step(fuv.y, 1.0);

  vec4 fb = texture2D(u_feedback, fuv);
  fb.rgb = hueRotate(fb.rgb, u_hue);
  fb *= u_persistence * inb;

  vec4 src = texture2D(u_source, uv) * u_sourceGain;

  vec3 outRgb;
  if (u_blend == 0) {
    outRgb = fb.rgb + src.rgb;                       // add
  } else if (u_blend == 1) {
    outRgb = 1.0 - (1.0 - fb.rgb) * (1.0 - src.rgb); // screen
  } else {
    outRgb = src.rgb + fb.rgb * (1.0 - src.a);       // over
  }

  float outA = clamp(max(src.a, fb.a), 0.0, 1.0);
  gl_FragColor = vec4(outRgb, outA);
}
`;

export const COPY_FRAG = `
precision highp float;
varying vec2 v_uv;
uniform sampler2D u_tex;
void main() {
  gl_FragColor = texture2D(u_tex, v_uv);
}
`;
