# glitch

Digital-glitch post-process, and the canonical example of a filter that pairs a
**modulatable param** with a **reaction**. Pure Canvas2D (no readback).

- `intensity` (number, audio-bindable) — the *continuous baseline* glitch
  amount, applied every frame. Modulate it for a smooth swell.
- `burst` (reaction) — a *transient spike on top*: firing it arms a short
  decaying envelope (~300 ms) with per-frame randomness, then settles back.
  Exactly what reactions are for, vs what modulation is for.

Effective amount per frame = `clamp(intensity + burstEnvelope)`.

## Params

| Param | Range | What it does |
|---|---|---|
| `intensity` | 0–1 | Baseline glitch amount. 0 = clean passthrough. *audio-bindable* |
| `mode` | rgb-split / slice / blocks | Which algorithm: chromatic aberration / scanline band shift / block displacement. |

> For *radial* RGB dispersion (a lens-style colour split that grows toward the
> edges), see the dedicated [`chromatic-aberration`](../chromatic-aberration/)
> filter — glitch's `rgb-split` is a flat, uniform horizontal offset.

## Reactions

| Reaction | Args | What it does |
|---|---|---|
| `burst` | `strength` 0–1 | Fire a transient, self-decaying glitch spike (~300 ms) on top of the baseline. |

## Tests

`glitch-filter.test.js` (`node filters/glitch/glitch-filter.test.js`): intensity
clamp + mode enum, the intensity-0 passthrough, the `burst` envelope, the audio
marker, lifecycle.
