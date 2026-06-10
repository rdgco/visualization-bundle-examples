/**
 * Twirl Filter — polar warp (twirl / pinch / fisheye)
 *
 * Third of the GPU-displacement family, closing out the filter epic. Remaps the
 * sample coordinate in polar space around a centre, within a radius:
 *   twirl   — spin the image into a spiral (angle falls off centre→edge)
 *   pinch   — squeeze inward (signed: negative bulges out)
 *   fisheye — barrel / pincushion lens (negative inverts)
 *
 * A non-affine warp — which is exactly why it's WebGL and not Canvas2D (you
 * can't do a per-pixel polar remap with `drawImage`). Stateless: no retained
 * buffer; mirrors vignette's inline GL bridge.
 *
 * `strength` is signed, so each mode covers both directions. The `pulse`
 * reaction throbs the warp on a beat. Every continuous attribute is
 * audio-bindable — bind `strength` to an LFO for a slow breathing lens, or to
 * audio for a beat-reactive twist.
 */

import { TWIRL_VERT, TWIRL_FRAG } from './lib/twirl-shader.js';

export const key = 'twirl';
export const label = 'Twirl';
export const type = 'filter';
export const category = 'demos';
export const description =
  'Polar warp around a centre: twirl (spin into a spiral), pinch (squeeze ' +
  'inward; negative bulges out), or fisheye (barrel / pincushion lens). A ' +
  'non-affine warp — WebGL, not Canvas2D. Third of the GPU-displacement ' +
  'family (a stateless warp). `strength` is signed; `radius` sets the affected ' +
  'area; `pulse` throbs it on a beat. Every attribute is audio-bindable — bind ' +
  'strength to an LFO for a breathing lens.';

const MODES = ['twirl', 'pinch', 'fisheye'];
const MODE_INT = { twirl: 0, pinch: 1, fisheye: 2 };

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
    default: 'twirl',
    description:
      'twirl = spin into a spiral; pinch = squeeze toward the centre (negative ' +
      '`strength` bulges outward); fisheye = barrel lens (negative = ' +
      'pincushion).',
    paramGroup: 'twirl',
    paramGroupLabel: 'Twirl',
    paramGroupCollapsed: false
  },
  strength: {
    type: 'number',
    label: 'Strength',
    default: 0.5,
    min: -1,
    max: 1,
    step: 0.01,
    description:
      'Warp amount, signed. 0 = none. For twirl, the sign is the spin ' +
      'direction (±1 ≈ a full turn at the centre); for pinch / fisheye, ' +
      'positive and negative are the two opposite distortions. *audio-bindable*',
    modulation: audioMod(0.5),
    paramGroup: 'twirl'
  },
  radius: {
    type: 'number',
    label: 'Radius',
    default: 0.7,
    min: 0.1,
    max: 1.5,
    step: 0.01,
    description:
      'How far the warp reaches from the centre (fraction of the frame). The ' +
      'effect is strongest at the centre and eases to none at the radius edge.',
    modulation: audioMod(0.3),
    paramGroup: 'twirl'
  },
  centerX: {
    type: 'number',
    label: 'Centre X',
    default: 0.5,
    min: 0,
    max: 1,
    step: 0.01,
    description: 'Horizontal centre of the warp (fraction of width).',
    modulation: audioMod(0.3),
    paramGroup: 'twirl'
  },
  centerY: {
    type: 'number',
    label: 'Centre Y',
    default: 0.5,
    min: 0,
    max: 1,
    step: 0.01,
    description: 'Vertical centre of the warp (fraction of height).',
    modulation: audioMod(0.3),
    paramGroup: 'twirl'
  }
};

export const reactions = {
  pulse: {
    label: 'Twirl pulse',
    description:
      'Throb the warp on a transient (~400ms decaying envelope): the strength ' +
      'swells (in whichever direction it is set), then settles back. Fire on a ' +
      'beat for a lens that breathes with the music.',
    args: {
      strength: {
        type: 'number',
        label: 'Strength',
        default: 1,
        min: 0,
        max: 1,
        step: 0.01,
        description: 'How hard the pulse intensifies the warp at its peak.'
      }
    }
  }
};

const PULSE_MS = 400;
const PULSE_BOOST = 1.2; // fraction the warp magnitude swells at a full pulse's peak

// ── pure helpers (exported for unit tests) ──────────────────────────────
export function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}
export function modeToInt(mode) {
  return MODE_INT[mode] ?? MODE_INT.twirl;
}

// ── WebGL bridge (inline — single full-screen pass; mirrors vignette) ────
function createBridge(width, height) {
  if (typeof document === 'undefined' || typeof document.createElement !== 'function') return null;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const opts = { alpha: true, premultipliedAlpha: false, preserveDrawingBuffer: true };
  const gl = canvas.getContext('webgl2', opts) || canvas.getContext('webgl', opts);
  if (!gl) { console.warn('[TwirlFilter] WebGL unavailable — disabled'); return null; }

  function sh(type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { console.error('[TwirlFilter]', gl.getShaderInfoLog(s)); return null; }
    return s;
  }
  const vs = sh(gl.VERTEX_SHADER, TWIRL_VERT);
  const fs = sh(gl.FRAGMENT_SHADER, TWIRL_FRAG);
  if (!vs || !fs) return null;
  const prog = gl.createProgram();
  gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { console.error('[TwirlFilter]', gl.getProgramInfoLog(prog)); return null; }

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
      gl.uniform1f(u('u_strength'), cfg.strength);
      gl.uniform1f(u('u_radius'), cfg.radius);
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

export default class TwirlFilter {
  constructor(width, height, initialParams = {}) {
    this._w = width;
    this._h = height;
    this._mode = MODE_INT.twirl;
    this._strength = 0.5;
    this._radius = 0.7;
    this._centerX = 0.5;
    this._centerY = 0.5;

    this._pulseUntil = 0;
    this._pulseStrength = 0;

    this._bridge = createBridge(width, height);
    this._applyParams(initialParams);
  }

  _applyParams(p) {
    if (!p) return;
    if (typeof p.mode === 'string' && p.mode in MODE_INT) this._mode = MODE_INT[p.mode];
    if (typeof p.strength === 'number' && Number.isFinite(p.strength)) this._strength = clamp(p.strength, -1, 1);
    if (typeof p.radius === 'number' && Number.isFinite(p.radius)) this._radius = clamp(p.radius, 0.1, 1.5);
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
    throw new Error(`twirl: unknown reaction '${key}'`);
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
    // Pulse throbs the warp magnitude in whichever direction it's set.
    const strength = clamp(this._strength * (1 + this._pulseAmount() * PULSE_BOOST), -2, 2);
    this._bridge.render(sourceCanvas, {
      strength, radius: this._radius, mode: this._mode, centerX: this._centerX, centerY: this._centerY
    });

    ctx.save();
    ctx.globalCompositeOperation = 'copy';
    ctx.drawImage(this._bridge.canvas, 0, 0);
    ctx.restore();
  }
}
