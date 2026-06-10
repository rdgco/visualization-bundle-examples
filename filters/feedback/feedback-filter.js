/**
 * Feedback Filter — temporal trails / echo / infinite-tunnel warp
 *
 * The canonical example of a TEMPORAL filter: one whose output depends on
 * more than the current frame. Where every other filter in this bundle is a
 * pure function of `sourceCanvas` (invert, edge-detect, vignette, glitch),
 * this one retains its previous output in a GPU texture and blends it back
 * in each frame. That retained buffer is what produces ghost trails, motion
 * echo, and — when the feedback is zoomed/rotated each frame — the classic
 * self-similar "infinite tunnel."
 *
 * It demonstrates the answer to the question "can a layer-core filter do
 * multi-frame effects without a host change?" — yes. The host hands the
 * filter the current frame and a place to write; the FILTER is a long-lived
 * instance, so it keeps its own ping-pong textures across frames. No host or
 * contract change is required.
 *
 * Pipeline (per frame, all on the filter's own offscreen WebGL canvas):
 *   1. upload `sourceCanvas` -> source texture
 *   2. COMBINE pass: read the previous accumulation texture through the warp
 *      (zoom/rotate/offset), fade by persistence, hue-rotate, blend source
 *      on top -> write to the OTHER accumulation texture (ping-pong)
 *   3. COPY pass: draw the new accumulation texture to the canvas
 *   4. swap read/write; host composites the canvas back via ctx.drawImage
 *
 * Controls:
 *   - `trailPersistence` / `sourceGain` / `blend` — the trail itself
 *   - `feedbackZoom` / `feedbackRotate` / `feedbackShiftX|Y` — the warp
 *   - `hueDrift` — psychedelic colour cycling of the trail
 *   - `pulse` reaction — kick the feedback (persistence + zoom impulse) on a
 *     beat; the single most "alive" use of this filter for music.
 *   - `reverse` reaction — flip the spin direction live (the per-program
 *     reverse-spin), without changing the rotation value.
 *
 * Every numeric attribute is audio-bindable: it carries a cross-host
 * modulation marker so a host can drive it from a live audio level
 * (peak / sub / bass / mid / high / presence). The filter stays audio-blind —
 * the host senses and pushes resolved values in via `setModulatedValues()`.
 *
 * All time-varying quantities are normalised by real elapsed time so the look
 * is frame-rate independent (deg/sec, per-60fps-frame persistence, etc.).
 *
 * Mirrors `vignette`'s inline-GL-bridge pattern; WebGL2 with a WebGL1
 * fallback, GLSL ES 1.00 so one shader source serves both.
 */

import { FEEDBACK_VERT, FEEDBACK_FRAG, COPY_FRAG } from './lib/feedback-shader.js';

export const key = 'feedback';
export const label = 'Feedback';
export const type = 'filter';
export const category = 'demos';
export const description =
  'Temporal feedback post-process: retains the previous frame and blends it ' +
  'back in for ghost trails, motion echo, and infinite-tunnel zoom/rotate. ' +
  'The canonical multi-frame filter — proves a layer-core filter can hold a ' +
  'retained buffer across frames with no host change. `feedbackZoom`/`rotate` ' +
  'warp the trail; `hueDrift` cycles its colour. Every attribute is ' +
  'audio-bindable; the `pulse` reaction kicks the feedback on a beat and ' +
  '`reverse` flips the spin direction live.';

const BLEND_MODES = ['screen', 'add', 'over'];
const BLEND_INT = { add: 0, screen: 1, over: 2 };

// Cross-host audio-modulation marker. Every numeric attribute carries one, so
// each can be driven by a live audio level (peak / sub / bass / mid / high /
// presence). The hosts read different keys off the same object and ignore the
// rest (layer-core treats it as opaque):
//   - visualization-harness reads `kind: 'audio'` to surface the per-param
//     audio-binding dropdown and auto-wire it into its audio→patch rig.
//   - midi-daddy reads `sourceTypes` (which input streams may bind) and
//     `defaultAmount` (the default patch depth).
// Filters never sample audio themselves — the host senses once and pushes the
// resolved value in through `setModulatedValues()` each frame.
const audioMod = defaultAmount => ({
  kind: 'audio',
  sourceTypes: ['audio', 'oneshot', 'note', 'tempo'],
  defaultAmount
});

export const params = {
  // ── Trail ────────────────────────────────────────────────────────────
  trailPersistence: {
    type: 'number',
    label: 'Trail Persistence',
    default: 0.9,
    min: 0,
    max: 0.99,
    step: 0.01,
    description:
      'Fraction of the previous frame that survives into the next (per 60fps ' +
      'frame). 0 = no trail (passthrough); 0.99 = very long, slow-decaying ' +
      'trails. The core trail-length knob.',
    modulation: audioMod(0.3),
    paramGroup: 'trail',
    paramGroupLabel: 'Trail',
    paramGroupCollapsed: false
  },
  sourceGain: {
    type: 'number',
    label: 'Source Gain',
    default: 1,
    min: 0,
    max: 2,
    step: 0.01,
    description:
      'How strongly the current frame is injected on top of the trail. <1 ' +
      'lets the trail dominate; >1 over-drives bright sources into bloom.',
    modulation: audioMod(0.5),
    paramGroup: 'trail'
  },
  blend: {
    type: 'enum',
    label: 'Blend',
    options: BLEND_MODES,
    default: 'screen',
    description:
      'How the current frame combines with the trail. screen = glowing, ' +
      'additive-but-clamped (best default); add = pure additive (blows out ' +
      'fast); over = opaque source painted over the trail.',
    paramGroup: 'trail'
  },

  // ── Warp ─────────────────────────────────────────────────────────────
  feedbackZoom: {
    type: 'number',
    label: 'Feedback Zoom',
    default: 1,
    min: 0.9,
    max: 1.1,
    step: 0.001,
    description:
      'Per-frame scale of the feedback. 1 = none. >1 grows the trail each ' +
      'frame (tunnel toward you); <1 shrinks it (tunnel away). Tiny values ' +
      '(1.01) read as a strong tunnel because the effect compounds.',
    modulation: audioMod(0.03),
    paramGroup: 'warp',
    paramGroupLabel: 'Warp',
    paramGroupCollapsed: false
  },
  feedbackRotate: {
    type: 'number',
    label: 'Feedback Rotate',
    default: 0,
    min: -180,
    max: 180,
    step: 0.5,
    description:
      'Rotation velocity of the feedback in degrees/second. Signed: negative ' +
      'spins one way, positive the other. Spins the trail into a spiral; ' +
      'pairs with zoom for a rotating tunnel. The `reverse` reaction flips ' +
      'this direction live without changing the value.',
    modulation: audioMod(30),
    paramGroup: 'warp'
  },
  feedbackShiftX: {
    type: 'number',
    label: 'Feedback Drift X',
    default: 0,
    min: -0.05,
    max: 0.05,
    step: 0.001,
    description: 'Per-frame horizontal drift of the feedback (fraction of width).',
    modulation: audioMod(0.02),
    paramGroup: 'warp'
  },
  feedbackShiftY: {
    type: 'number',
    label: 'Feedback Drift Y',
    default: 0,
    min: -0.05,
    max: 0.05,
    step: 0.001,
    description: 'Per-frame vertical drift of the feedback (fraction of height).',
    modulation: audioMod(0.02),
    paramGroup: 'warp'
  },

  // ── Colour ───────────────────────────────────────────────────────────
  hueDrift: {
    type: 'number',
    label: 'Hue Drift',
    default: 0,
    min: -180,
    max: 180,
    step: 1,
    description:
      'Hue rotation of the trail in degrees/second. Because it compounds over ' +
      'the retained frames, even a few deg/sec cycles the trail through the ' +
      'full spectrum — the psychedelic colour-smear.',
    modulation: audioMod(60),
    paramGroup: 'color',
    paramGroupLabel: 'Colour',
    paramGroupCollapsed: false
  }
};

export const reactions = {
  pulse: {
    label: 'Feedback pulse',
    description:
      'Kick the feedback on a transient (~450ms decaying envelope): briefly ' +
      'pushes persistence toward "hold" and adds a zoom impulse, so the trail ' +
      'blooms and lunges forward on the beat, then settles back to baseline.',
    args: {
      strength: {
        type: 'number',
        label: 'Strength',
        default: 1,
        min: 0,
        max: 1,
        step: 0.01,
        description: 'Scales the persistence boost and zoom impulse the pulse adds.'
      }
    }
  },
  reverse: {
    label: 'Reverse spin',
    description:
      'Flip the feedback rotation direction live, without touching the ' +
      '`feedbackRotate` value. Fire it on a beat to whip the tunnel the other ' +
      'way. `mode` toggles by default, or forces a direction.',
    args: {
      mode: {
        type: 'enum',
        label: 'Direction',
        options: ['toggle', 'forward', 'reverse'],
        default: 'toggle',
        description:
          'toggle = flip whichever way it is spinning; forward = lock to the ' +
          'sign of feedbackRotate; reverse = lock to the opposite sign.'
      }
    }
  }
};

const PULSE_MS = 450;
const PULSE_ZOOM_KICK = 0.06; // extra per-frame zoom at the peak of a pulse
const PULSE_HOLD = 0.985;     // persistence the pulse pushes toward at its peak

// ── pure helpers (exported for unit tests) ──────────────────────────────
export function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}
export function blendToInt(mode) {
  return BLEND_INT[mode] ?? BLEND_INT.screen;
}
const DEG2RAD = Math.PI / 180;

// ============================================================================
// WebGL ping-pong bridge (inline — mirrors vignette's bridge pattern)
// ============================================================================

function createFeedbackBridge(width, height) {
  if (typeof document === 'undefined' || typeof document.createElement !== 'function') {
    // Non-DOM environment (e.g. unit tests under node). The filter degrades
    // to an inert passthrough; isActive() reports false.
    return null;
  }

  const offscreen = document.createElement('canvas');
  offscreen.width = width;
  offscreen.height = height;

  const glOpts = { alpha: true, premultipliedAlpha: false, preserveDrawingBuffer: true };
  const gl = offscreen.getContext('webgl2', glOpts) || offscreen.getContext('webgl', glOpts);
  if (!gl) {
    console.warn('[FeedbackFilter] WebGL not available — feedback disabled');
    return null;
  }

  function compile(type, src) {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      console.error('[FeedbackFilter] shader:', gl.getShaderInfoLog(sh));
      gl.deleteShader(sh);
      return null;
    }
    return sh;
  }

  function link(vsSrc, fsSrc) {
    const vs = compile(gl.VERTEX_SHADER, vsSrc);
    const fs = compile(gl.FRAGMENT_SHADER, fsSrc);
    if (!vs || !fs) return null;
    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.error('[FeedbackFilter] link:', gl.getProgramInfoLog(prog));
      return null;
    }
    const uCache = {};
    return {
      program: prog,
      aPosition: gl.getAttribLocation(prog, 'a_position'),
      u(name) {
        if (!(name in uCache)) uCache[name] = gl.getUniformLocation(prog, name);
        return uCache[name];
      }
    };
  }

  const combine = link(FEEDBACK_VERT, FEEDBACK_FRAG);
  const copy = link(FEEDBACK_VERT, COPY_FRAG);
  if (!combine || !copy) return null;

  const quadVBO = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quadVBO);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);

  function makeTexture(w, h, data = null) {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
    return tex;
  }

  const sourceTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, sourceTex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  // Ping-pong accumulation textures + their framebuffers.
  let accum = null; // { tex: [a, b], fbo: [a, b], read: 0 }

  function allocAccum(w, h) {
    const tex = [makeTexture(w, h), makeTexture(w, h)];
    const fbo = [gl.createFramebuffer(), gl.createFramebuffer()];
    for (let i = 0; i < 2; i++) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo[i]);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex[i], 0);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    accum = { tex, fbo, read: 0 };
  }

  function freeAccum() {
    if (!accum) return;
    accum.tex.forEach(t => gl.deleteTexture(t));
    accum.fbo.forEach(f => gl.deleteFramebuffer(f));
    accum = null;
  }

  function bindQuad(prog) {
    gl.bindBuffer(gl.ARRAY_BUFFER, quadVBO);
    gl.enableVertexAttribArray(prog.aPosition);
    gl.vertexAttribPointer(prog.aPosition, 2, gl.FLOAT, false, 0, 0);
  }

  allocAccum(width, height);

  return {
    canvas: offscreen,

    resize(w, h) {
      if (offscreen.width === w && offscreen.height === h) return;
      offscreen.width = w;
      offscreen.height = h;
      freeAccum();
      allocAccum(w, h);
    },

    /**
     * Run one feedback step. `u` carries the resolved, time-normalised
     * uniforms for this frame (see FeedbackFilter.render).
     */
    render(sourceCanvas, u) {
      const w = sourceCanvas.width;
      const h = sourceCanvas.height;
      if (offscreen.width !== w || offscreen.height !== h) this.resize(w, h);

      // Upload the current frame (flip Y so it samples upright, like vignette).
      gl.bindTexture(gl.TEXTURE_2D, sourceTex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, sourceCanvas);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);

      gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.CULL_FACE);
      gl.disable(gl.BLEND); // shader does its own compositing

      const read = accum.read;
      const write = read ^ 1;

      // ---- COMBINE: prev accumulation + source -> write texture ----
      gl.bindFramebuffer(gl.FRAMEBUFFER, accum.fbo[write]);
      gl.viewport(0, 0, w, h);
      gl.useProgram(combine.program);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, sourceTex);
      gl.uniform1i(combine.u('u_source'), 0);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, accum.tex[read]);
      gl.uniform1i(combine.u('u_feedback'), 1);
      gl.uniform2f(combine.u('u_resolution'), w, h);
      gl.uniform1f(combine.u('u_persistence'), u.persistence);
      gl.uniform1f(combine.u('u_sourceGain'), u.sourceGain);
      gl.uniform1i(combine.u('u_blend'), u.blend);
      gl.uniform1f(combine.u('u_zoom'), u.zoom);
      gl.uniform1f(combine.u('u_rotate'), u.rotate);
      gl.uniform2f(combine.u('u_shift'), u.shiftX, u.shiftY);
      gl.uniform1f(combine.u('u_hue'), u.hue);
      bindQuad(combine);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

      // ---- COPY: write texture -> visible canvas ----
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, w, h);
      gl.useProgram(copy.program);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, accum.tex[write]);
      gl.uniform1i(copy.u('u_tex'), 0);
      bindQuad(copy);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

      accum.read = write; // swap
    },

    cleanup() {
      freeAccum();
      gl.deleteTexture(sourceTex);
      gl.deleteBuffer(quadVBO);
      gl.deleteProgram(combine.program);
      gl.deleteProgram(copy.program);
      const ext = gl.getExtension('WEBGL_lose_context');
      if (ext) ext.loseContext();
    }
  };
}

// ============================================================================
// Filter class
// ============================================================================

export default class FeedbackFilter {
  constructor(width, height, initialParams = {}) {
    this._w = width;
    this._h = height;

    // Resolved control state (params -> internal units).
    this._persistence = 0.9;
    this._sourceGain = 1;
    this._blend = BLEND_INT.screen;
    this._zoom = 1;                 // per-60fps-frame scale
    this._rotateRadPerSec = 0;
    this._spinSign = 1;             // flipped live by the `reverse` reaction
    this._shiftXPerFrame = 0;       // per-60fps-frame
    this._shiftYPerFrame = 0;
    this._hueRadPerSec = 0;

    // Pulse reaction envelope (decaying, like glitch's burst).
    this._pulseUntil = 0;
    this._pulseStrength = 0;

    this._lastT = (typeof performance !== 'undefined' ? performance.now() : 0);

    this._bridge = createFeedbackBridge(width, height);
    this._applyParams(initialParams);
  }

  _applyParams(p) {
    if (!p) return;
    if (typeof p.trailPersistence === 'number' && Number.isFinite(p.trailPersistence)) {
      this._persistence = clamp(p.trailPersistence, 0, 0.99);
    }
    if (typeof p.sourceGain === 'number' && Number.isFinite(p.sourceGain)) {
      this._sourceGain = clamp(p.sourceGain, 0, 2);
    }
    if (typeof p.blend === 'string' && p.blend in BLEND_INT) {
      this._blend = BLEND_INT[p.blend];
    }
    if (typeof p.feedbackZoom === 'number' && Number.isFinite(p.feedbackZoom)) {
      this._zoom = clamp(p.feedbackZoom, 0.5, 1.5);
    }
    if (typeof p.feedbackRotate === 'number' && Number.isFinite(p.feedbackRotate)) {
      this._rotateRadPerSec = p.feedbackRotate * DEG2RAD;
    }
    if (typeof p.feedbackShiftX === 'number' && Number.isFinite(p.feedbackShiftX)) {
      this._shiftXPerFrame = p.feedbackShiftX;
    }
    if (typeof p.feedbackShiftY === 'number' && Number.isFinite(p.feedbackShiftY)) {
      this._shiftYPerFrame = p.feedbackShiftY;
    }
    if (typeof p.hueDrift === 'number' && Number.isFinite(p.hueDrift)) {
      this._hueRadPerSec = p.hueDrift * DEG2RAD;
    }
  }

  // ── Contract: live-update aliases + lifecycle ──────────────────────────
  updateParams(p) { this._applyParams(p); }
  updateConfig(p) { this._applyParams(p); }
  setConfig(p) { this._applyParams(p); }
  setModulatedValues(p) { this._applyParams(p); }

  isActive() { return !!this._bridge; }

  resize(width, height) {
    this._w = width;
    this._h = height;
    if (this._bridge) this._bridge.resize(width, height);
  }

  cleanup() {
    if (this._bridge) {
      this._bridge.cleanup();
      this._bridge = null;
    }
  }

  // ── Contract: reaction ─────────────────────────────────────────────────
  react(key, args = {}) {
    if (key === 'pulse') {
      const strength = typeof args.strength === 'number' ? clamp(args.strength, 0, 1) : 1;
      this._pulseStrength = strength;
      this._pulseUntil = (typeof performance !== 'undefined' ? performance.now() : 0) + PULSE_MS;
      return;
    }
    if (key === 'reverse') {
      const mode = typeof args.mode === 'string' ? args.mode : 'toggle';
      if (mode === 'forward') this._spinSign = 1;
      else if (mode === 'reverse') this._spinSign = -1;
      else this._spinSign = -this._spinSign;
      return;
    }
    throw new Error(`feedback: unknown reaction '${key}'`);
  }

  // Current pulse contribution (0..strength), decaying linearly over the window.
  _pulseAmount() {
    const now = (typeof performance !== 'undefined' ? performance.now() : 0);
    if (now >= this._pulseUntil) return 0;
    return this._pulseStrength * ((this._pulseUntil - now) / PULSE_MS);
  }

  // ── Contract: render ───────────────────────────────────────────────────
  render(sourceCanvas, ctx) {
    if (!this._bridge) {
      // Inert passthrough when WebGL is unavailable.
      if (ctx && typeof ctx.drawImage === 'function') {
        ctx.drawImage(sourceCanvas, 0, 0, this._w, this._h);
      }
      return;
    }

    // Real elapsed time -> frame-rate-independent warp/decay.
    const now = performance.now();
    let dt = (now - this._lastT) / 1000;
    if (!Number.isFinite(dt) || dt <= 0) dt = 1 / 60;
    if (dt > 0.1) dt = 0.1; // clamp long stalls (tab backgrounded) so trails don't jump
    this._lastT = now;
    const dtScale = dt * 60; // ~1 at 60fps

    const pulse = this._pulseAmount();
    // Pulse pushes persistence toward a near-hold value and kicks the zoom.
    const persistenceBase = this._persistence;
    const persistence = clamp(
      persistenceBase + pulse * (PULSE_HOLD - persistenceBase),
      0,
      0.995
    );
    const zoomBase = this._zoom + pulse * PULSE_ZOOM_KICK;

    const u = {
      persistence: Math.pow(persistence, dtScale),
      sourceGain: this._sourceGain,
      blend: this._blend,
      // Clamp the time-scaled zoom positive: a low `feedbackZoom` (the
      // internal floor is 0.5) plus a long-stall frame (dtScale up to ~6)
      // could otherwise drive this <= 0, and the shader divides by it.
      zoom: clamp(1 + (zoomBase - 1) * dtScale, 0.5, 2),
      rotate: this._rotateRadPerSec * this._spinSign * dt,
      shiftX: this._shiftXPerFrame * dtScale,
      shiftY: this._shiftYPerFrame * dtScale,
      hue: this._hueRadPerSec * dt
    };

    this._bridge.render(sourceCanvas, u);

    ctx.save();
    ctx.globalCompositeOperation = 'copy';
    ctx.drawImage(this._bridge.canvas, 0, 0);
    ctx.restore();
  }
}
