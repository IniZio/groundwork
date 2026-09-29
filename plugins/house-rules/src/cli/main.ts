#!/usr/bin/env bun
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { loadRules } from '../engine/registry.js';
import { runRules, coverageReport, formatCoverage, grammarWarnings } from '../engine/run.js';
import { readBaseline, writeBaseline, subtractBaseline } from '../engine/baseline.js';
import { runHousekeep, fixFindings } from './housekeep.js';
import { runConfig } from './config.js';
import { runStructure, runWhere, runNew } from './structure.js';
import { resolveScope, ScopeUsageError } from './scope.js';
import { BUILTIN_POLICY } from '../engine/policy.js';
import {
  type OutputFormat,
  writeScopeHeader,
  toReportFinding,
  buildReport,
  writeJsonReport,
  formatFindingLine,
  exitCodeFor,
} from './report.js';

const rulesDir = path.resolve(import.meta.dir, '../../rules');

/** Thrown by parseArgs on unknown flags or bad --format; caught at the exit-2 handler. */
class UsageError extends Error {}

function getRepoRoot(repoFlag?: string): string {
  if (repoFlag) return repoFlag;
  const r = spawnSync('git', ['rev-parse', '--show-toplevel'], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });
  if (r.status !== 0) {
    process.stderr.write('Error: not in a git repository and --repo not specified\n');
    process.exit(2);
  }
  return r.stdout.trim();
}

function validateRef(repoRoot: string, ref: string, flagName: string): void {
  const r = spawnSync('git', ['-C', repoRoot, 'rev-parse', '--verify', ref], {
    encoding: 'utf8',
  });
  if (r.status !== 0) {
    process.stderr.write(`Error: invalid --${flagName} ref: ${ref}\n`);
    process.exit(2);
  }
}

function validateBase(repoRoot: string, base: string): void {
  validateRef(repoRoot, base, 'base');
}

function printUsage(toStdout = false): void {
  const out = toStdout ? process.stdout : process.stderr;
  out.write(
    'Usage:\n' +
      '  house-rules check [--all] [--base <ref>] [--fix] [--format <text|json>] [--rules-dir <dir>] [--baseline-file <file>] [--repo <dir>] [<pathspec>...]\n' +
      '  house-rules baseline [--all] [--base <ref>] [--format <text|json>] [--rules-dir <dir>] [--baseline-file <file>] [--repo <dir>] [<pathspec>...]\n' +
      '  house-rules housekeep [--all] [--rules <a,b>] [--paths <glob,...>] [--since <ref>] [--baseline] [--max <n>] [--dry-run] [--diff] [--format <text|json>] [--rules-dir <dir>] [--baseline-file <file>] [--repo <dir>] [<pathspec>...]\n' +
      '  house-rules config [--format <text|json>] [--repo <dir>]\n' +
      '  house-rules structure [--repo <dir>]\n' +
      '  house-rules where <type|free text...> [--repo <dir>]\n' +
      '  house-rules new <type> key=value... [--repo <dir>]\n' +
      '\n' +
      'Flags:\n' +
      '  --all               scan all tracked files (mutually exclusive with --base/--since)\n' +
      '  --base <ref>        git ref to diff against\n' +
      '  --baseline-file <f> path to baseline JSON\n' +
      '  --baseline          housekeep baseline mode\n' +
      '  --diff              show unified diff of fixes\n' +
      '  --dry-run           simulate fixes without writing\n' +
      '  --fix               auto-fix findings (check subcommand only)\n' +
      '  --format <text|json>  output format (default: text)\n' +
      '  --max <n>           maximum fixes to apply\n' +
      '  --paths <glob,...>  filter by glob patterns\n' +
      '  --repo <dir>        git repository root\n' +
      '  --rules <a,b>       comma-separated rule IDs\n' +
      '  --rules-dir <dir>   path to rules directory\n' +
      '  --since <ref>       housekeep since ref\n' +
      '\n' +
      'Exit codes:\n' +
      '  0  no error-severity findings remain\n' +
      '  1  error-severity findings remain (for --fix and housekeep: after fixing)\n' +
      '  2  usage error, unknown flag, or runtime error\n',
  );
}

function parseArgs(argv: string[]): {
  subcommand: string | undefined;
  base?: string;
  rulesDir?: string;
  baselineFile?: string;
  repo?: string;
  rules?: string[];
  paths?: string[];
  since?: string;
  baseline?: boolean;
  max?: number;
  dryRun?: boolean;
  diff?: boolean;
  all?: boolean;
  fix?: boolean;
  format: OutputFormat;
  pathspec?: string[];
} {
  const args = argv.slice(0);
  const subcommand = args.shift();
  const opts: Record<string, string> = {};
  const flags: Record<string, boolean> = {};
  const positionals: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (
      arg === '--base' ||
      arg === '--rules-dir' ||
      arg === '--baseline-file' ||
      arg === '--repo' ||
      arg === '--rules' ||
      arg === '--paths' ||
      arg === '--since' ||
      arg === '--max' ||
      arg === '--format'
    ) {
      opts[arg.slice(2)] = args[++i] ?? '';
    } else if (
      arg === '--baseline' ||
      arg === '--dry-run' ||
      arg === '--diff' ||
      arg === '--all' ||
      arg === '--fix'
    ) {
      flags[arg.slice(2)] = true;
    } else if (!arg.startsWith('-')) {
      positionals.push(arg);
    } else {
      throw new UsageError(`unknown flag: ${arg}`);
    }
  }

  const rawFormat = opts['format'] ?? 'text';
  if (rawFormat !== 'text' && rawFormat !== 'json') {
    throw new UsageError(`--format must be "text" or "json", got: ${rawFormat}`);
  }
  const format = rawFormat as OutputFormat;

  return {
    subcommand,
    base: opts['base'],
    rulesDir: opts['rules-dir'],
    baselineFile: opts['baseline-file'],
    repo: opts['repo'],
    rules: opts['rules'] !== undefined ? opts['rules'].split(',') : undefined,
    paths: opts['paths'] !== undefined ? opts['paths'].split(',') : undefined,
    since: opts['since'],
    baseline: flags['baseline'],
    max: opts['max'] !== undefined ? parseInt(opts['max'], 10) : undefined,
    dryRun: flags['dry-run'],
    diff: flags['diff'],
    all: flags['all'],
    fix: flags['fix'],
    format,
    pathspec: positionals.length > 0 ? positionals : undefined,
  };
}

async function cmdCheck(opts: {
  base?: string;
  rulesDir?: string;
  baselineFile?: string;
  repo?: string;
  all?: boolean;
  fix?: boolean;
  format: OutputFormat;
  pathspec?: string[];
}): Promise<void> {
  const repoRoot = getRepoRoot(opts.repo);
  const baselineFile = opts.baselineFile ?? path.join(repoRoot, '.house-rules', 'baseline.json');
  const rulesDirResolved = opts.rulesDir ?? rulesDir;

  if (opts.base !== undefined) {
    validateBase(repoRoot, opts.base);
  }

  const { ctx, scope } = resolveScope({ repoRoot, all: opts.all, paths: opts.pathspec, base: opts.base });
  const rules = await loadRules(rulesDirResolved);
  const allFindings = await runRules(rules, ctx);
  const baseline = await readBaseline(baselineFile);
  const findings = subtractBaseline(allFindings, baseline);
  const coverage = await coverageReport(rules, ctx);

  if (opts.fix) {
    // Apply autofixes, then re-evaluate to determine remaining findings.
    const outcome = await fixFindings({
      rules,
      ctx,
      findings,
      policy: BUILTIN_POLICY,
      write: true,
    });

    const { ctx: freshCtx } = resolveScope({ repoRoot, all: opts.all, paths: opts.pathspec, base: opts.base });
    const freshAll = await runRules(rules, freshCtx);
    const freshBaseline = await readBaseline(baselineFile);
    const remaining = subtractBaseline(freshAll, freshBaseline);

    for (const w of grammarWarnings(coverage)) {
      process.stderr.write(w + '\n');
    }
    if (opts.format === 'json') {
      writeJsonReport(buildReport(scope, {
        findings: remaining.map(toReportFinding),
        fixed: outcome.fixed.map(e => toReportFinding(e.finding)),
        manual: outcome.manual.map(m => ({ ...toReportFinding(m.finding), reason: m.reason })),
        coverage,
      }));
    } else {
      writeScopeHeader(scope);
      for (const f of remaining) {
        process.stdout.write(formatFindingLine(f) + '\n');
      }
      process.stdout.write(`${remaining.length} finding(s)\n`);
      process.stdout.write(`${outcome.fixed.length} fixed\n`);
      for (const line of formatCoverage(coverage, 'coverage:', '')) {
        process.stdout.write(line + '\n');
      }
    }
    process.exit(exitCodeFor(remaining, coverage));
  }

  for (const w of grammarWarnings(coverage)) {
    process.stderr.write(w + '\n');
  }
  if (opts.format === 'json') {
    writeJsonReport(buildReport(scope, { findings: findings.map(toReportFinding), coverage }));
  } else {
    // Header after readBaseline succeeds (a corrupt baseline throws before we reach here).
    writeScopeHeader(scope);
    for (const f of findings) {
      process.stdout.write(formatFindingLine(f) + '\n');
    }
    process.stdout.write(`${findings.length} finding(s)\n`);
    for (const line of formatCoverage(coverage, 'coverage:', '')) {
      process.stdout.write(line + '\n');
    }
  }
  process.exit(exitCodeFor(findings, coverage));
}

async function cmdBaseline(opts: {
  base?: string;
  rulesDir?: string;
  baselineFile?: string;
  repo?: string;
  all?: boolean;
  pathspec?: string[];
}): Promise<void> {
  const repoRoot = getRepoRoot(opts.repo);
  const baselineFile = opts.baselineFile ?? path.join(repoRoot, '.house-rules', 'baseline.json');
  const rulesDirResolved = opts.rulesDir ?? rulesDir;

  if (opts.base !== undefined) {
    validateBase(repoRoot, opts.base);
  }

  const { ctx, scope } = resolveScope({ repoRoot, all: opts.all, paths: opts.pathspec, base: opts.base });
  const rules = await loadRules(rulesDirResolved);
  const findings = await runRules(rules, ctx);

  const dir = path.dirname(baselineFile);
  fs.mkdirSync(dir, { recursive: true });

  const shaResult = spawnSync('git', ['-C', repoRoot, 'rev-parse', scope.base], { encoding: 'utf8' });
  const resolvedSha = shaResult.status === 0 ? shaResult.stdout.trim() : undefined;

  await writeBaseline(baselineFile, findings, resolvedSha);
  process.stdout.write(`Baseline written to ${baselineFile} (${findings.length} entries)\n`);
}

// Check --help / -h anywhere in raw argv before full parsing.
const rawArgv = process.argv.slice(2);
if (rawArgv.includes('--help') || rawArgv.includes('-h') || rawArgv[0] === 'help') {
  printUsage(true);
  process.exit(0);
}

try {
  const parsed = parseArgs(rawArgv);

  if (parsed.all && (parsed.base !== undefined || parsed.since !== undefined)) {
    process.stderr.write('Error: --all cannot be combined with --base or --since\n');
    printUsage();
    process.exit(2);
  }

  if (parsed.fix && parsed.subcommand !== 'check') {
    throw new UsageError('--fix is only valid for the check subcommand');
  }

  switch (parsed.subcommand) {
    case 'check':
      await cmdCheck(parsed);
      break;
    case 'baseline':
      await cmdBaseline(parsed);
      break;
    case 'housekeep': {
      if (parsed.since !== undefined) {
        const repoRoot = getRepoRoot(parsed.repo);
        validateRef(repoRoot, parsed.since, 'since');
      }
      await runHousekeep({
        rules: parsed.rules,
        paths: parsed.paths,
        since: parsed.since,
        baselineMode: parsed.baseline,
        max: parsed.max,
        dryRun: parsed.dryRun,
        diff: parsed.diff,
        repo: parsed.repo,
        rulesDir: parsed.rulesDir,
        baselineFile: parsed.baselineFile,
        all: parsed.all,
        pathspec: parsed.pathspec,
        format: parsed.format,
      });
      break;
    }
    case 'config':
      process.exit(runConfig({ repoRoot: getRepoRoot(parsed.repo), format: parsed.format }));
    case 'structure':
      process.exit(runStructure({ repoRoot: getRepoRoot(parsed.repo) }));
    case 'where':
      if (!parsed.pathspec) throw new UsageError('where needs a type or free text');
      process.exit(runWhere({ repoRoot: getRepoRoot(parsed.repo), query: parsed.pathspec.join(' ') }));
    case 'new': {
      const [type, ...kv] = parsed.pathspec ?? [];
      if (!type) throw new UsageError('new needs a type');
      const params: Record<string, string> = {};
      for (const a of kv) {
        const eq = a.indexOf('=');
        if (eq < 1) throw new UsageError(`expected key=value, got: ${a}`);
        params[a.slice(0, eq)] = a.slice(eq + 1);
      }
      process.exit(runNew({ repoRoot: getRepoRoot(parsed.repo), type, params }));
    }
    default:
      printUsage();
      process.exit(2);
  }
} catch (err) {
  if (err instanceof UsageError || err instanceof ScopeUsageError) {
    process.stderr.write(`Error: ${err.message}\n`);
    printUsage();
    process.exit(2);
  }
  const msg = err instanceof Error ? err.message : String(err);
  process.stderr.write(`Error: ${msg}\n`);
  process.exit(2);
}
