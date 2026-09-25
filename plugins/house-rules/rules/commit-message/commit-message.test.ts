import { describe, it, expect, afterEach } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  lintCommitMessage,
  readConfigPreset,
  PRESET_HANDBOOK,
  PRESET_CONVENTIONAL,
  PRESET_BODY_ONLY,
} from './lint.mjs'

// --- readConfigPreset ---

describe('readConfigPreset', () => {
  let tmpDir: string

  afterEach(() => {
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true })
  })

  it('returns handbook when null passed', () => {
    expect(readConfigPreset(null)).toBe(PRESET_HANDBOOK)
  })

  it('returns handbook when no .house-rules.json exists', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'hr-test-'))
    expect(readConfigPreset(tmpDir)).toBe(PRESET_HANDBOOK)
  })

  it('returns conventional when config says conventional', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'hr-test-'))
    writeFileSync(
      join(tmpDir, '.house-rules.json'),
      JSON.stringify({ 'commit-message': { preset: 'conventional' } }),
    )
    expect(readConfigPreset(tmpDir)).toBe(PRESET_CONVENTIONAL)
  })

  it('returns handbook for unknown preset value', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'hr-test-'))
    writeFileSync(
      join(tmpDir, '.house-rules.json'),
      JSON.stringify({ 'commit-message': { preset: 'unknown-preset' } }),
    )
    expect(readConfigPreset(tmpDir)).toBe(PRESET_HANDBOOK)
  })
})

// --- handbook preset ---

describe('lintCommitMessage – handbook preset', () => {
  const opts = { preset: PRESET_HANDBOOK } as const

  it('passes with imperative verb Add ≤50 chars', () => {
    const result = lintCommitMessage('Add user authentication', opts)
    expect(result.violations).toHaveLength(0)
  })

  it('passes with Fix', () => {
    const result = lintCommitMessage('Fix null pointer in parser', opts)
    expect(result.violations).toHaveLength(0)
  })

  it('passes with Remove', () => {
    const result = lintCommitMessage('Remove deprecated API endpoint', opts)
    expect(result.violations).toHaveLength(0)
  })

  it('passes with Update', () => {
    const result = lintCommitMessage('Update README with new instructions', opts)
    expect(result.violations).toHaveLength(0)
  })

  it('passes with Refactor', () => {
    const result = lintCommitMessage('Refactor database connection pooling', opts)
    expect(result.violations).toHaveLength(0)
  })

  it('passes with Test', () => {
    const result = lintCommitMessage('Test edge cases in parser', opts)
    expect(result.violations).toHaveLength(0)
  })

  it('passes with body separated by blank line', () => {
    const result = lintCommitMessage('Add feature\n\nThis is the body.', opts)
    expect(result.violations).toHaveLength(0)
  })

  it('fails conventional-format subject (wrong verb pattern)', () => {
    const result = lintCommitMessage('feat: add new feature', opts)
    expect(result.violations.length).toBeGreaterThan(0)
  })

  it('fails subject >50 chars', () => {
    const subject = 'Add ' + 'x'.repeat(50)
    const result = lintCommitMessage(subject, opts)
    expect(result.violations.length).toBeGreaterThan(0)
    expect(result.violations.some(v => v.reason.includes('50'))).toBe(true)
  })
})

// --- conventional preset ---

describe('lintCommitMessage – conventional preset', () => {
  const opts = { preset: PRESET_CONVENTIONAL } as const

  it('passes type(scope): desc', () => {
    const result = lintCommitMessage('feat(auth): add OAuth2 support', opts)
    expect(result.violations).toHaveLength(0)
  })

  it('passes type: desc without scope', () => {
    const result = lintCommitMessage('fix: resolve null pointer', opts)
    expect(result.violations).toHaveLength(0)
  })

  it('fails handbook-style subject (no type prefix)', () => {
    const result = lintCommitMessage('Add user authentication', opts)
    expect(result.violations.length).toBeGreaterThan(0)
  })

  it('fails unknown type', () => {
    const result = lintCommitMessage('unknown: some change', opts)
    expect(result.violations.length).toBeGreaterThan(0)
    expect(result.violations.some(v => v.reason.includes('Unknown type'))).toBe(true)
  })

  it('fails when body is present (conventional disallows body)', () => {
    const result = lintCommitMessage('feat: add thing\n\nbody text', opts)
    expect(result.violations.length).toBeGreaterThan(0)
  })

  it('fails when line 2 is not blank (missing blank separator)', () => {
    const result = lintCommitMessage('feat: add thing\nbody text', opts)
    expect(result.violations.length).toBeGreaterThan(0)
  })
})

// --- conventional 72-char cap bite proof (Decision B) ---

describe('lintCommitMessage – conventional 72-char cap (bite proof)', () => {
  it('73-char subject fails cap — bites: would pass if cap were 720', () => {
    // Subject is exactly 73 chars: "feat: " (6) + 67 x chars = 73 total
    const subject = 'feat: ' + 'x'.repeat(67)  // length = 73
    expect(subject.length).toBe(73)
    const result = lintCommitMessage(subject, { preset: PRESET_CONVENTIONAL })
    // Must have a cap violation — if the cap were changed to 720, this test would fail
    expect(result.violations.length).toBeGreaterThan(0)
    expect(result.violations.some(v => v.reason.includes('72'))).toBe(true)
  })

  it('72-char subject passes cap exactly', () => {
    // Subject is exactly 72 chars: "feat: " (6) + 66 x chars = 72 total
    const subject = 'feat: ' + 'x'.repeat(66)  // length = 72
    expect(subject.length).toBe(72)
    const result = lintCommitMessage(subject, { preset: PRESET_CONVENTIONAL })
    expect(result.violations).toHaveLength(0)
  })
})

// --- body-only preset (Decision C: .gitmessage repos) ---

describe('lintCommitMessage – body-only preset (Decision C: .gitmessage repos)', () => {
  it('allows any subject grammar', () => {
    const result = lintCommitMessage('anything goes for subject', { preset: PRESET_BODY_ONLY })
    expect(result.violations).toHaveLength(0)
  })

  it('allows conventional-style subject too', () => {
    const result = lintCommitMessage('feat: add thing', { preset: PRESET_BODY_ONLY })
    expect(result.violations).toHaveLength(0)
  })

  it('denies body (no body allowed)', () => {
    const result = lintCommitMessage('any subject\n\nbody text here', { preset: PRESET_BODY_ONLY })
    expect(result.violations.length).toBeGreaterThan(0)
    expect(result.violations.some(v => v.group === 'body')).toBe(true)
  })

  it('denies body bullet markers', () => {
    const result = lintCommitMessage('any subject\n\n- a bullet point', { preset: PRESET_BODY_ONLY })
    expect(result.violations.length).toBeGreaterThan(0)
    expect(result.violations.some(v => v.reason.includes('bullet'))).toBe(true)
  })

  it('allows subject-only message', () => {
    const result = lintCommitMessage('subject only no body', { preset: PRESET_BODY_ONLY })
    expect(result.violations).toHaveLength(0)
  })
})

// --- config-driven ---

describe('config-driven preset', () => {
  let tmpDir: string

  afterEach(() => {
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true })
  })

  it('reads conventional from .house-rules.json and applies it', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'hr-test-'))
    writeFileSync(
      join(tmpDir, '.house-rules.json'),
      JSON.stringify({ 'commit-message': { preset: 'conventional' } }),
    )
    const preset = readConfigPreset(tmpDir)
    expect(preset).toBe(PRESET_CONVENTIONAL)
    const result = lintCommitMessage('feat: add something', { preset })
    expect(result.violations).toHaveLength(0)
  })

  it('defaults to handbook without config', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'hr-test-'))
    const preset = readConfigPreset(tmpDir)
    expect(preset).toBe(PRESET_HANDBOOK)
    const result = lintCommitMessage('Add something useful', { preset })
    expect(result.violations).toHaveLength(0)
  })
})
