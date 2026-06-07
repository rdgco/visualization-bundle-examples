# duotone

Gradient-map — a Canvas2D post-process filter. Reduces the source to
luminance and remaps it through a 2- or 3-stop colour gradient: shadows →
`colorLow`, highlights → `colorHigh` (with an optional `colorMid` at the
centre). Recolours any layer into a brand palette; reads especially well on
lit white projector screens.

Part of the `visualization-bundle-examples` filter set (lives in
`filters/` alongside `edge-detect`, `glitch`, `invert`, `pixelate`,
`vignette`).

## What it does

```
source ─► luminance ─► [contrast stretch] ─► [offset bias] ─► LUT index ─► gradient colour
                                                                              │
output ◄──────────────── blend over original by `mix` ◄───────────────────────┘
```

1. **Luminance.** Each pixel's Rec. 601 brightness.
2. **Map.** Stretch luminance around mid-grey by `contrast`, bias by
   `offset`, and look the result up in a 256-entry gradient LUT.
3. **Mix.** Blend the gradient colour over the original by `mix`.

The LUT is rebuilt only when a colour/stop param changes — dragging
`offset` / `contrast` / `mix` is free (applied at sample time).

## Params

The three numeric params (marked *audio*) declare
`modulation: { kind: 'audio' }`, so the panel shows the per-param audio
binding dropdown — bind any to a live audio slice (peak / sub / bass / mid
/ high / presence).

| Param | Range | What it does |
|---|---|---|
| `colorLow` | hex | Colour the shadows (luminance 0) map to. |
| `colorHigh` | hex | Colour the highlights (luminance 255) map to. |
| `useMidpoint` | on / off | Insert `colorMid` at the gradient centre for a three-tone map. |
| `colorMid` | hex | Centre stop, used only when 3-stop is on. |
| `offset` | -1–1 | Shifts the luminance→palette mapping. ±1 sweeps the image to one end. *audio* |
| `contrast` | 0–4 | Stretch around mid-grey before the map. 1 = unchanged; higher = punchier split. *audio* |
| `mix` | 0–1 | Wet/dry. 1 = full duotone, 0 = original source. *audio* |

## Performance

A point-op (no neighbourhood), but still a full-resolution `getImageData` +
per-pixel loop, so cost scales with canvas area. The LUT lookup itself is
trivial; the readback is the bottleneck on large canvases / live video.

## Looks to try

- **Sunset duotone:** deep-indigo shadows, warm-gold highlights (the
  defaults). Clean two-tone grade over any layer.
- **Scroll on the beat:** bind `offset` to `bass` — the palette sweeps
  through the image with the low end.
- **Three-tone poster:** `useMidpoint` on with a contrasting `colorMid`
  (e.g. magenta between navy and gold), `contrast` ~1.5.

## Tests

`lib/gradient-lut.js` (hex parsing, luminance, LUT build, index mapping,
config normalization) is unit-tested in `lib/gradient-lut.test.js`. The
Canvas2D readback + per-pixel apply in `duotone-filter.js` is exercised by
hand in the harness.
