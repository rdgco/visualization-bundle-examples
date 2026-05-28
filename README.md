# visualization-bundle-examples

The canonical **public examples bundle** for
[`visualization-harness`](https://github.com/rdgco/visualization-harness).

This repo is a **bundle** — a tree of layer directories that any
visualization-harness install can pull in with one command:

```bash
visual-bundle install github:rdgco/visualization-bundle-examples#v0.1.0
```

After install, every layer here becomes loadable in the harness via
`layer load <key>`.

## What's in this bundle

### Layers (full-frame renderers)

| Layer | Type | Notes |
|---|---|---|
| `skyline` | WebGL 3D | Procedural night-time city; canonical "real shader-driven layer" reference. See [`layers/skyline/README.md`](layers/skyline/README.md). |
| `vibrations` | 2D Canvas | Concentric stroked shapes, audio-driven radial vibration in four modes, three reactions. Canonical 2D contract reference; the colocated test locks in the per-frame ctx invariant. See [`layers/vibrations/README.md`](layers/vibrations/README.md). |

### Filters (post-process the cumulative canvas)

| Filter | Type | Notes |
|---|---|---|
| `color-tint` | 2D Canvas | Overlays a configurable tint color over the source. The simplest possible filter — useful as a smoke test for the harness's filter pipeline. Demos color + number params with `modulation: true`. |
| `invert` | 2D Canvas | Per-pixel RGB invert with adjustable strength. Exercises the `getImageData` / `putImageData` readback path (vs `color-tint`'s blit-only path). |
| `vignette` | WebGL | GPU-rendered elliptical vignette with independent frame/glass tinting, blur, lens distortion, brightness/contrast/saturate/hue. Migrated from midi-daddy; canonical "real shader-driven filter" reference. |

More layers and filters will land here over time. Each one ships as
a directory under `layers/<name>/` or `filters/<name>/` with the
contract entry at `<name>-layer.js` or `<name>-filter.js`.

## Repo layout

```
layers/
  skyline/
    skyline-layer.js     contract entry
    lib/                 renderer code
    README.md            per-layer reference
  vibrations/
    vibrations-layer.js       contract entry
    vibrations-layer.test.js  per-frame ctx invariant tests
    README.md                 per-layer reference

filters/
  color-tint/
    color-tint-filter.js      contract entry
  invert/
    invert-filter.js          contract entry
  vignette/
    vignette-filter.js        contract entry
    lib/                      shader sources + param schema

README.md                this file
```

No bundle manifest, no `package.json`, no build step. The harness
auto-discovers `layers/*/<name>-layer.js` and
`filters/*/<name>-filter.js` on install + validates each against
its contract. Bundles that don't fit this layout are rejected at
install time.

## Contributing a layer or filter

Pull requests welcome. The flow:

1. Fork this repo.
2. Add your module under `layers/<your-name>/` or
   `filters/<your-name>/`. Follow the contract shape:
   - **Layer:** `key`, `label`, `description`, `params`,
     `reactions`, and a default-export class with `init` /
     `render` / `react(key, args, eventContext)` / `cleanup`
     methods. See `layers/skyline/skyline-layer.js`.
   - **Filter:** `key`, `label`, `description`, `type` (literal
     `'filter'`), `params`, optional `reactions`, and a
     default-export class with `constructor(width, height, params)` /
     `render(sourceCanvas, ctx)` / `cleanup` methods. See
     `filters/vignette/vignette-filter.js`.
3. Smoke it in the harness against `visual-bundle install <your-fork-url>`.
4. Open a PR. Reviewers check contract conformance, code quality,
   and visual cohesion with the existing examples.
5. After merge, a maintainer tags a new release; bundle consumers
   pin to the tag.

## License

ISC — same as the harness. Layers contributed here are public and
freely reusable.
