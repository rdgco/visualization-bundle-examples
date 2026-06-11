# TASK: Compress Comments — visualization-bundle-examples

Strip noise comments from all source files. One PR: `feature/compress-comments`.

## Rubric

**Delete entirely:**
- JSDoc blocks whose only content is `@param {type} name` / `@returns {type}` — no description line
- Inline comments that narrate what the immediately following code obviously does
- Duplicate notes (keep first, delete rest)
- Double section dividers (`// ===...===` followed immediately by another `// ===...===`)
- `// Ignore errors` on a bare `catch` block
- `// CASCADE will handle related tables` and similar SQL-obvious observations



**Keep (load-bearing):**
- These are examples for humans to read therefore some degree of summarization may be useful 
- WHY comments: hidden constraints, past bugs, non-obvious invariants, shader math explanations
- WebGL/GLSL constant rationale, blend mode notes, rendering technique explanations
- Any comment referencing a specific bug, task, or EPIC by name
- Empty catch pattern: if removing `// Ignore errors` from `catch (_e) {}`, replace with `catch (_e) { /* ignore */ }`

**Compress:**
- File-level headers: keep contract/usage notes, trim pure prose
- JSDoc on complex functions: keep description line(s), strip `@param`/`@returns` that only restate the signature

## Files to Process

```
filters/chromatic-aberration/chromatic-aberration-filter.js
filters/chromatic-aberration/lib/chromatic-aberration-shader.js
filters/color-tint/color-tint-filter.js
filters/duotone/duotone-filter.js
filters/duotone/lib/gradient-lut.js
filters/echo/echo-filter.js
filters/edge-detect/edge-detect-filter.js
filters/edge-detect/lib/edges.js
filters/feedback/feedback-filter.js
filters/feedback/lib/feedback-shader.js
filters/frame-diff/frame-diff-filter.js
filters/freeze/freeze-filter.js
filters/glitch/glitch-filter.js
filters/invert/invert-filter.js
filters/long-exposure/long-exposure-filter.js
filters/pixelate/lib/mosaic.js
filters/pixelate/pixelate-filter.js
filters/ripple/lib/ripple-shader.js
filters/ripple/ripple-filter.js
filters/twirl/lib/twirl-shader.js
filters/twirl/twirl-filter.js
filters/vignette/lib/vignette-schema.js
filters/vignette/lib/vignette-shader.js
filters/vignette/vignette-filter.js
layers/skyline/lib/city.js
layers/skyline/lib/geometry.js
layers/skyline/lib/gl-utils.js
layers/skyline/lib/layout.js
layers/skyline/lib/math.js
layers/skyline/lib/shaders.js
layers/skyline/skyline-layer.js
layers/vibrations/vibrations-layer.js
```

## Execution

```bash
# From /Users/ryangrow/Projects/visualization-bundle-examples
git pull --ff-only origin main
git switch -c feature/compress-comments
# ... edit files per rubric ...
npm run lint       # verify clean (if lint script exists)
git add <changed files>
git commit -m "refactor: compress comments"
git push -u origin feature/compress-comments
gh pr create --base main --head feature/compress-comments \
  --title "refactor: compress comments" \
  --body "Strip noise comments per rubric. No logic changes."
```
