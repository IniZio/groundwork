import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  COMMIT_TYPES,
  SCOPE_PATTERN,
  SUBJECT_CAP,
  BODY_MAX_LINES,
  lintMessage,
} from '../../hooks/lib/commit-convention.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

describe('constants', () => {
  it('COMMIT_TYPES includes expected types', () => {
    for (const t of ['feat', 'fix', 'docs', 'style', 'refactor', 'perf', 'test', 'build', 'ci', 'chore', 'revert']) {
      expect(COMMIT_TYPES).toContain(t);
    }
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
