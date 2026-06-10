# chromatic-aberration

Radial RGB lens dispersion — **colour fringes split toward the edges** like a
cheap wide-angle lens. A WebGL filter that samples the red / green / blue
channels at radially-offset coordinates.

Second of the **GPU-displacement family** (`ripple`, `chromatic-aberration`,
`twirl`) — a stateless spatial warp, no retained buffer. Mirrors `vignette`'s
inline GL bridge.

**Distinct from `glitch`'s `rgb-split` mode** (a uniform horizontal channel
offset): this is *radial* dispersion that scales with distance from the
centre — none in the middle, most at the edges. Tiny `amount` reads as
realistic lens fringing; large reads as a prismatic glitch. The `pulse` reaction
snaps it on a beat — it maps onto transients better than almost anything.

## Params

| Param | Range | What it does |
|---|---|---|
| `amount` | 0–0.15 | Dispersion strength — how far R/B split at the edges. ~0.01 lens-realistic; >0.05 prismatic. The transient knob. *audio-bindable* |
| `power` (Edge Bias) | 0.5–4 | How the split ramps centre→edge. 1 = linear; higher = clear middle, hard fringing at the edges (more lens-like). *audio-bindable* |
| `centerX` / `centerY` | 0–1 | The point the dispersion radiates from. *audio-bindable* |

## Reactions

| Reaction | Args | What it does |
|---|---|---|
| `pulse` | `strength` 0–1 | Snap the split hard on a transient (~350 ms), then settle back to `amount`. Fire on a kick/snare for a prismatic hit. |

## Audio

Every numeric attribute carries the cross-host audio-modulation marker — drive
it from a live level (**peak / sub / bass / mid / high / presence**) or an
**lfo / random** source in the platform. The filter never samples audio itself;
the host pushes resolved values via `setModulatedValues()`.

Good starting bindings: **peak → `amount`** (the lens splits on every hit),
**bass → `power`**, an **lfo → `centerX`** to drift the dispersion centre.

## Looks to try

- **Lens realism:** `amount` ~0.008, `power` ~2.5 — subtle edge fringing.
- **Prismatic hit:** baseline `amount` ~0.01, bind `pulse` to a kick.
- **Full prism:** `amount` ~0.08, `power` 1 — heavy split across the whole frame.
- **Off-axis lens:** move `centerX`/`centerY` off-centre for an asymmetric split.

## Tests

`chromatic-aberration-filter.test.js`
(`node filters/chromatic-aberration/chromatic-aberration-filter.test.js`) covers
the GL-independent logic: param clamping, the `pulse` envelope, audio markers,
contiguous param grouping, the no-WebGL passthrough, and lifecycle no-throws.
The colour split is verified visually in a host.
