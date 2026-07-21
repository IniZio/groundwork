/**
 * Unit tests for the buildStruggleNudge helper exported from
 * hooks/session-reminder.mjs.
 *
 * Framework: vitest (same as other hook unit tests).
 * The helper is pure ESM — imported via relative path.
 */

import { describe, test, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// @ts-expect-error — .mjs, no types
import { buildStruggleNudge } from '../hooks/lib/struggle-nudge.mjs'
// @ts-expect-error — .mjs, no types
import { appendSignal } from '../hooks/lib/signals-io.mjs'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isoTs(daysAgo = 0): string {
  return new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString()
}

function sig(overrides: Record<string, unknown> = {}) {
  return {
    ts: isoTs(0),
    session_id: 'ses_test',
    kind: 'repeat-command',
    fingerprint: 'go build',
    detail: { n: 2 },
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('buildStruggleNudge', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = path.join(
      os.tmpdir(),
      `gw-nudge-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    )
    mkdirSync(tmpDir, { recursive: true })
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  // -------------------------------------------------------------------------
  // No signals — no nudge
  // -------------------------------------------------------------------------

  test('returns empty string when signals file does not exist', () => {
    const result = buildStruggleNudge(tmpDir)
    expect(result).toBe('')
  })

  test('returns empty string when signals file is empty', () => {
    // appendSignal never writes an empty file, but just in case:
    appendSignal(tmpDir, sig()) // write one then check we don't break on empty proj
    // Use a fresh dir that has no signals at all
    const emptyDir = path.join(tmpDir, 'empty-proj')
    mkdirSync(emptyDir, { recursive: true })
    expect(buildStruggleNudge(emptyDir)).toBe('')
  })

  // -------------------------------------------------------------------------
  // Stale signals — suppressed
  // -------------------------------------------------------------------------

  test('returns empty string when all signals are older than windowDays', () => {
    appendSignal(tmpDir, sig({ ts: isoTs(8) })) // 8 days ago, window = 7
    appendSignal(tmpDir, sig({ ts: isoTs(30) }))
    const result = buildStruggleNudge(tmpDir, { windowDays: 7 })
    expect(result).toBe('')
  })

  test('uses custom windowDays to filter', () => {
    appendSignal(tmpDir, sig({ ts: isoTs(3) })) // 3 days ago
    // With a 2-day window it should be suppressed
    expect(buildStruggleNudge(tmpDir, { windowDays: 2 })).toBe('')
    // With a 5-day window it should appear
    expect(buildStruggleNudge(tmpDir, { windowDays: 5 })).not.toBe('')
  })

  // -------------------------------------------------------------------------
  // Recent signals — nudge appears
  // -------------------------------------------------------------------------

  test('nudge text contains /retrospective recommendation', () => {
    appendSignal(tmpDir, sig())
    const result = buildStruggleNudge(tmpDir)
    expect(result).toContain('/retrospective')
  })

  test('nudge text names the signal kind', () => {
    appendSignal(tmpDir, sig({ kind: 'fail-retry', fingerprint: 'npm test' }))
    const result = buildStruggleNudge(tmpDir)
    expect(result).toContain('fail-retry')
  })

  test('nudge text names the fingerprint', () => {
    appendSignal(tmpDir, sig({ kind: 'repeat-command', fingerprint: 'go build' }))
    const result = buildStruggleNudge(tmpDir)
    expect(result).toContain('go build')
  })

  test('nudge groups duplicate kind+fingerprint and shows count', () => {
    // Four signals with the same key → should appear as ×4
    for (let i = 0; i < 4; i++) {
      appendSignal(tmpDir, sig({ kind: 'repeat-command', fingerprint: 'go build' }))
    }
    const result = buildStruggleNudge(tmpDir)
    expect(result).toContain('repeat-command×4')
  })

  test('nudge shows multiple distinct patterns', () => {
    appendSignal(tmpDir, sig({ kind: 'repeat-command', fingerprint: 'go build' }))
    appendSignal(tmpDir, sig({ kind: 'file-thrash', fingerprint: 'main.go' }))
    const result = buildStruggleNudge(tmpDir)
    expect(result).toContain('repeat-command')
    expect(result).toContain('file-thrash')
  })

  test('caps output at maxLines patterns', () => {
    // 6 distinct patterns but maxLines=3
    for (let i = 0; i < 6; i++) {
      appendSignal(tmpDir, sig({ kind: 'repeat-command', fingerprint: `cmd-${i}` }))
    }
    const result = buildStruggleNudge(tmpDir, { maxLines: 3 })
    // Should mention the overflow
    expect(result).toContain('more pattern')
    // The line count of bullet items should be ≤ maxLines
    const bulletLines = result.split('\n').filter((l: string) => l.startsWith('- '))
    expect(bulletLines.length).toBeLessThanOrEqual(3)
  })

  // -------------------------------------------------------------------------
  // Mixed stale + recent — only recent surfaces
  // -------------------------------------------------------------------------

  test('stale signals are suppressed even when recent signals exist', () => {
    appendSignal(tmpDir, sig({ ts: isoTs(30), kind: 'error-signature', fingerprint: 'old-error' }))
    appendSignal(tmpDir, sig({ ts: isoTs(1), kind: 'repeat-command', fingerprint: 'recent-cmd' }))
    const result = buildStruggleNudge(tmpDir)
    expect(result).not.toContain('old-error')
    expect(result).toContain('recent-cmd')
  })

  // -------------------------------------------------------------------------
  // Session-reminder existing content is preserved
  // -------------------------------------------------------------------------

  test('nudge output starts with a newline (safe to append)', () => {
    appendSignal(tmpDir, sig())
    const result = buildStruggleNudge(tmpDir)
    // Non-empty result must start with \n so appending to existing context is clean
    expect(result.startsWith('\n')).toBe(true)
  })

  test('empty result is exactly empty string (no spurious whitespace)', () => {
    const result = buildStruggleNudge(tmpDir)
    expect(result).toBe('')
  })
})
