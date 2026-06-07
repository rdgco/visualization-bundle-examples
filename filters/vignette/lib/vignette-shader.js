/**
 * Vignette Post-Processing Shader
 *
 * GPU-side vignette renderer that replaces the CSS backdrop-filter approach
 * for WebGL programs. Applies an elliptical vignette with two regions
 * (frame = border, glass = center), each with independent color tint and
 * filter effects (brightness, contrast, saturate, hueRotate).
 *
 * The glass region also supports lens distortion (barrel/pincushion),
 * controlled by a single strength parameter: positive = fisheye/convex
 * magnification, negative = pincushion/concave, zero = off. The warp is
 * saturating (bounded near the rim) and samples that fall outside the
 * scene — under strong lens or zoom < 1 — dissolve into the frame region
 * instead of smearing the texture border into radial streaks.
 *
 * Blur uses a 13-tap Poisson disc approximation — not a true Gaussian, but
 * cheap (single pass, no extra FBOs) and convincing for artistic use.
 * Both frame and glass regions have independent blur controls.
 *
 * The shader samples the scene texture, computes the elliptical mask, applies
 * per-region filters, and blends the result.
 */

// Reuse the same fullscreen quad vertex shader as the fractal blit pass
export const VIGNETTE_VERT = `
  attribute vec2 a_position;
  varying vec2 v_uv;
  void main() {
    v_uv = a_position * 0.5 + 0.5;
    gl_Position = vec4(a_position, 0.0, 1.0);
  }
`;

export const VIGNETTE_FRAG = `
  precision mediump float;

  uniform sampler2D u_scene;
  uniform vec2 u_resolution;

  // Ellipse shape: normalized 0–1 (sizeX/100, sizeY/100)
  uniform float u_sizeX;
  uniform float u_sizeY;
  uniform float u_softness;     // 0–1 (softness/100)

  // Frame region (border) — vec4(r, g, b, opacity)
  uniform vec4 u_frameColor;
  // Frame filters: vec4(brightness, contrast, saturate, hueRotateDeg)
  uniform vec4 u_frameFilters;
  // Frame blur radius in pixels
  uniform float u_frameBlur;

  // Glass region (center) — vec4(r, g, b, opacity)
  uniform vec4 u_glassColor;
  // Glass filters: vec4(brightness, contrast, saturate, hueRotateDeg)
  uniform vec4 u_glassFilters;
  // Glass blur radius in pixels
  uniform float u_glassBlur;

  // Lens distortion: positive = barrel/fisheye, negative = pincushion, 0 = off
  uniform float u_glassLens;
  // Lens power: controls distortion profile (2.0 = standard quadratic)
  // Lower = uniform warp, higher = concentrated at edges with flat center
  uniform float u_glassLensPower;
  // Zoom: >1 magnifies center, <1 shrinks (applied after lens distortion)
  uniform float u_glassZoom;

  varying vec2 v_uv;

  // --- Filter helpers ---

  vec3 applyBrightness(vec3 c, float b) {
    return c * b;
  }

  vec3 applyContrast(vec3 c, float k) {
    return (c - 0.5) * k + 0.5;
  }

  vec3 applySaturate(vec3 c, float s) {
    float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
    return mix(vec3(luma), c, s);
  }

  // Hue rotation in RGB space (Rodrigues' rotation around the (1,1,1) axis)
  vec3 applyHueRotate(vec3 c, float degrees) {
    if (abs(degrees) < 0.5) return c;
    float rad = degrees * 3.14159265 / 180.0;
    float cosA = cos(rad);
    float sinA = sin(rad);
    // Rotation matrix around (1,1,1)/sqrt(3)
    float k = (1.0 - cosA) / 3.0;
    float s = sinA * 0.57735026;  // sin / sqrt(3)
    mat3 m = mat3(
      cosA + k,  k - s,      k + s,
      k + s,     cosA + k,   k - s,
      k - s,     k + s,      cosA + k
    );
    return m * c;
  }

  vec3 applyFilters(vec3 c, vec4 filters) {
    float brightness = filters.x;
    float contrast   = filters.y;
    float saturate   = filters.z;
    float hueRotate  = filters.w;

    c = applyBrightness(c, brightness);
    c = applyContrast(c, contrast);
    c = applySaturate(c, saturate);
    c = applyHueRotate(c, hueRotate);
    return clamp(c, 0.0, 1.0);
  }

  // --- Lens distortion ---
  // Barrel/pincushion distortion within the glass ellipse.
  // Operates in ellipse-normalized space so the warp respects the
  // vignette shape rather than assuming a circular viewport.
  //
  // The warp is *saturating*: the previous profile (1 + strength*r^power)
  // grew without bound near the rim, so strong lens / high lensPower
  // values blew up the edge and read as broken. Here the radial gain is
  // passed through k / (1 + |k|), which tends to ±1 as |k| grows, so the
  // warp factor is bounded in [0, 2] no matter how hard the params are
  // pushed (or modulated). The whole declared range stays usable.
  //
  // The returned UV is deliberately NOT clamped — the caller detects when
  // it leaves [0,1] and fades gracefully instead of smearing a border
  // texel into radial streaks.
  vec2 applyLensDistortion(vec2 uv, float strength, float power) {
    vec2 center = vec2(0.5);
    vec2 offset = uv - center;
    // Normalize into ellipse space so r=1 at the ellipse boundary
    vec2 ellipseNorm = offset / vec2(max(u_sizeX, 0.001), max(u_sizeY, 0.001));
    // Inside the glass r <= ~1; beyond that the pixel is frame and is
    // masked out, so clamping the shaping term keeps it well-behaved.
    float r = clamp(length(ellipseNorm), 0.0, 1.0);
    // Variable exponent shapes where the bend concentrates:
    // low power = near-uniform warp, high power = flat center / sharp rim.
    float rPow = pow(r, max(power, 0.1));
    // Saturating radial gain. strength > 0 pushes the sample outward
    // (content compresses toward center), strength < 0 pulls inward —
    // same sign convention as before, but bounded.
    float k = strength * rPow;
    float warp = 1.0 + k / (1.0 + abs(k));
    return center + offset * warp;
  }

  // --- Blur: 13-tap Poisson disc ---
  // Cheap approximation — samples in a scattered disc pattern to avoid
  // grid artifacts. Not a real Gaussian, but convincing for artistic use.
  vec3 sampleBlurred(vec2 center, float radiusPx) {
    vec2 texel = vec2(1.0) / u_resolution;
    vec2 r = texel * radiusPx;

    // 13-tap Poisson disc: center + 12 points at varied angles and radii
    vec3 acc = texture2D(u_scene, clamp(center, 0.0, 1.0)).rgb;
    acc += texture2D(u_scene, clamp(center + r * vec2( 0.000,  1.000), 0.0, 1.0)).rgb;
    acc += texture2D(u_scene, clamp(center + r * vec2( 0.866, -0.500), 0.0, 1.0)).rgb;
    acc += texture2D(u_scene, clamp(center + r * vec2(-0.866, -0.500), 0.0, 1.0)).rgb;
    acc += texture2D(u_scene, clamp(center + r * vec2( 0.500,  0.866), 0.0, 1.0)).rgb;
    acc += texture2D(u_scene, clamp(center + r * vec2(-0.500,  0.866), 0.0, 1.0)).rgb;
    acc += texture2D(u_scene, clamp(center + r * vec2( 0.951,  0.309), 0.0, 1.0)).rgb;
    acc += texture2D(u_scene, clamp(center + r * vec2(-0.951,  0.309), 0.0, 1.0)).rgb;
    acc += texture2D(u_scene, clamp(center + r * vec2( 0.588, -0.809), 0.0, 1.0)).rgb;
    acc += texture2D(u_scene, clamp(center + r * vec2(-0.588, -0.809), 0.0, 1.0)).rgb;
    // Inner ring (smaller radius) for smoother falloff
    acc += texture2D(u_scene, clamp(center + r * 0.5 * vec2( 0.309,  0.951), 0.0, 1.0)).rgb;
    acc += texture2D(u_scene, clamp(center + r * 0.5 * vec2(-0.309, -0.951), 0.0, 1.0)).rgb;
    acc += texture2D(u_scene, clamp(center + r * 0.5 * vec2( 0.809,  0.588), 0.0, 1.0)).rgb;

    return acc / 13.0;
  }

  void main() {
    // Elliptical distance from center.
    // sizeX/sizeY are in viewport-percentage units (0–1).
    // A pixel at the edge of the ellipse has dist = 1.0.
    vec2 centered = v_uv - 0.5;
    float dx = centered.x / max(u_sizeX, 0.001);
    float dy = centered.y / max(u_sizeY, 0.001);
    float dist = length(vec2(dx, dy));

    // Mask: 0 = glass (center), 1 = frame (border)
    float fadeEnd = 1.0;
    float fadeStart = 1.0 - u_softness;
    float mask = smoothstep(fadeStart, fadeEnd, dist);

    // --- Frame scene sample (original UV, optionally blurred) ---
    vec3 frameScene;
    if (u_frameBlur > 0.5) {
      frameScene = sampleBlurred(v_uv, u_frameBlur);
    } else {
      frameScene = texture2D(u_scene, v_uv).rgb;
    }

    // --- Glass scene sample (lens-distorted UV, then zoomed, optionally blurred) ---
    // glassUV is kept UNCLAMPED through lens + zoom so we can tell when a
    // sample lands outside the scene. There is no content beyond [0,1] (the
    // texture only holds what was rendered inside the canvas), so a hard
    // clamp would pin whole rows/columns to the border texel — the radial
    // streaks seen at zoom < 1 or strong lens. Instead we measure the escape
    // and dissolve the glass into the frame region over a soft band.
    vec2 glassUV = v_uv;
    if (abs(u_glassLens) > 0.001) {
      glassUV = applyLensDistortion(v_uv, u_glassLens, u_glassLensPower);
    }
    // Zoom: scale UV around center after lens distortion
    // >1 magnifies (zooms in), <1 shrinks (zooms out)
    if (abs(u_glassZoom - 1.0) > 0.001) {
      glassUV = 0.5 + (glassUV - 0.5) / u_glassZoom;
    }

    // How far did the sample escape [0,1]? 0 inside, grows past the edge.
    vec2 oob2 = max(-glassUV, glassUV - 1.0);
    float oob = max(max(oob2.x, oob2.y), 0.0);
    // Soft dissolve over ~6% of UV space — glass fades to frame instead of
    // smearing. Keeps the lens rim graceful across the whole zoom/lens range.
    float glassEscape = smoothstep(0.0, 0.06, oob);

    // Sample at a valid (clamped) coord; the escape fade hides any residual
    // border value by blending toward the in-bounds frame result below.
    vec2 glassSampleUV = clamp(glassUV, 0.0, 1.0);
    vec3 glassScene;
    if (u_glassBlur > 0.5) {
      glassScene = sampleBlurred(glassSampleUV, u_glassBlur);
    } else {
      glassScene = texture2D(u_scene, glassSampleUV).rgb;
    }

    // Apply filters to scene color for each region
    vec3 glassFiltered = applyFilters(glassScene, u_glassFilters);
    vec3 frameFiltered = applyFilters(frameScene, u_frameFilters);

    // Apply color tints (premultiplied alpha blend over filtered scene)
    vec3 glassTinted = mix(glassFiltered, u_glassColor.rgb, u_glassColor.a);
    vec3 frameTinted = mix(frameFiltered, u_frameColor.rgb, u_frameColor.a);

    // Where the lens sample escaped the scene, dissolve glass → frame so the
    // out-of-bounds region inherits the frame treatment (vignette darkening
    // by default) rather than streaking.
    vec3 glassRegion = mix(glassTinted, frameTinted, glassEscape);

    // Blend glass and frame using the elliptical mask
    vec3 result = mix(glassRegion, frameTinted, mask);

    gl_FragColor = vec4(result, 1.0);
  }
`;
