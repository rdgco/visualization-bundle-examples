# edge-detect

Sobel edge detection over the source — a Canvas2D post-process filter.
Each frame runs a 3×3 Sobel operator on the source's luminance and draws
the detected edges, with operator control over how much of the original
shows through (wet/dry), how the edges are coloured, and how much they
glow. Built to keep up with live video by running the edge pass at a
tunable downscaled resolution.

In-tree harness filter (lives in `filters/` at the repo root, parallel to
`layers/`), alongside `smoke`.

## What it does

```
source ─► [downscale to detail%] ─► luminance ─► 3×3 Sobel ─► edge map
                                                                  │
backdrop colour + (source × wet/dry) ◄── composite ◄── glow + crisp ◄─┘
```

1. **Background.** A solid backdrop colour with the source faded in over
   it by the wet/dry control.
2. **Edges.** Sobel gradient magnitude → an edge map whose alpha is the
   edge strength (after threshold + gain) and whose colour is either a
   fixed tint or the underlying image.
3. **Compositing.** A blurred additive pass gives the glow; a crisp pass
   on top keeps the lines sharp.

## Params

The six numeric params (marked *audio* below) declare
`modulation: { kind: 'audio' }`, so the panel shows the per-param audio
binding dropdown — bind any of them to a live audio slice
(peak / sub / bass / mid / high / presence).

| Param | Range | What it does |
|---|---|---|
| `backgroundOpacity` | 0–1 | **Wet/dry.** How much of the original shows behind the edges. 0 = edges only, 1 = edges over the full source. *audio* |
| `threshold` | 0–1 | Edge sensitivity floor. Raise to drop faint texture/noise. *audio* |
| `gain` | 0–8 | Edge intensity — brightness/opacity of the detected edges. *audio* |
| `colorMode` | solid / source | `solid` = edges in the edge colour; `source` = edges keep the image's colour. |
| `edgeColor` | hex | Edge colour in solid mode. |
| `backgroundColor` | hex | Backdrop fill, visible where the source is faded out. |
| `glow` | 0–1 | Additive bloom strength around the edges. *audio* |
| `glowSize` | 0–40 px | How far the glow spreads. *audio* |
| `detail` | 0.2–1 | Resolution the edge pass runs at, as a fraction of the canvas. Lower = faster. *audio* |

## Reactions

| Reaction | Args | What it does |
|---|---|---|
| `pulse` | `strength` 0–1, `duration` 0.05–4 s | Flares the edges (boosts intensity + glow) and decays back over `duration`. Fire on a beat/hit. |

## Performance

The expensive work — `getImageData` + the per-pixel Sobel — runs on a
`detail`-scaled buffer, so dropping `detail` is the main lever for live
video on a large canvas. The glow uses `ctx.filter = 'blur(...)'`, which
Chromium runs on the GPU rather than a JS box blur. For stills, push
`detail` to 1 for the finest edges.

## Looks to try

- **Neon outline:** wet/dry 0, `colorMode` solid, a bright `edgeColor`,
  glow ~0.6.
- **Traced photo:** wet/dry ~0.3, `colorMode` source, low glow.
- **Blueprint:** wet/dry 0, white edges on a dark-blue backdrop.

## Tests

`lib/edges.js` (luminance, Sobel, threshold/gain, config normalization)
is unit-tested in `lib/edges.test.js`. The Canvas2D compositing in
`edge-detect-filter.js` is exercised by hand in the harness.
