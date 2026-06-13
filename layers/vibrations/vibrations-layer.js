/**
 * vibrations — concentric stroked shapes radiating from the canvas
 * center. Audio drives radial displacement so the rings appear to
 * vibrate in different patterns depending on the chosen mode.
 *
 * Visual reference: spirograph-meets-EQ. Stroked rings on a dark
 * wash, no fills, no textures — the motion does the work. Two
 * composable rendering axes (color algorithm × stroke style), plus
 * rotation/twist motion, let one layer cover everything from the
 * original solid-ring look to spinning segmented rainbow vortices.
 *
 * Vibration modes:
 *   pulse    — every ring expands and contracts together with peak.
 *   wave     — a ripple travels outward; outer rings lag inner rings.
 *   jitter   — each ring picks up a deterministic per-ring offset,
 *              scaled by a different frequency band per ring.
 *   counter  — odd / even rings displace in opposite directions.
 *
 * Reactions (all velocity-sensitive via `velocitySense`):
 *   pulse      — slam every ring outward, ease back over `holdMs`.
 *   flash      — flash the background to a chosen color, fade back.
 *   shockwave  — radial wavefront sweeps from center to edge,
 *                briefly pushing each ring as the front passes through.
 *   burst      — transient rings spawn at the center, expand past the
 *                field edge and fade.
 *   colorSweep — a hue-rotation wavefront travels center → edge.
 *   spinKick   — instant angular impulse that decays back to the
 *                rotation-speed baseline.
 */

export const key = 'vibrations';
export const label = 'Vibrations';
export const description = 'Concentric stroked shapes — circles, squares, triangles, or hexagons — radiating from the canvas center. Audio drives radial vibration in one of four modes (pulse, wave, jitter, counter), with composable per-ring color algorithms (gradient, rainbow, band energy, displacement), stroke styles (dashed, dotted, segments), glow, and rotation/twist motion. Six velocity-sensitive reactions punctuate the motion: a whole-field slam, a background flash, a shockwave, expanding burst rings, a hue sweep, and a spin kick.';

const SHAPES = ['circle', 'square', 'triangle', 'hexagon'];
const MODES = ['pulse', 'wave', 'jitter', 'counter'];
const COLOR_MODES = ['solid', 'gradient', 'rainbow', 'bandEnergy', 'displacement'];
const STROKE_STYLES = ['solid', 'dashed', 'dotted', 'segments'];
const LINE_WIDTH_MODES = ['fixed', 'peak', 'bandPerRing'];

// Ordered to walk inner→outer rings across the audio spectrum: bass at
// the center, presence at the edge. Used by the `jitter` mode and the
// `bandEnergy` / `bandPerRing` render options so different rings
// respond to different frequencies.
const JITTER_BAND_ORDER = ['sub', 'bass', 'mid', 'high', 'presence'];

export const params = {
  shape: {
    type: 'enum',
    label: 'Shape',
    options: SHAPES,
    default: 'circle',
    description: 'Which primitive each ring is drawn as.',
    paramGroup: 'shape',
    paramGroupLabel: 'Shape',
    paramGroupCollapsed: false
  },
  ringCount: {
    type: 'number',
    label: 'Ring count',
    default: 18,
    min: 3,
    max: 60,
    step: 1,
    description: 'How many concentric rings fill the field. More = denser pattern.',
    modulation: { kind: 'continuous' },
    paramGroup: 'shape'
  },
  spacing: {
    type: 'number',
    label: 'Spacing',
    default: 22,
    min: 6,
    max: 80,
    step: 1,
    description: 'Gap between rings in pixels. Larger = the pattern reaches the edge with fewer rings.',
    modulation: { kind: 'continuous' },
    paramGroup: 'shape'
  },
  centerGap: {
    type: 'number',
    label: 'Center gap',
    default: 0,
    min: 0,
    max: 30,
    step: 1,
    description: 'Empty ring-slots in the middle before the pattern starts. 0 = pattern fills from the center. Higher = wider hole, turning the pattern into a frame around the empty middle.',
    modulation: { kind: 'continuous' },
    paramGroup: 'shape'
  },
  lineThickness: {
    type: 'number',
    label: 'Line thickness',
    default: 1.5,
    min: 0.25,
    max: 12,
    step: 0.05,
    description: 'Base stroke width of every ring.',
    modulation: { kind: 'continuous' },
    paramGroup: 'stroke',
    paramGroupLabel: 'Stroke'
  },
  lineWidthMode: {
    type: 'enum',
    label: 'Width mode',
    options: LINE_WIDTH_MODES,
    default: 'fixed',
    description:
      'fixed = constant thickness. peak = whole-field width breathes ' +
      'with the audio peak (up to ~2.5x). bandPerRing = each ring\'s ' +
      'width follows its frequency band — sub at the center, presence ' +
      'at the edge.',
    paramGroup: 'stroke'
  },
  strokeStyle: {
    type: 'enum',
    label: 'Stroke style',
    options: STROKE_STYLES,
    default: 'solid',
    description:
      'solid = unbroken outline. dashed / dotted = dash patterns ' +
      'scaled by line thickness. segments = evenly spaced arcs on ' +
      'circles, or evenly dropped edges on polygons — a radar-ring look.',
    paramGroup: 'stroke'
  },
  segmentCount: {
    type: 'number',
    label: 'Segments',
    default: 8,
    min: 2,
    max: 24,
    step: 1,
    description: 'Segments per ring in the segments stroke style. Polygons cap at their edge count and drop edges evenly.',
    modulation: { kind: 'continuous' },
    paramGroup: 'stroke'
  },
  dashSpeed: {
    type: 'number',
    label: 'Dash speed',
    default: 0,
    min: -2,
    max: 2,
    step: 0.01,
    description: 'Orbit speed of dashes / segments around each ring, in revolutions per second. Negative = counter-clockwise. 0 = static.',
    modulation: { kind: 'continuous' },
    paramGroup: 'stroke'
  },
  glow: {
    type: 'number',
    label: 'Glow',
    default: 0,
    min: 0,
    max: 1,
    step: 0.01,
    description: 'Neon halo around each stroke. Rendered with canvas shadowBlur, which is expensive — budget it at high ring counts.',
    modulation: { kind: 'audio' },
    paramGroup: 'stroke'
  },
  colorMode: {
    type: 'enum',
    label: 'Color mode',
    options: COLOR_MODES,
    default: 'solid',
    description:
      'solid = every ring uses Line color. gradient = blend Line ' +
      'color → Line color B from inner to outer ring. rainbow = hue ' +
      'walk across the field (saturation / lightness taken from Line ' +
      'color). bandEnergy = each ring blends toward Line color B with ' +
      'its frequency band\'s energy — a radial spectrum meter. ' +
      'displacement = rings blend toward Line color B as they ' +
      'displace, so motion becomes visible as color.',
    paramGroup: 'stroke'
  },
  lineColor: {
    type: 'color',
    label: 'Line color',
    default: '#9ad7ff',
    description: 'Primary stroke color. In rainbow mode it sets the base hue, saturation, and lightness.',
    modulation: { kind: 'continuous' },
    paramGroup: 'stroke'
  },
  lineColorB: {
    type: 'color',
    label: 'Line color B',
    default: '#ff6ad5',
    description: 'Second stroke color, used by the gradient, bandEnergy, and displacement color modes.',
    modulation: { kind: 'continuous' },
    paramGroup: 'stroke'
  },
  hueSpread: {
    type: 'number',
    label: 'Hue spread',
    default: 180,
    min: 0,
    max: 360,
    step: 1,
    description: 'Degrees of hue covered across the whole field in rainbow color mode.',
    modulation: { kind: 'continuous' },
    paramGroup: 'stroke'
  },
  vibrationMode: {
    type: 'enum',
    label: 'Vibration mode',
    options: MODES,
    default: 'wave',
    description:
      'How rings respond to audio. pulse = all rings breathe together. ' +
      'wave = ripple travels from center outward. jitter = each ring ' +
      'offsets independently, driven by a different frequency band. ' +
      'counter = odd / even rings push opposite directions.',
    paramGroup: 'motion',
    paramGroupLabel: 'Motion'
  },
  vibrationDepth: {
    type: 'number',
    label: 'Vibration depth',
    default: 0.6,
    min: 0,
    max: 1,
    step: 0.01,
    description: 'How far rings displace at peak audio. 0 = static. 1 = a ring can shift by one full spacing-step.',
    modulation: { kind: 'audio' },
    paramGroup: 'motion'
  },
  rotationSpeed: {
    type: 'number',
    label: 'Rotation speed',
    default: 0,
    min: -1,
    max: 1,
    step: 0.01,
    description: 'Whole-field rotation in revolutions per second. Invisible on plain circles; transformative on polygons, dashes, and segments.',
    modulation: { kind: 'continuous' },
    paramGroup: 'motion'
  },
  twist: {
    type: 'number',
    label: 'Twist',
    default: 0,
    min: -30,
    max: 30,
    step: 0.5,
    description: 'Extra rotation per ring, in degrees. Polygon fields become spirals / moiré patterns; combine with Rotation speed for vortex motion.',
    modulation: { kind: 'continuous' },
    paramGroup: 'motion'
  },
  counterRotate: {
    type: 'boolean',
    label: 'Counter-rotate',
    default: false,
    description: 'Odd rings rotate opposite to even rings — the motion analog of the counter vibration mode.',
    paramGroup: 'motion'
  },
  centerDrift: {
    type: 'number',
    label: 'Center drift',
    default: 0,
    min: 0,
    max: 1,
    step: 0.01,
    description: 'Audio-scaled Lissajous wander of the pattern center, up to ~10% of the canvas at full peak. Silence = perfectly centered.',
    modulation: { kind: 'audio' },
    paramGroup: 'motion'
  },
  backgroundColor: {
    type: 'color',
    label: 'Background color',
    default: '#0a0e1a',
    description: 'Canvas wash painted under the rings each frame. Always fully opaque — temporal effects come from stacking filters, not from in-layer alpha.'
  },
  audio: {
    type: 'audio-data',
    label: 'Audio analysis',
    description: 'Live audio analysis. Vibration modes read `peak` and `bands` so rings can respond to different frequencies.'
  }
};

// Shared arg shape: how much hit velocity scales a reaction.
// 0 = ignore velocity (always full strength), 1 = fully proportional.
const VELOCITY_SENSE_ARG = {
  type: 'number',
  label: 'Velocity sense',
  min: 0,
  max: 1,
  default: 1,
  step: 0.01,
  description: 'How much hit velocity scales this reaction. 0 = always full strength, 1 = fully velocity-proportional.'
};

export const reactions = {
  pulse: {
    label: 'Pulse',
    description: 'Slam every ring outward by a fixed offset, then ease back. Whole-field "punch" effect.',
    accepts: ['oneshot', 'drum-chord'],
    args: {
      holdMs: {
        type: 'number',
        label: 'Hold (ms)',
        min: 50,
        max: 2000,
        default: 250,
        step: 10,
        description: 'How long the slam lasts before easing back.'
      },
      intensity: {
        type: 'number',
        label: 'Intensity',
        min: 0,
        max: 1,
        default: 0.7,
        step: 0.01,
        description: 'How far the slam pushes rings, as a fraction of spacing.'
      },
      velocitySense: VELOCITY_SENSE_ARG
    }
  },
  flash: {
    label: 'Flash background',
    description: 'Flash the background to the chosen color, fading back to the configured background over the duration. Velocity scales the flash brightness.',
    accepts: ['oneshot'],
    args: {
      color: {
        type: 'color',
        label: 'Flash color',
        default: '#ffffff',
        description: 'Color of the flash.'
      },
      durationMs: {
        type: 'number',
        label: 'Duration (ms)',
        min: 50,
        max: 2000,
        default: 200,
        step: 10,
        description: 'How long the flash takes to fade.'
      },
      velocitySense: VELOCITY_SENSE_ARG
    }
  },
  shockwave: {
    label: 'Shockwave',
    description: 'A radial wavefront sweeps from center to canvas edge, briefly displacing each ring as the front passes through it.',
    accepts: ['oneshot', 'drum-chord', 'midi-chord'],
    args: {
      durationMs: {
        type: 'number',
        label: 'Duration (ms)',
        min: 100,
        max: 4000,
        default: 800,
        step: 10,
        description: 'How long the wave takes to travel from center to edge.'
      },
      intensity: {
        type: 'number',
        label: 'Intensity',
        min: 0,
        max: 1,
        default: 0.8,
        step: 0.01,
        description: 'Peak displacement when the front passes a ring.'
      },
      velocitySense: VELOCITY_SENSE_ARG
    }
  },
  burst: {
    label: 'Burst',
    description: 'Transient rings spawn at the center, expand past the field edge, and fade out — drawn in the current shape and stroke style. Multiple bursts can be in flight at once.',
    accepts: ['oneshot', 'drum-chord', 'midi-chord'],
    args: {
      durationMs: {
        type: 'number',
        label: 'Duration (ms)',
        min: 100,
        max: 3000,
        default: 900,
        step: 10,
        description: 'How long each burst ring takes to cross the field.'
      },
      count: {
        type: 'number',
        label: 'Ring count',
        min: 1,
        max: 5,
        default: 3,
        step: 1,
        description: 'How many staggered rings each burst spawns.'
      },
      color: {
        type: 'color',
        label: 'Burst color',
        description: 'Optional color override. Leave unset to use the layer\'s line color.'
      },
      velocitySense: VELOCITY_SENSE_ARG
    }
  },
  colorSweep: {
    label: 'Color sweep',
    description: 'A hue-rotation wavefront travels from center to edge — the chromatic sibling of shockwave. Rings near the front shift hue; behind the front the shift washes out.',
    accepts: ['oneshot', 'midi-chord'],
    args: {
      degrees: {
        type: 'number',
        label: 'Hue shift (deg)',
        min: -180,
        max: 180,
        default: 120,
        step: 1,
        description: 'Hue rotation applied at the wavefront, in degrees.'
      },
      durationMs: {
        type: 'number',
        label: 'Duration (ms)',
        min: 100,
        max: 4000,
        default: 1000,
        step: 10,
        description: 'How long the front takes to travel from center to edge.'
      },
      velocitySense: VELOCITY_SENSE_ARG
    }
  },
  spinKick: {
    label: 'Spin kick',
    description: 'Instant angular impulse: the field spins at the given speed and decays back to the Rotation speed baseline. Biggest payoff on polygons with twist.',
    accepts: ['oneshot', 'drum-chord', 'midi-chord'],
    args: {
      intensity: {
        type: 'number',
        label: 'Intensity (rev/s)',
        min: -3,
        max: 3,
        default: 1,
        step: 0.05,
        description: 'Initial spin velocity in revolutions per second. Negative = counter-clockwise.'
      },
      velocitySense: VELOCITY_SENSE_ARG
    }
  }
};

const TWO_PI = Math.PI * 2;
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

// Width of the shockwave's radial profile in pixels — rings within
// this distance of the wavefront feel the displacement, with magnitude
// falling off via cos² toward the edges. ~80px reads as a clean
// "ring of disturbance" rather than a hard edge.
const SHOCKWAVE_WIDTH = 80;

// Width of the colorSweep front in pixels. Wider than the shockwave so
// the hue change reads as a wash rather than a hard chromatic ring.
const SWEEP_WIDTH = 100;

// Pulse-reaction decay time-constant. After the hold window ends, the
// slam value eases back to 0 with this tau so the rings ease in
// rather than snap.
const PULSE_DECAY_MS = 350;

// Spin-kick decay time-constant — the impulse velocity eases back to
// the rotationSpeed baseline with this tau.
const SPIN_KICK_DECAY_MS = 600;

// Audio-peak smoothing tau (ms). Short enough to feel reactive,
// long enough that single-frame spikes don't make the pattern jitter.
const PEAK_TAU_MS = 80;

// Rainbow color mode drifts the whole hue walk slowly over time so a
// static field still shimmers.
const RAINBOW_DRIFT_DEG_PER_SEC = 8;

// Burst rings within one trigger launch staggered by this fraction of
// the burst duration, so a count-3 burst reads as a volley.
const BURST_STAGGER = 0.18;

// Cap on simultaneously tracked bursts / sweeps so a MIDI note flood
// can't grow the pools unbounded. Oldest entry is dropped first.
const REACTION_POOL_MAX = 8;

function num(v, fallback) {
  return (typeof v === 'number' && Number.isFinite(v)) ? v : fallback;
}

function clamp01(v) {
  return Math.max(0, Math.min(1, v));
}

function ema(prev, target, dt, tau) {
  if (typeof prev !== 'number' || !Number.isFinite(prev)) return target;
  if (!Number.isFinite(target)) return prev;
  if (dt <= 0) return prev;
  const alpha = Math.min(1, 1 - Math.exp(-dt / tau));
  return prev + (target - prev) * alpha;
}

// Deterministic per-ring offset in 0..1 — same ring index always
// returns the same value across frames. Lets the jitter mode look
// chaotic but reproducible.
function jitterFor(i) {
  const x = Math.sin(i * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
}

// Frequency-band energy (0..1) for ring `i`, walking the spectrum
// inner→outer per JITTER_BAND_ORDER. Shared by the jitter vibration
// mode and the bandEnergy / bandPerRing render options.
function bandFor(bands, i, ringCount) {
  const idx = Math.min(
    JITTER_BAND_ORDER.length - 1,
    Math.floor((i / ringCount) * JITTER_BAND_ORDER.length)
  );
  const v = bands[JITTER_BAND_ORDER[idx]];
  return typeof v === 'number' ? clamp01(v) : 0;
}

function hexToRgb(hex) {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16)
  ];
}

function rgbToHex(r, g, b) {
  const toHex = n => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

// Linear interpolate between two #rrggbb hex colors. t=0 → a, t=1 → b.
function mixColor(a, b, t) {
  const A = hexToRgb(a);
  const B = hexToRgb(b);
  return rgbToHex(
    A[0] + (B[0] - A[0]) * t,
    A[1] + (B[1] - A[1]) * t,
    A[2] + (B[2] - A[2]) * t
  );
}

// #rrggbb → [hue 0..360, saturation 0..1, lightness 0..1].
function hexToHsl(hex) {
  const [r8, g8, b8] = hexToRgb(hex);
  const r = r8 / 255, g = g8 / 255, b = b8 / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h * 60, s, l];
}

function hslToHex(h, s, l) {
  h = ((h % 360) + 360) % 360;
  if (s === 0) {
    const v = l * 255;
    return rgbToHex(v, v, v);
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const channel = t => {
    t = ((t % 1) + 1) % 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return rgbToHex(
    channel(h / 360 + 1 / 3) * 255,
    channel(h / 360) * 255,
    channel(h / 360 - 1 / 3) * 255
  );
}

function shiftHue(hex, degrees) {
  const [h, s, l] = hexToHsl(hex);
  return hslToHex(h + degrees, s, l);
}

// Approximate stroke-path length of one ring — used to convert the
// dash phase (revolutions) into lineDashOffset pixels so dashes orbit
// at a consistent angular speed. Radius means vertex distance for
// triangle/hexagon and half-side for square (matching drawShape).
function perimeterOf(kind, radius) {
  switch (kind) {
    case 'square': return 8 * radius;
    case 'triangle': return 3 * radius * Math.sqrt(3); // side = circumradius·√3
    case 'hexagon': return 6 * radius;
    default: return TWO_PI * radius;
  }
}

// Polygon vertices in local (untranslated) coordinates, matching the
// orientation drawShape uses for each kind.
function polygonVertices(kind, radius) {
  switch (kind) {
    case 'square':
      return [[-radius, -radius], [radius, -radius], [radius, radius], [-radius, radius]];
    case 'triangle': {
      const v = [];
      for (let i = 0; i < 3; i++) {
        const a = -Math.PI / 2 + (i * TWO_PI) / 3;
        v.push([Math.cos(a) * radius, Math.sin(a) * radius]);
      }
      return v;
    }
    case 'hexagon': {
      const v = [];
      for (let i = 0; i < 6; i++) {
        const a = (i * Math.PI) / 3;
        v.push([Math.cos(a) * radius, Math.sin(a) * radius]);
      }
      return v;
    }
    default:
      return null;
  }
}

function drawShape(c, kind, cx, cy, radius) {
  if (radius <= 0) return;
  c.beginPath();
  switch (kind) {
    case 'square': {
      c.rect(cx - radius, cy - radius, radius * 2, radius * 2);
      break;
    }
    case 'triangle': {
      // Equilateral, point-up. Vertex distance from center = radius.
      for (let i = 0; i < 3; i++) {
        const a = -Math.PI / 2 + (i * 2 * Math.PI) / 3;
        const x = cx + Math.cos(a) * radius;
        const y = cy + Math.sin(a) * radius;
        if (i === 0) c.moveTo(x, y);
        else c.lineTo(x, y);
      }
      c.closePath();
      break;
    }
    case 'hexagon': {
      // Flat-side-up. Vertex distance from center = radius.
      for (let i = 0; i < 6; i++) {
        const a = (i * Math.PI) / 3;
        const x = cx + Math.cos(a) * radius;
        const y = cy + Math.sin(a) * radius;
        if (i === 0) c.moveTo(x, y);
        else c.lineTo(x, y);
      }
      c.closePath();
      break;
    }
    case 'circle':
    default: {
      c.arc(cx, cy, radius, 0, Math.PI * 2);
      break;
    }
  }
  c.stroke();
}

// Segments stroke style. Circles: `segmentCount` arcs, each spanning
// 72% of its slot. Polygons: keep exactly K of the E edges, spread
// evenly via the integer-rhythm rule floor((j+1)K/E) > floor(jK/E)
// (gaps are whole dropped edges, per the radar-ring look).
function drawSegmented(c, kind, cx, cy, radius, theta, segmentCount) {
  if (radius <= 0) return;
  c.beginPath();
  const verts = polygonVertices(kind, radius);
  if (!verts) {
    const k = Math.max(1, Math.round(segmentCount));
    const step = TWO_PI / k;
    const span = step * 0.72;
    for (let j = 0; j < k; j++) {
      const a0 = theta + j * step;
      c.moveTo(cx + Math.cos(a0) * radius, cy + Math.sin(a0) * radius);
      c.arc(cx, cy, radius, a0, a0 + span);
    }
  } else {
    const e = verts.length;
    const k = Math.max(1, Math.min(e, Math.round(segmentCount)));
    const cos = Math.cos(theta);
    const sin = Math.sin(theta);
    for (let j = 0; j < e; j++) {
      if (Math.floor(((j + 1) * k) / e) === Math.floor((j * k) / e)) continue;
      const [x0, y0] = verts[j];
      const [x1, y1] = verts[(j + 1) % e];
      c.moveTo(cx + x0 * cos - y0 * sin, cy + x0 * sin + y0 * cos);
      c.lineTo(cx + x1 * cos - y1 * sin, cy + x1 * sin + y1 * cos);
    }
  }
  c.stroke();
}

export default class VibrationsLayer {
  init() {
    // Caching ctx.canvas / ctx.ctx2d here would be wrong: a host runtime
    // (e.g. midi-daddy's compositor) is free to swap canvases between
    // frames — for instance, routing the layer through an offscreen
    // canvas to apply opacity or chroma-key. Read the canvas + 2d
    // context out of the render() ctx every frame instead.
    this._time = 0;
    this._smoothedPeak = 0;

    // Motion state.
    this._rotation = 0;       // accumulated field rotation, radians
    this._spinKickVel = 0;    // spin-kick impulse velocity, rev/s
    this._dashPhase = 0;      // dash / segment orbit phase, revolutions

    // Stroke-state flags: dash and shadow settings persist on a 2d
    // context, so when the style params turn off we clear them once
    // instead of re-asserting clean state every frame (keeps the
    // default render path free of extra canvas calls).
    this._dashActive = false;
    this._glowActive = false;

    // Reaction state — all timestamps are performance.now()-based.
    this._pulseSlamUntil = 0;
    this._pulseSlamValue = 0;
    this._pulseSlamTarget = 0;

    this._flashUntil = 0;
    this._flashStartedAt = 0;
    this._flashColor = '#ffffff';
    this._flashDurationMs = 200;
    this._flashStrength = 1;

    this._shockwaveUntil = 0;
    this._shockwaveStartedAt = 0;
    this._shockwaveDurationMs = 800;
    this._shockwaveIntensity = 0.8;

    // Multi-shot reaction pools (capped at REACTION_POOL_MAX).
    this._bursts = [];
    this._sweeps = [];
  }

  render(ctx, params, dt) {
    const c = ctx.ctx2d;
    const canvas = ctx.canvas;
    // Clamp dt — a backgrounded tab can produce huge values on resume
    // and a missing first-frame dt comes through as 0/undefined.
    const safeDt = Math.max(1, Math.min(100, dt || 16.67));
    this._time += safeDt;
    const now = performance.now();
    const tSec = this._time / 1000;
    const dtSec = safeDt / 1000;

    const w = canvas.width;
    const h = canvas.height;

    // ── Audio inputs ─────────────────────────────────────────────────
    const audio = params.audio || {};
    const rawPeak = (typeof audio.peak === 'number') ? audio.peak : 0;
    this._smoothedPeak = ema(this._smoothedPeak, rawPeak, safeDt, PEAK_TAU_MS);
    const peak = this._smoothedPeak;
    const bands = audio.bands || {};

    // ── Background, with optional flash overlay ──────────────────────
    // The flash interpolates from `flashColor` back to the configured
    // background over `flashDurationMs`. Painting the flash AS the
    // background (not over the rings) keeps the rings sharp during
    // the flash. Velocity scales the flash start point toward the
    // base background, so soft hits flash dimly. The background is
    // always painted fully opaque — temporal effects come from
    // stacking filters, never from in-layer alpha washing.
    let bg = params.backgroundColor;
    if (now < this._flashUntil) {
      const t = clamp01((now - this._flashStartedAt) / this._flashDurationMs);
      const startColor = this._flashStrength >= 1
        ? this._flashColor
        : mixColor(params.backgroundColor, this._flashColor, this._flashStrength);
      bg = mixColor(startColor, params.backgroundColor, t);
    }
    c.fillStyle = bg;
    c.fillRect(0, 0, w, h);

    // ── Pulse-reaction decay ─────────────────────────────────────────
    if (now < this._pulseSlamUntil) {
      this._pulseSlamValue = this._pulseSlamTarget;
    } else {
      this._pulseSlamValue = ema(this._pulseSlamValue, 0, safeDt, PULSE_DECAY_MS);
    }

    // ── Motion integration ───────────────────────────────────────────
    // Spin-kick velocity eases back to 0, so total angular velocity
    // returns to the rotationSpeed baseline after a kick.
    this._spinKickVel = ema(this._spinKickVel, 0, safeDt, SPIN_KICK_DECAY_MS);
    if (Math.abs(this._spinKickVel) < 1e-3) this._spinKickVel = 0;
    const rotationSpeed = num(params.rotationSpeed, 0);
    this._rotation = (this._rotation + (rotationSpeed + this._spinKickVel) * TWO_PI * dtSec) % TWO_PI;
    const dashSpeed = num(params.dashSpeed, 0);
    this._dashPhase += dashSpeed * dtSec;

    // ── Pattern center, with optional audio-driven drift ────────────
    // Lissajous wander: two slow sines at incommensurate frequencies,
    // amplitude scaled by both the param and the smoothed peak so
    // silence stays perfectly centered.
    let cx = w / 2;
    let cy = h / 2;
    const drift = clamp01(num(params.centerDrift, 0));
    if (drift > 0) {
      const amp = drift * Math.min(w, h) * 0.1 * peak;
      cx += Math.sin(tSec * 0.73) * amp;
      cy += Math.sin(tSec * 0.527) * amp;
    }

    // ── Geometry / state ─────────────────────────────────────────────
    const ringCount = Math.max(3, Math.round(num(params.ringCount, 18)));
    const spacing = Math.max(1, num(params.spacing, 22));
    const centerGap = Math.max(0, Math.round(num(params.centerGap, 0)));
    const depth = clamp01(num(params.vibrationDepth, 0));
    const mode = params.vibrationMode;
    const maxRadius = Math.hypot(w, h) / 2;

    // ── Stroke configuration ─────────────────────────────────────────
    // Every new option defaults to the original layer's behavior, and
    // unknown / missing values fall back the same way — the default
    // render path must stay call-for-call identical to the original.
    const shape = params.shape || 'circle';
    const colorMode = COLOR_MODES.includes(params.colorMode) ? params.colorMode : 'solid';
    const strokeStyle = STROKE_STYLES.includes(params.strokeStyle) ? params.strokeStyle : 'solid';
    const widthMode = LINE_WIDTH_MODES.includes(params.lineWidthMode) ? params.lineWidthMode : 'fixed';
    const glow = clamp01(num(params.glow, 0));
    const lineColor = params.lineColor;
    const lineColorB = (typeof params.lineColorB === 'string') ? params.lineColorB : '#ff6ad5';
    const hueSpread = num(params.hueSpread, 180);
    const segmentCount = num(params.segmentCount, 8);
    const twistRad = num(params.twist, 0) * Math.PI / 180;
    const counterRotate = !!params.counterRotate;
    const baseWidth = Math.max(0.1, params.lineThickness);

    c.strokeStyle = lineColor;
    c.lineWidth = widthMode === 'peak' ? baseWidth * (1 + 1.5 * peak) : baseWidth;
    c.lineJoin = 'miter';
    c.lineCap = strokeStyle === 'dotted' ? 'round' : 'butt';

    const dashed = strokeStyle === 'dashed' || strokeStyle === 'dotted';
    if (strokeStyle === 'dashed') {
      c.setLineDash([Math.max(4, baseWidth * 4), Math.max(3, baseWidth * 2.5)]);
      this._dashActive = true;
    } else if (strokeStyle === 'dotted') {
      // Near-zero dash length + round caps reads as a dot chain.
      c.setLineDash([0.1, Math.max(4, baseWidth * 3)]);
      this._dashActive = true;
    } else if (this._dashActive) {
      c.setLineDash([]);
      c.lineDashOffset = 0;
      this._dashActive = false;
    }

    if (glow > 0) {
      c.shadowBlur = 6 + glow * 30;
      c.shadowColor = lineColor;
      this._glowActive = true;
    } else if (this._glowActive) {
      c.shadowBlur = 0;
      this._glowActive = false;
    }

    // Prune expired colorSweeps. A sweep stays alive past durationMs
    // (front at the canvas edge) so its behind-the-front tail can wash
    // out by distance instead of popping off.
    if (this._sweeps.length) {
      this._sweeps = this._sweeps.filter(s => now < s.startedAt + s.durationMs * 1.6);
    }
    const sweepsActive = this._sweeps.length > 0;
    const perRingColor = colorMode !== 'solid' || sweepsActive;
    const baseHsl = (colorMode === 'rainbow') ? hexToHsl(lineColor) : null;

    // A plain stroked circle is rotation-invariant — skip the
    // transform entirely so the default path stays untouched.
    const rotationDrawn = shape !== 'circle' || strokeStyle !== 'solid';

    for (let i = 0; i < ringCount; i++) {
      // `i` stays the visible-ring index (0..ringCount-1) so wave/jitter
      // phasing reads as starting from the inner edge of the visible
      // pattern; centerGap just shifts every ring outward by N slots.
      const baseRadius = (i + 1 + centerGap) * spacing;
      const maxDisp = depth * spacing;

      // Mode-dependent audio displacement, in pixels.
      let displacement = 0;
      switch (mode) {
        case 'pulse':
          displacement = peak * maxDisp;
          break;
        case 'wave': {
          // Sine wave traveling outward. Audio peak modulates amplitude
          // so loud passages have larger excursions; the constant 0.4
          // floor keeps the wave visible during silence.
          const phase = i * 0.45 - tSec * 4;
          displacement = Math.sin(phase) * maxDisp * (0.4 + peak * 0.6);
          break;
        }
        case 'jitter': {
          // Per-ring deterministic offset, scaled by the band assigned
          // to this ring's slot in the spectrum walk.
          const bandValue = bandFor(bands, i, ringCount);
          const sign = jitterFor(i) > 0.5 ? 1 : -1;
          const wobble = Math.sin(tSec * (3 + jitterFor(i) * 6)) * sign;
          displacement = wobble * maxDisp * (0.3 + bandValue * 0.7);
          break;
        }
        case 'counter': {
          const parity = (i % 2 === 0) ? 1 : -1;
          const beat = Math.sin(tSec * 5);
          displacement = parity * beat * maxDisp * (0.3 + peak * 0.7);
          break;
        }
      }

      // Reaction: shockwave — moving radial front. Travels from r=0 to
      // r=maxRadius over `durationMs`. Cos² profile means rings within
      // SHOCKWAVE_WIDTH of the front feel a smooth bump.
      if (now < this._shockwaveUntil) {
        const t = (now - this._shockwaveStartedAt) / this._shockwaveDurationMs;
        const frontRadius = t * maxRadius;
        const distance = Math.abs(baseRadius - frontRadius);
        if (distance < SHOCKWAVE_WIDTH) {
          const profile = Math.cos((distance / SHOCKWAVE_WIDTH) * (Math.PI / 2)) ** 2;
          displacement += profile * spacing * this._shockwaveIntensity;
        }
      }

      // Reaction: pulse — uniform outward slam.
      const slam = this._pulseSlamValue * spacing;
      const radius = baseRadius + displacement + slam;

      // Per-ring stroke width.
      if (widthMode === 'bandPerRing') {
        c.lineWidth = baseWidth * (0.4 + 2.1 * bandFor(bands, i, ringCount));
      }

      // Per-ring stroke color.
      if (perRingColor) {
        let color = lineColor;
        switch (colorMode) {
          case 'gradient':
            color = mixColor(lineColor, lineColorB, ringCount > 1 ? i / (ringCount - 1) : 0);
            break;
          case 'rainbow': {
            const hue = baseHsl[0] + (i / ringCount) * hueSpread + tSec * RAINBOW_DRIFT_DEG_PER_SEC;
            color = hslToHex(hue, baseHsl[1], baseHsl[2]);
            break;
          }
          case 'bandEnergy':
            color = mixColor(lineColor, lineColorB, bandFor(bands, i, ringCount));
            break;
          case 'displacement':
            // Normalize against one spacing-step — the natural maximum
            // excursion — so fully displaced rings hit lineColorB.
            color = mixColor(lineColor, lineColorB, Math.min(1, Math.abs(displacement + slam) / spacing));
            break;
        }

        // Reaction: colorSweep — hue-rotation front. Full shift within
        // SWEEP_WIDTH of the front (cos² ramp on the leading side);
        // behind the front the shift decays with distance so the wave
        // leaves a fading chromatic wake.
        if (sweepsActive) {
          let shift = 0;
          for (const s of this._sweeps) {
            const front = ((now - s.startedAt) / s.durationMs) * maxRadius;
            const ahead = baseRadius - front;
            if (ahead >= SWEEP_WIDTH) continue;
            if (ahead >= 0) {
              shift += s.degrees * Math.cos((ahead / SWEEP_WIDTH) * (Math.PI / 2)) ** 2;
            } else {
              shift += s.degrees * Math.max(0, 1 - (-ahead) / (maxRadius * 0.6));
            }
          }
          if (shift !== 0) color = shiftHue(color, shift);
        }

        c.strokeStyle = color;
        if (glow > 0) c.shadowColor = color;
      }

      // Dash orbit: convert phase (revolutions) into path-length
      // pixels so dashes circle at a consistent angular speed.
      if (dashed && this._dashPhase !== 0) {
        c.lineDashOffset = -this._dashPhase * perimeterOf(shape, radius);
      }

      // Ring rotation: field rotation (optionally counter-rotating on
      // odd rings) plus the per-ring twist.
      let theta = 0;
      if (rotationDrawn) {
        const dir = (counterRotate && (i % 2 === 1)) ? -1 : 1;
        theta = this._rotation * dir + i * twistRad;
      }

      if (strokeStyle === 'segments') {
        // Segment gaps orbit via the dash phase, same speed knob as
        // the dashed styles.
        drawSegmented(c, shape, cx, cy, radius, theta + this._dashPhase * TWO_PI, segmentCount);
      } else if (theta !== 0) {
        c.save();
        c.translate(cx, cy);
        c.rotate(theta);
        drawShape(c, shape, 0, 0, radius);
        c.restore();
      } else {
        drawShape(c, shape, cx, cy, radius);
      }
    }

    // ── Reaction: bursts — transient expanding rings, drawn on top ───
    if (this._bursts.length) {
      this._bursts = this._bursts.filter(
        b => now < b.startedAt + b.durationMs * (1 + (b.count - 1) * BURST_STAGGER)
      );
      let drewBurst = false;
      for (const b of this._bursts) {
        for (let k = 0; k < b.count; k++) {
          const tk = (now - b.startedAt - k * b.durationMs * BURST_STAGGER) / b.durationMs;
          if (tk < 0 || tk >= 1) continue;
          // Ease-out: fast launch from the center, slowing toward the
          // edge while the alpha fades linearly.
          const eased = 1 - (1 - tk) ** 2;
          const burstColor = b.color || lineColor;
          c.globalAlpha = (1 - tk) * b.strength;
          c.strokeStyle = burstColor;
          if (glow > 0) c.shadowColor = burstColor;
          c.lineWidth = baseWidth * (1.6 - 0.6 * tk);
          drawShape(c, shape, cx, cy, eased * (maxRadius + spacing));
          drewBurst = true;
        }
      }
      if (drewBurst) c.globalAlpha = 1;
    }
  }

  react(key, args, eventContext) {
    const a = args || {};
    const now = performance.now();

    // Velocity scaling, shared by every reaction: MIDI-style velocity
    // (0..127) normalizes to 0..1; absent velocity means full strength.
    // `velocitySense` dials how much it matters — 0 ignores velocity,
    // 1 is fully proportional.
    const velocity = (eventContext && typeof eventContext.velocity === 'number')
      ? clamp01(eventContext.velocity / 127)
      : 1;
    const sense = clamp01(num(a.velocitySense, 1));
    const velScale = 1 - sense * (1 - velocity);

    switch (key) {
      case 'pulse': {
        const hold = num(a.holdMs, 250);
        const intensity = num(a.intensity, 0.7) * velScale;
        this._pulseSlamTarget = intensity;
        this._pulseSlamValue = intensity;
        this._pulseSlamUntil = now + hold;
        return;
      }
      case 'flash': {
        this._flashColor = (typeof a.color === 'string' && HEX_COLOR.test(a.color))
          ? a.color
          : '#ffffff';
        this._flashDurationMs = num(a.durationMs, 200);
        this._flashStrength = velScale;
        this._flashStartedAt = now;
        this._flashUntil = now + this._flashDurationMs;
        return;
      }
      case 'shockwave': {
        this._shockwaveDurationMs = num(a.durationMs, 800);
        this._shockwaveIntensity = num(a.intensity, 0.8) * velScale;
        this._shockwaveStartedAt = now;
        this._shockwaveUntil = now + this._shockwaveDurationMs;
        return;
      }
      case 'burst': {
        if (this._bursts.length >= REACTION_POOL_MAX) this._bursts.shift();
        this._bursts.push({
          startedAt: now,
          durationMs: num(a.durationMs, 900),
          count: Math.max(1, Math.min(5, Math.round(num(a.count, 3)))),
          // null = resolve to the layer's line color at render time.
          color: (typeof a.color === 'string' && HEX_COLOR.test(a.color)) ? a.color : null,
          strength: velScale
        });
        return;
      }
      case 'colorSweep': {
        if (this._sweeps.length >= REACTION_POOL_MAX) this._sweeps.shift();
        this._sweeps.push({
          startedAt: now,
          durationMs: num(a.durationMs, 1000),
          degrees: num(a.degrees, 120) * velScale
        });
        return;
      }
      case 'spinKick': {
        this._spinKickVel = num(a.intensity, 1) * velScale;
        return;
      }
      default:
        console.warn(`[vibrations] Unknown reaction '${key}'; declared: pulse, flash, shockwave, burst, colorSweep, spinKick`);
    }
  }

  cleanup() {
    this._time = 0;
    this._smoothedPeak = 0;
    this._rotation = 0;
    this._spinKickVel = 0;
    this._dashPhase = 0;
    this._dashActive = false;
    this._glowActive = false;
    this._pulseSlamUntil = 0;
    this._pulseSlamValue = 0;
    this._pulseSlamTarget = 0;
    this._flashUntil = 0;
    this._flashStrength = 1;
    this._shockwaveUntil = 0;
    this._bursts = [];
    this._sweeps = [];
  }
}
