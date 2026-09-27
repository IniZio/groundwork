import { spawnSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { loadRules } from '../engine/registry.js';
import { runRules } from '../engine/run.js';
import { readBaseline, fingerprint } from '../engine/baseline.js';
import type { Baseline } from '../engine/baseline.js';
import { BUILTIN_POLICY } from '../engine/policy.js';
import type { RuleContext, ScopedFile } from '../engine/types.js';
import type { Finding } from '../engine/types.js';
import { resolveScope } from './scope.js';

export interface HousekeepOpts {
  rules?: string[];
  paths?: string[];
  pathspec?: string[];
  since?: string;
  all?: boolean;
  baselineMode?: boolean;
  max?: number;
  dryRun?: boolean;
  diff?: boolean;
  repo?: string;
  rulesDir?: string;
  baselineFile?: string;
  policy?: Record<string, { severity: string; autofix: boolean }>;
}

function subsetContext(ctx: RuleContext, relPath: string): RuleContext {
  return { ...ctx, files: (ctx.files ?? []).filter(f => f.path === relPath) };
}

/** Print a git-style unified diff for fixed entries that have before/after content. */
function printDiff(fixed: Array<{ finding: Finding; before?: string; after?: string }>): void {
  const entries = fixed.filter(e => e.before !== undefined && e.after !== undefined && e.before !== e.after);
  if (entries.length === 0) return;

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hr-diff-'));
  try {
    for (const { finding, before, after } of entries) {
      const beforeFile = path.join(tmpDir, 'before');
      const afterFile = path.join(tmpDir, 'after');
      fs.writeFileSync(beforeFile, before!, 'utf8');
      fs.writeFileSync(afterFile, after!, 'utf8');

      const diffResult = spawnSync('git', [
        'diff', '--no-index', '--no-color', '--no-ext-diff',
        beforeFile, afterFile,
      ], { encoding: 'utf8' });

      const p = finding.path;
      const lines = diffResult.stdout.split('\n');
      const rewritten: string[] = [];
      let inHeader = true;
      for (const line of lines) {
        if (line.startsWith('@@')) inHeader = false;
        // Only header lines are rewritten: a removed "-- x" SQL comment appears as "--- x" inside a hunk.
        if (!inHeader) { rewritten.push(line); continue; }
        if (line.startsWith('index ')) continue;
        if (line.startsWith('diff --git ')) {
          rewritten.push(`diff --git a/${p} b/${p}`);
        } else if (line.startsWith('--- ')) {
          rewritten.push(`--- a/${p}`);
        } else if (line.startsWith('+++ ')) {
          rewritten.push(`+++ b/${p}`);
        } else {
          rewritten.push(line);
        }
      }
      process.stdout.write(rewritten.join('\n'));
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
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
    ({ ctx } = resolveScope({ repoRoot, all: true, since: effectiveSince, paths: opts.pathspec }));
    const allFindings = await runRules(rules, ctx, effectivePolicy as Parameters<typeof runRules>[2]);
    const allFingerprintSet = new Set(allFindings.map(f => fingerprint(f)));
    unmatchedBaselineEntries = cachedBaseline.entries.filter(e => !allFingerprintSet.has(e.fingerprint));
    const baselineFingerprints = new Set(cachedBaseline.entries.map(e => e.fingerprint));
    findings = allFindings.filter(f => baselineFingerprints.has(fingerprint(f)));
  } else {
    const { ctx: resolved } = resolveScope({ repoRoot, all: opts.all, since: opts.all ? undefined : opts.since, paths: opts.pathspec });
    ctx = resolved;
    findings = await runRules(rules, ctx, effectivePolicy as Parameters<typeof runRules>[2]);
  }

  if (opts.paths && opts.paths.length > 0) {
    findings = findings.filter(f =>
      opts.paths!.some(pattern => new Bun.Glob(pattern).match(f.path))
    );
  }

  const fixed: Array<{ finding: Finding; before?: string; after?: string }> = [];
  const needsManual: Array<{ finding: Finding; reason: string }> = [];
  let fixCount = 0;

  for (const finding of findings) {
    const rule = rules.find(r => r.id === finding.ruleId);
    const policyEntry = effectivePolicy[finding.ruleId];
    const canFix = rule?.fix !== undefined && policyEntry?.autofix === true;

    if (!canFix) {
      const reason = policyEntry?.autofix !== true
        ? 'autofix disabled by policy'
        : 'rule has no autofix';
      needsManual.push({ finding, reason });
      continue;
    }

    if (opts.max !== undefined && fixCount >= opts.max) {
      needsManual.push({ finding, reason: '--max limit reached' });
      continue;
    }

    const subCtx = subsetContext(ctx, finding.path);
    // Both dry-run and real mode run the actual fix; write:false suppresses disk writes and ledger appends.
    const result = await rule!.fix!(subCtx, { write: !opts.dryRun });

    const fileResult = result.files?.find(f => f.path === finding.path);
    if (fileResult) {
      if (fileResult.status === 'fixed') {
        fixCount++;
        fixed.push({ finding, before: fileResult.before, after: fileResult.after });
      } else {
        needsManual.push({ finding, reason: fileResult.reason ?? 'rule declined (no reason reported)' });
      }
    } else {
      if (result.fixed > 0) {
        fixCount++;
        fixed.push({ finding });
      } else {
        needsManual.push({ finding, reason: 'rule declined (no reason reported)' });
      }
    }
  }

  if (fixed.length > 0) {
    process.stdout.write(`\nFixed (${fixed.length}):\n`);
    for (const { finding } of fixed) {
      const prefix = opts.dryRun ? '  [dry-run] ' : '  ';
      process.stdout.write(`${prefix}${finding.path} ${finding.ruleId} ${finding.message}\n`);
    }
  }

  if (opts.diff) {
    printDiff(fixed);
  }

  const totalNeedsManual = needsManual.length + unmatchedBaselineEntries.length;
  if (totalNeedsManual > 0) {
    process.stdout.write(`\nNeeds manual fix (${totalNeedsManual}):\n`);
    for (const { finding, reason } of needsManual) {
      process.stdout.write(`  ${finding.path} ${finding.ruleId} ${finding.message} — ${reason}\n`);
    }
    for (const e of unmatchedBaselineEntries) {
      process.stdout.write(`  ${e.path} ${e.rule} — baseline entry, no matching violation found\n`);
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
    const { ctx: freshCtx } = resolveScope({ repoRoot, all: true, since: effectiveSince, paths: opts.pathspec });
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
