#!/usr/bin/env node
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectBundleSourceFiles } from './bundle-hash-inputs.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outfile = resolve(root, 'dist/gw.mjs');
const entrypoint = resolve(root, 'src/gw/cli/main.ts');

console.log('Building dist/gw.mjs...');
execSync(`bun build "${entrypoint}" --target=bun --outfile "${outfile}"`, {
  cwd: root,
  stdio: 'inherit',
});

const hash = createHash('sha256');
for (const f of collectBundleSourceFiles(root)) {
  hash.update(readFileSync(f));
}

const digest = hash.digest('hex');
const existing = readFileSync(outfile, 'utf8');
const lines = existing.split('\n');
let patched;
if (lines[0].startsWith('#!')) {
  patched = `${lines[0]}\n// @bundle-source-hash: ${digest}\n${lines.slice(1).join('\n')}`;
} else {
  patched = `// @bundle-source-hash: ${digest}\n${existing}`;
}
writeFileSync(outfile, patched);

console.log(`dist/gw.mjs built. Source hash: ${digest}`);
