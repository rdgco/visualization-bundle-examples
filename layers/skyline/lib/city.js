/**
 * City — procedural night-time skyline renderer.
 *
 * Lit windows, varied building shapes, rooftop features, red aviation
 * lights, and street glow. The layout is generated from a seed:
 * wider-than-deep grid with diagonal districts, organic edges, plazas,
 * height clustering, building tapering, and varied roof types. All
 * window lighting is computed in the fragment shader from building ID
 * hashes — no per-window geometry.
 *
 * Configurable: light ratio, window scale/density, building density,
 * max height, window hue, color variance, street glow, sunlight,
 * speed, curvature.
 *
 * Migrated to visualization-harness 2026-05-11 (TASK-05). The original
 * source is the host application's `city` compositor object. This file
 * preserves the renderer logic unchanged — the harness-contract
 * adapter lives in `../skyline-layer.js`.
 *
 * Module layout (inside `layers/skyline/lib/`):
 *   city.js     — this file: the City renderer class
 *   shaders.js  — GLSL sources
 *   layout.js   — seeded RNG, palette, building placement
 *   geometry.js — quad/box/roof vertex emitters
 *   gl-utils.js — shader compile + buffer create + hex-color parse
 *   math.js     — minimal mat4 / vec3 helpers
 *   camera.js   — orbit/drift/fixed camera + viewProj
 */

import { createShaderProgram, createBuffer, parseColorGL } from './gl-utils.js';
import {
  BUILDING_VERT, BUILDING_FRAG,
  GROUND_VERT, GROUND_FRAG,
  LIGHT_VERT, LIGHT_FRAG
} from './shaders.js';
import { mulberry32, generateLayout } from './layout.js';
import { buildFootprintPolygon, generatePrism, generateRoofTri, generateRoofQuad } from './geometry.js';

// ============================================================================
// Pulse-reaction wave constants
// ============================================================================

// Ring-buffer slot count. Matches the fractal program's wave precedent:
// enough slots for fast-drum overlap (a 16th-note hat run still leaves a
// few slots breathing) but bounded so the shader's per-fragment loop stays
// fixed-size. A 5th pulse overwrites the oldest slot (round-robin via
// nextWaveSlot), so amplitude decay alone determines visual fade.
const MAX_WAVES = 4;

// Axis mode IDs — must match the branches in computeWaveBoost() in the
// building fragment shader. Stored on each slot as a float (the shader
// reads them as a vec4 of floats and branches on integer ranges).
const AXIS_VERTICAL_UP = 0;
const AXIS_VERTICAL_DOWN = 1;
const AXIS_RADIAL = 2;

// Wave lifecycle constants. Tuned for "drum-felt" timing: a vertical wave
// crosses the skyline in roughly 1.5 s at speed 1, decays gracefully, and
// is killed once it exits the visible coordinate range.
const WAVE_BASE_SPEED = 0.018; // axis-units per ms (axis is normalized 0–1)
const WAVE_BASE_WIDTH = 0.18; // gaussian sigma at injection
const WAVE_DECAY = 0.985; // amp *= per ~16ms tick (cribbed from fractal)
const WAVE_WIDTH_GROW = 0.0005; // sigma += per tick (waves spread as they age)
const WAVE_KILL_POS = 1.6; // pos past which a slot is force-killed

// ============================================================================
// City class
// ============================================================================

class City {
  constructor(gl, config = {}) {
    this.gl = gl;
    this.time = 0;
    this.seed = config.seed ?? Math.floor(Math.random() * 100000);

    // Config values
    this.lightRatio = config.lightRatio ?? 0.55;
    this.windowScale = config.windowScale ?? 0.35;
    this.floorHeight = config.floorHeight ?? 0.50;
    this.density = config.density ?? 11;
    this.maxHeight = config.maxHeight ?? 20;
    this.streetGlow = config.streetGlow ?? 0.70;
    this.colorVariance = config.colorVariance ?? 0.40;
    this.sunIntensity = config.sunIntensity ?? 0.0;
    this.lightColor = config.lightColor || [0.85, 0.65, 0.35];
    this.speed = config.speed ?? 1.0;
    this.curvature = config.curvature ?? 0.0;
    this.footprintVariety = config.footprintVariety ?? 0.35;
    this.allowEll = config.allowEll ?? true;
    this.allowCylinder = config.allowCylinder ?? true;
    this.facadeVariety = config.facadeVariety ?? 0.5;
    this.lightFill = config.lightFill ?? 0.8;

    // Pulse-reaction state. Initialized before GL work so the wave fields
    // exist even if shader compilation throws — keeps react() callable
    // (as a no-op against a never-rendered scene) without a crash.
    this._initWaveState();

    // Compile shaders
    this.buildingShader = createShaderProgram(gl, BUILDING_VERT, BUILDING_FRAG);
    this.groundShader = createShaderProgram(gl, GROUND_VERT, GROUND_FRAG);
    this.lightShader = createShaderProgram(gl, LIGHT_VERT, LIGHT_FRAG);

    this._generate();
  }

  _generate() {
    const gl = this.gl;

    // Clean up old buffers
    if (this.buildingVBO) gl.deleteBuffer(this.buildingVBO);
    if (this.roofVBO) gl.deleteBuffer(this.roofVBO);
    if (this.groundVBO) gl.deleteBuffer(this.groundVBO);
    if (this.lightVBO) gl.deleteBuffer(this.lightVBO);

    const rng = mulberry32(this.seed);
    const layout = generateLayout(rng, {
      density: this.density, maxHeight: this.maxHeight,
      footprintVariety: this.footprintVariety,
      allowEll: this.allowEll, allowCylinder: this.allowCylinder
    });
    this.citySize = layout.citySize;
    this.spacing = layout.spacing;

    const buildBuf = [];
    const roofBuf = [];
    const lightBuf = []; // x,y,z,phase per light
    let tallestId = -1, tallestH = 0;

    for (const b of layout.buildings) {
      if (b.h > tallestH) { tallestH = b.h; tallestId = b.id; }
      const cr = Math.cos(b.rot), sr = Math.sin(b.rot);

      // Expand taper segments
      const segments = [];
      if (!b.taper) {
        segments.push({x: b.x, z: b.z, y: 0, w: b.w, h: b.h, d: b.d});
      } else {
        const t = b.taper;
        const h1 = b.h * t.taperPoint;
        segments.push({x: b.x, z: b.z, y: 0, w: b.w, h: h1, d: b.d});
        const uw = b.w * t.shrinkW, ud = b.d * t.shrinkD;
        const lox = t.offsetX * b.w, loz = t.offsetZ * b.d;
        const wox = lox * cr - loz * sr, woz = lox * sr + loz * cr;
        segments.push({x: b.x + wox, z: b.z + woz, y: h1, w: uw, h: b.h - h1, d: ud});
      }

      // Build geometry for each segment. The footprint polygon is shared
      // across taper segments; each segment scales it by its own w/d, so a
      // tapered upper segment is the same shape shrunk concentrically.
      const isBox = (b.footprint && b.footprint.type ? b.footprint.type : 'box') === 'box';
      const poly = buildFootprintPolygon(b.footprint ? b.footprint.type : 'box', b.footprint || {});
      for (const s of segments) {
        generatePrism(buildBuf, poly, s.x, s.z, s.y, s.w, s.d, s.h, b.rot,
          b.id, b.col, b.roofRng);
      }

      // Roof on top segment
      const top = segments[segments.length - 1];
      const topY = top.y + top.h;
      const tw = top.w, td = top.d;
      const roofCol = [b.col[0] * 0.55, b.col[1] * 0.55, b.col[2] * 0.55];
      const RP = (lx, y, lz) => {
        const wx = lx * tw, wz = lz * td;
        return [top.x + wx * cr - wz * sr, y, top.z + wx * sr + wz * cr];
      };

      // Varied roof shapes assume a rectangular top, so they're box-only.
      // Non-box footprints wear their flat prism cap as the roof (the tallest
      // still gets a spire/antenna feature at top-centre).
      let roofType;
      if (b.id === tallestId) roofType = 'spire';
      else if (!isBox) roofType = 'flat';
      else {
        const r = b.roofRng;
        roofType = r < 0.55 ? 'flat' : r < 0.75 ? 'sloped' : r < 0.88 ? 'peaked' : r < 0.94 ? 'pyramid' : 'antenna';
      }

      let topmost = topY;

      if (roofType === 'sloped') {
        const rh = 0.2 + b.roofRng * 0.6;
        generateRoofQuad(roofBuf, RP(-0.5, topY, -0.5), RP(0.5, topY, -0.5), RP(0.5, topY + rh, 0.5), RP(-0.5, topY + rh, 0.5), roofCol);
        generateRoofTri(roofBuf, RP(-0.5, topY, -0.5), RP(-0.5, topY + rh, 0.5), RP(-0.5, topY, 0.5), roofCol);
        generateRoofTri(roofBuf, RP(0.5, topY, -0.5), RP(0.5, topY, 0.5), RP(0.5, topY + rh, 0.5), roofCol);
        topmost = topY + rh;
      } else if (roofType === 'peaked') {
        const rh = 0.2 + b.roofRng * 0.5;
        generateRoofQuad(roofBuf, RP(-0.5, topY, -0.5), RP(0.5, topY, -0.5), RP(0.5, topY + rh, 0), RP(-0.5, topY + rh, 0), roofCol);
        generateRoofQuad(roofBuf, RP(0.5, topY, 0.5), RP(-0.5, topY, 0.5), RP(-0.5, topY + rh, 0), RP(0.5, topY + rh, 0), roofCol);
        generateRoofTri(roofBuf, RP(-0.5, topY, -0.5), RP(-0.5, topY + rh, 0), RP(-0.5, topY, 0.5), roofCol);
        generateRoofTri(roofBuf, RP(0.5, topY, -0.5), RP(0.5, topY, 0.5), RP(0.5, topY + rh, 0), roofCol);
        topmost = topY + rh;
      } else if (roofType === 'pyramid') {
        const rh = 0.4 + b.roofRng * 0.8, apex = RP(0, topY + rh, 0);
        generateRoofTri(roofBuf, RP(-0.5, topY, -0.5), RP(0.5, topY, -0.5), apex, roofCol);
        generateRoofTri(roofBuf, RP(0.5, topY, -0.5), RP(0.5, topY, 0.5), apex, roofCol);
        generateRoofTri(roofBuf, RP(0.5, topY, 0.5), RP(-0.5, topY, 0.5), apex, roofCol);
        generateRoofTri(roofBuf, RP(-0.5, topY, 0.5), RP(-0.5, topY, -0.5), apex, roofCol);
        topmost = topY + rh;
      }
      // spire and antenna omitted for brevity — add same pattern as POC

      // Aviation lights on tall buildings
      if (b.h > this.maxHeight * 0.45) {
        lightBuf.push(top.x, topmost + 0.05, top.z, b.roofRng > 0.4 ? b.roofRng : -1.0);
      }
    }

    // Build VBOs
    // Building buffer: 17 floats per vertex (pos3+norm3+local3+meta4+color3+var1)
    this.buildingData = new Float32Array(buildBuf);
    this.buildingCount = buildBuf.length / 17;
    this.buildingVBO = createBuffer(gl, this.buildingData);

    // Roof buffer: same layout as building (reuses same shader)
    this.roofData = new Float32Array(roofBuf);
    this.roofCount = roofBuf.length / 17;
    this.roofVBO = roofBuf.length > 0 ? createBuffer(gl, this.roofData) : null;

    // Ground plane (subdivided)
    const gVerts = [];
    const gSize = 150, gDiv = 60, gStep = gSize * 2 / gDiv;
    for (let ix = 0; ix < gDiv; ix++) for (let iz = 0; iz < gDiv; iz++) {
      const x0 = -gSize + ix * gStep, x1 = x0 + gStep;
      const z0 = -gSize + iz * gStep, z1 = z0 + gStep;
      gVerts.push(x0, 0, z0, x1, 0, z0, x1, 0, z1, x0, 0, z0, x1, 0, z1, x0, 0, z1);
    }
    this.groundData = new Float32Array(gVerts);
    this.groundCount = gVerts.length / 3;
    this.groundVBO = createBuffer(gl, this.groundData);

    // Light points: 4 floats each (x,y,z,phase)
    this.lightData = new Float32Array(lightBuf);
    this.lightCount = lightBuf.length / 4;
    this.lightVBO = lightBuf.length > 0 ? createBuffer(gl, this.lightData) : null;
  }

  update(dt) {
    this.time += dt * 0.001 * this.speed;

    // Propagate active wave slots. Tick math mirrors fractal — `t = dt/16`
    // so the per-tick decay/growth constants stay frame-rate-agnostic at a
    // 60Hz baseline. Pos advances along its own axis (set at injection),
    // amp decays exponentially, sigma grows slightly, and a slot is killed
    // once it exits the visible coordinate range.
    const t = dt / 16;
    const speed = WAVE_BASE_SPEED * t;
    for (let i = 0; i < MAX_WAVES; i++) {
      const w = this.waves[i];
      if (w.amp > 0.001) {
        w.pos += speed;
        w.amp *= Math.pow(WAVE_DECAY, t);
        w.width += WAVE_WIDTH_GROW * t;
        if (w.pos > WAVE_KILL_POS) w.amp = 0;
      }
    }
  }

  render(viewProj) {
    const gl = this.gl;

    gl.enable(gl.DEPTH_TEST);

    // ── Buildings ──
    this._renderBuildings(gl, viewProj, this.buildingVBO, this.buildingCount);
    if (this.roofVBO) this._renderBuildings(gl, viewProj, this.roofVBO, this.roofCount);

    // ── Ground ──
    {
      const sh = this.groundShader;
      gl.useProgram(sh.program);
      gl.uniformMatrix4fv(sh.uniform('u_viewProj'), false, viewProj);
      gl.uniform1f(sh.uniform('u_streetGlow'), this.streetGlow);
      gl.uniform1f(sh.uniform('u_sunIntensity'), this.sunIntensity);
      gl.uniform1f(sh.uniform('u_spacing'), this.spacing);
      gl.uniform2fv(sh.uniform('u_citySize'), this.citySize);
      gl.uniform1f(sh.uniform('u_curvature'), this.curvature);
      gl.uniform1f(sh.uniform('u_sphereRadius'), this._sphereRadius());

      gl.bindBuffer(gl.ARRAY_BUFFER, this.groundVBO);
      const posLoc = sh.attr('a_position');
      gl.enableVertexAttribArray(posLoc);
      gl.vertexAttribPointer(posLoc, 3, gl.FLOAT, false, 0, 0);
      gl.drawArrays(gl.TRIANGLES, 0, this.groundCount);
      gl.disableVertexAttribArray(posLoc);
    }

    // ── Red aviation lights ──
    if (this.lightVBO && this.lightCount > 0) {
      const sh = this.lightShader;
      gl.useProgram(sh.program);
      gl.uniformMatrix4fv(sh.uniform('u_viewProj'), false, viewProj);
      gl.uniform1f(sh.uniform('u_time'), this.time);
      gl.uniform1f(sh.uniform('u_sunIntensity'), this.sunIntensity);
      gl.uniform1f(sh.uniform('u_pointScale'), 300);
      gl.uniform1f(sh.uniform('u_curvature'), this.curvature);
      gl.uniform1f(sh.uniform('u_sphereRadius'), this._sphereRadius());

      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
      gl.depthMask(false);

      gl.bindBuffer(gl.ARRAY_BUFFER, this.lightVBO);
      const posLoc = sh.attr('a_position');
      const phaseLoc = sh.attr('a_phase');
      gl.enableVertexAttribArray(posLoc);
      gl.vertexAttribPointer(posLoc, 3, gl.FLOAT, false, 16, 0);
      gl.enableVertexAttribArray(phaseLoc);
      gl.vertexAttribPointer(phaseLoc, 1, gl.FLOAT, false, 16, 12);
      gl.drawArrays(gl.POINTS, 0, this.lightCount);
      gl.disableVertexAttribArray(posLoc);
      gl.disableVertexAttribArray(phaseLoc);

      gl.depthMask(true);
      gl.disable(gl.BLEND);
    }
  }

  _renderBuildings(gl, viewProj, vbo, count) {
    if (count === 0) return;
    const sh = this.buildingShader;
    gl.useProgram(sh.program);
    gl.uniformMatrix4fv(sh.uniform('u_viewProj'), false, viewProj);
    gl.uniform1f(sh.uniform('u_lightRatio'), this.lightRatio);
    gl.uniform1f(sh.uniform('u_windowScale'), this.windowScale);
    gl.uniform1f(sh.uniform('u_floorHeight'), this.floorHeight);
    gl.uniform1f(sh.uniform('u_streetGlow'), this.streetGlow);
    gl.uniform1f(sh.uniform('u_colorVariance'), this.colorVariance);
    gl.uniform1f(sh.uniform('u_time'), this.time);
    gl.uniform1f(sh.uniform('u_sunIntensity'), this.sunIntensity);
    gl.uniform3fv(sh.uniform('u_lightColor'), this.lightColor);
    gl.uniform1f(sh.uniform('u_facadeVariety'), this.facadeVariety);
    gl.uniform1f(sh.uniform('u_lightFill'), this.lightFill);
    gl.uniform1f(sh.uniform('u_curvature'), this.curvature);
    gl.uniform1f(sh.uniform('u_sphereRadius'), this._sphereRadius());

    // Pulse-reaction wave uniforms. Pack the ring buffer's parallel fields
    // into the Float32Arrays allocated once in _initWaveState (avoids
    // per-frame allocation), then upload as vec4s. The shader's
    // computeWaveBoost reads them in a fixed-size loop.
    this._packWaveUniforms();
    gl.uniform4fv(sh.uniform('u_wavePos'), this._wavePos);
    gl.uniform4fv(sh.uniform('u_waveAmp'), this._waveAmp);
    gl.uniform4fv(sh.uniform('u_waveWidth'), this._waveWidth);
    gl.uniform4fv(sh.uniform('u_waveMode'), this._waveMode);
    gl.uniform4fv(sh.uniform('u_waveOriginX'), this._waveOriginX);
    gl.uniform4fv(sh.uniform('u_waveOriginZ'), this._waveOriginZ);
    gl.uniform1f(sh.uniform('u_waveMaxHeight'), this.maxHeight);
    gl.uniform1f(sh.uniform('u_waveCityRadius'), this._cityRadius());

    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    const stride = 17 * 4;
    const locs = ['a_position', 'a_normal', 'a_localPos', 'a_meta', 'a_color', 'a_variation'];
    const sizes = [3, 3, 3, 4, 3, 1];
    let offset = 0;
    for (let i = 0; i < locs.length; i++) {
      const loc = sh.attr(locs[i]);
      if (loc >= 0) {
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, sizes[i], gl.FLOAT, false, stride, offset);
      }
      offset += sizes[i] * 4;
    }

    gl.drawArrays(gl.TRIANGLES, 0, count);

    for (const name of locs) {
      const loc = sh.attr(name);
      if (loc >= 0) gl.disableVertexAttribArray(loc);
    }
  }

  // ==========================================================================
  // Pulse-reaction surface
  //
  // The city declares a `pulse` reaction (see metadata export at the bottom
  // of this file) and dispatches it through react() to a strategy-registry.
  // Each strategy bakes a wave's geometry (axis mode + optional origin) into
  // a ring-buffer slot at injection time; the building fragment shader
  // sums up to MAX_WAVES gaussians per fragment. Strategies are independent
  // — concurrent waves with different modes coexist without reinterpretation
  // of in-flight `pos` values.
  //
  // Adding a strategy: append to PULSE_STRATEGIES, then add the strategy
  // key to the `entry` enum's options in the `reactions` export below.
  // If the strategy needs a new axis math, add a branch to computeWaveBoost
  // in the building fragment shader and a new AXIS_* constant up top.
  // ==========================================================================

  _initWaveState() {
    this.waves = [];
    for (let i = 0; i < MAX_WAVES; i++) {
      this.waves.push({
        pos: 0, amp: 0, width: WAVE_BASE_WIDTH,
        mode: AXIS_VERTICAL_UP, originX: 0, originZ: 0
      });
    }
    this.nextWaveSlot = 0;

    // Allocate uniform-shaped arrays once, reuse every frame. Avoids GC
    // churn from packing on every render.
    this._wavePos = new Float32Array(MAX_WAVES);
    this._waveAmp = new Float32Array(MAX_WAVES);
    this._waveWidth = new Float32Array(MAX_WAVES);
    this._waveMode = new Float32Array(MAX_WAVES);
    this._waveOriginX = new Float32Array(MAX_WAVES);
    this._waveOriginZ = new Float32Array(MAX_WAVES);
  }

  _packWaveUniforms() {
    for (let i = 0; i < MAX_WAVES; i++) {
      const w = this.waves[i];
      this._wavePos[i] = w.pos;
      this._waveAmp[i] = w.amp;
      this._waveWidth[i] = w.width;
      this._waveMode[i] = w.mode;
      this._waveOriginX[i] = w.originX;
      this._waveOriginZ[i] = w.originZ;
    }
  }

  // Inject a fully-resolved wave into the next ring-buffer slot. Strategies
  // own the axis-mode + origin choice; this helper just records.
  _injectWave({ amplitude, mode, originX = 0, originZ = 0, width = WAVE_BASE_WIDTH }) {
    const w = this.waves[this.nextWaveSlot];
    w.pos = 0;
    w.amp = amplitude;
    w.width = width;
    w.mode = mode;
    w.originX = originX;
    w.originZ = originZ;
    this.nextWaveSlot = (this.nextWaveSlot + 1) % MAX_WAVES;
  }

  // City footprint radius for normalizing radial wave axisCoord. Uses the
  // larger of the two citySize half-extents so the wave's pos=1.0 lands at
  // (or just past) the far corner of the visible footprint.
  _cityRadius() {
    if (!this.citySize) return 1;
    return Math.max(this.citySize[0], this.citySize[1]) * 0.5;
  }

  // Pick a random origin within the city footprint for point-out pulses.
  // Extracted as a method so tests can stub it deterministically.
  _pickPointOutOrigin() {
    const halfW = (this.citySize?.[0] ?? 40) * 0.5;
    const halfD = (this.citySize?.[1] ?? 40) * 0.5;
    return {
      x: (Math.random() - 0.5) * 2 * halfW,
      z: (Math.random() - 0.5) * 2 * halfD
    };
  }

  react(key, args = {}, eventContext = {}) {
    switch (key) {
      case 'pulse': {
        // Velocity-as-default pattern matches bouncing-balls: explicit
        // args.amplitude wins; otherwise scale from drum velocity (0–127),
        // falling back to a moderate default if the source has no velocity.
        const v = typeof eventContext.velocity === 'number' ? eventContext.velocity / 127 : 0.7;
        const amplitude = typeof args.amplitude === 'number' ? args.amplitude : v;

        const entry = args.entry ?? 'bottom-up';
        const strategy = PULSE_STRATEGIES[entry] || PULSE_STRATEGIES['bottom-up'];
        strategy.execute(this, args, { amplitude });
        break;
      }
      // No default — the dispatch helper only invokes react() with keys
      // declared in our `reactions` export.
    }
  }

  _sphereRadius() {
    if (this.curvature < 0.01) return 999;
    const cityW = this.citySize ? this.citySize[0] : 40;
    return Math.max(cityW * 0.6 / Math.max(this.curvature, 0.01), cityW * 0.3);
  }

  updateConfig(config) {
    let needsRebuild = false;
    if (config.seed !== undefined && config.seed !== this.seed) { this.seed = config.seed; needsRebuild = true; }
    if (config.density !== undefined && config.density !== this.density) { this.density = config.density; needsRebuild = true; }
    if (config.maxHeight !== undefined && config.maxHeight !== this.maxHeight) { this.maxHeight = config.maxHeight; needsRebuild = true; }
    if (config.footprintVariety !== undefined && config.footprintVariety !== this.footprintVariety) { this.footprintVariety = config.footprintVariety; needsRebuild = true; }
    if (config.allowEll !== undefined && config.allowEll !== this.allowEll) { this.allowEll = config.allowEll; needsRebuild = true; }
    if (config.allowCylinder !== undefined && config.allowCylinder !== this.allowCylinder) { this.allowCylinder = config.allowCylinder; needsRebuild = true; }
    if (config.facadeVariety !== undefined) this.facadeVariety = config.facadeVariety;
    if (config.lightFill !== undefined) this.lightFill = config.lightFill;
    if (config.lightRatio !== undefined) this.lightRatio = config.lightRatio;
    if (config.windowScale !== undefined) this.windowScale = config.windowScale;
    if (config.floorHeight !== undefined) this.floorHeight = config.floorHeight;
    if (config.streetGlow !== undefined) this.streetGlow = config.streetGlow;
    if (config.colorVariance !== undefined) this.colorVariance = config.colorVariance;
    if (config.sunIntensity !== undefined) this.sunIntensity = config.sunIntensity;
    if (config.lightColor !== undefined) this.lightColor = config.lightColor;
    if (config.speed !== undefined) this.speed = config.speed;
    if (config.curvature !== undefined) this.curvature = config.curvature;
    if (config._freeze) this.time = 0;
    if (needsRebuild) this._generate();
  }

  setModulatedValues(config) {
    if (config.facadeVariety !== undefined) this.facadeVariety = config.facadeVariety;
    if (config.lightFill !== undefined) this.lightFill = config.lightFill;
    if (config.lightRatio !== undefined) this.lightRatio = config.lightRatio;
    if (config.windowScale !== undefined) this.windowScale = config.windowScale;
    if (config.streetGlow !== undefined) this.streetGlow = config.streetGlow;
    if (config.colorVariance !== undefined) this.colorVariance = config.colorVariance;
    if (config.sunIntensity !== undefined) this.sunIntensity = config.sunIntensity;
    if (config.speed !== undefined) this.speed = config.speed;
    if (config.curvature !== undefined) this.curvature = config.curvature;
    if (config.lightColor !== undefined && Array.isArray(config.lightColor)) this.lightColor = config.lightColor;
  }

  getSnapshot() { return { citySpeed: 0 }; }

  cleanup() {
    const gl = this.gl;
    if (this.buildingVBO) gl.deleteBuffer(this.buildingVBO);
    if (this.roofVBO) gl.deleteBuffer(this.roofVBO);
    if (this.groundVBO) gl.deleteBuffer(this.groundVBO);
    if (this.lightVBO) gl.deleteBuffer(this.lightVBO);
    gl.deleteProgram(this.buildingShader.program);
    gl.deleteProgram(this.groundShader.program);
    gl.deleteProgram(this.lightShader.program);
  }
}

// ============================================================================
// Pulse strategies — bake a wave's geometry (axis mode + optional origin)
// into a ring-buffer slot at injection time. Concurrent waves with
// different strategies coexist; each slot interprets its own `pos`
// consistently from spawn to death.
//
// Adding a strategy: append here, add the strategy key to the `pulse`
// reaction's `entry` enum in skyline-layer.js, and (if the strategy
// needs new axis math) add a branch to computeWaveBoost in the
// building fragment shader and a new AXIS_* constant at the top of
// this file.
// ============================================================================

export const PULSE_STRATEGIES = {
  'bottom-up': {
    label: 'Bottom-up',
    description: 'Wave climbs from street level to the tallest rooftop.',
    execute(program, _args, { amplitude }) {
      program._injectWave({ amplitude, mode: AXIS_VERTICAL_UP });
    }
  },
  'top-down': {
    label: 'Top-down',
    description: 'Wave descends from sky to street.',
    execute(program, _args, { amplitude }) {
      program._injectWave({ amplitude, mode: AXIS_VERTICAL_DOWN });
    }
  },
  'point-out': {
    label: 'Point outward',
    description: 'Wave radiates outward from a random point on the city footprint.',
    execute(program, _args, { amplitude }) {
      const origin = program._pickPointOutOrigin();
      program._injectWave({
        amplitude,
        mode: AXIS_RADIAL,
        originX: origin.x,
        originZ: origin.z
      });
    }
  }
};

// ============================================================================
// Module exports
//
// Only the renderer class + its supporting strategy registry leave this
// file. The harness contract surface (key, label, params, reactions,
// wantsContext) lives in `../skyline-layer.js`, which wraps City for
// the harness.
// ============================================================================

export default City;
export {
  parseColorGL,
  MAX_WAVES,
  AXIS_VERTICAL_UP,
  AXIS_VERTICAL_DOWN,
  AXIS_RADIAL
};
