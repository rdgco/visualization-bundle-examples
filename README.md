# visualization-bundle-examples

The canonical **public examples bundle** for
[`visualization-harness`](https://github.com/rdgco/visualization-harness).

This repo is a **bundle** — a tree of layer directories that any
visualization-harness install can pull in with one command:

```bash
visual-bundle install github:rdgco/visualization-bundle-examples#v0.6.0
```

After install, every layer here becomes loadable in the harness via
`layer load <key>`.

## Compatibility

This bundle is validated — in CI and via the local
`node .github/scripts/validate-bundle.mjs` check — against the
**`visualization-layer-core` contract at `v0.4.0`** (the exact pin
lives in [`.github/package.json`](.github/package.json)). Consumers
installing this bundle should be on layer-core **`v0.4.0` or later**.

Pin a specific bundle tag (e.g. `#v0.6.0`) rather than a branch for
reproducible installs.

## What's in this bundle

### Layers (full-frame renderers)

| Layer | Type | Notes |
|---|---|---|
| `skyline` | WebGL 3D | Procedural night-time city; canonical "real shader-driven layer" reference. See [`layers/skyline/README.md`](layers/skyline/README.md). |
| `vibrations` | 2D Canvas | Concentric stroked shapes, audio-driven radial vibration in four modes, three reactions. Canonical 2D contract reference; the colocated test locks in the per-frame ctx invariant. See [`layers/vibrations/README.md`](layers/vibrations/README.md). |

### Filters (post-process the cumulative canvas)

15 filters across five families. Every filter has a `filters/<name>/README.md`
with full params and looks. Every numeric attribute is audio-bindable with the
cross-host marker (`kind: 'audio'` for the harness; `sourceTypes` +
`defaultAmount` + lfo/random for the platform).

**Building blocks** — the smoke-test references.

| Filter | Type | Notes |
|---|---|---|
| `color-tint` | 2D Canvas | Blit + tint overlay. The simplest possible filter; verifies the pipeline end-to-end. |
| `invert` | 2D Canvas | RGB invert with a strength fade. Exercises the `getImageData` readback path. |
| `glitch` | 2D Canvas | Digital glitch. Canonical **param + reaction** example: `intensity` (baseline) + `burst` (transient spike), `mode` rgb-split / slice / blocks. |
| `vignette` | WebGL | Elliptical vignette, independent frame/glass tint/blur/lens. The "real shader-driven filter" reference. |

**Stylize** — per-pixel point / kernel ops (a tunable `detail` lever where it matters).

| Filter | Type | Notes |
|---|---|---|
| `edge-detect` | 2D Canvas | Sobel edges with wet/dry, colour mode, glow, and a `pulse` reaction. |
| `duotone` | 2D Canvas | Gradient-map shadows→highlights through a 2/3-stop palette. |
| `pixelate` | 2D Canvas | Mosaic / block-resample; bind the block size to audio for a shatter-on-the-beat. |

**Temporal** — the retained-buffer family (output depends on more than the current frame).

| Filter | Type | Operator |
|---|---|---|
| `feedback` | WebGL | **decay** — ghost trails / infinite-tunnel zoom-rotate. |
| `echo` | 2D Canvas | **delay** — rhythmic frame-delay with delay-pedal controls + canyon spread. |
| `freeze` | 2D Canvas | **hold** — sample-and-hold / stutter, with a `fade` lifecycle. |
| `long-exposure` | 2D Canvas | **accumulate** — light-painting; bright motion etches trails that don't fade. |

**Motion**

| Filter | Type | Notes |
|---|---|---|
| `frame-diff` | 2D Canvas | Motion detector — `\|current − previous\|`; motion / reveal / mask modes + motion trails. |

**Displacement** — stateless GPU spatial warps.

| Filter | Type | Notes |
|---|---|---|
| `ripple` | WebGL | Animated wave / heat-haze (horizontal / vertical / radial / shimmer). |
| `chromatic-aberration` | WebGL | Radial RGB lens dispersion; snaps on a beat. |
| `twirl` | WebGL | Polar warp — twirl / pinch / fisheye (signed strength). |

More layers and filters land here over time. Each one ships as a directory
under `layers/<name>/` or `filters/<name>/` with the contract entry at
`<name>-layer.js` or `<name>-filter.js`.

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

filters/                   15 filters, each its own directory:
  <name>/
    <name>-filter.js          contract entry
    <name>-filter.test.js     standalone runner test (run by CI)
    lib/                      shader sources / pure math (where used)
    README.md                 per-filter reference

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
