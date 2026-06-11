# Times Table layer

Modular multiplication circle. Places `pointCount` points evenly around a
circle and draws a chord from each point `n` to point `(n × k) mod pointCount`.
Slowly evolving `k` morphs the pattern through a continuous family of curves —
each integer k produces a clean closed form, and the fractional values between
them are smooth transitions.

The pattern is purely mathematical: no randomness, no noise, no time-varying
tricks beyond the multiplier advance. The psychedelia comes entirely from
the structure.

## How to run it

```bash
git clone https://github.com/rdgco/visualization-harness.git
cd visualization-harness
npm install
visual-bundle install github:rdgco/visualization-bundle-examples
npm start
# in the REPL:
> window open
> layer load times-table
```

## Notable multiplier values

| k | Pattern |
|---|---|
| 2 | Cardioid — one cusp, one lobe. The most famous form. |
| 3 | Nephroid — two cusps, two lobes. |
| 4 | Three-lobed curve. |
| n | (n−1)-lobed curve. |
| 1.5 | Open transitional form between the line (k=1) and cardioid (k=2). |
| 2.5 | Four-pointed star in transition. |
| 10+ | Very dense, almost fills the disc. Looks like a moiré. |

The pattern repeats every `pointCount` units of k, so k=2 and k=2+pointCount
produce the same visual. With the default pointCount=200, the full period
is 200 k-units — at the default speed of 0.25 k/s that's ~13 minutes per cycle.

## What this layer demonstrates

- **Purely geometric rendering** — no audio-shaped noise, no particle
  systems: all structure comes from modular arithmetic. Good reference for
  how much visual richness can come from a single equation.
- **Batched strokeStyle changes** — in rainbow mode, lines are sorted into
  60 hue buckets and each bucket is drawn as a single path, keeping
  draw-call overhead flat regardless of `pointCount`.
- **Param-driven vs. auto-evolved state** — `_k` advances with `speed` but
  resets to `params.multiplier` whenever the slider changes, so the param
  can both seed the starting position and be used for manual scrubbing.

## Things to know about specific params

| Param | Behaviour |
|---|---|
| `pointCount` | More points reveal finer sub-structure but also make individual chords harder to see. 100–250 is the visual sweet spot. |
| `multiplier` | Directly sets k when changed. Auto-advance continues from the new value. Scrub slowly to watch the pattern flow through its family of curves. |
| `speed` | k-units per second. 0 = fully static (use multiplier as a scrubber). 0.1–0.5 = slow drift. 2+ = fast scramble where individual patterns aren't legible. |
| `lineOpacity` | Low values (0.1–0.25) work best for high point counts where many chords overlap; at pointCount=50–80 you can go much higher. |
| `colorMode` | rainbow assigns each chord a hue based on its source point — the full spectrum wraps once around the circle regardless of pointCount. solid uses a single colour with opacity for a more austere look. |

## Reaction

**snap** — snaps the current multiplier to the nearest whole number, instantly
landing on a clean closed curve. The optional `offset` arg shifts the snap
target by a fraction (e.g., 0.5 always snaps to half-integer values for
transitional open forms). Speed continues from the snapped value.

## File layout

```
layers/times-table/
  times-table-layer.js   contract entry (default export = class)
  README.md              this file
```
