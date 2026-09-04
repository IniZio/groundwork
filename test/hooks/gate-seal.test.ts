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
import { mkdtempSync, mkdirSync, statSync, rmSync, existsSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
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
      { id: 'S1', status: 'complete', created_by: 'orchestrator', wave: 0, desc: 'ignored-field' },
      { id: 'S2', status: 'complete', created_by: 'orchestrator', wave: 1 },
      { id: 'S3', status: 'pending', created_by: 'orchestrator', wave: 1 },
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
        { id: 'S3', status: 'pending', created_by: 'orchestrator' },
        { id: 'S1', status: 'complete', created_by: 'orchestrator' },
        { id: 'S2', status: 'complete', created_by: 'orchestrator' },
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
        { id: 'S1', status: 'complete', created_by: 'orchestrator', wave: 99, desc: 'changed', unrelated: true },
        { id: 'S2', status: 'complete', created_by: 'orchestrator', tags: ['x'] },
        { id: 'S3', status: 'pending', created_by: 'orchestrator', blocked_by: ['S1'] },
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

  // S7-AC1: created_by is a covered field — changes produce different canonical strings
  it('slice created_by changes produce different canonical strings (attribution is covered)', () => {
    const withAttribution = canonicalReleaseState(makeLedger())
    const forged = canonicalReleaseState(makeLedger({
      slices: [
        { id: 'S1', status: 'complete', created_by: 'forged-subagent', wave: 0 },
        { id: 'S2', status: 'complete', created_by: 'orchestrator', wave: 1 },
        { id: 'S3', status: 'pending', created_by: 'orchestrator', wave: 1 },
      ],
    }))
    expect(withAttribution).not.toBe(forged)
  })

  // S7-AC1: slices without created_by serialize as created_by: null (backward compat)
  it('slices without created_by serialize created_by as null', () => {
    const state = canonicalReleaseState(makeLedger({
      slices: [{ id: 'S1', status: 'complete' }],
    }))
    const parsed = JSON.parse(state)
    expect(parsed.slices[0]).toEqual({ id: 'S1', status: 'complete', created_by: null })
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
      { id: 'S1', status: 'complete', created_by: 'orchestrator' },
      { id: 'S2', status: 'complete', created_by: 'orchestrator' },
      { id: 'S3', status: 'pending', created_by: 'orchestrator' },
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

  // S7-AC2: tampering created_by invalidates the seal (attribution is sealed)
  it('verifySeal returns false when a slice created_by is changed (attribution tamper)', () => {
    const ledger = sealedLedger(makeLedger())
    const tampered = {
      ...ledger,
      slices: ledger.slices.map((s: Record<string, unknown>, i: number) =>
        i === 0 ? { ...s, created_by: 'forged-subagent' } : s,
      ),
    }
    expect(verifySeal(tampered as object, TEST_KEY)).toBe(false)
  })

  // S7-AC2: erasing created_by (setting to null) also invalidates the seal
  it('verifySeal returns false when slice created_by is erased (set to null)', () => {
    const ledger = sealedLedger(makeLedger())
    const tampered = {
      ...ledger,
      slices: ledger.slices.map((s: Record<string, unknown>, i: number) =>
        i === 0 ? { ...s, created_by: null } : s,
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

// ---------------------------------------------------------------------------
// S-TOKEN — scoped_tokens seal coverage (security fix)
// ---------------------------------------------------------------------------

const STOP_GATE_HOOK = path.resolve(import.meta.dirname, '..', '..', 'bin', 'gw-hook')

describe('scoped_tokens seal coverage (S-TOKEN)', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), 'gate-seal-token-'))
    mkdirSync(path.join(tmpDir, '.groundwork', 'runs'), { recursive: true })
    mkdirSync(path.join(tmpDir, '.groundwork', 'motives', 'test-motive'), { recursive: true })
    writeFileSync(
      path.join(tmpDir, '.groundwork', 'motives', 'test-motive', 'motive.md'),
      '# Test motive\n',
    )
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  function makeSealedLedgerWithTokens(scoped_tokens?: Array<{scope: string, token: string}>) {
    const sessionId = 'token-test-sess'
    const key = ensureKey({ projectDir: tmpDir, sessionId })
    const ledger: Record<string, unknown> = {
      schema_version: SCHEMA_VERSION,
      session_id: sessionId,
      active: true,
      motive_ref: 'test-motive',
      slices: [{ id: 'S1', status: 'complete', created_by: 'orchestrator' }],
      gate: { advisor: 'APPROVE' },
      ...(scoped_tokens !== undefined ? { scoped_tokens } : {}),
    }
    const stateString = canonicalReleaseState(ledger as any)
    const seal = computeSeal(stateString, key)
    ledger.gate = { ...(ledger.gate as Record<string, unknown>), seal }
    return { ledger, key, sessionId }
  }

  // S-TOKEN-AC1: injecting a scoped_token into a sealed ledger (that had none) breaks the seal
  it('S-TOKEN-AC1: injecting scoped_tokens into a sealed ledger (that had none) breaks verifySeal', () => {
    const { ledger, key } = makeSealedLedgerWithTokens() // no scoped_tokens
    expect(verifySeal(ledger as any, key)).toBe(true) // baseline: valid
    // Attacker injects a token — the field goes from absent to present
    const tampered = { ...ledger, scoped_tokens: [{ scope: 'attacker', token: 'evil-tok' }] }
    expect(verifySeal(tampered as any, key)).toBe(false)
  })

  // S-TOKEN-AC2: swapping the token VALUE for an existing scope also breaks the seal
  it('S-TOKEN-AC2: swapping a token value for an existing scope breaks verifySeal', () => {
    const { ledger, key } = makeSealedLedgerWithTokens([{ scope: 'orchestrator', token: 'legit-tok' }])
    expect(verifySeal(ledger as any, key)).toBe(true) // baseline
    // Attacker knows the scope, swaps in their own token
    const tampered = { ...ledger, scoped_tokens: [{ scope: 'orchestrator', token: 'swapped-tok' }] }
    expect(verifySeal(tampered as any, key)).toBe(false)
  })

  // S-TOKEN-AC3: determinism — different scoped_tokens array order yields the same seal
  it('S-TOKEN-AC3: scoped_tokens array order does not affect the canonical string', () => {
    const tokens = [
      { scope: 'beta', token: 'tok-b' },
      { scope: 'alpha', token: 'tok-a' },
    ]
    const ledgerA = makeLedger({ scoped_tokens: tokens })
    const ledgerB = makeLedger({ scoped_tokens: [...tokens].reverse() })
    expect(canonicalReleaseState(ledgerA)).toBe(canonicalReleaseState(ledgerB))
  })

  // S-TOKEN-AC4: same seal computed twice from the same state
  it('S-TOKEN-AC4: canonicalReleaseState is deterministic with scoped_tokens present', () => {
    const ledger = makeLedger({ scoped_tokens: [{ scope: 'orch', token: 'abc' }] })
    expect(canonicalReleaseState(ledger)).toBe(canonicalReleaseState(ledger))
  })

  // S-TOKEN-AC5: absent scoped_tokens (legacy) vs present-empty produce DIFFERENT canonicals
  // (because absent = excluded from canonical; present-empty = included as [])
  // This ensures an attacker cannot smuggle an empty array without breaking the seal.
  it('S-TOKEN-AC5: absent scoped_tokens and present-empty scoped_tokens produce different canonicals', () => {
    const withoutField = makeLedger() // no scoped_tokens
    const withEmptyField = makeLedger({ scoped_tokens: [] })
    expect(canonicalReleaseState(withoutField)).not.toBe(canonicalReleaseState(withEmptyField))
  })

  // S-TOKEN-AC6: STOP-GATE BLOCKS — the full attack: inject token into sealed fixture, run stop-gate
  it('S-TOKEN-AC6: stop-gate BLOCKS when scoped_tokens is injected into a sealed ledger', () => {
    const { ledger, sessionId } = makeSealedLedgerWithTokens() // sealed without scoped_tokens
    // Attacker injects token — seal now invalid
    const tampered = { ...ledger, scoped_tokens: [{ scope: 'attacker', token: 'evil-tok' }] }
    // Write tampered ledger to disk
    const ledgerPath = path.join(tmpDir, '.groundwork', 'runs', `${sessionId}.json`)
    writeFileSync(ledgerPath, JSON.stringify(tampered, null, 2))
    const input = JSON.stringify({ cwd: tmpDir, session_id: sessionId })
    const out = execFileSync(STOP_GATE_HOOK, ['hook', 'stop-gate'], { input, encoding: 'utf8' })
    const result = JSON.parse(out)
    // stop-gate returns {decision:"block",...} when it blocks (not {continue:false})
    expect(result.decision).toBe('block')
    expect(result.reason ?? '').toMatch(/seal/i)
  })

  // S-TOKEN-LEGACY: ledger sealed without scoped_tokens field still verifies (backward compat)
  it('S-TOKEN-LEGACY: ledger sealed under old shape (no scoped_tokens field) still verifies', () => {
    const { ledger, key } = makeSealedLedgerWithTokens() // sealed without scoped_tokens
    // No injection — just verify the original
    expect(verifySeal(ledger as any, key)).toBe(true)
  })
})
