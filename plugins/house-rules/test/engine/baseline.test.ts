import { describe, it, expect } from 'bun:test';
import { writeBaseline, readBaseline, toBaseline, subtractBaseline, fingerprint } from '../../src/engine/baseline.js';
import type { Finding } from '../../src/engine/types.js';
import type { FindingWithSeverity } from '../../src/engine/run.js';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('baseline', () => {
  it('byte-identical double write, sorted, deduplicated', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'hr-baseline-'));
    try {
      const file = join(dir, 'baseline.json');
      const f1: Finding = {
        ruleId: 'no-console',
        path: 'src/b.ts',
        line: 1,
        message: 'no console',
        fingerprintBasis: 'console.log call',
      };
      const f2: Finding = {
        ruleId: 'no-unused',
        path: 'src/a.ts',
        line: 2,
        message: 'unused var',
        fingerprintBasis: 'unused variable x',
      };
      // duplicate of f1
      const f3: Finding = { ...f1, line: 99 };

      await writeBaseline(file, [f1, f2, f3]);
      const first = await readFile(file, 'utf8');
      await writeBaseline(file, [f1, f2, f3]);
      const second = await readFile(file, 'utf8');

      expect(first).toBe(second);

      const parsed = JSON.parse(first);
      const entries: Array<{ rule: string; path: string; fingerprint: string }> = parsed.entries;

      // deduplicated: f1 and f3 share fingerprint (line-independent), so 2 unique entries
      expect(entries.length).toBe(2);

      // sorted by [rule, path, fingerprint]: no-console < no-unused
      expect(entries[0].rule).toBe('no-console');
      expect(entries[1].rule).toBe('no-unused');
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  it('line-independence: same finding with different line has same fingerprint', () => {
    const f1: Finding = {
      ruleId: 'no-console',
      path: 'src/foo.ts',
      line: 5,
      message: 'no console',
      fingerprintBasis: 'console.log call here',
    };
    const f2: Finding = {
      ruleId: 'no-console',
      path: 'src/foo.ts',
      line: 10,
      message: 'no console',
      fingerprintBasis: 'console.log call here',
    };
    expect(fingerprint(f1)).toBe(fingerprint(f2));
  });

  it('subtract removes matching findings but not same violation in another file', async () => {
    const findingA: Finding = {
      ruleId: 'no-console',
      path: 'src/foo.ts',
      line: 1,
      message: 'no console',
      fingerprintBasis: 'some violation',
    };
    const findingB: Finding = {
      ruleId: 'no-console',
      path: 'src/bar.ts',
      line: 1,
      message: 'no console',
      fingerprintBasis: 'some violation',
    };

    const baseline = toBaseline([findingA]);
    const result = subtractBaseline([findingA, findingB], baseline);

    expect(result.length).toBe(1);
    expect(result[0].path).toBe('src/bar.ts');
  });

  it('missing file returns empty baseline; malformed throws with path in message', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'hr-baseline-'));
    try {
      const missingPath = join(dir, 'nonexistent.json');
      const empty = await readBaseline(missingPath);
      expect(empty).toEqual({ version: 1, entries: [] });

      const badPath = join(dir, 'bad.json');
      await writeFile(badPath, 'not json', 'utf8');
      let threw = false;
      let errorMessage = '';
      try {
        await readBaseline(badPath);
      } catch (e) {
        threw = true;
        errorMessage = (e as Error).message;
      }
      expect(threw).toBe(true);
      expect(errorMessage).toContain(badPath);
    } finally {
      await rm(dir, { recursive: true });
    }
  });

  it('fixture round-trips byte-identical', async () => {
    const fixturePath =
      '/home/newman/.local/share/groundwork/plugins/house-rules/test/fixtures/baseline/baseline.json';
    const original = await readFile(fixturePath, 'utf8');
    const parsed = JSON.parse(original);
    const reserialized = JSON.stringify(parsed, null, 2) + '\n';
    expect(reserialized).toBe(original);

    // also verify readBaseline parses it without throwing
    const baseline = await readBaseline(fixturePath);
    expect(baseline.version).toBe(1);
    expect(Array.isArray(baseline.entries)).toBe(true);
    expect(baseline.entries.length).toBe(2);
  });

  it('subtractBaseline preserves FindingWithSeverity type', () => {
    const f1: FindingWithSeverity = { ruleId: 'r1', path: 'a.ts', message: '', fingerprintBasis: 'x', severity: 'error' };
    const f2: FindingWithSeverity = { ruleId: 'r1', path: 'b.ts', message: '', fingerprintBasis: 'x', severity: 'warn' };
    const baseline = toBaseline([f1]);
    const result = subtractBaseline([f1, f2], baseline);
    // Type check: .severity is accessible (would be a tsc error if return type were Finding[])
    expect(result.length).toBe(1);
    expect(result[0].severity).toBe('warn');
  });

  it('readBaseline rejects entry missing fingerprint', async () => {
    // Red before fix: readBaseline accepted entries without a valid fingerprint
    const dir = await mkdtemp(join(tmpdir(), 'hr-baseline-'));
    const badFile = join(dir, 'bad.json');
    try {
      await writeFile(badFile, JSON.stringify({ version: 1, entries: [{ rule: 'x', path: 'y.ts' }] }), 'utf8');
      await expect(readBaseline(badFile)).rejects.toThrow(badFile);
    } finally {
      await rm(dir, { recursive: true });
    }
  });
});
