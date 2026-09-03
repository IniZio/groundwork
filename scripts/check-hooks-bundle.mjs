#!/usr/bin/env node
/**
 * Freshness guard for the committed hooks bundles (dist/hooks-ledger.mjs,
 * dist/hooks-session-reminder.mjs, dist/hooks-spec.mjs, dist/hooks-spec-lint.mjs).
 *
 * Mirrors check-bundle.mjs for dist/gw.mjs. Exits 1 if any bundle is missing
 * or its embedded source hash does not match the current hooks/**\/*.mjs files.
 *
 * Usage:
 *   node scripts/check-hooks-bundle.mjs
 *
 * Or via package.json script:
 *   pnpm run check:hooks-bundle
 */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function collectMjsFiles(dir) {
  const results = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectMjsFiles(full));
    } else if (entry.isFile() && entry.name.endsWith('.mjs')) {
      results.push(full);
    }
  }
  return results;
}

// Recompute hash over all hooks/**/*.mjs files — same algorithm as build-hooks-bundle.mjs.
const hooksDir = resolve(root, 'hooks');
const srcFiles = collectMjsFiles(hooksDir).sort();
const hash = createHash('sha256');
for (const f of srcFiles) {
  hash.update(readFileSync(f));
}
const currentHash = hash.digest('hex');

let allFresh = true;

for (const name of ['hooks-ledger', 'hooks-session-reminder', 'hooks-spec', 'hooks-spec-lint']) {
  const outfile = resolve(root, `dist/${name}.mjs`);

  // 1. Check bundle exists.
  if (!existsSync(outfile)) {
    console.error(`dist/${name}.mjs is missing — run \`pnpm run build:hooks-bundle\``);
    allFresh = false;
    continue;
  }

  // 2. Extract recorded hash (may be line 1 or line 2 when shebang is present).
  const content = readFileSync(outfile, 'utf8');
  const hashLine = content.split('\n').find(l => l.startsWith('// @bundle-source-hash:'));
  const match = hashLine ? hashLine.match(/^\/\/ @bundle-source-hash: ([0-9a-f]{64})$/) : null;
  if (!match) {
    console.error(`dist/${name}.mjs has no source hash — rebuild with \`pnpm run build:hooks-bundle\``);
    allFresh = false;
    continue;
  }
  const recordedHash = match[1];

  // 3. Compare.
  if (recordedHash === currentHash) {
    console.log(`dist/${name}.mjs is fresh.`);
  } else {
    console.error(`dist/${name}.mjs is STALE — sources changed since last build. Run \`pnpm run build:hooks-bundle\` to rebuild.`);
    allFresh = false;
  }
}

process.exit(allFresh ? 0 : 1);
