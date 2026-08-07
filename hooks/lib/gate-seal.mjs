/**
 * gate-seal.mjs — tamper-evident gate-release seal for the stop-gate.
 *
 * Provides:
 *   - SCHEMA_VERSION: marks ledgers in the sealed regime.
 *   - canonicalReleaseState(ledger): deterministic serialization of release-affecting state.
 *   - computeSeal(stateString, key): HMAC-SHA256 hex over that canonical string.
 *   - verifySeal(ledger, key): timing-safe comparison against the stored seal.
 *   - keyPath({projectDir, sessionId}): resolves .seal.key sibling to the ledger file.
 *   - ensureKey({projectDir, sessionId}): mints + persists a fresh random key (mode 0600).
 *   - readKey({projectDir, sessionId}): raw fs read of the key Buffer.
 *
 * Dependency-free (node:crypto + node:fs only). ESM, no build step.
 */

import { createHmac, timingSafeEqual, randomBytes } from 'node:crypto'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'

/** Schema version marking the sealed regime. Ledgers at this version carry a gate.seal field. */
export const SCHEMA_VERSION = 1

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Same path-traversal guard as resolveLedgerPath in ledger-io.mjs. */
const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/

/**
 * Extract the advisor verdict string from gate.advisor, which may be a bare
 * string or an object {verdict, citation, rubric, ...} (see ledger.mjs:103).
 */
function extractAdvisorVerdict(gate) {
  const a = gate?.advisor
  if (!a) return null
  if (typeof a === 'string') return a
  if (typeof a === 'object' && a.verdict != null) return String(a.verdict)
  return null
}

// ---------------------------------------------------------------------------
// Canonical serialization (D-3)
// ---------------------------------------------------------------------------

/**
 * Reduce a ledger to its release-affecting state as a deterministic JSON string.
 *
 * Included fields (and only these):
 *   schema_version, session_id, active, advisor_verdict,
 *   slices: [{id, status}] sorted by id ascending.
 *
 * Key ordering is fixed; slice array is sorted by id — same logical state always
 * produces the same byte string regardless of key order or insertion order.
 * Unrelated fields (tokens, write_token, gate.citation, etc.) are ignored.
 *
 * @param {object} ledger - parsed ledger object
 * @returns {string} deterministic JSON string
 */
export function canonicalReleaseState(ledger) {
  const slices = Array.isArray(ledger.slices) ? ledger.slices : []
  const sortedSlices = slices
    .map(s => ({ id: String(s.id), status: String(s.status) }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))

  const state = {
    schema_version: ledger.schema_version ?? null,
    session_id: ledger.session_id ?? null,
    active: ledger.active ?? null,
    advisor_verdict: extractAdvisorVerdict(ledger.gate),
    slices: sortedSlices,
  }
  return JSON.stringify(state)
}

// ---------------------------------------------------------------------------
// HMAC-SHA256 compute + verify
// ---------------------------------------------------------------------------

/**
 * Compute HMAC-SHA256 over stateString using key.
 *
 * @param {string} stateString - output of canonicalReleaseState
 * @param {Buffer|string} key - raw 32-byte Buffer or hex-encoded string
 * @returns {string} HMAC hex digest
 */
export function computeSeal(stateString, key) {
  const keyBuf = Buffer.isBuffer(key) ? key : Buffer.from(key, 'hex')
  return createHmac('sha256', keyBuf).update(stateString, 'utf8').digest('hex')
}

/**
 * Verify the stored seal in a ledger against the provided key.
 * Uses timing-safe comparison to avoid timing side-channels.
 *
 * The seal is stored at ledger.gate.seal (hex string). Returns false if
 * the field is absent, not a string, wrong length, or does not match the
 * HMAC recomputed from the canonical release state.
 *
 * @param {object} ledger - parsed ledger object
 * @param {Buffer|string} key - raw 32-byte Buffer or hex-encoded string
 * @returns {boolean}
 */
export function verifySeal(ledger, key) {
  const storedSeal = ledger?.gate?.seal
  if (!storedSeal || typeof storedSeal !== 'string') return false
  try {
    const stateString = canonicalReleaseState(ledger)
    const expected = computeSeal(stateString, key)
    // Both are hex — 64 chars each (32-byte HMAC). Lengths must match for timingSafeEqual.
    const storedBuf = Buffer.from(storedSeal, 'hex')
    const expectedBuf = Buffer.from(expected, 'hex')
    if (storedBuf.length !== expectedBuf.length) return false
    return timingSafeEqual(storedBuf, expectedBuf)
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// Key management — mirrors resolveLedgerPath resolution (D-2)
// ---------------------------------------------------------------------------

/**
 * Resolve the seal-key sidecar path for a given session.
 * Mirrors the `resolveLedgerPath` validation in hooks/lib/ledger-io.mjs:150.
 *
 * Strategy:
 *   - With a valid sessionId: .groundwork/runs/<sessionId>.seal.key
 *     (sibling to the per-session ledger .groundwork/runs/<sessionId>.json)
 *   - Without a valid sessionId: .groundwork/runs/legacy.seal.key
 *     (legacy runs are not in the sealed regime, but a stable path is returned)
 *
 * @param {{projectDir: string, sessionId?: string}} opts
 * @returns {string} absolute path to the key file
 */
export function keyPath({ projectDir, sessionId } = {}) {
  if (sessionId && typeof sessionId === 'string' && SAFE_ID.test(sessionId)) {
    return path.join(projectDir, '.groundwork', 'runs', `${sessionId}.seal.key`)
  }
  // Legacy / invalid sessionId — not a sealed run, but return a stable path.
  return path.join(projectDir, '.groundwork', 'runs', 'legacy.seal.key')
}

/**
 * Mint and persist a fresh random 32-byte key if not already present.
 * File is written with mode 0o600 (owner read/write only).
 * Idempotent: returns the existing key if the file already exists.
 *
 * @param {{projectDir: string, sessionId?: string}} opts
 * @returns {Buffer} the key bytes
 */
export function ensureKey({ projectDir, sessionId }) {
  const kp = keyPath({ projectDir, sessionId })
  if (existsSync(kp)) {
    return readFileSync(kp)
  }
  mkdirSync(path.dirname(kp), { recursive: true })
  const key = randomBytes(32)
  writeFileSync(kp, key, { mode: 0o600 })
  return key
}

/**
 * Read the seal key from disk (synchronous raw fs read).
 * The stop-gate hook reads with raw fs (not the Read tool) so it is not
 * subject to PreToolUse guards.
 *
 * @param {{projectDir: string, sessionId?: string}} opts
 * @returns {Buffer} the raw key bytes
 */
export function readKey({ projectDir, sessionId }) {
  const kp = keyPath({ projectDir, sessionId })
  return readFileSync(kp)
}
