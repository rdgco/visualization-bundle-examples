/**
 * vibrations — concentric stroked shapes radiating from the canvas
 * center. Audio drives radial displacement so the rings appear to
 * vibrate in different patterns depending on the chosen mode.
 *
 * Visual reference: spirograph-meets-EQ. Solid stroke on a dark wash,
 * no fills, no textures — the motion does the work.
 *
 * Vibration modes:
 *   pulse    — every ring expands and contracts together with peak.
 *   wave     — a ripple travels outward; outer rings lag inner rings.
 *   jitter   — each ring picks up a deterministic per-ring offset,
 *              scaled by a different frequency band per ring.
 *   counter  — odd / even rings displace in opposite directions.
 *
 * Reactions:
 *   pulse      — slam every ring outward, ease back over `holdMs`.
 *   flash      — flash the background to a chosen color, fade back.
 *   shockwave  — radial wavefront sweeps from center to edge,
 *                briefly pushing each ring as the front passes through.
 */

export const key = 'vibrations';
export const label = 'Vibrations';
export const description = 'Concentric stroked shapes — circles, squares, triangles, or hexagons — radiating from the canvas center. Audio drives radial vibration in one of four modes (pulse, wave, jitter, counter). Three reactions punctuate the motion: a whole-field outward slam, a background flash, and a shockwave that ripples from center to edge.';

const SHAPES = ['circle', 'square', 'triangle', 'hexagon'];
const MODES = ['pulse', 'wave', 'jitter', 'counter'];

// Ordered to walk inner→outer rings across the audio spectrum: bass at
// the center, presence at the edge. Used by the `jitter` mode so
// different rings respond to different frequencies.
const JITTER_BAND_ORDER = ['sub', 'bass', 'mid', 'high', 'presence'];

export const params = {
  shape: {
    type: 'enum',
    label: 'Shape',
    options: SHAPES,
    default: 'circle',
    description: 'Which primitive each ring is drawn as.'
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
      'counter = odd / even rings push opposite directions.'
  },
  ringCount: {
    type: 'number',
    label: 'Ring count',
    default: 18,
    min: 3,
    max: 60,
    step: 1,
    description: 'How many concentric rings fill the field. More = denser pattern.',
    modulation: { kind: 'continuous' }
  },
  spacing: {
    type: 'number',
    label: 'Spacing',
    default: 22,
    min: 6,
    max: 80,
    step: 1,
    description: 'Gap between rings in pixels. Larger = the pattern reaches the edge with fewer rings.',
    modulation: { kind: 'continuous' }
  },
  centerGap: {
    type: 'number',
    label: 'Center gap',
    default: 0,
    min: 0,
    max: 30,
    step: 1,
    description: 'Empty ring-slots in the middle before the pattern starts. 0 = pattern fills from the center. Higher = wider hole, turning the pattern into a frame around the empty middle.',
    modulation: { kind: 'continuous' }
  },
  lineThickness: {
    type: 'number',
    label: 'Line thickness',
    default: 1.5,
    min: 0.25,
    max: 12,
    step: 0.05,
    description: 'Stroke width of every ring.',
    modulation: { kind: 'continuous' }
  },
  vibrationDepth: {
    type: 'number',
    label: 'Vibration depth',
    default: 0.6,
    min: 0,
    max: 1,
    step: 0.01,
    description: 'How far rings displace at peak audio. 0 = static. 1 = a ring can shift by one full spacing-step.',
    modulation: { kind: 'audio' }
  },
  lineColor: {
    type: 'color',
    label: 'Line color',
    default: '#9ad7ff',
    description: 'Stroke color shared by every ring.',
    modulation: { kind: 'continuous' }
  },
  backgroundColor: {
    type: 'color',
    label: 'Background color',
    default: '#0a0e1a',
    description: 'Canvas wash painted under the rings each frame.'
  },
  audio: {
    type: 'audio-data',
    label: 'Audio analysis',
    description: 'Live audio analysis. Vibration modes read `peak` and `bands` so rings can respond to different frequencies.'
  }
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
      }
    }
  },
  flash: {
    label: 'Flash background',
    description: 'Flash the background to the chosen color, fading back to the configured background over the duration.',
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
      }
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
      }
    }
  }
};

// Width of the shockwave's radial profile in pixels — rings within
// this distance of the wavefront feel the displacement, with magnitude
// falling off via cos² toward the edges. ~80px reads as a clean
// "ring of disturbance" rather than a hard edge.
const SHOCKWAVE_WIDTH = 80;

// Pulse-reaction decay time-constant. After the hold window ends, the
// slam value eases back to 0 with this tau so the rings ease in
// rather than snap.
const PULSE_DECAY_MS = 350;

// Audio-peak smoothing tau (ms). Short enough to feel reactive,
// long enough that single-frame spikes don't make the pattern jitter.
const PEAK_TAU_MS = 80;

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

// Linear interpolate between two #rrggbb hex colors. t=0 → a, t=1 → b.
function mixColor(a, b, t) {
  const ar = parseInt(a.slice(1, 3), 16);
  const ag = parseInt(a.slice(3, 5), 16);
  const ab = parseInt(a.slice(5, 7), 16);
  const br = parseInt(b.slice(1, 3), 16);
  const bg = parseInt(b.slice(3, 5), 16);
  const bb = parseInt(b.slice(5, 7), 16);
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  const toHex = n => n.toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(bl)}`;
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

export default class VibrationsLayer {
  init() {
    // Caching ctx.canvas / ctx.ctx2d here would be wrong: a host runtime
    // (e.g. midi-daddy's compositor) is free to swap canvases between
    // frames — for instance, routing the layer through an offscreen
    // canvas to apply opacity or chroma-key. Read the canvas + 2d
    // context out of the render() ctx every frame instead.
    this._time = 0;
    this._smoothedPeak = 0;

    // Reaction state — all timestamps are performance.now()-based.
    this._pulseSlamUntil = 0;
    this._pulseSlamValue = 0;
    this._pulseSlamTarget = 0;

    this._flashUntil = 0;
    this._flashStartedAt = 0;
    this._flashColor = '#ffffff';
    this._flashDurationMs = 200;

    this._shockwaveUntil = 0;
    this._shockwaveStartedAt = 0;
    this._shockwaveDurationMs = 800;
    this._shockwaveIntensity = 0.8;
  }

  render(ctx, params, dt) {
    const c = ctx.ctx2d;
    const canvas = ctx.canvas;
    // Clamp dt — a backgrounded tab can produce huge values on resume
    // and a missing first-frame dt comes through as 0/undefined.
    const safeDt = Math.max(1, Math.min(100, dt || 16.67));
    this._time += safeDt;
    const now = performance.now();

    const w = canvas.width;
    const h = canvas.height;
    const cx = w / 2;
    const cy = h / 2;

    // ── Background, with optional flash overlay ──────────────────────
    // The flash interpolates from `flashColor` back to the configured
    // background over `flashDurationMs`. Painting the flash AS the
    // background (not over the rings) keeps the rings sharp during
    // the flash.
    let bg = params.backgroundColor;
    if (now < this._flashUntil) {
      const t = (now - this._flashStartedAt) / this._flashDurationMs;
      bg = mixColor(this._flashColor, params.backgroundColor, Math.max(0, Math.min(1, t)));
    }
    c.fillStyle = bg;
    c.fillRect(0, 0, w, h);

    // ── Audio inputs ─────────────────────────────────────────────────
    const audio = params.audio || {};
    const rawPeak = (typeof audio.peak === 'number') ? audio.peak : 0;
    this._smoothedPeak = ema(this._smoothedPeak, rawPeak, safeDt, PEAK_TAU_MS);
    const peak = this._smoothedPeak;
    const bands = audio.bands || {};

    // ── Pulse-reaction decay ─────────────────────────────────────────
    if (now < this._pulseSlamUntil) {
      this._pulseSlamValue = this._pulseSlamTarget;
    } else {
      this._pulseSlamValue = ema(this._pulseSlamValue, 0, safeDt, PULSE_DECAY_MS);
    }

    // ── Geometry / state ─────────────────────────────────────────────
    const ringCount = Math.max(3, Math.round(params.ringCount));
    const spacing = Math.max(1, params.spacing);
    const centerGap = Math.max(0, Math.round(params.centerGap));
    const depth = Math.max(0, Math.min(1, params.vibrationDepth));
    const mode = params.vibrationMode;
    const tSec = this._time / 1000;
    const maxRadius = Math.hypot(w, h) / 2;

    c.strokeStyle = params.lineColor;
    c.lineWidth = Math.max(0.1, params.lineThickness);
    c.lineJoin = 'miter';
    c.lineCap = 'butt';

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
          const bandName = JITTER_BAND_ORDER[Math.min(JITTER_BAND_ORDER.length - 1, Math.floor((i / ringCount) * JITTER_BAND_ORDER.length))];
          const bandValue = typeof bands[bandName] === 'number' ? bands[bandName] : 0;
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

      drawShape(c, params.shape, cx, cy, baseRadius + displacement + slam);
    }
  }

  onReaction(name, args) {
    const a = args || {};
    const now = performance.now();
    switch (name) {
      case 'pulse': {
        const hold = typeof a.holdMs === 'number' ? a.holdMs : 250;
        const intensity = typeof a.intensity === 'number' ? a.intensity : 0.7;
        this._pulseSlamTarget = intensity;
        this._pulseSlamValue = intensity;
        this._pulseSlamUntil = now + hold;
        return;
      }
      case 'flash': {
        this._flashColor = (typeof a.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(a.color))
          ? a.color
          : '#ffffff';
        this._flashDurationMs = typeof a.durationMs === 'number' ? a.durationMs : 200;
        this._flashStartedAt = now;
        this._flashUntil = now + this._flashDurationMs;
        return;
      }
      case 'shockwave': {
        this._shockwaveDurationMs = typeof a.durationMs === 'number' ? a.durationMs : 800;
        this._shockwaveIntensity = typeof a.intensity === 'number' ? a.intensity : 0.8;
        this._shockwaveStartedAt = now;
        this._shockwaveUntil = now + this._shockwaveDurationMs;
        return;
      }
      default:
        console.warn(`[vibrations] Unknown reaction '${name}'; declared: pulse, flash, shockwave`);
    }
  }

  cleanup() {
    this._time = 0;
    this._smoothedPeak = 0;
    this._pulseSlamUntil = 0;
    this._pulseSlamValue = 0;
    this._pulseSlamTarget = 0;
    this._flashUntil = 0;
    this._shockwaveUntil = 0;
  }
}
