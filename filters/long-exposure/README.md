# long-exposure

Light-painting accumulator — **a camera shutter left open.** A Canvas2D filter
that max-blends every frame into a retained buffer, so bright moving things
etch streaks that don't fade.

This is the bundle's fourth temporal filter, completing the retained-buffer
quartet. Each one is a different temporal operator:

| filter | operator | what the buffer does |
|---|---|---|
| `feedback` | **decay** | one accumulator, faded toward black each frame (a smear that fades) |
| `echo` | **delay** | ring buffer, replayed at fixed delays |
| `freeze` | **hold** | one held frame, captured and held |
| `long-exposure` | **accumulate** | one accumulator, **kept at its brightest** (never fades, unless you let it) |

The distinction from `feedback`: feedback *over*-blends and decays toward black,
so trails fade. Long-exposure **`lighten`-blends** (keeps the max per pixel), so
dark areas never overwrite what's been painted — trails persist for seconds, or
forever, until you `clear`.

## What it does

```
clear/seed ─► accumulation ◄─ lighten(source · gain) ─◄ source
                  │  ▲                                    │
        decay (fade  │  hue-rotate (older paint           │
        toward black)│   drifts further)                  │
                  ▼  │                                     ▼
        ctx ◄── crossfade(live, accumulation, mix) ◄───────┘
```

Each frame: optionally **decay** the buffer (fade toward black), optionally
**hue-rotate** it (so older paint drifts further around the colour wheel),
**accumulate** the live frame in (lighten / add / screen, boosted by
`sourceGain`), then **output** a crossfade of live and the accumulation.

Pure Canvas2D — `globalCompositeOperation = 'lighten'` is the whole trick
(GPU-accelerated), plus a black-fade for decay and `ctx.filter` hue-rotate. One
accumulation canvas, trivial memory.

## Params

### Exposure

| Param | Range | What it does |
|---|---|---|
| `accumulate` | lighten / add / screen | How the live frame builds up. lighten = keep the brightest per pixel (classic light-painting); add = additive (blows toward white faster); screen = softer additive. |
| `decayTime` | 0–30 s | How long trails persist before fading (half-life). **0 = infinite** — trails never fade until `clear`. A few seconds keeps live video lively; longer = denser. *audio-bindable* |
| `sourceGain` | 0–3 | How hard the live frame etches in each frame. 1 = as-is; >1 over-drives (brighter, faster trails); 0 = stop painting (buffer just decays). *audio-bindable* |
| `mix` | 0–1 | Output blend live (0) ↔ accumulation (1). 1 = pure long-exposure; lower to bring the crisp live frame back through the trails. *audio-bindable* |

### Colour

| Param | Range | What it does |
|---|---|---|
| `hueDrift` | -180–180 °/s | Hue rotation of the accumulation. Compounds over the buffer, so older trails drift further around the wheel than fresh paint — a rainbow light-trail. *audio-bindable* |

## Reactions

| Reaction | Args | What it does |
|---|---|---|
| `clear` | — | Wipe the accumulation and start a fresh exposure from the current frame. The canonical light-painting reset. A **state-reset** reaction. |
| `pulse` | `strength` 0–1 | Over-drive the source on a transient (~400 ms) so a beat etches a brighter burst into the exposure, then settles back to `sourceGain`. |

## Audio

`decayTime`, `sourceGain`, `mix` and `hueDrift` carry the cross-host
audio-modulation marker, so a host can drive them from a live audio level
(**peak / sub / bass / mid / high / presence**) — and from **lfo / random**
sources in the platform. The filter never samples audio itself; the host pushes
resolved values via `setModulatedValues()`.

Good starting bindings: **peak → `sourceGain`** (loud moments paint brighter),
**bass → `decayTime`** (trails linger longer on the drops), **mid → `hueDrift`**
(the light-trail colour-cycles with the track).

## Running it

Best over **moving content with bright highlights on a dark field** — video,
particles, neon. In midi-daddy, drop it above a video background:

- `accumulate` lighten, `decayTime` ~6 s — bright video motion paints fading
  light-trails.
- `decayTime` 0 — infinite exposure: the frame fills up with the brightest of
  everything that's passed. Fire `clear` to start over.

## Looks to try

- **Light trails:** lighten, `decayTime` ~4 s — moving highlights streak and
  fade like car-light long exposures.
- **Infinite paint:** `decayTime` 0 — paint forever; `clear` to reset.
- **Rainbow trails:** add `hueDrift` ~25 °/s — the streaks cycle colour as they
  age.
- **Beat etch:** bind `pulse` to a kick so hits burn brighter into the
  exposure; bind `clear` to a phrase boundary to wipe and restart.
- **Bloom build:** `accumulate` add, `decayTime` ~2 s, `sourceGain` ~1.5 —
  additive over-drive into a glowing wash (clamp it with a short decay).

## Tests

`long-exposure-filter.test.js` is a standalone runner (`node
filters/long-exposure/long-exposure-filter.test.js`) covering the
DOM-independent logic: param clamping, the `retainFactor` decay math, the
blend-mode mapping, the `clear`/`pulse` reactions, audio markers, contiguous
param grouping, the no-DOM passthrough, and lifecycle no-throws. The painted
trails are verified visually in a host.
