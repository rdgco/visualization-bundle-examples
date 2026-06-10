# twirl

Polar warp — **twirl, pinch, or fisheye** the image around a centre. A WebGL
filter that remaps the sample coordinate in polar space.

Third of the **GPU-displacement family** (`ripple`, `chromatic-aberration`,
`twirl`), closing out the filter epic. A **non-affine** warp — which is exactly
why it's WebGL and not Canvas2D: you can't do a per-pixel polar remap with
`drawImage`. Stateless (no retained buffer); mirrors `vignette`'s inline GL bridge.

## Modes

- **twirl** — spin the image into a spiral (the rotation falls off from centre
  to the radius edge). Sign of `strength` = spin direction. *(default)*
- **pinch** — squeeze the image toward the centre; **negative `strength`
  bulges** it outward.
- **fisheye** — barrel lens; **negative `strength`** is pincushion.

## Params

| Param | Range | What it does |
|---|---|---|
| `mode` | twirl / pinch / fisheye | See above. |
| `strength` | -1–1 | Warp amount, **signed**. 0 = none. For twirl the sign is the spin direction (±1 ≈ a full turn at the centre); for pinch / fisheye, ± are the two opposite distortions. *audio-bindable* |
| `radius` | 0.1–1.5 | How far the warp reaches (fraction of frame). Strongest at the centre, eases to none at the edge. *audio-bindable* |
| `centerX` / `centerY` | 0–1 | Centre of the warp. *audio-bindable* |

## Reactions

| Reaction | Args | What it does |
|---|---|---|
| `pulse` | `strength` 0–1 | Throb the warp on a transient (~400 ms) — the magnitude swells (in whichever direction it's set), then settles. Fire on a beat for a lens that breathes. |

## Audio

Every numeric attribute carries the cross-host audio-modulation marker — drive
it from a live level (**peak / sub / bass / mid / high / presence**) or an
**lfo / random** source in the platform. The filter never samples audio itself;
the host pushes resolved values via `setModulatedValues()`.

Good starting bindings: **lfo → `strength`** (a slow breathing lens / rocking
twist), **peak → `strength`** (beat-reactive twist), **lfo → `centerX`** to
wander the warp centre.

## Looks to try

- **Spiral:** twirl, `strength` ~0.6, `radius` ~0.8 — the frame winds into a
  vortex. Bind `strength` to an LFO to rock it back and forth.
- **Black-hole pinch:** pinch, `strength` ~0.7 — everything sucks toward the
  centre.
- **Bulge / magnify:** pinch, `strength` ~-0.6 — the centre balloons out.
- **Fisheye lens:** fisheye, `strength` ~0.5 — barrel-distorted wide angle.
- **Beat twist:** twirl, small base `strength`, bind `pulse` to a kick.

## Tests

`twirl-filter.test.js` (`node filters/twirl/twirl-filter.test.js`) covers the
GL-independent logic: param clamping (incl. signed `strength`), the mode
mapping, the `pulse` envelope, audio markers, contiguous param grouping, the
no-WebGL passthrough, and lifecycle no-throws. The warp is verified visually in
a host.
