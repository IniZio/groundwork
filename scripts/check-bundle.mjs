#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outfile = resolve(root, 'dist/gw.mjs');

// 1. Check bundle exists
if (!existsSync(outfile)) {
  console.error('dist/gw.mjs is missing — run `pnpm run build:bundle`');
  process.exit(1);
}

// 2. Extract recorded hash (may be line 1 or line 2 when shebang is present)
const content = readFileSync(outfile, 'utf8');
const hashLine = content.split('\n').find(l => l.startsWith('// @bundle-source-hash:'));
const match = hashLine ? hashLine.match(/^\/\/ @bundle-source-hash: ([0-9a-f]{64})$/) : null;
if (!match) {
  console.error('dist/gw.mjs has no source hash — rebuild with `pnpm run build:bundle`');
  process.exit(1);
}
const recordedHash = match[1];

// 3. Recompute hash over src/gw/**/*.ts (same algorithm as build-bundle.mjs)
function collectTsFiles(dir) {
  const results = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectTsFiles(full));
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      results.push(full);
    }
  }
  return results;
}

const srcDir = resolve(root, 'src/gw');
const srcFiles = collectTsFiles(srcDir).sort();
const hash = createHash('sha256');
for (const f of srcFiles) {
  hash.update(readFileSync(f));
}
const currentHash = hash.digest('hex');

// 4. Compare
if (currentHash === recordedHash) {
  console.log('dist/gw.mjs is fresh.');
  process.exit(0);
} else {
  console.error('dist/gw.mjs is STALE — sources changed since last build. Run `pnpm run build:bundle` to rebuild.');
  process.exit(1);
}
