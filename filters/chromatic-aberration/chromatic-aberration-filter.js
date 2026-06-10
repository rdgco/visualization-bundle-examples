/**
 * Chromatic Aberration Filter — radial RGB lens dispersion
 *
 * Second of the GPU-displacement family. Samples the R / G / B channels at
 * radially-offset coordinates — red pushed outward, blue pulled inward, around
 * a centre — so colour fringes split toward the edges like a cheap wide-angle
 * lens. Tiny `amount` reads as realistic lens fringing; large reads as a
 * prismatic glitch. The `pulse` reaction snaps the split hard on a beat — it
 * maps onto transients better than almost anything.
 *
 * Distinct from `glitch`'s flat `rgb-split` mode (a uniform horizontal offset):
 * this is RADIAL dispersion that scales with distance from the centre.
 *
 * Stateless WebGL warp — no retained buffer; mirrors vignette's inline GL
 * bridge. Every continuous attribute is audio-bindable.
 */

import { ABERRATION_VERT, ABERRATION_FRAG } from './lib/chromatic-aberration-shader.js';

export const key = 'chromatic-aberration';
export const label = 'Chromatic Aberration';
export const type = 'filter';
export const category = 'demos';
export const description =
  'Radial RGB lens dispersion: samples red/green/blue at radially-offset ' +
  'coordinates so colour fringes split toward the edges like a cheap lens. ' +
  'Tiny = realistic lens fringing; large = prismatic glitch. Second of the ' +
  'GPU-displacement family (a stateless warp). `amount` sets the split, ' +
  '`power` how edge-biased it is; `pulse` snaps the split on a beat. Distinct ' +
  "from glitch's flat rgb-split — this is radial. Every attribute is audio-bindable.";

// Cross-host audio-modulation marker (see other filters for the rationale).
const audioMod = defaultAmount => ({
  kind: 'audio',
  sourceTypes: ['audio', 'oneshot', 'note', 'tempo', 'lfo', 'random'],
  defaultAmount
});

export const params = {
  amount: {
    type: 'number',
    label: 'Amount',
    default: 0.02,
    min: 0,
    max: 0.15,
    step: 0.001,
    description:
      'Dispersion strength — how far the R/B channels split at the edges ' +
      '(fraction of the frame). ~0.01 lens-realistic; >0.05 prismatic. ' +
      'The transient knob — bind to peak or fire `pulse`.',
    modulation: audioMod(0.04),
    paramGroup: 'aberration',
    paramGroupLabel: 'Aberration',
    paramGroupCollapsed: false
  },
  power: {
    type: 'number',
    label: 'Edge Bias',
    default: 2,
    min: 0.5,
    max: 4,
    step: 0.05,
    description:
      'How the split ramps from centre to edge. 1 = linear; higher = the ' +
      'fringing stays clear in the middle and concentrates hard at the edges ' +
      '(more lens-like).',
    modulation: audioMod(1),
    paramGroup: 'aberration'
  },
  centerX: {
    type: 'number',
    label: 'Centre X',
    default: 0.5,
    min: 0,
    max: 1,
    step: 0.01,
    description: 'Horizontal point the dispersion radiates from (fraction of width).',
    modulation: audioMod(0.3),
    paramGroup: 'aberration'
  },
  centerY: {
    type: 'number',
    label: 'Centre Y',
    default: 0.5,
    min: 0,
    max: 1,
    step: 0.01,
    description: 'Vertical point the dispersion radiates from (fraction of height).',
    modulation: audioMod(0.3),
    paramGroup: 'aberration'
  }
};

export const reactions = {
  pulse: {
    label: 'Aberration pulse',
    description:
      'Snap the split hard on a transient (~350ms decaying envelope), then ' +
      'settle back to `amount`. Fire on a kick/snare for a prismatic hit.',
    args: {
      strength: {
        type: 'number',
        label: 'Strength',
        default: 1,
        min: 0,
        max: 1,
        step: 0.01,
        description: 'Peak extra split the pulse adds.'
      }
    }
  }
};

const PULSE_MS = 350;
const PULSE_AMOUNT_BOOST = 0.08; // extra amount at a full pulse's peak

// ── pure helpers (exported for unit tests) ──────────────────────────────
export function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

// ── WebGL bridge (inline — single full-screen pass; mirrors vignette) ────
function createBridge(width, height) {
  if (typeof document === 'undefined' || typeof document.createElement !== 'function') return null;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const opts = { alpha: true, premultipliedAlpha: false, preserveDrawingBuffer: true };
  const gl = canvas.getContext('webgl2', opts) || canvas.getContext('webgl', opts);
  if (!gl) { console.warn('[ChromaticAberration] WebGL unavailable — disabled'); return null; }

  function sh(type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { console.error('[ChromaticAberration]', gl.getShaderInfoLog(s)); return null; }
    return s;
  }
  const vs = sh(gl.VERTEX_SHADER, ABERRATION_VERT);
  const fs = sh(gl.FRAGMENT_SHADER, ABERRATION_FRAG);
  if (!vs || !fs) return null;
  const prog = gl.createProgram();
  gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { console.error('[ChromaticAberration]', gl.getProgramInfoLog(prog)); return null; }

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
      gl.uniform1f(u('u_amount'), cfg.amount);
      gl.uniform1f(u('u_power'), cfg.power);
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

export default class ChromaticAberrationFilter {
  constructor(width, height, initialParams = {}) {
    this._w = width;
    this._h = height;
    this._amount = 0.02;
    this._power = 2;
    this._centerX = 0.5;
    this._centerY = 0.5;

    this._pulseUntil = 0;
    this._pulseStrength = 0;

    this._bridge = createBridge(width, height);
    this._applyParams(initialParams);
  }

  _applyParams(p) {
    if (!p) return;
    if (typeof p.amount === 'number' && Number.isFinite(p.amount)) this._amount = clamp(p.amount, 0, 0.15);
    if (typeof p.power === 'number' && Number.isFinite(p.power)) this._power = clamp(p.power, 0.5, 4);
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
    throw new Error(`chromatic-aberration: unknown reaction '${key}'`);
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
    const amount = clamp(this._amount + this._pulseAmount() * PULSE_AMOUNT_BOOST, 0, 0.3);
    this._bridge.render(sourceCanvas, {
      amount, power: this._power, centerX: this._centerX, centerY: this._centerY
    });

    ctx.save();
    ctx.globalCompositeOperation = 'copy';
    ctx.drawImage(this._bridge.canvas, 0, 0);
    ctx.restore();
  }
}
