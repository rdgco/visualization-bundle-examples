/**
 * spirograph — hypotrochoid and epitrochoid curve tracer.
 *
 * Simulates a point attached to a small circle rolling inside (hypotrochoid)
 * or outside (epitrochoid) a fixed circle. When R/r is rational the curve
 * is closed; the ratio controls petal count and shape family.
 *
 * Two trace modes:
 *   draw — the curve traces itself over time; old strokes fade at a
 *           configurable rate. Changing params mid-trace layers new curves
 *           over the fading ghost of the old one.
 *   full — the complete closed curve is redrawn every frame.
 *
 * Colour modes:
 *   spectrum — hue advances with t, cycling the full rainbow once per
 *              closed curve. In draw mode the trace is a coloured ribbon;
 *              in full mode the curve is painted in 360 hue segments.
 *   solid    — single colour throughout.
 *
 * Audio: peak additively brightens opacity.
 */

export const key = 'spirograph';
export const label = 'Spirograph';
export const description = 'Hypotrochoid and epitrochoid curve tracer. A point on a small circle rolling inside (hypo) or outside (epi) a fixed circle traces closed petal curves when the radii ratio is rational. Draw mode accumulates the trace with a configurable fade; full mode redraws the complete curve every frame. Spectrum colour maps hue to parameter t. Audio peak brightens lines. Clear reaction wipes the canvas for a fresh start.';

const MODES = ['hypo', 'epi'];
const TRACE_MODES = ['draw', 'full'];
const COLOR_MODES = ['spectrum', 'solid'];

export const params = {
  innerRatio: {
    type: 'number',
    label: 'Inner ratio',
    default: 0.4,
    min: 0.05,
    max: 0.95,
    step: 0.005,
    description: 'r/R — rolling circle radius as a fraction of the fixed circle. Controls petal count: ≈1/n gives (n-1) petals in hypo mode, n petals in epi mode.',
    modulation: { kind: 'continuous' }
  },
  armLength: {
    type: 'number',
    label: 'Arm length',
    default: 1,
    min: 0,
    max: 2,
    step: 0.01,
    description: 'Tracing arm as a multiple of the rolling-circle radius. 1 = point on the rim (clean petals). < 1 = contracted (rounded). > 1 = extended beyond the rim (looping petals).',
    modulation: { kind: 'continuous' }
  },
  mode: {
    type: 'enum',
    label: 'Mode',
    options: MODES,
    default: 'hypo',
    description: 'hypo = rolling circle inside the fixed circle (inward petal forms). epi = rolling circle outside (outward spiked forms, often with loops at armLength > 1).'
  },
  traceMode: {
    type: 'enum',
    label: 'Trace mode',
    options: TRACE_MODES,
    default: 'draw',
    description: 'draw = the curve traces itself over time, fading at the trailDecay rate. full = the complete closed curve is drawn fresh every frame.'
  },
  speed: {
    type: 'number',
    label: 'Speed',
    default: 0.12,
    min: 0.001,
    max: 60,
    step: 0.001,
    description: 'Drawing speed in complete curves per second. 1 = one closed curve per second. 60 = one per frame at 60 fps (as fast as possible). Scales automatically with innerRatio so the visual pace is consistent across different petal counts.',
    modulation: { kind: 'continuous' }
  },
  trailDecay: {
    type: 'number',
    label: 'Trail decay',
    default: 0.998,
    min: 0,
    max: 0.999,
    step: 0.001,
    description: 'In draw mode: fraction of brightness retained per frame. 0 = instant clear (fresh each frame). 0.999 = very slow fade, trace persists many seconds.'
  },
  colorMode: {
    type: 'enum',
    label: 'Colour mode',
    options: COLOR_MODES,
    default: 'spectrum',
    description: 'spectrum = hue follows t as the curve is drawn, cycling the full rainbow once per closed period. solid = single colour throughout.'
  },
  lineColor: {
    type: 'color',
    label: 'Line colour',
    default: '#cc88ff',
    description: 'Stroke colour used in solid mode.'
  },
  lineOpacity: {
    type: 'number',
    label: 'Opacity',
    default: 0.9,
    min: 0.01,
    max: 1,
    step: 0.01,
    description: 'Opacity of the drawn stroke. Audio peak adds up to +0.1 on top of this.',
    modulation: { kind: 'continuous' }
  },
  lineThickness: {
    type: 'number',
    label: 'Thickness',
    default: 1.5,
    min: 0.1,
    max: 5,
    step: 0.05,
    description: 'Stroke width in canvas pixels.',
    modulation: { kind: 'continuous' }
  },
  backgroundColor: {
    type: 'color',
    label: 'Background',
    default: '#0a0a14',
    description: 'Background colour. In draw mode this is applied at reduced opacity each frame to produce the trail fade.'
  },
  audio: {
    type: 'audio-data',
    label: 'Audio analysis',
    description: 'Live audio. Peak additively brightens opacity so transients make the trace pop.'
  }
};

export const reactions = {
  clear: {
    label: 'Clear',
    description: 'Wipe the canvas immediately and restart the trace from t=0.',
    accepts: ['oneshot', 'drum-chord'],
    args: {
      fillColor: {
        type: 'color',
        label: 'Fill colour',
        default: '#0a0a14',
        description: 'Colour to fill the canvas with when clearing. Match to your background colour for a seamless cut.'
      }
    }
  }
};

const TWO_PI = Math.PI * 2;

// Estimate the closed-curve period (in parameter t) for a given innerRatio.
// For R/r = p/q (coprime integers), the period is 2π * q.
// We find q by searching for the smallest denominator that makes R/r ≈ p/q
// within a tolerance, up to maxDenom. Falls back to 2π * maxDenom revolutions
// which always produces a complete (if dense) pattern.
function estimatePeriod(innerRatio, maxDenom = 32) {
  const Rr = 1 / innerRatio; // R/r
  for (let q = 1; q <= maxDenom; q++) {
    const p = Math.round(Rr * q);
    if (p > 0 && Math.abs(Rr - p / q) < 0.01) {
      return TWO_PI * q;
    }
  }
  return TWO_PI * maxDenom;
}

// Compute the tracing-point position for parameter t.
function spiroPoint(t, R, r, d, isEpi) {
  if (isEpi) {
    return [
      (R + r) * Math.cos(t) - d * Math.cos(((R + r) / r) * t),
      (R + r) * Math.sin(t) - d * Math.sin(((R + r) / r) * t)
    ];
  }
  return [
    (R - r) * Math.cos(t) + d * Math.cos(((R - r) / r) * t),
    (R - r) * Math.sin(t) - d * Math.sin(((R - r) / r) * t)
  ];
}

export default class SpirographLayer {
  init() {
    // Do not cache ctx.canvas or ctx.ctx2d here — the host runtime may
    // swap canvases between frames. All canvas access happens in render().
    this._t = 0;
    this._prevX = null;
    this._prevY = null;
    this._clearPending = false;
    this._clearColor = null;
    this._lastCanvas = null;
    this._lastW = 0;
    this._lastH = 0;
  }

  render(ctx, params, dt) {
    const c = ctx.ctx2d;
    const canvas = ctx.canvas;
    const safeDt = Math.max(1, Math.min(100, dt || 16.67));

    const w = canvas.width;
    const h = canvas.height;
    const cx = w / 2;
    const cy = h / 2;
    const R = Math.min(w, h) * 0.44;

    // On the first frame and whenever the canvas changes (host swap or resize),
    // stamp a fully-opaque background fill. Once the canvas is opaque, the
    // trail-fade fills (source-over at low globalAlpha on alpha=1 pixels)
    // keep every pixel at alpha=1 naturally — no per-frame compositing tricks
    // needed. This ensures pixel-sampling downstream filters (lens distortion,
    // glass opaqueness) always see a fully-opaque canvas.
    if (canvas !== this._lastCanvas || w !== this._lastW || h !== this._lastH) {
      c.globalAlpha = 1;
      c.fillStyle = params.backgroundColor;
      c.fillRect(0, 0, w, h);
      this._lastCanvas = canvas;
      this._lastW = w;
      this._lastH = h;
      this._prevX = null;
      this._prevY = null;
    }

    const isEpi = params.mode === 'epi';
    const r = R * Math.max(0.01, params.innerRatio);
    const d = r * Math.max(0, params.armLength);
    const period = estimatePeriod(params.innerRatio);

    const audio = params.audio || {};
    const peak = typeof audio.peak === 'number' ? audio.peak : 0;
    const effectiveOpacity = Math.min(1, params.lineOpacity + peak * 0.1);

    // Handle clear reaction — executed before any other drawing.
    if (this._clearPending) {
      c.globalAlpha = 1;
      c.fillStyle = this._clearColor || params.backgroundColor;
      c.fillRect(0, 0, w, h);
      this._t = 0;
      this._prevX = null;
      this._prevY = null;
      this._clearPending = false;
      this._clearColor = null;
    }

    if (params.traceMode === 'full') {
      this._drawFull(c, cx, cy, R, r, d, isEpi, period, params, effectiveOpacity);
      // In full mode still advance t so spectrum colour shifts over time.
      this._t += params.speed * period * (safeDt / 1000);
    } else {
      this._drawTrace(c, cx, cy, R, r, d, isEpi, period, params, safeDt, effectiveOpacity);
    }
  }

  _drawFull(c, cx, cy, R, r, d, isEpi, period, params, opacity) {
    c.fillStyle = params.backgroundColor;
    c.fillRect(0, 0, cx * 2, cy * 2);

    c.lineWidth = Math.max(0.1, params.lineThickness);
    c.lineCap = 'round';
    c.lineJoin = 'round';
    c.globalAlpha = opacity;

    if (params.colorMode === 'solid') {
      // Single path — one stroke call.
      const steps = Math.max(360, Math.ceil(period / 0.015));
      c.strokeStyle = params.lineColor;
      c.beginPath();
      for (let i = 0; i <= steps; i++) {
        const t = (period * i) / steps;
        const [x, y] = spiroPoint(t, R, r, d, isEpi);
        if (i === 0) c.moveTo(cx + x, cy + y);
        else c.lineTo(cx + x, cy + y);
      }
      c.stroke();
    } else {
      // Spectrum: divide the period into 360 hue segments.
      // The hue offset shifts with _t so the rainbow rotates over time.
      const N = 360;
      const stepsPerSeg = Math.max(2, Math.ceil(period / N / 0.015));
      const hueOffset = ((this._t % period) / period) * 360;
      for (let s = 0; s < N; s++) {
        const t0 = (period * s) / N;
        const t1 = (period * (s + 1)) / N;
        const hue = ((s / N) * 360 + hueOffset) % 360;
        c.strokeStyle = `hsl(${hue},100%,65%)`;
        c.beginPath();
        const [x0, y0] = spiroPoint(t0, R, r, d, isEpi);
        c.moveTo(cx + x0, cy + y0);
        for (let i = 1; i <= stepsPerSeg; i++) {
          const t = t0 + ((t1 - t0) * i) / stepsPerSeg;
          const [x, y] = spiroPoint(t, R, r, d, isEpi);
          c.lineTo(cx + x, cy + y);
        }
        c.stroke();
      }
    }

    c.globalAlpha = 1;
  }

  _drawTrace(c, cx, cy, R, r, d, isEpi, period, params, safeDt, opacity) {
    // Fade the previous frame's content toward the background.
    const decay = Math.max(0, Math.min(0.999, params.trailDecay));
    c.globalAlpha = 1 - decay;
    c.fillStyle = params.backgroundColor;
    c.fillRect(0, 0, cx * 2, cy * 2);
    c.globalAlpha = 1;

    const dtT = params.speed * period * (safeDt / 1000);
    // Sub-steps keep the stroke smooth at any speed. Cap at 4000 so even
    // "as fast as possible" (speed=60) stays well within canvas budget.
    const steps = Math.min(4000, Math.max(1, Math.ceil(dtT / 0.02)));

    c.lineWidth = Math.max(0.1, params.lineThickness);
    c.lineCap = 'round';
    c.lineJoin = 'round';
    c.globalAlpha = opacity;

    const hue = ((this._t % period) / period) * 360;
    c.strokeStyle = params.colorMode === 'spectrum'
      ? `hsl(${hue},100%,65%)`
      : params.lineColor;

    // On the very first frame _prevX/_prevY are null — skip drawing but
    // initialise them so the next frame has a valid start point.
    if (this._prevX === null) {
      const [px, py] = spiroPoint(this._t, R, r, d, isEpi);
      this._prevX = cx + px;
      this._prevY = cy + py;
    } else {
      c.beginPath();
      c.moveTo(this._prevX, this._prevY);
      for (let i = 1; i <= steps; i++) {
        const t = this._t + (dtT * i) / steps;
        const [x, y] = spiroPoint(t, R, r, d, isEpi);
        c.lineTo(cx + x, cy + y);
      }
      c.stroke();
      const [ex, ey] = spiroPoint(this._t + dtT, R, r, d, isEpi);
      this._prevX = cx + ex;
      this._prevY = cy + ey;
    }

    c.globalAlpha = 1;

    this._t += dtT;
    // Prevent float precision drift without visual discontinuity.
    if (this._t > period * 1000) this._t -= period * 1000;
  }

  react(reactionKey, args, _eventContext) {
    const a = args || {};
    if (reactionKey === 'clear') {
      this._clearPending = true;
      this._clearColor = (typeof a.fillColor === 'string' && /^#[0-9a-fA-F]{6}$/.test(a.fillColor))
        ? a.fillColor
        : null;
      return;
    }
    console.warn(`[spirograph] Unknown reaction '${reactionKey}'; declared: clear`);
  }

  cleanup() {
    this._t = 0;
    this._prevX = null;
    this._prevY = null;
    this._clearPending = false;
    this._clearColor = null;
    this._lastCanvas = null;
    this._lastW = 0;
    this._lastH = 0;
  }
}
