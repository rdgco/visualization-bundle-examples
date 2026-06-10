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
| `mix` | 0–1 | How strongly the frozen frame covers live. 1 = fully frozen; <1 = a ghost of the freeze over live motion; 0 = live. *audio-bindable* |

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

`holdTime`, `mix` and `sliceAmount` carry the cross-host audio-modulation
marker, so a host can drive them from a live audio level (**peak / sub / bass /
mid / high / presence**) — and from **lfo / random** sources in the platform.
The filter never samples audio itself; the host pushes resolved values via
`setModulatedValues()`. Harness reads `modulation.kind: 'audio'`; midi-daddy
reads `sourceTypes`/`defaultAmount`.

Good starting bindings: **tempo → `holdTime`** (beat-locked stutter),
**peak → `mix`** (freeze bites harder on hits), **bass → `sliceAmount`** (the
tear opens and closes with the low end).

## Running it

Stack `freeze` as a filter **above** moving content (`vibrations`, `skyline`):

- **stutter** at `holdTime` ~150 ms gives an immediate beat-judder.
- **manual** + `capture` on a hit freezes the frame mid-motion.
- **slice** with `sliceCount` ~12, `sliceAmount` ~0.5 tears the image into
  frozen and live bands.

## Looks to try

- **Beat stutter:** `mode` stutter, bind `holdTime` to tempo, `mix` 1.
- **Freeze on the hit:** `mode` manual, `capture` → snare, `release` → downbeat.
- **Ghost freeze:** `mode` manual, `mix` ~0.5 — the frozen frame hangs as a
  ghost while live motion plays through it.
- **Datamosh tear:** `mode` slice, `sliceCount` ~16, bind `sliceAmount` to peak
  so the tearing surges on transients.

## Tests

`freeze-filter.test.js` is a standalone runner (`node
filters/freeze/freeze-filter.test.js`) covering the DOM-independent logic:
param clamping + rounding + enum validation, the `capture`/`release` reaction
state, the auto-capture window timing (`_dueForCapture`), audio markers,
contiguous param grouping, the no-DOM passthrough, and lifecycle no-throws. The
held overlay + slice tearing are verified visually in a host.
