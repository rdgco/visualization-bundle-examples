# echo

Rhythmic frame-delay with **delay-pedal controls** — a marching,
colour-shifting **ghost train**. A Canvas2D filter that keeps a ring buffer of
recent frames and composites fixed-time taps, so the image repeats a beat
later.

This is the bundle's second temporal filter and the deliberate counterpart to
[`feedback`](../feedback/). Both exploit the same "retain state across frames"
muscle, but from opposite ends:

| | `feedback` | `echo` |
|---|---|---|
| Temporal operator | exponential **decay** (a smear that fades) | fixed **delay** taps (repeats a beat later) |
| Data structure | one accumulation buffer (ping-pong) | **ring buffer** of ~120 frames |
| Implementation | WebGL (smooth warp needs a shader) | **Canvas2D** (delay-and-composite needs no per-pixel math) |

`echo` is a clean **multi-tap** delay (each repeat reads the original source at
a different delay), not a regenerative one — repeats-of-repeats (true feedback)
are `feedback`'s job. The Tone group fakes the analog "each echo is more
degraded" look without re-circulating.

## What it does

```
                ┌──────────────── ring buffer (time-stamped frames) ────────────────┐
source ─► write(downscaled, keyed, t=now) ─► [ … ][ … ][ … ][ … ][ … ]               │
   │                                            ▲       ▲       ▲                     │
   │                                 read now-time  now-2·time  now-3·time            │
   ▼                                            │       │       │                     │
  ctx ◄── live source ◄── repeat1 (level) ◄ repeat2 (·feedback) ◄ repeat3 (·fb²) ◄────┘
                          └── each repeat: spread + scale + Tone (blur/desat/dim/hue) ──┘
```

Each frame: store the live frame (downscaled by `detail`, and colour/luma-keyed
if a key is active) into the ring with a timestamp. Then draw the live source,
and for repeat `k = 1..repeats` look up the stored frame at the tap's age and
composite it at `level · feedback^(k-1)`, fanned by `spread`, sized by
`echoScale`, and toned by the Tone group.

Lookups are **time-indexed**, so the timing is frame-rate independent. The ring
is bounded (~2 s); `detail` trades stored-frame sharpness for memory.

## Params

### Delay (the pedal core)

| Param | Range | What it does |
|---|---|---|
| `time` | 10–1000 ms | Delay time between repeats. ~120–250 ms = tight rhythmic echo; bind to tempo for beat-locked repeats. (Beyond ~2 s of total delay the deepest repeats share the oldest frame.) *audio-bindable* |
| `repeats` | 1–12 | How many repeats (taps). Repeat k shows the frame from `time·k` ago. Structural — not modulated. |
| `level` | 0–1 | Wet level — opacity of the first repeat. 0 = dry passthrough. *audio-bindable* |
| `feedback` | 0–1 | How much each repeat persists into the next. Low = one clear echo; high = a long even train. *audio-bindable* |
| `direction` | forward / reverse | forward = delayed copies of the motion; **reverse** = each delay window plays backward on a loop (a reverse delay). |

### Spread (the canyon)

| Param | Range | What it does |
|---|---|---|
| `spread` | 0–1.5 | How far the echoes fan out. 0 = stacked (slapback); 1 = furthest repeat at the frame edge (canyon fills the screen); >1 flings them partly off-screen. *audio-bindable* |
| `spreadAngle` | 0–360 ° | Direction the echoes fan (0 = right, 90 = down). Bind an **LFO** source to auto-rotate the canyon, or a **random** source for a randomised angle each trigger. *audio-bindable* |
| `echoScale` | 0.3–1.5 | Per-repeat size (compounds: `echoScale^k`). <1 shrinks each repeat (recede); >1 **grows** each into a screen-filling bloom — even 1.2 blows up fast. *audio-bindable* |

### Tone (make the echoes differ from the source)

The analog-delay character: each repeat is progressively filtered, so the
ghosts look unlike the live image. Built from a chained `ctx.filter` (all
GPU-accelerated in Chromium).

| Param | Range | What it does |
|---|---|---|
| `echoBlur` | 0–30 px | Blur added per repeat (cumulative) — the high-frequency loss; echoes soften as they age. *audio-bindable* |
| `echoDesat` | 0–1 | Saturation lost per repeat — echoes drift toward grey. *audio-bindable* |
| `echoDim` | 0–1 | Brightness lost per repeat — a deeper fade on top of the opacity falloff. *audio-bindable* |
| `hueStep` | -180–180 ° | Hue rotation per repeat — a rainbow echo trail. *audio-bindable* |

### Key (echo only part of the image)

Echo only a brightness band or a colour, so the **background gets no ghosts**.
The key is applied once when the frame is stored (at `detail` resolution), so
all taps inherit the cutout at no per-tap cost. The live source still draws
fully — only the echoes are masked.

| Param | Range | What it does |
|---|---|---|
| `key` | off / luma / color | off = echo everything; luma = echo only a brightness band; color = echo only pixels near `keyColor`. |
| `keyLow` / `keyHigh` | 0–1 | luma mode: the brightness band to echo. Raise `keyLow` to drop a dark background; lower `keyHigh` to drop a bright one. *audio-bindable* |
| `keyColor` | hex | color mode: the colour to echo (or drop, with `keyInvert`). |
| `keyTolerance` | 0–1 | color mode: how close to `keyColor` a pixel must be to be echoed. *audio-bindable* |
| `keyInvert` | bool | Echo the **complement** — everything except the keyed range. Use to drop a known background colour. |
| `keySoftness` | 0–1 | Soft edge on the cutout so it isn't jagged. |

### Output

| Param | Range | What it does |
|---|---|---|
| `blend` | screen / add / over | How echoes composite. screen = glowing/clamped (default); add = additive (diverges from screen in bright/overlapping regions); over = opaque ghosts under the source. |
| `detail` | 0.25–1 | Resolution the ring stores frames at. The **memory + key-cost lever** — see below. Structural — not modulated. |

`repeats`, `direction`, `key`, `keyColor`, `keyInvert`, `keySoftness`, `blend`
and `detail` are deliberately **not** audio-bindable (integer / enum / colour /
ring-reallocating).

> **Reading the controls:** stacked echoes (`spread` 0) over a dark, slowly
> moving source make `feedback` and the `blend` modes hard to tell apart — the
> ghosts pile on the same pixels. Turn `spread` up so each echo lands in its
> own spot and both become obvious.

## Audio

Every continuous attribute carries the cross-host audio-modulation marker, so a
host can drive it from a live audio level (**peak / sub / bass / mid / high /
presence**). The filter never samples audio itself — the host senses and pushes
resolved values in through `setModulatedValues()`. Harness reads
`modulation.kind: 'audio'`; midi-daddy reads `sourceTypes`/`defaultAmount`.

The marker also lists **lfo** and **random** sources, so in the platform you
can bind a low-frequency oscillator or random generator to any attribute — e.g.
an LFO on `spreadAngle` for an auto-rotating canyon, or a random source for a
randomised angle per beat.

Good starting bindings: **peak → `level`** (ghosts swell with energy),
**high → `hueStep`** (rainbow trail shimmers on hats), **tempo → `time`**
(beat-locked repeats), **bass → `spread`** (the canyon breathes open).

## Reactions

| Reaction | Args | What it does |
|---|---|---|
| `burst` | `strength` 0–1 | Swell the echo on a transient (~400 ms decaying envelope): lifts every repeat toward full so a cloud of ghosts blooms on the beat, then settles back. |
| `clear` | — | Flush the delay line — wipes every stored frame so the tail vanishes instantly. A **state-reset** reaction (no decay envelope). |

## Memory & cost

The ring holds ~120 frames (2 s at 60 fps) at `detail` resolution. At 1080p:
`detail` 1.0 ≈ 1 GB, 0.5 ≈ 250 MB (**default**), 0.3 ≈ 90 MB. The key pass
(when active) is a per-pixel `getImageData` loop at the same `detail`
resolution — another reason to keep `detail` modest. Tone blurs run on the GPU
via `ctx.filter`. Drop `detail` on constrained rigs; the only cost is softer
ghosts.

## Running it

Stack `echo` as a filter **above** moving content:

- **`vibrations`** — the audio-reactive rings make each delayed repeat legible;
  bind `peak → level`.
- **`skyline`** — the moving camera leaves a rhythmic ghost train; raise
  `spread` for echoes that fan across the skyline, or set `key: luma`,
  `keyLow` ~0.3 to echo only the lit buildings and not the night sky.

## Looks to try

- **Tight slapback:** `time` ~120 ms, `repeats` 2, `feedback` ~0.4, `spread` 0.
- **Canyon:** `repeats` 8, `spread` ~0.8, `echoScale` ~0.9, `feedback` ~0.8 —
  a wall of receding echoes. Spin `spreadAngle` to aim it.
- **Analog tape:** add `echoBlur` ~2, `echoDesat` ~0.25, `echoDim` ~0.15 — each
  repeat softer, greyer, darker, like a degrading tape echo.
- **Reverse swell:** `direction` reverse, `time` ~300 ms, `feedback` ~0.7 — the
  motion rewinds into itself.
- **Keyed foreground:** `key` color, `keyColor` to your subject's hue (or
  `key` luma + `keyLow` ~0.3) so only the foreground trails and the background
  stays clean.
- **Beat snap:** bind `burst` to a kick and `clear` to the downbeat.
- **Super-saturation bloom:** `blend` add, `feedback` ~0.9, `repeats` 10–12,
  `echoScale` ~1.15 — additive repeats accumulate and the growing scale fills
  the frame, blowing the image out into a white bloom. Pull it back with
  `level` / `echoDim`. (This is the over-saturation headroom — `add` + high
  `feedback` + many `repeats` is the recipe; `echoScale` > 1 amplifies it.)

## Tests

`echo-filter.test.js` is a standalone runner (`node
filters/echo/echo-filter.test.js`) covering the DOM-independent logic: param
clamping + rounding, key colour parsing, the key math (smoothstep / bandKeep /
colorKeep), the `burst` envelope, the `clear` reset, blend-mode mapping, audio
markers, contiguous param grouping, the no-DOM passthrough, and lifecycle
no-throws. The ring buffer + key cutout are verified visually in a host.
