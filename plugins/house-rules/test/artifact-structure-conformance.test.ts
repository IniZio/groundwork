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

const ISSUE_CONFIG = JSON.stringify({
  rules: {
    'artifact-structure': [
      'error',
      {
        types: {
          issue: {
            tier: 'working',
            generates: 'work/{slug}/tickets/{nn}-{name:kebab}.md',
            headingsWhen: [{ property: 'status', in: ['todo', 'in-progress'], headings: ['Acceptance criteria'] }],
          },
        },
        forbidden: [{ pattern: 'lessons/**', redirect: 'Use work/{slug}/lessons.md' }],
      },
    ],
  },
});

function mkRepo(opts: { config?: string } = {}): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hr-conf-'));
  tmpDirs.push(dir);
  git(dir, 'init');
  if (opts.config) fs.writeFileSync(path.join(dir, '.house-rules.json'), opts.config);
  return dir;
}

function write(dir: string, rel: string, body: string): void {
  const abs = path.join(dir, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, body);
}

const ISSUE = 'work/demo/tickets/01-first-ticket.md';
const issueDoc = (status: string, withHeading: boolean) =>
  `---\ntitle: Ticket\nstatus: ${status}\n---\n\n# Ticket\n\n${withHeading ? '## Acceptance criteria\n\n- works\n' : 'No criteria here.\n'}`;

describe('checkDocConformance with a configured issue type', () => {
  it('flags a todo issue that lacks the Acceptance criteria heading', () => {
    const dir = mkRepo({ config: ISSUE_CONFIG });
    write(dir, ISSUE, issueDoc('todo', false));
    const findings = checkDocConformance(dir, ISSUE);
    expect(findings.length).toBe(1);
    expect(findings[0].message).toContain('Acceptance criteria');
    expect(findings[0].message).toContain('issue');
  });

  it('reports nothing when the todo issue has the heading', () => {
    const dir = mkRepo({ config: ISSUE_CONFIG });
    write(dir, ISSUE, issueDoc('todo', true));
    expect(checkDocConformance(dir, ISSUE)).toEqual([]);
  });

  it('reports nothing for a done issue without the heading', () => {
    const dir = mkRepo({ config: ISSUE_CONFIG });
    write(dir, ISSUE, issueDoc('done', false));
    expect(checkDocConformance(dir, ISSUE)).toEqual([]);
  });

  it('flags an in-progress issue that lacks the Acceptance criteria heading', () => {
    const dir = mkRepo({ config: ISSUE_CONFIG });
    write(dir, ISSUE, issueDoc('in-progress', false));
    const findings = checkDocConformance(dir, ISSUE);
    expect(findings.length).toBe(1);
    expect(findings[0].message).toContain('Acceptance criteria');
  });

  it('still checks a file that is already committed', () => {
    const bad = mkRepo({ config: ISSUE_CONFIG });
    write(bad, ISSUE, issueDoc('in-progress', false));
    git(bad, 'add', '-A');
    git(bad, 'commit', '-m', 'init');
    expect(git(bad, 'status', '--porcelain')).toBe('');
    const findings = checkDocConformance(bad, ISSUE);
    expect(findings.length).toBe(1);
    expect(findings[0].message).toContain('Acceptance criteria');

    const good = mkRepo({ config: ISSUE_CONFIG });
    write(good, ISSUE, issueDoc('in-progress', true));
    git(good, 'add', '-A');
    git(good, 'commit', '-m', 'init');
    expect(checkDocConformance(good, ISSUE)).toEqual([]);
  });

  it('writes nothing to the repo', () => {
    const dir = mkRepo({ config: ISSUE_CONFIG });
    write(dir, ISSUE, issueDoc('todo', false));
    write(dir, 'lessons/x.md', '# x\n');
    const before = git(dir, 'status', '--porcelain', '--ignored');
    const found = checkDocConformance(dir, ISSUE).length + checkDocConformance(dir, 'lessons/x.md').length;
    expect(found).toBe(2);
    expect(git(dir, 'status', '--porcelain', '--ignored')).toBe(before);
  });
});

describe('checkDocConformance without config', () => {
  it('returns nothing for lessons/x.md', () => {
    const dir = mkRepo();
    write(dir, 'lessons/x.md', '# x\n');
    expect(checkDocConformance(dir, 'lessons/x.md')).toEqual([]);
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
