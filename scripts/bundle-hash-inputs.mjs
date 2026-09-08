import { readdirSync } from 'node:fs';
import { join } from 'node:path';

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

export function collectBundleSourceFiles(root) {
  const tsFiles = collectTsFiles(join(root, 'src', 'gw')).sort();
  const hooksLibDir = join(root, 'hooks', 'lib');
  const mjsFiles = readdirSync(hooksLibDir)
    .filter(f => f.endsWith('.mjs'))
    .sort()
    .map(f => join(hooksLibDir, f));
  return [...tsFiles, ...mjsFiles];
}
