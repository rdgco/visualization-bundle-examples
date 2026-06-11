/**
 * fire — cellular-automaton flame simulation.
 *
 * A heat grid runs at a fraction of canvas resolution (controlled by
 * `scale`). Bottom rows are seeded with heat each frame; the classic
 * Doom-fire spread propagates heat upward while cooling and drifting it
 * horizontally. A 256-entry palette LUT maps heat 0–255 to colour.
 * Alpha equals heat so tips are transparent and the core is fully opaque.
 * The result is scaled up and composited over the background with `screen`
 * blending for a natural additive glow.
 *
 * Audio inputs:
 *   peak  → boosts effective intensity (brighter, hotter base)
 *   bass  → adds to turbulence (wider, wilder spread)
 */

export const key = 'fire';
export const label = 'Fire';
export const description = 'Cellular-automaton flame simulation using the classic Doom-fire algorithm. A heat grid propagates upward with random cooling and horizontal drift; a palette LUT maps heat to colour. Four palettes: fire, plasma, ice, toxic. Height controls how far flames reach; spread carves distinct columns with gaps between them. Flames are naturally transparent at the tips via alpha-mapped heat. Audio peak drives intensity; bass drives turbulence. Flare reaction floods the entire grid for an instant full-screen burst.';

const PALETTES = ['fire', 'plasma', 'ice', 'toxic'];

export const params = {
  intensity: {
    type: 'number',
    label: 'Intensity',
    default: 0.85,
    min: 0,
    max: 1,
    step: 0.01,
    description: 'Base heat seeded at the bottom each frame. Audio peak adds up to +0.4 on top.',
    modulation: { kind: 'audio' }
  },
  height: {
    type: 'number',
    label: 'Height',
    default: 0.75,
    min: 0,
    max: 1,
    step: 0.01,
    description: 'How high flames reach. 0 = short embers near the base. 1 = flames fill the full canvas.',
    modulation: { kind: 'continuous' }
  },
  turbulence: {
    type: 'number',
    label: 'Turbulence',
    default: 1,
    min: 0,
    max: 4,
    step: 0.1,
    description: 'Horizontal drift applied to each spreading cell. 0 = upright column. Higher = wide, writhing chaos. Bass adds up to +2.',
    modulation: { kind: 'continuous' }
  },
  spread: {
    type: 'number',
    label: 'Spread',
    default: 0,
    min: 0,
    max: 1,
    step: 0.01,
    description: 'Gap structure at the flame base. 0 = solid wall of fire. Higher = distinct columns separated by dark gaps. The pattern drifts slowly over time.',
    modulation: { kind: 'continuous' }
  },
  palette: {
    type: 'enum',
    label: 'Palette',
    options: PALETTES,
    default: 'fire',
    description: 'Colour map applied to the heat grid. fire = red/orange/yellow. plasma = violet/magenta/white. ice = navy/cyan/white. toxic = dark green/lime/yellow.'
  },
  scale: {
    type: 'number',
    label: 'Grid scale',
    default: 4,
    min: 1,
    max: 8,
    step: 1,
    description: 'Canvas pixels per grid cell. 1 = full resolution (expensive). 4 = default. Higher = chunkier and faster.'
  },
  backgroundColor: {
    type: 'color',
    label: 'Background',
    default: '#0a0a0f',
    description: 'Canvas background painted under the flame each frame. Dark backgrounds maximise the screen-blend glow effect.'
  },
  audio: {
    type: 'audio-data',
    label: 'Audio analysis',
    description: 'Live audio analysis. Peak drives intensity; bass drives turbulence.'
  }
};

export const reactions = {
  flare: {
    label: 'Flare',
    description: 'Instantly floods the entire grid with heat for a full-screen burst, then lets the natural cooling settle it back down. Also sustains high seed intensity for durationMs.',
    accepts: ['oneshot', 'drum-chord'],
    args: {
      durationMs: {
        type: 'number',
        label: 'Duration (ms)',
        min: 50,
        max: 2000,
        default: 400,
        step: 10,
        description: 'How long the boosted seed intensity holds after the initial burst.'
      },
      intensity: {
        type: 'number',
        label: 'Intensity',
        min: 0,
        max: 1,
        default: 1,
        step: 0.01,
        description: 'Heat level of the burst. 1 = full white-hot. Lower = partial surge.'
      }
    }
  }
};

// Palette stop format: [heatValue 0–255, [r, g, b]]
const PALETTE_STOPS = {
  fire: [
    [0,   [0,   0,   0  ]],
    [40,  [20,  0,   0  ]],
    [80,  [100, 0,   0  ]],
    [120, [200, 30,  0  ]],
    [160, [255, 100, 0  ]],
    [200, [255, 200, 0  ]],
    [230, [255, 255, 100]],
    [255, [255, 255, 255]]
  ],
  plasma: [
    [0,   [0,   0,   0  ]],
    [50,  [10,  0,   30 ]],
    [100, [80,  0,   160]],
    [150, [200, 0,   200]],
    [200, [255, 80,  255]],
    [230, [255, 200, 255]],
    [255, [255, 255, 255]]
  ],
  ice: [
    [0,   [0,   0,   0  ]],
    [50,  [0,   0,   40 ]],
    [100, [0,   20,  120]],
    [150, [0,   80,  200]],
    [200, [0,   200, 255]],
    [230, [150, 240, 255]],
    [255, [255, 255, 255]]
  ],
  toxic: [
    [0,   [0,   0,   0  ]],
    [50,  [0,   15,  0  ]],
    [100, [0,   70,  0  ]],
    [150, [20,  170, 0  ]],
    [200, [140, 255, 0  ]],
    [230, [210, 255, 80 ]],
    [255, [255, 255, 200]]
  ]
};

function buildPalette(name) {
  const anchors = PALETTE_STOPS[name] || PALETTE_STOPS.fire;
  const lut = new Uint8ClampedArray(256 * 3);
  for (let i = 0; i < 256; i++) {
    let lo = anchors[0];
    let hi = anchors[anchors.length - 1];
    for (let k = 0; k < anchors.length - 1; k++) {
      if (i >= anchors[k][0] && i <= anchors[k + 1][0]) {
        lo = anchors[k];
        hi = anchors[k + 1];
        break;
      }
    }
    const span = hi[0] - lo[0];
    const t = span === 0 ? 1 : (i - lo[0]) / span;
    lut[i * 3]     = Math.round(lo[1][0] + (hi[1][0] - lo[1][0]) * t);
    lut[i * 3 + 1] = Math.round(lo[1][1] + (hi[1][1] - lo[1][1]) * t);
    lut[i * 3 + 2] = Math.round(lo[1][2] + (hi[1][2] - lo[1][2]) * t);
  }
  return lut;
}

export default class FireLayer {
  init() {
    // Do not cache ctx.canvas or ctx.ctx2d here — the host runtime may
    // swap canvases between frames. All canvas access happens in render().
    this._gW = 0;
    this._gH = 0;
    this._grid = null;
    this._offscreen = null;
    this._offCtx = null;
    this._imgData = null;
    this._lut = buildPalette('fire');
    this._activePalette = 'fire';
    this._time = 0;
    this._flareUntil = 0;
    this._flareIntensity = 1;
  }

  render(ctx, params, dt) {
    const c = ctx.ctx2d;
    const canvas = ctx.canvas;
    const now = performance.now();
    // Clamp dt — a backgrounded tab can produce huge spikes on resume.
    const safeDt = Math.max(1, Math.min(100, dt || 16.67));
    this._time += safeDt;

    const w = canvas.width;
    const h = canvas.height;

    c.fillStyle = params.backgroundColor;
    c.fillRect(0, 0, w, h);

    if (params.palette !== this._activePalette) {
      this._lut = buildPalette(params.palette);
      this._activePalette = params.palette;
    }

    const scale = Math.max(1, Math.round(params.scale));
    this._ensureGrid(w, h, scale);

    const audio = params.audio || {};
    const peak = typeof audio.peak === 'number' ? audio.peak : 0;
    const bass = audio.bands && typeof audio.bands.bass === 'number' ? audio.bands.bass : 0;

    const flareActive = now < this._flareUntil;
    const baseIntensity = flareActive
      ? Math.max(params.intensity, this._flareIntensity)
      : params.intensity;
    const effectiveIntensity = Math.min(1, baseIntensity + peak * 0.4);
    const effectiveTurbulence = Math.min(4, params.turbulence + bass * 2);

    this._step(effectiveIntensity, params.height, effectiveTurbulence, params.spread);
    this._paint(c, w, h);
  }

  _ensureGrid(w, h, scale) {
    const gW = Math.ceil(w / scale);
    const gH = Math.ceil(h / scale) + 2; // +2 rows: one seed row, one buffer
    if (this._gW === gW && this._gH === gH) return;
    this._gW = gW;
    this._gH = gH;
    this._grid = new Uint8Array(gW * gH);
    this._offscreen = document.createElement('canvas');
    this._offscreen.width = gW;
    this._offscreen.height = gH - 1; // seed row not painted
    this._offCtx = this._offscreen.getContext('2d');
    this._imgData = this._offCtx.createImageData(gW, gH - 1);
  }

  _step(intensity, height, turbulence, spread) {
    const gW = this._gW;
    const gH = this._gH;
    const grid = this._grid;

    // Map height (0–1) to maxDecay via an exponential curve so the control
    // feels linear to the eye. height=1 → maxDecay=1 (flames reach the top);
    // height=0 → maxDecay=50 (embers that barely leave the base).
    const maxDecay = Math.max(1, Math.round(Math.pow(50, 1 - height)));
    const turbRange = Math.max(0, Math.round(turbulence));

    // Propagate: for each non-seed row, pull heat upward from the row below.
    // Reads from row y+1 (always unmodified this frame — we iterate top→bottom)
    // and writes to row y at a horizontally drifted column.
    for (let y = 0; y < gH - 1; y++) {
      for (let x = 0; x < gW; x++) {
        const below = grid[(y + 1) * gW + x];
        const decay = Math.floor(Math.random() * (maxDecay + 1));
        const drift = turbRange > 0
          ? Math.floor(Math.random() * (2 * turbRange + 1)) - turbRange
          : 0;
        const nx = ((x + drift) % gW + gW) % gW;
        grid[y * gW + nx] = Math.max(0, below - decay);
      }
    }

    // Seed the bottom two rows. Two rows avoids a cold gap at the base when
    // turbulence drifts cells away from their column.
    const heatBase = intensity * 255;
    const seed1 = (gH - 1) * gW;
    const seed2 = (gH - 2) * gW;

    // Spread: a slowly-drifting sine wave modulates how much of the base is
    // lit. At spread=0 the mask is 1 everywhere (solid fire). At spread=1
    // the mask reaches zero in the troughs, creating distinct columns with
    // true dark gaps between them. The number of columns grows with spread.
    const spreadAmt = Math.max(0, Math.min(1, spread));
    // 1 cycle at low spread (wide flame bodies), up to 6 at high spread
    // (many narrow columns). Drive this from time so the pattern drifts.
    const spreadCycles = 1 + Math.round(spreadAmt * 5);
    const timePhase = this._time * 0.0004; // ~one drift cycle per ~2500 frames

    for (let x = 0; x < gW; x++) {
      let seedHeat = heatBase;
      if (spreadAmt > 0) {
        const spatialPhase = (x / gW) * Math.PI * 2 * spreadCycles + timePhase;
        const sineVal = (Math.sin(spatialPhase) + 1) / 2; // 0..1
        // threshold rises with spread: 0 → all lit, 0.6 → only sine peaks lit
        const threshold = spreadAmt * 0.6;
        const mask = sineVal > threshold
          ? (sineVal - threshold) / (1 - threshold) // smooth ramp 0→1 above threshold
          : 0;
        // Blend: spread=0 → seedHeat unchanged; spread=1 → seedHeat = heatBase * mask
        seedHeat = heatBase * (1 - spreadAmt + spreadAmt * mask);
      }
      const heat = Math.max(0, Math.min(255, Math.round(seedHeat + (Math.random() * 40 - 20))));
      grid[seed1 + x] = heat;
      grid[seed2 + x] = heat;
    }
  }

  _paint(c, w, h) {
    const gW = this._gW;
    const gH = this._gH;
    const grid = this._grid;
    const lut = this._lut;
    const data = this._imgData.data;
    const drawRows = gH - 1; // skip the seed row

    for (let y = 0; y < drawRows; y++) {
      for (let x = 0; x < gW; x++) {
        const heat = grid[y * gW + x];
        const pi = heat * 3;
        const di = (y * gW + x) * 4;
        data[di]     = lut[pi];
        data[di + 1] = lut[pi + 1];
        data[di + 2] = lut[pi + 2];
        data[di + 3] = heat; // alpha = heat: transparent at tips, opaque at core
      }
    }

    this._offCtx.putImageData(this._imgData, 0, 0);

    c.save();
    c.globalCompositeOperation = 'screen';
    c.imageSmoothingEnabled = true;
    c.imageSmoothingQuality = 'high';
    c.drawImage(this._offscreen, 0, 0, w, h);
    c.restore();
  }

  react(reactionKey, args, _eventContext) {
    const a = args || {};
    if (reactionKey === 'flare') {
      const dur = typeof a.durationMs === 'number' ? a.durationMs : 400;
      const intensity = typeof a.intensity === 'number' ? a.intensity : 1;
      const clampedIntensity = Math.max(0, Math.min(1, intensity));

      // Flood the entire grid immediately so the burst is visible in the
      // same frame the reaction fires, not just at the seed rows. The natural
      // cooling propagates downward from the top over the following seconds,
      // creating a settling-back-to-normal effect.
      if (this._grid) {
        const heat = Math.round(255 * clampedIntensity);
        for (let i = 0; i < this._grid.length; i++) {
          if (this._grid[i] < heat) this._grid[i] = heat;
        }
      }

      this._flareUntil = performance.now() + dur;
      this._flareIntensity = clampedIntensity;
      return;
    }
    console.warn(`[fire] Unknown reaction '${reactionKey}'; declared: flare`);
  }

  cleanup() {
    this._gW = 0;
    this._gH = 0;
    this._grid = null;
    this._offscreen = null;
    this._offCtx = null;
    this._imgData = null;
    this._time = 0;
    this._flareUntil = 0;
  }
}
