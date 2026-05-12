/**
 * WebGL Utility Helpers
 *
 * Shader compilation and buffer creation. Thin wrappers that add
 * error reporting without hiding the WebGL API.
 */

/**
 * Compile a shader from source.
 * @param {WebGLRenderingContext} gl
 * @param {number} type - gl.VERTEX_SHADER or gl.FRAGMENT_SHADER
 * @param {string} source - GLSL source
 * @returns {WebGLShader}
 */
export function compileShader(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    const label = type === gl.VERTEX_SHADER ? 'vertex' : 'fragment';
    throw new Error(`[WebGL] ${label} shader compile failed:\n${info}`);
  }
  return shader;
}

/**
 * Link a program from vertex and fragment shaders.
 * @param {WebGLRenderingContext} gl
 * @param {WebGLShader} vertShader
 * @param {WebGLShader} fragShader
 * @returns {WebGLProgram}
 */
export function linkProgram(gl, vertShader, fragShader) {
  const program = gl.createProgram();
  gl.attachShader(program, vertShader);
  gl.attachShader(program, fragShader);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const info = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error(`[WebGL] program link failed:\n${info}`);
  }
  return program;
}

/**
 * Compile vertex + fragment source and link into a program.
 * Returns the program plus lookup helpers for attributes and uniforms.
 *
 * @param {WebGLRenderingContext} gl
 * @param {string} vertSrc
 * @param {string} fragSrc
 * @returns {{ program: WebGLProgram, attr: function(string): number, uniform: function(string): WebGLUniformLocation }}
 */
export function createShaderProgram(gl, vertSrc, fragSrc) {
  const vs = compileShader(gl, gl.VERTEX_SHADER, vertSrc);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, fragSrc);
  const program = linkProgram(gl, vs, fs);

  // Cache lookups
  const attrCache = {};
  const uniformCache = {};

  return {
    program,
    attr(name) {
      if (!(name in attrCache)) {
        attrCache[name] = gl.getAttribLocation(program, name);
      }
      return attrCache[name];
    },
    uniform(name) {
      if (!(name in uniformCache)) {
        uniformCache[name] = gl.getUniformLocation(program, name);
      }
      return uniformCache[name];
    }
  };
}

/**
 * Parse a CSS hex color string into a GL-ready [r, g, b] float array.
 * Returns the fallback if the input is missing or malformed.
 *
 * @param {string} hex - CSS hex string, e.g. '#2666cc'
 * @param {number[]} [fallback=[0,0,0]] - Default value if hex is invalid
 * @returns {number[]} [r, g, b] in 0-1 range
 */
export function parseColorGL(hex, fallback = [0, 0, 0]) {
  if (!hex || typeof hex !== 'string' || !hex.startsWith('#') || hex.length < 7) return fallback;
  const h = hex.slice(1);
  return [
    parseInt(h.slice(0, 2), 16) / 255,
    parseInt(h.slice(2, 4), 16) / 255,
    parseInt(h.slice(4, 6), 16) / 255
  ];
}

/**
 * Create a VBO from a Float32Array.
 * @param {WebGLRenderingContext} gl
 * @param {Float32Array} data
 * @param {number} [usage=gl.STATIC_DRAW]
 * @returns {WebGLBuffer}
 */
export function createBuffer(gl, data, usage) {
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, data, usage || gl.STATIC_DRAW);
  return buf;
}

/**
 * Load an image URL into a WebGL texture.
 *
 * Returns immediately with a 1×1 placeholder texture. The real image
 * loads asynchronously; when it arrives the texture is updated in place.
 * If the image fails to load, the placeholder remains and a warning is
 * logged — rendering continues without interruption.
 *
 * Works with file://, http://, and data: URLs. In Electron (where
 * central-display.html runs via loadFile), file:// URLs load from
 * the local filesystem without CORS restrictions.
 *
 * @param {WebGLRenderingContext} gl
 * @param {string} url - Image URL
 * @param {Object} [options]
 * @param {number[]} [options.placeholder=[128,128,128,255]] - RGBA bytes for the 1×1 fill
 * @param {boolean} [options.flip=true] - Apply UNPACK_FLIP_Y_WEBGL
 * @param {number} [options.wrap] - Wrap mode override (default: CLAMP_TO_EDGE)
 * @param {number} [options.filter] - Min/mag filter override (default: LINEAR)
 * @returns {{ texture: WebGLTexture, loaded: Promise<boolean> }}
 */
export function loadTexture(gl, url, options = {}) {
  const placeholder = options.placeholder || [128, 128, 128, 255];
  const flip = options.flip !== false; // default true
  const wrap = options.wrap || gl.CLAMP_TO_EDGE;
  const filter = options.filter || gl.LINEAR;

  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);

  // Immediate 1×1 placeholder so the texture is bindable before the image arrives
  gl.texImage2D(
    gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA,
    gl.UNSIGNED_BYTE, new Uint8Array(placeholder)
  );

  // Set default filtering (will be re-applied after image upload)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);

  const loaded = new Promise(resolve => {
    const image = new Image();

    image.onload = () => {
      gl.bindTexture(gl.TEXTURE_2D, texture);
      if (flip) gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
      if (flip) gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);

      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);

      resolve(true);
    };

    image.onerror = () => {
      console.warn(`[WebGL] loadTexture failed: ${url}`);
      resolve(false);
    };

    image.src = url;
  });

  return { texture, loaded };
}
