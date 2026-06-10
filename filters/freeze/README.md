# freeze

Sample-and-hold / stutter — **capture a frame and hold it.** A Canvas2D filter
that freezes time instead of accumulating it.

This is the bundle's third temporal filter and the conceptual complement to
[`feedback`](../feedback/) and [`echo`](../echo/). Those two *add* motion
history; `freeze` *removes* motion. Together they cover the three temporal
operators:

| filter | operator | buffer | reaction shape it introduces |
|---|---|---|---|
| `feedback` | **decay** (a smear that fades) | 1 GPU accumulator | decaying envelope (`pulse`) |
| `echo` | **delay** (repeats a beat later) | ring buffer | latch toggle (`reverse`), state-reset (`clear`) |
| `freeze` | **hold** (stops time) | 1 held frame | **capture / grab** (`capture` + `release`) |

That last column is the point: `capture` is the snapshot-grab reaction the
other filters didn't have. Pure Canvas2D — a freeze is a copy-and-hold, no
per-pixel math, so no WebGL and no ring. One held frame (~one canvas), trivial
memory.

## Modes

- **manual** — live until you fire `capture`; the grabbed frame then holds
  (over `mix`) until `release`. The performance / freeze-on-a-hit mode.
- **stutter** — auto: re-grab every `holdTime` ms and hold, so motion judders
  forward in chunks. Bind `holdTime` to tempo for a beat-synced stutter.
  *(Default mode, so the filter does something visible on load.)*
- **slice** — like stutter, but only a random subset of bands freeze each
  window (the rest stay live) — a torn, datamosh look.

Timing is wall-clock, so the stutter rate is frame-rate independent.

## Params

### Freeze

| Param | Range | What it does |
|---|---|---|
| `mode` | manual / stutter / slice | See above. Structural — not modulated. |
| `holdTime` | 20–2000 ms | stutter / slice: how long each captured frame holds before re-grabbing. Short = fast judder; long = chunky freeze. Bind to tempo. *audio-bindable* |
| `dry` | 0–1 | Opacity of the live / original — **always active, every mode**. Fade it to dissolve the original while the freeze holds. The reliable audio target. *audio-bindable* |
| `wet` | 0–1 | Opacity of the frozen frame where it shows. Tuned independently of `dry`, so you can crossfade live against frozen. *audio-bindable* |

### Fade — how the frozen frame leaves after a freeze

After each freeze the frozen frame fades away. In **manual** mode it fades over
the full `fadeTime` after you `capture` (freeze, then it dissolves back to
live). In **stutter / slice** the fade is **capped to the hold window** so each
held frame fully fades before the next grab — otherwise a long `fadeTime`
re-grabs before fading and you'd see no fade at all.

| Param | Range | What it does |
|---|---|---|
| `fade` | off / smooth / flicker / dissolve | off = stays (hard freeze); smooth = fades to absence; flicker = blinks out, increasingly off; dissolve = blurs + fades into an ethereal cloud. **Default smooth.** |
| `fadeTime` | 50–5000 ms | How long the fade takes after a freeze (ignored for `off`). Full duration in manual; capped to `holdTime` in stutter / slice. *audio-bindable* |
| `flickerRate` | 1–30 Hz | flicker mode: how fast it blinks as it goes. *audio-bindable* |

### Slice (slice mode only)

| Param | Range | What it does |
|---|---|---|
| `sliceCount` | 2–32 | How many bands to divide the frame into. More = finer tearing. Structural — not modulated. |
| `sliceAmount` | 0–1 | Fraction of bands that freeze each window (rest stay live). 0 = all live; 1 = all frozen (= stutter). The torn-ness knob. *audio-bindable* |
| `sliceAxis` | horizontal / vertical | Band orientation. |

## Reactions

| Reaction | Args | What it does |
|---|---|---|
| `capture` | — | Grab the current frame and hold it. In **manual** mode this freezes the screen until `release`; in **stutter / slice** it re-syncs the window to now (re-grab on the beat). The snapshot-grab reaction. |
| `release` | — | Resume live in manual mode (unfreeze). No-op in the auto modes. |

The classic move: `mode` manual, bind `capture` to a snare and `release` to the
next downbeat — the image freezes on the hit and snaps back to live.

## Audio

`holdTime`, `dry`, `wet`, `fadeTime`, `flickerRate` and `sliceAmount` carry the
cross-host audio-modulation marker, so a host can drive them from a live audio
level (**peak / sub / bass / mid / high / presence**) — and from **lfo /
random** sources in the platform. The filter never samples audio itself; the
host pushes resolved values via `setModulatedValues()`. Harness reads
`modulation.kind: 'audio'`; midi-daddy reads `sourceTypes`/`defaultAmount`.

> **Not seeing audio do anything?** Two gotchas. (1) Most knobs are
> **mode-specific** — `holdTime` only matters in stutter/slice, `wet` only when
> something is frozen, `sliceAmount` only in slice. In **manual mode with
> nothing captured the filter is a passthrough**, so bindings have nothing to
> act on. (2) A base value at the rail has no headroom — `wet`/`dry` default to
> 1, so a *positive* binding is clamped; bind **bipolar**, or lower the base.
> **`dry` is the always-active target**: it works in every mode whether or not
> anything is frozen — bind a level there first to confirm audio is flowing.

Good starting bindings: **tempo → `holdTime`** (beat-locked stutter),
**peak → `dry`** (the original dims on hits while the freeze hangs),
**bass → `sliceAmount`** (the tear opens and closes with the low end).

## Running it

Stack `freeze` as a filter **above** moving content (`vibrations`, `skyline`):

- **stutter** at `holdTime` ~150 ms gives an immediate beat-judder.
- **manual** + `capture` on a hit freezes the frame mid-motion.
- **slice** with `sliceCount` ~12, `sliceAmount` ~0.5 tears the image into
  frozen and live bands.

## Looks to try

- **Beat stutter:** `mode` stutter, bind `holdTime` to tempo, `mix` 1.
- **Freeze on the hit:** `mode` manual, `capture` → snare, `release` → downbeat.
- **Ghost freeze:** `mode` manual, `wet` ~0.5 — the frozen frame hangs as a
  ghost while live motion plays through it.
- **Freeze-and-fade:** `mode` manual, `capture` on a hit, `fade` smooth,
  `fadeTime` ~1500 — the frame freezes then melts to absence over 1.5 s.
- **Flicker-out:** `fade` flicker, `flickerRate` ~16 — the freeze strobes away
  into nothing.
- **Ethereal dissolve:** `fade` dissolve — the frozen frame blurs into a soft
  cloud as it fades. Pair with `dry` < 1 to thin the live too.
- **Breathing stutter:** `mode` stutter, `fade` smooth — each held frame fades
  out within its window before the next is grabbed (the default look).
- **Datamosh tear:** `mode` slice, `sliceCount` ~16, bind `sliceAmount` to peak
  so the tearing surges on transients.

## Tests

`freeze-filter.test.js` is a standalone runner (`node
filters/freeze/freeze-filter.test.js`) covering the DOM-independent logic:
param clamping + rounding + enum validation, the `capture`/`release` reaction
state, the auto-capture window timing (`_dueForCapture`), audio markers,
contiguous param grouping, the no-DOM passthrough, and lifecycle no-throws. The
held overlay + slice tearing are verified visually in a host.
