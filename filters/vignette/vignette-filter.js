/**
 * Vignette Filter — GPU-rendered elliptical vignette
 *
 * Two independently configurable regions:
 *   frame (border) — color tint, blur, brightness/contrast/saturate/hue
 *   glass (center) — same filters plus lens distortion and zoom
 *
 * Builds a WebGL post-process from the GLSL shaders in
 * `lib/vignette-shader.js`. Uses an offscreen canvas as the GL
 * surface, samples the source canvas as a texture, then composites
 * the result back through the harness's filter-output 2D context.
 *
 * The schema + shader files are bundled alongside (`lib/`) so this
 * filter is fully self-contained.
 */

import { vignetteSchema } from './lib/vignette-schema.js';
import { VIGNETTE_VERT, VIGNETTE_FRAG } from './lib/vignette-shader.js';

export const key = 'vignette';
export const label = 'Vignette';
export const type = 'filter';
export const category = 'demos';
export const description = 'Elliptical vignette with independent frame/glass color, blur, brightness, contrast, and lens distortion';
export const params = vignetteSchema;

// ============================================================================
// Helpers
// ============================================================================

function parseHex(hex, fallback) {
  if (!hex || typeof hex !== 'string' || !hex.startsWith('#')) return fallback || [0, 0, 0];
  const h = hex.slice(1);
  return [
    parseInt(h.slice(0, 2), 16) / 255 || 0,
    parseInt(h.slice(2, 4), 16) / 255 || 0,
    parseInt(h.slice(4, 6), 16) / 255 || 0
  ];
}

/**
 * Extract vignette config from pipeline params (flat dot-notation keys).
 * Returns the uniform-ready values for the shader.
 */
function extractConfig(c) {
  if (!c) return null;
  const fc = parseHex(c['frame.color'], [0, 0, 0]);
  const gc = parseHex(c['glass.color'], [0, 0, 0]);
  return {
    sizeX: (c.sizeX ?? 50) / 100,
    sizeY: (c.sizeY ?? 50) / 100,
    softness: (c.softness ?? 0) / 100,
    frameColor: [...fc, c['frame.opacity'] ?? 1],
    frameFilters: [
      c['frame.brightness'] ?? 1,
      c['frame.contrast'] ?? 1,
      c['frame.saturate'] ?? 1,
      c['frame.hueRotate'] ?? 0
    ],
    frameBlur: c['frame.blur'] ?? 0,
    glassColor: [...gc, c['glass.opacity'] ?? 0],
    glassFilters: [
      c['glass.brightness'] ?? 1,
      c['glass.contrast'] ?? 1,
      c['glass.saturate'] ?? 1,
      c['glass.hueRotate'] ?? 0
    ],
    glassBlur: c['glass.blur'] ?? 0,
    glassLens: c['glass.lens'] ?? 0,
    glassLensPower: c['glass.lensPower'] ?? 2,
    glassZoom: c['glass.zoom'] ?? 1
  };
}

// ============================================================================
// WebGL Bridge (inline — same pattern as view-mode and rain-glass)
// ============================================================================

function createVignetteBridge(width, height) {
  // Guard so the filter constructs headless (degrades to a passthrough) like
  // every other filter in the bundle.
  if (typeof document === 'undefined' || typeof document.createElement !== 'function') return null;
  const offscreen = document.createElement('canvas');
  offscreen.width = width;
  offscreen.height = height;

  const gl = offscreen.getContext('webgl2', { alpha: true, premultipliedAlpha: false, preserveDrawingBuffer: true })
          || offscreen.getContext('webgl', { alpha: true, premultipliedAlpha: false, preserveDrawingBuffer: true });
  if (!gl) {
    console.warn('[VignetteFilter] WebGL not available — vignette disabled');
    return null;
  }

  // Compile shaders
  let shader = null;
  let quadVBO = null;
  try {
    const vs = gl.createShader(gl.VERTEX_SHADER);
    gl.shaderSource(vs, VIGNETTE_VERT);
    gl.compileShader(vs);
    if (!gl.getShaderParameter(vs, gl.COMPILE_STATUS)) {
      console.error('[VignetteFilter] vert:', gl.getShaderInfoLog(vs));
      return null;
    }
    const fs = gl.createShader(gl.FRAGMENT_SHADER);
    // Patch the shared shader to preserve input alpha instead of hardcoding 1.0.
    // When bgFilterProtect is active, the input has transparent regions (no content).
    // Preserving alpha lets the background show through those regions after compositing.
    // When bgFilterProtect is off, the input is always opaque (alpha=1), so this is a no-op.
    const fragSrc = VIGNETTE_FRAG.replace(
      'gl_FragColor = vec4(result, 1.0);',
      'gl_FragColor = vec4(result, texture2D(u_scene, v_uv).a);'
    );
    gl.shaderSource(fs, fragSrc);
    gl.compileShader(fs);
    if (!gl.getShaderParameter(fs, gl.COMPILE_STATUS)) {
      console.error('[VignetteFilter] frag:', gl.getShaderInfoLog(fs));
      return null;
    }
    const program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error('[VignetteFilter] link:', gl.getProgramInfoLog(program));
      return null;
    }

    const uCache = {};
    const u = name => {
      if (!(name in uCache)) uCache[name] = gl.getUniformLocation(program, name);
      return uCache[name];
    };
    shader = { program, u, aPosition: gl.getAttribLocation(program, 'a_position') };

    quadVBO = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quadVBO);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  } catch (e) {
    console.error('[VignetteFilter] init failed:', e.message);
    return null;
  }

  // Source texture
  const sourceTexture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, sourceTexture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  let cfg = null;

  return {
    canvas: offscreen,

    setConfig(config) { cfg = config; },

    render(sourceCanvas) {
      if (!cfg) return;
      const w = sourceCanvas.width;
      const h = sourceCanvas.height;
      if (offscreen.width !== w || offscreen.height !== h) {
        offscreen.width = w;
        offscreen.height = h;
      }

      // Upload source
      gl.bindTexture(gl.TEXTURE_2D, sourceTexture);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, sourceCanvas);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);

      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, w, h);
      gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.CULL_FACE);
      gl.useProgram(shader.program);

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, sourceTexture);
      gl.uniform1i(shader.u('u_scene'), 0);

      gl.uniform2f(shader.u('u_resolution'), w, h);
      gl.uniform1f(shader.u('u_sizeX'), cfg.sizeX);
      gl.uniform1f(shader.u('u_sizeY'), cfg.sizeY);
      gl.uniform1f(shader.u('u_softness'), cfg.softness);

      gl.uniform4fv(shader.u('u_frameColor'), cfg.frameColor);
      gl.uniform4fv(shader.u('u_frameFilters'), cfg.frameFilters);
      gl.uniform1f(shader.u('u_frameBlur'), cfg.frameBlur);

      gl.uniform4fv(shader.u('u_glassColor'), cfg.glassColor);
      gl.uniform4fv(shader.u('u_glassFilters'), cfg.glassFilters);
      gl.uniform1f(shader.u('u_glassBlur'), cfg.glassBlur);
      gl.uniform1f(shader.u('u_glassLens'), cfg.glassLens);
      gl.uniform1f(shader.u('u_glassLensPower'), cfg.glassLensPower);
      gl.uniform1f(shader.u('u_glassZoom'), cfg.glassZoom);

      gl.bindBuffer(gl.ARRAY_BUFFER, quadVBO);
      gl.enableVertexAttribArray(shader.aPosition);
      gl.vertexAttribPointer(shader.aPosition, 2, gl.FLOAT, false, 0, 0);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    },

    resize(w, h) {
      offscreen.width = w;
      offscreen.height = h;
    },

    cleanup() {
      if (shader?.program) gl.deleteProgram(shader.program);
      if (quadVBO) gl.deleteBuffer(quadVBO);
      if (sourceTexture) gl.deleteTexture(sourceTexture);
      const ext = gl.getExtension('WEBGL_lose_context');
      if (ext) ext.loseContext();
    }
  };
}

// ============================================================================
// Filter Class
// ============================================================================

export default class VignetteFilter {
  constructor(width, height, params = {}) {
    this._bridge = createVignetteBridge(width, height);
    this._applyParams(params);
  }

  _applyParams(params) {
    if (this._bridge) {
      this._bridge.setConfig(extractConfig(params));
    }
  }

  isActive() {
    return !!this._bridge;
  }

  render(sourceCanvas, ctx) {
    if (!this._bridge) {
      // No WebGL (or headless) — pass the source through unchanged.
      if (ctx && typeof ctx.drawImage === 'function') ctx.drawImage(sourceCanvas, 0, 0);
      return;
    }

    this._bridge.render(sourceCanvas);

    ctx.save();
    ctx.globalCompositeOperation = 'copy';
    ctx.drawImage(this._bridge.canvas, 0, 0);
    ctx.restore();
  }

  updateConfig(params) {
    this._applyParams(params);
  }

  setModulatedValues(values) {
    this._applyParams(values);
  }

  resize(width, height) {
    if (this._bridge) {
      this._bridge.resize(width, height);
    }
  }

  cleanup() {
    if (this._bridge) {
      this._bridge.cleanup();
      this._bridge = null;
    }
  }
}
