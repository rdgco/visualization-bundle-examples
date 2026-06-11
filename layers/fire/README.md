# Fire layer

Cellular-automaton flame simulation using the classic Doom-fire algorithm.
A heat grid runs at a configurable fraction of canvas resolution; the bottom
rows are seeded with heat each frame and the spread propagates it upward,
cooling and drifting it horizontally. A 256-entry palette LUT maps heat 0–255
to colour + alpha (alpha = heat, so tips are transparent and the core is fully
opaque). The grid is scaled up to the canvas and composited with `screen`
blending for a natural additive glow over the background.

## How to run it

```bash
git clone https://github.com/rdgco/visualization-harness.git
cd visualization-harness
npm install
visual-bundle install github:rdgco/visualization-bundle-examples
npm start
# in the REPL:
> window open
> layer load fire
```

## What this layer demonstrates

- **Per-pixel rendering via `ImageData`** — heat-grid-to-pixel mapping
  through a palette LUT, written to an offscreen canvas and scaled up to
  full resolution with bilinear smoothing.
- **Cellular-automaton simulation** — the Doom-fire algorithm: upward heat
  propagation with random per-cell cooling and horizontal drift.
- **Alpha-mapped transparency** — flame alpha equals heat value so cold
  regions are fully transparent and the hot core is opaque. `screen` blend
  mode makes the flame add light to the background without a hard edge.
- **Four colour palettes** — fire, plasma, ice, and toxic each map the same
  0–255 heat range to a different hue progression via a linear-interpolated
  anchor-point LUT.
- **Audio reactivity** — peak drives flame intensity (height); bass drives
  turbulence (horizontal chaos).

## Things to know about specific params

| Param | Behaviour |
|---|---|
| `intensity` | Base heat seeded at the bottom each frame. Audio peak adds up to +0.4. High values sustain tall flames during silence; 0 lets audio alone drive the brightness. |
| `height` | How far flames reach up the canvas. Mapped exponentially so the control feels linear to the eye. 0 = short embers near the base. 1 = flames fill the full canvas height. |
| `turbulence` | Maximum horizontal cell drift per step. 0 = upright column. 4 = wide chaotic spread. Bass adds up to +2 on top of this. |
| `spread` | Gap structure at the seed base. 0 = solid wall of fire. Higher values carve the base into distinct columns separated by dark gaps; the number of columns increases with spread and the pattern drifts slowly over time. |
| `scale` | Canvas pixels per grid cell. 1 = full resolution (expensive). 4 = default sweet spot. 6–8 = deliberately chunky, retro look at very low CPU cost. |
| `backgroundColor` | Painted under the flame every frame. Dark backgrounds maximise the additive screen-blend glow; lighter backgrounds reduce contrast and saturation. |

## Reaction

**flare** — instantly floods the entire grid with heat so the burst is
visible in the same frame the reaction fires (full-screen fire), then the
natural cooling settles it back to normal over the following seconds. Also
sustains high seed intensity for `durationMs` (default 400 ms). Accepts
`oneshot` and `drum-chord` events. Useful for kicks, drops, or any moment
that should engulf the screen.

## File layout

```
layers/fire/
  fire-layer.js   contract entry (default export = class)
  README.md       this file
```
