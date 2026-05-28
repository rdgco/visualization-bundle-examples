#!/usr/bin/env node

/**
 * Run visualization-layer-core's `validateLayer()` against every
 * layer in this bundle, and `validateFilter()` against every filter.
 * Exits with code 1 if any layer or filter fails the contract.
 *
 * Designed for CI (`.github/workflows/ci.yml`) but also runnable
 * locally:
 *
 *   cd .github && npm install
 *   node scripts/validate-bundle.mjs
 *
 * Catches the class of bug that previously slipped through to
 * downstream consumers — the missing-`description` error on skyline
 * was caught at first install in midi-daddy, which is too late.
 * Running the validator at the bundle's own CI fails the PR before
 * the bug ships.
 *
 * Pinning the validators to a specific layer-core version (see
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
const FILTERS_DIR = join(BUNDLE_ROOT, 'filters');

// The validator imports resolve through `.github/package.json`'s
// dependency on visualization-layer-core. The script intentionally
// runs from `.github/` so the resolution uses that package.json.
let validateLayer;
let validateFilter;
try {
  ({ validateLayer } = await import('visualization-layer-core/contract'));
  ({ validateFilter } = await import('visualization-layer-core/filter-contract'));
} catch (err) {
  console.error('[validate-bundle] Cannot import visualization-layer-core validators:');
  console.error(`    ${err.message}`);
  console.error('');
  console.error('In CI, the workflow runs `npm install` inside .github/ before');
  console.error('this script. Locally, run `cd .github && npm install` first.');
  process.exit(2);
}

/**
 * Walk a `<root>/<dirName>/<dirName>-<suffix>.js` tree and run
 * `validator` against each module. Returns `{ total, failed }`.
 * Logs per-entry pass/fail to stdout/stderr in the same shape the
 * layer-only version used to.
 *
 * If the root dir doesn't exist, returns `{ total: 0, failed: 0 }`
 * silently — bundles can ship layers, filters, or both, and a
 * missing kind directory just means "this bundle has none of that
 * kind."
 */
async function validateKind(root, suffix, kindLabel, validator) {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (err) {
    if (err.code === 'ENOENT') return { total: 0, failed: 0 };
    throw err;
  }

  const dirs = entries.filter(e => e.isDirectory());
  if (dirs.length === 0) return { total: 0, failed: 0 };

  let failed = 0;
  for (const entry of dirs) {
    const dirName = entry.name;
    const filePath = join(root, dirName, `${dirName}-${suffix}.js`);

    let mod;
    try {
      mod = await import(pathToFileURL(filePath).href);
    } catch (err) {
      console.error(`✗ ${kindLabel.padEnd(7)} ${dirName.padEnd(20)}  import failed`);
      console.error(`    ${err.message}`);
      failed++;
      continue;
    }

    const { valid, errors } = validator(mod);
    if (!valid) {
      console.error(`✗ ${kindLabel.padEnd(7)} ${dirName.padEnd(20)}  contract violations`);
      for (const e of errors) {
        console.error(`    - ${e}`);
      }
      failed++;
    } else {
      console.log(`✓ ${kindLabel.padEnd(7)} ${dirName.padEnd(20)}  ${mod.label || mod.key}`);
    }
  }

  return { total: dirs.length, failed };
}

const layerResult = await validateKind(LAYERS_DIR, 'layer', 'layer', validateLayer);
const filterResult = await validateKind(FILTERS_DIR, 'filter', 'filter', validateFilter);

const total = layerResult.total + filterResult.total;
const failed = layerResult.failed + filterResult.failed;

if (total === 0) {
  console.log('[validate-bundle] No layer or filter directories found. Nothing to validate.');
  process.exit(0);
}

console.log('');
console.log(`${total - failed}/${total} module${total === 1 ? '' : 's'} valid ` +
  `(layers: ${layerResult.total - layerResult.failed}/${layerResult.total}; ` +
  `filters: ${filterResult.total - filterResult.failed}/${filterResult.total})`);

if (failed > 0) {
  console.error(`${failed} module${failed === 1 ? '' : 's'} failed validation`);
  process.exit(1);
}
