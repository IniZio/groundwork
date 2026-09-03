#!/usr/bin/env node
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outfile = resolve(root, 'dist/gw.mjs');
const entrypoint = resolve(root, 'src/gw/cli/main.ts');

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

// Build
console.log('Building dist/gw.mjs...');
execSync(`bun build "${entrypoint}" --target=bun --outfile "${outfile}"`, {
  cwd: root,
  stdio: 'inherit',
});

// Compute source hash over all src/gw/**/*.ts files (sorted for determinism)
const srcDir = resolve(root, 'src/gw');
const srcFiles = collectTsFiles(srcDir).sort();
const hash = createHash('sha256');
for (const f of srcFiles) {
  hash.update(readFileSync(f));
}
const digest = hash.digest('hex');

// Insert hash comment after shebang (if present) so shebang stays on line 1
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
