# pixelate

Mosaic / block-resample — a Canvas2D post-process filter. Collapses the
source into square blocks of a tunable size, with the block size
audio-modulatable so the image shatters into big blocks on a hit and
resolves as the energy decays.

Part of the `visualization-bundle-examples` filter set (lives in
`filters/` alongside `edge-detect`, `glitch`, `invert`, `vignette`).

## What it does

```
source ─► [shrink to w/blockSize × h/blockSize, smoothing ON = averaged blocks]
                                   │
output ◄── [scale back up, smoothing OFF = crisp blocks] ◄─┘
        └─ (mix < 1) original drawn underneath, blocks composited at `mix` alpha
```

1. **Shrink.** The source is drawn into a small `w/blockSize × h/blockSize`
   buffer with smoothing on, so the browser *averages* each block's region
   into one pixel (a nicer mosaic than point-sampling one pixel per block).
2. **Grow.** That small buffer is scaled back to full size with smoothing
   off (nearest-neighbour), turning each averaged pixel into a crisp block.
3. **Mix.** Below `mix` 1 the original is drawn first and the blocks
   crossfade over it.

## Params

Both numeric params declare `modulation: { kind: 'audio' }`, so the panel
shows the per-param audio-binding dropdown — bind either to a live audio
slice (peak / sub / bass / mid / high / presence).

| Param | Range | What it does |
|---|---|---|
| `blockSize` | 1–128 px | Edge length of one mosaic block. 1 = untouched; larger = chunkier. *audio* |
| `mix` | 0–1 | Wet/dry. 1 = fully pixelated, 0 = original source, between = sharp↔blocky crossfade. *audio* |

## Performance

Cheaper than a full-resolution pass — the only real work is the GPU
`drawImage` shrink; there's no per-pixel JS loop and no `getImageData`
readback. The small offscreen canvas is reallocated only when the block
size (or canvas size) changes.

## Looks to try

- **Shatter on the beat:** `blockSize` ~8 base, bound to `peak` (unipolar)
  with a healthy amount — the image explodes into big blocks on transients
  and resolves on decay.
- **Subtle retro:** `blockSize` ~4–6, `mix` 1 — a gentle low-res grain.
- **Sharp↔blocky pulse:** bind `mix` to `bass` so the image dissolves into
  blocks and snaps back with the low end.

## Tests

`lib/mosaic.js` (config normalization, block-size → buffer dimensions) is
unit-tested in `lib/mosaic.test.js`. The Canvas2D downscale/upscale in
`pixelate-filter.js` is exercised by hand in the harness.
