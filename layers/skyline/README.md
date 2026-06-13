# Skyline layer

Canonical **3D SDK example** for the visualization-harness contract.
A procedural night-time city skyline with lit windows, varied building
shapes, rooftop features, red aviation lights, and street glow. Built
on three GLSL shader programs (buildings + ground + light points),
drawn through the harness's standard orbit camera.

## How to run it

```bash
git clone https://github.com/rdgco/visualization-harness.git
cd visualization-harness
npm install
visual-bundle install github:rdgco/visualization-bundle-examples
npm start
# in the REPL:
> window open
> layer load skyline
```

Drive the camera with WASD (move), arrow keys (look around), `=` / `-`
(zoom). See the harness's main README for the full key map.

## What this layer demonstrates

- **WebGL rendering** via `wantsContext: 'webgl'`.
- **Three shader programs** sharing one canvas — building bodies +
  roofs, the ground plane with the street-glow falloff, and the GL
  point-sprite aviation lights blinking on tall buildings.
- **All `number`, `color`, and `boolean` param kinds**, plus continuous-
  source modulation hints exercised end-to-end through the panel (BIND /
  AMT / MODE controls on every modulatable widget).
- **A configurable footprint + facade mix** — `footprintVariety` plus the
  `allowEll` / `allowCylinder` toggles vary the building silhouettes
  (box / bevel / chop / L-shape / round tower); `facadeVariety` and
  `lightFill` vary the window styling (standard / small-gap / curtain-wall,
  and how much of each pane lights up); `patternVariety` layers in real
  facade *patterns* — mullioned curtain walls, ribbon and vertical-strip
  windows, spandrel floors — hashed per face, with floor-lit "office" vs
  scatter-lit "residential" lighting; `silhouetteVariety` adds richer massing —
  tiered setbacks, podium-and-tower profiles, slab/point aspect mixes, and the
  crown features (spire, antenna needles) on the tallest buildings.
- **Street level** — `streetStyle: paved` swaps the glow ground for real
  streets on the building grid (asphalt, dashed lane lines, sidewalks,
  crosswalks, warm streetlights); `traffic` + `carSpeed` add GPU-animated
  cars (white headlight / red taillight streams) whose lane positions are
  computed in the vertex shader from time — no per-frame CPU, free to
  modulate. Works in classic mode today; endless mode follows.
- **A style descriptor seam** (`lib/style.js`) — all per-style aesthetics
  (wall palette, window-light tints, facade pattern set) live in one
  `CONTEMPORARY` descriptor; CPU values are read directly, shader-side
  values are injected into the building fragment shader as a `#define`
  prelude. Groundwork for future city styles (sci-fi, spaceport) without
  a renderer rewrite — there is one style today, so no `style` param yet.
- **A `pulse` reaction** with three entry strategies (`bottom-up`,
  `top-down`, `point-out`) that send brightness waves through the lit
  windows. Demonstrates the harness's reaction-with-args shape and the
  `drum-*` accept categories.
- **`wantsCamera` opt-in** — frames the city's ~40-unit footprint at
  a high-angle three-quarter view; operator-driven from there.

## Things to know about specific params

| Param | Behavior |
|---|---|
| `seed` | Range `0..99999` step `1`. The slider works but the wide range makes finding a specific value tedious — easier to bind to audio or hand-edit `config/session-state.json`. |
| `seed`, `density`, `maxHeight`, `footprintVariety`, `allowEll`, `allowCylinder` | Each triggers a full city geometry rebuild on change. Dragging/toggling these feels less smooth than the others — there's a brief reflow. By design: each value implies a different geometry. |
| `footprintVariety` | Fraction of buildings that get a non-box footprint. Bevels and chops are common; the `allowEll` / `allowCylinder` toggles gate the rare L-shapes and very-rare round towers. `0` = an all-rectangular skyline. |
| `silhouetteVariety` | Rebuild param. Fraction of mid/tall buildings given richer massing than the classic single taper: tiered wedding-cake setbacks, podium-and-tower profiles, and thin-slab / square-point aspect mixes. At `>0` the tallest building also grows its spire (stubbed out and unrendered until now) and a few towers sprout antenna needles — both gated so `0` keeps classic's flat-topped tallest exactly as it was. |
| `streetStyle` | `glow` (classic warm pools) or `paved` (asphalt streets on the building grid: lane dashes, sidewalks, crosswalks, streetlights). Switching regenerates streetlight + car geometry, so it reflows briefly. `streetGlow` controls the roadway lighting level in `paved` style. |
| `traffic` / `carSpeed` | Live. `traffic` is car density (`0` = none); `carSpeed` scales their speed. Cars only appear with `streetStyle: paved`. They advance block-by-block with stop-and-go at intersections (some cars catch a red light and wait) — slow city traffic, not streaking lights. Positions are computed on the GPU from time, so both are cheap to animate — bind `carSpeed` (or `traffic`) to audio for traffic that surges with the music. |
| `facadeVariety` | Live (no rebuild) — the window-facade style is chosen per building in the shader. `0` = every building has standard punched windows; raising it blends in small-gap and full-glass curtain-wall facades. |
| `patternVariety` | Live (no rebuild) — fraction of building *faces* drawn from the pattern pool (mullioned curtain wall, ribbon, vertical strips, spandrel floors). Hashed per face, so corner towers mix cladding; pattern buildings also split into floor-lit offices and scatter-lit residential. `0` = the classic facade mix only, rendered bit-identically. Distinct from `facadeVariety`, which only varies window *margins*. |
| `lightFill` | Live — how much of each window pane actually emits light. `1` ≈ the whole pane glows (continuous-glass look on curtain walls); lower leaves a dim glass surround with a smaller lit rectangle inside, so the light reads smaller than the window. |
| `lightColor` | Declares `modulation: { kind: 'continuous' }` as a forward-compat hint, but the harness's audio binding only resolves to numbers — so the panel intentionally doesn't show a BIND dropdown on this widget. The color picker is the only operator-driven input. |

## File layout

```
skyline/
  skyline-layer.js     Contract entry — declares params, reactions, wantsCamera
  lib/
    city.js            Procedural city + render orchestration
    layout.js          Building grid generator
    style.js           Per-style aesthetic descriptors + shader-inject prelude
    traffic.js         Traffic subsystem — deterministic car lanes over the road grid
    geometry.js        Building / roof / light geometry
    shaders.js         The four GLSL programs (building, ground, light, car) + composers
    gl-utils.js        Shader compile / VBO helpers
    math.js            Mat4 / vec3 helpers (column-major Float32Array, WebGL convention)
    layout.test.js     Layout determinism + classic-layout regression (plain node)
    style.test.js      Style descriptor shape + shader injection (plain node)
    traffic.test.js    Car lane generation: determinism, bounds, alignment (plain node)
    adapter.test.js    configFromParams plumbing (plain node)
```

The `lib/*.test.js` files are plain-node (`node:assert`) and run in bundle
CI; they cover the GL-independent logic — seeded layout determinism, the
classic-layout regression lock, the style descriptor, and config plumbing.

`skyline-layer.js` is the contract entry — declares params, reactions,
and `wantsCamera`. The renderer details live under `lib/`; that code
is preserved as a tight reference for "what does a real WebGL layer
look like under the contract."
