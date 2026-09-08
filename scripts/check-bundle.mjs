#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectBundleSourceFiles } from './bundle-hash-inputs.mjs';

const rootArgIdx = process.argv.indexOf('--root');
const root = rootArgIdx !== -1
  ? resolve(process.argv[rootArgIdx + 1])
  : resolve(dirname(fileURLToPath(import.meta.url)), '..');

const outfile = resolve(root, 'dist/gw.mjs');

if (!existsSync(outfile)) {
  console.error('dist/gw.mjs is missing — run `pnpm run build:bundle`');
  process.exit(1);
}

const content = readFileSync(outfile, 'utf8');
const hashLine = content.split('\n').find(l => l.startsWith('// @bundle-source-hash:'));
const match = hashLine ? hashLine.match(/^\/\/ @bundle-source-hash: ([0-9a-f]{64})$/) : null;
if (!match) {
  console.error('dist/gw.mjs has no source hash — rebuild with `pnpm run build:bundle`');
  process.exit(1);
}
const recordedHash = match[1];

const hash = createHash('sha256');
for (const f of collectBundleSourceFiles(root)) {
  hash.update(readFileSync(f));
}
const currentHash = hash.digest('hex');

if (currentHash === recordedHash) {
  console.log('dist/gw.mjs is fresh.');
  process.exit(0);
} else {
  console.error('dist/gw.mjs is STALE — sources changed since last build. Run `pnpm run build:bundle` to rebuild.');
  process.exit(1);
}
