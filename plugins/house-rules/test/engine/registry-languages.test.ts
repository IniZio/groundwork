import { describe, it, expect, afterEach } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadRules } from '../../src/engine/registry.js';

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'hr-reg-lang-'));
  tempDirs.push(dir);
  return dir;
}

function writeRule(rulesDir: string, id: string, src: string): void {
  const subdir = join(rulesDir, id);
  mkdirSync(subdir, { recursive: true });
  writeFileSync(join(subdir, 'index.ts'), src, 'utf8');
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('loadRules language validation', () => {
  it('rejects a rule with an unknown language', async () => {
    const dir = makeTempDir();
    writeRule(dir, 'bad-rule', `
export default {
  id: 'bad-rule',
  meta: { description: 'x' },
  languages: ['scala'],
  check: () => [],
};
`);
    await expect(loadRules(dir)).rejects.toThrow(/bad-rule/);
    await expect(loadRules(dir)).rejects.toThrow(/scala/);
  });

  it('loads a rule with known languages and exposes them', async () => {
    const dir = makeTempDir();
    writeRule(dir, 'good-rule', `
export default {
  id: 'good-rule',
  meta: { description: 'reads go and ts' },
  languages: ['go', 'typescript'],
  check: () => [],
};
`);
    const rules = await loadRules(dir);
    expect(rules).toHaveLength(1);
    expect(rules[0].languages).toEqual(['go', 'typescript']);
  });

  it('loads a rule with no languages field', async () => {
    const dir = makeTempDir();
    writeRule(dir, 'no-lang-rule', `
export default {
  id: 'no-lang-rule',
  meta: { description: 'no langs' },
  check: () => [],
};
`);
    const rules = await loadRules(dir);
    expect(rules).toHaveLength(1);
    expect(rules[0].languages).toBeUndefined();
  });
});
