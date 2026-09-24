import fs from 'node:fs';
import path from 'node:path';
import type { Rule } from './types.js';

/**
 * Load rules from a directory.
 * - Scans each subdirectory of rulesDir for index.ts or index.js
 * - Default-imports each file
 * - Throws if rule.id !== the directory basename, naming the offending id and directory
 * Returns all loaded rules.
 */
export async function loadRules(rulesDir: string): Promise<Rule[]> {
  const entries = fs.readdirSync(rulesDir, { withFileTypes: true });
  const subdirs = entries.filter((e) => e.isDirectory()).map((e) => e.name);

  const rules: Rule[] = [];

  for (const name of subdirs) {
    const subdirPath = path.join(rulesDir, name);
    const tsEntry = path.join(subdirPath, 'index.ts');
    const jsEntry = path.join(subdirPath, 'index.js');

    let entryPath: string;
    if (fs.existsSync(tsEntry)) {
      entryPath = tsEntry;
    } else if (fs.existsSync(jsEntry)) {
      entryPath = jsEntry;
    } else {
      continue;
    }

    const mod = await import(entryPath);
    const rule: Rule = mod.default;
    const basename = path.basename(subdirPath);

    if (rule.id !== basename) {
      throw new Error(`Rule id "${rule.id}" does not match directory name "${basename}"`);
    }

    rules.push(rule);
  }

  return rules;
}
