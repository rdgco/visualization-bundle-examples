/**
 * Ripple Filter — animated wave / heat-haze displacement
 *
 * The first of the GPU-displacement family: a stateless spatial warp (no
 * retained buffer — distinct from the temporal filters). It samples the scene
 * through an animated sine field, so the whole layer undulates like water, a
 * heat-haze, or an underwater wobble. WebGL because smooth per-pixel UV
 * displacement is a shader's home turf; mirrors vignette's inline GL bridge.
 *
 * Modes: horizontal / vertical waves, radial concentric ripples (a water-drop
 * spreading from the centre), or a 2D shimmer. `waveAmount` / `waveCount` /
 * `waveSpeed` shape it; the `pulse` reaction swells the waves on a beat.
 *
 * `u_time` advances from wall-clock so the motion is frame-rate independent.
 * Every continuous attribute is audio-bindable — bind `waveAmount` to the beat
 * and the whole image breathes.
 */

import { RIPPLE_VERT, RIPPLE_FRAG } from './lib/ripple-shader.js';

export const key = 'ripple';
export const label = 'Ripple';
export const type = 'filter';
export const category = 'demos';
export const description =
  'Animated wave displacement: samples the layer through a moving sine field ' +
  'so it undulates like water or heat-haze. First of the GPU-displacement ' +
  'family (a stateless warp, no retained buffer). Modes: horizontal / vertical ' +
  'waves, radial concentric ripples, or 2D shimmer. `waveAmount`/`waveCount`/' +
  '`waveSpeed` shape it; `pulse` swells the waves on a beat. Every attribute is ' +
  'audio-bindable.';

const MODES = ['horizontal', 'vertical', 'radial', 'both'];
const MODE_INT = { horizontal: 0, vertical: 1, radial: 2, both: 3 };

// Cross-host audio-modulation marker (see other filters for the rationale).
const audioMod = defaultAmount => ({
  kind: 'audio',
  sourceTypes: ['audio', 'oneshot', 'note', 'tempo', 'lfo', 'random'],
  defaultAmount
});

export const params = {
  mode: {
    type: 'enum',
    label: 'Mode',
    options: MODES,
    default: 'radial',
    description:
      'horizontal / vertical = a travelling wave along one axis; radial = ' +
      'concentric ripples spreading from the centre (water-drop); both = a 2D ' +
      'shimmer.',
    paramGroup: 'ripple',
    paramGroupLabel: 'Ripple',
    paramGroupCollapsed: false
  },
  waveAmount: {
    type: 'number',
    label: 'Amount',
    default: 0.02,
    min: 0,
    max: 0.1,
    step: 0.001,
    description:
      'Displacement amplitude, as a fraction of the frame. 0 = no ripple; ' +
      '~0.02 is a gentle wobble; 0.1 is a strong warp. *audio-bindable*',
    modulation: audioMod(0.03),
    paramGroup: 'ripple'
  },
  waveCount: {
    type: 'number',
    label: 'Frequency',
    default: 8,
    min: 1,
    max: 40,
    step: 0.5,
    description: 'How many wave crests span the frame. Low = big rolling swells; high = fine ripples.',
    modulation: audioMod(6),
    paramGroup: 'ripple'
  },
  waveSpeed: {
    type: 'number',
    label: 'Speed',
    default: 1.5,
    min: 0,
    max: 6,
    step: 0.05,
    description: 'How fast the waves travel (0 = frozen ripples). Radians/second of phase.',
    modulation: audioMod(2),
    paramGroup: 'ripple'
  },
  centerX: {
    type: 'number',
    label: 'Centre X',
    default: 0.5,
    min: 0,
    max: 1,
    step: 0.01,
    description: 'radial mode: horizontal origin of the ripples (fraction of width).',
    modulation: audioMod(0.3),
    paramGroup: 'ripple'
  },
  centerY: {
    type: 'number',
    label: 'Centre Y',
    default: 0.5,
    min: 0,
    max: 1,
    step: 0.01,
    description: 'radial mode: vertical origin of the ripples (fraction of height).',
    modulation: audioMod(0.3),
    paramGroup: 'ripple'
  }
};

export const reactions = {
  pulse: {
    label: 'Ripple pulse',
    description:
      'Swell the waves on a transient (~450ms decaying envelope): the ' +
      'displacement jumps, then settles back to the baseline `waveAmount`. ' +
      'Fire on a beat to make the image lurch.',
    args: {
      strength: {
        type: 'number',
        label: 'Strength',
        default: 1,
        min: 0,
        max: 1,
        step: 0.01,
        description: 'Peak extra amplitude the pulse adds.'
      }
    }
  }
};

const PULSE_MS = 450;
const PULSE_AMP_BOOST = 0.05; // extra waveAmount at a full pulse's peak

// ── pure helpers (exported for unit tests) ──────────────────────────────
export function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}
export function modeToInt(mode) {
  return MODE_INT[mode] ?? MODE_INT.radial;
}

// ── WebGL bridge (inline — single full-screen pass; mirrors vignette) ────
function createBridge(width, height) {
  if (typeof document === 'undefined' || typeof document.createElement !== 'function') return null;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const opts = { alpha: true, premultipliedAlpha: false, preserveDrawingBuffer: true };
  const gl = canvas.getContext('webgl2', opts) || canvas.getContext('webgl', opts);
  if (!gl) { console.warn('[RippleFilter] WebGL unavailable — disabled'); return null; }

  function sh(type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { console.error('[RippleFilter]', gl.getShaderInfoLog(s)); return null; }
    return s;
  }
  const vs = sh(gl.VERTEX_SHADER, RIPPLE_VERT);
  const fs = sh(gl.FRAGMENT_SHADER, RIPPLE_FRAG);
  if (!vs || !fs) return null;
  const prog = gl.createProgram();
  gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { console.error('[RippleFilter]', gl.getProgramInfoLog(prog)); return null; }

  const uCache = {};
  const u = name => (name in uCache ? uCache[name] : (uCache[name] = gl.getUniformLocation(prog, name)));
  const aPos = gl.getAttribLocation(prog, 'a_position');
  const vbo = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);

  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  return {
    canvas,
    render(sourceCanvas, cfg) {
      const w = sourceCanvas.width, h = sourceCanvas.height;
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, sourceCanvas);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);

      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, w, h);
      gl.useProgram(prog);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.uniform1i(u('u_scene'), 0);
      gl.uniform2f(u('u_resolution'), w, h);
      gl.uniform1f(u('u_time'), cfg.time);
      gl.uniform1f(u('u_amp'), cfg.amp);
      gl.uniform1f(u('u_freq'), cfg.freq);
      gl.uniform1f(u('u_speed'), cfg.speed);
      gl.uniform1i(u('u_mode'), cfg.mode);
      gl.uniform2f(u('u_center'), cfg.centerX, cfg.centerY);
      gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
      gl.enableVertexAttribArray(aPos);
      gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    },
    cleanup() {
      gl.deleteTexture(tex); gl.deleteBuffer(vbo); gl.deleteProgram(prog);
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    }
  };
}

export default class RippleFilter {
  constructor(width, height, initialParams = {}) {
    this._w = width;
    this._h = height;
    this._mode = MODE_INT.radial;
    this._amp = 0.02;
    this._freq = 8;
    this._speed = 1.5;
    this._centerX = 0.5;
    this._centerY = 0.5;

    this._time = 0;
    this._lastT = (typeof performance !== 'undefined' ? performance.now() : 0);
    this._pulseUntil = 0;
    this._pulseStrength = 0;

    this._bridge = createBridge(width, height);
    this._applyParams(initialParams);
  }

  _applyParams(p) {
    if (!p) return;
    if (typeof p.mode === 'string' && p.mode in MODE_INT) this._mode = MODE_INT[p.mode];
    if (typeof p.waveAmount === 'number' && Number.isFinite(p.waveAmount)) this._amp = clamp(p.waveAmount, 0, 0.1);
    if (typeof p.waveCount === 'number' && Number.isFinite(p.waveCount)) this._freq = clamp(p.waveCount, 1, 40);
    if (typeof p.waveSpeed === 'number' && Number.isFinite(p.waveSpeed)) this._speed = clamp(p.waveSpeed, 0, 6);
    if (typeof p.centerX === 'number' && Number.isFinite(p.centerX)) this._centerX = clamp(p.centerX, 0, 1);
    if (typeof p.centerY === 'number' && Number.isFinite(p.centerY)) this._centerY = clamp(p.centerY, 0, 1);
  }

  updateParams(p) { this._applyParams(p); }
  updateConfig(p) { this._applyParams(p); }
  setConfig(p) { this._applyParams(p); }
  setModulatedValues(p) { this._applyParams(p); }

  isActive() { return !!this._bridge; }

  resize(width, height) { this._w = width; this._h = height; }

  cleanup() {
    if (this._bridge) { this._bridge.cleanup(); this._bridge = null; }
  }

  react(key, args = {}) {
    if (key === 'pulse') {
      this._pulseStrength = typeof args.strength === 'number' ? clamp(args.strength, 0, 1) : 1;
      this._pulseUntil = (typeof performance !== 'undefined' ? performance.now() : 0) + PULSE_MS;
      return;
    }
    throw new Error(`ripple: unknown reaction '${key}'`);
  }

  _pulseAmount() {
    const now = (typeof performance !== 'undefined' ? performance.now() : 0);
    if (now >= this._pulseUntil) return 0;
    return this._pulseStrength * ((this._pulseUntil - now) / PULSE_MS);
  }

  render(sourceCanvas, ctx) {
    if (!this._bridge) {
      if (ctx && typeof ctx.drawImage === 'function') ctx.drawImage(sourceCanvas, 0, 0, this._w, this._h);
      return;
    }
    const now = performance.now();
    let dt = (now - this._lastT) / 1000;
    if (!Number.isFinite(dt) || dt < 0) dt = 0;
    if (dt > 0.1) dt = 0.1;
    this._lastT = now;
    this._time += dt;

    const amp = clamp(this._amp + this._pulseAmount() * PULSE_AMP_BOOST, 0, 0.2);
    this._bridge.render(sourceCanvas, {
      time: this._time, amp, freq: this._freq, speed: this._speed,
      mode: this._mode, centerX: this._centerX, centerY: this._centerY
    });

    ctx.save();
    ctx.globalCompositeOperation = 'copy';
    ctx.drawImage(this._bridge.canvas, 0, 0);
    ctx.restore();
  }
}
