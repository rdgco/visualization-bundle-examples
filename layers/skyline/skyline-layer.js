/**
 * Skyline layer — canonical 3D SDK example for the harness.
 *
 * Wraps the City renderer (migrated from the host project's compositor)
 * with the harness contract surface. The renderer logic in `lib/city.js`
 * is untouched from the source; this file is the thin adapter that
 *
 *   - declares the layer's contract surface (key/label/params/reactions)
 *   - manages a viewProj-producing camera since the harness doesn't
 *     provide one
 *   - bridges the harness's `init / render / onReaction / cleanup`
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
  streetGlow: {
    type: 'number',
    label: 'Street glow',
    default: 0.70,
    min: 0,
    max: 1,
    step: 0.01,
    description: 'Brightness of the ground-level glow between buildings.',
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

function configFromParams(params) {
  // Translate harness-shaped values into the City constructor's config.
  // The only field that changes shape is `lightColor`: harness ships a
  // hex string ('#rrggbb'); City wants a [r, g, b] float array.
  return {
    seed: params.seed,
    lightRatio: params.lightRatio,
    windowScale: params.windowScale,
    floorHeight: params.floorHeight,
    density: params.density,
    maxHeight: params.maxHeight,
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

  onReaction(name, args) {
    if (name === 'pulse') {
      // The City class accepts an eventContext object with a velocity
      // hint, used as the amplitude default when args.amplitude is
      // absent. The harness doesn't carry a velocity through the
      // contract, so we synthesize one matching the layer's default
      // amplitude (0.7 ≈ a moderately-loud drum hit).
      this._city.react('pulse', args || {}, { velocity: 90 });
    }
  }

  cleanup() {
    if (this._city) this._city.cleanup();
    this._city = null;
  }
}
