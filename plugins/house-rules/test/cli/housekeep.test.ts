import { describe, test, expect, afterEach } from 'bun:test';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { runHousekeep } from '../../src/cli/housekeep.js';
import { fingerprint } from '../../src/engine/baseline.js';
import type { Finding } from '../../src/engine/types.js';

function makeTempRepo(): string {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'housekeep-test-'));
  spawnSync('git', ['init', tmpDir], { encoding: 'utf8' });
  spawnSync('git', ['-C', tmpDir, 'config', 'user.email', 'test@example.com'], { encoding: 'utf8' });
  spawnSync('git', ['-C', tmpDir, 'config', 'user.name', 'Test User'], { encoding: 'utf8' });
  return tmpDir;
}

function makeStubRulesDir(): { rulesDir: string; policy: Record<string, { severity: string; autofix: boolean }> } {
  const rulesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stub-rules-'));

  const fixableDir = path.join(rulesDir, 'stub-fixable');
  fs.mkdirSync(fixableDir, { recursive: true });
  fs.writeFileSync(path.join(fixableDir, 'index.js'), `
import fs from 'node:fs';
import path from 'node:path';

const rule = {
  id: 'stub-fixable',
  meta: { description: 'stub fixable rule' },
  vehicles: ['diff'],
  check(ctx) {
    const findings = [];
    for (const f of (ctx.files ?? [])) {
      if (f.text && f.text.includes('FIX_ME')) {
        findings.push({ ruleId: 'stub-fixable', path: f.path, message: 'contains FIX_ME', fingerprintBasis: f.path });
      }
    }
    return findings;
  },
  async fix(ctx) {
    let fixed = 0;
    for (const f of (ctx.files ?? [])) {
      if (f.text && f.text.includes('FIX_ME')) {
        const newText = f.text.replace(/FIX_ME/g, 'FIXED');
        fs.writeFileSync(path.join(ctx.repoRoot, f.path), newText, 'utf8');
        fixed++;
      }
    }
    return { fixed, skipped: 0 };
  }
};

export default rule;
`, 'utf8');

  const nonfixableDir = path.join(rulesDir, 'stub-nonfixable');
  fs.mkdirSync(nonfixableDir, { recursive: true });
  fs.writeFileSync(path.join(nonfixableDir, 'index.js'), `
const rule = {
  id: 'stub-nonfixable',
  meta: { description: 'stub non-fixable rule' },
  vehicles: ['diff'],
  check(ctx) {
    const findings = [];
    for (const f of (ctx.files ?? [])) {
      if (f.text && f.text.includes('NO_FIX')) {
        findings.push({ ruleId: 'stub-nonfixable', path: f.path, message: 'contains NO_FIX', fingerprintBasis: f.path });
      }
    }
    return findings;
  },
};

export default rule;
`, 'utf8');

  const policy = {
    'stub-fixable': { severity: 'error', autofix: true },
    'stub-nonfixable': { severity: 'error', autofix: false },
  };

  return { rulesDir, policy };
}

function captureRunHousekeep(opts: Parameters<typeof runHousekeep>[0]): Promise<string> {
  return new Promise(async (resolve) => {
    let output = '';
    const origWrite = process.stdout.write.bind(process.stdout);
    const origExit = process.exit.bind(process);

    process.stdout.write = (chunk: string | Uint8Array) => {
      output += typeof chunk === 'string' ? chunk : chunk.toString();
      return true;
    };

    // Override process.exit so it doesn't actually exit
    (process as unknown as Record<string, unknown>).exit = (code?: number) => {
      process.stdout.write = origWrite;
      (process as unknown as Record<string, unknown>).exit = origExit;
      resolve(output);
    };

    try {
      await runHousekeep(opts);
    } catch {
      process.stdout.write = origWrite;
      (process as unknown as Record<string, unknown>).exit = origExit;
      resolve(output);
    }
  });
}

describe('housekeep', () => {
  let tmpRepos: string[] = [];

  afterEach(() => {
    for (const dir of tmpRepos) {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {}
    }
    tmpRepos = [];
  });

  test('fixes fixable finding, lists unfixable', async () => {
    const repoDir = makeTempRepo();
    tmpRepos.push(repoDir);
    const { rulesDir, policy } = makeStubRulesDir();
    tmpRepos.push(rulesDir);

    // Create initial empty commit
    spawnSync('git', ['-C', repoDir, 'commit', '--allow-empty', '-m', 'init'], { encoding: 'utf8' });
    const baseSha = spawnSync('git', ['-C', repoDir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim();

    // Write files
    fs.writeFileSync(path.join(repoDir, 'fixable.ts'), 'const x = "FIX_ME";\n', 'utf8');
    fs.writeFileSync(path.join(repoDir, 'nonfixable.ts'), 'const y = "NO_FIX";\n', 'utf8');

    // Commit them
    spawnSync('git', ['-C', repoDir, 'add', 'fixable.ts', 'nonfixable.ts'], { encoding: 'utf8' });
    spawnSync('git', ['-C', repoDir, 'commit', '-m', 'add files'], { encoding: 'utf8' });

    const output = await captureRunHousekeep({
      repo: repoDir,
      rulesDir,
      policy,
      since: baseSha,
    });

    const fixableContent = fs.readFileSync(path.join(repoDir, 'fixable.ts'), 'utf8');
    expect(fixableContent).not.toContain('FIX_ME');
    expect(fixableContent).toContain('FIXED');

    expect(output).toContain('Fixed (1)');
    expect(output).toContain('Needs manual fix (1)');
    expect(output).toContain('1 fixed, 1 need manual fix');
  });

  test('--max 1 with 2 fixable findings fixes exactly 1', async () => {
    const repoDir = makeTempRepo();
    tmpRepos.push(repoDir);
    const { rulesDir, policy } = makeStubRulesDir();
    tmpRepos.push(rulesDir);

    spawnSync('git', ['-C', repoDir, 'commit', '--allow-empty', '-m', 'init'], { encoding: 'utf8' });
    const baseSha = spawnSync('git', ['-C', repoDir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim();

    fs.writeFileSync(path.join(repoDir, 'a.ts'), 'const a = "FIX_ME";\n', 'utf8');
    fs.writeFileSync(path.join(repoDir, 'b.ts'), 'const b = "FIX_ME";\n', 'utf8');
    spawnSync('git', ['-C', repoDir, 'add', 'a.ts', 'b.ts'], { encoding: 'utf8' });
    spawnSync('git', ['-C', repoDir, 'commit', '-m', 'add files'], { encoding: 'utf8' });

    const output = await captureRunHousekeep({
      repo: repoDir,
      rulesDir,
      policy,
      since: baseSha,
      max: 1,
    });

    const aContent = fs.readFileSync(path.join(repoDir, 'a.ts'), 'utf8');
    const bContent = fs.readFileSync(path.join(repoDir, 'b.ts'), 'utf8');
    const fixedCount = [aContent, bContent].filter(c => !c.includes('FIX_ME')).length;
    const unfixedCount = [aContent, bContent].filter(c => c.includes('FIX_ME')).length;

    expect(fixedCount).toBe(1);
    expect(unfixedCount).toBe(1);
    expect(output).toContain('1 fixed');
    expect(output).toContain('1 need manual fix');
  });

  test('--baseline fixes baselined entries and prunes them', async () => {
    const repoDir = makeTempRepo();
    tmpRepos.push(repoDir);
    const { rulesDir, policy } = makeStubRulesDir();
    tmpRepos.push(rulesDir);

    spawnSync('git', ['-C', repoDir, 'commit', '--allow-empty', '-m', 'init'], { encoding: 'utf8' });

    // Two files both with FIX_ME
    fs.writeFileSync(path.join(repoDir, 'baselined.ts'), 'const a = "FIX_ME";\n', 'utf8');
    fs.writeFileSync(path.join(repoDir, 'not-baselined.ts'), 'const b = "FIX_ME";\n', 'utf8');
    spawnSync('git', ['-C', repoDir, 'add', 'baselined.ts', 'not-baselined.ts'], { encoding: 'utf8' });
    spawnSync('git', ['-C', repoDir, 'commit', '-m', 'add files'], { encoding: 'utf8' });

    // Compute fingerprint for the baselined finding
    const baselinedFinding: Finding = {
      ruleId: 'stub-fixable',
      path: 'baselined.ts',
      message: 'contains FIX_ME',
      fingerprintBasis: 'baselined.ts',
    };
    const fp = fingerprint(baselinedFinding);

    // Write baseline file with only the baselined.ts entry
    const baselineDir = path.join(repoDir, '.house-rules');
    fs.mkdirSync(baselineDir, { recursive: true });
    const baselineFile = path.join(baselineDir, 'baseline.json');
    const baseline = {
      version: 1,
      entries: [{ rule: 'stub-fixable', path: 'baselined.ts', fingerprint: fp }],
    };
    fs.writeFileSync(baselineFile, JSON.stringify(baseline, null, 2) + '\n', 'utf8');

    const output = await captureRunHousekeep({
      repo: repoDir,
      rulesDir,
      policy,
      baselineMode: true,
      baselineFile,
    });

    // baselined.ts should be fixed
    const baselinedContent = fs.readFileSync(path.join(repoDir, 'baselined.ts'), 'utf8');
    expect(baselinedContent).not.toContain('FIX_ME');
    expect(baselinedContent).toContain('FIXED');

    // not-baselined.ts should NOT be fixed
    const notBaselinedContent = fs.readFileSync(path.join(repoDir, 'not-baselined.ts'), 'utf8');
    expect(notBaselinedContent).toContain('FIX_ME');

    // Baseline entry should be pruned
    const newBaseline = JSON.parse(fs.readFileSync(baselineFile, 'utf8'));
    expect(newBaseline.entries.length).toBe(0);

    expect(output).toContain('Fixed (1)');
    expect(output).toContain('1 fixed');
  });

  test('dry-run: canFixPath=false routes to needs-manual, canFixPath=true routes to fixed', async () => {
    const repoDir = makeTempRepo();
    tmpRepos.push(repoDir);

    const rulesDir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'stub-canfix-'));
    tmpRepos.push(rulesDir2);
    const rDir = path.join(rulesDir2, 'stub-canfix');
    fs.mkdirSync(rDir);
    fs.writeFileSync(path.join(rDir, 'index.js'), `
import fs from 'node:fs'; import path from 'node:path';
const rule = {
  id: 'stub-canfix', meta: { description: 'stub' }, vehicles: ['diff'],
  check(ctx) {
    return (ctx.files ?? []).filter(f => f.text?.includes('FIX_ME'))
      .map(f => ({ ruleId: 'stub-canfix', path: f.path, message: 'hit', fingerprintBasis: f.path }));
  },
  async fix(ctx) {
    let fixed = 0;
    for (const f of (ctx.files ?? [])) {
      if (f.text?.includes('FIX_ME')) {
        fs.writeFileSync(path.join(ctx.repoRoot, f.path), f.text.replace(/FIX_ME/g, 'FIXED'), 'utf8');
        fixed++;
      }
    }
    return { fixed, skipped: 0 };
  },
  canFixPath(p) { return !p.endsWith('blocked.ts'); },
};
export default rule;
`);
    const policy2 = { 'stub-canfix': { severity: 'error', autofix: true } };

    spawnSync('git', ['-C', repoDir, 'commit', '--allow-empty', '-m', 'init'], { encoding: 'utf8' });
    const baseSha = spawnSync('git', ['-C', repoDir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim();

    fs.writeFileSync(path.join(repoDir, 'fixable.ts'), 'const x = "FIX_ME";\n', 'utf8');
    fs.writeFileSync(path.join(repoDir, 'blocked.ts'), 'const y = "FIX_ME";\n', 'utf8');
    spawnSync('git', ['-C', repoDir, 'add', 'fixable.ts', 'blocked.ts'], { encoding: 'utf8' });
    spawnSync('git', ['-C', repoDir, 'commit', '-m', 'add'], { encoding: 'utf8' });

    const output = await captureRunHousekeep({ repo: repoDir, rulesDir: rulesDir2, policy: policy2, since: baseSha, dryRun: true });

    expect(output).toContain('[dry-run]');
    expect(output).toContain('fixable.ts');
    expect(output).not.toContain('[dry-run] blocked.ts');
    expect(output).toContain('Needs manual fix');
    expect(output).toContain('blocked.ts');
    expect(fs.readFileSync(path.join(repoDir, 'fixable.ts'), 'utf8')).toBe('const x = "FIX_ME";\n');
    expect(fs.readFileSync(path.join(repoDir, 'blocked.ts'), 'utf8')).toBe('const y = "FIX_ME";\n');
  });

  test('dry-run: stub rule without canFixPath on .sh file listed as fixed (no lang-table leak)', async () => {
    const repoDir = makeTempRepo();
    tmpRepos.push(repoDir);
    const { rulesDir, policy } = makeStubRulesDir();
    tmpRepos.push(rulesDir);

    spawnSync('git', ['-C', repoDir, 'commit', '--allow-empty', '-m', 'init'], { encoding: 'utf8' });
    const baseSha = spawnSync('git', ['-C', repoDir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim();

    fs.writeFileSync(path.join(repoDir, 'script.sh'), 'FIX_ME\n', 'utf8');
    spawnSync('git', ['-C', repoDir, 'add', 'script.sh'], { encoding: 'utf8' });
    spawnSync('git', ['-C', repoDir, 'commit', '-m', 'add'], { encoding: 'utf8' });

    const output = await captureRunHousekeep({ repo: repoDir, rulesDir, policy, since: baseSha, dryRun: true });

    expect(output).toContain('[dry-run]');
    expect(output).toContain('script.sh');
    expect(output).not.toContain('Needs manual fix');
  });

  test('dry-run and real-run agree: comment-density preview-language file goes to needs-manual both ways', async () => {
    const repoDir = makeTempRepo();
    tmpRepos.push(repoDir);
    const realRulesDir = path.resolve(import.meta.dir, '../../rules');

    spawnSync('git', ['-C', repoDir, 'commit', '--allow-empty', '-m', 'init'], { encoding: 'utf8' });
    const baseSha = spawnSync('git', ['-C', repoDir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim();

    const bashContent = '# c1\n# c2\n# c3\n# c4\n# c5\n# c6\necho a\necho b\n';
    fs.writeFileSync(path.join(repoDir, 'over-budget.sh'), bashContent, 'utf8');
    spawnSync('git', ['-C', repoDir, 'add', 'over-budget.sh'], { encoding: 'utf8' });
    spawnSync('git', ['-C', repoDir, 'commit', '-m', 'add'], { encoding: 'utf8' });

    const dryOut = await captureRunHousekeep({ repo: repoDir, rulesDir: realRulesDir, since: baseSha, dryRun: true });
    const realOut = await captureRunHousekeep({ repo: repoDir, rulesDir: realRulesDir, since: baseSha });

    expect(dryOut).toContain('Needs manual fix');
    expect(dryOut).toContain('over-budget.sh');
    expect(dryOut).not.toContain('[dry-run] over-budget.sh');

    expect(realOut).toContain('Needs manual fix');
    expect(realOut).toContain('over-budget.sh');

    expect(fs.readFileSync(path.join(repoDir, 'over-budget.sh'), 'utf8')).toBe(bashContent);
  });

  test('untracked strays reported, exit 0 (positive control)', async () => {
    const repoDir = makeTempRepo();
    tmpRepos.push(repoDir);
    spawnSync('git', ['-C', repoDir, 'commit', '--allow-empty', '-m', 'init'], { encoding: 'utf8' });

    fs.writeFileSync(path.join(repoDir, 'test-agent-config.mjs'), 'export {};\n');
    fs.writeFileSync(path.join(repoDir, 'test-persistence.mjs'), 'export {};\n');

    const output = await captureRunHousekeep({
      repo: repoDir,
      dryRun: true,
    });

    expect(output).toContain('Untracked strays (not blocking)');
    expect(output).toContain('test-agent-config.mjs');
    expect(output).toContain('test-persistence.mjs');
  });
});
