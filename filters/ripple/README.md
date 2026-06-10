# ripple

Animated wave displacement — **the layer undulates like water.** A WebGL
filter that samples the scene through a moving sine field for liquid /
heat-haze / underwater wobble.

First of the **GPU-displacement family** (`ripple`, `chromatic-aberration`,
`twirl`) — stateless spatial warps, distinct from the temporal filters: there's
no retained buffer, each frame is a pure function of the scene + the clock.
WebGL because smooth per-pixel UV displacement is a shader's home turf; mirrors
`vignette`'s inline GL bridge.

## Modes

- **horizontal / vertical** — a travelling wave along one axis.
- **radial** — concentric ripples spreading from `centerX`/`centerY` (a
  water-drop). *(default)*
- **both** — a 2D shimmer.

## Params

| Param | Range | What it does |
|---|---|---|
| `mode` | horizontal / vertical / radial / both | See above. |
| `waveAmount` | 0–0.1 | Displacement amplitude (fraction of the frame). 0 = none; ~0.02 gentle; 0.1 strong. *audio-bindable* |
| `waveCount` | 1–40 | Wave crests across the frame. Low = big swells; high = fine ripples. *audio-bindable* |
| `waveSpeed` | 0–6 | How fast the waves travel (0 = frozen). *audio-bindable* |
| `centerX` / `centerY` | 0–1 | radial mode: origin of the ripples. *audio-bindable* |

## Reactions

| Reaction | Args | What it does |
|---|---|---|
| `pulse` | `strength` 0–1 | Swell the waves on a transient (~450 ms): displacement jumps, then settles back to `waveAmount`. Fire on a beat to make the image lurch. |

## Audio

Every numeric attribute carries the cross-host audio-modulation marker — drive
it from a live level (**peak / sub / bass / mid / high / presence**) or an
**lfo / random** source in the platform. The filter never samples audio itself;
the host pushes resolved values via `setModulatedValues()`.

Good starting bindings: **peak → `waveAmount`** (the image breathes with the
beat), **bass → `waveSpeed`**, an **lfo → `centerX`** to drift the ripple origin.

## Looks to try

- **Water:** radial, `waveAmount` ~0.015, `waveCount` ~10, `waveSpeed` ~1.
- **Heat-haze:** both, `waveAmount` ~0.008, `waveCount` ~20, slow.
- **Liquid lurch:** bind `pulse` to a kick so the image jolts on the beat.
- **Tidal swell:** horizontal, low `waveCount` (~3), high `waveAmount`.

## Tests

`ripple-filter.test.js` (`node filters/ripple/ripple-filter.test.js`) covers the
GL-independent logic: param clamping, the mode mapping, the `pulse` envelope,
audio markers, contiguous param grouping, the no-WebGL passthrough, and
lifecycle no-throws. The wave displacement is verified visually in a host.
