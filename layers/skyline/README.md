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
- **All `number` and `color` param kinds**, plus continuous-source
  modulation hints exercised end-to-end through the panel (BIND /
  AMT / MODE controls on every modulatable widget).
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
| `seed`, `density`, `maxHeight` | Each triggers a full city geometry rebuild on change. Dragging these sliders feels less smooth than the others — there's a brief reflow per frame. By design: each value implies a different geometry. |
| `lightColor` | Declares `modulation: { kind: 'continuous' }` as a forward-compat hint, but the harness's audio binding only resolves to numbers — so the panel intentionally doesn't show a BIND dropdown on this widget. The color picker is the only operator-driven input. |

## File layout

```
skyline/
  skyline-layer.js     Contract entry — declares params, reactions, wantsCamera
  lib/
    city.js            Procedural city + render orchestration
    layout.js          Building grid generator
    geometry.js        Building / roof / light geometry
    shaders.js         The three GLSL programs
    gl-utils.js        Shader compile / VBO helpers
    math.js            Mat4 / vec3 helpers (column-major Float32Array, WebGL convention)
```

`skyline-layer.js` is the contract entry — declares params, reactions,
and `wantsCamera`. The renderer details live under `lib/`; that code
is preserved as a tight reference for "what does a real WebGL layer
look like under the contract."
