#!/usr/bin/env bun
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { loadRules } from '../engine/registry.js';
import { buildContext } from '../engine/context.js';
import { runRules, isBlocking } from '../engine/run.js';
import { readBaseline, writeBaseline, subtractBaseline } from '../engine/baseline.js';
import { runHousekeep } from './housekeep.js';
import { defaultBase } from './default-base.js';

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

function validateBase(repoRoot: string, base: string): void {
  const r = spawnSync('git', ['-C', repoRoot, 'rev-parse', '--verify', base], {
    encoding: 'utf8',
  });
  if (r.status !== 0) {
    process.stderr.write(`Error: invalid --base ref: ${base}\n`);
    process.exit(2);
  }
}

function printUsage(): void {
  process.stderr.write(
    'Usage:\n' +
      '  house-rules check [--base <ref>] [--rules-dir <dir>] [--baseline-file <file>] [--repo <dir>]\n' +
      '  house-rules baseline [--base <ref>] [--rules-dir <dir>] [--baseline-file <file>] [--repo <dir>]\n' +
      '  house-rules housekeep [--rules <a,b>] [--paths <glob,...>] [--since <ref>] [--baseline] [--max <n>] [--dry-run] [--rules-dir <dir>] [--baseline-file <file>] [--repo <dir>]\n',
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
} {
  const args = argv.slice(0);
  const subcommand = args.shift();
  const opts: Record<string, string> = {};
  const flags: Record<string, boolean> = {};

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
    } else if (arg === '--baseline' || arg === '--dry-run') {
      flags[arg.slice(2)] = true;
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
  };
}

async function cmdCheck(opts: {
  base?: string;
  rulesDir?: string;
  baselineFile?: string;
  repo?: string;
}): Promise<void> {
  const repoRoot = getRepoRoot(opts.repo);
  const baselineFile = opts.baselineFile ?? path.join(repoRoot, '.house-rules', 'baseline.json');
  const rulesDirResolved = opts.rulesDir ?? rulesDir;

  let base: string;
  if (opts.base !== undefined) {
    validateBase(repoRoot, opts.base);
    base = opts.base;
  } else {
    base = defaultBase(repoRoot);
  }

  const ctx = buildContext({ repoRoot, mode: 'cli', base });
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
}): Promise<void> {
  const repoRoot = getRepoRoot(opts.repo);
  const baselineFile = opts.baselineFile ?? path.join(repoRoot, '.house-rules', 'baseline.json');
  const rulesDirResolved = opts.rulesDir ?? rulesDir;

  let base: string;
  if (opts.base !== undefined) {
    validateBase(repoRoot, opts.base);
    base = opts.base;
  } else {
    base = defaultBase(repoRoot);
  }

  const ctx = buildContext({ repoRoot, mode: 'cli', base });
  const rules = await loadRules(rulesDirResolved);
  const findings = await runRules(rules, ctx);

  const dir = path.dirname(baselineFile);
  fs.mkdirSync(dir, { recursive: true });

  const shaResult = spawnSync('git', ['-C', repoRoot, 'rev-parse', base], { encoding: 'utf8' });
  const resolvedSha = shaResult.status === 0 ? shaResult.stdout.trim() : undefined;

  await writeBaseline(baselineFile, findings, resolvedSha);
  process.stdout.write(`Baseline written to ${baselineFile} (${findings.length} entries)\n`);
}

const parsed = parseArgs(process.argv.slice(2));

switch (parsed.subcommand) {
  case 'check':
    await cmdCheck(parsed);
    break;
  case 'baseline':
    await cmdBaseline(parsed);
    break;
  case 'housekeep':
    await runHousekeep({
      rules: parsed.rules,
      paths: parsed.paths,
      since: parsed.since,
      baselineMode: parsed.baseline,
      max: parsed.max,
      dryRun: parsed.dryRun,
      repo: parsed.repo,
      rulesDir: parsed.rulesDir,
      baselineFile: parsed.baselineFile,
    });
    break;
  default:
    printUsage();
    process.exit(2);
}
