/**
 * Style descriptor — pure-module tests (no WebGL).
 *
 *   node layers/skyline/lib/style.test.js
 *
 * The descriptor is the workstream-G seam: a future `style` param selects
 * among descriptors. These tests pin the contemporary descriptor's shape
 * and verify its GLSL prelude reproduces the window tints exactly (so the
 * shader output is byte-identical to the pre-seam hardcoded literals).
 */

import assert from 'node:assert';
import { CONTEMPORARY, DEFAULT_STYLE, styleFragGLSL } from './style.js';
import { composeBuildingFrag } from './shaders.js';

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
    process.exitCode = 1;
  }
}

console.log('Skyline style descriptor');

test('contemporary descriptor has the expected shape', () => {
  assert.strictEqual(CONTEMPORARY.name, 'contemporary');
  assert.strictEqual(CONTEMPORARY.palettes.length, 12);
  for (const p of CONTEMPORARY.palettes) assert.strictEqual(p.length, 3);
  for (const key of ['tintWarm', 'tintCool', 'tintGreen', 'tintWhite']) {
    assert.strictEqual(CONTEMPORARY.window[key].length, 3, `window.${key}`);
  }
  assert.deepStrictEqual(CONTEMPORARY.facade.patterns,
    ['mullioned', 'ribbon', 'vertical', 'spandrel']);
  // Massing weights (workstream B).
  const m = CONTEMPORARY.massing;
  assert.ok(m.minHeightFrac > 0 && m.minHeightFrac < 1);
  assert.strictEqual(m.tierShrink.length, 2);
  assert.ok(m.tierShrink[0] <= m.tierShrink[1]);
  assert.strictEqual(m.podiumScale.length, 2);
  assert.ok(m.aspectBias >= 0 && m.aspectBias <= 1);
});

test('DEFAULT_STYLE is the contemporary descriptor', () => {
  assert.strictEqual(DEFAULT_STYLE, CONTEMPORARY);
});

test('styleFragGLSL emits the four tint defines with the contemporary values', () => {
  const glsl = styleFragGLSL();
  // The exact literals the shader used before the seam — reproduced so the
  // injected build is bit-identical.
  assert.match(glsl, /#define STYLE_TINT_WARM\s+vec3\(1\.0000, 0\.7500, 0\.4500\)/);
  assert.match(glsl, /#define STYLE_TINT_COOL\s+vec3\(0\.5500, 0\.6500, 1\.0000\)/);
  assert.match(glsl, /#define STYLE_TINT_GREEN\s+vec3\(0\.7000, 1\.0000, 0\.7000\)/);
  assert.match(glsl, /#define STYLE_TINT_WHITE\s+vec3\(1\.0000, 0\.9500, 0\.8500\)/);
});

test('styleFragGLSL has no leftover template tokens', () => {
  assert.ok(!styleFragGLSL().includes('undefined'));
  assert.ok(!styleFragGLSL().includes('NaN'));
});

test('composeBuildingFrag injects the style prelude and consumes the marker', () => {
  const frag = composeBuildingFrag(styleFragGLSL());
  assert.ok(!frag.includes('//__STYLE__'), 'marker replaced');
  assert.ok(frag.includes('#define STYLE_TINT_WARM'), 'tint defines injected');
  assert.ok(frag.includes('u_patternVariety'), 'pattern uniform present');
  // The style block lands after the precision qualifier (GLSL ES requires
  // precision before first use; defines before it are still valid but we
  // place them after for clarity).
  assert.ok(frag.indexOf('precision mediump float;') < frag.indexOf('#define STYLE_TINT_WARM'));
});

test('composeBuildingFrag with no style still produces valid-ish source', () => {
  const frag = composeBuildingFrag('');
  assert.ok(!frag.includes('//__STYLE__'));
  assert.ok(frag.includes('void main()'));
});

console.log(`\n${passed} passed\n`);
