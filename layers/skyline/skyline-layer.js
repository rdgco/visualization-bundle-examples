/**
 * Skyline layer — canonical 3D SDK example for the harness.
 *
 * Wraps the City renderer (originally migrated from the host project's
 * compositor, since extended in-tree) with the harness contract surface.
 * This file is the thin adapter that
 *
 *   - declares the layer's contract surface (key/label/params/reactions)
 *   - manages a viewProj-producing camera since the harness doesn't
 *     provide one
 *   - bridges the harness's `init / render / react / cleanup`
 *     lifecycle to the City's `constructor(gl, config) / update / render
 *     / react / cleanup` shape
 *   - translates harness-shaped param values into the City's expected
 *     config shape (hex color string → [r,g,b] float array, etc.)
 *
 * See `README.md` in this directory for what changed during migration.
 */

import City, { parseColorGL } from './lib/city.js';

// ============================================================================
// Contract surface
// ============================================================================

export const key = 'skyline';
export const label = 'City Skyline';
export const description = 'Procedural night-time city skyline. Hundreds of buildings with a configurable mix of footprints (boxes, beveled/chopped corners, rare L-shapes and round towers) and window facades (standard punched, small-gap, and full-glass curtain walls), with lit windows whose glow can fill the pane or sit inset within it, rooftop features, red aviation lights blinking on the tallest spires, and a ground plane that can switch from classic glow pools to paved streets — asphalt with lane markings, sidewalks, crosswalks, warm streetlights, and GPU-animated traffic (white headlight and red taillight streams). Pattern variety layers in real facade types — mullioned curtain walls, ribbon and vertical-strip windows, alternating spandrel floors — hashed per face and split into floor-lit offices and scatter-lit residential. Built on three GLSL shader programs sharing one canvas; driven by the harness orbit camera. Demonstrates the full WebGL contract surface, all param kinds, the `pulse` reaction with three entry strategies, and `wantsCamera` opt-in.';
export const wantsContext = 'webgl';

/**
 * Skyline uses the harness's standard orbit camera (TASK-standard-
 * camera-controls). The declared `target` / `distance` / `height`
 * frame the city's ~40-unit footprint at a high-angle three-quarter
 * view — the same starting framing the layer used to set up via its
 * own removed `lib/camera.js`.
 *
 * Auto-orbit (the old camera's cinematic constant rotation) is gone
 * per the operator's "camera state only; no automatic motion" rule.
 * Operators drive the camera with arrow keys (sweep), Option+arrows
 * (orbit), Shift+arrows (pan), `=` / `-` (zoom), `0` (reset).
 */
export const wantsCamera = {
  mode: 'orbit',
  target: [0, 0, 0],
  distance: 55,
  height: 22
};

export const params = {
  seed: {
    type: 'number',
    label: 'Seed',
    default: 42,
    min: 0,
    max: 99999,
    step: 1,
    description: 'Procedural seed for building layout. Change to regenerate the skyline.'
  },
  lightRatio: {
    type: 'number',
    label: 'Lights on',
    default: 0.55,
    min: 0,
    max: 1,
    step: 0.01,
    description: 'Fraction of windows that are lit at any moment.',
    modulation: { kind: 'continuous' }
  },
  windowScale: {
    type: 'number',
    label: 'Window scale',
    default: 0.35,
    min: 0.15,
    max: 0.8,
    step: 0.01,
    description: 'Per-window size as a fraction of the floor cell.'
  },
  facadeVariety: {
    type: 'number',
    label: 'Facade variety',
    default: 0.5,
    min: 0,
    max: 1,
    step: 0.01,
    description: 'Mix of window facades. 0 = every building has standard punched windows; higher blends in small-gap and full-glass curtain-wall facades.',
    modulation: { kind: 'continuous' }
  },
  lightFill: {
    type: 'number',
    label: 'Light fill',
    default: 0.8,
    min: 0.05,
    max: 1,
    step: 0.01,
    description: 'How much of each window pane actually lights up. 1 = the whole pane glows; lower leaves a glass surround with a smaller lit rectangle inside.',
    modulation: { kind: 'continuous' }
  },
  patternVariety: {
    type: 'number',
    label: 'Pattern variety',
    default: 0,
    min: 0,
    max: 1,
    step: 0.01,
    description: 'Fraction of building faces drawn with a real facade pattern — mullioned curtain wall (panes read as a grid, not flat glass), horizontal ribbon windows, vertical strips, or alternating spandrel floors. Style is hashed per face, so corner towers can mix cladding, and pattern buildings split into floor-lit "offices" vs scatter-lit "residential". 0 = the classic facade mix only.',
    modulation: { kind: 'continuous' }
  },
  floorHeight: {
    type: 'number',
    label: 'Floor height',
    default: 0.50,
    min: 0.25,
    max: 1,
    step: 0.01,
    description: 'Height of each building floor (controls window stacking density).'
  },
  density: {
    type: 'number',
    label: 'Density',
    default: 11,
    min: 4,
    max: 20,
    step: 1,
    description: 'Building density across the city grid. Higher = denser skyline.'
  },
  maxHeight: {
    type: 'number',
    label: 'Max height',
    default: 20,
    min: 4,
    max: 40,
    step: 1,
    description: 'Tallest building height ceiling. Skyscrapers cluster toward this value.'
  },
  footprintVariety: {
    type: 'number',
    label: 'Footprint variety',
    default: 0.35,
    min: 0,
    max: 1,
    step: 0.01,
    description: 'Fraction of buildings with a non-box footprint — beveled or chopped corners (common), with the occasional L-shape or round tower. 0 = all rectangular boxes. Regenerates the skyline.'
  },
  silhouetteVariety: {
    type: 'number',
    label: 'Silhouette variety',
    default: 0,
    min: 0,
    max: 1,
    step: 0.01,
    description: 'Fraction of mid/tall buildings given richer massing than the classic single taper — tiered wedding-cake setbacks, podium-and-tower profiles, and thin-slab / square-point aspect mixes. At >0 the tallest building also grows its spire and a few towers sprout antenna needles. 0 = classic profiles only. Regenerates the skyline.'
  },
  allowEll: {
    type: 'boolean',
    label: 'Allow ell-shaped',
    default: true,
    description: 'Permit rare L-shaped (notched) footprints in the exotic mix. Regenerates the skyline.'
  },
  allowCylinder: {
    type: 'boolean',
    label: 'Allow cylindrical',
    default: true,
    description: 'Permit very rare round-tower footprints in the exotic mix. Regenerates the skyline.'
  },
  streetStyle: {
    type: 'enum',
    label: 'Street style',
    options: ['glow', 'paved'],
    default: 'glow',
    description: 'Ground treatment. glow = the classic warm glow pools between buildings. paved = real streets aligned to the building grid — asphalt with dashed lane lines, sidewalks, crosswalks at intersections, plus warm streetlights. Switching regenerates streetlight + car geometry.'
  },
  streetGlow: {
    type: 'number',
    label: 'Street glow',
    default: 0.70,
    min: 0,
    max: 1,
    step: 0.01,
    description: 'Brightness of the ground-level lighting — the glow pools in glow style, the roadway lighting / streetlight level in paved style.',
    modulation: { kind: 'continuous' }
  },
  traffic: {
    type: 'number',
    label: 'Traffic',
    default: 0,
    min: 0,
    max: 1,
    step: 0.01,
    description: 'Density of moving cars on the streets (paved style). 0 = none; raising it fades in streams of white headlights one way and red taillights the other. Car motion is computed on the GPU, so this is free to animate and modulate.',
    modulation: { kind: 'continuous' }
  },
  carSpeed: {
    type: 'number',
    label: 'Car speed',
    default: 1,
    min: 0.2,
    max: 3,
    step: 0.05,
    description: 'Speed multiplier for the traffic. Bind it to audio to make the cars surge with the music.',
    modulation: { kind: 'continuous' }
  },
  colorVariance: {
    type: 'number',
    label: 'Color variance',
    default: 0.40,
    min: 0,
    max: 1,
    step: 0.01,
    description: 'How much each building tints away from the base palette.'
  },
  sunIntensity: {
    type: 'number',
    label: 'Sunlight',
    default: 0,
    min: 0,
    max: 1,
    step: 0.01,
    description: 'Day-vs-night blend. 0 = night skyline; 1 = full daylight.',
    modulation: { kind: 'continuous' }
  },
  lightColor: {
    type: 'color',
    label: 'Light color',
    default: '#d9a858',
    description: 'Window-light base color.',
    modulation: { kind: 'continuous' }
  },
  speed: {
    type: 'number',
    label: 'Speed',
    default: 1,
    min: 0,
    max: 3,
    step: 0.05,
    description: 'Time-base multiplier for window pulse / flicker animation.',
    modulation: { kind: 'continuous' }
  },
  curvature: {
    type: 'number',
    label: 'Curvature',
    default: 0,
    min: 0,
    max: 1,
    step: 0.01,
    description: 'Pseudo-Earth-curvature bend. 0 = flat plane; 1 = strong horizon arc.',
    modulation: { kind: 'continuous' }
  }
};

export const reactions = {
  pulse: {
    label: 'Pulse',
    description:
      'Send a brightness wave through the lit windows of the skyline. ' +
      'The `entry` strategy controls wave geometry — climb from below, ' +
      'descend from above, or radiate from a random point on the city footprint.',
    accepts: ['oneshot', 'drum-chord', 'drum-flam', 'drum-roll'],
    args: {
      entry: {
        type: 'enum',
        label: 'Entry',
        options: ['bottom-up', 'top-down', 'point-out'],
        default: 'bottom-up',
        description: 'How the wave traverses the skyline.'
      },
      amplitude: {
        type: 'number',
        label: 'Amplitude',
        min: 0,
        max: 2,
        default: 0.7,
        step: 0.05,
        description: 'Peak wave brightness boost. 1.0 ≈ "drum at full velocity."'
      }
    }
  }
};

// ============================================================================
// Adapter — bridges harness lifecycle to City + Camera
// ============================================================================

const DEFAULT_LIGHT_COLOR_RGB = [0.85, 0.65, 0.35];

// Exported for unit tests (config plumbing). The adapter itself calls it
// internally on every render().
export function configFromParams(params) {
  // Translate harness-shaped values into the City constructor's config.
  // The only field that changes shape is `lightColor`: harness ships a
  // hex string ('#rrggbb'); City wants a [r, g, b] float array.
  return {
    seed: params.seed,
    lightRatio: params.lightRatio,
    windowScale: params.windowScale,
    facadeVariety: params.facadeVariety,
    lightFill: params.lightFill,
    patternVariety: params.patternVariety,
    floorHeight: params.floorHeight,
    density: params.density,
    maxHeight: params.maxHeight,
    footprintVariety: params.footprintVariety,
    silhouetteVariety: params.silhouetteVariety,
    allowEll: params.allowEll,
    allowCylinder: params.allowCylinder,
    streetStyle: params.streetStyle,
    traffic: params.traffic,
    carSpeed: params.carSpeed,
    streetGlow: params.streetGlow,
    colorVariance: params.colorVariance,
    sunIntensity: params.sunIntensity,
    lightColor: parseColorGL(params.lightColor, DEFAULT_LIGHT_COLOR_RGB),
    speed: params.speed,
    curvature: params.curvature
  };
}

export default class SkylineLayer {
  init(ctx) {
    this._gl = ctx.gl;
    this._canvas = ctx.canvas;

    // Build the city renderer with the param defaults rolled into the
    // City constructor config. The harness will pass the *current*
    // param values into every render() call, so this is just the
    // initial state — render() forwards any changes via updateConfig.
    const initialDefaults = {};
    for (const name of Object.keys(params)) {
      initialDefaults[name] = params[name].default;
    }
    this._city = new City(this._gl, configFromParams(initialDefaults));
  }

  render(ctx, params, dt) {
    // Forward live param values into the city. updateConfig is cheap
    // (no rebuild) unless `seed` / `density` / `maxHeight` changed.
    this._city.updateConfig(configFromParams(params));

    this._city.update(dt);

    const w = ctx.canvas.width;
    const h = ctx.canvas.height;
    const gl = this._gl;
    gl.viewport(0, 0, w, h);
    gl.clearColor(0.0, 0.02, 0.06, 1); // deep midnight blue
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    // Camera comes from the harness — keyboard input drives orbit /
    // sweep / pan / zoom. `ctx.camera.viewProjection` is the live
    // view-projection matrix the city consumes.
    this._city.render(ctx.camera.viewProjection);
  }

  react(key, args, eventContext) {
    if (key === 'pulse') {
      // The City class accepts an eventContext object with a velocity
      // hint, used as the amplitude default when args.amplitude is
      // absent. Pass the host-supplied eventContext through; fall
      // back to a synthesized mid-velocity (90 ≈ moderately-loud
      // drum hit) when the host didn't carry one.
      this._city.react('pulse', args || {}, eventContext || { velocity: 90 });
    }
  }

  cleanup() {
    if (this._city) this._city.cleanup();
    this._city = null;
  }
}
