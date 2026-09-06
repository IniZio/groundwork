#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const hooksDir = resolve(root, 'hooks');

function git(...args) {
  return spawnSync('git', args, { encoding: 'utf8' });
}

const versionResult = spawnSync('git', ['--version'], { encoding: 'utf8' });
if (versionResult.status !== 0 || versionResult.error) {
  console.log('[setup-hooks] git not found — skipping');
  process.exit(0);
}

const revParseResult = git('-C', root, 'rev-parse', '--git-dir');
if (revParseResult.status !== 0) {
  console.log('[setup-hooks] Not a git repository — skipping');
  process.exit(0);
}

const toplevelResult = git('-C', root, 'rev-parse', '--show-toplevel');
if (toplevelResult.status !== 0) {
  console.log('[setup-hooks] Could not determine git repo toplevel — skipping');
  process.exit(0);
}

function realpath(p) {
  try { return realpathSync(p); } catch { return p; }
}

const resolvedRoot = realpath(root);
const resolvedToplevel = realpath(toplevelResult.stdout.trim());

if (resolvedRoot !== resolvedToplevel) {
  console.log(`[setup-hooks] Groundwork root (${resolvedRoot}) is inside a host repository (${resolvedToplevel}) — skipping.`);
  process.exit(0);
}

const getResult = git('-C', root, 'config', '--local', 'core.hooksPath');
const currentValue = (getResult.stdout || '').trim();

if (currentValue === hooksDir) {
  console.log('[setup-hooks] core.hooksPath already set — no change.');
  process.exit(0);
}

if (currentValue) {
  console.log(`[setup-hooks] Overwriting core.hooksPath: ${currentValue} → ${hooksDir}`);
} else {
  console.log(`[setup-hooks] Setting core.hooksPath → ${hooksDir}`);
}

const setResult = git('-C', root, 'config', '--local', 'core.hooksPath', hooksDir);
if (setResult.status !== 0) {
  console.error(`[setup-hooks] Failed to set core.hooksPath: ${setResult.stderr}`);
  process.exit(1);
}

process.exit(0);
