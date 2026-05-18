#!/usr/bin/env node

/**
 * Run visualization-layer-core's `validateLayer()` against every
 * layer in this bundle. Exits with code 1 if any layer fails the
 * contract.
 *
 * Designed for CI (`.github/workflows/ci.yml`) but also runnable
 * locally:
 *
 *   cd .github && npm install
 *   node scripts/validate-bundle.mjs
 *
 * Catches the class of bug that previously slipped through to
 * downstream consumers — the missing-`description` error on
 * skyline was caught at first install in midi-daddy, which is
 * too late. Running the validator at the bundle's own CI fails
 * the PR before the bug ships.
 *
 * Pinning the validator to a specific layer-core version (see
 * `.github/package.json`) keeps the CI result deterministic.
 * Bundle authors bump that pin deliberately when the contract
 * evolves.
 */

import { readdir } from 'fs/promises';
import { resolve, dirname, join } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BUNDLE_ROOT = resolve(__dirname, '..', '..');
const LAYERS_DIR = join(BUNDLE_ROOT, 'layers');

// The validator import resolves through `.github/package.json`'s
// dependency on visualization-layer-core. The script intentionally
// runs from `.github/` so the resolution uses that package.json.
let validateLayer;
try {
  ({ validateLayer } = await import('visualization-layer-core/contract'));
} catch (err) {
  console.error('[validate-bundle] Cannot import visualization-layer-core/contract:');
  console.error(`    ${err.message}`);
  console.error('');
  console.error('In CI, the workflow runs `npm install` inside .github/ before');
  console.error('this script. Locally, run `cd .github && npm install` first.');
  process.exit(2);
}

let entries;
try {
  entries = await readdir(LAYERS_DIR, { withFileTypes: true });
} catch (err) {
  if (err.code === 'ENOENT') {
    console.error(`[validate-bundle] layers/ does not exist at ${LAYERS_DIR}`);
    process.exit(2);
  }
  throw err;
}

const layerDirs = entries.filter(e => e.isDirectory());
if (layerDirs.length === 0) {
  console.log('[validate-bundle] No layer directories found under layers/. Nothing to validate.');
  process.exit(0);
}

let failed = 0;
const total = layerDirs.length;

for (const entry of layerDirs) {
  const dirName = entry.name;
  const filePath = join(LAYERS_DIR, dirName, `${dirName}-layer.js`);

  let mod;
  try {
    mod = await import(pathToFileURL(filePath).href);
  } catch (err) {
    console.error(`✗ ${dirName.padEnd(20)}  import failed`);
    console.error(`    ${err.message}`);
    failed++;
    continue;
  }

  const { valid, errors } = validateLayer(mod);
  if (!valid) {
    console.error(`✗ ${dirName.padEnd(20)}  contract violations`);
    for (const e of errors) {
      console.error(`    - ${e}`);
    }
    failed++;
  } else {
    console.log(`✓ ${dirName.padEnd(20)}  ${mod.label || mod.key}`);
  }
}

console.log('');
console.log(`${total - failed}/${total} layers valid`);

if (failed > 0) {
  console.error(`${failed} layer${failed === 1 ? '' : 's'} failed validation`);
  process.exit(1);
}
