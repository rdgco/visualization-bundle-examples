# frame-diff

Motion detector — **shows only what moved.** A Canvas2D filter that keeps the
previous frame and computes `|current − previous|` per pixel, so moving things
light up and static areas stay dark.

This is the **analytic** member of the temporal family. feedback / echo /
freeze / long-exposure *reshape* motion history (decay / delay / hold /
accumulate); frame-diff *measures* it.

It's the per-pixel sibling of [`edge-detect`](../edge-detect/) — same
getImageData + threshold + glow pattern and `detail` perf lever — but the
retained buffer is the **previous frame** rather than a neighbourhood kernel.

A raw consecutive-frame diff only lights the leading/trailing edge of a moving
thing for a single frame (thin and flickery), so a **`trail`** control persists
the motion map into glowing trails that read on stage.

## What it does

```
source ─► [downscale to detail] ─► |current − previous| ─► threshold + gain (+pulse)
                                                                    │
   store current as next previous ◄─────────                        ▼
                                                          trail (persist motion)
                                                                    │
   ctx ◄── backdrop (black + live·wet/dry) + glow + crisp ◄── motion map (per mode)
```

## Modes

- **motion** — show the motion itself: moving edges glow (in `motionColor`, or
  the moving content's own colour via `colorMode`), static stays dark. The showpiece.
- **reveal** — show the LIVE frame *only where it moved* — a motion-keyed cutout
  over a dimmable backdrop. Moving subjects punch through; still scenery fades.
- **mask** — a hard stencil: opaque (in `motionColor`) where moving, transparent
  where still. Feed it to your eye, or stack it to gate other looks.

## Params

### Detect

| Param | Range | What it does |
|---|---|---|
| `mode` | motion / reveal / mask | See above. Structural — not modulated. |
| `sensitivity` | 0–8 | Gain on detected motion — how strongly a given change lights up. *audio-bindable* |
| `threshold` | 0–1 | Motion floor — changes below this are ignored (kills sensor noise/shimmer in static areas). *audio-bindable* |
| `detail` | 0.2–1 | Resolution the diff runs at (the perf lever — the readback is the cost). Lower = faster + softer. Structural — not modulated. |

### Look

| Param | Range | What it does |
|---|---|---|
| `trail` | 0–0.97 | How long detected motion lingers. 0 = raw one-frame diff (flickery); higher = glowing motion trails that fade. The biggest "reads on stage" knob. *audio-bindable* |
| `colorMode` | solid / source | motion mode: edges in `motionColor`, or in the moving content's own colour. |
| `motionColor` | hex | Colour of the motion (solid mode + the mask stencil). |
| `backgroundOpacity` | 0–1 | Wet/dry — how much of the live frame shows behind the motion. 0 = motion on black; 1 = over the full source. *audio-bindable* |
| `glow` | 0–1 | Additive bloom around the motion. *audio-bindable* |
| `glowSize` | 0–40 px | How far the glow spreads. *audio-bindable* |

## Reactions

| Reaction | Args | What it does |
|---|---|---|
| `pulse` | `strength` 0–1, `duration` 0.05–4 s | Flash the motion — boosts sensitivity, decays back over `duration`. Fire on a beat so all motion flares on the hit. |
| `clear` | — | Reset the stored previous frame + wipe the motion trail — a clean slate. State-reset reaction. |

## Audio

`sensitivity`, `threshold`, `trail`, `backgroundOpacity`, `glow` and `glowSize`
carry the cross-host audio-modulation marker, so a host can drive them from a
live audio level (**peak / sub / bass / mid / high / presence**) — and from
**lfo / random** sources in the platform. The filter never samples audio
itself; the host pushes resolved values via `setModulatedValues()`.

Good starting bindings: **peak → `sensitivity`** (motion blooms on loud hits),
**bass → `trail`** (trails linger on the low end), **mid → `glow`**.

## Running it

Best over content with movement against a steadier background — **video** and
camera layers especially (it's a classic surveillance/motion-cam look), but any
moving layer works.

- **motion**, `trail` ~0.6, `glow` ~0.4 — moving edges glow and leave trails.
- **reveal**, `backgroundOpacity` ~0.15 — the moving subject shows live and
  crisp while the static scene dims into the background.
- A **static** source produces no motion (that's the point) — wave something /
  use a moving layer to see it work.

## Looks to try

- **Motion ghost:** motion mode, `trail` ~0.8, `glow` ~0.6, a bright
  `motionColor` — movement smears into glowing trails.
- **Spotlight the mover:** reveal mode, `backgroundOpacity` ~0.1 — only what
  moves is lit; everything still falls dark.
- **Thermal-cam:** motion mode, `colorMode` source, low `threshold` — the
  moving content shows in its own colour over black.
- **Beat-reactive motion:** bind `sensitivity` to peak and fire `pulse` on a
  kick so every movement flares on the beat.

## Tests

`frame-diff-filter.test.js` is a standalone runner (`node
filters/frame-diff/frame-diff-filter.test.js`) covering the DOM-independent
logic: param clamping + enum/colour parsing, the `motionAmount`
threshold/gain math, the `pulse`/`clear` reactions, audio markers, contiguous
param grouping, the no-DOM passthrough, and lifecycle no-throws. The detected
motion + trails are verified visually in a host.
