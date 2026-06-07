/**
 * City Shaders
 *
 * All GLSL shader sources for the city program: buildings (+ roofs),
 * ground plane, and aviation point lights. Shared `CURVE_GLSL` is
 * prepended to every vertex shader so the whole scene curves
 * consistently with the compositor's sphere mode.
 *
 * File: compositor/content/webgl/objects/city/shaders.js
 */

// Shared curvature GLSL — prepended to all vertex shaders.
export const CURVE_GLSL = `
  uniform float u_curvature;
  uniform float u_sphereRadius;

  vec3 curvePosition(vec3 flatPos) {
    if (u_curvature < 0.001) return flatPos;
    float R = u_sphereRadius;
    float theta = flatPos.x / R;
    float phi = flatPos.z / R;
    float ct = cos(theta), st = sin(theta);
    float cp = cos(phi), sp = sin(phi);
    vec3 surfNorm = vec3(st * cp, ct * cp, sp);
    vec3 surfPt = vec3(0.0, -R, 0.0) + surfNorm * R;
    return mix(flatPos, surfPt + surfNorm * flatPos.y, u_curvature);
  }
`;

export const BUILDING_VERT = CURVE_GLSL + `
  attribute vec3 a_position;
  attribute vec3 a_normal;
  attribute vec3 a_localPos;  // faceU (0..1 along face), faceV (0..1 up segment), 0
  attribute vec4 a_meta;      // buildingId, faceWidth, segmentHeight, reserved
  attribute vec3 a_color;
  attribute float a_variation;

  uniform mat4 u_viewProj;

  varying vec3 v_worldPos;
  varying vec3 v_localPos;
  varying vec3 v_normal;
  varying vec4 v_meta;
  varying vec3 v_color;
  varying float v_variation;

  void main() {
    vec3 curved = curvePosition(a_position);
    v_worldPos = curved;
    v_localPos = a_localPos;
    v_normal = a_normal;
    v_meta = a_meta;
    v_color = a_color;
    v_variation = a_variation;
    gl_Position = u_viewProj * vec4(curved, 1.0);
  }
`;

export const BUILDING_FRAG = `
  precision mediump float;

  uniform float u_lightRatio;
  uniform float u_windowScale;
  uniform float u_floorHeight;
  uniform float u_streetGlow;
  uniform float u_colorVariance;
  uniform float u_time;
  uniform float u_sunIntensity;
  uniform vec3  u_lightColor;
  uniform float u_facadeVariety;  // 0 = all standard punched windows; 1 = rich curtain-wall / small-gap mix
  uniform float u_lightFill;      // fraction of each window pane that actually emits light

  // ---- Pulse-reaction surface waves ----
  // Up to 4 concurrent waves. Each slot's geometry is baked at injection
  // time, so concurrent waves can travel different axes (vertical-up,
  // vertical-down, radial-from-origin) without interfering. The shader
  // computes axisCoord per slot from u_waveMode[i], gaussians the distance
  // to u_wavePos[i], and sums the contributions.
  //
  // Modes: 0 = vertical-up, 1 = vertical-down, 2 = radial-from-origin.
  // Pos/amp/width/mode are parallel float arrays (vec4 each, one per slot).
  // Origin is only meaningful for mode 2; ignored otherwise.
  uniform vec4 u_wavePos;
  uniform vec4 u_waveAmp;
  uniform vec4 u_waveWidth;
  uniform vec4 u_waveMode;
  uniform vec4 u_waveOriginX;
  uniform vec4 u_waveOriginZ;
  uniform float u_waveMaxHeight;
  uniform float u_waveCityRadius;

  varying vec3  v_worldPos;
  varying vec3  v_localPos;
  varying vec3  v_normal;
  varying vec4  v_meta;
  varying vec3  v_color;
  varying float v_variation;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float hash2(vec2 p) { return fract(sin(dot(p, vec2(269.5, 183.3))) * 27361.894); }

  // Sum the gaussian contributions of the 4 wave slots at this fragment.
  // Each slot picks its own axis coordinate based on its mode, so concurrent
  // waves with different strategies coexist without reinterpretation.
  //
  // Manually unrolled for WebGL 1 / GLSL ES 1.00 portability: dynamic
  // indexing into a vec4 inside a fragment-shader loop is implementation-
  // defined and rejected by some drivers. The fractal program's wave
  // implementation follows the same pattern.
  float computeWaveSlot(float pos, float amp, float width, float mode,
                        float originX, float originZ, vec3 worldPos) {
    if (amp < 0.001) return 0.0;
    float maxH = max(u_waveMaxHeight, 0.001);
    float cityR = max(u_waveCityRadius, 0.001);
    float axisCoord;
    if (mode < 0.5) {
      // vertical-up: 0 at ground, ~1 at the tallest building's top
      axisCoord = worldPos.y / maxH;
    } else if (mode < 1.5) {
      // vertical-down: 0 at the tallest building's top, ~1 at ground
      axisCoord = 1.0 - worldPos.y / maxH;
    } else {
      // radial-from-origin: 0 at origin XZ, ~1 at the city's edge
      vec2 d = worldPos.xz - vec2(originX, originZ);
      axisCoord = length(d) / cityR;
    }
    float dnorm = (axisCoord - pos) / max(width, 0.01);
    return amp * exp(-dnorm * dnorm);
  }

  float computeWaveBoost(vec3 worldPos) {
    float total = 0.0;
    total += computeWaveSlot(u_wavePos.x, u_waveAmp.x, u_waveWidth.x,
                             u_waveMode.x, u_waveOriginX.x, u_waveOriginZ.x, worldPos);
    total += computeWaveSlot(u_wavePos.y, u_waveAmp.y, u_waveWidth.y,
                             u_waveMode.y, u_waveOriginX.y, u_waveOriginZ.y, worldPos);
    total += computeWaveSlot(u_wavePos.z, u_waveAmp.z, u_waveWidth.z,
                             u_waveMode.z, u_waveOriginX.z, u_waveOriginZ.z, worldPos);
    total += computeWaveSlot(u_wavePos.w, u_waveAmp.w, u_waveWidth.w,
                             u_waveMode.w, u_waveOriginX.w, u_waveOriginZ.w, worldPos);
    return total;
  }

  void main() {
    float buildingId = v_meta.x;
    float faceW = v_meta.y;   // physical width of this face (baked per vertex)
    float segH  = v_meta.z;   // physical height of this segment
    vec3 n = normalize(v_normal);
    bool isSide = abs(n.y) < 0.5;
    bool isTop = n.y > 0.5;

    vec3 sunDir = normalize(vec3(0.4, 0.75, 0.3));
    float sunDiff = max(0.0, dot(n, sunDir)) * u_sunIntensity;
    float sunAmb = 0.12 * u_sunIntensity;
    float nightAmb = 1.0 - u_sunIntensity * 0.6;

    float groundProx = 1.0 - smoothstep(0.0, 0.3, v_localPos.y);
    float streetLight = groundProx * u_streetGlow * nightAmb;

    if (isTop) {
      gl_FragColor = vec4(v_color * (0.45 * nightAmb + sunAmb + sunDiff * 0.8), 1.0);
      return;
    }
    if (!isSide) {
      gl_FragColor = vec4(v_color * (0.25 * nightAmb + sunAmb * 0.5), 1.0);
      return;
    }

    // per-building window variation. faceU/faceV are baked by the geometry
    // emitter (0..1 along the face width and up the segment), so the grid
    // wraps any footprint — box, bevel, chop, ell, or cylinder facet.
    float localWS = u_windowScale * (0.7 + v_variation * 0.6);
    float localFH = u_floorHeight * (0.75 + hash2(vec2(buildingId, 3.0)) * 0.5);

    float u = v_localPos.x;   // 0..1 along the face
    float v = v_localPos.y;   // 0..1 up the segment

    float cols = max(1.0, floor(faceW / localWS));
    float rows = max(1.0, floor(segH / localFH));
    float cellU = u * cols, cellV = v * rows;
    float col = floor(cellU), row = floor(cellV);
    float inU = fract(cellU), inV = fract(cellV);

    // Facade style per building, blended in by u_facadeVariety:
    //   standard punched (wide borders) → small-gap → curtain wall (fine mullions).
    float fHash = hash2(vec2(buildingId, 23.0));
    float curtainCut = u_facadeVariety * 0.45;  // glassiest share
    float gapCut     = u_facadeVariety;         // small-gap share; remainder standard
    float mH, mV;
    if (fHash < curtainCut) {
      mH = 0.03 + 0.02 * hash2(vec2(buildingId, 24.0));   // curtain wall: panes nearly touch
      mV = 0.03 + 0.02 * hash2(vec2(buildingId, 25.0));
    } else if (fHash < gapCut) {
      mH = 0.08 + 0.04 * hash2(vec2(buildingId, 24.0));   // small gaps
      mV = 0.10 + 0.04 * hash2(vec2(buildingId, 25.0));
    } else {
      mH = 0.2 + 0.07 * hash2(vec2(buildingId, 11.0));    // standard punched windows
      mV = 0.16 + 0.09 * hash2(vec2(buildingId, 13.0));
    }
    bool inWindow = inU > mH && inU < (1.0-mH) && inV > mV && inV < (1.0-mV);

    if (!inWindow) {
      vec3 wall = v_color;
      float fl = smoothstep(0.0, 0.025, inV) * smoothstep(0.0, 0.025, 1.0-inV);
      wall *= 0.82 + 0.18 * fl;
      wall *= nightAmb * 0.9 + sunAmb + sunDiff * 0.7;
      wall += vec3(0.95, 0.75, 0.4) * streetLight * 0.18;
      gl_FragColor = vec4(wall, 1.0);
      return;
    }

    // face index for hash
    float faceIdx = 0.0;
    if (n.x > 0.5) faceIdx = 1.0;
    else if (n.x < -0.5) faceIdx = 2.0;
    else if (n.z > 0.5) faceIdx = 3.0;
    vec2 wId = vec2(col + buildingId * 13.7 + faceIdx * 37.0, row + buildingId * 7.3);
    float h = hash(wId);

    float bldgBias = hash2(vec2(buildingId, 19.0));
    float effRatio = clamp(u_lightRatio * (0.4 + bldgBias * 0.8), 0.0, 1.0);
    effRatio *= 1.0 - 0.15 * (row / max(rows, 1.0));
    effRatio *= 0.3 + 0.7 * nightAmb;

    // Glass / unlit-pane color — also the glazing that surrounds a lit fixture.
    vec3 glass = v_color * 0.12 * nightAmb;
    glass += vec3(0.008, 0.012, 0.022) * nightAmb;
    glass += vec3(0.85, 0.65, 0.35) * streetLight * 0.12;
    glass += v_color * (sunAmb * 0.5 + sunDiff * 0.3);
    glass += vec3(0.4, 0.45, 0.55) * u_sunIntensity * 0.08;

    if (h >= effRatio) {
      gl_FragColor = vec4(glass, 1.0);
      return;
    }

    float intensity = 0.5 + 0.5 * hash(wId + 1.0);
    if (hash(wId + 2.0) > 0.95)
      intensity *= 0.35 + 0.65 * (0.5 + 0.5 * sin(u_time * (3.0 + hash(wId + 2.0) * 14.0)));

    // Pulse-reaction wave: additive brightness delta to lit windows. Dark
    // windows already returned above, so the wave is invisible passing over
    // them — matches the "delta of current brightness" framing.
    intensity += computeWaveBoost(v_worldPos);

    vec3 thisLight = u_lightColor;
    float va = u_colorVariance;
    float cc = hash(wId + 5.0);
    if (cc < 0.4)       thisLight = mix(thisLight, u_lightColor * vec3(1.0,0.75,0.45), va * hash(wId+4.0));
    else if (cc < 0.65) { thisLight = mix(thisLight, vec3(0.55,0.65,1.0), va*0.7); intensity *= 0.75; }
    else if (cc < 0.8)  { thisLight = mix(thisLight, vec3(0.7,1.0,0.7), va*0.5); intensity *= 0.8; }
    else                 thisLight = mix(thisLight, vec3(1.0,0.95,0.85), va*0.6);

    // The emitting area can be smaller than the pane (u_lightFill): a glowing
    // rectangle inset within the glass, so the light "doesn't fill the window."
    float paneU = (inU - mH) / max(1.0 - 2.0 * mH, 1e-3);
    float paneV = (inV - mV) / max(1.0 - 2.0 * mV, 1e-3);
    float fill = clamp(u_lightFill * (0.85 + 0.3 * hash(wId + 7.0)), 0.05, 1.0);
    float inset = (1.0 - fill) * 0.5;
    bool inLight = paneU > inset && paneU < (1.0 - inset) && paneV > inset && paneV < (1.0 - inset);

    if (!inLight) {
      // glazing around the fixture: glass plus a soft spill of the window light
      vec3 spill = thisLight * intensity * (0.10 + 0.10 * nightAmb);
      gl_FragColor = vec4(glass + spill, 1.0);
      return;
    }

    // glow falloff measured within the lit rectangle
    float cx = (paneU - 0.5) / max(0.5 - inset, 1e-3);
    float cy = (paneV - 0.5) / max(0.5 - inset, 1e-3);
    float glow = 1.0 - 0.2 * max(abs(cx), abs(cy));
    float wb = intensity * glow * (0.3 + 0.7 * nightAmb);
    vec3 wc = thisLight * wb + v_color * sunDiff * 0.2;
    gl_FragColor = vec4(wc, 1.0);
  }
`;

export const GROUND_VERT = CURVE_GLSL + `
  attribute vec3 a_position;
  uniform mat4 u_viewProj;
  varying vec2 v_pos;
  void main() {
    v_pos = a_position.xz;
    vec3 curved = curvePosition(a_position);
    gl_Position = u_viewProj * vec4(curved, 1.0);
  }
`;

export const GROUND_FRAG = `
  precision mediump float;
  varying vec2 v_pos;
  uniform float u_streetGlow;
  uniform float u_sunIntensity;
  uniform float u_spacing;
  uniform vec2  u_citySize;
  void main() {
    float nightAmb = 1.0 - u_sunIntensity * 0.6;
    vec3 base = vec3(0.012,0.014,0.02) * nightAmb + vec3(0.15,0.16,0.14) * u_sunIntensity;
    vec2 rel = v_pos / (u_citySize * 0.5);
    float inCity = 1.0 - smoothstep(0.7, 1.1, max(abs(rel.x), abs(rel.y)));
    vec2 cell = mod(v_pos + u_spacing * 0.5, u_spacing);
    float d = length(cell - u_spacing * 0.5);
    float pool = exp(-d*d*0.4) * 0.7;
    float sx = abs(cell.x - u_spacing*0.5), sz = abs(cell.y - u_spacing*0.5);
    float lineGlow = exp(-min(sx,sz)*min(sx,sz)*1.0) * 0.22;
    float totalGlow = (pool + lineGlow) * u_streetGlow * inCity * nightAmb;
    vec3 glow = vec3(1.0,0.78,0.42) * totalGlow + vec3(0.5,0.4,0.25) * u_streetGlow * 0.03 * inCity * nightAmb;
    gl_FragColor = vec4(base + glow, 1.0);
  }
`;

export const LIGHT_VERT = CURVE_GLSL + `
  attribute vec3 a_position;
  attribute float a_phase;
  uniform mat4 u_viewProj;
  uniform float u_pointScale;
  varying float v_phase;
  void main() {
    v_phase = a_phase;
    vec3 curved = curvePosition(a_position);
    vec4 clip = u_viewProj * vec4(curved, 1.0);
    gl_PointSize = clamp(u_pointScale / clip.w, 6.0, 60.0);
    gl_Position = clip;
  }
`;

export const LIGHT_FRAG = `
  precision mediump float;
  uniform float u_time;
  uniform float u_sunIntensity;
  varying float v_phase;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    if (d > 0.5) discard;
    float core = exp(-d * 12.0), glow = exp(-d * 3.0);
    float combined = core * 1.5 + glow * 0.6;
    float pulse = v_phase < 0.0 ? 1.0 : 0.08 + 0.92 * smoothstep(0.4, 0.5, fract(u_time * 0.5 + v_phase));
    float vis = 0.3 + 0.7 * (1.0 - u_sunIntensity);
    vec3 col = vec3(1.0, 0.04, 0.02) * combined * pulse * vis;
    gl_FragColor = vec4(col, combined * (0.5 + 0.5 * pulse) * vis);
  }
`;
