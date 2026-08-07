/**
 * Unit tests for hooks/lib/gate-seal.mjs
 *
 * Covers acceptance criteria S1-AC1..AC4:
 *   AC1: canonicalReleaseState is deterministic and order-independent.
 *   AC2: verifySeal returns true for untampered; false for each tampered field.
 *   AC3: keyPath resolves correctly; minted key is mode 0600; round-trips via readKey.
 *   AC4: no .d.mts breakage (verified by pnpm run check, not at runtime).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, statSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import {
  SCHEMA_VERSION,
  canonicalReleaseState,
  computeSeal,
  verifySeal,
  keyPath,
  ensureKey,
  readKey,
} from '../../hooks/lib/gate-seal.mjs'

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function makeLedger(overrides: Record<string, unknown> = {}) {
  return {
    schema_version: SCHEMA_VERSION,
    session_id: 'ses-abc123',
    active: true,
    gate: { advisor: 'APPROVE' },
    slices: [
      { id: 'S1', status: 'complete', wave: 0, desc: 'ignored-field' },
      { id: 'S2', status: 'complete', wave: 1 },
      { id: 'S3', status: 'pending', wave: 1 },
    ],
    write_token: 'tok-secret',  // unrelated — must be ignored by canonical
    ...overrides,
  }
}

const TEST_KEY = Buffer.from('a'.repeat(64), 'hex') // 32-byte hex key for tests

// ---------------------------------------------------------------------------
// AC1 — Canonical serialization: deterministic, order-independent
// ---------------------------------------------------------------------------

describe('canonicalReleaseState (AC1)', () => {
  it('produces a stable string for a normal ledger', () => {
    const ledger = makeLedger()
    const s1 = canonicalReleaseState(ledger)
    const s2 = canonicalReleaseState(ledger)
    expect(s1).toBe(s2)
  })

  it('is order-independent: shuffled slice array → identical output', () => {
    const ledgerA = makeLedger()
    const ledgerB = makeLedger({
      slices: [
        { id: 'S3', status: 'pending' },
        { id: 'S1', status: 'complete' },
        { id: 'S2', status: 'complete' },
      ],
    })
    expect(canonicalReleaseState(ledgerA)).toBe(canonicalReleaseState(ledgerB))
  })

  it('unrelated fields (write_token, slice.wave, slice.desc) do not change output', () => {
    const base = canonicalReleaseState(makeLedger())
    const withExtra = canonicalReleaseState(makeLedger({
      write_token: 'different-token',
      extra_field: 'ignored',
      slices: [
        { id: 'S1', status: 'complete', wave: 99, desc: 'changed', unrelated: true },
        { id: 'S2', status: 'complete', tags: ['x'] },
        { id: 'S3', status: 'pending', blocked_by: ['S1'] },
      ],
    }))
    expect(base).toBe(withExtra)
  })

  it('handles gate.advisor as an object with .verdict', () => {
    const stringAdvisor = canonicalReleaseState(makeLedger({ gate: { advisor: 'APPROVE' } }))
    const objAdvisor = canonicalReleaseState(makeLedger({
      gate: { advisor: { verdict: 'APPROVE', citation: 'ignored', rubric: 'ignored' } },
    }))
    expect(stringAdvisor).toBe(objAdvisor)
  })

  it('different release-relevant fields produce different strings', () => {
    const approve = canonicalReleaseState(makeLedger({ gate: { advisor: 'APPROVE' } }))
    const correction = canonicalReleaseState(makeLedger({ gate: { advisor: 'CORRECTION' } }))
    expect(approve).not.toBe(correction)

    const active = canonicalReleaseState(makeLedger({ active: true }))
    const inactive = canonicalReleaseState(makeLedger({ active: false }))
    expect(active).not.toBe(inactive)
  })

  it('output is valid JSON with the expected keys', () => {
    const s = canonicalReleaseState(makeLedger())
    const parsed = JSON.parse(s)
    expect(Object.keys(parsed)).toEqual([
      'schema_version', 'session_id', 'active', 'advisor_verdict', 'slices',
    ])
    expect(parsed.advisor_verdict).toBe('APPROVE')
    expect(parsed.slices).toEqual([
      { id: 'S1', status: 'complete' },
      { id: 'S2', status: 'complete' },
      { id: 'S3', status: 'pending' },
    ])
  })
})

// ---------------------------------------------------------------------------
// AC2 — HMAC compute + verify
// ---------------------------------------------------------------------------

describe('computeSeal / verifySeal (AC2)', () => {
  function sealedLedger(ledger: ReturnType<typeof makeLedger>) {
    const state = canonicalReleaseState(ledger)
    const seal = computeSeal(state, TEST_KEY)
    return { ...ledger, gate: { ...ledger.gate as object, seal } }
  }

  it('verifySeal returns true for an untampered sealed ledger', () => {
    const ledger = sealedLedger(makeLedger())
    expect(verifySeal(ledger, TEST_KEY)).toBe(true)
  })

  it('verifySeal returns false when advisor verdict is changed', () => {
    const ledger = sealedLedger(makeLedger())
    const tampered = { ...ledger, gate: { ...ledger.gate as object, advisor: 'CORRECTION' } }
    expect(verifySeal(tampered, TEST_KEY)).toBe(false)
  })

  it('verifySeal returns false when a slice status is changed', () => {
    const ledger = sealedLedger(makeLedger())
    const tampered = {
      ...ledger,
      slices: ledger.slices.map((s: Record<string, unknown>, i: number) =>
        i === 0 ? { ...s, status: 'pending' } : s,
      ),
    }
    expect(verifySeal(tampered as object, TEST_KEY)).toBe(false)
  })

  it('verifySeal returns false when active is changed', () => {
    const ledger = sealedLedger(makeLedger())
    const tampered = { ...ledger, active: false }
    expect(verifySeal(tampered, TEST_KEY)).toBe(false)
  })

  it('verifySeal returns false when the wrong key is used', () => {
    const ledger = sealedLedger(makeLedger())
    const wrongKey = Buffer.from('b'.repeat(64), 'hex')
    expect(verifySeal(ledger, wrongKey)).toBe(false)
  })

  it('verifySeal returns false when seal field is absent', () => {
    const ledger = makeLedger()
    expect(verifySeal(ledger, TEST_KEY)).toBe(false)
  })

  it('verifySeal returns false when seal is not a string', () => {
    const ledger = { ...makeLedger(), gate: { advisor: 'APPROVE', seal: 12345 } }
    expect(verifySeal(ledger, TEST_KEY)).toBe(false)
  })

  it('computeSeal accepts a hex string key (same result as Buffer)', () => {
    const state = canonicalReleaseState(makeLedger())
    const fromBuffer = computeSeal(state, TEST_KEY)
    const fromHex = computeSeal(state, 'a'.repeat(64))
    expect(fromBuffer).toBe(fromHex)
  })

  it('computeSeal output is a 64-char hex string (32-byte HMAC-SHA256)', () => {
    const state = canonicalReleaseState(makeLedger())
    const seal = computeSeal(state, TEST_KEY)
    expect(seal).toMatch(/^[0-9a-f]{64}$/)
  })
})

// ---------------------------------------------------------------------------
// AC3 — Key management
// ---------------------------------------------------------------------------

describe('keyPath / ensureKey / readKey (AC3)', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'gate-seal-test-'))
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('keyPath resolves to the ledger sibling for a given sessionId', () => {
    const kp = keyPath({ projectDir: tmpDir, sessionId: 'ses-test123' })
    expect(kp).toBe(path.join(tmpDir, '.groundwork', 'runs', 'ses-test123.seal.key'))
  })

  it('keyPath uses the same SAFE_ID validation as resolveLedgerPath', () => {
    // Valid: alphanumeric + _ -
    expect(keyPath({ projectDir: tmpDir, sessionId: 'abc-123_XYZ' })).toContain('abc-123_XYZ.seal.key')

    // Invalid: path traversal characters → fallback
    const traversal = keyPath({ projectDir: tmpDir, sessionId: '../evil' })
    expect(traversal).toContain('legacy.seal.key')
    expect(traversal).not.toContain('evil')

    // Missing sessionId → fallback
    const noSession = keyPath({ projectDir: tmpDir })
    expect(noSession).toContain('legacy.seal.key')
  })

  it('ensureKey mints a 32-byte key with mode 0600', () => {
    const key = ensureKey({ projectDir: tmpDir, sessionId: 'ses-newkey' })
    expect(Buffer.isBuffer(key)).toBe(true)
    expect(key.length).toBe(32)

    const kp = keyPath({ projectDir: tmpDir, sessionId: 'ses-newkey' })
    expect(existsSync(kp)).toBe(true)

    const mode = statSync(kp).mode & 0o777
    expect(mode).toBe(0o600)
  })

  it('ensureKey is idempotent (returns same key on second call)', () => {
    const key1 = ensureKey({ projectDir: tmpDir, sessionId: 'ses-idem' })
    const key2 = ensureKey({ projectDir: tmpDir, sessionId: 'ses-idem' })
    expect(key1.equals(key2)).toBe(true)
  })

  it('readKey round-trips the key written by ensureKey', () => {
    const written = ensureKey({ projectDir: tmpDir, sessionId: 'ses-roundtrip' })
    const read = readKey({ projectDir: tmpDir, sessionId: 'ses-roundtrip' })
    expect(Buffer.isBuffer(read)).toBe(true)
    expect(read.length).toBe(32)
    expect(read.equals(written)).toBe(true)
  })

  it('ensureKey creates runs/ directory if absent', () => {
    const runsDir = path.join(tmpDir, '.groundwork', 'runs')
    expect(existsSync(runsDir)).toBe(false)
    ensureKey({ projectDir: tmpDir, sessionId: 'ses-mkdir' })
    expect(existsSync(runsDir)).toBe(true)
  })

  it('SCHEMA_VERSION is a positive integer', () => {
    expect(Number.isInteger(SCHEMA_VERSION)).toBe(true)
    expect(SCHEMA_VERSION).toBeGreaterThan(0)
  })
})
