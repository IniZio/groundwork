import { describe, test, expect, afterEach } from 'bun:test';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { runHousekeep } from '../../src/cli/housekeep.js';

const RULES_DIR = path.resolve(import.meta.dir, '../../rules');
const BASH_CONTENT = '# c1\n# c2\n# c3\n# c4\n# c5\n# c6\necho a\necho b\n';
const PREVIEW = { testOnly_fixTableOverride: { bash: { stability: 'preview', applicability: 'safe' } } };

function makeRepo(): { repo: string; baseSha: string; file: string } {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'hk-ledger-preview-'));
  const git = (...a: string[]) => spawnSync('git', ['-C', repo, ...a], { encoding: 'utf8' });
  git('init');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Test User');
  git('commit', '--allow-empty', '-m', 'init');
  const baseSha = git('rev-parse', 'HEAD').stdout.trim();
  const file = path.join(repo, 'over-budget.sh');
  fs.writeFileSync(file, BASH_CONTENT, 'utf8');
  git('add', 'over-budget.sh');
  git('commit', '-m', 'add');
  return { repo, baseSha, file };
}

// housekeep writes to the default os.tmpdir() ledger; scope to records whose file lives in this unique temp repo.
function ledgerRecordsFor(repo: string): Array<{ file: string; source: string }> {
  const lp = path.join(os.tmpdir(), `house-rules-autofix-ledger-${process.getuid?.() ?? 'u'}`, 'ledger.jsonl');
  if (!fs.existsSync(lp)) return [];
  const marker = path.basename(repo);
  const out: Array<{ file: string; source: string }> = [];
  for (const line of fs.readFileSync(lp, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const obj = JSON.parse(line);
      if (obj?.kind === 'fix' && typeof obj.file === 'string' && obj.file.includes(marker)) out.push(obj);
    } catch {}
  }
  return out;
}

async function capture(opts: Parameters<typeof runHousekeep>[0]): Promise<string> {
  let output = '';
  const origWrite = process.stdout.write.bind(process.stdout);
  const origExit = process.exit.bind(process);
  process.stdout.write = ((chunk: string | Uint8Array) => {
    output += typeof chunk === 'string' ? chunk : chunk.toString();
    return true;
  }) as typeof process.stdout.write;
  (process as unknown as Record<string, unknown>).exit = () => { throw new Error('__exit__'); };
  try {
    await runHousekeep(opts);
  } catch {
    // exit sentinel
  } finally {
    process.stdout.write = origWrite;
    (process as unknown as Record<string, unknown>).exit = origExit;
  }
  return output;
}

describe('housekeep ledger: preview vs stable language', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
    dirs.length = 0;
  });

  test('preview language: file unchanged, needs-manual reported, zero ledger records', async () => {
    const { repo, baseSha, file } = makeRepo();
    dirs.push(repo);
    const out = await capture({ repo, rulesDir: RULES_DIR, since: baseSha, testOnly: PREVIEW });

    expect(out).toContain('Needs manual fix');
    expect(out).toContain('autofix not supported for bash (1):');
    expect(fs.readFileSync(file, 'utf8')).toBe(BASH_CONTENT);
    expect(ledgerRecordsFor(repo)).toHaveLength(0);
  });

  test('control, stable language (no override): file fixed and ledger record written', async () => {
    const { repo, baseSha, file } = makeRepo();
    dirs.push(repo);
    const out = await capture({ repo, rulesDir: RULES_DIR, since: baseSha });

    expect(out).not.toContain('autofix not supported for bash');
    expect(fs.readFileSync(file, 'utf8')).not.toBe(BASH_CONTENT);
    const records = ledgerRecordsFor(repo);
    expect(records).toHaveLength(1);
    expect(records[0]!.source).toBe('housekeep');
  });
});
