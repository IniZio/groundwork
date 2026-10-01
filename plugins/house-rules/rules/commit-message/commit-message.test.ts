import { describe, it, expect } from 'bun:test'
import {
  lintCommitMessage,
  PRESET_HANDBOOK,
  PRESET_CONVENTIONAL,
  PRESET_SUBJECT_ONLY,
} from './lint.mjs'

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

  it('denies a body after a blank line', () => {
    const result = lintCommitMessage('Fix x\n\nbody', opts)
    expect(result.violations.some(v => v.group === 'body' && v.reason === 'No body is permitted in this repository')).toBe(true)
  })

  it('allows subject only, with or without trailing newline', () => {
    expect(lintCommitMessage('Fix x', opts).violations).toHaveLength(0)
    expect(lintCommitMessage('Fix x\n', opts).violations).toHaveLength(0)
  })

  it('still skips subject checks but not body check for fixup!', () => {
    expect(lintCommitMessage('fixup! anything', opts).violations).toHaveLength(0)
    expect(lintCommitMessage('squash! anything', opts).violations).toHaveLength(0)
    for (const m of ['fixup! x\n\nbody', 'squash! x\n\nbody']) {
      expect(lintCommitMessage(m, opts).violations.some(v => v.group === 'body')).toBe(true)
    }
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

  it('fails empty scope in parentheses', () => {
    const result = lintCommitMessage('feat(): add thing', opts)
    expect(result.violations.length).toBeGreaterThan(0)
    expect(result.violations.some(v => v.reason.includes('empty scope'))).toBe(true)
  })

  it('fails invalid scope token (space in scope)', () => {
    const result = lintCommitMessage('feat(a b): add thing', opts)
    expect(result.violations.length).toBeGreaterThan(0)
    expect(result.violations.some(v => v.reason.includes('valid scope token'))).toBe(true)
  })
})

// --- conventional 72-char cap bite proof (Decision B) ---

describe('lintCommitMessage – conventional 72-char cap (bite proof)', () => {
  it('73-char subject fails cap — bites: would pass if cap were 720', () => {
    // Subject is exactly 73 chars: "feat: " (6) + 67 x chars = 73 total
    const subject = 'feat: ' + 'x'.repeat(67)
    expect(subject.length).toBe(73)
    const result = lintCommitMessage(subject, { preset: PRESET_CONVENTIONAL })
    expect(result.violations.length).toBeGreaterThan(0)
    expect(result.violations.some(v => v.reason.includes('72'))).toBe(true)
  })

  it('72-char subject passes cap exactly', () => {
    const subject = 'feat: ' + 'x'.repeat(66)
    expect(subject.length).toBe(72)
    const result = lintCommitMessage(subject, { preset: PRESET_CONVENTIONAL })
    expect(result.violations).toHaveLength(0)
  })
})


describe('lintCommitMessage – subject-only preset (Decision C: .gitmessage repos)', () => {
  it('allows any subject grammar', () => {
    const result = lintCommitMessage('anything goes for subject', { preset: PRESET_SUBJECT_ONLY })
    expect(result.violations).toHaveLength(0)
  })

  it('allows conventional-style subject too', () => {
    const result = lintCommitMessage('feat: add thing', { preset: PRESET_SUBJECT_ONLY })
    expect(result.violations).toHaveLength(0)
  })

  it('denies body (no body allowed)', () => {
    const result = lintCommitMessage('any subject\n\nbody text here', { preset: PRESET_SUBJECT_ONLY })
    expect(result.violations.length).toBeGreaterThan(0)
    expect(result.violations.some(v => v.group === 'body')).toBe(true)
  })

  it('denies body bullet markers', () => {
    const result = lintCommitMessage('any subject\n\n- a bullet point', { preset: PRESET_SUBJECT_ONLY })
    expect(result.violations.length).toBeGreaterThan(0)
    expect(result.violations.some(v => v.reason.includes('bullet'))).toBe(true)
  })

  it('allows subject-only message', () => {
    const result = lintCommitMessage('subject only no body', { preset: PRESET_SUBJECT_ONLY })
    expect(result.violations).toHaveLength(0)
  })
})

describe('preset defaults and constants', () => {
  it('absent preset falls back to handbook', () => {
    const result = lintCommitMessage('bad message no type')
    expect(result.preset).toBe(PRESET_HANDBOOK)
    expect(result.violations.length).toBeGreaterThan(0)
    expect(result.violations.some(v => v.group === 'subject')).toBe(true)
  })

  it('PRESET_SUBJECT_ONLY is subject-only', () => {
    expect(PRESET_SUBJECT_ONLY).toBe('subject-only')
  })
})
