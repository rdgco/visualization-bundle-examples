/**
 * City style descriptors.
 *
 * Workstream-G seam (see the skyline enhancement task): every aesthetic
 * decision for a city *style* — wall palettes, window-light tints,
 * facade pattern set, and (as later workstreams land) massing weights,
 * street visuals, traffic colors, district-field tuning, and horizon
 * tint — is gathered into one descriptor object. Today there is exactly
 * one style: `CONTEMPORARY`. A future `style` enum param selects among
 * descriptors; adding a style ('futuristic sci-fi', spaceport cities)
 * then becomes "author a descriptor + any style-specific shader
 * branches" rather than rewriting the renderer.
 *
 * Division of labor:
 *   - CPU-side values (palettes, massing weights) are read directly by
 *     layout/geometry code.
 *   - Shader-side values are injected into GLSL as a prelude of `#define`s
 *     via `styleFragGLSL()` — the same prepend mechanism `CURVE_GLSL`
 *     already uses. Injecting (rather than uniforms) means a future style
 *     can swap structurally different shader bodies, not just constants,
 *     and costs nothing at draw time.
 *
 * No WebGL or rendering here — pure data + a string builder.
 */

// ============================================================================
// Contemporary — the original "classic" night city. These values are the
// ones previously inlined in layout.js (palette) and the building fragment
// shader (window-light tints); relocating them here is byte-for-byte
// identical output, locked by the classic-layout regression test.
// ============================================================================

export const CONTEMPORARY = {
  name: 'contemporary',

  // Wall-color palette. Dim, desaturated night tones; pickColor() jitters
  // brightness per building on top of these. (Was layout.js PALETTES.)
  palettes: [
    [0.11, 0.12, 0.14], [0.13, 0.13, 0.15], [0.09, 0.10, 0.12],
    [0.15, 0.13, 0.11], [0.14, 0.12, 0.10], [0.09, 0.11, 0.16],
    [0.08, 0.10, 0.14], [0.09, 0.12, 0.11], [0.13, 0.09, 0.08],
    [0.10, 0.10, 0.11], [0.12, 0.11, 0.13], [0.14, 0.14, 0.12]
  ],

  // Window-light tint distribution. The fragment shader picks one of these
  // per lit window by hash; warm is a multiplier on the operator's
  // u_lightColor, the rest are absolute targets. (Were inline vec3s in
  // BUILDING_FRAG.)
  window: {
    tintWarm: [1.0, 0.75, 0.45],   // multiplies u_lightColor
    tintCool: [0.55, 0.65, 1.0],
    tintGreen: [0.7, 1.0, 0.7],
    tintWhite: [1.0, 0.95, 0.85]
  },

  // Facade pattern pool (workstream A). `patternVariety` routes a fraction
  // of building faces into these; the shader branches on a per-face hash.
  // The set is style-defining: a sci-fi style would list light-strip /
  // hex-grid patterns and add the matching shader branches.
  facade: {
    patterns: ['mullioned', 'ribbon', 'vertical', 'spandrel']
  },

  // Massing weights (workstream B). `silhouetteVariety` routes a fraction
  // of mid/tall buildings into richer profiles than the single classic
  // taper. A future style would re-weight these (sci-fi favoring slim
  // setback towers, say) or add new massing types + their segment specs.
  massing: {
    minHeightFrac: 0.30,   // only buildings taller than maxHeight * this are eligible
    setbackWeight: 0.55,   // P(tiered setback) vs ...
    podiumWeight: 0.45,    // ... P(podium + tower); normalized across the two
    tierShrink: [0.60, 0.80],   // per-tier footprint scale range (setbacks)
    podiumScale: [0.42, 0.62],  // tower footprint vs podium (podium+tower)
    aspectBias: 0.35       // P(stretch into a thin slab / square point) at full variety
  },

  // Street level (workstream C). Asphalt / sidewalk / lane-marking colors
  // are injected into the ground fragment shader as #defines; the light
  // and car colors are read at geometry/uniform time. A sci-fi style would
  // swap these for dark glass plazas, cyan light strips, etc.
  street: {
    asphalt: [0.045, 0.045, 0.055],
    sidewalk: [0.14, 0.14, 0.155],
    marking: [0.52, 0.47, 0.30],     // warm faded paint (lane lines)
    crosswalk: [0.58, 0.58, 0.60],
    lightColor: [1.0, 0.84, 0.54],   // warm-white streetlight glow
    carHead: [0.92, 0.94, 1.0],      // headlight white (one travel direction)
    carTail: [1.0, 0.13, 0.06]       // taillight red (the other)
  }
};

// The active style. A future `style` param resolves to one of several
// descriptors; for now everything reads this.
export const DEFAULT_STYLE = CONTEMPORARY;

// ============================================================================
// Shader injection
// ============================================================================

function glslVec3(c) {
  return `vec3(${c[0].toFixed(4)}, ${c[1].toFixed(4)}, ${c[2].toFixed(4)})`;
}

/**
 * Build the GLSL prelude of style constants prepended to a fragment shader
 * (building or ground — see shaders.composeBuildingFrag / composeGroundFrag).
 * A shader only references the macros it needs; the rest are harmless. The
 * contemporary values reproduce the previously-hardcoded literals exactly.
 *
 * @param {object} style  a style descriptor (defaults to CONTEMPORARY)
 * @returns {string} GLSL `#define` lines
 */
export function styleFragGLSL(style = DEFAULT_STYLE) {
  const w = style.window;
  const s = style.street;
  return [
    `#define STYLE_TINT_WARM  ${glslVec3(w.tintWarm)}`,
    `#define STYLE_TINT_COOL  ${glslVec3(w.tintCool)}`,
    `#define STYLE_TINT_GREEN ${glslVec3(w.tintGreen)}`,
    `#define STYLE_TINT_WHITE ${glslVec3(w.tintWhite)}`,
    `#define STREET_ASPHALT   ${glslVec3(s.asphalt)}`,
    `#define STREET_SIDEWALK  ${glslVec3(s.sidewalk)}`,
    `#define STREET_MARKING   ${glslVec3(s.marking)}`,
    `#define STREET_CROSSWALK ${glslVec3(s.crosswalk)}`
  ].join('\n');
}
