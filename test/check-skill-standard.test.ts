import { describe, it, expect, afterEach } from 'vitest';
import { spawnSync, execSync } from 'node:child_process';
import {
  mkdtempSync, writeFileSync, mkdirSync, rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(__filename), '..');
const SCRIPT = path.join(REPO_ROOT, 'scripts', 'check-skill-standard.mjs');

// Shared cleanup list
const tempDirs: string[] = [];
afterEach(() => {
  for (const d of tempDirs.splice(0)) {
    try { rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

function run(args: string[]) {
  const r = spawnSync('node', [SCRIPT, ...args], { encoding: 'utf8', cwd: REPO_ROOT });
  return { stdout: r.stdout ?? '', stderr: r.stderr ?? '', code: r.status ?? -1 };
}

function makeTempDir() {
  const d = mkdtempSync(path.join(tmpdir(), 'skill-std-'));
  tempDirs.push(d);
  return d;
}

function makeSkill(skillsDir: string, name: string, description: string, body: string) {
  const dir = path.join(skillsDir, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    path.join(dir, 'SKILL.md'),
    `---\nname: ${name}\ndescription: ${description}\n---\n\n${body}\n`,
  );
}

function makeRouter(skillsDir: string, mentions: string[]) {
  const bullets = mentions.map(n => `- \`${n}\` for something.`).join('\n');
  writeFileSync(
    path.join(skillsDir, 'SKILL.md'),
    `---\nname: groundwork\ndescription: Router.\n---\n\n${bullets}\n`,
  );
}

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 'Test',
  GIT_AUTHOR_EMAIL: 'test@test.com',
  GIT_COMMITTER_NAME: 'Test',
  GIT_COMMITTER_EMAIL: 'test@test.com',
};

function makeGitRepo(): string {
  const dir = makeTempDir();
  execSync('git init', { cwd: dir, env: GIT_ENV });
  execSync('git config commit.gpgsign false', { cwd: dir, env: GIT_ENV });
  return dir;
}

// ── median-words ─────────────────────────────────────────────────────────────

describe('median-words', () => {
  it('FAIL when median word count exceeds threshold', () => {
    const d = makeTempDir();
    const body = Array(820).fill('word').join(' ');
    makeSkill(d, 'alpha', 'Use something.', body);
    const r = run([d]);
    expect(r.stdout).toContain('FAIL median-words');
    expect(r.stdout).toMatch(/median=\d{3,}/); // 820 body words + frontmatter
    expect(r.code).toBe(1);
  });

  it('PASS when median word count is within threshold', () => {
    const d = makeTempDir();
    const body = Array(50).fill('word').join(' ');
    makeSkill(d, 'alpha', 'Use something.', body);
    const r = run([d]);
    expect(r.stdout).toContain('PASS median-words');
    expect(r.stdout).toMatch(/median=5[0-9]/); // frontmatter adds ~8 words
  });

  it('--verbose prints per-skill counts', () => {
    const d = makeTempDir();
    makeSkill(d, 'alpha', 'Use it.', 'hello world');
    const r = run([d, '--verbose']);
    expect(r.stdout).toMatch(/alpha/);
  });

  it('--max-median overrides the default 700 threshold', () => {
    const d = makeTempDir();
    const body = Array(60).fill('word').join(' ');
    makeSkill(d, 'alpha', 'Use something.', body);
    // Should FAIL with a very low threshold
    const r = run([d, '--max-median', '10']);
    expect(r.stdout).toContain('FAIL median-words');
    expect(r.code).toBe(1);
  });
});

// ── help-duplication ─────────────────────────────────────────────────────────

describe('help-duplication', () => {
  it('FAIL when SKILL.md contains 3+ consecutive lines from ledger help', () => {
    // Grab 3 real consecutive non-empty lines from bin/ledger help
    const ledgerBin = path.join(REPO_ROOT, 'bin', 'ledger');
    const raw = spawnSync(ledgerBin, ['help'], { encoding: 'utf8', cwd: REPO_ROOT });
    const helpLines = (raw.stdout ?? '').split('\n').map((l: string) => l.trimEnd()).filter(Boolean);
    // need at least 3 lines to form the FAIL fixture
    expect(helpLines.length).toBeGreaterThanOrEqual(3);
    const threeLines = helpLines.slice(0, 3).join('\n');

    const d = makeTempDir();
    makeSkill(d, 'alpha', 'Use something.', threeLines);
    const r = run([d]);
    expect(r.stdout).toContain('FAIL help-duplication');
    expect(r.code).toBe(1);
  });

  it('PASS when SKILL.md has no lines that match help output', () => {
    const d = makeTempDir();
    makeSkill(
      d, 'alpha', 'Use something.',
      'This content does not appear in ledger or journal help output at all. Unique text here.',
    );
    const r = run([d]);
    expect(r.stdout).toContain('PASS help-duplication');
  });
});

// ── verb-first ───────────────────────────────────────────────────────────────

describe('verb-first', () => {
  it('FAIL when description starts with a non-imperative token', () => {
    const d = makeTempDir();
    makeSkill(d, 'alpha', 'Mid-session codebase review.', 'body');
    const r = run([d]);
    expect(r.stdout).toContain('FAIL verb-first');
    expect(r.stdout).toContain('alpha("Mid-session")');
    expect(r.code).toBe(1);
  });

  it('FAIL for ORCHESTRATOR-ONLY prefixed description', () => {
    const d = makeTempDir();
    makeSkill(d, 'alpha', 'ORCHESTRATOR-ONLY skill for gates.', 'body');
    const r = run([d]);
    expect(r.stdout).toContain('FAIL verb-first');
    expect(r.stdout).toContain('alpha("ORCHESTRATOR-ONLY")');
  });

  it('PASS when description starts with a recognised imperative verb', () => {
    const d = makeTempDir();
    makeSkill(d, 'alpha', 'Use this skill to do something useful.', 'body');
    const r = run([d]);
    expect(r.stdout).toContain('PASS verb-first');
  });

  it('PASS for quoted YAML description value starting with a verb', () => {
    const d = makeTempDir();
    // YAML value with surrounding quotes — strip them before checking first token
    const skillContent =
      `---\nname: alpha\ndescription: "Run the suite and verify output."\n---\n\nbody\n`;
    mkdirSync(path.join(d, 'alpha'), { recursive: true });
    writeFileSync(path.join(d, 'alpha', 'SKILL.md'), skillContent);
    const r = run([d]);
    expect(r.stdout).toContain('PASS verb-first');
  });
});

// ── orphans ───────────────────────────────────────────────────────────────────

describe('orphans', () => {
  it('FAIL when a skill directory is not referenced in the router SKILL.md', () => {
    const d = makeTempDir();
    makeSkill(d, 'alpha', 'Use something.', 'body');
    makeSkill(d, 'beta', 'Use something else.', 'body');
    // router mentions only beta, not alpha → alpha is orphan
    makeRouter(d, ['beta']);
    const r = run([d]);
    expect(r.stdout).toContain('FAIL orphans');
    expect(r.stdout).toContain('alpha');
    expect(r.code).toBe(1);
  });

  it('PASS when all skill directories are referenced in the router', () => {
    const d = makeTempDir();
    makeSkill(d, 'alpha', 'Use something.', 'body');
    makeSkill(d, 'beta', 'Use something else.', 'body');
    makeRouter(d, ['alpha', 'beta']);
    const r = run([d]);
    expect(r.stdout).toContain('PASS orphans');
  });

  it('FAIL when skill name is only a substring in router text (no false-positive match)', () => {
    // "spec" must not be matched by "specialized" in the router.
    const d = makeTempDir();
    makeSkill(d, 'spec', 'Use the spec skill.', 'body');
    writeFileSync(
      path.join(d, 'SKILL.md'),
      '---\nname: groundwork\ndescription: Router.\n---\n\nThis is for specialized tasks only.\n',
    );
    const r = run([d]);
    expect(r.stdout).toContain('FAIL orphans');
    expect(r.stdout).toContain('spec');
    expect(r.code).toBe(1);
  });

  it('WARN (and not FAIL) when no router SKILL.md exists', () => {
    const d = makeTempDir();
    makeSkill(d, 'alpha', 'Use something.', 'body');
    // no router file
    const r = run([d]);
    expect(r.stdout).toContain('WARN orphans');
    expect(r.stdout).not.toContain('FAIL orphans');
  });

  it('PASS when skill is referenced via groundwork:<name> form', () => {
    const d = makeTempDir();
    makeSkill(d, 'alpha', 'Use something.', 'body');
    writeFileSync(
      path.join(d, 'SKILL.md'),
      '---\nname: groundwork\ndescription: Router.\n---\n\nUse `groundwork:alpha` for tasks.\n',
    );
    const r = run([d]);
    expect(r.stdout).toContain('PASS orphans');
  });
});

// Module-level helper used by both audit-completeness and audit row validation tests
function setupAuditRepo(headContent: string, wcContent: string) {
  const gitDir = makeGitRepo();
  const skillsDir = path.join(gitDir, 'skills', 'groundwork');
  const skillDir = path.join(skillsDir, 'myskill');
  mkdirSync(skillDir, { recursive: true });

  // Commit HEAD version
  writeFileSync(path.join(skillDir, 'SKILL.md'), headContent);
  execSync('git add .', { cwd: gitDir, env: GIT_ENV });
  execSync('git commit -m "initial"', { cwd: gitDir, env: GIT_ENV });

  // Modify working copy
  writeFileSync(path.join(skillDir, 'SKILL.md'), wcContent);
  return { gitDir, skillsDir };
}

// ── audit-completeness ────────────────────────────────────────────────────────

describe('audit-completeness', () => {

  it('FAIL when a removed sentence is absent from the audit table', () => {
    const head = 'This is the first sentence. This is the second sentence. This is the third sentence.';
    const wc = 'This is the second sentence. This is the third sentence.';
    const { skillsDir } = setupAuditRepo(head, wc);

    // Audit file that does NOT mention the removed sentence
    const auditFile = path.join(skillsDir, 'audit.md');
    writeFileSync(auditFile, '| Some other sentence | dropped-with-reason |\n');

    const r = run([skillsDir, '--audit', 'myskill', auditFile]);
    expect(r.stdout).toContain('FAIL audit-completeness');
    expect(r.stdout).toContain('missing:');
    expect(r.code).toBe(1);
  });

  it('PASS when all removed sentences appear in the audit table', () => {
    const head = 'This is the first sentence. This is the second sentence. This is the third sentence.';
    const wc = 'This is the second sentence. This is the third sentence.';
    const { skillsDir } = setupAuditRepo(head, wc);

    // Audit file that covers the removed sentence
    const auditFile = path.join(skillsDir, 'audit.md');
    writeFileSync(auditFile, '| This is the first sentence. | dropped-with-reason |\n');

    const r = run([skillsDir, '--audit', 'myskill', auditFile]);
    expect(r.stdout).toContain('PASS audit-completeness');
    expect(r.code).toBe(0);
  });

  it('PASS when removed sentence is adjacent to frontmatter boundary and covered in audit', () => {
    // Proves that frontmatter / headings are stripped before sentence-splitting.
    // Old splitSentences fused "---\nname:...\n---\n\n## Setup\n" onto the first sentence,
    // making the removed sentence unrecognisable against the audit table.
    const headContent = [
      '---', 'name: myskill', 'description: Use it for something.', '---',
      '', '## Setup', '',
      'This is a removed sentence. This is a kept sentence.',
    ].join('\n');
    const wcContent = [
      '---', 'name: myskill', 'description: Use it for something.', '---',
      '', '## Setup', '',
      'This is a kept sentence.',
    ].join('\n');
    const { skillsDir } = setupAuditRepo(headContent, wcContent);
    const auditFile = path.join(skillsDir, 'audit.md');
    writeFileSync(auditFile, '| This is a removed sentence. | dropped-with-reason |\n');
    const r = run([skillsDir, '--audit', 'myskill', auditFile]);
    expect(r.stdout).toContain('PASS audit-completeness');
    expect(r.code).toBe(0);
  });

  it('PASS when removed sentence appears only in a table cell with an escaped pipe', () => {
    // Proves: (a) audit file is NOT stripped of table rows, (b) \\| in table is unescaped to |
    // before matching, so a sentence that contains | and is quoted ONLY in a table cell is found.
    const removedSentence = 'Call the function with pipe | notation here.';
    const headContent = [
      '---', 'name: myskill', 'description: Use it.', '---',
      '',
      removedSentence + ' This sentence is kept.',
    ].join('\n');
    const wcContent = [
      '---', 'name: myskill', 'description: Use it.', '---',
      '',
      'This sentence is kept.',
    ].join('\n');
    const { skillsDir } = setupAuditRepo(headContent, wcContent);
    const auditFile = path.join(skillsDir, 'audit.md');
    // Sentence appears ONLY inside a table cell, pipe escaped as \|
    writeFileSync(auditFile,
      '| Call the function with pipe \\| notation here. | dropped-with-reason |\n');
    const r = run([skillsDir, '--audit', 'myskill', auditFile]);
    expect(r.stdout).toContain('PASS audit-completeness');
    expect(r.code).toBe(0);
  });

  it('FAIL when audit file does not exist', () => {
    const head = 'Just one sentence here.';
    const wc = 'Just one sentence here.';
    const { skillsDir } = setupAuditRepo(head, wc);
    const r = run([skillsDir, '--audit', 'myskill', '/nonexistent/audit.md']);
    expect(r.stdout).toContain('FAIL audit-completeness');
    expect(r.code).toBe(1);
  });

  it('PASS using repo-relative path form to audit a top-level SKILL.md (no skill subdirectory)', () => {
    // Proves that --audit accepts a repo-relative .md path, not just a skill directory name.
    // Old script treated the first arg always as a skill name, so "skills/groundwork/SKILL.md"
    // resolved to <skillsDir>/skills/groundwork/SKILL.md/SKILL.md → working copy not found.
    const gitDir = makeGitRepo();
    const skillsDir = path.join(gitDir, 'skills', 'groundwork');
    mkdirSync(skillsDir, { recursive: true });

    const headContent = 'This is a router sentence. This is a kept sentence.';
    const wcContent = 'This is a kept sentence.';

    // Commit HEAD version at the router location (no subdirectory)
    writeFileSync(path.join(skillsDir, 'SKILL.md'), headContent);
    execSync('git add .', { cwd: gitDir, env: GIT_ENV });
    execSync('git commit -m "initial"', { cwd: gitDir, env: GIT_ENV });

    // Modify working copy (sentence removed)
    writeFileSync(path.join(skillsDir, 'SKILL.md'), wcContent);

    const auditFile = path.join(gitDir, 'audit.md');
    writeFileSync(auditFile, '| This is a router sentence. | dropped-with-reason |\n');

    // Pass a repo-relative path instead of a bare skill name
    const r = run([skillsDir, '--audit', 'skills/groundwork/SKILL.md', auditFile]);
    expect(r.stdout).toContain('PASS audit-completeness');
    expect(r.code).toBe(0);
  });
});

// ── audit row validation ──────────────────────────────────────────────────────

describe('audit row validation', () => {
  // Helper: HEAD == WC (no sentence removals), so only row validity matters.
  function setupAuditRowFixture(tableRows: string) {
    const body = 'All sentences are kept here for this test.';
    const { skillsDir } = setupAuditRepo(body, body);
    const auditFile = path.join(skillsDir, 'audit.md');
    // Build a minimal markdown table
    const table = [
      '| Original Sentence | Classification | Reason/Destination |',
      '|---|---|---|',
      ...tableRows.split('\n'),
    ].join('\n');
    writeFileSync(auditFile, table + '\n');
    return { skillsDir, auditFile };
  }

  it('PASS with two tables in one audit file, each with its own header row', () => {
    // Each table has its own header + separator. Old code used a single seenSeparator
    // flag so the second table's header row was treated as a data row with invalid class.
    const { skillsDir } = setupAuditRepo(
      'All sentences are kept here for this test.',
      'All sentences are kept here for this test.',
    );
    const auditFile = path.join(skillsDir, 'audit.md');
    writeFileSync(auditFile, [
      '| Original Sentence | Classification | Reason/Destination |',
      '|---|---|---|',
      '| First removed sentence. | no-op | Redundant restatement of an enforced hook rule |',
      '',
      '| Original Sentence | Classification | Reason/Destination |',
      '|---|---|---|',
      '| Second removed sentence. | moved-to-pointer | Now lives in the advisor-gate skill section |',
    ].join('\n') + '\n');
    const r = run([skillsDir, '--audit', 'myskill', auditFile]);
    expect(r.stdout).toContain('PASS audit-completeness');
    expect(r.code).toBe(0);
  });

  it('PASS when table has a leading # column and classification is found by header name', () => {
    // Old code hardcoded clsCol=1; with a leading # column the class is at col 2.
    // Old code reads col 1 ("some sentence text") → "invalid classification".
    const { skillsDir } = setupAuditRepo(
      'All sentences are kept here for this test.',
      'All sentences are kept here for this test.',
    );
    const auditFile = path.join(skillsDir, 'audit.md');
    writeFileSync(auditFile, [
      '| # | Original Sentence | Classification | Destination/Reason |',
      '|---|---|---|---|',
      '| 1 | Some removed sentence. | no-op | Redundant restatement that adds no information |',
    ].join('\n') + '\n');
    const r = run([skillsDir, '--audit', 'myskill', auditFile]);
    expect(r.stdout).toContain('PASS audit-completeness');
    expect(r.code).toBe(0);
  });

  it('PASS when a table cell contains a backtick code span with | inside it', () => {
    // Old parseCells split on the | inside `cmd | arg`, giving wrong cells.
    const { skillsDir } = setupAuditRepo(
      'All sentences are kept here for this test.',
      'All sentences are kept here for this test.',
    );
    const auditFile = path.join(skillsDir, 'audit.md');
    writeFileSync(auditFile, [
      '| Original Sentence | Classification | Destination/Reason |',
      '|---|---|---|',
      '| Sentence with `CANARY | grep -A5 podAnnotations` inline. | no-op | Redundant restatement that adds no information |',
    ].join('\n') + '\n');
    const r = run([skillsDir, '--audit', 'myskill', auditFile]);
    expect(r.stdout).toContain('PASS audit-completeness');
    expect(r.code).toBe(0);
  });

  it('PASS with a clean table whose rows are all valid', () => {
    const { skillsDir, auditFile } = setupAuditRowFixture(
      '| Some removed sentence was here. | no-op | Redundant restatement of an enforced hook |',
    );
    const r = run([skillsDir, '--audit', 'myskill', auditFile]);
    expect(r.stdout).toContain('PASS audit-completeness');
    expect(r.code).toBe(0);
  });

  it('FAIL when a row has an invalid classification (not one of the four classes)', () => {
    const { skillsDir, auditFile } = setupAuditRowFixture(
      '| Some sentence. | removed | Deleted because it was old and no longer relevant |',
    );
    const r = run([skillsDir, '--audit', 'myskill', auditFile]);
    expect(r.stdout).toContain('FAIL audit-completeness');
    expect(r.stdout).toMatch(/invalid classification.*removed/);
    expect(r.code).toBe(1);
  });

  it('FAIL when a row reason/destination cell is under 15 characters', () => {
    const { skillsDir, auditFile } = setupAuditRowFixture(
      '| Some sentence. | no-op | ok |',
    );
    const r = run([skillsDir, '--audit', 'myskill', auditFile]);
    expect(r.stdout).toContain('FAIL audit-completeness');
    expect(r.stdout).toMatch(/reason.*(too short|under 15)/i);
    expect(r.code).toBe(1);
  });

  it('FAIL when a row reason starts with a parser diagnostic pattern', () => {
    const { skillsDir, auditFile } = setupAuditRowFixture(
      '| Some sentence. | dropped-with-reason | Section not matched: heading text was here |',
    );
    const r = run([skillsDir, '--audit', 'myskill', auditFile]);
    expect(r.stdout).toContain('FAIL audit-completeness');
    expect(r.stdout).toMatch(/invalid reason/);
    expect(r.code).toBe(1);
  });
});

// ── hooks-baseline ────────────────────────────────────────────────────────────

describe('hooks-baseline', () => {
  it('FAIL when baseline count differs from actual hooks count', () => {
    const d = makeTempDir();
    const fakeBaseline = path.join(d, 'baseline.json');
    writeFileSync(fakeBaseline, JSON.stringify({ hooks_baseline: 999 }));
    const r = run([d, '--baseline-file', fakeBaseline]);
    expect(r.stdout).toContain('FAIL hooks-baseline');
    expect(r.stdout).toContain('expected=999');
    expect(r.code).toBe(1);
  });

  it('PASS when baseline count matches actual hooks count', () => {
    const d = makeTempDir();
    // Use the real baseline file shipped with this slice
    const realBaseline = path.join(REPO_ROOT, 'scripts', 'check-skill-standard.baseline.json');
    const r = run([d, '--baseline-file', realBaseline]);
    expect(r.stdout).toContain('PASS hooks-baseline');
  });

  it('FAIL when baseline file does not exist', () => {
    const d = makeTempDir();
    const r = run([d, '--baseline-file', '/nonexistent/baseline.json']);
    expect(r.stdout).toContain('FAIL hooks-baseline');
    expect(r.code).toBe(1);
  });
});
