# Vibrations layer

Canonical **2D SDK example** for the visualization-harness contract.
Concentric stroked shapes — circles, squares, triangles, or hexagons
— radiating from the canvas center. Audio drives radial vibration in
one of four modes (`pulse`, `wave`, `jitter`, `counter`). Two
composable rendering axes (color algorithm × stroke style), glow,
and rotation/twist motion grow the original solid-ring look into
spinning segmented rainbow vortices without losing it: every new
param defaults to the original behavior. Six velocity-sensitive
reactions punctuate the motion.

## How to run it

```bash
git clone https://github.com/rdgco/visualization-harness.git
cd visualization-harness
npm install
visual-bundle install github:rdgco/visualization-bundle-examples
npm start
# in the REPL:
> window open
> layer load vibrations
```

## What this layer demonstrates

- **2D Canvas rendering** via the default `wantsContext: '2d'` —
  contrast with skyline's WebGL path.
- **`enum` params** (`shape`, `vibrationMode`, `colorMode`,
  `strokeStyle`, `lineWidthMode`) alongside `number`, `color`, and
  `boolean`, exercising the harness's full param-kind surface.
- **Param grouping** via `paramGroup` / `paramGroupLabel` — params
  organize into Shape / Stroke / Motion sections in hosts that
  render groups (harmless metadata in hosts that don't).
- **Audio-driven render** via `params.audio` — `peak` for
  whole-field modes, `bands` for the per-ring frequency walk used by
  `jitter`, `bandEnergy` color, and `bandPerRing` width.
- **Six reactions** with `args`, including multi-shot pools (several
  `burst`s in flight at once) and velocity sensitivity: every
  reaction reads `eventContext.velocity` and exposes a
  `velocitySense` arg dialing how much it matters.
- **The per-frame ctx contract.** `init()` deliberately does NOT
  cache `ctx.canvas` / `ctx.ctx2d`; `render()` reads them from the
  per-frame ctx each call. A host runtime is allowed to swap canvases
  between frames (midi-daddy's compositor does, for opacity and
  chroma-key offscreen routing), and a layer that caches from init()
  paints the wrong surface silently. The colocated
  `vibrations-layer.test.js` locks this invariant in — plus a
  default-path regression: with every param at its declared default,
  the draw-call sequence is identical to the original solid-ring
  layer, so presets saved before the enhancement render unchanged.

## Things to know about specific params

| Param | Behavior |
|---|---|
| `vibrationMode` | `pulse` reacts to `params.audio.peak`. `wave` has a constant 0.4 floor so the pattern still moves during silence. `jitter` reads `params.audio.bands` per ring; without an audio source the field has a subtle deterministic wobble. `counter` is parity-driven; loud passages amplify the alternating push. |
| `colorMode` | `solid` = one color. `gradient` blends `lineColor` → `lineColorB` inner→outer. `rainbow` walks hue across the field (`hueSpread` degrees) with a slow drift — pick a saturated `lineColor`; hue rotation is invisible on white/gray. `bandEnergy` colors each ring by its frequency band's energy (a radial spectrum meter). `displacement` colors rings by how far they're currently displaced — motion becomes color. |
| `strokeStyle` | `dashed` / `dotted` patterns scale with `lineThickness` and orbit at `dashSpeed` rev/s. `segments` draws evenly spaced arcs on circles; on polygons it keeps `segmentCount` whole edges, spread evenly, and drops the rest. |
| `lineWidthMode` | `peak` breathes the whole field's stroke width with the audio peak (up to ~2.5×). `bandPerRing` gives each ring a width driven by its band — pairs well with `colorMode: bandEnergy`. |
| `rotationSpeed` / `twist` | Rotation is skipped entirely on plain solid circles (it's invisible there). `twist` adds per-ring rotation — polygon fields become spirals/moiré; combine both for vortex motion. `counterRotate` spins odd rings the other way. |
| `centerDrift` | Lissajous wander of the pattern center, scaled by both the param and the smoothed audio peak — silence stays perfectly centered. |
| `vibrationDepth` / `glow` / `centerDrift` | Declare `modulation: { kind: 'audio' }` — the binding default in midi-daddy's panel resolves to audio sources. |
| `backgroundColor` | Painted fully opaque under the rings every frame. The `flash` reaction interpolates from a chosen flash color back to this base color over `durationMs`. |

## Reactions

| Reaction | Effect |
|---|---|
| `pulse` | Slam every ring outward, ease back after `holdMs`. |
| `flash` | Flash the background to a color, fade back. Velocity scales brightness. |
| `shockwave` | Radial displacement front sweeps center → edge. |
| `burst` | 1–5 staggered transient rings expand past the field edge and fade. Multiple bursts stack (pool capped at 8). |
| `colorSweep` | Hue-rotation front sweeps center → edge — the chromatic sibling of `shockwave`. |
| `spinKick` | Instant angular impulse, decaying back to the `rotationSpeed` baseline (~600 ms). Best on polygons with `twist`. |

Every reaction has a `velocitySense` arg: 0 = ignore velocity
(always full strength), 1 = fully velocity-proportional
(`eventContext.velocity`, MIDI-style 0–127). Absent velocity means
full strength.

## Performance notes

- `glow` uses canvas `shadowBlur` — the most expensive 2D state.
  With per-ring color modes the shadow color updates per ring, which
  compounds the cost. Budget it at high ring counts; `glow: 0`
  skips shadow state entirely.
- All other additions are per-ring arithmetic and at most one
  transform per ring — 60 rings at 1080p stays comfortably in
  frame budget.

## Pairs well with filters

The layer deliberately ships **no** whole-frame effects — those
compose from the filter catalog instead:

- Trails / persistence: stack `long-exposure`, `echo`, or
  `feedback` over the layer (try `rotationSpeed` + `echo`).
- Strobe inversion: the `invert` filter.

The layer paints a fully opaque background every frame precisely so
these temporal filters composite cleanly over it.

## File layout

```
layers/vibrations/
  vibrations-layer.js       contract entry (default export = class)
  vibrations-layer.test.js  per-frame ctx + default-path regression tests
  README.md                 this file
```
