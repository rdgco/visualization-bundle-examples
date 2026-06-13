/**
 * Skyline adapter — config plumbing tests (no WebGL).
 *
 *   node layers/skyline/lib/adapter.test.js
 *
 * configFromParams() translates the harness param surface into the City
 * config. Importing the adapter pulls in city.js + its lib deps, but none
 * touch WebGL at module load — only `new City(gl, ...)` does — so this runs
 * under plain node. Verifies new params are forwarded and that the declared
 * defaults map to classic behavior (patternVariety 0).
 */

import assert from 'node:assert';
import { configFromParams, params } from '../skyline-layer.js';

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

function declaredDefaults() {
  const out = {};
  for (const name of Object.keys(params)) {
    if ('default' in params[name]) out[name] = params[name].default;
  }
  return out;
}

console.log('Skyline adapter — config plumbing');

test('patternVariety is declared, modulatable, and defaults to classic (0)', () => {
  const p = params.patternVariety;
  assert.ok(p, 'param exists');
  assert.strictEqual(p.type, 'number');
  assert.strictEqual(p.default, 0);
  assert.strictEqual(p.min, 0);
  assert.strictEqual(p.max, 1);
  assert.deepStrictEqual(p.modulation, { kind: 'continuous' });
});

test('configFromParams forwards patternVariety', () => {
  const cfg = configFromParams({ ...declaredDefaults(), patternVariety: 0.6 });
  assert.strictEqual(cfg.patternVariety, 0.6);
});

test('declared defaults map to classic flags', () => {
  const cfg = configFromParams(declaredDefaults());
  assert.strictEqual(cfg.patternVariety, 0, 'patternVariety classic');
  assert.strictEqual(cfg.facadeVariety, params.facadeVariety.default);
  // lightColor is the one field whose shape changes: hex string → rgb array.
  assert.ok(Array.isArray(cfg.lightColor) && cfg.lightColor.length === 3);
});

console.log(`\n${passed} passed\n`);
