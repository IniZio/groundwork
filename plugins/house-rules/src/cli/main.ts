#!/usr/bin/env bun
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { loadRules } from '../engine/registry.js';
import { runRules, isBlocking } from '../engine/run.js';
import { readBaseline, writeBaseline, subtractBaseline } from '../engine/baseline.js';
import { runHousekeep } from './housekeep.js';
import { resolveScope, ScopeUsageError } from './scope.js';

const rulesDir = path.resolve(import.meta.dir, '../../rules');

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

function printUsage(): void {
  process.stderr.write(
    'Usage:\n' +
      '  house-rules check [--all] [--base <ref>] [--rules-dir <dir>] [--baseline-file <file>] [--repo <dir>] [<pathspec>...]\n' +
      '  house-rules baseline [--all] [--base <ref>] [--rules-dir <dir>] [--baseline-file <file>] [--repo <dir>] [<pathspec>...]\n' +
      '  house-rules housekeep [--all] [--rules <a,b>] [--paths <glob,...>] [--since <ref>] [--baseline] [--max <n>] [--dry-run] [--diff] [--rules-dir <dir>] [--baseline-file <file>] [--repo <dir>] [<pathspec>...]\n',
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
      arg === '--max'
    ) {
      opts[arg.slice(2)] = args[++i] ?? '';
    } else if (arg === '--baseline' || arg === '--dry-run' || arg === '--diff' || arg === '--all') {
      flags[arg.slice(2)] = true;
    } else if (!arg.startsWith('--')) {
      positionals.push(arg);
    }
  }

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
    pathspec: positionals.length > 0 ? positionals : undefined,
  };
}

async function cmdCheck(opts: {
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
  void scope; // used by a later slice
  const rules = await loadRules(rulesDirResolved);
  const allFindings = await runRules(rules, ctx);
  const baseline = await readBaseline(baselineFile);
  const findings = subtractBaseline(allFindings, baseline);

  for (const f of findings) {
    if (f.line !== undefined) {
      process.stdout.write(`${f.path}:${f.line} ${f.ruleId} ${f.message}\n`);
    } else {
      process.stdout.write(`${f.path} ${f.ruleId} ${f.message}\n`);
    }
  }

  process.stdout.write(`${findings.length} finding(s)\n`);
  process.exit(isBlocking(findings) ? 1 : 0);
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
  void scope;
  const rules = await loadRules(rulesDirResolved);
  const findings = await runRules(rules, ctx);

  const dir = path.dirname(baselineFile);
  fs.mkdirSync(dir, { recursive: true });

  const shaResult = spawnSync('git', ['-C', repoRoot, 'rev-parse', scope.base], { encoding: 'utf8' });
  const resolvedSha = shaResult.status === 0 ? shaResult.stdout.trim() : undefined;

  await writeBaseline(baselineFile, findings, resolvedSha);
  process.stdout.write(`Baseline written to ${baselineFile} (${findings.length} entries)\n`);
}

const parsed = parseArgs(process.argv.slice(2));

if (parsed.all && (parsed.base !== undefined || parsed.since !== undefined)) {
  process.stderr.write('Error: --all cannot be combined with --base or --since\n');
  printUsage();
  process.exit(2);
}

try {
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
      });
      break;
    }
    default:
      printUsage();
      process.exit(2);
  }
} catch (err) {
  if (err instanceof ScopeUsageError) {
    process.stderr.write(`Error: ${err.message}\n`);
    printUsage();
    process.exit(2);
  }
  const msg = err instanceof Error ? err.message : String(err);
  process.stderr.write(`Error: ${msg}\n`);
  process.exit(2);
}
