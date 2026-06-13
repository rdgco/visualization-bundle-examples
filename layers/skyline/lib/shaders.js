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
  //__STYLE__

  uniform float u_lightRatio;
  uniform float u_windowScale;
  uniform float u_floorHeight;
  uniform float u_streetGlow;
  uniform float u_colorVariance;
  uniform float u_time;
  uniform float u_sunIntensity;
  uniform vec3  u_lightColor;
  uniform float u_facadeVariety;   // 0 = all standard punched windows; 1 = rich curtain-wall / small-gap mix
  uniform float u_lightFill;       // fraction of each window pane that actually emits light
  uniform float u_patternVariety;  // 0 = classic facade mix only; raises the share of pattern-pool faces (ribbon, vertical, spandrel, mullioned)

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

    // face index for hash — computed up here so the facade pattern can be
    // chosen per face (a corner tower can wear different cladding on each
    // street). Wall fragments return before using it; harmless.
    float faceIdx = 0.0;
    if (n.x > 0.5) faceIdx = 1.0;
    else if (n.x < -0.5) faceIdx = 2.0;
    else if (n.z > 0.5) faceIdx = 3.0;

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

    // Facade resolution in two pools:
    //   - pattern pool (workstream A): a per-face hash below u_patternVariety
    //     selects ribbon / vertical-strip / spandrel / mullioned-curtain
    //     cladding. At u_patternVariety 0 this is never taken → classic.
    //   - classic mix: standard punched → small-gap → curtain wall, blended
    //     by u_facadeVariety exactly as before.
    float mH, mV;
    bool solidRow = false;   // spandrel: this whole floor row is solid wall
    bool floorLit = false;   // office-style whole-floor lighting (vs scatter)
    bool patternFace = hash2(vec2(buildingId * 2.0 + faceIdx, 53.0)) < u_patternVariety;

    if (patternFace) {
      float pid = floor(hash2(vec2(buildingId * 3.0 + faceIdx * 5.0, 61.0)) * 4.0);
      floorLit = hash2(vec2(buildingId, 51.0)) < 0.55;  // ~half the pattern stock reads as offices
      if (pid < 0.5) {
        // mullioned curtain wall: thin but *visible* mullions (vs the
        // borderless classic curtain), so glass towers read as a grid.
        mH = 0.06 + 0.02 * hash2(vec2(buildingId, 24.0));
        mV = 0.06 + 0.02 * hash2(vec2(buildingId, 25.0));
      } else if (pid < 1.5) {
        // ribbon windows: merge horizontally into bands, solid spandrel
        // between floors.
        mH = 0.015;
        mV = 0.28 + 0.08 * hash2(vec2(buildingId, 26.0));
      } else if (pid < 2.5) {
        // vertical strips: full-height window slots, solid piers between.
        mH = 0.28 + 0.08 * hash2(vec2(buildingId, 27.0));
        mV = 0.015;
      } else {
        // spandrel: alternating glass / solid floor bands.
        mH = 0.04;
        mV = 0.06;
        solidRow = mod(row, 2.0) > 0.5;
      }
    } else {
      // Classic facade mix (unchanged):
      //   standard punched (wide borders) → small-gap → curtain wall.
      float fHash = hash2(vec2(buildingId, 23.0));
      float curtainCut = u_facadeVariety * 0.45;  // glassiest share
      float gapCut     = u_facadeVariety;         // small-gap share; remainder standard
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
    }
    bool inWindow = inU > mH && inU < (1.0-mH) && inV > mV && inV < (1.0-mV) && !solidRow;

    if (!inWindow) {
      vec3 wall = v_color;
      float fl = smoothstep(0.0, 0.025, inV) * smoothstep(0.0, 0.025, 1.0-inV);
      wall *= 0.82 + 0.18 * fl;
      wall *= nightAmb * 0.9 + sunAmb + sunDiff * 0.7;
      wall += vec3(0.95, 0.75, 0.4) * streetLight * 0.18;
      gl_FragColor = vec4(wall, 1.0);
      return;
    }

    vec2 wId = vec2(col + buildingId * 13.7 + faceIdx * 37.0, row + buildingId * 7.3);
    float h = hash(wId);

    // Lit-window decision. Residential (the classic distribution) scatters
    // lit panes per cell. Offices (pattern stock only) light whole floors
    // together — the row-correlated hash makes a floor read as one lit slab.
    float litHash = floorLit
      ? hash(vec2(row + buildingId * 7.3, faceIdx * 37.0 + 7.0))
      : h;

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
    // Per-pane reflectivity on pattern faces: a subtle value jitter so a
    // curtain wall reads as individual panes, not one flat sheet.
    if (patternFace) glass *= 0.78 + 0.44 * hash(vec2(col + buildingId * 3.1, row + faceIdx * 9.0));

    if (litHash >= effRatio) {
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
    if (cc < 0.4)       thisLight = mix(thisLight, u_lightColor * STYLE_TINT_WARM, va * hash(wId+4.0));
    else if (cc < 0.65) { thisLight = mix(thisLight, STYLE_TINT_COOL, va*0.7); intensity *= 0.75; }
    else if (cc < 0.8)  { thisLight = mix(thisLight, STYLE_TINT_GREEN, va*0.5); intensity *= 0.8; }
    else                 thisLight = mix(thisLight, STYLE_TINT_WHITE, va*0.6);

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

// Inject a style's GLSL prelude (a block of `#define`s from
// style.styleFragGLSL) into the building fragment shader, replacing the
// `//__STYLE__` marker just after the precision qualifier. Taking the
// prelude as a string keeps this module free of a style.js dependency.
export function composeBuildingFrag(styleGLSL = '') {
  return BUILDING_FRAG.replace('//__STYLE__', styleGLSL);
}

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
  //__STYLE__
  varying vec2 v_pos;
  uniform float u_streetGlow;
  uniform float u_sunIntensity;
  uniform float u_spacing;
  uniform vec2  u_citySize;
  uniform float u_streetStyle;   // 0 = classic glow, 1 = paved streets

  float gHash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

  void main() {
    float nightAmb = 1.0 - u_sunIntensity * 0.6;
    vec2 rel = v_pos / (u_citySize * 0.5);
    float inCity = 1.0 - smoothstep(0.7, 1.1, max(abs(rel.x), abs(rel.y)));

    if (u_streetStyle < 0.5) {
      // ── Classic glow ground (unchanged) ──
      vec3 base = vec3(0.012,0.014,0.02) * nightAmb + vec3(0.15,0.16,0.14) * u_sunIntensity;
      vec2 cell = mod(v_pos + u_spacing * 0.5, u_spacing);
      float d = length(cell - u_spacing * 0.5);
      float pool = exp(-d*d*0.4) * 0.7;
      float sx = abs(cell.x - u_spacing*0.5), sz = abs(cell.y - u_spacing*0.5);
      float lineGlow = exp(-min(sx,sz)*min(sx,sz)*1.0) * 0.22;
      float totalGlow = (pool + lineGlow) * u_streetGlow * inCity * nightAmb;
      vec3 glow = vec3(1.0,0.78,0.42) * totalGlow + vec3(0.5,0.4,0.25) * u_streetGlow * 0.03 * inCity * nightAmb;
      gl_FragColor = vec4(base + glow, 1.0);
      return;
    }

    // ── Paved streets ── roads run between building rows (half a cell off
    // the building grid lines); sidewalks border them; block interiors fill
    // the rest. Marking / crosswalk colors come from the style descriptor.
    float sp = u_spacing;
    float rx = mod(v_pos.x, sp) - sp * 0.5;
    float rz = mod(v_pos.y, sp) - sp * 0.5;
    float roadHalf = sp * 0.20;
    float walkW    = sp * 0.07;
    bool roadAlongZ = abs(rx) < roadHalf;   // road running in z
    bool roadAlongX = abs(rz) < roadHalf;   // road running in x
    bool onRoad = roadAlongZ || roadAlongX;
    bool intersection = roadAlongZ && roadAlongX;

    // Crosswalk band depth: a faint zebra crossing sits just outside the
    // intersection box on each approach (up to four per 4-way intersection).
    float crossBand = roadHalf + sp * 0.045;
    vec3 col;
    if (onRoad) {
      col = STREET_ASPHALT;
      if (intersection) {
        // clean intersection interior — no markings
      } else if (roadAlongZ) {
        // z-running road. Within a crosswalk band (just past the intersection
        // in z, spanning the road width in x) draw a zebra; else a centre dash.
        if (abs(rz) < crossBand) {
          float zebra = step(0.45, fract(v_pos.x / (sp * 0.09)));
          col = mix(col, STREET_CROSSWALK, zebra * 0.3);
        } else {
          float dash = step(abs(rx), sp * 0.015) * step(0.5, fract(v_pos.y / (sp * 0.5)));
          col = mix(col, STREET_MARKING, dash);
        }
      } else {
        // x-running road
        if (abs(rx) < crossBand) {
          float zebra = step(0.45, fract(v_pos.y / (sp * 0.09)));
          col = mix(col, STREET_CROSSWALK, zebra * 0.3);
        } else {
          float dash = step(abs(rz), sp * 0.015) * step(0.5, fract(v_pos.x / (sp * 0.5)));
          col = mix(col, STREET_MARKING, dash);
        }
      }
    } else if (abs(rx) < roadHalf + walkW || abs(rz) < roadHalf + walkW) {
      col = STREET_SIDEWALK;
    } else {
      float blk = gHash(floor(v_pos / sp));
      col = STREET_ASPHALT * (0.6 + 0.5 * blk);
    }

    // Night lighting + warm glow pooled on the roadway (driven by streetGlow),
    // brighter at intersections; daylight wash on top.
    float lit = 0.28 + 0.72 * nightAmb;
    float roadGlow = onRoad ? (0.08 + 0.16 * float(intersection)) * u_streetGlow : 0.0;
    vec3 outc = col * lit + vec3(1.0, 0.82, 0.5) * roadGlow * nightAmb;
    outc += col * u_sunIntensity * 0.4;

    // Fade to dark ground beyond the city footprint (classic single block).
    vec3 baseDark = vec3(0.012,0.014,0.02) * nightAmb + vec3(0.10,0.11,0.10) * u_sunIntensity;
    gl_FragColor = vec4(mix(baseDark, outc, inCity), 1.0);
  }
`;

// Inject a style's GLSL prelude into the ground fragment shader (street
// color #defines), mirroring composeBuildingFrag.
export function composeGroundFrag(styleGLSL = '') {
  return GROUND_FRAG.replace('//__STYLE__', styleGLSL);
}

export const LIGHT_VERT = CURVE_GLSL + `
  attribute vec3 a_position;
  attribute float a_phase;
  attribute vec3 a_color;     // per-point color: red aviation, warm-white streetlight
  uniform mat4 u_viewProj;
  uniform float u_pointScale;
  varying float v_phase;
  varying vec3 v_color;
  void main() {
    v_phase = a_phase;
    v_color = a_color;
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
  varying vec3 v_color;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    if (d > 0.5) discard;
    float core = exp(-d * 12.0), glow = exp(-d * 3.0);
    float combined = core * 1.5 + glow * 0.6;
    // phase < 0 ⇒ steady (aviation "always on" + streetlights); else blink.
    float pulse = v_phase < 0.0 ? 1.0 : 0.08 + 0.92 * smoothstep(0.4, 0.5, fract(u_time * 0.5 + v_phase));
    float vis = 0.3 + 0.7 * (1.0 - u_sunIntensity);
    vec3 col = v_color * combined * pulse * vis;
    gl_FragColor = vec4(col, combined * (0.5 + 0.5 * pulse) * vis);
  }
`;

// ── Cars ── point sprites whose lane position is computed in the vertex
// shader from u_time, so a whole fleet animates with zero per-frame CPU.
// Each car carries a lane (origin + direction + length), a phase, a speed,
// a color flag (headlight white vs taillight red) and a visibility
// threshold (compared against u_traffic to fade the fleet in/out).
export const CAR_VERT = CURVE_GLSL + `
  attribute vec2 a_origin;   // lane start (x, z)
  attribute vec4 a_lane;     // dirX, dirZ, length, startPhase (0..1)
  attribute vec3 a_meta;     // speed (cells/sec), colorFlag (1 = head, 0 = tail), visThreshold
  uniform mat4 u_viewProj;
  uniform float u_time;
  uniform float u_carSpeed;
  uniform float u_traffic;
  uniform float u_spacing;   // block size = one cell along a lane
  uniform float u_pointScale;
  varying float v_kind;

  float carHash(vec2 p){ return fract(sin(dot(p, vec2(41.3, 289.1))) * 13758.5453); }

  void main() {
    if (a_meta.z > u_traffic) {   // culled when traffic density is below this car's threshold
      gl_PointSize = 0.0;
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);   // outside clip space → clipped
      return;
    }
    // Stop-and-go: a car advances one block (cell) per cycle. Speed is in
    // cells/sec, so it's grid-relative and reads as slow city traffic, not a
    // streaking light. At each cell boundary a per-car/per-cell hash decides
    // a "red light": stoppers cross 62% of the cycle then wait out the rest.
    // smoothstep eases the accel out of a stop and the decel into the next.
    float sp = u_spacing;
    float global = a_lane.w * (a_lane.z / sp) + u_time * a_meta.x * u_carSpeed;
    float cell = floor(global);
    float local = fract(global);
    float red = step(carHash(vec2(a_lane.w * 53.0 + a_meta.x * 17.0, cell)), 0.4);
    float moveFrac = mix(1.0, 0.62, red);
    float prog = smoothstep(0.0, 1.0, clamp(local / moveFrac, 0.0, 1.0));
    float along = mod((cell + prog) * sp, a_lane.z);
    vec2 pos2 = a_origin + a_lane.xy * along;
    vec3 curved = curvePosition(vec3(pos2.x, 0.3, pos2.y));
    vec4 clip = u_viewProj * vec4(curved, 1.0);
    gl_PointSize = clamp(u_pointScale / clip.w, 2.0, 14.0);
    gl_Position = clip;
    v_kind = a_meta.y;
  }
`;

export const CAR_FRAG = `
  precision mediump float;
  uniform float u_sunIntensity;
  uniform vec3 u_carHead;
  uniform vec3 u_carTail;
  varying float v_kind;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    if (d > 0.5) discard;
    float core = exp(-d * 10.0), halo = exp(-d * 3.5);
    float b = core * 1.6 + halo * 0.5;
    float vis = 0.4 + 0.6 * (1.0 - u_sunIntensity);
    vec3 col = (v_kind > 0.5 ? u_carHead : u_carTail) * b * vis;
    gl_FragColor = vec4(col, b * vis);
  }
`;
