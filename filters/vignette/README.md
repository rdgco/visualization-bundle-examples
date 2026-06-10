# vignette

GPU-rendered elliptical vignette — the bundle's "real shader-driven filter"
reference. Two independently configurable regions, **frame** (border) and
**glass** (centre), each with colour tint, blur, brightness / contrast /
saturate / hue, plus lens distortion and zoom on the glass.

WebGL, with an inline GL bridge (the pattern the displacement filters reuse).
Degrades to a passthrough when WebGL is unavailable.

## Params

20 modulatable params declared in [`lib/vignette-schema.js`](lib/vignette-schema.js),
grouped **Shape** / **Frame** / **Glass** (flat dot-notation keys like
`frame.blur`). Highlights:

- **Shape:** `sizeX`, `sizeY`, `softness`.
- **Frame:** `frame.color`, `frame.opacity`, `frame.blur`, `frame.brightness`,
  `frame.contrast`, `frame.saturate`, `frame.hueRotate`.
- **Glass:** the same set, plus `glass.lens`, `glass.lensPower`, `glass.zoom`.

Every param carries the cross-host audio-modulation marker (`kind: 'audio'` for
the harness; `sourceTypes` + `defaultAmount` for the platform; lfo/random for
its generators); the colour params also declare `colorMode` for hue-shift /
rgb-delta modulation. The filter never samples audio itself.

## Tests

`vignette-filter.test.js` (`node filters/vignette/vignette-filter.test.js`): the
headless guard + passthrough, the schema's audio markers, lifecycle no-throws.
The shader output is verified visually in a host.
