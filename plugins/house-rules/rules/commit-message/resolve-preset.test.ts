/**
 * TDD tests for resolvePreset(repoRoot).
 * Uses real temp git repos — no ambient cwd or CLAUDE_PROJECT_DIR.
 */
import { describe, it, expect, afterEach } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'
import {
  resolvePreset,
  lintCommitMessage,
  PRESET_HANDBOOK,
  PRESET_CONVENTIONAL,
} from './lint.mjs'

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'rp-test-'))
}

function gitInit(dir: string): void {
  execFileSync('git', ['init', '-b', 'main', dir], { stdio: 'ignore' })
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir, stdio: 'ignore' })
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir, stdio: 'ignore' })
  execFileSync('git', ['config', 'commit.gpgsign', 'false'], { cwd: dir, stdio: 'ignore' })
}

function commit(dir: string, msg: string, n = 1): void {
  for (let i = 0; i < n; i++) {
    writeFileSync(join(dir, `f${Date.now()}-${i}.txt`), `${i}`)
    execFileSync('git', ['add', '-A'], { cwd: dir, stdio: 'ignore' })
    execFileSync('git', ['commit', '--no-verify', '-m', msg], { cwd: dir, stdio: 'ignore' })
  }
}

function conventionalCommits(dir: string, count = 12): void {
  const msgs = [
    'feat(auth): add OAuth2 provider',
    'fix(api): handle null response from upstream',
    'chore: update dependencies',
    'refactor(docs): merge docs/ into doc/',
    'test(auth): add token expiry tests',
    'ci: pin node version in workflow',
    'feat(ui): add dark mode toggle',
    'fix: resolve race condition in queue',
    'docs: update contributing guide',
    'chore(deps): bump axios to 1.6',
    'refactor: extract shared utilities',
    'feat!: redesign public API',
  ]
  for (let i = 0; i < count; i++) {
    commit(dir, msgs[i % msgs.length])
  }
}

function handbookCommits(dir: string, count = 12): void {
  const msgs = [
    'Add OAuth2 provider',
    'Fix null response from upstream',
    'Remove deprecated endpoint',
    'Update dependency versions',
    'Refactor shared utilities',
    'Test token expiry edge cases',
    'Add dark mode toggle',
    'Fix race condition in queue',
    'Update contributing guide',
    'Add axios integration',
    'Refactor queue module',
    'Add public API v2',
  ]
  for (let i = 0; i < count; i++) {
    commit(dir, msgs[i % msgs.length])
  }
}

// ---------------------------------------------------------------------------
// test state
// ---------------------------------------------------------------------------

let tmpDir: string

afterEach(() => {
  if (tmpDir) {
    rmSync(tmpDir, { recursive: true, force: true })
    tmpDir = ''
  }
})

// ---------------------------------------------------------------------------
// baseline: resolvePreset exists and is exported (fails before implementation)
// ---------------------------------------------------------------------------

describe('resolvePreset – export exists', () => {
  it('resolvePreset is a function', () => {
    expect(typeof resolvePreset).toBe('function')
  })
})

// ---------------------------------------------------------------------------
// null/undefined/empty → handbook
// ---------------------------------------------------------------------------

describe('resolvePreset – null / no git', () => {
  it('returns handbook for null repoRoot', () => {
    expect(resolvePreset(null)).toBe(PRESET_HANDBOOK)
  })

  it('returns handbook for undefined repoRoot', () => {
    expect(resolvePreset(undefined)).toBe(PRESET_HANDBOOK)
  })

  it('returns handbook for a dir that is not a git repo (no history)', () => {
    tmpDir = makeTmpDir()
    expect(resolvePreset(tmpDir)).toBe(PRESET_HANDBOOK)
  })

  it('returns handbook for a fresh git repo with no commits', () => {
    tmpDir = makeTmpDir()
    gitInit(tmpDir)
    expect(resolvePreset(tmpDir)).toBe(PRESET_HANDBOOK)
  })
})

// ---------------------------------------------------------------------------
// .house-rules.json pin wins over everything
// ---------------------------------------------------------------------------

describe('resolvePreset – .house-rules.json pin', () => {
  it('returns conventional from explicit pin even with no history', () => {
    tmpDir = makeTmpDir()
    gitInit(tmpDir)
    writeFileSync(
      join(tmpDir, '.house-rules.json'),
      JSON.stringify({ 'commit-message': { preset: 'conventional' } }),
    )
    expect(resolvePreset(tmpDir)).toBe(PRESET_CONVENTIONAL)
  })

  it('returns handbook from explicit handbook pin even in a conventional-history repo', () => {
    tmpDir = makeTmpDir()
    gitInit(tmpDir)
    conventionalCommits(tmpDir)
    writeFileSync(
      join(tmpDir, '.house-rules.json'),
      JSON.stringify({ 'commit-message': { preset: 'handbook' } }),
    )
    expect(resolvePreset(tmpDir)).toBe(PRESET_HANDBOOK)
  })
})

// ---------------------------------------------------------------------------
// commitlint config → conventional
// ---------------------------------------------------------------------------

describe('resolvePreset – commitlint config', () => {
  it('returns conventional when commitlint.config.js is present', () => {
    tmpDir = makeTmpDir()
    gitInit(tmpDir)
    writeFileSync(join(tmpDir, 'commitlint.config.js'), "module.exports = { extends: ['@commitlint/config-conventional'] }\n")
    expect(resolvePreset(tmpDir)).toBe(PRESET_CONVENTIONAL)
  })

  it('returns conventional when .commitlintrc is present', () => {
    tmpDir = makeTmpDir()
    gitInit(tmpDir)
    writeFileSync(join(tmpDir, '.commitlintrc'), JSON.stringify({ extends: ['@commitlint/config-conventional'] }))
    expect(resolvePreset(tmpDir)).toBe(PRESET_CONVENTIONAL)
  })

  it('returns conventional when .commitlintrc.json is present', () => {
    tmpDir = makeTmpDir()
    gitInit(tmpDir)
    writeFileSync(join(tmpDir, '.commitlintrc.json'), JSON.stringify({ extends: ['@commitlint/config-conventional'] }))
    expect(resolvePreset(tmpDir)).toBe(PRESET_CONVENTIONAL)
  })

  it('returns conventional when package.json has commitlint key', () => {
    tmpDir = makeTmpDir()
    gitInit(tmpDir)
    writeFileSync(
      join(tmpDir, 'package.json'),
      JSON.stringify({ name: 'test', commitlint: { extends: ['@commitlint/config-conventional'] } }),
    )
    expect(resolvePreset(tmpDir)).toBe(PRESET_CONVENTIONAL)
  })

  it('does NOT trigger on package.json without commitlint key', () => {
    tmpDir = makeTmpDir()
    gitInit(tmpDir)
    writeFileSync(join(tmpDir, 'package.json'), JSON.stringify({ name: 'test', version: '1.0.0' }))
    expect(resolvePreset(tmpDir)).toBe(PRESET_HANDBOOK)
  })
})

// ---------------------------------------------------------------------------
// history inference: ≥50% conventional → conventional
// ---------------------------------------------------------------------------

describe('resolvePreset – history inference', () => {
  it('returns conventional for a repo with all-conventional history (≥50%)', () => {
    tmpDir = makeTmpDir()
    gitInit(tmpDir)
    conventionalCommits(tmpDir, 12)
    expect(resolvePreset(tmpDir)).toBe(PRESET_CONVENTIONAL)
  })

  it('returns handbook for a repo with all-handbook history', () => {
    tmpDir = makeTmpDir()
    gitInit(tmpDir)
    handbookCommits(tmpDir, 12)
    expect(resolvePreset(tmpDir)).toBe(PRESET_HANDBOOK)
  })

  it('returns handbook for a repo with too few commits (boundary: 0)', () => {
    tmpDir = makeTmpDir()
    gitInit(tmpDir)
    // no commits
    expect(resolvePreset(tmpDir)).toBe(PRESET_HANDBOOK)
  })

  it('returns conventional when exactly half match conventional', () => {
    tmpDir = makeTmpDir()
    gitInit(tmpDir)
    // 6 conventional + 6 handbook = 50% conventional → should be conventional
    conventionalCommits(tmpDir, 6)
    handbookCommits(tmpDir, 6)
    expect(resolvePreset(tmpDir)).toBe(PRESET_CONVENTIONAL)
  })
})

// ---------------------------------------------------------------------------
// The nexus incident: refactor(docs): merge docs/ into doc/ passes
// ---------------------------------------------------------------------------

describe('resolvePreset – nexus incident: refactor(docs) accepted in conventional repo', () => {
  it('resolves conventional for a repo with conventional history', () => {
    tmpDir = makeTmpDir()
    gitInit(tmpDir)
    conventionalCommits(tmpDir, 12)
    expect(resolvePreset(tmpDir)).toBe(PRESET_CONVENTIONAL)
  })

  it('refactor(docs): merge docs/ into doc/ passes conventional linting', () => {
    const result = lintCommitMessage('refactor(docs): merge docs/ into doc/', {
      preset: PRESET_CONVENTIONAL,
    })
    expect(result.violations).toHaveLength(0)
  })

  it('Add stuff passes handbook linting', () => {
    const result = lintCommitMessage('Add stuff', { preset: PRESET_HANDBOOK })
    expect(result.violations).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Regression: long subjects must not prevent conventional detection
// (nexus regression: 30 conventional subjects, ≥11 exceed 72 chars → must
//  still resolve conventional, and refactor(docs):… must lint clean)
// ---------------------------------------------------------------------------

describe('resolvePreset – long-subject regression (nexus incident)', () => {
  function makeLongConventionalSubject(i: number): string {
    const pad = i < 15 ? ' with a very long description that pushes this past seventy-two chars easily' : ''
    return `feat(module-${i}): add feature implementation${pad}`
  }

  it('resolves conventional for 20 subjects even when >11 exceed 72 chars', () => {
    tmpDir = makeTmpDir()
    gitInit(tmpDir)
    for (let i = 0; i < 20; i++) {
      commit(tmpDir, makeLongConventionalSubject(i))
    }
    expect(resolvePreset(tmpDir)).toBe(PRESET_CONVENTIONAL)
  })

  it('refactor(docs): merge docs/ into doc/ lints clean in a long-subject conventional repo', () => {
    const result = lintCommitMessage('refactor(docs): merge docs/ into doc/', {
      preset: PRESET_CONVENTIONAL,
    })
    expect(result.violations).toHaveLength(0)
  })

  it('a new >72-char conventional subject is still denied for length', () => {
    const longSubject = 'feat(scope): this is a very long conventional commit subject that exceeds seventy-two characters'
    const result = lintCommitMessage(longSubject, { preset: PRESET_CONVENTIONAL })
    expect(result.violations.some(v => v.reason.includes('≤72'))).toBe(true)
  })
})
