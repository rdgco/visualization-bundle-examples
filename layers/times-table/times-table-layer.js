/**
 * times-table — modular multiplication circle.
 *
 * Places `pointCount` points evenly around a circle. For each point n,
 * draws a chord to point (n × k) mod pointCount. Slowly evolving k morphs
 * the pattern through cardioids (k=2), nephroids (k=3), and progressively
 * more intricate star-burst mandalas as k increases. Non-integer k produces
 * the smooth transitional forms between each pair of closed curves.
 *
 * The pattern has period `pointCount` in k: (n × (k + m)) mod m = (n × k) mod m
 * for integer n and m, so k and k+pointCount are equivalent.
 *
 * Audio: peak brightens line opacity so loud moments make the pattern pop
 * without changing its mathematical structure.
 */

export const key = 'times-table';
export const label = 'Times Table';
export const description = 'Modular multiplication circle: pointCount points placed evenly around a circle, each connected by a chord to the point at (n × multiplier) mod pointCount. Evolving the multiplier morphs the pattern through cardioids (k=2), nephroids (k=3), and progressively denser star mandalas. Rainbow or solid colour mode. Audio peak brightens lines. Snap reaction locks the multiplier to the nearest whole number for clean closed curves.';

const COLOR_MODES = ['rainbow', 'solid'];

export const params = {
  pointCount: {
    type: 'number',
    label: 'Points',
    default: 200,
    min: 3,
    max: 500,
    step: 1,
    description: 'Number of points distributed around the circle. More = finer detail and denser structure. 100–200 is the sweet spot for most patterns.'
  },
  multiplier: {
    type: 'number',
    label: 'Multiplier',
    default: 2,
    min: 0,
    max: 20,
    step: 0.01,
    description: 'Current k value: point n connects to (n × k) mod points. Integer k produces clean closed curves; fractional k produces transitional blends between them.',
    modulation: { kind: 'continuous' }
  },
  speed: {
    type: 'number',
    label: 'Speed',
    default: 0.25,
    min: 0,
    max: 3,
    step: 0.01,
    description: 'Rate at which the multiplier auto-advances in k-units per second. 0 = static — pattern is fully controlled by the multiplier param alone.',
    modulation: { kind: 'continuous' }
  },
  colorMode: {
    type: 'enum',
    label: 'Colour mode',
    options: COLOR_MODES,
    default: 'rainbow',
    description: 'rainbow = each chord hued by its source point, cycling the full spectrum around the circle. solid = single colour set by the line colour param.'
  },
  lineColor: {
    type: 'color',
    label: 'Line colour',
    default: '#8899ff',
    description: 'Stroke colour used in solid mode.'
  },
  lineOpacity: {
    type: 'number',
    label: 'Opacity',
    default: 0.35,
    min: 0.01,
    max: 1,
    step: 0.01,
    description: 'Base opacity of each chord. Dense patterns (high point counts) benefit from low values (0.1–0.2); sparse ones from higher. Audio peak adds up to +0.5.',
    modulation: { kind: 'continuous' }
  },
  lineThickness: {
    type: 'number',
    label: 'Thickness',
    default: 0.75,
    min: 0.1,
    max: 4,
    step: 0.05,
    description: 'Stroke width of each chord in canvas pixels.',
    modulation: { kind: 'continuous' }
  },
  backgroundColor: {
    type: 'color',
    label: 'Background',
    default: '#0a0a14',
    description: 'Background cleared each frame. Dark backgrounds make the coloured chords pop.'
  },
  audio: {
    type: 'audio-data',
    label: 'Audio analysis',
    description: 'Live audio. Peak brightens line opacity so loud moments make the pattern pop without altering its structure.'
  }
};

export const reactions = {
  snap: {
    label: 'Snap multiplier',
    description: 'Snap the current multiplier to the nearest whole number (plus an optional fractional offset), landing on a clean closed curve. Speed continues from there.',
    accepts: ['oneshot', 'drum-chord', 'midi-chord'],
    args: {
      offset: {
        type: 'number',
        label: 'Offset',
        min: -0.5,
        max: 0.5,
        default: 0,
        step: 0.01,
        description: 'Fractional offset from the snapped integer. 0 = exact integer (cardioid, star). 0.5 = half-integer (transitional open form).'
      }
    }
  }
};

// Lines are batched into N_BUCKETS colour groups in rainbow mode to minimise
// strokeStyle changes — 60 stroke() calls instead of one per chord.
const N_BUCKETS = 60;
const TWO_PI = Math.PI * 2;

export default class TimesTableLayer {
  init() {
    // Do not cache ctx.canvas or ctx.ctx2d here — the host runtime may
    // swap canvases between frames. All canvas access happens in render().
    this._k = null;            // null triggers initialisation on first render
    this._lastMultiplier = null;
    // Pre-allocated bucket arrays reused each frame to avoid per-frame allocation.
    this._buckets = Array.from({ length: N_BUCKETS }, () => []);
  }

  render(ctx, params, dt) {
    const c = ctx.ctx2d;
    const canvas = ctx.canvas;
    const safeDt = Math.max(1, Math.min(100, dt || 16.67));

    const w = canvas.width;
    const h = canvas.height;
    const cx = w / 2;
    const cy = h / 2;
    // Radius fills 90% of the shorter canvas dimension.
    const R = Math.min(w, h) * 0.45;

    c.fillStyle = params.backgroundColor;
    c.fillRect(0, 0, w, h);

    // Sync internal k to the multiplier param whenever the user moves the
    // slider; on first render _k is null so we always initialise here.
    if (this._k === null || params.multiplier !== this._lastMultiplier) {
      this._k = params.multiplier;
    }
    this._lastMultiplier = params.multiplier;

    // Auto-advance k then lock lastMultiplier to the param value (not _k)
    // so slider-change detection works next frame regardless of drift.
    this._k += params.speed * (safeDt / 1000);

    const audio = params.audio || {};
    const peak = typeof audio.peak === 'number' ? audio.peak : 0;
    // Audio peak additively brightens opacity, capped at 1.
    const effectiveOpacity = Math.min(1, params.lineOpacity + peak * 0.5);

    const m = Math.max(3, Math.round(params.pointCount));
    const k = this._k;

    c.lineWidth = Math.max(0.1, params.lineThickness);
    c.lineCap = 'round';
    c.globalAlpha = effectiveOpacity;

    if (params.colorMode === 'solid') {
      c.strokeStyle = params.lineColor;
      c.beginPath();
      for (let n = 0; n < m; n++) {
        this._chord(c, cx, cy, R, n, (n * k) % m, m);
      }
      c.stroke();
    } else {
      // Rainbow: assign each chord to a hue bucket by source point index,
      // then draw each bucket as a single path to minimise draw calls.
      const buckets = this._buckets;
      for (let b = 0; b < N_BUCKETS; b++) buckets[b].length = 0;

      for (let n = 0; n < m; n++) {
        const target = (n * k) % m;
        const bi = Math.min(N_BUCKETS - 1, Math.floor((n / m) * N_BUCKETS));
        buckets[bi].push(n, target); // flat pairs to avoid inner array allocation
      }

      for (let b = 0; b < N_BUCKETS; b++) {
        const bucket = buckets[b];
        if (bucket.length === 0) continue;
        c.strokeStyle = `hsl(${(b / N_BUCKETS) * 360},100%,65%)`;
        c.beginPath();
        for (let i = 0; i < bucket.length; i += 2) {
          this._chord(c, cx, cy, R, bucket[i], bucket[i + 1], m);
        }
        c.stroke();
      }
    }

    c.globalAlpha = 1;
  }

  // Draw one chord from point n to point target (both in 0..m range, float ok).
  _chord(c, cx, cy, R, n, target, m) {
    const aAngle = (n / m) * TWO_PI - Math.PI / 2;
    const bAngle = (target / m) * TWO_PI - Math.PI / 2;
    c.moveTo(cx + R * Math.cos(aAngle), cy + R * Math.sin(aAngle));
    c.lineTo(cx + R * Math.cos(bAngle), cy + R * Math.sin(bAngle));
  }

  react(reactionKey, args, _eventContext) {
    const a = args || {};
    if (reactionKey === 'snap') {
      if (this._k !== null) {
        const offset = typeof a.offset === 'number' ? a.offset : 0;
        this._k = Math.round(this._k) + offset;
        // _lastMultiplier is intentionally left unchanged. The next render()
        // compares params.multiplier to _lastMultiplier — if the slider hasn't
        // moved, they're still equal and _k won't be reset to params.multiplier.
      }
      return;
    }
    console.warn(`[times-table] Unknown reaction '${reactionKey}'; declared: snap`);
  }

  cleanup() {
    this._k = null;
    this._lastMultiplier = null;
    for (let b = 0; b < N_BUCKETS; b++) this._buckets[b].length = 0;
  }
}
