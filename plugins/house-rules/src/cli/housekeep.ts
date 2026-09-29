import { spawnSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { loadRules } from '../engine/registry.js';
import { runRules, coverageReport, formatCoverage, grammarWarnings } from '../engine/run.js';
import type { FindingWithSeverity } from '../engine/run.js';
import { readBaseline, fingerprint } from '../engine/baseline.js';
import type { Baseline } from '../engine/baseline.js';
import { BUILTIN_POLICY } from '../engine/policy.js';
import type { Rule, RuleContext, ScopedFile } from '../engine/types.js';
import { resolveScope } from './scope.js';
import type { Scope } from './scope.js';
import {
  type OutputFormat,
  writeScopeHeader,
  toReportFinding,
  buildReport,
  writeJsonReport,
  exitCodeFor,
} from './report.js';

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
  format?: OutputFormat;
  /** Opaque rule test hooks; in-process callers only, never set by the CLI parser. */
  testOnly?: Record<string, unknown>;
}

export interface FixOutcome {
  fixed: Array<{ finding: FindingWithSeverity; before?: string; after?: string }>;
  manual: Array<{ finding: FindingWithSeverity; reason: string }>;
}

/** Run the fix loop over a set of findings. Writes to disk only when write:true. */
export async function fixFindings(args: {
  rules: Rule[];
  ctx: RuleContext;
  findings: FindingWithSeverity[];
  policy: Record<string, { severity: string; autofix: boolean }>;
  write: boolean;
  max?: number;
  testOnly?: Record<string, unknown>;
}): Promise<FixOutcome> {
  const { rules, ctx, findings, policy, write, max, testOnly } = args;
  const fixed: Array<{ finding: FindingWithSeverity; before?: string; after?: string }> = [];
  const manual: Array<{ finding: FindingWithSeverity; reason: string }> = [];
  let fixCount = 0;

  for (const finding of findings) {
    const rule = rules.find(r => r.id === finding.ruleId);
    const policyEntry = policy[finding.ruleId];
    const canFix = rule?.fix !== undefined && policyEntry?.autofix === true;

    if (!canFix) {
      const reason = policyEntry?.autofix !== true
        ? 'autofix disabled by policy'
        : 'rule has no autofix';
      manual.push({ finding, reason });
      continue;
    }

    if (max !== undefined && fixCount >= max) {
      manual.push({ finding, reason: '--max limit reached' });
      continue;
    }

    const subCtx: RuleContext = { ...ctx, files: (ctx.files ?? []).filter(f => f.path === finding.path) };
    // Both dry-run and real mode run the actual fix; write:false suppresses disk writes and ledger appends.
    const result = await rule!.fix!(subCtx, { write, testOnly });

    const fileResult = result.files?.find(f => f.path === finding.path);
    if (fileResult) {
      if (fileResult.status === 'fixed') {
        fixCount++;
        fixed.push({ finding, before: fileResult.before, after: fileResult.after });
      } else {
        manual.push({ finding, reason: fileResult.reason ?? 'rule declined (no reason reported)' });
      }
    } else {
      if (result.fixed > 0) {
        fixCount++;
        fixed.push({ finding });
      } else {
        manual.push({ finding, reason: 'rule declined (no reason reported)' });
      }
    }
  }

  return { fixed, manual };
}

/** Print a git-style unified diff for fixed entries that have before/after content. */
function printDiff(fixed: Array<{ finding: { path: string }; before?: string; after?: string }>): void {
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
  let findings: FindingWithSeverity[];
  let unmatchedBaselineEntries: Array<{ rule: string; path: string; fingerprint: string }> = [];
  let effectiveSince: string | undefined;
  let cachedBaseline: Baseline | undefined;
  let scope: Scope;

  if (opts.baselineMode) {
    cachedBaseline = await readBaseline(baselineFilePath);
    effectiveSince = opts.since ?? cachedBaseline.base;
    ({ ctx, scope } = resolveScope({ repoRoot, all: true, since: effectiveSince, paths: opts.pathspec }));
    const allFindings = await runRules(rules, ctx, effectivePolicy as Parameters<typeof runRules>[2]);
    const allFingerprintSet = new Set(allFindings.map(f => fingerprint(f)));
    unmatchedBaselineEntries = cachedBaseline.entries.filter(e => !allFingerprintSet.has(e.fingerprint));
    const baselineFingerprints = new Set(cachedBaseline.entries.map(e => e.fingerprint));
    findings = allFindings.filter(f => baselineFingerprints.has(fingerprint(f)));
  } else {
    ({ ctx, scope } = resolveScope({ repoRoot, all: opts.all, since: opts.all ? undefined : opts.since, paths: opts.pathspec }));
    findings = await runRules(rules, ctx, effectivePolicy as Parameters<typeof runRules>[2]);
  }

  if (opts.paths && opts.paths.length > 0) {
    findings = findings.filter(f =>
      opts.paths!.some(pattern => new Bun.Glob(pattern).match(f.path))
    );
  }

  const outcome = await fixFindings({
    rules,
    ctx,
    findings,
    policy: effectivePolicy,
    write: !opts.dryRun,
    max: opts.max,
    testOnly: opts.testOnly,
  });

  const { fixed, manual: needsManual } = outcome;
  const fixCount = fixed.length;

  const coverage = await coverageReport(rules, ctx);

  for (const w of grammarWarnings(coverage)) {
    process.stderr.write(w + '\n');
  }

  const isJson = opts.format === 'json';

  // Write scope header to stderr in text mode, after all fallible work, before first stdout write.
  if (!isJson) {
    writeScopeHeader(scope);
  }

  if (!isJson) {
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
  }

  const totalNeedsManual = needsManual.length + unmatchedBaselineEntries.length;

  if (!isJson && totalNeedsManual > 0) {
    process.stdout.write(`\nNeeds manual fix (${totalNeedsManual}):\n`);

    const reasonGroups = new Map<string, Array<{ finding: FindingWithSeverity }>>();
    for (const { finding, reason } of needsManual) {
      if (!reasonGroups.has(reason)) reasonGroups.set(reason, []);
      reasonGroups.get(reason)!.push({ finding });
    }
    for (const [reason, entries] of reasonGroups) {
      process.stdout.write(`  ${reason} (${entries.length}):\n`);
      for (const { finding } of entries) {
        process.stdout.write(`    ${finding.path} ${finding.ruleId} ${finding.message}\n`);
      }
    }

    if (unmatchedBaselineEntries.length > 0) {
      process.stdout.write(`  baseline entry, no matching violation found (${unmatchedBaselineEntries.length}):\n`);
      for (const e of unmatchedBaselineEntries) {
        process.stdout.write(`    ${e.path} ${e.rule}\n`);
      }
    }
  }

  const untrackedResult = spawnSync('git', ['-C', repoRoot, 'ls-files', '--others', '--exclude-standard'], { encoding: 'utf8' });
  const untrackedPaths = untrackedResult.stdout.split('\n').filter(Boolean);
  const strayRule = allRules.find(r => r.id === 'stray-artifacts');

  if (!isJson && strayRule && untrackedPaths.length > 0) {
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

    // Baseline prune message is text-only; suppress in JSON mode.
    if (!isJson && pruneCount > 0) {
      process.stdout.write(`\nPruned ${pruneCount} baseline entries\n`);
    }
  }

  if (isJson) {
    const fixedFindings = fixed.map(({ finding }) => toReportFinding(finding));
    const manualEntries = needsManual.map(({ finding, reason }) => ({
      ...toReportFinding(finding),
      reason,
    }));
    const unmatchedEntries = unmatchedBaselineEntries.map(e => ({
      ruleId: e.rule,
      path: e.path,
      line: null as null,
      severity: 'warn' as const,
      message: 'baseline entry, no matching violation found',
      reason: 'baseline entry, no matching violation found',
    }));
    writeJsonReport(buildReport(scope, {
      findings: [],
      fixed: fixedFindings,
      manual: [...manualEntries, ...unmatchedEntries],
      coverage,
    }));
  } else {
    const coverageLines = formatCoverage(coverage, 'coverage:', '');
    if (coverageLines.length > 0) {
      process.stdout.write('\n' + coverageLines.join('\n') + '\n');
    }
    process.stdout.write(`\n${fixCount} fixed, ${totalNeedsManual} need manual fix\n`);
  }

  process.exit(exitCodeFor(needsManual.map(m => m.finding), coverage));
}
