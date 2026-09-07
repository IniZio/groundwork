import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  COMMIT_TYPES,
  SCOPE_PATTERN,
  SUBJECT_CAP,
  BODY_MAX_LINES,
  lintMessage,
  getMotiveSlugs,
} from '../../hooks/lib/commit-convention.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

describe('constants', () => {
  it('COMMIT_TYPES is exactly the expected set — adding or removing any type turns this red', () => {
    const expected = ['feat', 'fix', 'docs', 'style', 'refactor', 'perf', 'test', 'build', 'ci', 'chore', 'revert'];
    expect([...COMMIT_TYPES].sort()).toEqual([...expected].sort());
  });

  it('SCOPE_PATTERN accepts alphanumeric, dots, commas, hyphens, underscores', () => {
    expect(SCOPE_PATTERN.test('hooks')).toBe(true);
    expect(SCOPE_PATTERN.test('hooks,lib')).toBe(true);
    expect(SCOPE_PATTERN.test('my-scope')).toBe(true);
    expect(SCOPE_PATTERN.test('my.scope')).toBe(true);
  });

  it('SCOPE_PATTERN rejects spaces', () => {
    expect(SCOPE_PATTERN.test('hook lib')).toBe(false);
  });

  it('SUBJECT_CAP is 72', () => {
    expect(SUBJECT_CAP).toBe(72);
  });

  it('BODY_MAX_LINES is 0', () => {
    expect(BODY_MAX_LINES).toBe(0);
  });
});

describe('attribution trailer stripping', () => {
  it('Claude-Session trailer is stripped, no violations', () => {
    const msg = 'feat: add something\n\nClaude-Session: https://claude.ai/code/session_abc123';
    const { stripped, violations } = lintMessage(msg);
    expect(violations).toHaveLength(0);
    expect(stripped).not.toContain('Claude-Session');
  });

  it('Co-Authored-By Claude trailer is stripped, no violations', () => {
    const msg = 'fix: correct bug\n\nCo-Authored-By: Claude <noreply@anthropic.com>';
    const { stripped, violations } = lintMessage(msg);
    expect(violations).toHaveLength(0);
    expect(stripped).not.toContain('Co-Authored-By');
  });

  it('Generated with Claude Code trailer is stripped, no violations', () => {
    const msg = 'chore: tidy up\n\nGenerated with Claude Code';
    const { stripped, violations } = lintMessage(msg);
    expect(violations).toHaveLength(0);
    expect(stripped).not.toContain('Generated with Claude Code');
  });

  it('valid subject + attribution trailer: stripped has no trailer, no violations', () => {
    const msg = [
      'feat(hooks): add commit-message lint module',
      '',
      'Claude-Session: https://claude.ai/code/session_abc123',
    ].join('\n');
    const { stripped, violations } = lintMessage(msg);
    expect(violations).toHaveLength(0);
    expect(stripped).not.toContain('Claude-Session');
    expect(stripped).toContain('feat(hooks)');
  });
});

describe('process vocab denylist', () => {
  it('line 1 "gate cycle" → violation at line 1', () => {
    const msg = 'chore: third gate cycle cleanup';
    const { violations } = lintMessage(msg);
    expect(violations.some(v => v.line === 1 && v.reason.includes('gate cycle'))).toBe(true);
  });

  it('line 3 "dogfood cleanup" → violation at line 3', () => {
    const msg = 'chore: normal subject\n\ndogfood cleanup of 12 touched files';
    const { violations } = lintMessage(msg);
    expect(violations.some(v => v.line === 3 && v.reason.includes('dogfood'))).toBe(true);
  });

  it('line 1 "T4" as a word → violation (slice id)', () => {
    const msg = 'chore: fix T4 issue';
    const { violations } = lintMessage(msg);
    expect(violations.some(v => v.line === 1)).toBe(true);
  });

  it('"T4EST" does not trigger T4 word-boundary violation', () => {
    const msg = 'chore: fix T4EST issue';
    const { violations } = lintMessage(msg);
    const sliceViolations = violations.filter(v => v.reason.includes('slice id'));
    expect(sliceViolations).toHaveLength(0);
  });

  it('line 1 "D-7" → violation (decision id)', () => {
    const msg = 'chore: implements D-7 requirement';
    const { violations } = lintMessage(msg);
    expect(violations.some(v => v.line === 1)).toBe(true);
  });

  it('line 3 "advisor APPROVE" → violation at line 3', () => {
    const msg = 'chore: normal subject\n\nadvisor APPROVE recorded';
    const { violations } = lintMessage(msg);
    expect(violations.some(v => v.line === 3 && v.reason.includes('advisor'))).toBe(true);
  });
});

describe('valid messages pass clean', () => {
  it('feat(hooks): add commit-message lint module → no violations', () => {
    const { violations } = lintMessage('feat(hooks): add commit-message lint module');
    expect(violations).toHaveLength(0);
  });

  it('fix: correct subject line length check → passes', () => {
    const { violations } = lintMessage('fix: correct subject line length check');
    expect(violations).toHaveLength(0);
  });

  it('chore(hooks,lib): extract shared convention → scope with comma passes', () => {
    const { violations } = lintMessage('chore(hooks,lib): extract shared convention');
    expect(violations).toHaveLength(0);
  });

  it('feat!: breaking change subject → passes', () => {
    const { violations } = lintMessage('feat!: breaking change subject');
    expect(violations).toHaveLength(0);
  });
});

describe('body line limit (BODY_MAX_LINES)', () => {
  it('exactly BODY_MAX_LINES non-blank body lines → no body violation', () => {
    const bodyLines = Array.from({ length: BODY_MAX_LINES }, (_, i) => `Body line ${i + 1}`);
    const msg = ['feat: subject', '', ...bodyLines].join('\n');
    const { violations } = lintMessage(msg);
    expect(violations.filter(v => v.reason.toLowerCase().includes('body'))).toHaveLength(0);
  });

  it('BODY_MAX_LINES + 1 non-blank body lines → violation mentioning body exceeds', () => {
    const bodyLines = Array.from({ length: BODY_MAX_LINES + 1 }, (_, i) => `Body line ${i + 1}`);
    const msg = ['feat: subject', '', ...bodyLines].join('\n');
    const { violations } = lintMessage(msg);
    expect(violations.some(v => v.reason.toLowerCase().includes('body'))).toBe(true);
  });
});

describe('blank line separator', () => {
  it('subject with no blank line before body → violation at line 2', () => {
    const msg = 'feat: subject\nThis body has no blank separator';
    const { violations } = lintMessage(msg);
    expect(violations.some(v => v.line === 2)).toBe(true);
  });
});

describe('subject format violations', () => {
  it('"invalid: subject" (type not in list) → violation at line 1', () => {
    const { violations } = lintMessage('invalid: subject here');
    expect(violations.some(v => v.line === 1)).toBe(true);
  });

  it('"feat: " (empty subject after colon-space) → violation at line 1', () => {
    const { violations } = lintMessage('feat: ');
    expect(violations.some(v => v.line === 1)).toBe(true);
  });
});

describe('AC-2 source-of-truth', () => {
  it('COMMIT_TYPES list appears in exactly one source file (AC-2)', () => {
    // Co-occurrence of four marker terms across tracked files: order-insensitive and
    // line-wrapping-insensitive — not evadable by reordering or reformatting the list.
    const allMatches = execSync(
      `cd ${repoRoot} && git ls-files | xargs grep -l 'refactor' | xargs grep -l 'revert' | xargs grep -l 'chore' | xargs grep -l 'perf' 2>/dev/null || true`,
      { encoding: 'utf8' }
    ).trim().split('\n').filter(Boolean);

    const permitted = new Set([
      '.gitmessage',                                                                    // mirror — AC-11 drift check guards it
      'doc/specs/enforcement/requirements/enforcement-r-018-commit-message-gate.md',   // mirror — AC-2 spec-mirror drift check guards it
      'dist/gw.mjs',                                                                   // generated — check:bundle hash guards it
      'test/fixtures/parity-corpus/commit-message-guard/deny-invalid-commit-type.json', // fixture — test vector, not a source
      'test/hooks/commit-convention.test.ts',                                           // this guard itself
    ]);

    expect(allMatches.length, 'co-occurrence grep returned no results — positive control failed').toBeGreaterThan(0);
    const sources = allMatches.filter(f => !permitted.has(f));
    expect(sources, `unexpected file(s) with all four marker terms: ${sources.join(', ')}`).toHaveLength(1);
    expect(sources[0]).toContain('commit-convention');
  });
});

describe('AC-2 spec-mirror drift check', () => {
  it('spec requirement doc contains all COMMIT_TYPES (AC-2 drift check)', () => {
    const content = readFileSync(
      `${repoRoot}/doc/specs/enforcement/requirements/enforcement-r-018-commit-message-gate.md`,
      'utf8'
    );
    for (const type of COMMIT_TYPES) {
      expect(content, `spec doc missing type: ${type}`).toContain(`\`${type}\``);
    }
  });
});

describe('AC-11 gitmessage drift check', () => {
  it('gitmessage contains all COMMIT_TYPES (AC-11 drift check)', () => {
    const content = readFileSync(`${repoRoot}/.gitmessage`, 'utf8');
    // Derived from module — bare toContain(type) matches 'fix' in 'prefix'; adding a type without updating .gitmessage goes RED.
    const typeListLine = COMMIT_TYPES.join(' | ');
    expect(content, 'gitmessage type list not found or drifted').toContain(typeListLine);
  });

  it('gitmessage reflects SUBJECT_CAP (AC-11 drift check)', () => {
    const content = readFileSync(`${repoRoot}/.gitmessage`, 'utf8');
    expect(content).toContain(String(SUBJECT_CAP));
  });

  it('gitmessage reflects BODY_MAX_LINES policy (AC-11 drift check)', () => {
    const content = readFileSync(`${repoRoot}/.gitmessage`, 'utf8');
    if (BODY_MAX_LINES === 0) {
      expect(content, `BODY_MAX_LINES is 0 but .gitmessage advertises optional body`).toContain('No body');
    } else {
      expect(content).toContain(String(BODY_MAX_LINES));
    }
  });
});

describe('getMotiveSlugs — repo-local scoping (T30)', () => {
  let tempNoGw: string;
  let tempWithSlug: string;
  const TEST_SLUG = 'my-project-feature';

  beforeAll(() => {
    tempNoGw = mkdtempSync(join(tmpdir(), 'gw-slugtest-nogw-'));
    tempWithSlug = mkdtempSync(join(tmpdir(), 'gw-slugtest-withslug-'));
    mkdirSync(join(tempWithSlug, '.groundwork', 'motives', TEST_SLUG), { recursive: true });
  });

  afterAll(() => {
    rmSync(tempNoGw, { recursive: true, force: true });
    rmSync(tempWithSlug, { recursive: true, force: true });
  });

  it('case 1: temp repo with no .groundwork/ → comment-density-gate message is ACCEPTED', () => {
    const slugs = getMotiveSlugs(tempNoGw);
    expect(slugs, 'slugs for repo with no .groundwork/ must be empty').toHaveLength(0);
    const { violations } = lintMessage('fix: update comment-density-gate config', { motiveSlugs: slugs });
    expect(violations.filter(v => v.reason.includes('motive slug'))).toHaveLength(0);
  });

  it('case 2: groundwork own repo → comment-density-gate message is REJECTED', () => {
    const slugs = getMotiveSlugs(repoRoot);
    expect(slugs).toContain('comment-density-gate');
    const { violations } = lintMessage('fix: update comment-density-gate config', { motiveSlugs: slugs });
    expect(violations.some(v => v.reason.includes('comment-density-gate'))).toBe(true);
  });

  it('case 3: temp repo with own motive slug → that slug is REJECTED', () => {
    const slugs = getMotiveSlugs(tempWithSlug);
    expect(slugs).toContain(TEST_SLUG);
    const { violations } = lintMessage(`fix: add ${TEST_SLUG} support`, { motiveSlugs: slugs });
    expect(violations.some(v => v.reason.includes(TEST_SLUG))).toBe(true);
  });

  it('case 4a: "gate cycle" rejected even in repo with no .groundwork/', () => {
    const slugs = getMotiveSlugs(tempNoGw);
    const { violations } = lintMessage('chore: third gate cycle cleanup', { motiveSlugs: slugs });
    expect(violations.some(v => v.reason.includes('gate cycle'))).toBe(true);
  });

  it('case 4b: T4 slice id rejected even in repo with no .groundwork/', () => {
    const slugs = getMotiveSlugs(tempNoGw);
    const { violations } = lintMessage('chore: fix T4 issue', { motiveSlugs: slugs });
    expect(violations.some(v => v.reason.includes('slice id'))).toBe(true);
  });

  it('case 4c: D-7 decision id rejected even in repo with no .groundwork/', () => {
    const slugs = getMotiveSlugs(tempNoGw);
    const { violations } = lintMessage('chore: implements D-7 requirement', { motiveSlugs: slugs });
    expect(violations.some(v => v.reason.includes('decision id'))).toBe(true);
  });
});
