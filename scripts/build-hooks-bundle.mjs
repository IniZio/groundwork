#!/usr/bin/env node
/**
 * Build committed bundles for hooks that import third-party packages (js-yaml, ajv).
 *
 * Mirrors the approach used by build-bundle.mjs for dist/gw.mjs.
 * Bundles are committed to dist/ so they run with zero node_modules on remote installs.
 * Each bundle embeds a source hash (over all hooks/**\/*.mjs) for freshness checking.
 *
 * Usage:
 *   node scripts/build-hooks-bundle.mjs
 *
 * Or via package.json script:
 *   pnpm run build:hooks-bundle
 */
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
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

// Compute source hash over all hooks/**/*.mjs files (sorted for determinism).
// Using the whole hooks directory is conservative but correct: any change to
// any hook file triggers a rebuild prompt via check:hooks-bundle.
const hooksDir = resolve(root, 'hooks');
const srcFiles = collectMjsFiles(hooksDir).sort();
const hash = createHash('sha256');
for (const f of srcFiles) {
  hash.update(readFileSync(f));
}
const digest = hash.digest('hex');

const bundles = [
  { name: 'hooks-ledger',           entry: 'hooks/ledger.mjs' },
  { name: 'hooks-session-reminder', entry: 'hooks/session-reminder.mjs' },
  { name: 'hooks-spec',             entry: 'hooks/spec.mjs' },
  { name: 'hooks-spec-lint',        entry: 'hooks/spec-lint.mjs' },
];

for (const { name, entry } of bundles) {
  const outfile = resolve(root, `dist/${name}.mjs`);
  const entrypoint = resolve(root, entry);

  console.log(`Building dist/${name}.mjs...`);
  execSync(`bun build "${entrypoint}" --target=bun --outfile "${outfile}"`, {
    cwd: root,
    stdio: 'inherit',
  });

  // Insert hash comment after shebang (if present) so shebang stays on line 1.
  const existing = readFileSync(outfile, 'utf8');
  const lines = existing.split('\n');
  let patched;
  if (lines[0].startsWith('#!')) {
    patched = `${lines[0]}\n// @bundle-source-hash: ${digest}\n${lines.slice(1).join('\n')}`;
  } else {
    patched = `// @bundle-source-hash: ${digest}\n${existing}`;
  }
  writeFileSync(outfile, patched);
  console.log(`dist/${name}.mjs built. Source hash: ${digest}`);
}
