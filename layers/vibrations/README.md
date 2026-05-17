# Vibrations layer

Canonical **2D SDK example** for the visualization-harness contract.
Concentric stroked shapes — circles, squares, triangles, or hexagons
— radiating from the canvas center. Audio drives radial vibration in
one of four modes (`pulse`, `wave`, `jitter`, `counter`). Three
reactions punctuate the motion: a whole-field outward slam, a
background flash, and a shockwave that ripples from center to edge.

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
- **`enum` params** (`shape`, `vibrationMode`) alongside `number`
  and `color`, exercising the harness's full param-kind surface.
- **Audio-driven render** via `params.audio` — `peak` for whole-field
  modes, `bands` for `jitter`'s per-ring frequency assignment.
- **Three reactions** with `args`, demonstrating the harness's
  `oneshot` / `drum-chord` / `midi-chord` `accepts` categories and
  per-reaction `holdMs` / `intensity` / `color` argument shapes.
- **The per-frame ctx contract.** `init()` deliberately does NOT
  cache `ctx.canvas` / `ctx.ctx2d`; `render()` reads them from the
  per-frame ctx each call. A host runtime is allowed to swap canvases
  between frames (midi-daddy's compositor does, for opacity and
  chroma-key offscreen routing), and a layer that caches from init()
  paints the wrong surface silently. The colocated
  `vibrations-layer.test.js` locks this invariant in.

## Things to know about specific params

| Param | Behavior |
|---|---|
| `vibrationMode` | `pulse` reacts to `params.audio.peak`. `wave` has a constant 0.4 floor so the pattern still moves during silence. `jitter` reads `params.audio.bands` per ring; without an audio source the field has a subtle deterministic wobble. `counter` is parity-driven; loud passages amplify the alternating push. |
| `centerGap` | Empty ring-slots in the middle before the pattern starts. `0` fills from the center; higher values turn the pattern into a frame around an empty middle. |
| `vibrationDepth` | Declares `modulation: { kind: 'audio' }` — the binding default in midi-daddy's panel resolves to audio sources. |
| `backgroundColor` | Painted under the rings every frame. The `flash` reaction interpolates from a chosen flash color back to this base color over `durationMs`. |

## File layout

```
layers/vibrations/
  vibrations-layer.js       contract entry (default export = class)
  vibrations-layer.test.js  per-frame ctx invariant regression tests
  README.md                 this file
```
