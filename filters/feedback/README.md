# feedback

Temporal feedback post-process — ghost trails, motion echo, and the
classic self-similar **infinite tunnel**. A WebGL filter that retains its
previous output in a GPU texture and blends it back in each frame.

This is the bundle's **canonical multi-frame filter**. Every other filter
here (`invert`, `edge-detect`, `vignette`, `glitch`, …) is a pure function
of the current `sourceCanvas`. `feedback` is the one whose output depends on
*more than the current frame* — it proves that a `visualization-layer-core`
filter can do temporal effects with **no host or contract change**. The host
hands the filter the current frame and a destination context; because the
filter is a long-lived instance, it keeps its own ping-pong textures across
frames and remembers what it drew.

WebGL2 with a WebGL1 fallback (GLSL ES 1.00). Mirrors `vignette`'s inline
GL-bridge pattern.

## What it does

```
                 ┌─────────────────────────── ping-pong ───────────────────────────┐
                 │                                                                   │
source ─► upload ─► [ COMBINE: warp(prev)·persistence·hueRotate  ⊕  source·gain ] ─► accum(write) ─► COPY ─► canvas ─► ctx
                          ▲                                                                │
                          └──────────────── prev = accum(read) ◄────────────── swap ──────┘
```

Each frame, the **combine** pass samples the previous accumulation frame
through a warp transform (zoom / rotate / drift around the centre), fades it
by `trailPersistence`, hue-rotates it, then blends the current frame on top.
Its output becomes next frame's feedback. The **copy** pass shows the result.

The warp is applied to the *texture coordinate used to read the previous
frame*, not to geometry — pulling that coordinate toward the centre makes the
retained image appear to grow every frame, which is what compounds into the
tunnel. A trail that samples outside the frame is masked out, so trails fall
off cleanly at the edges instead of clamp-smearing into streaks.

All time-varying quantities are normalised by real elapsed time, so the look
is frame-rate independent (deg/sec, per-60fps-frame persistence, etc.).

## Params

| Param | Range | What it does |
|---|---|---|
| `trailPersistence` | 0–0.99 | **Trail length.** Fraction of the previous frame surviving per 60fps frame. 0 = passthrough; 0.99 = long, slow-decaying trails. *modulatable* |
| `sourceGain` | 0–2 | How hard the current frame is injected over the trail. <1 lets the trail dominate; >1 over-drives bright sources into bloom. *modulatable* |
| `blend` | screen / add / over | How the current frame combines with the trail. `screen` = glowing, clamped (default); `add` = pure additive (blows out fast); `over` = opaque source over the trail. |
| `feedbackZoom` | 0.9–1.1 | Per-frame scale of the feedback. 1 = none, >1 tunnel toward you, <1 tunnel away. Tiny values read strong because the effect compounds. *modulatable* |
| `feedbackRotate` | -45–45 °/s | Spins the trail into a spiral; pairs with zoom for a rotating tunnel. *modulatable* |
| `feedbackShiftX` / `feedbackShiftY` | ±0.05 | Per-frame drift of the feedback (fraction of width/height). *modulatable* |
| `hueDrift` | -180–180 °/s | Hue rotation of the trail. Compounds over retained frames, so a few °/s cycles the whole spectrum — the psychedelic colour-smear. *modulatable* |

## Reactions

| Reaction | Args | What it does |
|---|---|---|
| `pulse` | `strength` 0–1 | Kicks the feedback on a transient (~450 ms decaying envelope): briefly pushes persistence toward "hold" and adds a zoom impulse, so the trail blooms and lunges forward on the beat, then settles back. Fire on a kick/snare. |

`trailPersistence` is the *continuous baseline* (modulate it for a swell);
`pulse` is the *transient on top* — the same modulate-the-knob /
fire-the-reaction split that `glitch` demonstrates, applied to feedback.

## Running it

Stack `feedback` as a filter **above** moving content and watch the trail
build. Two existing layers in this bundle make good test content:

- **`vibrations`** — its audio-reactive rings pulse and displace, so trails +
  a little `hueDrift` give immediate, legible echo. Best first test.
- **`skyline`** — the moving 3D camera drags long streaks; add `feedbackZoom`
  ~1.01 + `feedbackRotate` for a city dissolving into a rotating tunnel.

Because a filter post-processes the cumulative canvas at its position, place
`feedback` after the content you want to trail. Content drawn *after* it is
left untrailed.

## Looks to try

- **Ghost trails:** `trailPersistence` ~0.9, `blend` screen, zoom/rotate 0.
- **Infinite tunnel:** `feedbackZoom` ~1.02, `feedbackRotate` ~6°/s,
  persistence ~0.95.
- **Acid spiral:** add `hueDrift` ~30°/s and `feedbackRotate` ~20°/s.
- **Beat lunge:** baseline persistence ~0.85, bind `pulse` to a kick.

## Performance

Two full-screen quad draws per frame plus one texture upload — GPU-cheap,
holds 60fps at HD. Memory is two RGBA accumulation textures sized to the
canvas (re-allocated on resize). No `getImageData` readback.

## Tests

`feedback-filter.test.js` is a standalone runner (`node
filters/feedback/feedback-filter.test.js`) covering the GL-independent
logic: param clamping, the `pulse` envelope, blend-mode mapping, the
no-WebGL passthrough, and lifecycle no-throws. The GPU feedback itself is
verified visually in a host.
