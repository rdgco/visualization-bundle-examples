# color-tint

The simplest possible filter — blits the source through and overlays a
configurable tinted rectangle. Pure Canvas2D; no WebGL, no readback. Useful as
a smoke test that the harness's filter pipeline is wired end-to-end.

## Params

| Param | Range | What it does |
|---|---|---|
| `color` | hex | Colour of the overlay tint. *audio-bindable* |
| `alpha` | 0–1 | Opacity of the tint. 0 = source unchanged; 1 = solid colour. *audio-bindable* |

Both carry the cross-host audio-modulation marker, so a host can drive them from
a live audio level (or an lfo/random source in the platform). The filter never
samples audio itself.

## Tests

`color-tint-filter.test.js` (`node filters/color-tint/color-tint-filter.test.js`):
param clamping, the blit+tint render, the audio markers, lifecycle no-throws.
