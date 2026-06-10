# invert

Per-pixel RGB invert with an adjustable strength fade. A second smoke filter
alongside `color-tint` — it exercises the `getImageData` / `putImageData`
readback path rather than the blit-only path. Pure Canvas2D.

## Params

| Param | Range | What it does |
|---|---|---|
| `strength` | 0–1 | Mix between source (0) and fully-inverted (1). *audio-bindable* |

`strength` carries the cross-host audio-modulation marker (drive it from a live
level or an lfo/random source in the platform).

## Tests

`invert-filter.test.js` (`node filters/invert/invert-filter.test.js`): strength
clamping, the strength-0 passthrough (no readback), the audio marker, lifecycle.
