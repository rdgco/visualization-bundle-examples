# Spirograph layer

Hypotrochoid and epitrochoid curve tracer. A point attached to a small
circle rolling inside or outside a fixed circle traces petal-shaped closed
curves when the radii ratio R/r is rational.

Two trace modes:

- **draw** — the curve traces itself over time, with old strokes fading at a
  configurable rate. Changing params mid-trace layers the new curve over the
  fading ghost of the old one, creating superposition effects.
- **full** — the complete closed curve is redrawn every frame (instant,
  static pattern; spectrum colour rotates continuously).

## How to run it

```bash
git clone https://github.com/rdgco/visualization-harness.git
cd visualization-harness
npm install
visual-bundle install github:rdgco/visualization-bundle-examples
npm start
# in the REPL:
> window open
> layer load spirograph
```

## Interesting parameter combinations

| innerRatio | armLength | mode | Pattern |
|---|---|---|---|
| 0.333 | 1 | hypo | Deltoid (3 cusps) |
| 0.25 | 1 | hypo | Astroid (4 cusps) |
| 0.4 | 1 | hypo | 4-petal rose |
| 0.4 | 1.5 | hypo | 4-petal with looping tips |
| 0.5 | 0.5 | hypo | Ellipse |
| 0.5 | 1 | epi | Cardioid |
| 0.333 | 1 | epi | Nephroid |
| 0.2 | 1 | epi | 5-petal epicycloid |
| 0.4 | 0.3 | hypo | Stubby rounded 4-petal |
| 0.667 | 1.2 | hypo | Dense interlocked inner loops |

## Period estimation

The closed period is `2π × q` where `R/r = p/q` in lowest terms. The layer
finds `q` by searching denominators up to 32. For simple ratios (0.333, 0.25,
0.4, 0.5, 0.6) the exact period is found and the curve closes perfectly. For
arbitrary floats the layer falls back to `2π × 32` revolutions — the curve
overwrites itself but never closes; use `trailDecay` or the clear reaction.

## What this layer demonstrates

- **Parametric curves** — closed-form hypotrochoid / epitrochoid formulae,
  exact and smooth regardless of canvas scale.
- **Incremental trace vs. full-curve rendering** — draw mode builds the
  pattern over time; full mode recomputes it every frame. Both are useful;
  draw mode is visually richer for music-reactive contexts.
- **Trail decay via `globalAlpha` fill** — the fade effect is a partial
  background fill each frame (`globalAlpha = 1 - trailDecay`), not an
  offscreen buffer, keeping the approach simple and compositable.
- **Spectrum colour** — in draw mode, the stroke hue advances with `_t`
  so the trace is a continuous rainbow ribbon. In full mode, 360 stroke
  calls paint the curve in colour segments with the offset shifting over time.

## Things to know about specific params

| Param | Behaviour |
|---|---|
| `innerRatio` | The fundamental shape control. Jump between simple fractions (0.333, 0.25, 0.4, 0.5) for classic spirograph forms. Irrational-adjacent values produce dense never-closing curves. |
| `armLength` | 1 = clean petal on the rolling circle's rim. < 1 = rounded, contracted. > 1 = looping petals that extend beyond the rim. Values around 1.2–1.6 produce the characteristic inner loops of extended spirograph traces. |
| `trailDecay` | At the default 0.998 the complete curve is still ~40% visible when it closes at speed 1.5. Raise toward 0.999 to see the full curve persist; lower toward 0.99 to see only the recent tail (fast-fading snake). |
| `speed` | ~1.5 rad/s is comfortable for innerRatio=0.4 (one full curve in ~8s). Very low speed with high trailDecay builds the pattern slowly; very high speed with low trailDecay gives a persistent glowing streak. |

## Reaction

**clear** — immediately fills the canvas with `fillColor` (default `#0a0a14`,
match to your background) and resets `t` to 0, starting a fresh trace.
Accepts `oneshot` and `drum-chord`. Useful for wiping the slate on a new
musical section or after a parameter change.

## File layout

```
layers/spirograph/
  spirograph-layer.js   contract entry (default export = class)
  README.md             this file
```
