import { spawnSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { loadRules } from '../engine/registry.js';
import { buildContext } from '../engine/context.js';
import { runRules } from '../engine/run.js';
import { readBaseline, fingerprint } from '../engine/baseline.js';
import type { Baseline } from '../engine/baseline.js';
import { BUILTIN_POLICY } from '../engine/policy.js';
import { addedHunks } from '../hooks/lib/work-scope.js';
import type { RuleContext, ScopedFile } from '../engine/types.js';
import type { Finding } from '../engine/types.js';

export interface HousekeepOpts {
  rules?: string[];
  paths?: string[];
  since?: string;
  baselineMode?: boolean;
  max?: number;
  dryRun?: boolean;
  repo?: string;
  rulesDir?: string;
  baselineFile?: string;
  policy?: Record<string, { severity: string; autofix: boolean }>;
}

function defaultBase(repoRoot: string): string {
  for (const ref of ['origin/HEAD', 'main', 'master']) {
    const r = spawnSync('git', ['-C', repoRoot, 'rev-parse', '--verify', ref], { encoding: 'utf8' });
    if (r.status === 0) return ref;
  }
  return 'HEAD';
}

const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

function buildAllTrackedContext(repoRoot: string, since?: string): RuleContext {
  const base = since ?? EMPTY_TREE;
  const result = spawnSync('git', ['-C', repoRoot, 'ls-files'], { encoding: 'utf8' });
  const paths = result.stdout.split('\n').filter(Boolean);
  const files: ScopedFile[] = paths.map(relPath => {
    const absPath = path.join(repoRoot, relPath);
    let text: string | undefined;
    try { text = fs.readFileSync(absPath, 'utf8'); } catch { /* file unreadable */ }
    const showResult = spawnSync('git', ['-C', repoRoot, 'show', `${base}:${relPath}`], { encoding: 'utf8' });
    const baseText = showResult.status === 0 ? showResult.stdout : '';
    return {
      path: relPath,
      text,
      lang: undefined,
      baseText,
      addedHunks: addedHunks(absPath, base) ?? [],
      tracked: true,
      sessionCreated: false,
    };
  });
  return { repoRoot, mode: 'cli', files };
}

function subsetContext(ctx: RuleContext, relPath: string): RuleContext {
  return { ...ctx, files: (ctx.files ?? []).filter(f => f.path === relPath) };
}

export async function runHousekeep(opts: HousekeepOpts): Promise<void> {
  const repoRoot = opts.repo ?? (() => {
    const r = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd: process.cwd(), encoding: 'utf8' });
    if (r.status !== 0) throw new Error('Not in a git repository and --repo not specified');
    return r.stdout.trim();
  })();

  const baselineFilePath = opts.baselineFile ?? path.join(repoRoot, '.house-rules', 'baseline.json');
  const rulesDirResolved = opts.rulesDir ?? path.resolve(import.meta.dir, '../../rules');

  const allRules = await loadRules(rulesDirResolved);
  const rules = opts.rules ? allRules.filter(r => opts.rules!.includes(r.id)) : allRules;

  const effectivePolicy: Record<string, { severity: string; autofix: boolean }> = {
    ...BUILTIN_POLICY,
    ...(opts.policy ?? {}),
  };

  let ctx: RuleContext;
  let findings: Finding[];
  let unmatchedBaselineEntries: Array<{ rule: string; path: string; fingerprint: string }> = [];
  let effectiveSince: string | undefined;
  let cachedBaseline: Baseline | undefined;

  if (opts.baselineMode) {
    cachedBaseline = await readBaseline(baselineFilePath);
    effectiveSince = opts.since ?? cachedBaseline.base;
    ctx = buildAllTrackedContext(repoRoot, effectiveSince);
    const allFindings = await runRules(rules, ctx, effectivePolicy as Parameters<typeof runRules>[2]);
    const allFingerprintSet = new Set(allFindings.map(f => fingerprint(f)));
    unmatchedBaselineEntries = cachedBaseline.entries.filter(e => !allFingerprintSet.has(e.fingerprint));
    const baselineFingerprints = new Set(cachedBaseline.entries.map(e => e.fingerprint));
    findings = allFindings.filter(f => baselineFingerprints.has(fingerprint(f)));
  } else {
    const base = opts.since ?? defaultBase(repoRoot);
    ctx = buildContext({ repoRoot, mode: 'cli', base });
    findings = await runRules(rules, ctx, effectivePolicy as Parameters<typeof runRules>[2]);
  }

  if (opts.paths && opts.paths.length > 0) {
    findings = findings.filter(f =>
      opts.paths!.some(pattern => new Bun.Glob(pattern).match(f.path))
    );
  }

  const fixed: Finding[] = [];
  const needsManual: Finding[] = [];
  let fixCount = 0;

  for (const finding of findings) {
    const rule = rules.find(r => r.id === finding.ruleId);
    const policyEntry = effectivePolicy[finding.ruleId];
    const canFix = rule?.fix !== undefined && policyEntry?.autofix === true;

    if (canFix && (opts.max === undefined || fixCount < opts.max)) {
      if (!opts.dryRun) {
        const subCtx = subsetContext(ctx, finding.path);
        const result = await rule!.fix!(subCtx);
        if (result.fixed > 0) {
          fixCount++;
          fixed.push(finding);
        } else {
          needsManual.push(finding);
        }
      } else {
        fixCount++;
        fixed.push(finding);
      }
    } else {
      needsManual.push(finding);
    }
  }

  if (fixed.length > 0) {
    process.stdout.write(`\nFixed (${fixed.length}):\n`);
    for (const f of fixed) {
      const prefix = opts.dryRun ? '  [dry-run] ' : '  ';
      process.stdout.write(`${prefix}${f.path} ${f.ruleId} ${f.message}\n`);
    }
  }

  const totalNeedsManual = needsManual.length + unmatchedBaselineEntries.length;
  if (totalNeedsManual > 0) {
    process.stdout.write(`\nNeeds manual fix (${totalNeedsManual}):\n`);
    for (const f of needsManual) {
      process.stdout.write(`  ${f.path} ${f.ruleId} ${f.message}\n`);
    }
    for (const e of unmatchedBaselineEntries) {
      process.stdout.write(`  ${e.path} ${e.rule} (baseline entry, no matching violation found)\n`);
    }
  }

  const untrackedResult = spawnSync('git', ['-C', repoRoot, 'ls-files', '--others', '--exclude-standard'], { encoding: 'utf8' });
  const untrackedPaths = untrackedResult.stdout.split('\n').filter(Boolean);
  const strayRule = allRules.find(r => r.id === 'stray-artifacts');

  if (strayRule && untrackedPaths.length > 0) {
    const synthFiles: ScopedFile[] = untrackedPaths.map(p => ({
      path: p,
      text: undefined,
      lang: undefined,
      baseText: '',
      addedHunks: [],
      tracked: true,
      sessionCreated: false,
    }));
    const synthCtx: RuleContext = { repoRoot, mode: 'cli', files: synthFiles };
    const strayFindings = await strayRule.check(synthCtx);
    const strayPaths = [...new Set(strayFindings.map(f => f.path))];

    if (strayPaths.length > 0) {
      process.stdout.write(`\nUntracked strays (not blocking):\n`);
      for (const p of strayPaths) {
        process.stdout.write(`  ${p}\n`);
      }
    }
  }

  if (opts.baselineMode && !opts.dryRun && fixed.length > 0) {
    const freshCtx = buildAllTrackedContext(repoRoot, effectiveSince);
    const freshFindings = await runRules(rules, freshCtx, effectivePolicy as Parameters<typeof runRules>[2]);
    const freshFingerprints = new Set(freshFindings.map(f => fingerprint(f)));

    const baseline = cachedBaseline ?? await readBaseline(baselineFilePath);
    const prunedEntries = baseline.entries.filter(e => freshFingerprints.has(e.fingerprint));
    const pruneCount = baseline.entries.length - prunedEntries.length;

    const prunedBaseline: { version: 1; base?: string; entries: typeof prunedEntries } =
      { version: 1, entries: prunedEntries };
    if (baseline.base !== undefined) prunedBaseline.base = baseline.base;
    const dir = path.dirname(baselineFilePath);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(baselineFilePath, JSON.stringify(prunedBaseline, null, 2) + '\n', 'utf8');

    if (pruneCount > 0) {
      process.stdout.write(`\nPruned ${pruneCount} baseline entries\n`);
    }
  }

  process.stdout.write(`\n${fixCount} fixed, ${totalNeedsManual} need manual fix\n`);

  process.exit(0);
}
