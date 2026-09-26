import { describe, it, expect, afterEach } from 'bun:test';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { sha256 } from '../../src/hooks/lib/autofix-ledger.js';
import type { FixRecord } from '../../src/hooks/lib/autofix-ledger.js';
import rule from './index.js';
import type { RuleContext, DiffHunk } from '../../src/engine/types.js';

const BIN = path.resolve(import.meta.dir, '../../bin/house-rules');

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch {}
  }
});

function mktemp(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'hr-led-'));
  dirs.push(d);
  return d;
}

function initRepo(dir: string): string {
  spawnSync('git', ['init'], { cwd: dir });
  spawnSync('git', ['-c', 'user.email=t@t.com', '-c', 'user.name=T',
    'commit', '--allow-empty', '-m', 'init'], { cwd: dir });
  return spawnSync('git', ['-C', dir, 'rev-parse', 'HEAD'],
    { encoding: 'utf8' }).stdout.trim();
}

function childEnv(ledgerDir: string): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.CLAUDE_PROJECT_DIR;
  delete env.CLAUDE_PLUGIN_ROOT;
  env.HOUSE_RULES_AUTOFIX_LEDGER_DIR = ledgerDir;
  return env;
}

function readFixRecords(ledgerDir: string): FixRecord[] {
  const lp = path.join(ledgerDir, 'ledger.jsonl');
  if (!fs.existsSync(lp)) return [];
  const raw = fs.readFileSync(lp, 'utf8');
  const out: FixRecord[] = [];
  for (const line of raw.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    try {
      const obj = JSON.parse(t);
      if (obj?.kind === 'fix') out.push(obj as FixRecord);
    } catch {}
  }
  return out;
}

const DENSE_FILE = [
  '// remove me 1',
  '// remove me 2',
  '// remove me 3',
  '// remove me 4',
  '// remove me 5',
  '// remove me 6',
  'export const a = 1;',
  'export const b = 2;',
  'export const c = 3;',
  'export const d = 4;',
  'export const e = 5;',
].join('\n') + '\n';

describe('comment-density housekeep fix ledger', () => {
  it('records exactly one fix entry with correct hash and removed texts after successful fix', () => {
    const repoDir = mktemp();
    const ledgerDir = mktemp();
    const baseSha = initRepo(repoDir);

    const filePath = path.join(repoDir, 'dense.ts');
    fs.writeFileSync(filePath, DENSE_FILE);
    spawnSync('git', ['-c', 'user.email=t@t.com', '-c', 'user.name=T', 'add', 'dense.ts'], { cwd: repoDir });
    spawnSync('git', ['-c', 'user.email=t@t.com', '-c', 'user.name=T', 'commit', '-m', 'add dense'], { cwd: repoDir });

    spawnSync(BIN, ['housekeep', '--since', baseSha, '--repo', repoDir], {
      encoding: 'utf8',
      env: childEnv(ledgerDir),
    });

    const records = readFixRecords(ledgerDir);
    expect(records.length).toBe(1);

    const rec = records[0];
    expect(rec.file).toBe(filePath);
    expect(rec.source).toBe('housekeep');

    const diskContent = fs.readFileSync(filePath, 'utf8');
    expect(rec.fixedHash).toBe(sha256(diskContent));

    // compute expected removed: lines present in original but absent in fixed content
    const origLines = DENSE_FILE.split('\n');
    const fixedLines = new Set(diskContent.split('\n'));
    const expectedRemoved = origLines
      .filter(l => l.trim().startsWith('//') && !fixedLines.has(l))
      .map(l => l.trim());
    expect(expectedRemoved.length).toBeGreaterThan(0);
    expect(rec.removed.sort()).toEqual(expectedRemoved.sort());
  });

  it('records nothing when file has no violations', () => {
    const repoDir = mktemp();
    const ledgerDir = mktemp();
    const baseSha = initRepo(repoDir);

    const filePath = path.join(repoDir, 'clean.ts');
    fs.writeFileSync(filePath, 'export const x = 1;\n');
    spawnSync('git', ['-c', 'user.email=t@t.com', '-c', 'user.name=T', 'add', 'clean.ts'], { cwd: repoDir });
    spawnSync('git', ['-c', 'user.email=t@t.com', '-c', 'user.name=T', 'commit', '-m', 'add clean'], { cwd: repoDir });

    spawnSync(BIN, ['housekeep', '--since', baseSha, '--repo', repoDir], {
      encoding: 'utf8',
      env: childEnv(ledgerDir),
    });

    const records = readFixRecords(ledgerDir);
    expect(records.length).toBe(0);
  });

  it('stale-snapshot: skips disk write and records nothing; fresh sibling in same run IS recorded', async () => {
    const repoDir = mktemp();
    const ledgerDir = mktemp();

    // Helper: build addedHunks for a wholly-new file (all non-trailing lines added)
    function makeHunks(text: string): DiffHunk[] {
      const lines = text.split('\n');
      const count = text.endsWith('\n') ? lines.length - 1 : lines.length;
      return [{ added: Array.from({ length: count }, (_, i) => i + 1), removed: [], removedBaseLineNos: [] }];
    }

    // Write both files to disk initially with snapshot content
    const staleRelPath = 'stale.ts';
    const staleAbsPath = path.join(repoDir, staleRelPath);
    fs.writeFileSync(staleAbsPath, DENSE_FILE);

    const freshRelPath = 'fresh.ts';
    const freshAbsPath = path.join(repoDir, freshRelPath);
    fs.writeFileSync(freshAbsPath, DENSE_FILE);

    const staleDiskContent = DENSE_FILE + '// extra line added on disk\n';
    fs.writeFileSync(staleAbsPath, staleDiskContent);

    const ctx: RuleContext = {
      repoRoot: repoDir,
      mode: 'cli',
      files: [
        { path: staleRelPath, text: DENSE_FILE, addedHunks: makeHunks(DENSE_FILE) },
        { path: freshRelPath, text: DENSE_FILE, addedHunks: makeHunks(DENSE_FILE) },
      ],
    };

    const prev = process.env.HOUSE_RULES_AUTOFIX_LEDGER_DIR;
    process.env.HOUSE_RULES_AUTOFIX_LEDGER_DIR = ledgerDir;
    try {
      await rule.fix!(ctx);
    } finally {
      if (prev === undefined) delete process.env.HOUSE_RULES_AUTOFIX_LEDGER_DIR;
      else process.env.HOUSE_RULES_AUTOFIX_LEDGER_DIR = prev;
    }

    const staleOnDisk = fs.readFileSync(staleAbsPath, 'utf8');
    expect(staleOnDisk).toBe(staleDiskContent);

    const records = readFixRecords(ledgerDir);

    const staleRecords = records.filter(r => r.file === staleAbsPath);
    expect(staleRecords.length).toBe(0);

    const freshRecords = records.filter(r => r.file === freshAbsPath);
    expect(freshRecords.length).toBe(1);
  });

  it('records nothing for a file type not eligible for stable autofix (canFixPath=false)', () => {
    // Python has stability:preview in LANG_FIX_TABLE → canFixPath returns false → fix skips
    const repoDir = mktemp();
    const ledgerDir = mktemp();
    const baseSha = initRepo(repoDir);

    const pyContent = [
      '# remove me 1',
      '# remove me 2',
      '# remove me 3',
      '# remove me 4',
      '# remove me 5',
      '# remove me 6',
      'a = 1',
      'b = 2',
      'c = 3',
      'd = 4',
      'e = 5',
    ].join('\n') + '\n';

    const filePath = path.join(repoDir, 'dense.py');
    fs.writeFileSync(filePath, pyContent);
    spawnSync('git', ['-c', 'user.email=t@t.com', '-c', 'user.name=T', 'add', 'dense.py'], { cwd: repoDir });
    spawnSync('git', ['-c', 'user.email=t@t.com', '-c', 'user.name=T', 'commit', '-m', 'add dense py'], { cwd: repoDir });

    spawnSync(BIN, ['housekeep', '--since', baseSha, '--repo', repoDir], {
      encoding: 'utf8',
      env: childEnv(ledgerDir),
    });

    const records = readFixRecords(ledgerDir);
    expect(records.length).toBe(0);
  });
});
