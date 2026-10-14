import { describe, it, expect, afterEach } from 'bun:test';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkDocConformance } from '../rules/artifact-structure/index.js';

const tmpDirs: string[] = [];
const GIT_ENV = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' };

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

function git(dir: string, ...args: string[]): string {
  const r = spawnSync('git', ['-c', 'user.email=t@t.com', '-c', 'user.name=T', '-c', 'commit.gpgsign=false', ...args], {
    cwd: dir,
    env: GIT_ENV,
    encoding: 'utf8',
  });
  return r.stdout;
}

function mkRepo(opts: { groundwork?: boolean } = {}): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hr-conf-'));
  tmpDirs.push(dir);
  git(dir, 'init');
  if (opts.groundwork) fs.mkdirSync(path.join(dir, '.groundwork'), { recursive: true });
  return dir;
}

function write(dir: string, rel: string, body: string): void {
  const abs = path.join(dir, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, body);
}

const ISSUE = '.groundwork/work/demo/tickets/01-first-ticket.md';
const issueDoc = (status: string, withHeading: boolean) =>
  `---\ntitle: Ticket\nstatus: ${status}\n---\n\n# Ticket\n\n${withHeading ? '## Acceptance criteria\n\n- works\n' : 'No criteria here.\n'}`;

describe('checkDocConformance with the shipped registry', () => {
  it('flags a todo issue that lacks the Acceptance criteria heading, as a warning', () => {
    const dir = mkRepo({ groundwork: true });
    write(dir, ISSUE, issueDoc('todo', false));
    const findings = checkDocConformance(dir, ISSUE);
    expect(findings.length).toBe(1);
    expect(findings[0].severity).toBe('warn');
    expect(findings[0].message).toContain('Acceptance criteria');
    expect(findings[0].message).toContain('issue');
  });

  it('reports nothing when the todo issue has the heading', () => {
    const dir = mkRepo({ groundwork: true });
    write(dir, ISSUE, issueDoc('todo', true));
    expect(checkDocConformance(dir, ISSUE)).toEqual([]);
  });

  it('reports nothing for a triage issue without the heading', () => {
    const dir = mkRepo({ groundwork: true });
    write(dir, ISSUE, issueDoc('triage', false));
    expect(checkDocConformance(dir, ISSUE)).toEqual([]);
  });

  it('still checks a file that is already committed', () => {
    const bad = mkRepo({ groundwork: true });
    write(bad, ISSUE, issueDoc('in-progress', false));
    git(bad, 'add', '-A');
    git(bad, 'commit', '-m', 'init');
    expect(git(bad, 'status', '--porcelain')).toBe('');
    const findings = checkDocConformance(bad, ISSUE);
    expect(findings.length).toBe(1);
    expect(findings[0].message).toContain('Acceptance criteria');

    const good = mkRepo({ groundwork: true });
    write(good, ISSUE, issueDoc('in-progress', true));
    git(good, 'add', '-A');
    git(good, 'commit', '-m', 'init');
    expect(checkDocConformance(good, ISSUE)).toEqual([]);
  });

  it('writes nothing to the repo', () => {
    const dir = mkRepo({ groundwork: true });
    write(dir, ISSUE, issueDoc('todo', false));
    write(dir, 'lessons/x.md', '# x\n');
    const before = git(dir, 'status', '--porcelain', '--ignored');
    const found = checkDocConformance(dir, ISSUE).length + checkDocConformance(dir, 'lessons/x.md').length;
    expect(found).toBeGreaterThan(0);
    expect(git(dir, 'status', '--porcelain', '--ignored')).toBe(before);
  });
});

describe('checkDocConformance without a manifest', () => {
  it('returns nothing for a forbidden path when there is no .groundwork and no config', () => {
    const dir = mkRepo();
    write(dir, 'lessons/x.md', '# x\n');
    expect(checkDocConformance(dir, 'lessons/x.md')).toEqual([]);
  });

  it('flags the forbidden path as a warning when .groundwork exists', () => {
    const dir = mkRepo({ groundwork: true });
    write(dir, 'lessons/x.md', '# x\n');
    const findings = checkDocConformance(dir, 'lessons/x.md');
    expect(findings.length).toBeGreaterThan(0);
    expect(findings.every((f) => f.severity === 'warn')).toBe(true);
  });
});

describe('checkDocConformance with a config manifest', () => {
  const config = JSON.stringify({
    rules: {
      'artifact-structure': [
        'error',
        {
          types: {
            note: {
              tier: 'working',
              generates: 'notes/{name:kebab}.md',
              headingsWhen: [{ property: 'status', in: ['done'], headings: ['Outcome'] }],
            },
          },
        },
      ],
    },
  });

  it('flags a missing conditional heading with no severity set', () => {
    const dir = mkRepo();
    write(dir, '.house-rules.json', config);
    write(dir, 'notes/a-note.md', '---\nstatus: done\n---\n\n# Note\n');
    const findings = checkDocConformance(dir, 'notes/a-note.md');
    expect(findings.length).toBe(1);
    expect(findings[0].severity).toBeUndefined();
    expect(findings[0].message).toContain('Outcome');
  });

  it('reports nothing when the conditional heading is present', () => {
    const dir = mkRepo();
    write(dir, '.house-rules.json', config);
    write(dir, 'notes/a-note.md', '---\nstatus: done\n---\n\n# Note\n\n## Outcome\n\nok\n');
    expect(checkDocConformance(dir, 'notes/a-note.md')).toEqual([]);
  });
});
