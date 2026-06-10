# echo

Rhythmic frame-delay — a marching, colour-shifting **ghost train**. A
Canvas2D filter that keeps a ring buffer of recent frames and composites a
few fixed-**delay** taps, so the image repeats a beat later.

This is the bundle's second temporal filter and the deliberate counterpart to
[`feedback`](../feedback/). Both exploit the same "retain state across frames"
muscle, but from opposite ends:

| | `feedback` | `echo` |
|---|---|---|
| Temporal operator | exponential **decay** (a smear that fades) | fixed **delay** taps (repeats a beat later) |
| Data structure | one accumulation buffer (ping-pong) | **ring buffer** of ~120 frames |
| Implementation | WebGL (smooth warp needs a shader) | **Canvas2D** (delay-and-composite needs no per-pixel math) |

`echo` is here to show the retained-state pattern **generalises beyond
shaders** — it's just an array of ordinary offscreen canvases, time-stamped
and read back at `now − delay·k`.

## What it does

```
                ┌──────────────── ring buffer (time-stamped frames) ────────────────┐
source ─► write(downscaled, t=now) ─► [ … ][ … ][ … ][ … ][ … ]                      │
   │                                     ▲       ▲       ▲                            │
   │                          read now-delay  now-2·delay  now-3·delay  (nearest t)   │
   ▼                                     │       │       │                            │
  ctx ◄── live source ◄── tap1 (echoLevel) ◄ tap2 (·falloff) ◄ tap3 (·falloff²) ◄────┘
```

Each frame: store the live frame (downscaled by `detail`) into the ring,
stamped with the current time. Then draw the live source, and for tap
`k = 1..taps` look up the stored frame nearest `now − delay·k` and composite
it at `echoLevel · falloff^(k-1)`, with an optional per-tap drift (`offsetX/Y`)
and hue step (`hueStep`).

Lookups are **time-indexed, not frame-indexed**, so the echo timing is
frame-rate independent and survives stalls. The ring is sized to cover the
deepest tap (`taps_max · delay_max` = 2000 ms).

## Params

| Param | Range | What it does |
|---|---|---|
| `delay` | 10–500 ms | Time between echoes. ~120–250 ms reads as a tight rhythmic echo; bind to tempo for beat-locked repeats. *audio-bindable* |
| `echoCount` | 1–8 | How many ghosts. Echo k shows the frame from `delay·k` ago. Crank it with `spread` for a canyon. Structural — not modulated. |
| `echoLevel` | 0–1 | Opacity of the first echo. 0 = passthrough; later echoes fall off by `falloff`. *audio-bindable* |
| `falloff` | 0–1 | Opacity ratio between successive echoes. Low = one clear echo; high = a long even train. *audio-bindable* |
| `spread` | 0–1 | How far the echoes fan out across the screen. 0 = stacked in place (slapback); 1 = furthest echo reaches the frame edge (canyon fills the screen). *audio-bindable* |
| `spreadAngle` | 0–360 ° | Direction the echoes fan (0 = right, 90 = down) — the axis of the canyon. *audio-bindable* |
| `echoScale` | 0.6–1 | Per-echo size multiplier. 1 = full size; <1 shrinks each successive echo so they recede into the distance (canyon perspective). *audio-bindable* |
| `hueStep` | -180–180 ° | Hue rotation added per echo — a rainbow echo trail. *audio-bindable* |
| `blend` | screen / add / over | How echoes composite. screen = glowing/clamped (default); add = additive (diverges from screen in bright/overlapping regions); over = opaque ghosts under the source. |
| `detail` | 0.25–1 | Resolution the ring stores frames at. The **memory lever** — see below. Structural — not modulated. |

`echoCount` and `detail` are deliberately **not** audio-bindable: `echoCount`
is an integer count and `detail` reallocates the ring, so neither wants
per-frame modulation.

> **Reading the controls:** stacked echoes (`spread` 0) over a dark, slowly
> moving source make `falloff` and the `blend` modes hard to tell apart —
> the ghosts pile on the same pixels. Turn `spread` up so each echo lands in
> its own spot and both become obvious: `falloff` is the brightness fade down
> the canyon, and `add` vs `screen` shows where ghosts overlap.

## Audio

Every continuous attribute carries the cross-host audio-modulation marker, so
a host can drive it from a live audio level (**peak / sub / bass / mid / high /
presence**). The filter never samples audio itself — the host senses and
pushes resolved values in through `setModulatedValues()` (sense in the host,
map on the patch, the visual stays audio-blind). Harness reads
`modulation.kind: 'audio'`; midi-daddy reads `sourceTypes`/`defaultAmount`.

Good starting bindings: **peak → `echoLevel`** (ghosts swell with energy),
**high → `hueStep`** (rainbow trail shimmers on hats), **tempo → `delay`**
(beat-locked repeats), **bass → `spread`** (the canyon breathes open on the
low end).

## Reactions

| Reaction | Args | What it does |
|---|---|---|
| `burst` | `strength` 0–1 | Swell the echo on a transient (~400 ms decaying envelope): lifts every tap toward full so a cloud of ghosts blooms on the beat, then settles back. |
| `clear` | — | Flush the delay line — wipes every stored frame so the tail vanishes instantly and rebuilds from live. A **state-reset** reaction (no decay envelope) — fire on a downbeat to snap the screen clean. |

## Memory

The ring holds ~120 frames (2 s at 60 fps) at `detail` resolution. At 1080p:
`detail` 1.0 ≈ 1 GB, 0.5 ≈ 250 MB, 0.3 ≈ 90 MB. **Default 0.5** is the
sweet spot — ghosts are slightly soft (you rarely notice on a moving echo) for
a quarter of full-res RAM. Drop it on memory-constrained rigs; the only cost
is softer ghosts.

## Running it

Stack `echo` as a filter **above** moving content — same two test layers as
`feedback`:

- **`vibrations`** — the audio-reactive rings make each delayed tap legible;
  bind `peak → echoLevel` for ghosts that swell with the track.
- **`skyline`** — the moving camera leaves a rhythmic ghost train; raise
  `spread` for echoes that fan across the skyline.

## Looks to try

- **Tight slapback:** `delay` ~120 ms, `echoCount` 2, `falloff` ~0.4,
  `spread` 0 — one crisp ghost, like a tape slap.
- **Canyon:** `echoCount` 8, `spread` ~0.8, `echoScale` ~0.9, `falloff` ~0.8 —
  a wall of receding echoes filling the screen. Spin `spreadAngle` to aim it.
- **Ghost train:** `delay` ~200 ms, `echoCount` 4, `falloff` ~0.7, `spread`
  ~0.4 — four echoes marching off to one side.
- **Rainbow canyon:** the Canyon preset plus `hueStep` ~30°, `blend` screen —
  each receding echo a different colour.
- **Beat snap:** bind `burst` to a kick (echo blooms) and `clear` to the
  downbeat (tail wipes clean).

## Tests

`echo-filter.test.js` is a standalone runner (`node
filters/echo/echo-filter.test.js`) covering the DOM-independent logic: param
clamping + tap rounding, the `burst` envelope, the `clear` reset, blend-mode
mapping, audio markers, the no-DOM passthrough, and lifecycle no-throws. The
ring buffer itself is verified visually in a host.
