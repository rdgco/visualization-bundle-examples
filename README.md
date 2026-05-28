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

| Layer | Type | Notes |
|---|---|---|
| `skyline` | WebGL 3D | Procedural night-time city; canonical "real shader-driven layer" reference. See [`layers/skyline/README.md`](layers/skyline/README.md). |
| `vibrations` | 2D Canvas | Concentric stroked shapes, audio-driven radial vibration in four modes, three reactions. Canonical 2D contract reference; the colocated test locks in the per-frame ctx invariant. See [`layers/vibrations/README.md`](layers/vibrations/README.md). |

More layers will land here over time. Each one ships as a directory
under `layers/<name>/` with the contract entry at
`layers/<name>/<name>-layer.js`. Read the harness's
[`docs/contract.md`](https://github.com/rdgco/visualization-harness/blob/main/docs/contract.md)
for the contract surface every layer declares.

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
README.md                this file
```

No bundle manifest, no `package.json`, no build step. The harness
auto-discovers `layers/*/<name>-layer.js` on install + validates each
against the contract. Bundles that don't fit this layout are rejected
at install time.

## Contributing a layer

Pull requests welcome. The flow:

1. Fork this repo.
2. Add your layer under `layers/<your-layer-name>/`. Follow the
   contract shape — `key`, `label`, `params`, `reactions`, and a
   default-export class with `init` / `render` /
   `react(key, args, eventContext)` / `cleanup` methods. See
   `layers/skyline/skyline-layer.js` for a
   substantial reference.
3. Smoke it in the harness against `bundle install <your-fork-url>`.
4. Open a PR. Reviewers check contract conformance, code quality, and
   visual cohesion with the existing examples.
5. After merge, a maintainer tags a new release; bundle consumers
   pin to the tag.

## License

ISC — same as the harness. Layers contributed here are public and
freely reusable.
